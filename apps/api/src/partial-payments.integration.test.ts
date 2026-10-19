import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createDb,
  organizations,
  identityAccounts,
  staffAssignments,
  members,
  membershipPeriods,
  payments,
  cashMovements,
  sessions,
} from "@gym/db";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("SPEC 019 — Abonos parciales con activación al 100% y conciliación", () => {
  const db = createDb(
    process.env.TEST_DATABASE_URL ??
      "postgres://gym:gym-local-dev@localhost:55432/gym_test_partial_payments",
  );
  const auth = createAuth({
    db,
    secret: "partial-payments-fictional-secret-32-chars",
    baseURL: "http://localhost:3000",
  });
  let app: Awaited<ReturnType<typeof buildServer>>;
  const people: Record<string, { id: string; cookie: string }> = {};
  let orgA = "",
    orgB = "",
    memberA = "",
    socioUserId = "";

  const request = (
    person: string,
    method: "GET" | "POST" | "PATCH",
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url: `/api/v1/${url}`,
      ...(payload === undefined ? {} : { payload }),
      headers: { cookie: people[person]!.cookie, origin: "http://localhost:3000" },
    });

  beforeAll(async () => {
    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, "user" RESTART IDENTITY CASCADE`,
    );
    for (const name of ["admin1", "admin2", "recepcionA", "instructorA", "socioA", "adminB"]) {
      const email = `${name}@partial.test`;
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
    socioUserId = people.socioA!.id;
    app = await buildServer({ db, auth });
    await app.ready();
  });

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE organizations, members, staff_assignments, plans, memberships, membership_periods, payments, cash_sessions, cash_movements, sessions, bookings, credit_movements, audit_log RESTART IDENTITY CASCADE`,
    );

    const [oA] = await db.insert(organizations).values({ name: "Gym Principal" }).returning();
    const [oB] = await db.insert(organizations).values({ name: "Gym Secundario" }).returning();
    orgA = oA!.id;
    orgB = oB!.id;

    await db.insert(staffAssignments).values([
      { organizationId: orgA, accountId: people.admin1!.id, role: "admin", active: true },
      { organizationId: orgA, accountId: people.admin2!.id, role: "admin", active: true },
      { organizationId: orgA, accountId: people.recepcionA!.id, role: "recepcion", active: true },
      { organizationId: orgA, accountId: people.instructorA!.id, role: "instructor", active: true },
      { organizationId: orgB, accountId: people.adminB!.id, role: "admin", active: true },
    ]);

    const [mA] = await db
      .insert(members)
      .values({
        organizationId: orgA,
        accountId: socioUserId,
        fullName: "Socio Principal",
        contactEmail: "socioA@partial.test",
        qrToken: "qr-token-partial-a",
      })
      .returning();
    memberA = mA!.id;

    await db.insert(members).values({
      organizationId: orgB,
      fullName: "Socio Otro Tenant",
      contactEmail: "socioB@partial.test",
      qrToken: "qr-token-partial-b",
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("BDD-1 / CA-1: Abono parcial validado ingresa a caja pero NO activa membership_period ni derechos hasta 100%", async () => {
    // 1. Crear plan de $30.000 con 8 clases grupales
    const resPlan = await request("admin1", "POST", "plans", {
      name: "Plan 8 Clases",
      priceCents: 30000,
      durationDays: 30,
      coverage: "limited",
      classCredits: { grupal: 8, fija: 0, cita: 0 },
    });
    expect(resPlan.statusCode).toBe(201);
    const plan = resPlan.json().data;

    // 2. Asignar membresía
    const resMem = await request("recepcionA", "POST", "memberships", {
      memberId: memberA,
      planId: plan.id,
    });
    expect(resMem.statusCode).toBe(201);
    const membership = resMem.json().data;

    // 3. Abrir turno de caja
    const resOpen = await request("recepcionA", "POST", "cash/sessions", { openingCents: 10000 });
    expect(resOpen.statusCode).toBe(201);
    const sessionOpen = resOpen.json().data;
    expect(sessionOpen.reconciliationState).toBe("abierta");

    // 4. Recepción registra primer abono parcial de $10.000
    const resPay1 = await request("recepcionA", "POST", "payments", {
      membershipId: membership.id,
      amountCents: 10000,
      method: "cash",
    });
    expect(resPay1.statusCode).toBe(201);
    const pay1 = resPay1.json().data;
    expect(pay1.state).toBe("provisional");

    // 5. Admin valida el primer abono
    const resVal1 = await request("admin1", "POST", `payments/${pay1.id}/validate`);
    expect(resVal1.statusCode).toBe(200);
    const val1 = resVal1.json().data;
    expect(val1.state).toBe("validated");
    expect(val1.periodId).toBeNull();

    // 6. Verificar caja: sumó $10.000
    const resCash = await request("admin1", "GET", `cash/sessions/${sessionOpen.id}`);
    expect(resCash.statusCode).toBe(200);
    const cashData = resCash.json().data;
    expect(cashData.movements).toHaveLength(1);
    expect(cashData.movements[0].amountCents).toBe(10000);

    // 7. Verificar estado de membresía: cyclePaidCents=10000, cycleRemainingCents=20000
    const resMemGet = await request("recepcionA", "GET", `memberships/${membership.id}`);
    expect(resMemGet.statusCode).toBe(200);
    const memData = resMemGet.json().data;
    expect(memData.state).toBe("pending_payment");
    expect(memData.cyclePaidCents).toBe(10000);
    expect(memData.cycleRemainingCents).toBe(20000);
    expect(memData.cycleTargetCents).toBe(30000);

    // 8. Verificar que NO hay membership_periods emitidos ni créditos disponibles
    const periods = await db.select().from(membershipPeriods).where(sql`${membershipPeriods.membershipId} = ${membership.id}`);
    expect(periods).toHaveLength(0);

    // 9. Checkin denegado por falta de cobertura activa
    const resCheckin = await request("recepcionA", "POST", "checkin", { qrToken: "qr-token-partial-a" });
    expect(resCheckin.statusCode).toBe(200);
    expect(resCheckin.json().data.allowed).toBe(false);

    // 10. Reservas denegadas: no hay créditos
    const [sess] = await db.insert(sessions).values({
      organizationId: orgA,
      type: "grupal",
      instructorId: people.instructorA!.id,
      startsAt: new Date(Date.now() + 86400000),
      endsAt: new Date(Date.now() + 90000000),
      capacity: 10,
      createdBy: people.admin1!.id,
    }).returning();
    const resBook = await request("socioA", "POST", "bookings", { sessionId: sess!.id });
    expect(resBook.statusCode).toBe(409);
  });

  it("BDD-1 / CA-2: Segundo abono completa 100%, emite período único y vincula ambos pagos", async () => {
    // 1. Setup plan y membresía
    const resPlan = await request("admin1", "POST", "plans", {
      name: "Plan Mensual",
      priceCents: 30000,
      durationDays: 30,
      coverage: "limited",
      classCredits: { grupal: 8, fija: 0, cita: 0 },
    });
    const plan = resPlan.json().data;
    const resMem = await request("recepcionA", "POST", "memberships", { memberId: memberA, planId: plan.id });
    const membership = resMem.json().data;

    await request("recepcionA", "POST", "cash/sessions", { openingCents: 5000 });

    // Abono 1: $10.000
    const resPay1 = await request("recepcionA", "POST", "payments", {
      membershipId: membership.id,
      amountCents: 10000,
      method: "cash",
    });
    await request("admin1", "POST", `payments/${resPay1.json().data.id}/validate`);

    // Intento de registrar abono que excede el saldo restante ($25.000 > $20.000) -> 409
    const resOver = await request("recepcionA", "POST", "payments", {
      membershipId: membership.id,
      amountCents: 25000,
      method: "cash",
    });
    expect(resOver.statusCode).toBe(409);

    // Abono 2 que completa el 100%: $20.000
    const resPay2 = await request("recepcionA", "POST", "payments", {
      membershipId: membership.id,
      amountCents: 20000,
      method: "cash",
    });
    expect(resPay2.statusCode).toBe(201);
    const pay2 = resPay2.json().data;

    // Validar abono 2
    const resVal2 = await request("admin1", "POST", `payments/${pay2.id}/validate`);
    expect(resVal2.statusCode).toBe(200);

    // Período único emitido
    const periods = await db.select().from(membershipPeriods).where(sql`${membershipPeriods.membershipId} = ${membership.id}`);
    expect(periods).toHaveLength(1);
    const period = periods[0]!;
    expect(period.paymentId).toBe(pay2.id); // pago completador
    expect(period.priceCents).toBe(30000);
    expect(period.grupalCredits).toBe(8);

    // Ambos pagos quedan vinculados al período
    const pRows = await db.select().from(payments).where(sql`${payments.membershipId} = ${membership.id}`).orderBy(payments.createdAt);
    expect(pRows).toHaveLength(2);
    expect(pRows[0]!.periodId).toBe(period.id);
    expect(pRows[1]!.periodId).toBe(period.id);

    // Membresía activa
    const resMemActive = await request("recepcionA", "GET", `memberships/${membership.id}`);
    expect(resMemActive.json().data.state).toBe("active");
    expect(resMemActive.json().data.cyclePaidCents).toBe(0); // ciclo resuelto
    expect(resMemActive.json().data.cycleRemainingCents).toBe(30000); // listo para siguiente renovación

    // Check-in permitido
    const resCheckin = await request("recepcionA", "POST", "checkin", { qrToken: "qr-token-partial-a" });
    expect(resCheckin.statusCode).toBe(200);
    expect(resCheckin.json().data.allowed).toBe(true);
  });

  it("BDD-2 / CA-2: Bloqueo de sobrepago concurrente al validar dos abonos simultáneamente", async () => {
    const resPlan = await request("admin1", "POST", "plans", {
      name: "Plan Mensual",
      priceCents: 20000,
      durationDays: 30,
      coverage: "unlimited",
    });
    const plan = resPlan.json().data;
    const resMem = await request("recepcionA", "POST", "memberships", { memberId: memberA, planId: plan.id });
    const membership = resMem.json().data;

    await request("recepcionA", "POST", "cash/sessions", { openingCents: 5000 });

    // Primer abono de $10.000 validado
    const p1 = (await request("recepcionA", "POST", "payments", {
      membershipId: membership.id,
      amountCents: 10000,
      method: "cash",
    })).json().data;
    await request("admin1", "POST", `payments/${p1.id}/validate`);

    // Dos abonos provisionales de $10.000 registrados por error
    const p2a = (await request("recepcionA", "POST", "payments", {
      membershipId: membership.id,
      amountCents: 10000,
      method: "cash",
    })).json().data;
    const p2b = (await request("recepcionA", "POST", "payments", {
      membershipId: membership.id,
      amountCents: 10000,
      method: "cash",
    })).json().data;

    // Validación concurrente por admin1 y admin2
    const [resA, resB] = await Promise.all([
      request("admin1", "POST", `payments/${p2a.id}/validate`),
      request("admin2", "POST", `payments/${p2b.id}/validate`),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    // Solo se emitió un único período
    const periods = await db.select().from(membershipPeriods).where(sql`${membershipPeriods.membershipId} = ${membership.id}`);
    expect(periods).toHaveLength(1);

    // Solo se crearon dos movimientos de caja en total ($10.000 + $10.000 = $20.000)
    const movs = await db.select().from(cashMovements).where(sql`${cashMovements.organizationId} = ${orgA}`);
    expect(movs).toHaveLength(2);
    expect(movs.reduce((sum, m) => sum + m.amountCents, 0)).toBe(20000);
  });

  it("CA-3: Estados explícitos de conciliación (abierta, cuadrada, con_diferencia) y resumen en reporte diario", async () => {
    // Abrir turno
    const resOpen = await request("recepcionA", "POST", "cash/sessions", { openingCents: 5000 });
    const session = resOpen.json().data;
    expect(session.reconciliationState).toBe("abierta");

    // Validar abono parcial de $15.000 para un plan de $30.000
    const resPlan = await request("admin1", "POST", "plans", {
      name: "Plan A",
      priceCents: 30000,
      durationDays: 30,
      coverage: "unlimited",
    });
    const plan = resPlan.json().data;
    const resMem = await request("recepcionA", "POST", "memberships", { memberId: memberA, planId: plan.id });
    const p = (await request("recepcionA", "POST", "payments", {
      membershipId: resMem.json().data.id,
      amountCents: 15000,
      method: "cash",
    })).json().data;
    await request("admin1", "POST", `payments/${p.id}/validate`);

    // Reporte diario muestra partialCyclesPendingCents = 15.000 y partialCyclesCount = 1
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
    const resRep = await request("admin1", "GET", `reports/daily?date=${today}`);
    expect(resRep.statusCode).toBe(200);
    const rep = resRep.json().data;
    expect(rep.partialCyclesPendingCents).toBe(15000);
    expect(rep.partialCyclesCount).toBe(1);

    // Cerrar turno cuadrado (declarado = 5000 + 15000 = 20000)
    const resClose = await request("recepcionA", "POST", `cash/sessions/${session.id}/close`, {
      declaredClosingCents: 20000,
    });
    expect(resClose.statusCode).toBe(200);
    expect(resClose.json().data.reconciliationState).toBe("cuadrada");

    // Abrir segundo turno y cerrarlo con diferencia
    const s2 = (await request("recepcionA", "POST", "cash/sessions", { openingCents: 1000 })).json().data;
    const resCloseDiff = await request("recepcionA", "POST", `cash/sessions/${s2.id}/close`, {
      declaredClosingCents: 500, // esperada 1000, diferencia -500
    });
    expect(resCloseDiff.statusCode).toBe(200);
    expect(resCloseDiff.json().data.reconciliationState).toBe("con_diferencia");

    // Listar turnos
    const resList = await request("admin1", "GET", "cash/sessions");
    expect(resList.statusCode).toBe(200);
    const list = resList.json().data;
    expect(list.some((s: { reconciliationState: string }) => s.reconciliationState === "cuadrada")).toBe(true);
    expect(list.some((s: { reconciliationState: string }) => s.reconciliationState === "con_diferencia")).toBe(true);
  });

  it("CA-4: Separación de funciones, roles denegados y cross-tenant", async () => {
    const resPlan = await request("admin1", "POST", "plans", {
      name: "Plan A",
      priceCents: 10000,
      durationDays: 30,
      coverage: "unlimited",
    });
    const plan = resPlan.json().data;
    const resMem = await request("admin1", "POST", "memberships", { memberId: memberA, planId: plan.id });
    await request("admin1", "POST", "cash/sessions", { openingCents: 1000 });

    // Admin1 registra pago
    const p = (await request("admin1", "POST", "payments", {
      membershipId: resMem.json().data.id,
      amountCents: 10000,
      method: "cash",
    })).json().data;

    // Admin1 no puede validar su propio pago -> 403
    const resSelf = await request("admin1", "POST", `payments/${p.id}/validate`);
    expect(resSelf.statusCode).toBe(403);

    // Recepción, instructor y socio no pueden validar pagos -> 403
    expect((await request("recepcionA", "POST", `payments/${p.id}/validate`)).statusCode).toBe(403);
    expect((await request("instructorA", "POST", `payments/${p.id}/validate`)).statusCode).toBe(403);
    expect((await request("socioA", "POST", `payments/${p.id}/validate`)).statusCode).toBe(403);

    // Cross-tenant: Admin de orgB intenta validar pago de orgA -> 404
    const resCross = await request("adminB", "POST", `payments/${p.id}/validate`);
    expect(resCross.statusCode).toBe(404);
  });
});
