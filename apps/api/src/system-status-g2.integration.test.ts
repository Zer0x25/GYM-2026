/**
 * Spec 027 — Diagnóstico operativo de producción, smoke-check post-despliegue
 * y cierre de preparación G2.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
import { sql } from "drizzle-orm";
import {
  createDb,
  organizations,
  identityAccounts,
  staffAssignments,
  devices,
  supportAccessGrants,
  type Database,
} from "@gym/db";
import { SystemStatusResponse } from "@gym/contracts";
import { createAuth } from "./auth.js";
import { buildServer } from "./app.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ROOT_DIR = resolve(import.meta.dirname, "../../..");

describe("Spec 027 — Artefactos y script de humo de producción (CA-2)", () => {
  it("CA-2: scripts/smoke-prod.sh existe, es ejecutable y pasa bash -n", () => {
    const smokeScript = resolve(ROOT_DIR, "scripts/smoke-prod.sh");
    expect(existsSync(smokeScript), "scripts/smoke-prod.sh debe existir").toBe(true);

    const stats = statSync(smokeScript);
    // Check executable bit for user
    expect(stats.mode & 0o111, "scripts/smoke-prod.sh debe ser ejecutable").toBeGreaterThan(0);

    const check = spawnSync("bash", ["-n", smokeScript], { encoding: "utf8" });
    expect(check.status).toBe(0);
    expect(check.stderr).toBe("");
  });

  it("CA-2: compose.prod.yaml incluye healthcheck a /health/ready", () => {
    const compose = readFileSync(resolve(ROOT_DIR, "compose.prod.yaml"), "utf8");
    expect(compose).toContain("/health/ready");
  });
});

describe.skipIf(!DATABASE_URL)("Spec 027 — Sondas de salud y estado del sistema (CA-1, BDD-1)", () => {
  let db: Database;
  let auth: ReturnType<typeof createAuth>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const people: Record<string, { id: string; cookie: string }> = {};

  let orgA: string;
  let orgB: string;

  const prevAllowMinor = process.env.ALLOW_MINOR_MEMBERS;

  const request = (
    person: string | null,
    method: "GET" | "POST",
    path: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url: path.startsWith("/") ? path : `/api/v1/${path}`,
      ...(payload === undefined ? {} : { payload }),
      headers: {
        ...(person ? { cookie: people[person]?.cookie ?? "" } : {}),
        origin: "http://localhost:3000",
      },
    });

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    auth = createAuth({
      db,
      secret: "0123456789abcdef0123456789abcdef0123456789abcdef",
      baseURL: "http://localhost:3000",
    });

    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, "user" RESTART IDENTITY CASCADE`,
    );

    for (const name of ["adminA", "recepcionA", "adminB"]) {
      const email = `${name}@status-test.cl`;
      const { user } = await auth.api.createUser({
        body: { email, password: "FictionalPass123!", name, data: { emailVerified: true } },
      });
      await db.insert(identityAccounts).values({ id: user.id, email, passwordHash: "better-auth" });
      const res = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ email, password: "FictionalPass123!" }),
        }),
      );
      expect(res.status).toBe(200);
      people[name] = {
        id: user.id,
        cookie: res.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; "),
      };
    }

    app = await buildServer({ db, auth });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE support_access_grants, devices, audit_log, cash_movements, cash_sessions, payments, memberships, plans, members, staff_assignments, organizations RESTART IDENTITY CASCADE`,
    );

    const [a, b] = await db
      .insert(organizations)
      .values([
        {
          name: "Gym A Status",
          offlineEnabled: true,
          offlineFreshnessHours: 72,
          minorRegistrationEnabled: true,
        },
        {
          name: "Gym B Status",
          offlineEnabled: false,
          offlineFreshnessHours: 24,
          minorRegistrationEnabled: false,
        },
      ])
      .returning();

    orgA = a!.id;
    orgB = b!.id;

    await db.insert(staffAssignments).values([
      { organizationId: orgA, accountId: people.adminA!.id, role: "admin" },
      { organizationId: orgA, accountId: people.recepcionA!.id, role: "recepcion" },
      { organizationId: orgB, accountId: people.adminB!.id, role: "admin" },
    ]);
  });

  afterEach(() => {
    if (prevAllowMinor === undefined) {
      delete process.env.ALLOW_MINOR_MEMBERS;
    } else {
      process.env.ALLOW_MINOR_MEMBERS = prevAllowMinor;
    }
  });

  it("CA-1: GET /health y GET /health/ready responden 200 sin autenticación", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });

    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ready", db: "ok" });
  });

  it("CA-1: GET /health/ready responde 503 SERVICE_UNAVAILABLE si la base de datos falla", async () => {
    const brokenDb = {
      execute: async () => {
        throw new Error("connection lost");
      },
    } as unknown as Database;

    const brokenApp = await buildServer({ db: brokenDb });
    const ready = await brokenApp.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(503);
    const body = ready.json();
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    await brokenApp.close();
  });

  it("CA-1 & BDD-1: GET /api/v1/admin/system-status aplica autenticación y rol admin", async () => {
    // 401 sin sesión
    const unauth = await request(null, "GET", "/api/v1/admin/system-status");
    expect(unauth.statusCode).toBe(401);
    expect(unauth.json().error.code).toBe("UNAUTHENTICATED");

    // 403 con rol no-admin (recepción)
    const forbiddenRes = await request("recepcionA", "GET", "/api/v1/admin/system-status");
    expect(forbiddenRes.statusCode).toBe(403);
    expect(forbiddenRes.json().error.code).toBe("FORBIDDEN");
  });

  it("CA-1 & BDD-1: GET /api/v1/admin/system-status consolida controles G2 con aislamiento multi-tenant", async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 60 * 60 * 1000);
    const past = new Date(now.getTime() - 60 * 60 * 1000);

    // Dispositivos para Org A: 2 habilitados, 1 revocado
    await db.insert(devices).values([
      { organizationId: orgA, accountId: people.adminA!.id, label: "Tablet 1", state: "habilitado" },
      { organizationId: orgA, accountId: people.adminA!.id, label: "Tablet 2", state: "habilitado" },
      { organizationId: orgA, accountId: people.adminA!.id, label: "Tablet 3", state: "revocado" },
    ]);

    // Concesiones de soporte para Org A: 1 activa, 1 revocada, 1 expirada
    await db.insert(supportAccessGrants).values([
      {
        organizationId: orgA,
        grantedByAccountId: people.adminA!.id,
        supportEmail: "sup1@example.com",
        reason: "Diagnóstico inicial",
        scope: "diagnostic",
        tokenHash: "hash-active-a",
        expiresAt: future,
        createdAt: now,
      },
      {
        organizationId: orgA,
        grantedByAccountId: people.adminA!.id,
        supportEmail: "sup2@example.com",
        reason: "Concesión revocada",
        scope: "diagnostic",
        tokenHash: "hash-revoked-a",
        expiresAt: future,
        revokedAt: now,
        createdAt: now,
      },
      {
        organizationId: orgA,
        grantedByAccountId: people.adminA!.id,
        supportEmail: "sup3@example.com",
        reason: "Concesión expirada",
        scope: "diagnostic",
        tokenHash: "hash-expired-a",
        expiresAt: past,
        createdAt: past,
      },
    ]);

    // Dispositivos para Org B: 1 habilitado, 0 revocados
    await db.insert(devices).values([
      { organizationId: orgB, accountId: people.adminB!.id, label: "Tablet B1", state: "habilitado" },
    ]);

    // Concesiones para Org B: 2 activas
    await db.insert(supportAccessGrants).values([
      {
        organizationId: orgB,
        grantedByAccountId: people.adminB!.id,
        supportEmail: "supb1@example.com",
        reason: "Soporte B1",
        scope: "read_only",
        tokenHash: "hash-active-b1",
        expiresAt: future,
        createdAt: now,
      },
      {
        organizationId: orgB,
        grantedByAccountId: people.adminB!.id,
        supportEmail: "supb2@example.com",
        reason: "Soporte B2",
        scope: "read_only",
        tokenHash: "hash-active-b2",
        expiresAt: future,
        createdAt: now,
      },
    ]);

    // Consulta Admin A
    const resA = await request("adminA", "GET", "/api/v1/admin/system-status");
    expect(resA.statusCode).toBe(200);
    const bodyA = resA.json();
    expect(SystemStatusResponse.safeParse(bodyA.data).success).toBe(true);

    expect(bodyA.data.organization).toEqual({
      id: orgA,
      name: "Gym A Status",
    });
    expect(bodyA.data.minorPolicy).toEqual({
      enabled: true,
      orgEnabled: true,
      serverLocked: false,
    });
    expect(bodyA.data.emailDelivery).toEqual({
      mode: "disabled",
      passwordReset: false,
      contactVerification: false,
    });
    expect(bodyA.data.offline).toEqual({
      enabled: true,
      freshnessHours: 72,
      enabledDevicesCount: 2,
      revokedDevicesCount: 1,
    });
    expect(bodyA.data.supportAccess).toEqual({
      activeGrantsCount: 1,
    });

    // Consulta Admin B (aislamiento estricto)
    const resB = await request("adminB", "GET", "/api/v1/admin/system-status");
    expect(resB.statusCode).toBe(200);
    const bodyB = resB.json();
    expect(SystemStatusResponse.safeParse(bodyB.data).success).toBe(true);

    expect(bodyB.data.organization).toEqual({
      id: orgB,
      name: "Gym B Status",
    });
    expect(bodyB.data.minorPolicy).toEqual({
      enabled: false,
      orgEnabled: false,
      serverLocked: false,
    });
    expect(bodyB.data.offline).toEqual({
      enabled: false,
      freshnessHours: 24,
      enabledDevicesCount: 1,
      revokedDevicesCount: 0,
    });
    expect(bodyB.data.supportAccess).toEqual({
      activeGrantsCount: 2,
    });
  });

  it("CA-1: GET /api/v1/admin/system-status refleja ALLOW_MINOR_MEMBERS=false y emailDelivery configurado", async () => {
    process.env.ALLOW_MINOR_MEMBERS = "false";
    const dummyEmailDelivery = async () => {};
    const configuredApp = await buildServer({
      db,
      auth,
      emailDelivery: dummyEmailDelivery,
    });

    const res = await configuredApp.inject({
      method: "GET",
      url: "/api/v1/admin/system-status",
      headers: {
        cookie: people.adminA!.cookie,
        origin: "http://localhost:3000",
      },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.minorPolicy).toEqual({
      enabled: false,
      orgEnabled: true,
      serverLocked: true,
    });
    expect(data.emailDelivery).toEqual({
      mode: "configured",
      passwordReset: true,
      contactVerification: true,
    });

    await configuredApp.close();
  });

  it("CA-2: scripts/smoke-prod.sh ejecuta exitosamente contra el servidor HTTP", async () => {
    // Iniciar servidor en puerto libre
    const smokeApp = await buildServer({ db, auth });
    const address = await smokeApp.listen({ port: 0, host: "127.0.0.1" });
    const smokeScript = resolve(ROOT_DIR, "scripts/smoke-prod.sh");

    try {
      const { stdout } = await execFileAsync("bash", [smokeScript], {
        env: {
          ...process.env,
          BASE_URL: address,
        },
        encoding: "utf8",
      });
      expect(stdout).toContain("✓ /health OK");
      expect(stdout).toContain("✓ /health/ready OK");
      expect(stdout).toContain("✓ /api/v1/admin/system-status protegido OK");
      expect(stdout).toContain("Smoke-check de producción completado exitosamente");
    } finally {
      await smokeApp.close();
    }
  });
});
