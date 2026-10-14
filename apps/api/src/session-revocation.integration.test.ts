/**
 * Entrega 5 integration tests — session revocation (spec 006, REQ-11).
 *
 * Verified against a REAL Postgres (gym_test_revoke):
 *   BDD-1: admin revokes one session of an account in its tenant → the row
 *         is deleted; listSessions no longer sees it.
 *   BDD-2: revoke-all deletes every session of the account and returns count.
 *   BDD-3: self-revocation (revoke-others) deletes the OTHER sessions and
 *         KEEPS the current one.
 *   BDD-4: cross-tenant → 404 (account of another org is unreachable).
 *   BDD-5: role separation → recepcion/instructor cannot revoke others (403).
 *
 * Isolated DB: gym_test_revoke (:55432). TRUNCATE-clean per test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createDb } from "@gym/db";
import { createAuth } from "./auth.js";
import { SessionRevocationService } from "./services/session-revocation.js";
import type { RevocationActor } from "./services/session-revocation.js";

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://gym:gymtestpass@localhost:55432/gym_test_revoke";
const RUN = Boolean(process.env.TEST_DATABASE_URL);

const db = createDb(DATABASE_URL);
const auth = createAuth({
  db,
  secret: "test-secret-32-chars-minimum-xxxxxxxxxxx",
  baseURL: "http://localhost:3000",
});
const svc = new SessionRevocationService(db);

const ORG_A = randomUUID();
const ORG_B = randomUUID();

const adminActor: RevocationActor = {
  accountId: "acc-admin",
  organizationId: ORG_A,
  role: "admin",
};

/** Creates a real Better Auth user and returns its id (FK target for session). */
async function makeAccount(email: string): Promise<string> {
  const user = await auth.api.createUser({
    body: { email, password: "SuperSecret123!", name: email, data: { emailVerified: true } },
  });
  return user.user.id;
}

/** Binds an account as staff (active) of an org. */
async function bindStaff(
  accountId: string,
  org: string,
  role: "admin" | "recepcion" | "instructor",
) {
  await db.execute(
    sql`INSERT INTO staff_assignments (id, organization_id, account_id, role, active)
        VALUES (${randomUUID()}, ${org}, ${accountId}, ${role}, true)`,
  );
}

/** Binds an account as a socio of an org (member linked by contact email). */
async function bindSocio(accountId: string, org: string, email: string) {
  await db.execute(
    sql`INSERT INTO identity_accounts (id, email, password_hash) VALUES (${accountId}, ${email}, 'better-auth')
        ON CONFLICT (id) DO NOTHING`,
  );
  await db.execute(
    sql`INSERT INTO members (id, organization_id, full_name, contact_email, account_id)
        VALUES (${randomUUID()}, ${org}, ${email}, ${email}, ${accountId})`,
  );
}

/** Inserts an active session row for a user (simulates a logged-in device). */
async function makeSession(userId: string, userAgent = "device"): Promise<string> {
  const id = randomUUID().replace(/-/g, "");
  await db.execute(
    sql`INSERT INTO session (id, token, user_id, expires_at, created_at, updated_at, ip_address, user_agent)
        VALUES (${id}, ${randomUUID()}, ${userId}, now() + interval '12 hours', now(), now(), '10.0.0.1', ${userAgent})`,
  );
  return id;
}

async function truncateAll() {
  await db.execute(sql`
    TRUNCATE audit_log, session, account, verification, members,
             staff_assignments, identity_accounts, organizations, "user"
    RESTART IDENTITY CASCADE
  `);
}

