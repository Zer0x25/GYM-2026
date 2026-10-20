/**
 * Tenant isolation integration tests (spec 002, REQ-1/REQ-7).
 *
 * Requires a real PostgreSQL at TEST_DATABASE_URL (docker run -d --name
 * gym-test-pg -e POSTGRES_USER=gym -e POSTGRES_PASSWORD=gym-local-dev
 * -e POSTGRES_DB=gym_test -p 55432:5432 postgres:16-alpine) with migrations
 * applied. Skipped when the variable is absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  authUsers,
  members,
  organizations,
  identityAccounts,
  staffAssignments,
  type Database,
} from "@gym/db";
import { MembersService } from "./services/members.js";
import { resolveSession } from "./resolve-session.js";
import { ORG_A, ORG_B, SOCIO_A1, SOCIO_A2 } from "./fixtures.js";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("members integration", () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let adminCookie: string;
  let recepCookie: string;
  let adminBCookie: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    await db.execute(
      // truncate our tables for a deterministic fixture
      sql`TRUNCATE organizations, identity_accounts, staff_assignments, members, plans, "user", session, account, verification RESTART IDENTITY CASCADE`,
    );
    await db.insert(organizations).values([
      { id: ORG_A, name: "Gimnasio A" },
      { id: ORG_B, name: "Gimnasio B" },
    ]);
    await db.insert(authUsers).values([
      { id: "member-account-1", name: SOCIO_A1.fullName, email: SOCIO_A1.email },
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: SOCIO_A2.fullName,
        email: SOCIO_A2.email,
      },
      { id: "staff-recepcion", name: "Staff Recepcion", email: "recepcion@gym.test" },
    ]);
    await db.insert(members).values([
      {
        organizationId: ORG_A,
        fullName: SOCIO_A1.fullName,
        contactEmail: SOCIO_A1.email,
        accountId: "member-account-1",
      },
      {
        organizationId: ORG_A,
        fullName: SOCIO_A2.fullName,
        contactEmail: SOCIO_A2.email,
        accountId: "00000000-0000-4000-8000-000000000001",
      },
      { organizationId: ORG_B, fullName: "Socio B Uno", contactEmail: "socio.b1@gym.test" },
    ]);

    const auth = createAuth({
      db,
      secret: "integration-test-secret-not-for-production-000000",
      baseURL: "http://localhost:3000",
    });
    app = await buildServer({ db, auth });
    await app.ready();

    async function signIn(email: string, password = "SuperSecret123!") {
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ email, password }),
        }),
      );
      expect(response.status).toBe(200);
      return response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
    }

    // Staff admin in ORG_A
    const adminUser = await auth.api.createUser({
      body: {
        email: "admin.a.int@gym.test",
        password: "SuperSecret123!",
        name: "Admin Org A",
        data: { emailVerified: true },
      },
    });
    await db.insert(identityAccounts).values({
      id: adminUser.user.id,
      email: "admin.a.int@gym.test",
      passwordHash: "better-auth",
    });
    await db.insert(staffAssignments).values({
      organizationId: ORG_A,
      accountId: adminUser.user.id,
      role: "admin",
    });
    adminCookie = await signIn("admin.a.int@gym.test");

    // Staff recepcion in ORG_A
    const recepUser = await auth.api.createUser({
      body: {
        email: "recep.a.int@gym.test",
        password: "SuperSecret123!",
        name: "Recep Org A",
        data: { emailVerified: true },
      },
    });
    await db.insert(identityAccounts).values({
      id: recepUser.user.id,
      email: "recep.a.int@gym.test",
      passwordHash: "better-auth",
    });
    await db.insert(staffAssignments).values({
      organizationId: ORG_A,
      accountId: recepUser.user.id,
      role: "recepcion",
    });
    recepCookie = await signIn("recep.a.int@gym.test");

    // Staff admin in ORG_B
    const adminBUser = await auth.api.createUser({
      body: {
        email: "admin.b.int@gym.test",
        password: "SuperSecret123!",
        name: "Admin Org B",
        data: { emailVerified: true },
      },
    });
    await db.insert(identityAccounts).values({
      id: adminBUser.user.id,
      email: "admin.b.int@gym.test",
      passwordHash: "better-auth",
    });
    await db.insert(staffAssignments).values({
      organizationId: ORG_B,
      accountId: adminBUser.user.id,
      role: "admin",
    });
    adminBCookie = await signIn("admin.b.int@gym.test");
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.execute(sql`SELECT 1`);
  });

  it("CA-2: an actor of org A cannot fetch a member of org B (404, no data leak)", async () => {
    const service = new MembersService(db);
    const memberB = await db.select().from(members).where(eq(members.organizationId, ORG_B));
    const memberBId = memberB[0]!.id;
    await expect(
      service.getById({ organizationId: ORG_A, role: "admin" }, memberBId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("CA-3: list only returns members of the caller's organization", async () => {
    const service = new MembersService(db);
    const rows = await service.list({ organizationId: ORG_A, role: "admin" });
    expect(rows.every((r) => r.organizationId === ORG_A)).toBe(true);
    expect(rows.length).toBe(2);
  });

  it("CA-3: search filters within the tenant", async () => {
    const service = new MembersService(db);
    const rows = await service.list({ organizationId: ORG_A, role: "admin" }, SOCIO_A1.fullName);
    expect(rows.length).toBe(1);
    expect(rows[0]!.fullName).toBe(SOCIO_A1.fullName);
  });

  it("CA-4: create persists inside the caller's organization", async () => {
    const service = new MembersService(db);
    const row = await service.create(
      { organizationId: ORG_A, role: "admin" },
      { fullName: "Socio Nuevo", contactEmail: "nuevo@a.cl" },
    );
    expect(row.organizationId).toBe(ORG_A);
    const rows = await service.list({ organizationId: ORG_A, role: "admin" });
    expect(rows.some((r) => r.id === row.id)).toBe(true);
  });

  it("CA-4/015: socio must verify a new address; another member → FORBIDDEN", async () => {
    const service = new MembersService(db);
    const rowsA = await service.list({ organizationId: ORG_A, role: "admin" });
    const s1 = rowsA.find((r) => r.contactEmail === SOCIO_A1.email)!;
    const s2 = rowsA.find((r) => r.contactEmail === SOCIO_A2.email)!;
    await expect(
      service.updateContact(
        { organizationId: ORG_A, role: "socio", memberId: s1.id },
        s2.id,
        "x@y.cl",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // SPEC015 deliberately replaces direct self-assignment with proof of possession.
    await expect(
      service.updateContact(
        { organizationId: ORG_A, role: "socio", memberId: s1.id },
        s1.id,
        "socio.a1.nuevo@gym.test",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await service.getById({ organizationId: ORG_A, role: "admin" }, s1.id)).contactEmail,
    ).toBe(SOCIO_A1.email);
  });

  it("CA-1/CA-2: resolveSession scopes by tenant from stored data only", async () => {
    const ctx = await resolveSession(db, { id: "no-importa", email: SOCIO_A1.email });
    expect(ctx).toBeUndefined(); // Email de contacto no concede identidad.
    const own = await resolveSession(db, { id: "member-account-1", email: SOCIO_A1.email });
    expect(own).toMatchObject({ role: "socio", organizationId: ORG_A });
  });

  it("CA-1/CA-2: socio resolution links the session to the member of its org", async () => {
    const ctx = await resolveSession(db, {
      id: "00000000-0000-4000-8000-000000000001",
      email: SOCIO_A2.email,
    });
    expect(ctx?.organizationId).toBe(ORG_A);
    expect(ctx?.role).toBe("socio");
    expect(ctx?.memberId).toBeDefined();
  });

  it("no sauna tables exist in the schema", async () => {
    const drizzle = await import("drizzle-orm");
    const tables = await db.execute(
      drizzle.sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = ((tables as unknown as { rows: { tablename: string }[] }).rows ?? []).map(
      (r) => r.tablename,
    );
    expect(names.some((n) => n.includes("sauna"))).toBe(false);
  });

  it("SPEC 021 BDD-1 & CA-1: alta y edición de menor exige adulto responsable del mismo tenant y valida invariantes", async () => {
    const service = new MembersService(db);
    const rowsA = await service.list({ organizationId: ORG_A, role: "admin" });
    const ana = rowsA.find((r) => r.contactEmail === SOCIO_A1.email)!;
    const memberB = (await db.select().from(members).where(eq(members.organizationId, ORG_B)))[0]!;

    // Falta adulto responsable para menor -> 400
    await expect(
      service.create(
        { organizationId: ORG_A, role: "recepcion" },
        { fullName: "Menor Sin Adulto", isMinor: true },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Adulto de otro tenant -> 404
    await expect(
      service.create(
        { organizationId: ORG_A, role: "recepcion" },
        { fullName: "Menor Otro Tenant", isMinor: true, adultResponsibleId: memberB.id },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Alta válida vinculando a Ana (mismo tenant)
    const menor = await service.create(
      { organizationId: ORG_A, role: "recepcion" },
      { fullName: "Menor Hijo", isMinor: true, adultResponsibleId: ana.id },
    );
    expect(menor.organizationId).toBe(ORG_A);
    expect(menor.adultResponsibleId).toBe(ana.id);
    expect(menor.isMinor).toBe(true);

    // Cadena menor -> menor rechazada con 409 INVALID_ADULT_RESPONSIBLE
    await expect(
      service.create(
        { organizationId: ORG_A, role: "recepcion" },
        { fullName: "Nieto Menor", isMinor: true, adultResponsibleId: menor.id },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Auto-referencia menor -> menor rechazada con 400
    await expect(
      service.update(
        { organizationId: ORG_A, role: "admin" },
        menor.id,
        { adultResponsibleId: menor.id },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Adulto que es responsable de un menor no puede ser marcado como menor (409)
    await expect(
      service.update(
        { organizationId: ORG_A, role: "admin" },
        ana.id,
        { isMinor: true, adultResponsibleId: rowsA.find((r) => r.id !== ana.id)!.id },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("SPEC 021 CA-2: socio menor no puede autogestionar contacto (403); staff sí puede actualizar con auditoría", async () => {
    const service = new MembersService(db);
    const rowsA = await service.list({ organizationId: ORG_A, role: "admin" });
    const ana = rowsA.find((r) => r.contactEmail === SOCIO_A1.email)!;

    const menor = await service.create(
      { organizationId: ORG_A, role: "admin" },
      {
        fullName: "Menor Protegido",
        contactEmail: "menor@gym.test",
        isMinor: true,
        adultResponsibleId: ana.id,
      },
    );

    // Menor en autogestión intenta borrar o modificar contacto -> 403 MINOR_CONTACT_MANAGED_BY_GUARDIAN
    await expect(
      service.updateContact(
        { organizationId: ORG_A, role: "socio", memberId: menor.id },
        menor.id,
        null,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      service.update(
        { organizationId: ORG_A, role: "socio", memberId: menor.id },
        menor.id,
        { contactEmail: null },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Staff sí puede actualizar contacto del menor auditando el cambio
    const updated = await service.updateContact(
      { organizationId: ORG_A, role: "recepcion", accountId: "staff-recepcion" },
      menor.id,
      "tutor-nuevo@gym.test",
    );
    expect(updated.contactEmail).toBe("tutor-nuevo@gym.test");

    // Verificar que existe la fila de auditoría para la modificación de contacto por staff
    const audits = await db.execute(
      sql`SELECT * FROM audit_log WHERE entity_id = ${menor.id} AND action LIKE 'member%'`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("SPEC 025 CA-1: GET/POST /api/v1/members/minor-policy respeta tenant isolation, admin-only y serverLock", async () => {
    // 1. Unauthenticated -> 401
    const unauthRes = await app.inject({
      method: "GET",
      url: "/api/v1/members/minor-policy",
    });
    expect(unauthRes.statusCode).toBe(401);

    // 2. Recepcion can read minor policy (200)
    const recepRead = await app.inject({
      method: "GET",
      url: "/api/v1/members/minor-policy",
      headers: { cookie: recepCookie },
    });
    expect(recepRead.statusCode).toBe(200);
    expect(recepRead.json().data).toEqual({
      enabled: true,
      orgEnabled: true,
      serverLocked: false,
    });

    // 3. Recepcion cannot update minor policy -> 403
    const recepUpdate = await app.inject({
      method: "POST",
      url: "/api/v1/members/minor-policy",
      headers: { cookie: recepCookie },
      payload: { enabled: false },
    });
    expect(recepUpdate.statusCode).toBe(403);

    // 4. Admin A can update minor policy of ORG_A to disabled -> 200
    const adminDisable = await app.inject({
      method: "POST",
      url: "/api/v1/members/minor-policy",
      headers: { cookie: adminCookie },
      payload: { enabled: false },
    });
    expect(adminDisable.statusCode).toBe(200);
    expect(adminDisable.json().data).toEqual({
      enabled: false,
      orgEnabled: false,
      serverLocked: false,
    });

    // 5. Tenant isolation: Admin B of ORG_B still sees minor registration enabled
    const adminBRead = await app.inject({
      method: "GET",
      url: "/api/v1/members/minor-policy",
      headers: { cookie: adminBCookie },
    });
    expect(adminBRead.statusCode).toBe(200);
    expect(adminBRead.json().data).toEqual({
      enabled: true,
      orgEnabled: true,
      serverLocked: false,
    });

    // 6. When disabled in ORG_A, creating a minor in ORG_A fails with 409 MINOR_REGISTRATION_DISABLED
    const service = new MembersService(db);
    const rowsA = await service.list({ organizationId: ORG_A, role: "admin" });
    const ana = rowsA.find((r) => r.contactEmail === SOCIO_A1.email)!;
    await expect(
      service.create(
        { organizationId: ORG_A, role: "recepcion" },
        { fullName: "Menor Bloqueado", isMinor: true, adultResponsibleId: ana.id },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Also via HTTP POST /api/v1/members -> 409
    const httpCreateMinor = await app.inject({
      method: "POST",
      url: "/api/v1/members",
      headers: { cookie: recepCookie },
      payload: {
        fullName: "Menor HTTP Bloqueado",
        isMinor: true,
        adultResponsibleId: ana.id,
      },
    });
    expect(httpCreateMinor.statusCode).toBe(409);
    expect(httpCreateMinor.json().error.code).toBe("CONFLICT");

    // 7. Admin A re-enables minor policy
    const adminEnable = await app.inject({
      method: "POST",
      url: "/api/v1/members/minor-policy",
      headers: { cookie: adminCookie },
      payload: { enabled: true },
    });
    expect(adminEnable.statusCode).toBe(200);
    expect(adminEnable.json().data.enabled).toBe(true);

    // 8. Server lock: ALLOW_MINOR_MEMBERS=false overrides org policy
    const origEnv = process.env.ALLOW_MINOR_MEMBERS;
    try {
      process.env.ALLOW_MINOR_MEMBERS = "false";

      // GET reflects serverLocked: true, enabled: false
      const lockedRead = await app.inject({
        method: "GET",
        url: "/api/v1/members/minor-policy",
        headers: { cookie: adminCookie },
      });
      expect(lockedRead.statusCode).toBe(200);
      expect(lockedRead.json().data).toEqual({
        enabled: false,
        orgEnabled: true,
        serverLocked: true,
      });

      // POST to enable returns 409 MINOR_REGISTRATION_DISABLED
      const lockedPost = await app.inject({
        method: "POST",
        url: "/api/v1/members/minor-policy",
        headers: { cookie: adminCookie },
        payload: { enabled: true },
      });
      expect(lockedPost.statusCode).toBe(409);

      // Attempting to register minor when server locked fails with 409
      await expect(
        service.create(
          { organizationId: ORG_A, role: "recepcion" },
          { fullName: "Menor Server Lock", isMinor: true, adultResponsibleId: ana.id },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      if (origEnv === undefined) {
        delete process.env.ALLOW_MINOR_MEMBERS;
      } else {
        process.env.ALLOW_MINOR_MEMBERS = origEnv;
      }
    }
  });

  it("SPEC 025 CA-2 & BDD-1: consentimiento documental D-05 (guardianConsentRef), sellado guardianConsentAt, proyección y limpieza al pasar a adulto", async () => {
    const service = new MembersService(db);
    const rowsA = await service.list({ organizationId: ORG_A, role: "admin" });
    const ana = rowsA.find((r) => r.contactEmail === SOCIO_A1.email)!;

    // 1. Alta de menor con adultResponsibleId y guardianConsentRef="ACTA-MENOR-101"
    const menor = await service.create(
      { organizationId: ORG_A, role: "recepcion", accountId: "staff-recepcion" },
      {
        fullName: "Menor Con Consentimiento",
        contactEmail: "menor.consentimiento@gym.test",
        isMinor: true,
        adultResponsibleId: ana.id,
        guardianConsentRef: "ACTA-MENOR-101",
      },
    );

    expect(menor.isMinor).toBe(true);
    expect(menor.adultResponsibleId).toBe(ana.id);
    expect(menor.guardianConsentRef).toBe("ACTA-MENOR-101");
    expect(menor.guardianConsentAt).toBeInstanceOf(Date);

    // 2. Auditoría registrada en audit_log para member.minor_consent.recorded
    const auditRows = await db.execute(
      sql`SELECT * FROM audit_log WHERE entity_id = ${menor.id} AND action = 'member.minor_consent.recorded'`,
    );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const rawMeta = (auditRows[0] as unknown as { metadata: string | null }).metadata;
    const auditMeta = JSON.parse(rawMeta ?? "{}") as {
      guardianConsentRef?: string;
      adultResponsibleId?: string;
    };
    expect(auditMeta.guardianConsentRef).toBe("ACTA-MENOR-101");
    expect(auditMeta.adultResponsibleId).toBe(ana.id);

    // 3. Proyección en MemberDetail / overview HTTP endpoint
    const overviewRes = await app.inject({
      method: "GET",
      url: `/api/v1/members/${menor.id}/overview`,
      headers: { cookie: adminCookie },
    });
    expect(overviewRes.statusCode).toBe(200);
    const overviewData = overviewRes.json().data;
    expect(overviewData.member.id).toBe(menor.id);
    expect(overviewData.member.guardianConsentRef).toBe("ACTA-MENOR-101");
    expect(overviewData.member.guardianConsentAt).toBeDefined();

    const memberGetRes = await app.inject({
      method: "GET",
      url: `/api/v1/members/${menor.id}`,
      headers: { cookie: adminCookie },
    });
    expect(memberGetRes.statusCode).toBe(200);
    const memberData = memberGetRes.json().data;
    expect(memberData.id).toBe(menor.id);
    expect(memberData.guardianConsentRef).toBe("ACTA-MENOR-101");
    expect(memberData.guardianConsentAt).toBeDefined();

    // 4. Edición de guardianConsentRef a "ACTA-MENOR-102"
    const updated = await service.update(
      { organizationId: ORG_A, role: "recepcion", accountId: "staff-recepcion" },
      menor.id,
      { guardianConsentRef: "ACTA-MENOR-102" },
    );
    expect(updated.guardianConsentRef).toBe("ACTA-MENOR-102");
    expect(updated.guardianConsentAt).toBeInstanceOf(Date);

    // 5. Transición a adulto (isMinor: false): limpia adultResponsibleId, guardianConsentRef y guardianConsentAt
    const adultUpdated = await service.update(
      { organizationId: ORG_A, role: "recepcion", accountId: "staff-recepcion" },
      menor.id,
      { isMinor: false },
    );
    expect(adultUpdated.isMinor).toBe(false);
    expect(adultUpdated.adultResponsibleId).toBeNull();
    expect(adultUpdated.guardianConsentRef).toBeNull();
    expect(adultUpdated.guardianConsentAt).toBeNull();

    // Verificación directa en base de datos via getById
    const fetched = await service.getById({ organizationId: ORG_A, role: "admin" }, menor.id);
    expect(fetched.isMinor).toBe(false);
    expect(fetched.adultResponsibleId).toBeNull();
    expect(fetched.guardianConsentRef).toBeNull();
    expect(fetched.guardianConsentAt).toBeNull();
  });

});
