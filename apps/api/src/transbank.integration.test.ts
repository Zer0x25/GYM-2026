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
import { OfflineService, type SyncEventInput } from "./services/offline.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "SPEC 012 — Transbank manual, PostgreSQL real",
  () => {
    const db = createDb(
      process.env.TEST_DATABASE_URL ??
        "postgres://gym:gym-local-dev@localhost:55432/gym_test_transbank",
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
        await db
          .insert(identityAccounts)
          .values({ id: user.id, email, passwordHash: "better-auth" });
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

    it("CA-1 persiste operación y comentario, sin derechos ni movimiento provisional", async () => {
      const row = await register();
      expect(row).toMatchObject({
        method: "transbank",
        reference: "OP-123",
        comment: "Terminal externo recepción",
        state: "provisional",
      });
      expect(await db.select().from(payments)).toMatchObject([
        { id: row.id, method: "transbank", comment: row.comment },
      ]);
      expect(await db.select().from(cashMovements)).toHaveLength(0);
      expect((await db.select().from(memberships))[0]?.endAt).toBeNull();
      expect(
        (await db.select().from(auditLog)).some(
          (e) => e.action === "payment.register" && e.entityId === row.id,
        ),
      ).toBe(true);
    });
    it("CA-1 rechaza entradas sin evidencia y método desconocido sin persistir pagos", async () => {
      for (const invalid of [
        { reference: " " },
        { comment: " " },
        { reference: undefined },
        { comment: undefined },
        { method: "card-api" },
      ]) {
        expect(
          (await request("recepcion", "POST", "payments", { ...body(), ...invalid })).statusCode,
        ).toBe(400);
      }
      expect(await db.select().from(payments)).toHaveLength(0);
    });
    it("CA-2 conserva separación de funciones, aislamiento y movimiento único", async () => {
      const row = await register();
      expect(
        (await request("recepcion", "POST", `payments/${row.id}/validate`, {})).statusCode,
      ).toBe(403);
      expect((await request("other", "POST", `payments/${row.id}/validate`, {})).statusCode).toBe(
        404,
      );
      expect((await request("other", "GET", `payments/${row.id}`)).statusCode).toBe(404);
      const self = await register("admin");
      expect((await request("admin", "POST", `payments/${self.id}/validate`, {})).statusCode).toBe(
        403,
      );
      expect((await request("admin", "POST", `payments/${row.id}/validate`, {})).statusCode).toBe(
        200,
      );
      expect((await request("admin", "POST", `payments/${row.id}/validate`, {})).statusCode).toBe(
        409,
      );
      expect(await db.select().from(cashMovements)).toMatchObject([
        { paymentId: row.id, method: "transbank", amountCents: 30000 },
      ]);
      expect((await db.select().from(memberships))[0]?.endAt).not.toBeNull();
    });
    it("CA-3 suma los tres métodos y cierra sin reclasificar Transbank", async () => {
      for (const method of ["cash", "transfer", "transbank"]) {
        const row = await register("recepcion", { ...body(), method });
        expect((await request("admin", "POST", `payments/${row.id}/validate`, {})).statusCode).toBe(
          200,
        );
      }
      const cash = new CashService(db);
      const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
      const report = (await request("admin", "GET", `reports/daily?date=${date}`)).json().data;
      expect(report).toMatchObject({
        cash: 30000,
        transfer: 30000,
        transbank: 30000,
        income: 90000,
        movements: 3,
      });
      const consolidation = await cash.consolidateDay(org, new Date());
      expect(consolidation).toMatchObject({
        byMethod: { cash: 30000, transfer: 30000, transbank: 30000 },
        totalCents: 90000,
        movementCount: 3,
      });
      const session = await cash.findOpenSession(org);
      const closed = await cash.close(actor(), session!.id, 91000);
      expect(closed).toMatchObject({
        state: "closed",
        expectedClosingCents: 91000,
        discrepancyCents: 0,
      });
    });
    it("CA-4 replay offline conserva folio independiente y una sola evidencia de pago", async () => {
      const offline = new OfflineService(db, "test-transbank-offline-secret-at-least-32");
      await offline.setPolicy(actor(), true);
      const device = await offline.registerDevice(actor(), {
        accountId: people.admin!.id,
        label: "Terminal ficticio",
      });
      const lease = await offline.lease(actor(), device.id);
      const event = {
        eventId: randomUUID(),
        type: "cobro_provisional",
        memberId: member,
        folioExterno: "FOLIO-77",
        capturedAt: new Date().toISOString(),
        amountCents: 30000,
        method: "transbank",
        payload: JSON.stringify({
          permit: lease.permit,
          proof: lease.members[0]!.proof,
          reference: "OP-777",
          comment: "Terminal externo",
        }),
      } as unknown as SyncEventInput;
      const first = await offline.syncLeased(actor(), { deviceId: device.id, events: [event] });
      const replay = await offline.syncLeased(actor(), { deviceId: device.id, events: [event] });
      expect(first.results[0]?.paymentId).toBeTruthy();
      expect(replay.results[0]?.paymentId).toBe(first.results[0]?.paymentId);
      expect(await db.select().from(payments)).toMatchObject([
        {
          state: "provisional",
          method: "transbank",
          reference: "OP-777",
          comment: "Terminal externo",
        },
      ]);
      expect(await db.select().from(payments)).toHaveLength(1);
      expect(await db.select().from(cashMovements)).toHaveLength(0);
      expect((await offline.listEvents(org, device.id))[0]?.folioExterno).toBe("FOLIO-77");
      const invalid = {
        ...event,
        eventId: randomUUID(),
        payload: JSON.stringify({ permit: lease.permit, proof: lease.members[0]!.proof }),
      };
      expect(
        (await offline.syncLeased(actor(), { deviceId: device.id, events: [invalid] })).results[0]
          ?.status,
      ).toBe("rechazado");
      expect(await db.select().from(payments)).toHaveLength(1);
      expect((await offline.listEvents(org, device.id)).some((e) => e.state === "rechazado")).toBe(
        true,
      );
    });
  },
);