describe.skipIf(!RUN)("Entrega 5 — revocación de sesión (spec 006, REQ-11)", () => {
  let admin: string;
  let target: string;
  let otherOrgAccount: string;

  beforeAll(async () => {
    const alive = await db
      .execute(sql`SELECT 1`)
      .then(() => true)
      .catch(() => false);
    if (!alive) throw new Error("Test DB not reachable: " + DATABASE_URL);
  });

  beforeEach(async () => {
    await truncateAll();
    // Orgs are recreated after each truncate (the FK needs them present).
    await db.execute(
      sql`INSERT INTO organizations (id, name) VALUES (${ORG_A}, 'Gym A') ON CONFLICT (id) DO NOTHING`,
    );
    await db.execute(
      sql`INSERT INTO organizations (id, name) VALUES (${ORG_B}, 'Gym B') ON CONFLICT (id) DO NOTHING`,
    );
    admin = await makeAccount("admin-revoke@test.cl");
    await bindStaff(admin, ORG_A, "admin");
    adminActor.accountId = admin;
    target = await makeAccount("target@test.cl");
    await bindStaff(target, ORG_A, "recepcion");
    otherOrgAccount = await makeAccount("other@test.cl");
    await bindStaff(otherOrgAccount, ORG_B, "admin");
  });

  afterAll(async () => {
    await db
      .execute(sql`DELETE FROM organizations WHERE id IN (${ORG_A}, ${ORG_B})`)
      .catch(() => {});
  });

  // BDD-1: revoke one session → row gone, list no longer sees it.
  it("revoca una sesión: la fila se borra y el listado ya no la ve", async () => {
    const s1 = await makeSession(target, "device-1");
    const s2 = await makeSession(target, "device-2");
    let before = await svc.listSessions(adminActor, target);
    expect(before.map((s) => s.id).sort()).toEqual([s1, s2].sort());

    await svc.revokeSession(adminActor, target, s1, "10.0.0.9");

    before = await svc.listSessions(adminActor, target);
    expect(before.map((s) => s.id)).toEqual([s2]);

    // The audit row shares the fate of the mutation.
    const audit = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'session.revoke' AND entity_id = ${s1}`,
    );
    expect(Number((audit[0] as { n: number }).n)).toBe(1);
  });

  // BDD-2: revoke-all deletes every session and returns the count.
  it("revoke-all elimina todas las sesiones y devuelve el conteo auditado", async () => {
    await makeSession(target, "d1");
    await makeSession(target, "d2");
    await makeSession(target, "d3");
    const revoked = await svc.revokeAllSessions(adminActor, target, "10.0.0.9");
    expect(revoked).toBe(3);
    const after = await svc.listSessions(adminActor, target);
    expect(after).toHaveLength(0);

    const audit = await db.execute(
      sql`SELECT metadata FROM audit_log WHERE action = 'session.revoke_all' AND entity_id = ${target}`,
    );
    const meta = JSON.parse((audit[0] as { metadata: string }).metadata);
    expect(meta.revoked).toBe(3);
  });

  // BDD-3: self-revocation keeps the current session, deletes the others.
  it("auto-revocación cierra las otras sesiones y conserva la actual", async () => {
    const current = await makeSession(target, "this-device");
    await makeSession(target, "old-device-1");
    await makeSession(target, "old-device-2");

    const selfActor: RevocationActor = {
      accountId: target,
      organizationId: ORG_A,
      role: "recepcion",
    };
    const revoked = await svc.revokeOthers(selfActor, current, "10.0.0.5");
    expect(revoked).toBe(2);

    // The current session is still resolvable by id.
    const rows = await db.execute(sql`SELECT id FROM session WHERE user_id = ${target}`);
    expect(rows.map((r) => (r as { id: string }).id)).toEqual([current]);
  });

  // BDD-4: cross-tenant → 404 (no existence leak).
  it("cuenta de otro tenant → 404 al listar o revocar", async () => {
    const s = await makeSession(otherOrgAccount);
    await expect(svc.listSessions(adminActor, otherOrgAccount)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(svc.revokeSession(adminActor, otherOrgAccount, s)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(svc.revokeAllSessions(adminActor, otherOrgAccount)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // BDD-5: role separation → non-admin cannot revoke others.
  it("recepcion/instructor no pueden revocar sesiones ajenas (403)", async () => {
    const recep: RevocationActor = { accountId: target, organizationId: ORG_A, role: "recepcion" };
    const s = await makeSession(admin);
    await expect(svc.listSessions(recep, admin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(svc.revokeSession(recep, admin, s)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(svc.revokeAllSessions(recep, admin)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // Socio path of tenant belonging: the target is a socio (no staff row),
  // linked to the org by contact email. Admin of the same org may revoke it.
  it("socio del mismo tenant (sin fila staff) puede ser revocado por su admin", async () => {
    const socioEmail = "socio-revoke@test.cl";
    const socio = await makeAccount(socioEmail);
    await bindSocio(socio, ORG_A, socioEmail);
    const s = await makeSession(socio, "socio-device");
    let before = await svc.listSessions(adminActor, socio);
    expect(before.map((x) => x.id)).toEqual([s]);

    await svc.revokeSession(adminActor, socio, s, "10.0.0.9");
    before = await svc.listSessions(adminActor, socio);
    expect(before).toHaveLength(0);
  });
});
