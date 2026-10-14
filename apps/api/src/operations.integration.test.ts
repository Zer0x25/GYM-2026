import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  createDb,
  organizations,
  authUsers,
  staffAssignments,
  members,
  plans,
  memberships,
  sessions,
  bookings,
  cashSessions,
  cashMovements,
  identityAccounts,
  payments,
} from "@gym/db";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";
import { OperationsService } from "./services/operations.js";
import { MembersService } from "./services/members.js";
import { BookingsService } from "./services/bookings.js";
import { SessionsService } from "./services/sessions.js";
import { OfflineService } from "./services/offline.js";
import { resolveSession } from "./resolve-session.js";
import { CheckinService } from "./services/checkin.js";

const db = createDb(
  process.env.TEST_DATABASE_URL ??
    "postgres://gym:gym-local-dev@localhost:55432/gym_test_operations",
);
const svc = new OperationsService(db);
const checkin = new CheckinService(db);
const org = randomUUID(),
  other = randomUUID(),
  member = randomUUID(),
  plan = randomUUID();
const actor = { organizationId: org, accountId: "admin-op", role: "admin" as const };

describe.skipIf(!process.env.TEST_DATABASE_URL)("SPEC 010 — superficies operativas reales", () => {
  beforeEach(async () => {
    await db.execute(sql`SET client_min_messages TO warning`);
    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, "user" RESTART IDENTITY CASCADE`,
    );
    await db.insert(organizations).values([
      { id: org, name: "Gym A" },
      { id: other, name: "Gym B" },
    ]);
    await db.insert(authUsers).values([
      { id: actor.accountId, name: "Admin", email: "admin@op.test" },
      { id: "coach-op", name: "Ana Entrenadora", email: "coach@op.test" },
      { id: "coach-other", name: "Otro Tenant", email: "other@op.test" },
    ]);
    await db.insert(staffAssignments).values([
      { organizationId: org, accountId: actor.accountId, role: "admin" },
      { organizationId: org, accountId: "coach-op", role: "instructor" },
      { organizationId: other, accountId: "coach-other", role: "instructor" },
    ]);
    await db.insert(members).values({
      id: member,
      organizationId: org,
      fullName: "Socio Uno",
      qrToken: "qr-test-operations",
    });
    await db.insert(plans).values({
      id: plan,
      organizationId: org,
      name: "Mensual",
      priceCents: 30000,
      durationDays: 30,
      coverage: "unlimited",
    });
    await db.insert(memberships).values({
      organizationId: org,
      memberId: member,
      planId: plan,
      startAt: new Date(Date.now() - 3600000),
      endAt: new Date(Date.now() + 86400000),
    });
  });
  it("CA-6 editar contacto conserva cuenta y una coincidencia de email no concede identidad", async () => {
    await db.execute(sql`UPDATE members SET account_id = ${actor.accountId} WHERE id = ${member}`);
    const service = new MembersService(db);
    await service.updateContact(
      { organizationId: org, role: "socio", memberId: member },
      member,
      "contacto@nuevo.test",
    );
    // Staff assignment is removed so this account exercises the socio path.
    await db.execute(sql`DELETE FROM staff_assignments WHERE account_id = ${actor.accountId}`);
    expect(await resolveSession(db, { id: actor.accountId, email: "admin@op.test" })).toMatchObject(
      { role: "socio", memberId: member },
    );
    expect(
      await resolveSession(db, { id: "sin-vinculo", email: "contacto@nuevo.test" }),
    ).toBeUndefined();
  });
  it("CA-1 ficha reúne plan y membresía propia sin exponer token QR", async () => {
    const result = await svc.memberOverview(actor, member);
    expect(result.member.fullName).toBe("Socio Uno");
    expect(result.memberships[0]?.plan?.name).toBe("Mensual");
    expect(result.member).not.toHaveProperty("qrToken");
  });
  it("CA-6 ficha ajena 404 e instructor sin acceso financiero 403", async () => {
    await expect(
      svc.memberOverview({ ...actor, organizationId: other }, member),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      svc.memberOverview({ ...actor, role: "instructor" }, member),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("CA-4 catálogo público de instructores proyecta solo id y nombre del tenant", async () => {
    const result = await svc.instructors(org);
    expect(result).toEqual([{ id: "coach-op", name: "Ana Entrenadora" }]);
  });
  it("CA-4 agenda muestra plazas ocupadas y nombre sin reservas ajenas", async () => {
    const [row] = await db
      .insert(sessions)
      .values({
        organizationId: org,
        type: "cita",
        instructorId: "coach-op",
        startsAt: new Date(Date.now() + 3600000),
        endsAt: new Date(Date.now() + 7200000),
        capacity: 1,
        createdBy: actor.accountId,
      })
      .returning();
    await db.insert(bookings).values({
      organizationId: org,
      sessionId: row!.id,
      memberId: member,
      state: "confirmada",
      beneficioComprometido: true,
      createdBy: actor.accountId,
    });
    const result = await svc.schedule(org);
    expect(result[0]).toMatchObject({ instructorName: "Ana Entrenadora", remaining: 0, booked: 1 });
    expect(result[0]).not.toHaveProperty("memberId");
  });
  it("CA-3 portal resuelve plan propio sin acceder al listado administrativo", async () => {
    const result = await svc.portal({ ...actor, role: "socio", memberId: member });
    expect(result.memberships[0]?.plan?.name).toBe("Mensual");
    expect(result.member.id).toBe(member);
    await expect(svc.portal({ ...actor, role: "socio" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("CA-2 búsqueda manual valida en servidor y feed descarta ingresos de ayer", async () => {
    const result = await checkin.checkinMember(actor, member);
    expect(result.allowed).toBe(true);
    await db.execute(sql`UPDATE audit_log SET created_at = now() - interval '2 days'`);
    expect(await checkin.recentCheckins(actor, 50, true)).toEqual([]);
  });
  it("CA-2 ingreso manual respeta revocación y tenant", async () => {
    await db.execute(sql`UPDATE members SET qr_revoked_at = now() WHERE id = ${member}`);
    expect(await checkin.checkinMember(actor, member)).toMatchObject({ allowed: false });
    await expect(
      checkin.checkinMember({ ...actor, organizationId: other }, member),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("CA-7 permiso 72h firmado y cobro provisional idempotente sin derechos nuevos", async () => {
    const offline = new OfflineService(db, "test-offline-signing-secret-32-characters");
    await offline.setPolicy(actor, true);
    const device = await offline.registerDevice(actor, {
      accountId: actor.accountId,
      label: "Mostrador A",
    });
    const lease = await offline.lease(actor, device.id);
    expect(new Date(lease.expiresAt).getTime() - new Date(lease.issuedAt).getTime()).toBe(
      72 * 3600000,
    );
    const event = {
      eventId: randomUUID(),
      type: "cobro_provisional" as const,
      memberId: member,
      folioExterno: "FOLIO-010-1",
      capturedAt: new Date().toISOString(),
      amountCents: 30000,
      method: "cash" as const,
      payload: JSON.stringify({ permit: lease.permit, proof: lease.members[0]!.proof }),
    };
    const first = await offline.syncLeased(actor, { deviceId: device.id, events: [event] });
    const replay = await offline.syncLeased(actor, { deviceId: device.id, events: [event] });
    expect(replay).toEqual(first);
    const result = await svc.memberOverview(actor, member);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]?.state).toBe("provisional");
  });
  it("CA-7 permiso alterado, operador ajeno y dispositivo revocado se rechazan sin efectos", async () => {
    const offline = new OfflineService(db, "test-offline-signing-secret-32-characters");
    await offline.setPolicy(actor, true);
    const device = await offline.registerDevice(actor, { accountId: actor.accountId, label: "A" });
    const lease = await offline.lease(actor, device.id);
    await expect(
      offline.lease({ ...actor, accountId: "coach-op", role: "instructor" }, device.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ev = {
      eventId: randomUUID(),
      type: "cobro_provisional" as const,
      memberId: member,
      folioExterno: "F-2",
      capturedAt: new Date().toISOString(),
      amountCents: 10,
      method: "cash" as const,
      payload: JSON.stringify({ permit: lease.permit + "x", proof: lease.members[0]!.proof }),
    };
    expect(
      (await offline.syncLeased(actor, { deviceId: device.id, events: [ev] })).results[0]?.status,
    ).toBe("rechazado");
    await offline.revokeDevice(actor, device.id);
    await expect(offline.lease(actor, device.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await offline.syncLeased(actor, {
          deviceId: device.id,
          events: [
            {
              ...ev,
              eventId: randomUUID(),
              payload: JSON.stringify({ permit: lease.permit, proof: lease.members[0]!.proof }),
            },
          ],
        })
      ).results[0]?.status,
    ).toBe("rechazado");
    expect((await svc.memberOverview(actor, member)).payments).toHaveLength(0);
  });
  it("CA-7 snapshot alterado no autoriza ingreso y folios se conservan", async () => {
    const offline = new OfflineService(db, "test-offline-signing-secret-32-characters");
    await offline.setPolicy(actor, true);
    const device = await offline.registerDevice(actor, { accountId: actor.accountId, label: "A" });
    const lease = await offline.lease(actor, device.id);
    const event = {
      eventId: randomUUID(),
      type: "ingreso_contingencia" as const,
      memberId: member,
      folioExterno: "F-ING-1",
      capturedAt: new Date().toISOString(),
      payload: JSON.stringify({ permit: lease.permit, proof: lease.members[0]!.proof }),
    };
    expect(
      (await offline.syncLeased(actor, { deviceId: device.id, events: [event] })).results[0]
        ?.status,
    ).toBe("sincronizado");
    const events = await offline.listEvents(org, device.id);
    expect(events[0]?.folioExterno).toBe("F-ING-1");
    expect((await offline.reconstruct(org, device.id)).chainIntact).toBe(true);
  });

  it("CA-4 TX-02 dos sesiones solapadas concurrentes en agenda vacía: solo una persiste", async () => {
    const service = new SessionsService(db);
    const input = {
      type: "grupal" as const,
      instructorId: "coach-op",
      startsAt: new Date(Date.now() + 3600000),
      endsAt: new Date(Date.now() + 7200000),
      capacity: 10,
    };
    // Real PostgreSQL trigger delays INSERT, forcing both overlap reads to see an empty agenda.
    await db.execute(
      sql`CREATE OR REPLACE FUNCTION gym_test_delay_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER gym_test_delay_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION gym_test_delay_session()`,
    );
    try {
      const results = await Promise.allSettled([
        service.create(actor, input),
        service.create(actor, input),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await svc.schedule(org)).toHaveLength(1);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS gym_test_delay_session ON sessions`);
      await db.execute(sql`DROP FUNCTION IF EXISTS gym_test_delay_session()`);
    }
  });
  it("CA-7 cadena reconstruible con eventos diferentes concurrentes del mismo dispositivo", async () => {
    const offline = new OfflineService(db, "test-offline-signing-secret-32-characters");
    await offline.setPolicy(actor, true);
    const device = await offline.registerDevice(actor, { accountId: actor.accountId, label: "A" });
    const lease = await offline.lease(actor, device.id);
    const make = (folio: string) => ({
      eventId: randomUUID(),
      type: "cobro_provisional" as const,
      memberId: member,
      folioExterno: folio,
      capturedAt: new Date().toISOString(),
      amountCents: 100,
      method: "cash" as const,
      payload: JSON.stringify({ permit: lease.permit, proof: lease.members[0]!.proof }),
    });
    await Promise.all([
      offline.syncLeased(actor, { deviceId: device.id, events: [make("F-A")] }),
      offline.syncLeased(actor, { deviceId: device.id, events: [make("F-B")] }),
    ]);
    expect(await offline.reconstruct(org, device.id)).toMatchObject({
      eventsChecked: 2,
      chainIntact: true,
    });
  });

  it("CA-5 informe diario usa fecha de Santiago y solo dinero validado", async () => {
    const [membership] = await db.select().from(memberships);
    const [cash] = await db
      .insert(cashSessions)
      .values({ organizationId: org, openedBy: actor.accountId, openingCents: 0, state: "open" })
      .returning();
    const [payment] = await db
      .insert(payments)
      .values({
        organizationId: org,
        memberId: member,
        membershipId: membership!.id,
        planId: plan,
        amountCents: 5000,
        method: "cash",
        state: "validated",
        registeredBy: actor.accountId,
      })
      .returning();
    await db.insert(cashMovements).values({
      organizationId: org,
      sessionId: cash!.id,
      paymentId: payment!.id,
      type: "income",
      method: "cash",
      amountCents: 5000,
      createdAt: new Date("2026-10-14T01:00:00Z"),
    });
    expect(await svc.dailyReport(actor, "2026-10-13")).toMatchObject({
      income: 5000,
      cash: 5000,
      transfer: 0,
      movements: 1,
    });
    expect(await svc.dailyReport(actor, "2026-10-14")).toMatchObject({ income: 0, movements: 0 });
    await expect(
      svc.dailyReport({ ...actor, role: "instructor" }, "2026-10-13"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("CA-4 asistencia se recupera de auditoría persistida tras recargar la ficha", async () => {
    const [row] = await db
      .insert(sessions)
      .values({
        organizationId: org,
        type: "grupal",
        instructorId: "coach-op",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 3600000),
        capacity: 10,
        createdBy: actor.accountId,
      })
      .returning();
    const [booking] = await db
      .insert(bookings)
      .values({
        organizationId: org,
        sessionId: row!.id,
        memberId: member,
        state: "confirmada",
        beneficioComprometido: true,
        createdBy: actor.accountId,
      })
      .returning();
    await new BookingsService(db).markAttendance(actor, booking!.id, "asistio");
    expect((await svc.roster(actor, row!.id))[0]).toMatchObject({
      id: booking!.id,
      attendance: "asistio",
    });
  });
  it("CA-6 HTTP rechaza arranque anónimo tras inicialización e ingreso sin permiso firmado", async () => {
    const auth = createAuth({
      db,
      secret: "test-auth-secret-minimum-32-characters",
      baseURL: "http://localhost:3000",
    });
    const account = await auth.api.createUser({
      body: {
        email: "http-ops@test.cl",
        password: "SuperSecret123!",
        name: "HTTP Admin",
        data: { emailVerified: true },
      },
    });
    await db
      .insert(identityAccounts)
      .values({ id: account.user.id, email: "http-ops@test.cl", passwordHash: "better-auth" });
    await db
      .insert(staffAssignments)
      .values({ organizationId: org, accountId: account.user.id, role: "admin" });
    const app = await buildServer({ db, auth });
    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { origin: "http://localhost:3000" },
        payload: { email: "http-ops@test.cl", password: "SuperSecret123!" },
      });
      expect(login.statusCode).toBe(200);
      const raw = login.headers["set-cookie"];
      const cookie = (Array.isArray(raw) ? raw : [raw])
        .filter(Boolean)
        .map((value) => String(value).split(";")[0])
        .join("; ");
      const boot = await app.inject({
        method: "POST",
        url: "/api/v1/organizations",
        payload: { name: "No autorizado" },
      });
      expect(boot.statusCode).toBe(403);
      const offline = new OfflineService(db, "test-offline-signing-secret-32-characters");
      const httpActor = { ...actor, accountId: account.user.id };
      await offline.setPolicy(httpActor, true);
      const device = await offline.registerDevice(httpActor, {
        accountId: account.user.id,
        label: "A",
      });
      const ingress = await app.inject({
        method: "POST",
        url: "/api/v1/offline/ingreso",
        headers: { cookie, origin: "http://localhost:3000" },
        payload: {
          deviceId: device.id,
          memberId: member,
          snapshotCapturedAt: new Date().toISOString(),
          coverage: "unlimited",
        },
      });
      expect(ingress.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
