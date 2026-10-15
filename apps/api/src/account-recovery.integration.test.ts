import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, organizations, identityAccounts, members, staffAssignments } from "@gym/db";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("SPEC 015 — identidad sin correo real", () => {
  const db = createDb(
    process.env.TEST_DATABASE_URL ??
      "postgres://gym:gym-local-dev@localhost:55432/gym_test_account_recovery",
  );
  const inbox: { to: string; purpose: string; url: string }[] = [];
  let failDelivery = false;
  const emailDelivery = async (message: { to: string; purpose: string; url: string }) => {
    if (failDelivery) throw new Error("Fallo ficticio de transporte");
    inbox.push(message);
  };
  const options = {
    db,
    secret: "identity-fictional-test-secret-at-least-32",
    baseURL: "http://localhost:3000",
  };
  const auth = createAuth({ ...options, ...{ emailDelivery, appOrigin: "http://localhost:5173" } });
  const disabledAuth = createAuth(options);
  let app: Awaited<ReturnType<typeof buildServer>>;
  let disabled: typeof app;
  const people: Record<string, { id: string; cookie: string }> = {};
  let org = "",
    member = "",
    otherMember = "",
    foreignMember = "";
  const request = (
    url: string,
    payload?: object,
    person = "socio",
    server = app,
    method: "GET" | "POST" | "PATCH" = "POST",
  ) =>
    server.inject({
      method,
      url,
      ...(payload ? { payload } : {}),
      headers: {
        origin: "http://localhost:3000",
        ...(person ? { cookie: people[person]!.cookie } : {}),
      },
    });
  const resetRequest = (email: string, server = app) =>
    request("/api/auth/request-password-reset", { email }, "", server);
  const token = (purpose: string) =>
    new URL(inbox.filter((m) => m.purpose === purpose).at(-1)!.url).hash.slice(1);
  const contact = (id = member) => `/api/v1/members/${id}/contact-verification`;
  const confirm = (value: string, id = member, person = "socio") =>
    request(`/api/v1/members/${id}/contact/verify`, { token: value }, person);
  beforeAll(async () => {
    app = await buildServer({ db, auth, ...{ emailDelivery, appOrigin: "http://localhost:5173" } });
    disabled = await buildServer({ db, auth: disabledAuth });
    await Promise.all([app.ready(), disabled.ready()]);
  });
  beforeEach(async () => {
    inbox.length = 0;
    failDelivery = false;
    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, "user", verification RESTART IDENTITY CASCADE`,
    );
    for (const name of ["socio", "admin", "other"]) {
      const email = `${name}@identity.test`;
      const { user } = await auth.api.createUser({
        body: { email, password: "FictionalPass123!", name },
      });
      await db.insert(identityAccounts).values({ id: user.id, email, passwordHash: "better-auth" });
      const res = await request(
        "/api/auth/sign-in/email",
        { email, password: "FictionalPass123!" },
        "",
      );
      expect(res.statusCode).toBe(200);
      const cookies = res.headers["set-cookie"] as string[];
      people[name] = { id: user.id, cookie: cookies.map((c) => c.split(";")[0]).join("; ") };
    }
    const rows = await db
      .insert(organizations)
      .values([{ name: "Identidad A" }, { name: "Identidad B" }])
      .returning();
    org = rows[0]!.id;
    const ms = await db
      .insert(members)
      .values([
        {
          organizationId: org,
          accountId: people.socio!.id,
          fullName: "Socio",
          contactEmail: "anterior@identity.test",
        },
        { organizationId: org, fullName: "Otro socio" },
        { organizationId: rows[1]!.id, accountId: people.other!.id, fullName: "Ajeno" },
      ])
      .returning();
    member = ms[0]!.id;
    otherMember = ms[1]!.id;
    foreignMember = ms[2]!.id;
    await db
      .insert(staffAssignments)
      .values({ organizationId: org, accountId: people.admin!.id, role: "admin" });
  });
  afterAll(async () => {
    await Promise.all([app?.close(), disabled?.close()]);
  });

  it("CA-1 sin proveedor: capacidades falsas, rechazo uniforme y ningún cambio/desafío/envío", async () => {
    const cap = await request("/api/v1/account/email-capabilities", undefined, "", disabled, "GET");
    expect(cap.statusCode).toBe(200);
    expect(cap.json().data).toEqual({ passwordReset: false, contactVerification: false });
    const known = await resetRequest("socio@identity.test", disabled);
    const unknown = await resetRequest("ausente@identity.test", disabled);
    expect(known.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(400);
    expect(known.json()).toEqual(unknown.json());
    const res = await request(contact(), { email: "nuevo@identity.test" }, "socio", disabled);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("SERVICE_UNAVAILABLE");
    expect(await db.execute(sql`SELECT * FROM verification`)).toHaveLength(0);
    expect(await db.execute(sql`SELECT * FROM contact_verifications`)).toHaveLength(0);
    expect(
      (await db.execute(sql`SELECT contact_email FROM members WHERE id=${member}`))[0]!
        .contact_email,
    ).toBe("anterior@identity.test");
    expect(inbox).toHaveLength(0);
  });
  it("CA-5 JSON malformado no refleja contraseña/token en respuesta", async () => {
    const secret = "fictional-token-not-to-reflect";
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      headers: { "content-type": "application/json" },
      payload: '{"newPassword":"' + secret,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain(secret);
  });
  it("CA-2 recuperación genérica, hash, un uso concurrente y revocación efectiva de sesiones", async () => {
    const known = await resetRequest("socio@identity.test");
    const unknown = await resetRequest("ausente@identity.test");
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(known.json()).toEqual(unknown.json());
    expect(inbox).toHaveLength(1);
    const value = token("password-reset");
    expect(new URL(inbox[0]!.url).origin).toBe("http://localhost:5173");
    const rows = await db.execute(sql`SELECT * FROM verification`);
    expect(JSON.stringify(rows)).not.toContain(value);
    expect(known.body).not.toContain(value);
    const ttl = new Date(rows[0]!.expires_at as string).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);
    expect(
      (await request("/api/auth/reset-password", { token: value, newPassword: "short" }, ""))
        .statusCode,
    ).toBe(400);
    const reset = (server = app) =>
      request(
        "/api/auth/reset-password",
        { token: value, newPassword: "ReplacementPass123!" },
        "",
        server,
      );
    // Independent auth instances share only PostgreSQL, not the in-process lock.
    const results = await Promise.all([reset(), reset(disabled)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    expect((await request("/api/v1/members/me", undefined, "socio", app, "GET")).statusCode).toBe(
      401,
    );
    expect(
      await db.execute(sql`SELECT * FROM session WHERE user_id=${people.socio!.id}`),
    ).toHaveLength(0);
    expect(
      (
        await request(
          "/api/auth/sign-in/email",
          { email: "socio@identity.test", password: "FictionalPass123!" },
          "",
        )
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await request(
          "/api/auth/sign-in/email",
          { email: "socio@identity.test", password: "ReplacementPass123!" },
          "",
        )
      ).statusCode,
    ).toBe(200);
  });
  it("CA-2 token caducado e inválido no cambian contraseña", async () => {
    await resetRequest("socio@identity.test");
    const value = token("password-reset");
    await db.execute(sql`UPDATE verification SET expires_at=NOW()-INTERVAL '1 second'`);
    for (const t of [value, "inventado"])
      expect(
        (
          await request(
            "/api/auth/reset-password",
            { token: t, newPassword: "ReplacementPass123!" },
            "",
          )
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await request(
          "/api/auth/sign-in/email",
          { email: "socio@identity.test", password: "FictionalPass123!" },
          "",
        )
      ).statusCode,
    ).toBe(200);
  });
  it("CA-3 contacto pendiente no muta; confirmación concurrente única conserva cuenta y audita", async () => {
    expect((await request(contact(), { email: "nuevo@identity.test" })).statusCode).toBe(202);
    const value = token("contact-verification");
    const before = (await db.execute(sql`SELECT * FROM members WHERE id=${member}`))[0]!;
    expect(before.contact_email).toBe("anterior@identity.test");
    expect(before.contact_verified_at).toBeNull();
    expect(
      JSON.stringify(await db.execute(sql`SELECT * FROM contact_verifications`)),
    ).not.toContain(value);
    const results = await Promise.all([confirm(value), confirm(value)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const after = (await db.execute(sql`SELECT * FROM members WHERE id=${member}`))[0]!;
    expect(after.contact_email).toBe("nuevo@identity.test");
    expect(after.contact_verified_at).not.toBeNull();
    expect(after.account_id).toBe(before.account_id);
    expect(
      (await db.execute(sql`SELECT email FROM "user" WHERE id=${people.socio!.id}`))[0]!.email,
    ).toBe("socio@identity.test");
    expect(
      await db.execute(sql`SELECT * FROM audit_log WHERE action='contact.verify'`),
    ).toHaveLength(1);
    const audit = await db.execute(sql`SELECT * FROM audit_log`);
    expect(JSON.stringify(audit)).not.toContain(value);
    expect(JSON.stringify(audit)).not.toContain("nuevo@identity.test");
    expect((await request("/api/v1/members/me", undefined, "socio", app, "GET")).statusCode).toBe(
      200,
    );
    expect(
      (
        await request(
          `/api/v1/members/${member}/contact`,
          { contactEmail: "manual@identity.test" },
          "admin",
          app,
          "PATCH",
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await db.execute(sql`SELECT contact_verified_at FROM members WHERE id=${member}`))[0]!
        .contact_verified_at,
    ).toBeNull();
  });
  it("CA-3 caducidad, reenvío y edición manual invalidan desafíos previos", async () => {
    await request(contact(), { email: "uno@identity.test" });
    const first = token("contact-verification");
    await request(contact(), { email: "dos@identity.test" });
    const second = token("contact-verification");
    expect((await confirm(first)).statusCode).toBe(409);
    await db.execute(sql`UPDATE contact_verifications SET expires_at=NOW()-INTERVAL '1 second'`);
    expect((await confirm(second)).statusCode).toBe(409);
    await request(contact(), { email: "tres@identity.test" });
    const third = token("contact-verification");
    expect(
      (
        await request(
          `/api/v1/members/${member}/contact`,
          { contactEmail: "manual@identity.test" },
          "admin",
          app,
          "PATCH",
        )
      ).statusCode,
    ).toBe(200);
    expect((await confirm(third)).statusCode).toBe(409);
    expect(
      (
        await db.execute(
          sql`SELECT contact_email,contact_verified_at FROM members WHERE id=${member}`,
        )
      )[0],
    ).toMatchObject({ contact_email: "manual@identity.test", contact_verified_at: null });
  });
  it("CA-4 límites de sesión/rol/tenant y PATCH impiden saltar la verificación", async () => {
    expect((await request(contact(), { email: "nuevo@identity.test" }, "")).statusCode).toBe(401);
    expect((await request(contact(), { email: "nuevo@identity.test" }, "admin")).statusCode).toBe(
      403,
    );
    for (const id of [otherMember, foreignMember])
      expect((await request(contact(id), { email: "nuevo@identity.test" })).statusCode).toBe(404);
    expect(
      (
        await request(
          `/api/v1/members/${member}/contact`,
          { contactEmail: "sinprueba@identity.test" },
          "socio",
          app,
          "PATCH",
        )
      ).statusCode,
    ).toBe(409);
    expect((await request(contact(), { email: "invalido" })).statusCode).toBe(400);
    await request(contact(), { email: "nuevo@identity.test" });
    const value = token("contact-verification");
    expect((await confirm(value, foreignMember, "other")).statusCode).toBe(409);
    expect((await confirm(value, otherMember)).statusCode).toBe(404);
    expect((await confirm("inventado")).statusCode).toBe(400);
    expect(
      (
        await request(
          `/api/v1/members/${member}/contact`,
          { contactEmail: null },
          "socio",
          app,
          "PATCH",
        )
      ).statusCode,
    ).toBe(200);
    expect((await confirm(value)).statusCode).toBe(409);
  });
  it("CA-1/3 fallo de entrega cancela desafío sin mutar contacto ni exponer token", async () => {
    failDelivery = true;
    const res = await request(contact(), { email: "nuevo@identity.test" });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain("Fallo ficticio");
    const rows = await db.execute(sql`SELECT * FROM contact_verifications`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cancelled_at).not.toBeNull();
    expect(
      (await db.execute(sql`SELECT contact_email FROM members WHERE id=${member}`))[0]!
        .contact_email,
    ).toBe("anterior@identity.test");
  });
});
