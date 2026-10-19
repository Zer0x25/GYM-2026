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
import { createDb, authUsers, members, organizations, type Database } from "@gym/db";
import { MembersService } from "./services/members.js";
import { resolveSession } from "./resolve-session.js";
import { ORG_A, ORG_B, SOCIO_A1, SOCIO_A2 } from "./fixtures.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("members integration", () => {
  let db: Database;

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    await db.execute(
      // truncate our tables for a deterministic fixture
      sql`TRUNCATE organizations, identity_accounts, staff_assignments, members, plans, "user" RESTART IDENTITY CASCADE`,
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
  });

  afterAll(async () => {
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

});
