/**
 * Fastify application for App GYM (GYM-2026).
 *
 * Spec 002 (auth/tenant/socios): Better Auth session verification, tenant
 * context resolved ONLY from stored data, role-guarded routes, and the
 * members/provisioning endpoints. The backend is the authority: no route
 * trusts a client-provided organizationId (REQ-1, TX-07). No sauna endpoints
 * ever in v1.0 (MVP-SAUNA-01/B).
 */
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { toNodeHandler } from "better-auth/node";
import { organizations } from "@gym/db";
import type { Database } from "@gym/db";
import { CreateMemberRequest, CreateOrganizationRequest, SessionResponse } from "@gym/contracts";
import { toErrorResponse, AppError, validationError } from "./errors.js";
import { assertTenantContext, type TenantContext } from "./tenant.js";
import { requireRole } from "./roles.js";
import type { Auth } from "./auth.js";
import { resolveSession } from "./resolve-session.js";
import { MembersService } from "./services/members.js";
import { ProvisioningService } from "./services/provisioning.js";
import type { SessionContext } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
    session?: SessionContext;
  }
}

export interface AppOptions {
  db: Database;
  /** When provided, auth routes are mounted; otherwise they 501. */
  auth?: Auth | undefined;
}

export async function buildServer(opts: AppOptions) {
  const app = Fastify({ logger: true });

  // Centralized error handling with the stable ErrorResponse contract.
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const response = toErrorResponse(err);
    const status = errorStatus(response.error.code);
    if (response.error.code === "INTERNAL_ERROR") {
      req.log.error({ err }, "unhandled error");
    }
    return reply.status(status).send(response);
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    return reply
      .status(404)
      .send(toErrorResponse(new AppError("NOT_FOUND", `Route ${req.method} ${req.url} not found`)));
  });

  app.decorateRequest("tenant", undefined);
  app.decorateRequest("session", undefined);

  const members = new MembersService(opts.db);

  /**
   * Session hook: verifies the Better Auth cookie/session and derives the
   * tenant context from stored data. A valid auth-session without an active
   * binding (staff assignment or member row) leaves req.session undefined —
   * protected routes then answer 401, never a fabricated tenant.
   *
   * The cookie cache is an optimization, never the authority: after a
   * sign-out the DB session is gone but a cached cookie could still resolve.
   * We always read the authoritative (DB) session via disableCookieCache.
   */
  app.addHook("onRequest", async (req: FastifyRequest) => {
    if (!opts.auth) return;
    const authSession = await opts.auth.api.getSession({
      headers: new Headers(req.headers as Record<string, string>),
      query: { disableCookieCache: true },
    });
    if (!authSession?.user) return;
    const ctx = await resolveSession(opts.db, {
      id: authSession.user.id,
      email: authSession.user.email,
    });
    if (ctx) {
      req.session = ctx;
      req.tenant = ctx;
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  // --- Better Auth handler (sign-in, sign-out, session endpoints) ----------
  if (opts.auth) {
    // Better Auth's handler delegates the /api/auth/* surface (sign-in/email,
    // sign-out, session). After a sign-out, its session lookup returns null,
    // so our own /api/v1 routes correctly answer 401 for the same cookie.
    app.all("/api/auth/*", async (req: FastifyRequest, reply: FastifyReply) => {
      await toNodeHandler(opts.auth!)(req.raw, reply.raw);
      reply.hijack();
    });
  }

  // --- Organizations (tenant provisioning, admin-only) ---------------------
  app.post("/api/v1/organizations", async (req: FastifyRequest, reply: FastifyReply) => {
    // Bootstrap endpoint: allowed only when NO session exists yet (first
    // admin). Once sessions exist, creating tenants requires an existing
    // platform admin — not modeled in v1.0, so this route stays bootstrap.
    if (req.session) {
      throw new AppError("FORBIDDEN", "Las organizaciones se crean solo en el arranque");
    }
    const parsed = CreateOrganizationRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const [org] = await opts.db
      .insert(organizations)
      .values({ name: parsed.data.name })
      .returning();
    return reply.status(201).send({ data: org });
  });

  // --- Staff/socio provisioning (admin of the target org) ------------------
  app.post("/api/v1/staff", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    if (!opts.auth) throw new AppError("INTERNAL_ERROR", "Auth no configurado");
    const parsed = CreateStaffBody.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const service = new ProvisioningService(opts.db, opts.auth);
    const result = await service.createStaff({
      ...parsed.data,
      // organizationId ALWAYS from the session, never from the body (REQ-1).
      organizationId: req.session.organizationId,
    });
    return reply.status(201).send({ data: result });
  });

  app.post("/api/v1/socios", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    if (!opts.auth) throw new AppError("INTERNAL_ERROR", "Auth no configurado");
    const parsed = CreateSocioBody.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const service = new ProvisioningService(opts.db, opts.auth);
    const result = await service.createSocio({
      ...parsed.data,
      organizationId: req.session.organizationId,
    });
    return reply.status(201).send({ data: result });
  });

  // --- Session introspection -------------------------------------------------
  app.get("/api/v1/auth/session", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session) {
      return reply.status(401).send(toErrorResponse(new AppError("UNAUTHENTICATED", "Se requiere sesión")));
    }
    const body = SessionResponse.parse({
      user: { id: req.session.accountId, email: req.session.email, name: req.session.email },
      organization: { id: req.session.organizationId, name: req.session.organizationId },
      role: req.session.role,
    });
    return reply.send({ data: body });
  });

  // --- Members ---------------------------------------------------------------
  app.get("/api/v1/members", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor"]);
    assertTenantContext(req.session);
    const query = (req.query as { q?: string }).q;
    const rows = await members.list(
      { organizationId: req.session.organizationId, role: req.session.role },
      query,
    );
    return reply.send({ data: rows });
  });

  app.get("/api/v1/members/me", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["socio"]);
    assertTenantContext(req.session);
    const row = await members.me({
      organizationId: req.session.organizationId,
      role: req.session.role,
      memberId: req.session.memberId,
    });
    return reply.send({ data: row });
  });

  app.post("/api/v1/members", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = CreateMemberRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await members.create(
      { organizationId: req.session.organizationId, role: req.session.role },
      parsed.data,
    );
    return reply.status(201).send({ data: row });
  });

  app.get<{ Params: { id: string } }>("/api/v1/members/:id", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor", "socio"]);
    assertTenantContext(req.session);
    const row = await members.getById(
      {
        organizationId: req.session.organizationId,
        role: req.session.role,
        memberId: req.session.memberId,
      },
      req.params.id,
    );
    return reply.send({ data: row });
  });

  app.patch<{ Params: { id: string } }>(
    "/api/v1/members/:id/contact",
    async (req, reply) => {
      requireRole(req.session, ["admin", "recepcion", "socio"]);
      assertTenantContext(req.session);
      const parsed = UpdateContactBody.safeParse(req.body);
      if (!parsed.success) throw validationError({ issues: parsed.error.issues });
      const row = await members.updateContact(
        {
          organizationId: req.session.organizationId,
          role: req.session.role,
          memberId: req.session.memberId,
        },
        req.params.id,
        parsed.data.contactEmail ?? null,
      );
      return reply.send({ data: row });
    },
  );

  return app;
}

// Local body schemas (staff/socio provisioning + contact update). The shared
// contracts live in @gym/contracts; these are the request-side variants.
import { z } from "zod";
const STAFF_ROLES = z.enum(["admin", "recepcion", "instructor"]);

const CreateStaffBody = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  name: z.string().min(1),
  role: STAFF_ROLES,
});

const CreateSocioBody = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  name: z.string().min(1),
});

const UpdateContactBody = z.object({
  contactEmail: z.string().email().nullable(),
});

function errorStatus(code: string): number {
  switch (code) {
    case "VALIDATION_ERROR":
      return 400;
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    default:
      return 500;
  }
}

export { assertTenantContext };
