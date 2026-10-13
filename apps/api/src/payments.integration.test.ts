/**
 * Payments integration test (spec 003, REQ-2) — money core.
 *
 * Against a REAL PostgreSQL (TEST_DATABASE_URL). Skipped when absent.
 *
 * Verifies the invariants that define the delivery:
 *   - a registered payment is provisional and grants NO rights (CA-1)
 *   - validation confirms rights and creates exactly one cash movement (CA-2)
 *   - separation of functions: recepción cannot decide; admin cannot
 *     decide their own registration (CA-3)
 *   - a validated payment is immutable; terminal states have no exit (CA-4)
 *   - cross-tenant financial data is invisible (404, no leak) (CA-6)
 *   - renewal extends the window from the previous end, no gaps (CA-7)
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
  process.env.TEST_DATABASE_URL ?? "postgres://gym:gymtestpass@localhost:55432/gym_test_payments";
const SECRET = "integration-test-secret-not-for-production-000000";

describe.skipIf(!process.env.TEST_DATABASE_URL)("payments integration (spec 003, REQ-2)", () => {
  let db: Database;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify instance
  let app: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth
  let auth: any;
  let adminACookie: string;
  let recepcionACookie: string;
  let orgAId: string;
  let orgBId: string;
  let memberAId: string;
  let planAId: string;

  async function makeStaff(
    email: string,
    role: "admin" | "recepcion",
    orgId: string,
  ): Promise<string> {
    const user = await auth.api.createUser({
      body: { email, password: "SuperSecret123!", name: email, data: { emailVerified: true } },
    });
    await db
      .insert(identityAccounts)
      .values({ id: user.user.id, email, passwordHash: "ba" });
    await db
      .insert(staffAssignments)
      .values({ organizationId: orgId, accountId: user.user.id, role });
    const signin = await auth.api.signInEmail({
      body: { email, password: "SuperSecret123!" },
      asResponse: false,
      returnHeaders: true,
    });
    return signin.headers.getSetCookie().map((c: string) => c.split(";")[0]).join("; ");
  }

  const injectAs = (cookie: string, method: string, url: string, payload?: unknown) =>
    app.inject({ method, url, payload, headers: { cookie, origin: "http://localhost:3000" } });

  /** Signs in an already-created staff account, returns its cookie. */
  const signIn = async (email: string): Promise<string> => {
    const res = await auth.api.signInEmail({
      body: { email, password: "SuperSecret123!" },
      asResponse: false,
      returnHeaders: true,
    });
    return res.headers.getSetCookie().map((c: string) => c.split(";")[0]).join("; ");
  };

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, staff_assignments, members, memberships, plans, payments, cash_sessions, cash_movements, audit_log, "user", session, account, verification RESTART IDENTITY CASCADE`,
    );
    auth = createAuth({ db, secret: SECRET, baseURL: "http://localhost:3000" });
    app = await buildServer({ db, auth });
    await app.ready();

    const [orgA] = await db
      .insert(organizations)
      .values({ name: "Gym A" })
      .returning();
    const [orgB] = await db
      .insert(organizations)
      .values({ name: "Gym B" })
      .returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;

    adminACookie = await makeStaff("admin.a@test.cl", "admin", orgAId);
    recepcionACookie = await makeStaff("recepcion.a@test.cl", "recepcion", orgAId);
    // Admin B (other tenant) — for isolation tests.
    await makeStaff("admin.b@test.cl", "admin", orgBId);

    const [member] = await db
      .insert(members)
      .values({ organizationId: orgAId, fullName: "Socio A1", contactEmail: "socio.a1@test.cl" })
      .returning();
    memberAId = member!.id;

    const [plan] = await db
      .insert(plans)
      .values({
        organizationId: orgAId,
        name: "Mensual",
        priceCents: 30000,
        durationDays: 30,
        coverage: "unlimited",
      })
      .returning();
    planAId = plan!.id;
  });

  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql`SELECT 1`);
  });

  it("CA-1: registered payment is provisional; membership stays pending_payment; no cash movement", async () => {
    const res = await injectAs(recepcionACookie, "POST", "/api/v1/memberships", {
      memberId: memberAId,
      planId: planAId,
    });
    expect(res.statusCode).toBe(201);
    const membershipId = res.json().data.id;

    const pay = await injectAs(recepcionACookie, "POST", "/api/v1/payments", {
      membershipId,
      amountCents: 30000,
      method: "transfer",
      reference: "TRX-001",
    });
    expect(pay.statusCode).toBe(201);
    const payment = pay.json().data;
    expect(payment.state).toBe("provisional");

    // Membership state derived: still pending_payment.
    const state = await injectAs(adminACookie, "GET", `/api/v1/memberships/${membershipId}`);
    expect(state.json().data.state).toBe("pending_payment");

    // No cash movement created yet (money not validated).
    const movements = await db.execute(sql`SELECT COUNT(*)::int AS n FROM cash_movements`);
    expect(Number((movements[0] as { n: number }).n)).toBe(0);

    // INVARIANT: validated money always belongs to an open shift → validating
    // with NO open session is refused (no orphan money).
    const noShift = await injectAs(
      adminACookie,
      "POST",
      `/api/v1/payments/${payment.id}/validate`,
    );
    expect(noShift.statusCode).toBe(409);
    const still = await injectAs(adminACookie, "GET", `/api/v1/payments/${payment.id}`);
    expect(still.json().data.state).toBe("provisional");

    // Open the shift, then validation will succeed in CA-2.
    const open = await injectAs(adminACookie, "POST", "/api/v1/cash/sessions", {
      openingCents: 50000,
    });
    expect(open.statusCode).toBe(201);
  });

  it("CA-3: recepción cannot validate; admin cannot validate their own registration", async () => {
    const list = await injectAs(recepcionACookie, "GET", "/api/v1/payments?state=provisional");
    const paymentId = list.json().data[0].id;

    // Recepción attempting to validate → 403.
    const asRecepcion = await injectAs(
      recepcionACookie,
      "POST",
      `/api/v1/payments/${paymentId}/validate`,
    );
    expect(asRecepcion.statusCode).toBe(403);

    // Admin A validates the payment registered by recepción → 200 (distinct actors).
    const validated = await injectAs(
      adminACookie,
      "POST",
      `/api/v1/payments/${paymentId}/validate`,
    );
    expect(validated.statusCode).toBe(200);
    expect(validated.json().data.state).toBe("validated");
  });

  it("CA-2: validation creates exactly one cash movement and activates the membership", async () => {
    const movements = await db.execute(sql`SELECT COUNT(*)::int AS n FROM cash_movements`);
    expect(Number((movements[0] as { n: number }).n)).toBe(1);

    // The membership is now active with a validity window.
    const list = await injectAs(adminACookie, "GET", "/api/v1/memberships");
    const membership = list.json().data[0];
    expect(membership.state).toBe("active");
    expect(membership.startAt).toBeTruthy();
    expect(membership.endAt).toBeTruthy();

    // Idempotency: validating again is rejected (terminal state).
    const paymentId = (await injectAs(adminACookie, "GET", "/api/v1/payments?state=validated"))
      .json().data[0].id;
    const again = await injectAs(adminACookie, "POST", `/api/v1/payments/${paymentId}/validate`);
    expect(again.statusCode).toBe(409);

    const movementsAfter = await db.execute(sql`SELECT COUNT(*)::int AS n FROM cash_movements`);
    expect(Number((movementsAfter[0] as { n: number }).n)).toBe(1);
  });

  it("CA-3 (self): admin cannot validate a payment they registered themselves", async () => {
    // Recepción creates a NEW membership + payment; admin A registers a payment himself.
    const mres = await injectAs(adminACookie, "POST", "/api/v1/memberships", {
      memberId: memberAId,
      planId: planAId,
    });
    const membershipId = mres.json().data.id;
    const pay = await injectAs(adminACookie, "POST", "/api/v1/payments", {
      membershipId,
      amountCents: 30000,
      method: "cash",
    });
    const paymentId = pay.json().data.id;
    // Admin A tries to validate his own registration → 403.
    const selfValidate = await injectAs(
      adminACookie,
      "POST",
      `/api/v1/payments/${paymentId}/validate`,
    );
    expect(selfValidate.statusCode).toBe(403);
  });

  it("CA-4: rejection is terminal and requires a reason; rejected cannot be validated", async () => {
    const mres = await injectAs(recepcionACookie, "POST", "/api/v1/memberships", {
      memberId: memberAId,
      planId: planAId,
    });
    const membershipId = mres.json().data.id;
    const pay = await injectAs(recepcionACookie, "POST", "/api/v1/payments", {
      membershipId,
      amountCents: 30000,
      method: "transfer",
      reference: "TRX-BAD",
    });
    const paymentId = pay.json().data.id;

    // Rejection without reason → 400.
    const noReason = await injectAs(
      adminACookie,
      "POST",
      `/api/v1/payments/${paymentId}/reject`,
      {},
    );
    expect(noReason.statusCode).toBe(400);

    const rejected = await injectAs(
      adminACookie,
      "POST",
      `/api/v1/payments/${paymentId}/reject`,
      { reason: "Referencia no coincide" },
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().data.state).toBe("rejected");

    // Rejected is terminal: cannot be validated.
    const afterReject = await injectAs(
      adminACookie,
      "POST",
      `/api/v1/payments/${paymentId}/validate`,
    );
    expect(afterReject.statusCode).toBe(409);
  });

  it("CA-6: cross-tenant isolation — admin B cannot see A's payments", async () => {
    // admin.b@test.cl already exists (created in beforeAll).
    const adminBCookie = await signIn("admin.b@test.cl");
    const list = await injectAs(adminBCookie, "GET", "/api/v1/payments");
    const rows = list.json().data ?? [];
    // Every row must belong to org B (none from A).
    for (const row of rows) {
      expect(row.organizationId).toBe(orgBId);
    }
  });

  it("CA-7: renewal extends the window from the previous end (no gaps)", async () => {
    const list = await injectAs(adminACookie, "GET", "/api/v1/memberships");
    // The membership that is active (validated in CA-2).
    const membership = list.json().data.find(
      (m: { state: string }) => m.state === "active",
    )!;
    const endBefore = new Date(membership.endAt).getTime();

    // Recepción registers a renewal payment; admin validates it.
    const pay = await injectAs(recepcionACookie, "POST", "/api/v1/payments", {
      membershipId: membership.id,
      amountCents: 30000,
      method: "cash",
    });
    const paymentId = pay.json().data.id;
    await injectAs(adminACookie, "POST", `/api/v1/payments/${paymentId}/validate`);

    const after = await injectAs(adminACookie, "GET", `/api/v1/memberships/${membership.id}`);
    const endAfter = new Date(after.json().data.endAt).getTime();
    // Extended by exactly the plan duration (30 days) from the previous end.
    expect(endAfter - endBefore).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("CA-8: every financial mutation wrote its audit row", async () => {
    const rows = await db.execute(
      sql`SELECT action, COUNT(*)::int AS n FROM audit_log WHERE organization_id = ${orgAId} GROUP BY action ORDER BY action`,
    );
    const actions = rows.map((r) => String(r.action));
    expect(actions).toContain("payment.register");
    expect(actions).toContain("payment.validate");
    expect(actions).toContain("payment.reject");
  });

  // ── Caminos de error/borde (branch coverage, CAL-2) ──────────────────

  it("ERR: transfer payment without a bank reference is refused (409)", async () => {
    const mres = await injectAs(recepcionACookie, "POST", "/api/v1/memberships", {
      memberId: memberAId,
      planId: planAId,
    });
    const membershipId = mres.json().data.id;
    const pay = await injectAs(recepcionACookie, "POST", "/api/v1/payments", {
      membershipId,
      amountCents: 30000,
      method: "transfer",
    });
    expect(pay.statusCode).toBe(409);
  });

  it("ERR: registering a payment for a non-existent membership is not-found (404)", async () => {
    const pay = await injectAs(recepcionACookie, "POST", "/api/v1/payments", {
      membershipId: "11111111-1111-1111-1111-111111111111",
      amountCents: 30000,
      method: "cash",
    });
    expect(pay.statusCode).toBe(404);
  });

  it("ERR: validating / rejecting an unknown payment is not-found (404)", async () => {
    const unknown = "11111111-1111-1111-1111-111111111111";
    const validate = await injectAs(adminACookie, "POST", `/api/v1/payments/${unknown}/validate`);
    expect(validate.statusCode).toBe(404);
    const reject = await injectAs(adminACookie, "POST", `/api/v1/payments/${unknown}/reject`, {
      reason: "x",
    });
    expect(reject.statusCode).toBe(404);
  });

  it("ERR: recepción cannot reject a payment (separation of functions, 403)", async () => {
    const mres = await injectAs(recepcionACookie, "POST", "/api/v1/memberships", {
      memberId: memberAId,
      planId: planAId,
    });
    const membershipId = mres.json().data.id;
    const pay = await injectAs(recepcionACookie, "POST", "/api/v1/payments", {
      membershipId,
      amountCents: 30000,
      method: "cash",
    });
    const paymentId = pay.json().data.id;
    const asRecepcion = await injectAs(
      recepcionACookie,
      "POST",
      `/api/v1/payments/${paymentId}/reject`,
      { reason: "no debería poder" },
    );
    expect(asRecepcion.statusCode).toBe(403);
  });

  it("ERR: listing payments filtered by state returns only that state", async () => {
    const provisional = await injectAs(recepcionACookie, "GET", "/api/v1/payments?state=provisional");
    expect(provisional.statusCode).toBe(200);
    for (const row of provisional.json().data ?? []) {
      expect(row.state).toBe("provisional");
    }
    const validated = await injectAs(adminACookie, "GET", "/api/v1/payments?state=validated");
    for (const row of validated.json().data ?? []) {
      expect(row.state).toBe("validated");
    }
  });
});
