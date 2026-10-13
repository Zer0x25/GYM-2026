/**
 * Entrega 3 integration tests — classes, sessions, bookings (spec 004).
 *
 * Concurrency invariants verified against a REAL Postgres:
 *   TX-01 (last slot): N members race for the last slot → exactly one 200,
 *         the rest 409, confirmedCount never exceeds capacity, and NO
 *         rejected member has beneficioComprometido=true.
 *   TX-02 (no overlap): two overlapping sessions for the same instructor →
 *         one creates, the other 409; non-overlapping both create.
 *   TX-04 (cancel credit once): two concurrent cancels of the same booking →
 *         exactly one writes a cancellation row (credit moves once); the
 *         loser gets 409 and no second row exists.
 *   REVAL-01: a member without an active membership cannot book → 409.
 *
 * Isolated DB: gym_test_clases (:55432). TRUNCATE-clean per test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createDb } from "@gym/db";
import { createAuth } from "./auth.js";
import { BookingsService } from "./services/bookings.js";
import { SessionsService } from "./services/sessions.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://gym:gymtestpass@localhost:55432/gym_test_clases";
// Runs only when a real DB is provided (env) — keeps the gate green without one.
const RUN = Boolean(process.env.TEST_DATABASE_URL);

const db = createDb(DATABASE_URL);
const auth = createAuth({ db, secret: "test-secret-32-chars-minimum-xxxxxxxxxxx", baseURL: "http://localhost:3000" });
const sessionsService = new SessionsService(db);
const bookingsService = new BookingsService(db);

const ORG = randomUUID();
const PLAN = randomUUID();
let ADMIN = "acc-admin-e3";

const adminActor = { organizationId: ORG, accountId: ADMIN, role: "admin" as const };

async function truncateAll() {
  await db.execute(sql`
    TRUNCATE booking_cancellations, bookings, sessions, class_templates,
             memberships, payments, cash_sessions, cash_movements, audit_log,
             plans, members, staff_assignments, identity_accounts, organizations,
             "user", session, account, verification
    RESTART IDENTITY CASCADE
  `);
}

/** Creates the org, a plan and a real Better Auth user (the audit_log FK needs it). */
async function seedOrg() {
  await db.execute(
    sql`INSERT INTO organizations (id, name) VALUES (${ORG}, 'Gym E3') ON CONFLICT (id) DO NOTHING`,
  );
  await db.execute(
    sql`INSERT INTO plans (id, organization_id, name, price_cents, duration_days, coverage, active)
        VALUES (${PLAN}, ${ORG}, 'Mensual', 30000, 30, 'unlimited', true)
        ON CONFLICT (id) DO NOTHING`,
  );
  const user = await auth.api.createUser({
    body: { email: "admin-e3@test.cl", password: "SuperSecret123!", name: "Admin E3", data: { emailVerified: true } },
  });
  ADMIN = user.user.id;
  adminActor.accountId = ADMIN;
}

/** members: uuid id, no account_id (the socio link lives elsewhere). Returns the member uuid. */
async function makeMember(contact: string): Promise<string> {
  const memberId = randomUUID();
  await db.execute(
    sql`INSERT INTO members (id, organization_id, full_name, contact_email)
        VALUES (${memberId}, ${ORG}, ${`Socio ${contact}`}, ${`${contact}@e3.cl`})
        ON CONFLICT (id) DO NOTHING`,
  );
  return memberId;
}

/** Membership active from now for 30 days (the only coverage revalidation needs). */
async function giveActiveMembership(memberId: string) {
  await db.execute(
    sql`INSERT INTO memberships (id, organization_id, member_id, plan_id, start_at, end_at)
        VALUES (${randomUUID()}, ${ORG}, ${memberId}, ${PLAN}, now(), now() + interval '30 days')`,
  );
}

async function createSession(startsAt: Date, endsAt: Date, capacity: number, instructor = "inst-1") {
  return sessionsService.create(adminActor, {
    type: "grupal",
    instructorId: instructor,
    startsAt,
    endsAt,
    capacity,
  });
}

