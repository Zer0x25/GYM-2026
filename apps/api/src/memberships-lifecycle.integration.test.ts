import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  createDb,
  organizations,
  identityAccounts,
  staffAssignments,
  members,
  memberships,
  membershipPeriods,
  cashSessions,
  sessions,
  bookings,
  bookingCancellations,
  creditMovements,
} from "@gym/db";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("SPEC 017 — Ciclo de membresías, pausas y catálogo", () => {
  const db = createDb(
    process.env.TEST_DATABASE_URL ??
      "postgres://gym:gym-local-dev@localhost:55432/gym_test_memberships_lifecycle",
  );
  const auth = createAuth({
    db,
    secret: "lifecycle-fictional-test-secret-at-least-32",
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
    for (const name of ["adminA", "recepcionA", "instructorA", "socioA", "adminB"]) {
      const email = `${name}@lifecycle.test`;
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
      sql`TRUNCATE organizations, members, staff_assignments, plans, memberships, membership_periods, payments, cash_sessions, cash_movements, sessions, bookings, booking_cancellations, credit_movements, audit_log RESTART IDENTITY CASCADE`,
    );

    const [oA] = await db.insert(organizations).values({ name: "Gimnasio A" }).returning();
    const [oB] = await db.insert(organizations).values({ name: "Gimnasio B" }).returning();
    orgA = oA!.id;
    orgB = oB!.id;

    await db.insert(staffAssignments).values([
      { organizationId: orgA, accountId: people.adminA!.id, role: "admin", active: true },
      { organizationId: orgA, accountId: people.recepcionA!.id, role: "recepcion", active: true },
      { organizationId: orgA, accountId: people.instructorA!.id, role: "instructor", active: true },
      { organizationId: orgB, accountId: people.adminB!.id, role: "admin", active: true },
    ]);

    const [mA] = await db
      .insert(members)
      .values({
        organizationId: orgA,
        accountId: socioUserId,
        fullName: "Socio A",
        contactEmail: "socioA@lifecycle.test",
        qrToken: "qr-token-socio-a",
      })
      .returning();
    memberA = mA!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("CA-1: PATCH /api/v1/plans/:id incrementa versión, no altera membership_periods previos y plan inactivo rechaza nuevas membresías", async () => {
    // 1. Crear plan
    const resCreate = await request("adminA", "POST", "plans", {
      name: "Plan Trimestral",
      priceCents: 90000,
      durationDays: 30,
      coverage: "limited",
      classCredits: { grupal: 12, fija: 0, cita: 0 },
    });
    expect(resCreate.statusCode).toBe(201);
    const plan = resCreate.json().data;
    expect(plan.version ?? 1).toBe(1);

    // 2. Asignar al socio y validar pago
    const resMem = await request("recepcionA", "POST", "memberships", {
      memberId: memberA,
      planId: plan.id,
    });
    expect(resMem.statusCode).toBe(201);
    const membership = resMem.json().data;

    // Abrir turno para validar pago
    await db.insert(cashSessions).values({
      organizationId: orgA,
      openedBy: people.adminA!.id,
      state: "open",
      openingCents: 0,
    });

    const resPay = await request("recepcionA", "POST", "payments", {
      membershipId: membership.id,
      amountCents: 90000,
      method: "cash",
    });
    expect(resPay.statusCode).toBe(201);
    const payment = resPay.json().data;

    const resVal = await request("adminA", "POST", `payments/${payment.id}/validate`);
    expect(resVal.statusCode).toBe(200);

    // Verificar que el período emitido tiene los datos originales
    const periodsBefore = await db.select().from(membershipPeriods);
    expect(periodsBefore).toHaveLength(1);
    expect(periodsBefore[0]!.priceCents).toBe(90000);
    expect(periodsBefore[0]!.grupalCredits).toBe(12);

    // 3. Editar plan: subir precio a 110.000 y bajar a 8 grupales
    const resUpdate = await request("adminA", "PATCH", `plans/${plan.id}`, {
      priceCents: 110000,
      classCredits: { grupal: 8, fija: 0, cita: 0 },
    });
    expect(resUpdate.statusCode).toBe(200);
    const updatedPlan = resUpdate.json().data;
    expect(updatedPlan.priceCents).toBe(110000);
    expect(updatedPlan.grupalCredits).toBe(8);
    expect(updatedPlan.version).toBe(2);

    // Invariante: membership_periods existente sigue intacto con 90.000 y 12
    const periodsAfter = await db.select().from(membershipPeriods);
    expect(periodsAfter[0]!.priceCents).toBe(90000);
    expect(periodsAfter[0]!.grupalCredits).toBe(12);

    // Validación: si se intenta pasar a limited sin classCredits devuelve 400
    const resBad = await request("adminA", "PATCH", `plans/${plan.id}`, {
      coverage: "limited",
      classCredits: null,
    });
    expect(resBad.statusCode).toBe(400);

    // Desactivar plan y comprobar que rechaza nueva membresía con 409
    const resDeact = await request("adminA", "PATCH", `plans/${plan.id}`, { active: false });
    expect(resDeact.statusCode).toBe(200);

    const [m2] = await db
      .insert(members)
      .values({ organizationId: orgA, fullName: "Socio Dos" })
      .returning();
    const resMemBlocked = await request("recepcionA", "POST", "memberships", {
      memberId: m2!.id,
      planId: plan.id,
    });
    expect(resMemBlocked.statusCode).toBe(409);
  });

  it("CA-2: POST /api/v1/memberships/:id/schedule-plan-change programa nextPlanId y lo aplica al validar renovación", async () => {
    const plan1 = (
      await request("adminA", "POST", "plans", {
        name: "Plan Mensual Base",
        priceCents: 30000,
        durationDays: 30,
        coverage: "unlimited",
      })
    ).json().data;

    const plan2 = (
      await request("adminA", "POST", "plans", {
        name: "Plan Premium Trimestral",
        priceCents: 80000,
        durationDays: 90,
        coverage: "unlimited",
      })
    ).json().data;

    // Crear membresía y validar primer pago
    const ms = (
      await request("recepcionA", "POST", "memberships", {
        memberId: memberA,
        planId: plan1.id,
      })
    ).json().data;

    await db.insert(cashSessions).values({
      organizationId: orgA,
      openedBy: people.adminA!.id,
      state: "open",
      openingCents: 0,
    });

    const p1 = (
      await request("recepcionA", "POST", "payments", {
        membershipId: ms.id,
        amountCents: 30000,
        method: "cash",
      })
    ).json().data;
    await request("adminA", "POST", `payments/${p1.id}/validate`);

    // Programar cambio de plan hacia plan2
    const resSchedule = await request("recepcionA", "POST", `memberships/${ms.id}/schedule-plan-change`, {
      nextPlanId: plan2.id,
    });
    expect(resSchedule.statusCode).toBe(200);
    expect(resSchedule.json().data.nextPlanId).toBe(plan2.id);

    // Período actual en curso no se modifica
    const [currentPeriod] = await db.select().from(membershipPeriods);
    expect(currentPeriod!.planName).toBe("Plan Mensual Base");

    // Registrar y validar pago de renovación
    const pRenewal = (
      await request("recepcionA", "POST", "payments", {
        membershipId: ms.id,
        amountCents: 80000,
        method: "cash",
      })
    ).json().data;

    const resVal = await request("adminA", "POST", `payments/${pRenewal.id}/validate`);
    expect(resVal.statusCode).toBe(200);

    // La membresía ahora tiene planId = plan2.id y nextPlanId = null
    const [updatedMs] = await db.select().from(memberships).where(sql`id = ${ms.id}`);
    expect(updatedMs!.planId).toBe(plan2.id);
    expect(updatedMs!.nextPlanId).toBeNull();

    // Se emitió un nuevo período con las condiciones de plan2
    const periods = await db.select().from(membershipPeriods).orderBy(membershipPeriods.startsAt);
    expect(periods).toHaveLength(2);
    expect(periods[1]!.planName).toBe("Plan Premium Trimestral");
    expect(periods[1]!.durationDays).toBe(90);
  });

  it("CA-3: POST /api/v1/memberships/:id/pauses extiende período, deniega check-in/reservas en intervalo y restituye créditos cancelados", async () => {
    // 1. Crear plan limitado con 1 crédito grupal
    const plan = (
      await request("adminA", "POST", "plans", {
        name: "Plan Pausas",
        priceCents: 40000,
        durationDays: 30,
        coverage: "limited",
        classCredits: { grupal: 5, fija: 0, cita: 0 },
      })
    ).json().data;

    const ms = (
      await request("recepcionA", "POST", "memberships", {
        memberId: memberA,
        planId: plan.id,
      })
    ).json().data;

    await db.insert(cashSessions).values({
      organizationId: orgA,
      openedBy: people.adminA!.id,
      state: "open",
      openingCents: 0,
    });

    const pay = (
      await request("recepcionA", "POST", "payments", {
        membershipId: ms.id,
        amountCents: 40000,
        method: "cash",
      })
    ).json().data;
    await request("adminA", "POST", `payments/${pay.id}/validate`);

    const [period] = await db.select().from(membershipPeriods);
    const start = new Date(period!.startsAt);
    const originalEnd = new Date(period!.endsAt);

    // Crear sesión en el día 10 (dentro del período)
    const sessionDay10Starts = new Date(start.getTime() + 10 * 24 * 3600_000);
    const sessionDay10Ends = new Date(sessionDay10Starts.getTime() + 3600_000);
    const [session10] = await db
      .insert(sessions)
      .values({
        organizationId: orgA,
        type: "grupal",
        instructorId: people.instructorA!.id,
        startsAt: sessionDay10Starts,
        endsAt: sessionDay10Ends,
        capacity: 10,
        state: "programada",
        createdBy: people.adminA!.id,
      })
      .returning();

    // Socio reserva la clase del día 10 (compromete 1 crédito grupal)
    const resBooking = await request("socioA", "POST", "bookings", { sessionId: session10!.id });
    expect(resBooking.statusCode).toBe(201);
    const booking = resBooking.json().data;

    // Pausa de 5 días: del día 8 al día 13
    const pauseStarts = new Date(start.getTime() + 8 * 24 * 3600_000).toISOString();
    const pauseEnds = new Date(start.getTime() + 13 * 24 * 3600_000).toISOString();
    const idempotencyKey = randomUUID();

    // 2. Registrar pausa (solo admin)
    const resPause = await request("adminA", "POST", `memberships/${ms.id}/pauses`, {
      idempotencyKey,
      startsAt: pauseStarts,
      endsAt: pauseEnds,
      reason: "Motivo médico certificado",
    });
    expect(resPause.statusCode).toBe(200);
    const pauseData = resPause.json().data;
    expect(pauseData.extendedDays).toBe(5);

    // Idempotencia: replay con la misma clave devuelve 200 sin volver a extender
    const resReplay = await request("adminA", "POST", `memberships/${ms.id}/pauses`, {
      idempotencyKey,
      startsAt: pauseStarts,
      endsAt: pauseEnds,
      reason: "Motivo médico certificado",
    });
    expect(resReplay.statusCode).toBe(200);

    // Misma clave con parámetros distintos devuelve 409
    const resConfKey = await request("adminA", "POST", `memberships/${ms.id}/pauses`, {
      idempotencyKey,
      startsAt: pauseStarts,
      endsAt: pauseEnds,
      reason: "Distinto motivo",
    });
    expect(resConfKey.statusCode).toBe(409);

    // Verificar extensión del período: endsAt original + 5 días
    const [periodAfter] = await db.select().from(membershipPeriods);
    expect(new Date(periodAfter!.endsAt).getTime()).toBe(originalEnd.getTime() + 5 * 24 * 3600_000);

    const [membershipAfter] = await db.select().from(memberships).where(sql`id = ${ms.id}`);
    expect(new Date(membershipAfter!.endAt!).getTime()).toBe(originalEnd.getTime() + 5 * 24 * 3600_000);

    // Verificar que la reserva del día 10 quedó cancelada automáticamente
    const [bookingAfter] = await db.select().from(bookings).where(sql`id = ${booking.id}`);
    expect(bookingAfter!.state).toBe("cancelada");

    const [cancellation] = await db.select().from(bookingCancellations).where(sql`booking_id = ${booking.id}`);
    expect(cancellation!.type).toBe("gimnasio");
    expect(cancellation!.creditReturned).toBe(true);

    // Crédito devuelto: debe haber un credit_movements de kind return
    const returns = await db
      .select()
      .from(creditMovements)
      .where(sql`booking_id = ${booking.id} AND kind = 'return'`);
    expect(returns).toHaveLength(1);
    expect(returns[0]!.quantity).toBe(1);

    // Check-in denegado si la fecha actual estuviese dentro de la pausa (o simulada en el servicio)
    // Intentar reservar otra sesión dentro del rango pausado [día 8, día 13) debe fallar 409
    const [sessionPaused] = await db
      .insert(sessions)
      .values({
        organizationId: orgA,
        type: "grupal",
        instructorId: people.instructorA!.id,
        startsAt: new Date(start.getTime() + 9 * 24 * 3600_000),
        endsAt: new Date(start.getTime() + 9 * 24 * 3600_000 + 3600_000),
        capacity: 10,
        state: "programada",
        createdBy: people.adminA!.id,
      })
      .returning();

    const resBookPaused = await request("socioA", "POST", "bookings", { sessionId: sessionPaused!.id });
    expect(resBookPaused.statusCode).toBe(409);

    // En cambio, reservar en el día 32 (que antes estaba fuera, pero ahora está dentro gracias a la extensión) sí debe funcionar
    const [sessionExtended] = await db
      .insert(sessions)
      .values({
        organizationId: orgA,
        type: "grupal",
        instructorId: people.instructorA!.id,
        startsAt: new Date(originalEnd.getTime() + 2 * 24 * 3600_000),
        endsAt: new Date(originalEnd.getTime() + 2 * 24 * 3600_000 + 3600_000),
        capacity: 10,
        state: "programada",
        createdBy: people.adminA!.id,
      })
      .returning();

    const resBookExtended = await request("socioA", "POST", "bookings", { sessionId: sessionExtended!.id });
    expect(resBookExtended.statusCode).toBe(201);
  });

  it("CA-4: Aislamiento multi-tenant y roles permitidos/denegados", async () => {
    const planA = (
      await request("adminA", "POST", "plans", {
        name: "Plan Tenant A",
        priceCents: 30000,
        durationDays: 30,
        coverage: "unlimited",
      })
    ).json().data;

    const msA = (
      await request("recepcionA", "POST", "memberships", {
        memberId: memberA,
        planId: planA.id,
      })
    ).json().data;

    // Cross-tenant: Admin B no puede ver ni modificar plan o membresía de Tenant A (404)
    expect((await request("adminB", "PATCH", `plans/${planA.id}`, { name: "Hack" })).statusCode).toBe(404);
    expect((await request("adminB", "POST", `memberships/${msA.id}/schedule-plan-change`, { nextPlanId: null })).statusCode).toBe(404);
    expect(
      (
        await request("adminB", "POST", `memberships/${msA.id}/pauses`, {
          idempotencyKey: randomUUID(),
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 86400000).toISOString(),
          reason: "Intento ajeno",
        })
      ).statusCode,
    ).toBe(404);

    // Control de roles en Tenant A:
    // recepcion no puede editar plan ni pausar
    expect((await request("recepcionA", "PATCH", `plans/${planA.id}`, { name: "Intento" })).statusCode).toBe(403);
    expect(
      (
        await request("recepcionA", "POST", `memberships/${msA.id}/pauses`, {
          idempotencyKey: randomUUID(),
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 86400000).toISOString(),
          reason: "Sin permiso",
        })
      ).statusCode,
    ).toBe(403);

    // instructor y socio no pueden programar cambio de plan
    expect((await request("instructorA", "POST", `memberships/${msA.id}/schedule-plan-change`, { nextPlanId: null })).statusCode).toBe(403);
    expect((await request("socioA", "POST", `memberships/${msA.id}/schedule-plan-change`, { nextPlanId: null })).statusCode).toBe(403);
  });
});
