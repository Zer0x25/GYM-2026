import { safeRequest } from "./safe-request.js";
import { type EmailDelivery, createEmailDeliveryFromEnv } from "./email-delivery.js";
import { ContactVerificationService } from "./services/contact-verification.js";
import { BookingCreditsService } from "./services/booking-credits.js";
import { FinancialAdjustmentsService } from "./services/financial-adjustments.js";
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
import { eq } from "drizzle-orm";
import { organizations } from "@gym/db";
import type { Database } from "@gym/db";
import {
  DailyReportQuery,
  AttendanceReportQuery,
  ScheduleQuery,
  OfflineLeaseRequest,
  OfflineLeaseResponse,
  OfflinePolicyUpdateRequest,
  CloseCashSessionRequest,
  CreateBookingRequest,
  CancelBookingRequest,
  CreateClassTemplateRequest,
  CreateMemberRequest,
  UpdateMemberRequest,
  CreateMembershipRequest,
  CreateOrganizationRequest,
  CreatePlanRequest,
  UpdatePlanRequest,
  SchedulePlanChangeRequest,
  CreateMembershipPauseRequest,
  CreateSessionRequest,
  DecidePaymentRequest,
  MarkAttendanceRequest,
  OpenCashSessionRequest,
  RegisterDeviceRequest,
  RegisterPaymentRequest,
  RegisterFinancialAdjustmentRequest,
  ReconstructRequest,
  ListSessionsQuery,
  RevokeSessionRequest,
  RevokeAllSessionsRequest,
  CheckinRequest,
  SessionResponse,
  SyncEventsRequest,
} from "@gym/contracts";
import { toErrorResponse, AppError, validationError } from "./errors.js";
import { assertTenantContext, type TenantContext } from "./tenant.js";
import { requireRole } from "./roles.js";
import type { Auth } from "./auth.js";
import { resolveSession } from "./resolve-session.js";
import { MembersService } from "./services/members.js";
import { ProvisioningService } from "./services/provisioning.js";
import { PlansService } from "./services/plans.js";
import { MembershipsService } from "./services/memberships.js";
import { PaymentsService } from "./services/payments.js";
import { CashService } from "./services/cash.js";
import { SessionsService } from "./services/sessions.js";
import { BookingsService } from "./services/bookings.js";
import { OfflineService } from "./services/offline.js";
import { SessionRevocationService } from "./services/session-revocation.js";
import { OperationsService } from "./services/operations.js";
import { CheckinService } from "./services/checkin.js";
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
  emailDelivery?: EmailDelivery;
  appOrigin?: string;
}

