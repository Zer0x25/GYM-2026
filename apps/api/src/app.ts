/**
 * Fastify application scaffold for App GYM (GYM-2026).
 *
 * Scaffolding unit (specs/001-andamiaje-monorepo.md): server boot, centralized
 * error handling, tenant context plugin and a health check. No business
 * endpoints yet (N/C/P units); no sauna endpoints ever in v1.0 (MVP-SAUNA-01/B).
 */
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { toErrorResponse, AppError } from "./errors.js";
import { assertTenantContext, TENANT_HEADER, type TenantContext } from "./tenant.js";

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

export async function buildServer() {
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

  // Tenant context plugin: resolves organization from the verified session in
  // production; in the scaffold, an explicit header plus a dev default allow
  // smoke tests. The real auth wiring arrives with Entrega 1 (auth/tenant/roles).
  app.decorateRequest("tenant", undefined);
  app.addHook("onRequest", async (req: FastifyRequest) => {
    const orgFromHeader = req.headers[TENANT_HEADER];
    if (typeof orgFromHeader === "string" && orgFromHeader.length > 0) {
      req.tenant = {
        organizationId: orgFromHeader,
        actorId: "scaffold-actor",
        role: "admin",
      };
      return;
    }
    const devOrg = process.env.DEV_DEFAULT_ORGANIZATION_ID;
    if (process.env.NODE_ENV !== "production" && devOrg) {
      req.tenant = { organizationId: devOrg, actorId: "scaffold-actor", role: "admin" };
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}

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

export { assertTenantContext, type TenantContext };
