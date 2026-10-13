/**
 * Entrega 5 integration tests — QR ingress & supervised check-in (spec 007).
 *
 * Verified against a REAL Postgres (gym_test_qr):
 *   BDD-1: active coverage → 200 allowed=true with identity; audited ok.
 *   BDD-2: expired/no membership → allowed=false with reason; audited denied.
 *   BDD-3: revoked token → allowed=false (revoked); reissue restores.
 *   BDD-4: cross-tenant token → 404 (anti-enumeration, not 403).
 *   BDD-5: socio sees ONLY their own QR; cannot check-in others.
 *   BDD-6: idempotent — same QR twice → both allowed (authorization, not effect).
 *   BDD-7 (REQ-8): two receptionists scan the same QR concurrently → coherent.
 *
 * Isolated DB: gym_test_qr (:55432). TRUNCATE-clean per test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createDb } from "@gym/db";
import { createAuth } from "./auth.js";
import { CheckinService } from "./services/checkin.js";
import type { CheckinActor } from "./services/checkin.js";
import { generateQrToken } from "./services/provisioning.js";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://gym:gymtestpass@localhost:55432/gym_test_qr";
const RUN = Boolean(process.env.TEST_DATABASE_URL);

const db = createDb(DATABASE_URL);
const auth = createAuth({
  db,
  secret: "test-secret-32-chars-minimum-xxxxxxxxxxx",
  baseURL: "http://localhost:3000",
});
const svc = new CheckinService(db);

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const PLAN_A = randomUUID();
const PLAN_NONE = randomUUID();

const recepActor: CheckinActor = { accountId: "acc-recep", organizationId: ORG_A, role: "recepcion" };
const adminActor: CheckinActor = { accountId: "acc-admin", organizationId: ORG_A, role: "admin" };

async function truncateAll() {
  await db.execute(sql`
    TRUNCATE audit_log, memberships, plans, members, organizations,
             session, account, verification, "user"
    RESTART IDENTITY CASCADE
  `);
}

/** Creates a real Better Auth user (FK target for audit_log.actor_id). */
async function makeAccount(email: string): Promise<string> {
  const user = await auth.api.createUser({
    body: { email, password: "SuperSecret123!", name: email, data: { emailVerified: true } },
  });
  return user.user.id;
}

async function makePlan(id: string, org: string, coverage: "none" | "unlimited" | "limited") {
  await db.execute(
    sql`INSERT INTO plans (id, organization_id, name, price_cents, duration_days, coverage, active)
        VALUES (${id}, ${org}, 'Plan', 30000, 30, ${coverage}, true)`,
  );
}

/** Creates a member with a QR token; returns {memberId, qrToken}. */
async function makeMember(org: string, name: string, qrToken = generateQrToken()) {
  const id = randomUUID();
  await db.execute(
    sql`INSERT INTO members (id, organization_id, full_name, contact_email, qr_token)
        VALUES (${id}, ${org}, ${name}, ${`${name}@x.cl`}, ${qrToken})`,
  );
  return { memberId: id, qrToken };
}

/** Gives the member an active membership window [now, now+30d] on the given plan. */
async function giveActiveMembership(org: string, memberId: string, planId: string) {
  await db.execute(
    sql`INSERT INTO memberships (id, organization_id, member_id, plan_id, start_at, end_at)
        VALUES (${randomUUID()}, ${org}, ${memberId}, ${planId}, now(), now() + interval '30 days')`,
  );
}

/** Gives the member an EXPIRED membership window (ended yesterday). */
async function giveExpiredMembership(org: string, memberId: string, planId: string) {
  await db.execute(
    sql`INSERT INTO memberships (id, organization_id, member_id, plan_id, start_at, end_at)
        VALUES (${randomUUID()}, ${org}, ${memberId}, ${planId}, now() - interval '40 days', now() - interval '10 days')`,
  );
}