export async function buildServer(opts: AppOptions) {
  const app = Fastify({ logger: { serializers: { req: safeRequest } } });

  // Centralized error handling with the stable ErrorResponse contract.
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const invalidJson =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === "FST_ERR_CTP_INVALID_JSON_BODY";
    const response = toErrorResponse(invalidJson ? validationError() : err);
    const status = errorStatus(response.error.code);
    if (response.error.code === "INTERNAL_ERROR") {
      if (req.url.startsWith("/api/auth/") || req.url.includes("/contact")) {
        req.log.error({ code: "INTERNAL_ERROR" }, "account request failed");
      } else {
        req.log.error({ err }, "unhandled error");
      }
    }
    return reply.status(status).send(response);
  });

  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    return reply
      .status(404)
      .send(
        toErrorResponse(
          new AppError(
            "NOT_FOUND",
            `Route ${safeRequest(req).method} ${safeRequest(req).url} not found`,
          ),
        ),
      );
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
      // The authoritative session row id lets self-revocation exclude the
      // session currently in use (SPEC:REVOKE).
      ctx.sessionId = authSession.session?.id;
      req.session = ctx;
      req.tenant = ctx;
    }
  });

  const emailDelivery = opts.emailDelivery ?? createEmailDeliveryFromEnv();

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/v1/account/email-capabilities", async () => ({
    data: {
      passwordReset: Boolean(opts.auth?.emailDeliveryEnabled || emailDelivery),
      contactVerification: Boolean(emailDelivery),
    },
  }));
  const contactVerification = new ContactVerificationService(
    opts.db,
    emailDelivery,
    opts.appOrigin,
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/members/:id/contact-verification",
    async (req, reply) => {
      requireRole(req.session, ["socio"]);
      assertTenantContext(req.session);
      return reply
        .status(202)
        .send({ data: await contactVerification.request(req.session, req.params.id, req.body) });
    },
  );
  app.post<{ Params: { id: string } }>("/api/v1/members/:id/contact/verify", async (req, reply) => {
    requireRole(req.session, ["socio"]);
    assertTenantContext(req.session);
    return reply.send({
      data: await contactVerification.confirm(req.session, req.params.id, req.body),
    });
  });

  // --- Better Auth handler (sign-in, sign-out, session endpoints) ----------
  if (opts.auth) {
    // Better Auth's handler works on the WHATWG Request API. Fastify's raw
    // Node req/res are NOT WHATWG streams — delegating via toNodeHandler
    // loses the body (the sign-in request arrives with body: undefined and
    // Better Auth answers 400 VALIDATION_ERROR). So we bridge manually:
    // build a native Request, call auth.handler, and stream the Response back.
    app.all("/api/auth/*", async (req: FastifyRequest, reply: FastifyReply) => {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      }
      const init: RequestInit = {
        method: req.method,
        headers,
        redirect: "manual",
      };
      // Only GET/HEAD have no body.
      if (req.method !== "GET" && req.method !== "HEAD") {
        // Re-serialize the already-parsed body when present; fall back to the
        // raw stream otherwise (e.g. multipart — not used by this app).
        if (req.body !== undefined && req.body !== null) {
          init.body = JSON.stringify(req.body);
          if (!headers.has("content-type")) headers.set("content-type", "application/json");
        } else {
          const chunks: Buffer[] = [];
          for await (const chunk of req.raw) chunks.push(chunk as Buffer);
          const buf = Buffer.concat(chunks);
          if (buf.length > 0) init.body = buf;
        }
      }
      const nativeReq = new Request(url.toString(), init);
      const res = await opts.auth!.handler(nativeReq);

      reply.status(res.status);
      // Set-Cookie MUST be forwarded as multiple headers. reply.header()
      // overwrites on repeat; use raw.setHeader with the array from
      // getSetCookie() so both session_token and session_data survive.
      const setCookies = res.headers.getSetCookie();
      if (setCookies.length > 0) {
        reply.raw.setHeader("set-cookie", setCookies);
      }
      res.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        // Skip hop-by-hop / encoding headers Fastify owns.
        if (lower === "content-encoding" || lower === "set-cookie") return;
        void reply.header(key, value);
      });
      const text = await res.text();
      void reply.send(text);
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
    const initialized = await opts.db.select({ id: organizations.id }).from(organizations).limit(1);
    if (initialized.length) throw new AppError("FORBIDDEN", "La organización ya fue inicializada");
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
      return reply
        .status(401)
        .send(toErrorResponse(new AppError("UNAUTHENTICATED", "Se requiere sesión")));
    }
    const [org] = await opts.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, req.session.organizationId));
    const body = SessionResponse.parse({
      user: { id: req.session.accountId, email: req.session.email, name: req.session.email },
      organization: org ?? { id: req.session.organizationId, name: req.session.organizationId },
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
      {
        organizationId: req.session.organizationId,
        role: req.session.role,
        memberId: req.session.memberId,
        accountId: req.session.accountId,
      },
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
        accountId: req.session.accountId,
      },
      req.params.id,
    );
    return reply.send({ data: row });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/members/:id", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "socio"]);
    assertTenantContext(req.session);
    const parsed = UpdateMemberRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await members.update(
      {
        organizationId: req.session.organizationId,
        role: req.session.role,
        memberId: req.session.memberId,
        accountId: req.session.accountId,
      },
      req.params.id,
      parsed.data,
    );
    return reply.send({ data: row });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/members/:id/contact", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "socio"]);
    assertTenantContext(req.session);
    const parsed = UpdateContactBody.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await members.updateContact(
      {
        organizationId: req.session.organizationId,
        role: req.session.role,
        memberId: req.session.memberId,
        accountId: req.session.accountId,
      },
      req.params.id,
      parsed.data.contactEmail ?? null,
    );
    return reply.send({ data: row });
  });

  // --- Plans (admin: CRUD; staff: lectura) -----------------------------------
  const plansService = new PlansService(opts.db);

  app.get("/api/v1/plans", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor"]);
    assertTenantContext(req.session);
    const rows = await plansService.list(req.session.organizationId);
    return reply.send({ data: rows });
  });

  app.post("/api/v1/plans", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = CreatePlanRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await plansService.create(req.session.organizationId, parsed.data);
    return reply.status(201).send({ data: row });
  });

  app.get<{ Params: { id: string } }>("/api/v1/plans/:id", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor"]);
    assertTenantContext(req.session);
    const row = await plansService.getById(req.session.organizationId, req.params.id);
    return reply.send({ data: row });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/plans/:id", async (req, reply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = UpdatePlanRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await plansService.update(req.session.organizationId, req.params.id, parsed.data);
    return reply.send({ data: row });
  });

  // --- Memberships (admin/recepción asignan; socio lee las propias) -----------
  const membershipsService = new MembershipsService(opts.db);

  app.post("/api/v1/memberships", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = CreateMembershipRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await membershipsService.assign(
      req.session.organizationId,
      parsed.data.memberId,
      parsed.data.planId,
    );
    return reply.status(201).send({ data: row });
  });

  app.post<{ Params: { id: string } }>(
    "/api/v1/memberships/:id/schedule-plan-change",
    async (req, reply) => {
      requireRole(req.session, ["admin", "recepcion"]);
      assertTenantContext(req.session);
      const parsed = SchedulePlanChangeRequest.safeParse(req.body);
      if (!parsed.success) throw validationError({ issues: parsed.error.issues });
      const row = await membershipsService.schedulePlanChange(
        req.session,
        req.params.id,
        parsed.data.nextPlanId,
      );
      return reply.send({ data: row });
    },
  );

  app.post<{ Params: { id: string } }>("/api/v1/memberships/:id/pauses", async (req, reply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = CreateMembershipPauseRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await membershipsService.createPause(req.session, req.params.id, parsed.data);
    return reply.status(200).send({ data: row });
  });

  app.get("/api/v1/memberships", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor"]);
    assertTenantContext(req.session);
    const rows = await membershipsService.list(req.session.organizationId);
    // State is derived per membership (SPEC rights rule): compute on read.
    const withState = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        state: await paymentsService.membershipState(req.session!.organizationId, row.id),
      })),
    );
    return reply.send({ data: withState });
  });

  app.get("/api/v1/memberships/mine", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["socio"]);
    assertTenantContext(req.session);
    if (!req.session.memberId) throw new AppError("FORBIDDEN", "Sesión sin socio vinculado");
    const rows = await membershipsService.listByMember(
      req.session.organizationId,
      req.session.memberId,
    );
    return reply.send({ data: rows });
  });

  app.get<{ Params: { id: string } }>("/api/v1/memberships/:id", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor", "socio"]);
    assertTenantContext(req.session);
    const row = await membershipsService.getById(req.session.organizationId, req.params.id);
    // A socio may only read their own membership.
    if (req.session.role === "socio" && row.memberId !== req.session.memberId) {
      throw new AppError("NOT_FOUND", "Membresía no encontrada");
    }
    const state = await paymentsService.membershipState(req.session.organizationId, row.id);
    return reply.send({ data: { ...row, state } });
  });

  // --- Payments (REQ-2) -------------------------------------------------------
  const paymentsService = new PaymentsService(opts.db);

  app.post("/api/v1/payments", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = RegisterPaymentRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await paymentsService.register(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      parsed.data,
    );
    return reply.status(201).send({ data: row });
  });

  app.get("/api/v1/payments", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const query = (req.query as { state?: string }).state;
    const rows = await paymentsService.list(
      req.session.organizationId,
      query === "provisional" || query === "validated" || query === "rejected" ? query : undefined,
    );
    return reply.send({ data: rows });
  });

  app.get<{ Params: { id: string } }>("/api/v1/payments/:id", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const row = await paymentsService.getById(req.session.organizationId, req.params.id);
    return reply.send({ data: row });
  });

  // Validación/rechazo: SOLO admin, y nunca sobre registro propio (SPEC:PAY-02).
  app.post<{ Params: { id: string } }>("/api/v1/payments/:id/validate", async (req, reply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const row = await paymentsService.validate(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      req.params.id,
    );
    return reply.send({ data: row });
  });

  app.post<{ Params: { id: string } }>("/api/v1/payments/:id/reject", async (req, reply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = DecidePaymentRequest.safeParse(req.body ?? {});
    if (!parsed.success || !parsed.data.reason) {
      throw validationError({ issues: [{ path: ["reason"], message: "Motivo obligatorio" }] });
    }
    const row = await paymentsService.reject(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      req.params.id,
      parsed.data.reason,
    );
    return reply.send({ data: row });
  });

  const financialService = new FinancialAdjustmentsService(opts.db);
  app.post<{ Params: { id: string } }>("/api/v1/payments/:id/adjustments", async (req, reply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = RegisterFinancialAdjustmentRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const data = await financialService.register(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      req.params.id,
      parsed.data,
    );
    return reply.send({ data });
  });
  app.get<{ Params: { id: string } }>("/api/v1/payments/:id/adjustments", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const data = await financialService.list(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      req.params.id,
    );
    return reply.send({ data });
  });

  // --- Cash (REQ-3) ------------------------------------------------------------
  const cashService = new CashService(opts.db);

  app.post("/api/v1/cash/sessions", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = OpenCashSessionRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await cashService.open(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      parsed.data.openingCents,
    );
    return reply.status(201).send({ data: row });
  });

  app.get("/api/v1/cash/sessions/current", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const row = await cashService.findOpenSession(req.session.organizationId);
    return reply.send({ data: row ?? null });
  });

  app.post<{ Params: { id: string } }>("/api/v1/cash/sessions/:id/close", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = CloseCashSessionRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await cashService.close(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      req.params.id,
      parsed.data.declaredClosingCents,
    );
    return reply.send({ data: row });
  });

  app.get<{ Params: { id: string } }>("/api/v1/cash/sessions/:id", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const session = await cashService.getById(req.session.organizationId, req.params.id);
    const movements = await cashService.movements(req.session.organizationId, req.params.id);
    const adjustments = await cashService.adjustments(req.session.organizationId, req.params.id);
    return reply.send({ data: { session, movements, adjustments } });
  });

  app.get("/api/v1/cash/consolidation", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const query = (req.query as { date?: string }).date;
    const day = query ? new Date(query) : new Date();
    const data = await cashService.consolidateDay(req.session.organizationId, day);
    return reply.send({ data });
  });

  // --- Classes & sessions (Entrega 3) -----------------------------------------
  const sessionsService = new SessionsService(opts.db);
  const bookingsService = new BookingsService(opts.db);

  app.post("/api/v1/class-templates", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = CreateClassTemplateRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await sessionsService.createTemplate(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      parsed.data,
    );
    return reply.status(201).send({ data: row });
  });

  app.get("/api/v1/class-templates", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor", "socio"]);
    assertTenantContext(req.session);
    const rows = await sessionsService.listTemplates(req.session.organizationId);
    return reply.send({ data: rows });
  });

  app.post("/api/v1/sessions", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor"]);
    assertTenantContext(req.session);
    const parsed = CreateSessionRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await sessionsService.create(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      {
        templateId: parsed.data.templateId,
        type: parsed.data.type,
        instructorId: parsed.data.instructorId,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        capacity: parsed.data.capacity,
      },
    );
    return reply.status(201).send({ data: row });
  });

  app.get("/api/v1/sessions", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor", "socio"]);
    assertTenantContext(req.session);
    const query = req.query as { from?: string; to?: string };
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const to = query.to ? new Date(query.to) : new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const rows = await sessionsService.listBookable(req.session.organizationId, from, to);
    return reply.send({ data: rows });
  });

  app.get<{ Params: { id: string } }>("/api/v1/sessions/:id", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor", "socio"]);
    assertTenantContext(req.session);
    const session = await sessionsService.getById(req.session.organizationId, req.params.id);
    return reply.send({ data: session });
  });

  app.post<{ Params: { id: string } }>("/api/v1/sessions/:id/cancel", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const row = await sessionsService.cancel(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      req.params.id,
    );
    return reply.send({ data: row });
  });

  // Unified instructor agenda (REQ-6, TX-02)
  app.get("/api/v1/agenda", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor"]);
    assertTenantContext(req.session);
    const query = req.query as { instructorId?: string; from?: string; to?: string };
    if (!query.instructorId)
      throw validationError({
        issues: [{ path: ["instructorId"], message: "instructorId requerido" }],
      });
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const to = query.to ? new Date(query.to) : new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const rows = await sessionsService.agenda(
      req.session.organizationId,
      query.instructorId,
      from,
      to,
    );
    return reply.send({ data: rows });
  });

  // --- Bookings (Entrega 3, REQ-4/5) -------------------------------------------
  app.post("/api/v1/bookings", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion", "socio"]);
    assertTenantContext(req.session);
    const parsed = CreateBookingRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    // Socio books for themselves (memberId from the session, never the client).
    const memberId =
      req.session.role === "socio"
        ? req.session.memberId
        : (req.body as { memberId?: string }).memberId;
    if (!memberId)
      throw validationError({ issues: [{ path: ["memberId"], message: "memberId requerido" }] });
    const row = await bookingsService.create(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
        memberId: req.session.memberId,
      },
      parsed.data.sessionId,
      memberId,
    );
    return reply.status(201).send({ data: row });
  });

  app.get("/api/v1/bookings/mine", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["socio"]);
    assertTenantContext(req.session);
    if (!req.session.memberId) throw new AppError("FORBIDDEN", "Sesión sin socio vinculado");
    const rows = await bookingsService.listByMember(
      req.session.organizationId,
      req.session.memberId,
    );
    return reply.send({ data: rows });
  });

  app.get("/api/v1/bookings", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor"]);
    assertTenantContext(req.session);
    const query = req.query as { sessionId?: string };
    if (!query.sessionId)
      throw validationError({ issues: [{ path: ["sessionId"], message: "sessionId requerido" }] });
    const rows = await bookingsService.listBySession(req.session.organizationId, query.sessionId);
    return reply.send({ data: rows });
  });

  app.post<{ Params: { id: string } }>("/api/v1/bookings/:id/cancel", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "socio"]);
    assertTenantContext(req.session);
    const parsed = CancelBookingRequest.safeParse(req.body ?? {});
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const result = await bookingsService.cancel(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
        memberId: req.session.memberId,
      },
      req.params.id,
      parsed.data,
    );
    return reply.send({ data: result });
  });

  app.post<{ Params: { id: string } }>("/api/v1/bookings/:id/attendance", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor"]);
    assertTenantContext(req.session);
    const parsed = MarkAttendanceRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await bookingsService.markAttendance(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
        memberId: req.session.memberId,
      },
      req.params.id,
      parsed.data.outcome,
    );
    return reply.send({ data: row });
  });

  const bookingCredits = new BookingCreditsService(opts.db);
  app.get("/api/v1/me/credit-periods", async (req, reply) => {
    requireRole(req.session, ["socio"]);
    assertTenantContext(req.session);
    return reply.send({ data: await bookingCredits.list(req.session, req.session.memberId!) });
  });
  app.get<{ Params: { id: string } }>("/api/v1/members/:id/credit-periods", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "socio"]);
    assertTenantContext(req.session);
    return reply.send({ data: await bookingCredits.list(req.session, req.params.id) });
  });
  app.post<{ Params: { id: string } }>(
    "/api/v1/members/:id/bookings/revalidate",
    async (req, reply) => {
      requireRole(req.session, ["admin", "recepcion"]);
      assertTenantContext(req.session);
      return reply.send({ data: await bookingsService.revalidate(req.session, req.params.id) });
    },
  );

  // --- Offline controlado (Entrega 4, spec 005, REQ-9) ------------------------
  const offlineService = new OfflineService(opts.db);

  app.post("/api/v1/devices", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = RegisterDeviceRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const row = await offlineService.registerDevice(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      parsed.data,
    );
    return reply.status(201).send({ data: row });
  });

  app.get("/api/v1/devices", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const rows = await offlineService.listDevices(req.session.organizationId);
    return reply.send({ data: rows });
  });

  app.post<{ Params: { id: string } }>("/api/v1/devices/:id/revoke", async (req, reply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const row = await offlineService.revokeDevice(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      req.params.id,
    );
    return reply.send({ data: row });
  });

  // Idempotent sync of the device outbox (TX-06): per-event acknowledgment.
  app.post("/api/v1/offline/sync", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = SyncEventsRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const result = await offlineService.syncLeased(
      {
        organizationId: req.session.organizationId,
        accountId: req.session.accountId,
        role: req.session.role,
      },
      parsed.data,
    );
    return reply.send({ data: result });
  });

  app.get("/api/v1/offline/events", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const query = req.query as { deviceId?: string };
    const rows = await offlineService.listEvents(req.session.organizationId, query.deviceId);
    return reply.send({ data: rows });
  });

  // Contingency ingress with snapshot freshness control (SPEC:OFF-FRESH).
  app.post("/api/v1/offline/ingreso", async (req: FastifyRequest) => {
    requireRole(req.session, ["admin", "recepcion"]);
    throw new AppError(
      "FORBIDDEN",
      "El ingreso de contingencia requiere permiso e instantánea firmados: usa /offline/lease/sync",
    );
  });

  // Auditable reconstruction + hash-chain verification (SPEC:OFF-RECON).
  app.post("/api/v1/offline/reconstruct", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = ReconstructRequest.safeParse(req.body ?? {});
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const result = await offlineService.reconstruct(
      req.session.organizationId,
      parsed.data.deviceId,
    );
    return reply.send({ data: result });
  });

  app.get("/api/v1/offline/devices", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    return reply.send({
      data: (await offlineService.listDevices(req.session.organizationId)).filter(
        (d) => d.accountId === req.session!.accountId,
      ),
    });
  });
  app.get("/api/v1/offline/policy", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    return reply.send({ data: await offlineService.policy(req.session) });
  });
  app.post("/api/v1/offline/policy", async (req, reply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = OfflinePolicyUpdateRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    return reply.send({ data: await offlineService.setPolicy(req.session, parsed.data.enabled) });
  });
  app.post("/api/v1/offline/lease", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = OfflineLeaseRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    return reply.send({
      data: OfflineLeaseResponse.parse(
        await offlineService.lease(req.session, parsed.data.deviceId),
      ),
    });
  });
  app.post("/api/v1/offline/lease/sync", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = SyncEventsRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    return reply.send({ data: await offlineService.syncLeased(req.session, parsed.data) });
  });

  // --- Revocación de sesión (Entrega 5, spec 006, REQ-11) -------------------
  const sessionRevocation = new SessionRevocationService(opts.db);

  // List active sessions of an account in the admin's tenant (admin only).
  app.get("/api/v1/admin/sessions", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = ListSessionsQuery.safeParse(req.query);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const rows = await sessionRevocation.listSessions(req.session, parsed.data.accountId);
    return reply.send({ data: rows });
  });

  // Revoke one session of an account in the admin's tenant (admin only).
  app.post("/api/v1/admin/sessions/revoke", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const parsed = RevokeSessionRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    await sessionRevocation.revokeSession(
      req.session,
      parsed.data.accountId,
      parsed.data.sessionId,
      req.ip,
    );
    return reply.send({ data: { revoked: 1 } });
  });

  // Revoke all sessions of an account in the admin's tenant (admin only).
  app.post(
    "/api/v1/admin/sessions/revoke-all",
    async (req: FastifyRequest, reply: FastifyReply) => {
      requireRole(req.session, ["admin"]);
      assertTenantContext(req.session);
      const parsed = RevokeAllSessionsRequest.safeParse(req.body);
      if (!parsed.success) throw validationError({ issues: parsed.error.issues });
      const revoked = await sessionRevocation.revokeAllSessions(
        req.session,
        parsed.data.accountId,
        req.ip,
      );
      return reply.send({ data: { revoked } });
    },
  );

  // Close my OTHER sessions, keep the one in use (any authenticated role).
  app.post(
    "/api/v1/me/sessions/revoke-others",
    async (req: FastifyRequest, reply: FastifyReply) => {
      requireRole(req.session, ["admin", "recepcion", "instructor", "socio"]);
      assertTenantContext(req.session);
      if (!req.session.sessionId) {
        throw new AppError("INTERNAL_ERROR", "No se pudo resolver la sesión actual");
      }
      const revoked = await sessionRevocation.revokeOthers(
        req.session,
        req.session.sessionId,
        req.ip,
      );
      return reply.send({ data: { revoked } });
    },
  );

  // --- QR de ingreso y check-in supervisado (Entrega 5, spec 007) ------------
  const checkinService = new CheckinService(opts.db);

  // Supervised check-in: reception scans a member's QR (admin/recepcion).
  // Coverage denial is a BUSINESS decision (200 + allowed:false), not a
  // transport error — the receptionist must see the reason. Cross-tenant /
  // unknown token is a real 404 (anti-enumeration).
  app.post("/api/v1/checkin", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = CheckinRequest.safeParse(req.body);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const outcome = await checkinService.checkin(req.session, parsed.data.qrToken, req.ip);
    return reply.send({ data: outcome });
  });

  // The socio's own QR (REQ-7): only ever their own.
  app.get("/api/v1/me/qr", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["socio"]);
    assertTenantContext(req.session);
    const qrToken = await checkinService.myQr(req.session);
    return reply.send({ data: { qrToken } });
  });

  // Reception live feed: recent check-ins of the organization (read-only,
  // tenant-scoped projection of the audit trail). Powers the mostrador view.
  app.get("/api/v1/checkins/recent", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const limitRaw = (req.query as { limit?: string }).limit;
    const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200) : 50;
    const rows = await checkinService.recentCheckins(
      req.session,
      limit,
      (req.query as { today?: string }).today === "true",
    );
    return reply.send({ data: rows });
  });

  // The socio rotates their own QR (invalidates the old one).
  app.post("/api/v1/me/qr/rotate", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["socio"]);
    assertTenantContext(req.session);
    const qrToken = await checkinService.rotateMyQr(req.session);
    return reply.send({ data: { qrToken } });
  });

  // Admin re-emits or revokes a member's QR (SPEC:QR-TOKEN).
  app.post("/api/v1/members/:id/qr/reissue", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const { id } = req.params as { id: string };
    const qrToken = await checkinService.reissueQr(req.session, id);
    return reply.send({ data: { qrToken } });
  });

  app.post("/api/v1/members/:id/qr/revoke", async (req: FastifyRequest, reply: FastifyReply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    const { id } = req.params as { id: string };
    await checkinService.revokeQr(req.session, id);
    return reply.send({ data: { revoked: true } });
  });

  const operations = new OperationsService(opts.db);
  app.get<{ Params: { id: string } }>("/api/v1/sessions/:id/roster", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor"]);
    assertTenantContext(req.session);
    return reply.send({ data: await operations.roster(req.session, req.params.id) });
  });
  app.get("/api/v1/reports/daily", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = DailyReportQuery.safeParse(req.query);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    return reply.send({ data: await operations.dailyReport(req.session, parsed.data.date) });
  });
  app.get("/api/v1/reports/members.csv", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const csv = await operations.membersCsv(req.session);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="members.csv"')
      .send(csv);
  });
  app.get("/api/v1/reports/memberships.csv", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const csv = await operations.membershipsCsv(req.session);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="memberships.csv"')
      .send(csv);
  });
  app.get("/api/v1/reports/attendance.csv", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    const parsed = AttendanceReportQuery.safeParse(req.query);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const csv = await operations.attendanceCsv(req.session, parsed.data.from, parsed.data.to);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="attendance-${parsed.data.from}-${parsed.data.to}.csv"`,
      )
      .send(csv);
  });
  app.get("/api/v1/instructors", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor", "socio"]);
    assertTenantContext(req.session);
    return reply.send({ data: await operations.instructors(req.session.organizationId) });
  });
  app.get("/api/v1/staff", async (req, reply) => {
    requireRole(req.session, ["admin"]);
    assertTenantContext(req.session);
    return reply.send({ data: await operations.staff(req.session) });
  });
  app.get("/api/v1/schedule", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion", "instructor", "socio"]);
    assertTenantContext(req.session);
    const query = ScheduleQuery.safeParse(req.query);
    if (!query.success) throw validationError({ issues: query.error.issues });
    return reply.send({
      data: await operations.schedule(
        req.session.organizationId,
        query.data.from ? new Date(query.data.from) : undefined,
        query.data.to ? new Date(query.data.to) : undefined,
      ),
    });
  });
  app.get<{ Params: { id: string } }>("/api/v1/members/:id/overview", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    return reply.send({ data: await operations.memberOverview(req.session, req.params.id) });
  });
  app.get("/api/v1/me/overview", async (req, reply) => {
    requireRole(req.session, ["socio"]);
    assertTenantContext(req.session);
    return reply.send({ data: await operations.portal(req.session) });
  });
  app.post<{ Params: { id: string } }>("/api/v1/members/:id/checkin", async (req, reply) => {
    requireRole(req.session, ["admin", "recepcion"]);
    assertTenantContext(req.session);
    return reply.send({
      data: await checkinService.checkinMember(req.session, req.params.id, req.ip),
    });
  });
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
    case "SERVICE_UNAVAILABLE":
      return 503;
    case "CONFLICT":
      return 409;
    default:
      return 500;
  }
}

export { assertTenantContext };
