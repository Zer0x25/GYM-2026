import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { toErrorResponse, AppError } from "./errors.js";
import { TENANT_HEADER, type TenantContext } from "./tenant.js";

async function makeApp(withBoom = false) {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err: unknown, _req, reply) => {
    const response = toErrorResponse(err);
    const status =
      response.error.code === "VALIDATION_ERROR"
        ? 400
        : response.error.code === "NOT_FOUND"
          ? 404
          : 500;
    return reply.status(status).send(response);
  });

  app.decorateRequest("tenant", undefined);
  app.addHook("onRequest", async (req) => {
    const orgFromHeader = req.headers[TENANT_HEADER];
    if (typeof orgFromHeader === "string" && orgFromHeader.length > 0) {
      const ctx: TenantContext = {
        organizationId: orgFromHeader,
        actorId: "scaffold-actor",
        role: "admin",
      };
      req.tenant = ctx;
    }
  });

  app.get("/health", async () => ({ status: "ok" }));
  if (withBoom) {
    app.get("/boom", async () => {
      throw new Error("secretos internos: connection string postgres://user:pass@host/db");
    });
  }
  await app.ready();
  return app;
}

describe("api scaffold", () => {
  it("serves /health with ok status", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("returns the stable error shape for unknown routes", async () => {
    const app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/no-existe" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("resolves the tenant context from the explicit header (scaffold behavior)", async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { [TENANT_HEADER]: "3fa85f64-5717-4562-b3fc-2c963f66afa6" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("does not expose internal error details to clients", async () => {
    const app = await makeApp(true);
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("postgres://");
    expect(JSON.stringify(body)).not.toContain("secretos internos");
    await app.close();
  });
});

describe("errors module", () => {
  it("maps AppError codes to the stable contract", () => {
    expect(toErrorResponse(new AppError("VALIDATION_ERROR", "bad"))).toEqual({
      error: { code: "VALIDATION_ERROR", message: "bad" },
    });
    expect(toErrorResponse(forbiddenCheck())).toEqual({
      error: { code: "FORBIDDEN", message: "Not authorized for this resource" },
    });
  });

  it("maps unknown errors to INTERNAL_ERROR without leaking the message", () => {
    const res = toErrorResponse(new Error("detalle sensible"));
    expect(res.error.code).toBe("INTERNAL_ERROR");
    expect(res.error.message).not.toContain("detalle sensible");
  });
});

function forbiddenCheck() {
  return new AppError("FORBIDDEN", "Not authorized for this resource");
}