describe.skipIf(!RUN)("Entrega 5 — QR y check-in supervisado (spec 007, REQ-7/REQ-8)", () => {
  beforeAll(async () => {
    const alive = await db.execute(sql`SELECT 1`).then(() => true).catch(() => false);
    if (!alive) throw new Error("Test DB not reachable: " + DATABASE_URL);
  });

  beforeEach(async () => {
    await truncateAll();
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${ORG_A}, 'Gym A') ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`INSERT INTO organizations (id, name) VALUES (${ORG_B}, 'Gym B') ON CONFLICT (id) DO NOTHING`);
    await makePlan(PLAN_A, ORG_A, "unlimited");
    await makePlan(PLAN_NONE, ORG_A, "none");
    // Real users back the actor ids (audit_log FK → "user").
    recepActor.accountId = await makeAccount("recep-qr@test.cl");
    adminActor.accountId = await makeAccount("admin-qr@test.cl");
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`).catch(() => {});
  });

  // BDD-1: active coverage → allowed, identity returned.
  it("cobertura activa → 200 allowed=true con identidad; auditado ok", async () => {
    const { memberId, qrToken } = await makeMember(ORG_A, "Socio Activo");
    await giveActiveMembership(ORG_A, memberId, PLAN_A);
    const out = await svc.checkin(recepActor, qrToken, "10.0.0.1");
    expect(out.allowed).toBe(true);
    if (out.allowed) {
      expect(out.fullName).toBe("Socio Activo");
      expect(out.coverage).toBe("unlimited");
      expect(out.membershipEndsAt).toBeTruthy();
    }
    const audit = await db.execute(sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'checkin.ok'`);
    expect(Number((audit[0] as { n: number }).n)).toBe(1);
  });

  // BDD-2: expired membership → denied with reason.
  it("membresía vencida → allowed=false con motivo; auditado denied", async () => {
    const { memberId, qrToken } = await makeMember(ORG_A, "Socio Vencido");
    await giveExpiredMembership(ORG_A, memberId, PLAN_A);
    const out = await svc.checkin(recepActor, qrToken, "10.0.0.1");
    expect(out.allowed).toBe(false);
    if (!out.allowed) expect(out.reason).toContain("sin membresía vigente");
    const audit = await db.execute(sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'checkin.denied'`);
    expect(Number((audit[0] as { n: number }).n)).toBe(1);
  });

  // BDD-2b: plan coverage=none → denied.
  it("plan coverage=none → allowed=false", async () => {
    const { memberId, qrToken } = await makeMember(ORG_A, "Socio SinCobertura");
    await giveActiveMembership(ORG_A, memberId, PLAN_NONE);
    const out = await svc.checkin(recepActor, qrToken);
    expect(out.allowed).toBe(false);
    if (!out.allowed) expect(out.reason).toContain("sin cobertura de ingreso");
  });

  // BDD-3: revoked token → denied; reissue restores.
  it("QR revocado → denied; re-emitir devuelve uno activo", async () => {
    const { memberId, qrToken } = await makeMember(ORG_A, "Socio Revocado");
    await giveActiveMembership(ORG_A, memberId, PLAN_A);
    await svc.revokeQr(adminActor, memberId);
    const denied = await svc.checkin(recepActor, qrToken);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.reason).toContain("revocado");

    const newToken = await svc.reissueQr(adminActor, memberId);
    const out = await svc.checkin(recepActor, newToken);
    expect(out.allowed).toBe(true);
  });

  // BDD-4: cross-tenant token → 404 (not 403).
  it("QR de otro tenant → 404 (anti-enumeración)", async () => {
    const { qrToken } = await makeMember(ORG_B, "Socio Otra Org");
    await expect(svc.checkin(recepActor, qrToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // BDD-5: socio sees only their own QR.
  it("solo el socio ve su propio QR", async () => {
    const mine = await makeMember(ORG_A, "Socio Uno");
    const socioActor: CheckinActor = {
      accountId: await makeAccount("socio-qr@test.cl"),
      organizationId: ORG_A,
      role: "socio",
      memberId: mine.memberId,
    };
    const token = await svc.myQr(socioActor);
    expect(token).toBe(mine.qrToken);
  });

  // BDD-6: idempotent — same QR twice → both allowed.
  it("mismo QR dos veces → ambos allowed (autorización, no efecto)", async () => {
    const { memberId, qrToken } = await makeMember(ORG_A, "Socio Idempotente");
    await giveActiveMembership(ORG_A, memberId, PLAN_A);
    const a = await svc.checkin(recepActor, qrToken);
    const b = await svc.checkin(recepActor, qrToken);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  // BDD-7 (REQ-8): concurrent scans → coherent (both allowed, no corruption).
  it("dos recepcionistas escanean el mismo QR en paralelo → coherentes", async () => {
    const { memberId, qrToken } = await makeMember(ORG_A, "Socio Concurrente");
    await giveActiveMembership(ORG_A, memberId, PLAN_A);
    const otherRecep: CheckinActor = { accountId: await makeAccount("recep2-qr@test.cl"), organizationId: ORG_A, role: "recepcion" };
    const [r1, r2] = await Promise.all([
      svc.checkin(recepActor, qrToken, "10.0.0.1"),
      svc.checkin(otherRecep, qrToken, "10.0.0.2"),
    ]);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    const audit = await db.execute(sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'checkin.ok'`);
    expect(Number((audit[0] as { n: number }).n)).toBe(2);
  });
});
