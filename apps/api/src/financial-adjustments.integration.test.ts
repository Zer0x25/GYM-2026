import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  createDb,
  organizations,
  identityAccounts,
  staffAssignments,
  members,
  plans,
  memberships,
  payments,
  cashMovements,
  auditLog,
} from "@gym/db";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";
import { CashService } from "./services/cash.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("SPEC 014 — Compensaciones financieras", () => {
  const db = createDb(
    process.env.TEST_DATABASE_URL ??
      "postgres://gym:gym-local-dev@localhost:55432/gym_test_adjustments",
  );
  const auth = createAuth({
    db,
    secret: "transbank-fictional-test-secret-at-least-32",
    baseURL: "http://localhost:3000",
  });
  let app: Awaited<ReturnType<typeof buildServer>>;
  const people: Record<string, { id: string; cookie: string }> = {};
  let org = "",
    other = "",
    member = "",
    membership = "";
  const body = () => ({
    membershipId: membership,
    amountCents: 30000,
    method: "transbank",
    reference: "OP-123",
    comment: "Terminal externo recepción",
  });
  const request = (
    person: string,
    method: "GET" | "POST",
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url: `/api/v1/${url}`,
      ...(payload === undefined ? {} : { payload }),
      headers: { cookie: people[person]!.cookie, origin: "http://localhost:3000" },
    });
  const actor = () => ({
    organizationId: org,
    accountId: people.admin!.id,
    role: "admin" as const,
  });
  async function register(person = "recepcion", input = body()) {
    const response = await request(person, "POST", "payments", input);
    expect(response.statusCode).toBe(201);
    return response.json().data as {
      id: string;
      method: string;
      reference: string;
      comment: string;
      state: string;
    };
  }
  beforeAll(async () => {
    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, "user" RESTART IDENTITY CASCADE`,
    );
    for (const name of ["admin", "recepcion", "other"]) {
      const email = `${name}@transbank.test`;
      const { user } = await auth.api.createUser({
        body: { email, password: "FictionalPass123!", name, data: { emailVerified: true } },
      });
      await db.insert(identityAccounts).values({ id: user.id, email, passwordHash: "better-auth" });
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ email, password: "FictionalPass123!" }),
        }),
      );
      expect(response.status).toBe(200);
      people[name] = {
        id: user.id,
        cookie: response.headers
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
      .values([{ name: "Gym A Transbank" }, { name: "Gym B Transbank" }])
      .returning();
    org = rows[0]!.id;
    other = rows[1]!.id;
    await db.insert(staffAssignments).values(
      Object.entries(people).map(([name, person]) => ({
        organizationId: name === "other" ? other : org,
        accountId: person.id,
        role: name === "recepcion" ? ("recepcion" as const) : ("admin" as const),
      })),
    );
    const [m] = await db
      .insert(members)
      .values({ organizationId: org, fullName: "Socio Transbank" })
      .returning();
    member = m!.id;
    const [p] = await db
      .insert(plans)
      .values({
        organizationId: org,
        name: "Mensual",
        priceCents: 30000,
        durationDays: 30,
        coverage: "unlimited",
      })
      .returning();
    const [ms] = await db
      .insert(memberships)
      .values({ organizationId: org, memberId: member, planId: p!.id })
      .returning();
    membership = ms!.id;
    await new CashService(db).open(actor(), 1000);
  });
  afterAll(async () => {
    await app?.close();
  });

  const compensate = (id: string, payload: Record<string, unknown>, person = "admin") =>
    request(person, "POST", `payments/${id}/adjustments`, payload);
  const intent = (amountCents = 5000) => ({
    idempotencyKey: randomUUID(),
    kind: "refund",
    amountCents,
    reason: "Devolución manual autorizada",
  });
  async function validated() {
    const row = await register();
    expect((await request("admin", "POST", `payments/${row.id}/validate`, {})).statusCode).toBe(
      200,
    );
    return row;
  }
  const ledger = () => db.execute(sql`SELECT * FROM financial_adjustments`);

  it("CA-1 preserva pago/movimiento/membresía y persiste salida auditada", async () => {
    const row = await validated();
    const before = {
      payments: await db.select().from(payments),
      movements: await db.select().from(cashMovements),
      memberships: await db.select().from(memberships),
    };
    const response = await compensate(row.id, intent());
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      paymentId: row.id,
      kind: "refund",
      amountCents: 5000,
      method: "transbank",
      actorId: people.admin!.id,
    });
    expect(await db.select().from(payments)).toEqual(before.payments);
    expect(await db.select().from(cashMovements)).toEqual(before.movements);
    expect(await db.select().from(memberships)).toEqual(before.memberships);
    expect(await ledger()).toHaveLength(1);
    const events = await db.select().from(auditLog);
    expect(events.filter((e) => e.action === "payment.compensate")).toHaveLength(1);
    const listing = await request("recepcion", "GET", `payments/${row.id}/adjustments`);
    expect(listing.json().data).toMatchObject({ compensatedCents: 5000, remainingCents: 25000 });
  });
  it("CA-1 rechaza provisional, rechazado y caja cerrada sin filas compensatorias", async () => {
    const pending = await register();
    expect((await compensate(pending.id, intent())).statusCode).toBe(409);
    expect(
      (await request("admin", "POST", `payments/${pending.id}/reject`, { reason: "No confirmado" }))
        .statusCode,
    ).toBe(200);
    expect((await compensate(pending.id, intent())).statusCode).toBe(409);
    const paid = await validated();
    const shift = await new CashService(db).findOpenSession(org);
    await new CashService(db).close(actor(), shift!.id, 31000);
    expect((await compensate(paid.id, intent())).statusCode).toBe(409);
    expect(await ledger()).toHaveLength(0);
  });
  it("CA-2 deniega recepción, tenant ajeno y evidencia/importes inválidos", async () => {
    const paid = await validated();
    expect((await compensate(paid.id, intent(), "recepcion")).statusCode).toBe(403);
    expect((await compensate(paid.id, intent(), "other")).statusCode).toBe(404);
    expect((await request("other", "GET", `payments/${paid.id}/adjustments`)).statusCode).toBe(404);
    for (const invalid of [
      { amountCents: 0 },
      { amountCents: -1 },
      { amountCents: 1.5 },
      { reason: " " },
      { idempotencyKey: "bad" },
      { kind: "income" },
    ]) {
      expect((await compensate(paid.id, { ...intent(), ...invalid })).statusCode).toBe(400);
    }
    expect((await compensate(paid.id, intent(30001))).statusCode).toBe(409);
    expect(await ledger()).toHaveLength(0);
  });
  it("CA-3 dos compensaciones concurrentes no exceden lo cobrado", async () => {
    const paid = await validated();
    const responses = await Promise.all([
      compensate(paid.id, intent(20000)),
      compensate(paid.id, intent(20000)),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await ledger()).toHaveLength(1);
    expect(
      (await request("admin", "GET", `payments/${paid.id}/adjustments`)).json().data.remainingCents,
    ).toBe(10000);
  });
  it("CA-3 replay concurrente/post-cierre conserva fila, actor y auditoría únicos", async () => {
    const paid = await validated(),
      payload = intent();
    const responses = await Promise.all([
      compensate(paid.id, payload),
      compensate(paid.id, payload),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(responses[0]!.json().data.id).toBe(responses[1]!.json().data.id);
    expect(await ledger()).toHaveLength(1);
    expect(
      (await db.select().from(auditLog)).filter((e) => e.action === "payment.compensate"),
    ).toHaveLength(1);
    expect((await compensate(paid.id, { ...payload, amountCents: 6000 })).statusCode).toBe(409);
    const otherPaid = await validated();
    expect((await compensate(otherPaid.id, payload)).statusCode).toBe(409);
    const shift = await new CashService(db).findOpenSession(org);
    await new CashService(db).close(actor(), shift!.id, 56000);
    const replay = await compensate(paid.id, payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.id).toBe(responses[0]!.json().data.id);
    expect(await ledger()).toHaveLength(1);
  });
  it("CA-3 cierre concurrente no pierde una salida ni permite alterar turno cerrado", async () => {
    const paid = await validated();
    const shift = await new CashService(db).findOpenSession(org);
    const [refund, closed] = await Promise.all([
      compensate(paid.id, intent()),
      request("recepcion", "POST", `cash/sessions/${shift!.id}/close`, {
        declaredClosingCents: 31000,
      }),
    ]);
    expect([200, 409]).toContain(refund.statusCode);
    expect(closed.statusCode).toBe(200);
    const total = (await ledger()).reduce((sum, row) => sum + Number(row.amount_cents), 0);
    expect(closed.json().data.expectedClosingCents).toBe(31000 - total);
    const snapshot = closed.json().data;
    expect((await compensate(paid.id, intent(1000))).statusCode).toBe(409);
    expect(
      (await request("recepcion", "GET", `cash/sessions/${shift!.id}`)).json().data.session,
    ).toEqual(snapshot);
  });
  it("CA-4 reporte/caja conservan bruto y calculan salidas/neto y cierre", async () => {
    const paid = await validated();
    expect((await compensate(paid.id, intent())).statusCode).toBe(200);
    expect(
      (
        await compensate(paid.id, {
          ...intent(1000),
          kind: "adjustment",
          reason: "Corrección manual",
        })
      ).statusCode,
    ).toBe(200);
    const cash = new CashService(db),
      shift = await cash.findOpenSession(org);
    const detail = (await request("admin", "GET", `cash/sessions/${shift!.id}`)).json().data;
    expect(detail.movements).toHaveLength(1);
    expect(detail.adjustments).toHaveLength(2);
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    expect((await request("admin", "GET", `reports/daily?date=${date}`)).json().data).toMatchObject(
      { income: 30000, refunds: 5000, adjustments: 1000, outflow: 6000, net: 24000 },
    );
    expect(await cash.consolidateDay(org, new Date())).toMatchObject({
      totalCents: 30000,
      adjustmentTotalCents: 6000,
      netCents: 24000,
      adjustmentCount: 2,
    });
    expect(await cash.close(actor(), shift!.id, 25000)).toMatchObject({
      expectedClosingCents: 25000,
      discrepancyCents: 0,
    });
  });
});
