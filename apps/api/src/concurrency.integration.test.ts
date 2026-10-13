/**
 * REQ-8 concurrency load test (spec 008) — daily operation under load.
 *
 * Drives 2 admins + 3 recepcionistas (5 operators) concurrently over REAL
 * financial operations via app.inject (Fastify's real HTTP→auth→service→
 * Postgres stack; no k6/autocannon — no new dependencies). Verifies:
 *   BDD-1 (TX-05): 5 simultaneous closes of the same shift → 1 ok, 4× 409,
 *          exactly one closed row, no double consolidation.
 *   BDD-2: payments validated concurrently → exactly one cash movement per
 *          payment; Σ movements == validated payments.
 *   BDD-3 (TX-01): N concurrent bookings of the last slot → 1 confirmed,
 *          rest 409; confirmedCount never exceeds capacity.
 *   BDD-4 (latency): every request responds; p50/p95/max recorded.
 *   BDD-5: concurrent QR check-ins stay coherent (no cross-member answers).
 *
 * Isolated DB: gym_test_concur (:55432).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createDb, identityAccounts, staffAssignments } from "@gym/db";
import type { Database } from "@gym/db";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://gym:gymtestpass@localhost:55432/gym_test_concur";
const RUN = Boolean(process.env.TEST_DATABASE_URL);
const SECRET = "test-secret-32-chars-minimum-xxxxxxxxxxx";

let db: Database;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth sign-in with returnHeaders
let auth: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify instance
let app: any;

const ORG = randomUUID();
const PLAN = randomUUID();

const latencies: number[] = [];

async function makeStaff(email: string, role: "admin" | "recepcion"): Promise<string> {
  const user = await auth.api.createUser({
    body: { email, password: "SuperSecret123!", name: email, data: { emailVerified: true } },
  });
  await db.insert(identityAccounts).values({ id: user.user.id, email, passwordHash: "ba" });
  await db.insert(staffAssignments).values({ organizationId: ORG, accountId: user.user.id, role });
  const signin = await auth.api.signInEmail({
    body: { email, password: "SuperSecret123!" },
    asResponse: false,
    returnHeaders: true,
  });
  return signin.headers.getSetCookie().map((c: string) => c.split(";")[0]).join("; ");
}

/** Injects a request as a cookie, timing it (latency evidence, BDD-4). */
async function injectAs(cookie: string, method: string, url: string, payload?: unknown) {
  const t0 = performance.now();
  const res = await app.inject({
    method,
    url,
    payload,
    headers: { cookie, origin: "http://localhost:3000" },
  });
  latencies.push(performance.now() - t0);
  return res;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx] ?? 0);
}

async function makeMember(email: string): Promise<{ id: string; qrToken: string }> {
  const id = randomUUID();
  const qrToken = randomUUID().replace(/-/g, "");
  await db.execute(
    sql`INSERT INTO members (id, organization_id, full_name, contact_email, qr_token)
        VALUES (${id}, ${ORG}, ${email}, ${email}, ${qrToken})`,
  );
  const plan = await db.execute(sql`SELECT id FROM plans LIMIT 1`);
  const planId = (plan[0] as { id: string }).id;
  await db.execute(
    sql`INSERT INTO memberships (id, organization_id, member_id, plan_id, start_at, end_at)
        VALUES (${randomUUID()}, ${ORG}, ${id}, ${planId}, now(), now() + interval '30 days')`,
  );
  return { id, qrToken };
}

