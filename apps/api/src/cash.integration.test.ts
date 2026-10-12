/**
 * Cash integration test (spec 003, REQ-3).
 *
 * Against a REAL PostgreSQL (TEST_DATABASE_URL). Skipped when absent.
 *
 * Verifies:
 *   - only one open session per organization (CB-1)
 *   - closing is idempotent under concurrency: two simultaneous closes of
 *     the same session yield exactly one 200 and one 409 (CB-2, TX-05)
 *   - the expected closing amount = opening + Σ validated movements (CB-3)
 *   - the discrepancy (declared − expected) is recorded, never blocking (CB-4)
 *   - movements are only created by payment validation, never manually (CB-5)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createDb,
  identityAccounts,
  members,
  organizations,
  plans,
  staffAssignments,
} from "@gym/db";
import type { Database } from "@gym/db";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://gym:gymtestpass@localhost:55432/gym_test_cash";
const SECRET = "integration-test-secret-not-for-production-000000";

describe.skipIf(!process.env.TEST_DATABASE_URL)("cash integration (spec 003, REQ-3)", () => {
  let db: Database;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify instance
  let app: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth
  let auth: any;
  let adminCookie: string;
  let recepcionCookie: string;
  let orgId: string;
  let memberId: string;
  let planId: string;

  async function makeStaff(email: string, role: "admin" | "recepcion") {
    const user = await auth.api.createUser({
      body: { email, password: "SuperSecret123!", name: email, data: { emailVerified: true } },
    });
    await db.insert(identityAccounts).values({ id: user.user.id, email, passwordHash: "ba" });
    await db
      .insert(staffAssignments)
      .values({ organizationId: orgId, accountId: user.user.id, role });
    const res = await auth.api.signInEmail({
      body: { email, password: "SuperSecret123!" },
      asResponse: false,
      returnHeaders: true,
    });
    return res.headers.getSetCookie().map((c: string) => c.split(";")[0]).join("; ");
  }

  const injectAs = (cookie: string, method: string, url: string, payload?: unknown) =>
    app.inject({ method, url, payload, headers: { cookie, origin: "http://localhost:3000" } });

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, staff_assignments, members, memberships, plans, payments, cash_sessions, cash_movements, audit_log, "user", session, account, verification RESTART IDENTITY CASCADE`,
    );
    auth = createAuth({ db, secret: SECRET, baseURL: "http://localhost:3000" });
    app = await buildServer({ db, auth });
    await app.ready();

    const [org] = await db.insert(organizations).values({ name: "Gym Cash" }).returning();
    orgId = org!.id;
    adminCookie = await makeStaff("admin.cash@test.cl", "admin");
    recepcionCookie = await makeStaff("recepcion.cash@test.cl", "recepcion");

    const [member] = await db
      .insert(members)
      .values({ organizationId: orgId, fullName: "Socio C", contactEmail: "socio.c@test.cl" })
      .returning();
    memberId = member!.id;
    const [plan] = await db
      .insert(plans)
      .values({
        organizationId: orgId,
        name: "Mensual",
        priceCents: 25000,
        durationDays: 30,
        coverage: "unlimited",
      })
      .returning();
    planId = plan!.id;
  });

  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql`SELECT 1`);
  });

  /** Helper: full validated payment cycle (registers by recepción, validates by admin). */
  async function validatedPayment(amountCents: number): Promise<string> {
    const m = await injectAs(adminCookie, "POST", "/api/v1/memberships", {
      memberId,
      planId,
    });
    const p = await injectAs(recepcionCookie, "POST", "/api/v1/payments", {
      membershipId: m.json().data.id,
      amountCents,
      method: "cash",
    });
    const v = await injectAs(adminCookie, "POST", `/api/v1/payments/${p.json().data.id}/validate`);
    expect(v.statusCode).toBe(200);
    return v.json().data.id;
  }

  it("CB-1: only one open session per organization at a time", async () => {
    const open = await injectAs(adminCookie, "POST", "/api/v1/cash/sessions", {
      openingCents: 10000,
    });
    expect(open.statusCode).toBe(201);

    // A second open attempt is refused.
    const second = await injectAs(adminCookie, "POST", "/api/v1/cash/sessions", {
      openingCents: 10000,
    });
    expect(second.statusCode).toBe(409);

    // The current-session endpoint returns exactly the open one.
    const current = await injectAs(recepcionCookie, "GET", "/api/v1/cash/sessions/current");
    expect(current.json().data.state).toBe("open");
  });

  it("CB-3: expected closing = opening + Σ validated movements", async () => {
    // Two validated payments of 25.000 each inside the open shift.
    await validatedPayment(25000);
    await validatedPayment(25000);

    const current = await injectAs(adminCookie, "GET", "/api/v1/cash/sessions/current");
    const sessionId = current.json().data.id;

    // Declared 60.000 = opening 10.000 + 50.000 → discrepancy 0.
    const closed = await injectAs(adminCookie, "POST", `/api/v1/cash/sessions/${sessionId}/close`, {
      declaredClosingCents: 60000,
    });
    expect(closed.statusCode).toBe(200);
    const data = closed.json().data;
    expect(data.openingCents).toBe(10000);
    expect(data.expectedClosingCents).toBe(60000);
    expect(data.declaredClosingCents).toBe(60000);
    expect(data.discrepancyCents).toBe(0);
  });

  it("CB-4: discrepancy is recorded, never blocking", async () => {
    const open = await injectAs(adminCookie, "POST", "/api/v1/cash/sessions", {
      openingCents: 5000,
    });
    const sessionId = open.json().data.id;
    await validatedPayment(25000);

    // Declared 20.000 vs expected 30.000 → discrepancy −10.000 recorded.
    const closed = await injectAs(adminCookie, "POST", `/api/v1/cash/sessions/${sessionId}/close`, {
      declaredClosingCents: 20000,
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().data.discrepancyCents).toBe(-10000);
  });

  it("CB-2: closing is idempotent under concurrency — one 200, one 409", async () => {
    const open = await injectAs(adminCookie, "POST", "/api/v1/cash/sessions", {
      openingCents: 0,
    });
    const sessionId = open.json().data.id;

    // Two simultaneous closes of the SAME session.
    const [r1, r2] = await Promise.all([
      injectAs(adminCookie, "POST", `/api/v1/cash/sessions/${sessionId}/close`, {
        declaredClosingCents: 0,
      }),
      injectAs(adminCookie, "POST", `/api/v1/cash/sessions/${sessionId}/close`, {
        declaredClosingCents: 0,
      }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);

    // The session is closed exactly once.
    const after = await injectAs(adminCookie, "GET", `/api/v1/cash/sessions/${sessionId}`);
    expect(after.json().data.session.state).toBe("closed");
  });

  it("CB-5: no manual movement API exists (movements only via validation)", async () => {
    const open = await injectAs(adminCookie, "POST", "/api/v1/cash/sessions", {
      openingCents: 0,
    });
    const sessionId = open.json().data.id;

    // A raw movement insert is rejected (no route) — 404, not a silent 200.
    const raw = await injectAs(adminCookie, "POST", `/api/v1/cash/sessions/${sessionId}/movements`, {
      type: "income",
      amountCents: 9999,
      method: "cash",
    });
    expect(raw.statusCode).toBe(404);
  });

  it("CB-6: consolidation aggregates validated movements of the day by method", async () => {
    const res = await injectAs(adminCookie, "GET", "/api/v1/cash/consolidation");
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    // Validated payments so far: 25k+25k (CB-3) + 25k (CB-4) + 25k (reject test none)…
    // Deterministic check: the cash total counts every validated movement.
    expect(data.movementCount).toBeGreaterThanOrEqual(3);
    expect(data.byMethod.cash + data.byMethod.transfer).toBe(data.totalCents);
  });
});
