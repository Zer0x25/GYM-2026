import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CreditPeriodSummary } from "@gym/contracts";
import { sql } from "drizzle-orm";
import { createDb, organizations, identityAccounts, staffAssignments, members } from "@gym/db";
import { createAuth } from "./auth.js";
import { buildServer } from "./app.js";
import { PlansService } from "./services/plans.js";
import { MembershipsService } from "./services/memberships.js";
import { PaymentsService } from "./services/payments.js";
import { CashService } from "./services/cash.js";
import { SessionsService } from "./services/sessions.js";
import { BookingsService } from "./services/bookings.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("SPEC016 — períodos y créditos reales", () => {
  const db = createDb(
    process.env.TEST_DATABASE_URL ??
      "postgres://gym:gym-local-dev@localhost:55432/gym_test_credits",
  );
  const auth = createAuth({
    db,
    secret: "credits-fictional-test-secret-at-least-32",
    baseURL: "http://localhost:3000",
  });
  const ps = new PaymentsService(db),
    bs = new BookingsService(db),
    ss = new SessionsService(db);
  let app: Awaited<ReturnType<typeof buildServer>>;
  const people: Record<string, { id: string; cookie: string }> = {};
  let org = "",
    other = "",
    member = "",
    membership = "",
    plan = "";
  const actor = (role: "admin" | "recepcion" | "socio" = "admin") => ({
    organizationId: org,
    accountId: people[role]!.id,
    role,
    ...(role === "socio" ? { memberId: member } : {}),
  });
  const quota = { grupal: 1, fija: 2, cita: 0 };
  const request = (person: string, method: "GET" | "POST", path: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1/${path}`,
      ...(payload ? { payload } : {}),
      headers: { cookie: people[person]!.cookie, origin: "http://localhost:3000" },
    });
  async function pay(validate = true) {
    const payment = await ps.register(actor("recepcion"), {
      membershipId: membership,
      method: "cash",
      amountCents: 30000,
    });
    if (validate) await ps.validate(actor(), payment.id);
    return payment;
  }
  async function session(
    type: "grupal" | "fija" | "cita" = "grupal",
    at = new Date(Date.now() + 48 * 3600_000),
    capacity = 5,
  ) {
    return ss.create(actor(), {
      type,
      instructorId: randomUUID(),
      startsAt: at,
      endsAt: new Date(at.getTime() + 3600_000),
      capacity,
    });
  }
  const balance = async () => {
    const res = await request("socio", "GET", "me/credit-periods");
    expect(res.statusCode).toBe(200);
    CreditPeriodSummary.array().parse(res.json().data);
    return res.json().data as {
      id: string;
      startsAt: string;
      endsAt: string;
      credits: Record<
        string,
        { quota: number | null; available: number | null; committed: number }
      >;
      reviewCount: number;
    }[];
  };
  beforeAll(async () => {
    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, "user" RESTART IDENTITY CASCADE`,
    );
    for (const role of ["admin", "recepcion", "socio", "other"]) {
      const email = `${role}@credits.test`;
      const { user } = await auth.api.createUser({
        body: { email, name: role, password: "FictionalPassword123!" },
      });
      await db.insert(identityAccounts).values({ id: user.id, email, passwordHash: "better-auth" });
      const res = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ email, password: "FictionalPassword123!" }),
        }),
      );
      people[role] = {
        id: user.id,
        cookie: res.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; "),
      };
    }
    app = await buildServer({ db, auth });
    await app.ready();
  });
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE organizations RESTART IDENTITY CASCADE`);
    const rows = await db
      .insert(organizations)
      .values([{ name: "Créditos A" }, { name: "Créditos B" }])
      .returning();
    org = rows[0]!.id;
    other = rows[1]!.id;
    await db.insert(staffAssignments).values(
      ["admin", "recepcion", "other"].map((role) => ({
        organizationId: role === "other" ? other : org,
        accountId: people[role]!.id,
        role: role === "recepcion" ? ("recepcion" as const) : ("admin" as const),
      })),
    );
    const [m] = await db
      .insert(members)
      .values({ organizationId: org, accountId: people.socio!.id, fullName: "Socio créditos" })
      .returning();
    member = m!.id;
    const p = await new PlansService(db).create(org, {
      name: "Limitado",
      priceCents: 30000,
      durationDays: 30,
      coverage: "limited",
      ...{ classCredits: quota },
    });
    plan = p.id;
    membership = (await new MembershipsService(db).assign(org, member, plan)).id;
    await new CashService(db).open(actor(), 0);
  });
  afterAll(async () => {
    await app?.close();
  });

  it("CA-1 plan limitado exige configuración y pago provisional no concede períodos", async () => {
    const invalid = await request("admin", "POST", "plans", {
      name: "Sin cuotas",
      priceCents: 10000,
      durationDays: 30,
      coverage: "limited",
    });
    expect(invalid.statusCode).toBe(400);
    await pay(false);
    expect(await balance()).toHaveLength(0);
    const p = await pay();
    const rows = await db.execute(sql`SELECT * FROM membership_periods`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payment_id).toBe(p.id);
    expect(rows[0]!.grupal_credits).toBe(1);
  });
  it("CA-2 fecha de clase, ninguna cobertura, configuración incompleta y modalidad sin saldo deniegan", async () => {
    await pay();
    const far = await session("grupal", new Date(Date.now() + 40 * 86400000));
    await expect(bs.create(actor("socio"), far.id, member)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const zero = await session("cita");
    await expect(bs.create(actor("socio"), zero.id, member)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await db.execute(
      sql`UPDATE memberships SET start_at=NOW()+INTERVAL '5 days' WHERE id=${membership}`,
    );
    const soon = await session();
    await expect(bs.create(actor("socio"), soon.id, member)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await db.execute(sql`SELECT * FROM bookings`)).toHaveLength(0);
    expect(await db.execute(sql`SELECT * FROM credit_movements`)).toHaveLength(0);
  });
  it("CA-3 último crédito entre sesiones distintas es atómico y no se duplica por replay", async () => {
    await pay();
    const a = await session(),
      b = await session();
    const results = await Promise.allSettled([
      bs.create(actor("socio"), a.id, member),
      bs.create(actor("socio"), b.id, member),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = (
      results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
        id: string;
        sessionId: string;
      }>
    ).value;
    await expect(bs.create(actor("socio"), winner.sessionId, member)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='commit'`)).toHaveLength(
      1,
    );
    expect((await balance())[0]!.credits.grupal).toEqual({ quota: 1, committed: 1, available: 0 });
    const fixed = await session("fija");
    await bs.create(actor("socio"), fixed.id, member);
    expect((await balance())[0]!.credits.fija!.available).toBe(1);
  });
  it("CA-4 cancelación temprana concurrente restituye una vez al mismo período", async () => {
    await pay();
    const s = await session();
    const b = await bs.create(actor("socio"), s.id, member);
    const results = await Promise.allSettled([
      bs.cancel(actor("socio"), b.id, { type: "temprana" }),
      bs.cancel(actor("socio"), b.id, { type: "temprana" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='return'`)).toHaveLength(
      1,
    );
    expect((await balance())[0]!.credits.grupal!.available).toBe(1);
  });
  it("CA-4 tardía y ausencia retienen, asistencia no descuenta adicionalmente", async () => {
    await pay();
    const late = await session("grupal", new Date(Date.now() + 3600_000));
    const b = await bs.create(actor("socio"), late.id, member);
    const result = await bs.cancel(actor("socio"), b.id, { type: "temprana" });
    expect(result.cancellation.creditReturned).toBe(false);
    const fixed = await session("fija");
    const f = await bs.create(actor("socio"), fixed.id, member);
    await bs.markAttendance(actor(), f.id, "asistio");
    await bs.markAttendance(actor(), f.id, "asistio");
    await bs.markAttendance(actor(), f.id, "ausencia");
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='commit'`)).toHaveLength(
      2,
    );
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='return'`)).toHaveLength(
      0,
    );
  });
  it("CA-4 AC-215 conserva revisión tras vencer, sin prórroga ni traslado", async () => {
    await pay();
    const s = await session();
    const b = await bs.create(actor("socio"), s.id, member);
    await db.execute(
      sql`UPDATE membership_periods SET starts_at=NOW()-INTERVAL '30 days',ends_at=NOW()-INTERVAL '1 second'`,
    );
    const result = await bs.cancel(actor(), b.id, { type: "gimnasio" });
    expect(result.cancellation.creditReturned).toBe(false);
    expect(result.cancellation).toHaveProperty("creditReviewRequired", true);
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='review'`)).toHaveLength(
      1,
    );
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='return'`)).toHaveLength(
      0,
    );
    expect((await balance())[0]!.reviewCount).toBe(1);
  });
  it("CA-1/3 renovación concurrente crea períodos consecutivos sin acumular ni perder inicio", async () => {
    await pay();
    const first = (await balance())[0]!;
    const p1 = await pay(false),
      p2 = await pay(false);
    await Promise.all([ps.validate(actor(), p1.id), ps.validate(actor(), p2.id)]);
    const periods = await balance();
    expect(periods).toHaveLength(3);
    expect(periods[1]!.startsAt).toBe(periods[0]!.endsAt);
    expect(periods[2]!.startsAt).toBe(periods[1]!.endsAt);
    const current = (
      await db.execute(sql`SELECT start_at FROM memberships WHERE id=${membership}`)
    )[0]!;
    expect(new Date(current.start_at as string).toISOString()).toBe(first.startsAt);
    const future = await session(
      "grupal",
      new Date(new Date(periods[1]!.startsAt).getTime() + 86400000),
    );
    await bs.create(actor("socio"), future.id, member);
    const balances = await balance();
    expect(balances[0]!.credits.grupal!.available).toBe(1);
    expect(balances[1]!.credits.grupal!.available).toBe(0);
  });
  it("CA-5 pérdida confirmada cancela futuras y no se restauran al recuperar; asistir rechaza persistiendo", async () => {
    await pay();
    const a = await session("fija"),
      b = await session("fija");
    const ba = await bs.create(actor("socio"), a.id, member),
      bb = await bs.create(actor("socio"), b.id, member);
    await db.execute(
      sql`UPDATE memberships SET end_at=NOW()-INTERVAL '1 second' WHERE id=${membership}`,
    );
    await expect(bs.markAttendance(actor(), ba.id, "asistio")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await db.execute(sql`SELECT state FROM bookings WHERE id=${ba.id}`))[0]!.state).toBe(
      "cancelada",
    );
    const res = await request("admin", "POST", `members/${member}/bookings/revalidate`, {});
    expect(res.statusCode).toBe(200);
    expect((await db.execute(sql`SELECT state FROM bookings WHERE id=${bb.id}`))[0]!.state).toBe(
      "cancelada",
    );
    await db.execute(
      sql`UPDATE memberships SET end_at=NOW()+INTERVAL '30 days' WHERE id=${membership}`,
    );
    expect(
      (await request("admin", "POST", `members/${member}/bookings/revalidate`, {})).statusCode,
    ).toBe(200);
    expect(await db.execute(sql`SELECT * FROM bookings WHERE state='confirmada'`)).toHaveLength(0);
  });
  it("CA-3 última plaza limitada no consume al perdedor y cancelar clase devuelve al ganador una vez", async () => {
    await pay();
    const [second] = await db
      .insert(members)
      .values({ organizationId: org, fullName: "Otro limitado" })
      .returning();
    const ms = await new MembershipsService(db).assign(org, second!.id, plan);
    const p = await ps.register(actor("recepcion"), {
      membershipId: ms.id,
      method: "cash",
      amountCents: 30000,
    });
    await ps.validate(actor(), p.id);
    const limited = await session("grupal", undefined, 1);
    const results = await Promise.allSettled([
      bs.create(actor("recepcion"), limited.id, member),
      bs.create(actor("recepcion"), limited.id, second!.id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='commit'`)).toHaveLength(
      1,
    );
    await ss.cancel(actor(), limited.id);
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='return'`)).toHaveLength(
      1,
    );
    expect(await db.execute(sql`SELECT * FROM bookings WHERE state='confirmada'`)).toHaveLength(0);
    await expect(ss.cancel(actor(), limited.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='return'`)).toHaveLength(
      1,
    );
  });
  it("CA-1/2 snapshot no cambia por editar catálogo; ninguna cobertura y limitado legado no habilitan", async () => {
    await pay();
    await db.execute(sql`UPDATE plans SET grupal_credits=999,price_cents=99999 WHERE id=${plan}`);
    expect((await balance())[0]!.credits.grupal!.quota).toBe(1);
    const s = await session();
    await db.execute(sql`UPDATE membership_periods SET coverage='none'`);
    await expect(bs.create(actor("socio"), s.id, member)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await db.execute(sql`UPDATE membership_periods SET coverage='limited',grupal_credits=NULL`);
    await expect(bs.create(actor("socio"), s.id, member)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const past = await session("grupal", new Date(Date.now() - 86400000));
    await expect(bs.create(actor("socio"), past.id, member)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("CA-3/4 cancelación y nueva reserva concurrente no bloquean ni exceden saldo; socio no fuerza devolución", async () => {
    await pay();
    const a = await session(),
      b = await session();
    const ba = await bs.create(actor("socio"), a.id, member);
    await expect(bs.cancel(actor("socio"), ba.id, { type: "gimnasio" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const results = await Promise.allSettled([
      bs.cancel(actor("socio"), ba.id, { type: "temprana" }),
      bs.create(actor("socio"), b.id, member),
    ]);
    expect(results[0]!.status).toBe("fulfilled");
    const remaining = (await balance())[0]!.credits.grupal!.available!;
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(1);
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='return'`)).toHaveLength(
      1,
    );
  });
  it("CA-3/4 cancelar dos clases con varios socios simultáneamente libera todos los créditos sin deadlock", async () => {
    await pay();
    const [m2] = await db
      .insert(members)
      .values({ organizationId: org, fullName: "Segundo socio concurrente" })
      .returning();
    const ms2 = await new MembershipsService(db).assign(org, m2!.id, plan);
    const p2 = await ps.register(actor("recepcion"), {
      membershipId: ms2.id,
      method: "cash",
      amountCents: 30000,
    });
    await ps.validate(actor(), p2.id);
    const a = await session("fija"),
      b = await session("fija");
    for (const s of [a, b])
      for (const id of [member, m2!.id]) await bs.create(actor("recepcion"), s.id, id);
    await Promise.all([ss.cancel(actor(), a.id), ss.cancel(actor(), b.id)]);
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='commit'`)).toHaveLength(
      4,
    );
    expect(await db.execute(sql`SELECT * FROM credit_movements WHERE kind='return'`)).toHaveLength(
      4,
    );
    expect(await db.execute(sql`SELECT * FROM bookings WHERE state='confirmada'`)).toHaveLength(0);
    expect((await balance())[0]!.credits.fija!.available).toBe(2);
    const otherBalance = await request("admin", "GET", `members/${m2!.id}/credit-periods`);
    expect(otherBalance.json().data[0].credits.fija.available).toBe(2);
  });
  it("CA-1/5 sin caja no crea período; saldos/operaciones aislados por rol, miembro y tenant", async () => {
    expect((await app.inject({ method: "GET", url: "/api/v1/me/credit-periods" })).statusCode).toBe(
      401,
    );
    const shift = (await new CashService(db).findOpenSession(org))!;
    await new CashService(db).close(actor(), shift.id, 0);
    const p = await pay(false);
    await expect(ps.validate(actor(), p.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await balance()).toHaveLength(0);
    expect((await request("other", "GET", `members/${member}/credit-periods`)).statusCode).toBe(
      404,
    );
    expect(
      (await request("socio", "POST", `members/${member}/bookings/revalidate`, {})).statusCode,
    ).toBe(403);
    expect(
      (await request("socio", "GET", `members/${randomUUID()}/credit-periods`)).statusCode,
    ).toBe(404);
  });
});