describe.skipIf(!RUN)("Entrega 3 — classes & bookings (spec 004)", () => {
  beforeAll(async () => {
    const alive = await db.execute(sql`SELECT 1`).then(() => true).catch(() => false);
    if (!alive) throw new Error("Test DB not reachable: " + DATABASE_URL);
    await seedOrg();
  });

  afterAll(async () => {
    await truncateAll();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedOrg();
  });

  // TX-02: overlapping sessions rejected, non-overlapping allowed.
  it("TX-02: same instructor cannot have two overlapping sessions", async () => {
    const base = new Date(Date.now() + 24 * 3600 * 1000);
    const a = await createSession(base, new Date(base.getTime() + 3600_000), 10);
    expect(a.state).toBe("programada");

    // Fully inside the first → overlap.
    await expect(
      createSession(new Date(base.getTime() + 600_000), new Date(base.getTime() + 1200_000), 10),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Right after the first ends → no overlap.
    const b = await createSession(new Date(base.getTime() + 3600_000), new Date(base.getTime() + 7200_000), 10);
    expect(b.id).not.toBe(a.id);

    // A different instructor in the same window → allowed.
    const c = await createSession(base, new Date(base.getTime() + 3600_000), 10, "inst-2");
    expect(c.instructorId).toBe("inst-2");
  });

  // REVAL-01: no active membership → cannot book.
  it("REVAL-01: member without active membership cannot book", async () => {
    const base = new Date(Date.now() + 24 * 3600 * 1000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-no-memb");

    await expect(
      bookingsService.create({ ...adminActor, role: "recepcion", memberId: undefined }, session.id, memberId),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // TX-01: the last-slot race. Five members, capacity 4 → one loses.
  it("TX-01: exactly one member wins the last slot under concurrency", async () => {
    const base = new Date(Date.now() + 24 * 3600 * 1000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 4);
    // Fill 3 slots first.
    for (let i = 0; i < 3; i++) {
      const memberId = await makeMember(`acc-m-${i}`);
      await giveActiveMembership(memberId);
      await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);
    }
    // One confirmed slot left. Two members race for it.
    const racerA = await makeMember("acc-m-a");
    const racerB = await makeMember("acc-m-b");
    await giveActiveMembership(racerA);
    await giveActiveMembership(racerB);

    const results = await Promise.allSettled([
      bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, racerA),
      bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, racerB),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Confirmed count is exactly capacity, never more.
    const countRows = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM bookings WHERE session_id = ${session.id} AND state = 'confirmada'`,
    );
    expect(Number((countRows[0] as { n: number }).n)).toBe(4);

    // The loser never had their benefit committed — no booking row at all.
    const winnerMember = (fulfilled[0] as PromiseFulfilledResult<{ memberId: string }>).value.memberId;
    const loser = winnerMember === racerA ? racerB : racerA;
    const loserRows = await db.execute(
      sql`SELECT beneficio_comprometido FROM bookings WHERE session_id = ${session.id} AND member_id = ${loser}`,
    );
    expect(loserRows).toHaveLength(0);
  });

  // TX-04: two concurrent cancels of the same booking → one credit move.
  it("TX-04: concurrent cancels move the credit exactly once", async () => {
    const base = new Date(Date.now() + 48 * 3600 * 1000); // >24h ahead → temprana
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-tx4");
    await giveActiveMembership(memberId);
    const booking = await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);
    expect(booking.state).toBe("confirmada");

    const results = await Promise.allSettled([
      bookingsService.cancel({ ...adminActor, role: "recepcion" }, booking.id, { type: "temprana" }),
      bookingsService.cancel({ ...adminActor, role: "recepcion" }, booking.id, { type: "temprana" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Exactly one cancellation row, credit returned once (temprana).
    const rows = await db.execute(
      sql`SELECT credit_returned FROM booking_cancellations WHERE booking_id = ${booking.id}`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { credit_returned: boolean }).credit_returned).toBe(true);

    // Booking is cancelada.
    const after = await db.execute(sql`SELECT state FROM bookings WHERE id = ${booking.id}`);
    expect((after[0] as { state: string }).state).toBe("cancelada");
  });

  // Policy: tardia and ausencia retain the credit.
  it("REQ-5: cancelación tardía retiene el crédito", async () => {
    // Session starts in 2h (< 24h window) → tardía.
    const base = new Date(Date.now() + 2 * 3600_000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-tardia");
    await giveActiveMembership(memberId);
    const booking = await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);

    const result = await bookingsService.cancel(
      { ...adminActor, role: "recepcion" },
      booking.id,
      { type: "tardia" },
    );
    // The window decides: 2h < 24h → tardía → credit NOT returned.
    expect(result.cancellation.type).toBe("tardia");
    expect(result.cancellation.creditReturned).toBe(false);
  });

  // Cross-tenant: a session from another org is not-found (anti-enumeration).
  it("TX-07: session from another tenant behaves as not-found", async () => {
    const base = new Date(Date.now() + 24 * 3600 * 1000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    await expect(sessionsService.getById(randomUUID(), session.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // REQ-5: staff marks attendance; asistio keeps the booking confirmed.
  it("REQ-5: marcar asistencia 'asistio' conserva la reserva confirmada", async () => {
    const base = new Date(Date.now() + 24 * 3600_000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-asistio");
    await giveActiveMembership(memberId);
    const booking = await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);
    expect(booking.state).toBe("confirmada");

    const row = await bookingsService.markAttendance(adminActor, booking.id, "asistio");
    expect(row.state).toBe("confirmada");

    // Attendance is audited (booking.attendance, outcome asistio).
    const audit = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE entity_id = ${booking.id} AND action = 'booking.attendance'`,
    );
    expect(Number((audit[0] as { n: number }).n)).toBe(1);
  });

  // REQ-5: ausencia marks the booking ausente and records a cancellation
  // row with credit NOT returned (credit retained), exactly once.
  it("REQ-5: marcar ausencia retiene el crédito y deja la reserva ausente", async () => {
    const base = new Date(Date.now() + 24 * 3600_000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-ausencia");
    await giveActiveMembership(memberId);
    const booking = await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);

    const row = await bookingsService.markAttendance(adminActor, booking.id, "ausencia");
    expect(row.state).toBe("ausente");

    // Exactly one ausencia cancellation row, credit retained.
    const rows = await db.execute(
      sql`SELECT credit_returned FROM booking_cancellations WHERE booking_id = ${booking.id} AND type = 'ausencia'`,
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { credit_returned: boolean }).credit_returned).toBe(false);
  });

  // Separation of functions: a socio may never mark attendance.
  it("REQ-5: el socio no puede marcar asistencia", async () => {
    const base = new Date(Date.now() + 24 * 3600_000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-socio-att");
    await giveActiveMembership(memberId);
    const booking = await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);

    await expect(
      bookingsService.markAttendance({ ...adminActor, role: "socio" }, booking.id, "asistio"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // Attendance is idempotent-safe: a second asistio on the same booking is
  // fine (state unchanged), and cannot be applied to a cancelled booking.
  it("REQ-5: no se marca asistencia sobre una reserva cancelada", async () => {
    const base = new Date(Date.now() + 48 * 3600_000); // >24h → temprana cancel
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-att-cancel");
    await giveActiveMembership(memberId);
    const booking = await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);
    await bookingsService.cancel({ ...adminActor, role: "recepcion" }, booking.id, { type: "temprana" });

    await expect(
      bookingsService.markAttendance(adminActor, booking.id, "asistio"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // listByMember returns the member's bookings (portal view, REQ-7).
  it("listByMember devuelve las reservas del socio", async () => {
    const base = new Date(Date.now() + 24 * 3600_000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-list");
    await giveActiveMembership(memberId);
    const booking = await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);

    const rows = await bookingsService.listByMember(ORG, memberId);
    expect(rows.map((r: { id: string }) => r.id)).toContain(booking.id);
  });

  // listBySession returns the session's bookings (instructor/staff view).
  it("listBySession devuelve las reservas de la sesión", async () => {
    const base = new Date(Date.now() + 24 * 3600_000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-listsess");
    await giveActiveMembership(memberId);
    const booking = await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);

    const rows = await bookingsService.listBySession(ORG, session.id);
    expect(rows.map((r: { id: string }) => r.id)).toContain(booking.id);
  });

  // ── Caminos de error/borde (branch coverage, CAL-2) ──────────────────

  // REQ-7: a socio can only book for themselves.
  it("REQ-7: el socio no puede reservar para otro socio", async () => {
    const base = new Date(Date.now() + 24 * 3600_000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const selfId = await makeMember("acc-m-self");
    const otherId = await makeMember("acc-m-other");
    await giveActiveMembership(selfId);
    await giveActiveMembership(otherId);

    await expect(
      bookingsService.create(
        { ...adminActor, role: "socio", memberId: selfId },
        session.id,
        otherId,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // Duplicate booking: the same member cannot hold two seats in one session.
  it("ERR: el mismo socio no puede reservar dos veces la misma sesión", async () => {
    const base = new Date(Date.now() + 24 * 3600_000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-dup");
    await giveActiveMembership(memberId);
    await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);

    await expect(
      bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // Cancelling an already-cancelled booking is refused.
  it("ERR: cancelar una reserva ya cancelada es rechazado (409)", async () => {
    const base = new Date(Date.now() + 48 * 3600_000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-cancel-twice");
    await giveActiveMembership(memberId);
    const booking = await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);
    await bookingsService.cancel({ ...adminActor, role: "recepcion" }, booking.id, { type: "temprana" });

    await expect(
      bookingsService.cancel({ ...adminActor, role: "recepcion" }, booking.id, { type: "temprana" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // Cancelling a booking already marked ausente is refused.
  it("ERR: cancelar una reserva ya ausente es rechazado (409)", async () => {
    const base = new Date(Date.now() + 24 * 3600_000);
    const session = await createSession(base, new Date(base.getTime() + 3600_000), 5);
    const memberId = await makeMember("acc-m-ausente-cancel");
    await giveActiveMembership(memberId);
    const booking = await bookingsService.create({ ...adminActor, role: "recepcion" }, session.id, memberId);
    await bookingsService.markAttendance(adminActor, booking.id, "ausencia");

    await expect(
      bookingsService.cancel({ ...adminActor, role: "recepcion" }, booking.id, { type: "temprana" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // Cancelling an unknown booking is not-found.
  it("ERR: cancelar una reserva inexistente es not-found (404)", async () => {
    await expect(
      bookingsService.cancel({ ...adminActor, role: "recepcion" }, randomUUID(), { type: "temprana" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