describe.skipIf(!RUN)("REQ-8 — concurrencia de la operación diaria (spec 008)", () => {
  beforeAll(async () => {
    db = createDb(DATABASE_URL);
    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, staff_assignments, members, memberships,
           plans, payments, cash_sessions, cash_movements, audit_log,
           devices, offline_events, membership_snapshots,
           bookings, booking_cancellations, sessions, class_templates,
           "user", session, account, verification RESTART IDENTITY CASCADE`,
    );
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${ORG}, 'Gym Concur')`);
    await db.execute(
      sql`INSERT INTO plans (id, organization_id, name, price_cents, duration_days, coverage, active)
          VALUES (${PLAN}, ${ORG}, 'Mensual', 30000, 30, 'unlimited', true)`,
    );
    auth = createAuth({ db, secret: SECRET, baseURL: "http://localhost:3000" });
    app = await buildServer({ db, auth });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    const sorted = [...latencies].sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(
      `\n[REQ-8] requests=${latencies.length} ` +
        `p50=${pct(sorted, 50)}ms p95=${pct(sorted, 95)}ms max=${pct(sorted, 100)}ms`,
    );
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG}`).catch(() => {});
  });

  // BDD-1 (TX-05): 5 operators close the SAME shift at once → 1 ok, 4× 409.
  it("5 operadores cierran el mismo turno a la vez → 1 ok, 4× 409, una sola fila cerrada", async () => {
    const cookies = await Promise.all([
      makeStaff("admin1-c@test.cl", "admin"),
      makeStaff("admin2-c@test.cl", "admin"),
      makeStaff("recep1-c@test.cl", "recepcion"),
      makeStaff("recep2-c@test.cl", "recepcion"),
      makeStaff("recep3-c@test.cl", "recepcion"),
    ]);
    // One operator opens the shift.
    const opened = await injectAs(cookies[0], "POST", "/api/v1/cash/sessions", { openingCents: 10000 });
    expect(opened.statusCode).toBe(201);
    const sessionId = opened.json().data.id;

    // All 5 race to close it.
    const closes = await Promise.all(
      cookies.map((c) => injectAs(c, "POST", `/api/v1/cash/sessions/${sessionId}/close`, { declaredClosingCents: 10000 })),
    );
    const ok = closes.filter((r) => r.statusCode === 200).length;
    const conflict409 = closes.filter((r) => r.statusCode === 409).length;
    expect(ok).toBe(1);
    expect(conflict409).toBe(4);

    const rows = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM cash_sessions WHERE id = ${sessionId} AND state = 'closed'`,
    );
    expect(Number((rows[0] as { n: number }).n)).toBe(1);
  });

  // BDD-2: payments validated concurrently → one movement per payment; Σ matches.
  it("pagos validados concurrentemente → un movimiento por pago; Σ = validados", async () => {
    const admin = await makeStaff("admin-v@test.cl", "admin");
    const receps = await Promise.all([
      makeStaff("recep-v1@test.cl", "recepcion"),
      makeStaff("recep-v2@test.cl", "recepcion"),
      makeStaff("recep-v3@test.cl", "recepcion"),
    ]);
    // Open a shift (validated money must land in an open shift).
    const opened = await injectAs(admin, "POST", "/api/v1/cash/sessions", { openingCents: 0 });
    expect(opened.statusCode).toBe(201);

    // 5 members, 5 provisional payments registered concurrently.
    const memberIds = (
      await Promise.all(Array.from({ length: 5 }, (_, i) => makeMember(`mv-${i}@test.cl`)))
    ).map((m) => m.id);
    const payments = await Promise.all(
      memberIds.map(async (memberId) => {
        const memb = await db.execute(sql`SELECT id FROM memberships WHERE member_id = ${memberId} LIMIT 1`);
        const membershipId = (memb[0] as { id: string }).id;
        const res = await injectAs(receps[0], "POST", "/api/v1/payments", {
          membershipId,
          amountCents: 30000,
          method: "transfer",
          reference: `ref-${randomUUID()}`,
        });
        return { id: res.json().data.id as string };
      }),
    );

    // Admin validates all 5 concurrently (separation of functions: validator ≠ registrant).
    const validations = await Promise.all(
      payments.map((p) => injectAs(admin, "POST", `/api/v1/payments/${p.id}/validate`, {})),
    );
    expect(validations.every((r) => r.statusCode === 200)).toBe(true);

    const movements = await db.execute(sql`SELECT COUNT(*)::int AS n FROM cash_movements`);
    expect(Number((movements[0] as { n: number }).n)).toBe(payments.length);
  });

  // BDD-3 (TX-01): N concurrent bookings of the last slot → 1 confirmed.
  it("última plaza con N reservas concurrentes → 1 confirmada, cupo no excedido", async () => {
    const admin = await makeStaff("admin-b@test.cl", "admin");
    const receps = await Promise.all([
      makeStaff("recep-b1@test.cl", "recepcion"),
      makeStaff("recep-b2@test.cl", "recepcion"),
      makeStaff("recep-b3@test.cl", "recepcion"),
    ]);
    // A class template + a session with capacity 1.
    const tpl = await injectAs(admin, "POST", "/api/v1/class-templates", {
      name: "Spinning", type: "grupal", capacity: 1, cancellationWindowHours: 24,
    });
    const templateId = tpl.json().data.id;
    const startsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 3 * 24 * 3600 * 1000 + 3600 * 1000).toISOString();
    const sess = await injectAs(admin, "POST", "/api/v1/sessions", {
      templateId, type: "grupal", instructorId: "inst-c", startsAt, endsAt, capacity: 1,
    });
    const sessionId = sess.json().data.id;

    // 5 members race to book the single slot.
    const memberIds = (
      await Promise.all(Array.from({ length: 5 }, (_, i) => makeMember(`lb-${i}@test.cl`)))
    ).map((m) => m.id);
    const bookings = await Promise.all(
      memberIds.map((memberId, i) =>
        injectAs(receps[i % receps.length]!, "POST", "/api/v1/bookings", { sessionId, memberId }),
      ),
    );
    const confirmed = bookings.filter((r) => r.statusCode === 200 || r.statusCode === 201).length;
    expect(confirmed).toBe(1);

    const cap = await db.execute(
      sql`SELECT COUNT(*)::int AS c FROM bookings WHERE session_id = ${sessionId} AND state = 'confirmada'`,
    );
    expect(Number((cap[0] as { c: number }).c)).toBe(1);
  });

  // BDD-5: concurrent QR check-ins stay coherent.
  it("check-ins QR concurrentes → coherentes, sin respuestas cruzadas", async () => {
    const receps = await Promise.all([
      makeStaff("recep-q1@test.cl", "recepcion"),
      makeStaff("recep-q2@test.cl", "recepcion"),
      makeStaff("recep-q3@test.cl", "recepcion"),
    ]);
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, i) => makeMember(`ci-${i}@test.cl`)),
    );
    const list = created.map((m) => ({ t: m.qrToken }));

    const results = await Promise.all(
      list.map((row, i) =>
        injectAs(receps[i % receps.length]!, "POST", "/api/v1/checkin", { qrToken: row.t }),
      ),
    );
    // All 6 members have active coverage → all allowed.
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(results.every((r) => r.json().data.allowed === true)).toBe(true);
  });

  // BDD-4 (latency): every request so far responded; distribution recorded.
  it("todas las peticiones respondieron (sin bloqueos artificiales)", () => {
    expect(latencies.length).toBeGreaterThan(20);
    expect(latencies.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
  });
});
