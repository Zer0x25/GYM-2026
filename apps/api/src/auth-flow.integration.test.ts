/**
 * Auth-flow integration test (spec 002): end-to-end session, tenant
 * isolation and member CRUD against a REAL PostgreSQL.
 *
 * Requires TEST_DATABASE_URL (docker: gym-test-pg on :55432, gym_test db,
 * migrations applied). Skipped when the variable is absent.
 *
 * Covers: sign-in → session (org+role from stored data) → provisioning →
 * members CRUD → socio "me" → permission matrix → sign-out invalidation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, identityAccounts, members, organizations, staffAssignments } from "@gym/db";
import type { Database } from "@gym/db";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SECRET = "integration-test-secret-not-for-production-000000";

describe.skipIf(!DATABASE_URL)("auth-flow integration (spec 002)", () => {
  let db: Database;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Fastify instance
  let app: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth
  let auth: any;
  let cookieHeader: string;
  let socioCookie: string;
  let orgAId: string;
  let orgBId: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, staff_assignments, members, plans, "user", session, account, verification RESTART IDENTITY CASCADE`,
    );
    auth = createAuth({ db, secret: SECRET, baseURL: "http://localhost:3000" });
    app = await buildServer({ db, auth });
    await app.ready();

    const [orgA] = await db.insert(organizations).values({ name: "Gym A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Gym B" }).returning();
    orgAId = orgA!.id;
    orgBId = orgB!.id;

    const admin = await auth.api.createUser({
      body: { email: "admin.a@test.cl", password: "SuperSecret123!", name: "Admin A", data: { emailVerified: true } },
    });
    await db.insert(identityAccounts).values({ id: admin.user.id, email: "admin.a@test.cl", passwordHash: "ba" });
    await db.insert(staffAssignments).values({ organizationId: orgAId, accountId: admin.user.id, role: "admin" });

    const signin = await auth.api.signInEmail(
      { body: { email: "admin.a@test.cl", password: "SuperSecret123!" }, asResponse: false, returnHeaders: true },
    );
    cookieHeader = signin.headers.getSetCookie().map((c: string) => c.split(";")[0]).join("; ");
  });

  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql`SELECT 1`);
  });

  const asAdmin = (method: string, url: string, payload?: unknown) =>
    app.inject({ method, url, payload, headers: { cookie: cookieHeader, origin: "http://localhost:3000" } });

  it("CA-1: session returns organization and role resolved from stored data", async () => {
    const res = await asAdmin("GET", "/api/v1/auth/session");
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.data.role).toBe("admin");
    expect(body.data.organization.id).toBe(orgAId);
  });

  it("CA-1: admin can provision a socio (account + member, org from session)", async () => {
    const res = await asAdmin("POST", "/api/v1/socios", {
      email: "socio.a1@test.cl",
      password: "SuperSecret123!",
      name: "Socio A1",
    });
    expect(res.statusCode).toBe(201);
    const socioSignin = await auth.api.signInEmail(
      { body: { email: "socio.a1@test.cl", password: "SuperSecret123!" }, asResponse: false, returnHeaders: true },
    );
    socioCookie = socioSignin.headers.getSetCookie().map((c: string) => c.split(";")[0]).join("; ");
  });

  it("CA-3: member create/list are tenant-scoped; org B invisible to admin A", async () => {
    await asAdmin("POST", "/api/v1/members", { fullName: "Socio Simple" });
    await db.insert(members).values({ organizationId: orgBId, fullName: "Socio B", contactEmail: "socio.b@test.cl" });
    const list = await asAdmin("GET", "/api/v1/members");
    const rows = list.json().data;
    expect(list.statusCode).toBe(200);
    expect(rows.every((m: { organizationId: string }) => m.organizationId === orgAId)).toBe(true);
    expect(rows.some((m: { contactEmail: string }) => m.contactEmail === "socio.b@test.cl")).toBe(false);
  });

  it("CA-4/REQ-7: socio sees only itself, edits only its own contact", async () => {
    const asSocio = (method: string, url: string, payload?: unknown) =>
      app.inject({ method, url, payload, headers: { cookie: socioCookie, origin: "http://localhost:3000" } });

    const me = await asSocio("GET", "/api/v1/members/me");
    expect(me.statusCode).toBe(200);
    expect(me.json().data.contactEmail).toBe("socio.a1@test.cl");

    expect((await asSocio("GET", "/api/v1/members")).statusCode).toBe(403);
    expect((await asSocio("POST", "/api/v1/members", { fullName: "Hack" })).statusCode).toBe(403);

    const rows = await db.select().from(members);
    const own = rows.find((m) => m.contactEmail === "socio.a1@test.cl")!;
    const other = rows.find((m) => m.contactEmail !== "socio.a1@test.cl" && m.organizationId === orgAId)!;
    expect((await asSocio("PATCH", `/api/v1/members/${other.id}/contact`, { contactEmail: "x@y.cl" })).statusCode).toBeGreaterThanOrEqual(403);
    const ok = await asSocio("PATCH", `/api/v1/members/${own.id}/contact`, { contactEmail: "socio.a1.nuevo@test.cl" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.contactEmail).toBe("socio.a1.nuevo@test.cl");
  });

  it("CA-6: sign-out invalidates the session server-side (authoritative read)", async () => {
    await asAdmin("POST", "/api/auth/sign-out");
    const res = await asAdmin("GET", "/api/v1/auth/session");
    expect(res.statusCode).toBe(401);
  });
});
