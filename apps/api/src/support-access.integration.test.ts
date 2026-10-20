/**
 * Spec 026 — Acceso temporal de soporte (D-06) con expiración estricta,
 * autorización del administrador y auditoría inmutable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  createDb,
  organizations,
  identityAccounts,
  staffAssignments,
  members,
  plans,
  memberships,
  cashSessions,
  auditLog,
  supportAccessGrants,
  type Database,
} from "@gym/db";
import { createAuth } from "./auth.js";
import { buildServer } from "./app.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("Spec 026 — Acceso temporal de soporte D-06 (CA-1, CA-2)", () => {
  let db: Database;
  let auth: ReturnType<typeof createAuth>;
  let app: Awaited<ReturnType<typeof buildServer>>;
  const people: Record<string, { id: string; cookie: string }> = {};

  let orgA: string;
  let orgB: string;

  const request = (
    person: string,
    method: "GET" | "POST",
    path: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url: `/api/v1/${path}`,
      ...(payload === undefined ? {} : { payload }),
      headers: {
        cookie: people[person]?.cookie ?? "",
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
      const email = `${name}@support-test.cl`;
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

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE support_access_grants, audit_log, cash_movements, cash_sessions, payments, memberships, plans, members, staff_assignments, organizations RESTART IDENTITY CASCADE`,
    );

    const [a, b] = await db
      .insert(organizations)
      .values([
        { name: "Gym A Soporte", offlineEnabled: true, offlineFreshnessHours: 72 },
        { name: "Gym B Soporte", offlineEnabled: false, offlineFreshnessHours: 24 },
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

  afterAll(async () => {
    await app?.close();
  });

  it("CA-1: Solo admin crea, lista y revoca concesiones de soporte; almacena solo tokenHash SHA-256; rechaza cross-tenant con 404", async () => {
    // 1. Recepcion intenta crear concesión -> 403 FORBIDDEN
    const forbiddenCreate = await request("recepcionA", "POST", "admin/support-grants", {
      supportEmail: "soporte@central.cl",
      reason: "Revisión técnica no autorizada",
      durationMinutes: 60,
    });
    expect(forbiddenCreate.statusCode).toBe(403);

    // 2. Admin crea concesión válida -> 201 CREATED
    const createRes = await request("adminA", "POST", "admin/support-grants", {
      supportEmail: "soporte@central.cl",
      reason: "Diagnóstico de sincronización offline y cola de eventos",
      durationMinutes: 120,
      scope: "diagnostic",
    });
    expect(createRes.statusCode).toBe(201);
    const createdData = createRes.json().data as {
      grant: {
        id: string;
        organizationId: string;
        supportEmail: string;
        reason: string;
        scope: string;
        tokenHash: string;
        expiresAt: string;
        revokedAt: string | null;
      };
      token: string;
    };

    expect(createdData.grant.id).toBeDefined();
    expect(createdData.grant.organizationId).toBe(orgA);
    expect(createdData.grant.supportEmail).toBe("soporte@central.cl");
    expect(createdData.grant.scope).toBe("diagnostic");
    expect(createdData.token).toBeDefined();
    expect(createdData.token.length).toBeGreaterThanOrEqual(32);

    // Verificación de almacenamiento: solo token_hash SHA-256 en la base de datos
    const expectedHash = createHash("sha256").update(createdData.token).digest("hex");
    expect(createdData.grant.tokenHash).toBe(expectedHash);

    const dbRows = await db.select().from(supportAccessGrants);
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]?.tokenHash).toBe(expectedHash);
    // Jamás se persiste el token en claro
    expect(JSON.stringify(dbRows[0])).not.toContain(createdData.token);

    // Verificación de auditoría de creación
    const createAudit = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.action} = 'support.grant.create'`);
    expect(createAudit).toHaveLength(1);
    expect(createAudit[0]?.organizationId).toBe(orgA);
    expect(createAudit[0]?.actorId).toBe(people.adminA!.id);
    expect(createAudit[0]?.actorRole).toBe("admin");
    expect(createAudit[0]?.entityId).toBe(createdData.grant.id);

    // 3. Recepcion intenta listar concesiones -> 403 FORBIDDEN
    const forbiddenList = await request("recepcionA", "GET", "admin/support-grants");
    expect(forbiddenList.statusCode).toBe(403);

    // 4. Admin A lista concesiones -> 200 con la concesión
    const listRes = await request("adminA", "GET", "admin/support-grants");
    expect(listRes.statusCode).toBe(200);
    const listData = listRes.json().data as { id: string }[];
    expect(listData).toHaveLength(1);
    expect(listData[0]?.id).toBe(createdData.grant.id);

    // 5. Admin B (cross-tenant) intenta revocar la concesión de Gimnasio A -> 404 NOT_FOUND
    const crossRevoke = await request(
      "adminB",
      "POST",
      `admin/support-grants/${createdData.grant.id}/revoke`,
    );
    expect(crossRevoke.statusCode).toBe(404);

    // 6. Recepcion intenta revocar -> 403 FORBIDDEN
    const forbiddenRevoke = await request(
      "recepcionA",
      "POST",
      `admin/support-grants/${createdData.grant.id}/revoke`,
    );
    expect(forbiddenRevoke.statusCode).toBe(403);

    // 7. Admin A revoca la concesión -> 200 OK con revokedAt sellado
    const revokeRes = await request(
      "adminA",
      "POST",
      `admin/support-grants/${createdData.grant.id}/revoke`,
    );
    expect(revokeRes.statusCode).toBe(200);
    const revokedGrant = revokeRes.json().data.grant;
    expect(revokedGrant.revokedAt).not.toBeNull();
    expect(revokedGrant.revokedByAccountId).toBe(people.adminA!.id);

    // Auditoría de revocación inmutable
    const revokeAudit = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.action} = 'support.grant.revoke'`);
    expect(revokeAudit).toHaveLength(1);
    expect(revokeAudit[0]?.entityId).toBe(createdData.grant.id);
  });

  it("CA-2: GET /api/v1/support/diagnostic-summary exige x-support-grant-token, rechaza expirado/revocado con 401, audita y no filtra secretos ni PII", async () => {
    // Preparar datos de prueba en Gym A: miembro, plan, membresía, sesión de caja
    const [member] = await db
      .insert(members)
      .values({
        organizationId: orgA,
        fullName: "Socio Confidencial",
        contactEmail: "secreto@socio.cl",
      })
      .returning();

    const [plan] = await db
      .insert(plans)
      .values({
        organizationId: orgA,
        name: "Plan Anual",
        priceCents: 120000,
        durationDays: 365,
        coverage: "unlimited",
      })
      .returning();

    await db.insert(memberships).values({
      organizationId: orgA,
      memberId: member!.id,
      planId: plan!.id,
    });

    await db.insert(cashSessions).values({
      organizationId: orgA,
      openedBy: people.adminA!.id,
      openedAt: new Date(),
      openingCents: 50000,
      state: "open",
    });

    // Crear grant para soporte
    const createRes = await request("adminA", "POST", "admin/support-grants", {
      supportEmail: "soporte-tecnico@gym.cl",
      reason: "Auditoría de integridad operativa",
      durationMinutes: 30,
      scope: "diagnostic",
    });
    expect(createRes.statusCode).toBe(201);
    const { grant, token } = createRes.json().data as {
      grant: { id: string };
      token: string;
    };

    // 1. Invocación sin cabecera -> 401 UNAUTHENTICATED
    const noHeader = await app.inject({
      method: "GET",
      url: "/api/v1/support/diagnostic-summary",
    });
    expect(noHeader.statusCode).toBe(401);

    // 2. Invocación con token inventado/erróneo -> 401 UNAUTHENTICATED
    const wrongToken = await app.inject({
      method: "GET",
      url: "/api/v1/support/diagnostic-summary",
      headers: { "x-support-grant-token": "token-ficticio-no-existente-1234567890" },
    });
    expect(wrongToken.statusCode).toBe(401);

    // 3. Invocación exitosa con token legítimo -> 200 OK
    const okRes = await app.inject({
      method: "GET",
      url: "/api/v1/support/diagnostic-summary",
      headers: { "x-support-grant-token": token },
    });
    expect(okRes.statusCode).toBe(200);
    const summary = okRes.json().data;

    // Estructura y datos operativos esperados
    expect(summary.organization.id).toBe(orgA);
    expect(summary.organization.name).toBe("Gym A Soporte");
    expect(summary.counts.members).toBe(1);
    expect(summary.counts.activePlans).toBe(1);
    expect(summary.counts.memberships).toBe(1);
    expect(summary.cashSession.state).toBe("open");
    expect(summary.offlinePolicy.enabled).toBe(true);
    expect(summary.offlinePolicy.freshnessHours).toBe(72);
    expect(summary.grant.supportEmail).toBe("soporte-tecnico@gym.cl");

    // Prohibición de fuga de PII o secretos
    const rawPayload = okRes.body;
    expect(rawPayload).not.toContain("Socio Confidencial");
    expect(rawPayload).not.toContain("secreto@socio.cl");
    expect(rawPayload).not.toContain("password");
    expect(rawPayload).not.toContain("qrToken");

    // Sello de lastUsedAt y auditoría inmutable support.diagnostic.read
    const updatedGrant = await db
      .select()
      .from(supportAccessGrants)
      .where(sql`${supportAccessGrants.id} = ${grant.id}`);
    expect(updatedGrant[0]?.lastUsedAt).not.toBeNull();

    const readAudit = await db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.action} = 'support.diagnostic.read'`);
    expect(readAudit).toHaveLength(1);
    expect(readAudit[0]?.organizationId).toBe(orgA);
    expect(readAudit[0]?.entityId).toBe(grant.id);

    // 4. Token expirado -> 401 UNAUTHENTICATED
    await db
      .update(supportAccessGrants)
      .set({ expiresAt: new Date(Date.now() - 60000) })
      .where(sql`${supportAccessGrants.id} = ${grant.id}`);

    const expiredRes = await app.inject({
      method: "GET",
      url: "/api/v1/support/diagnostic-summary",
      headers: { "x-support-grant-token": token },
    });
    expect(expiredRes.statusCode).toBe(401);

    // 5. Token revocado -> 401 UNAUTHENTICATED
    // Restaurar vigencia pero marcar revocado
    await db
      .update(supportAccessGrants)
      .set({
        expiresAt: new Date(Date.now() + 3600000),
        revokedAt: new Date(),
        revokedByAccountId: people.adminA!.id,
      })
      .where(sql`${supportAccessGrants.id} = ${grant.id}`);

    const revokedRes = await app.inject({
      method: "GET",
      url: "/api/v1/support/diagnostic-summary",
      headers: { "x-support-grant-token": token },
    });
    expect(revokedRes.statusCode).toBe(401);
  });
});
