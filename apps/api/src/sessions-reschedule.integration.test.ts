import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  organizations,
  identityAccounts,
  staffAssignments,
  members,
  creditMovements,
  sessions,
  bookings,
} from "@gym/db";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "SPEC 018 — Reprogramación de agenda y citas personalizadas",
  () => {
    const db = createDb(
      process.env.TEST_DATABASE_URL ??
        "postgres://gym:gym-local-dev@localhost:55432/gym_test_sessions_reschedule",
    );
    const auth = createAuth({
      db,
      secret: "sessions-reschedule-fictional-secret-32",
      baseURL: "http://localhost:3000",
    });
    let app: Awaited<ReturnType<typeof buildServer>>;
    const people: Record<string, { id: string; cookie: string }> = {};
    let orgA = "",
      orgB = "",
      memberA = "",
      socioAUserId = "";

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
      for (const name of [
        "adminA",
        "recepcionA",
        "instructorA",
        "instructorOther",
        "socioA",
        "adminB",
      ]) {
        const email = `${name}@reschedule.test`;
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
      socioAUserId = people.socioA!.id;
      app = await buildServer({ db, auth });
      await app.ready();
    });

    beforeEach(async () => {
      await db.execute(
        sql`TRUNCATE organizations, members, staff_assignments, plans, memberships, membership_periods, membership_pauses, payments, cash_sessions, cash_movements, sessions, bookings, booking_cancellations, credit_movements, audit_log RESTART IDENTITY CASCADE`,
      );

      const [oA] = await db.insert(organizations).values({ name: "Gimnasio A" }).returning();
      const [oB] = await db.insert(organizations).values({ name: "Gimnasio B" }).returning();
      orgA = oA!.id;
      orgB = oB!.id;

      await db.insert(staffAssignments).values([
        { organizationId: orgA, accountId: people.adminA!.id, role: "admin", active: true },
        { organizationId: orgA, accountId: people.recepcionA!.id, role: "recepcion", active: true },
        { organizationId: orgA, accountId: people.instructorA!.id, role: "instructor", active: true },
        {
          organizationId: orgA,
          accountId: people.instructorOther!.id,
          role: "instructor",
          active: true,
        },
        { organizationId: orgB, accountId: people.adminB!.id, role: "admin", active: true },
      ]);

      const [mA] = await db
        .insert(members)
        .values({
          organizationId: orgA,
          accountId: socioAUserId,
          fullName: "Socio A",
          contactEmail: "socioA@reschedule.test",
          qrToken: "qr-socio-a",
        })
        .returning();
      memberA = mA!.id;
    });

    afterAll(async () => {
      await app.close();
    });

    it("CA-1: POST /api/v1/sessions/:id/reschedule mueve horario, registra rescheduledFromStartsAt/rescheduledCount y conserva créditos", async () => {
      // 1. Crear plan limitado con 4 citas
      const resPlan = await request("adminA", "POST", "plans", {
        name: "Plan Citas",
        priceCents: 50000,
        durationDays: 30,
        coverage: "limited",
        classCredits: { grupal: 0, fija: 0, cita: 4 },
      });
      expect(resPlan.statusCode).toBe(201);
      const planId = resPlan.json().data.id;

      // 2. Asignar membresía a socioA y abrir caja para validar pago
      const resMs = await request("recepcionA", "POST", "memberships", {
        memberId: memberA,
        planId,
      });
      const msId = resMs.json().data.id;

      await request("adminA", "POST", "cash/sessions", { openingCents: 10000 });
      const resPay = await request("recepcionA", "POST", "payments", {
        membershipId: msId,
        amountCents: 50000,
        method: "cash",
      });
      const paymentId = resPay.json().data.id;
      await request("adminA", "POST", `payments/${paymentId}/validate`);

      // 3. Crear sesión cita para el martes a las 10:00 (futuro)
      const origStartsAt = new Date(Date.now() + 2 * 24 * 3600 * 1000);
      origStartsAt.setMinutes(0, 0, 0);
      const origEndsAt = new Date(origStartsAt.getTime() + 3600 * 1000);

      const resSess = await request("recepcionA", "POST", "sessions", {
        type: "cita",
        instructorId: people.instructorA!.id,
        startsAt: origStartsAt.toISOString(),
        endsAt: origEndsAt.toISOString(),
        capacity: 1,
      });
      expect(resSess.statusCode).toBe(201);
      const sessionId = resSess.json().data.id;

      // 4. Reservar para socioA (consume 1 crédito, quedan 3)
      const resBook = await request("recepcionA", "POST", "bookings", {
        sessionId,
        memberId: memberA,
      });
      expect(resBook.statusCode).toBe(201);

      // Comprobar crédito comprometido
      const creditRowsBefore = await db
        .select()
        .from(creditMovements)
        .where(eq(creditMovements.memberId, memberA));
      expect(creditRowsBefore).toHaveLength(1);
      expect(creditRowsBefore[0]!.quantity).toBe(-1);

      // 5. Reprogramar al miércoles a las 11:00 (mismo período)
      const newStartsAt = new Date(origStartsAt.getTime() + 24 * 3600 * 1000);
      const newEndsAt = new Date(newStartsAt.getTime() + 3600 * 1000);

      const resResched = await request("recepcionA", "POST", `sessions/${sessionId}/reschedule`, {
        startsAt: newStartsAt.toISOString(),
        endsAt: newEndsAt.toISOString(),
        reason: "Cambio coordinado con el socio",
      });
      expect(resResched.statusCode).toBe(200);
      const updated = resResched.json().data;
      expect(new Date(updated.startsAt).toISOString()).toBe(newStartsAt.toISOString());
      expect(new Date(updated.endsAt).toISOString()).toBe(newEndsAt.toISOString());
      expect(new Date(updated.rescheduledFromStartsAt).toISOString()).toBe(origStartsAt.toISOString());
      expect(updated.rescheduledCount).toBe(1);

      // Comprobar que la reserva sigue confirmada y NO hay segundo descuento
      const [booking] = await db.select().from(bookings).where(eq(bookings.sessionId, sessionId));
      expect(booking!.state).toBe("confirmada");

      const creditRowsAfter = await db
        .select()
        .from(creditMovements)
        .where(eq(creditMovements.memberId, memberA));
      expect(creditRowsAfter).toHaveLength(1); // exactamente 1 movimiento, sin doble descuento
    });

    it("CA-2: TX-02 concurrencia: dos reprogramaciones/creaciones al mismo tramo horario serializan por lock", async () => {
      const slot1 = new Date(Date.now() + 5 * 24 * 3600 * 1000);
      slot1.setMinutes(0, 0, 0);
      const slot1End = new Date(slot1.getTime() + 3600 * 1000);

      // Crear sesión 1
      const res1 = await request("adminA", "POST", "sessions", {
        type: "grupal",
        instructorId: people.instructorA!.id,
        startsAt: slot1.toISOString(),
        endsAt: slot1End.toISOString(),
        capacity: 10,
      });
      const sess1Id = res1.json().data.id;

      // Crear sesión 2 en otro horario
      const slot2 = new Date(Date.now() + 6 * 24 * 3600 * 1000);
      slot2.setMinutes(0, 0, 0);
      const slot2End = new Date(slot2.getTime() + 3600 * 1000);

      const res2 = await request("adminA", "POST", "sessions", {
        type: "grupal",
        instructorId: people.instructorA!.id,
        startsAt: slot2.toISOString(),
        endsAt: slot2End.toISOString(),
        capacity: 10,
      });
      const sess2Id = res2.json().data.id;

      // Horario objetivo compartido
      const targetStart = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      targetStart.setMinutes(0, 0, 0);
      const targetEnd = new Date(targetStart.getTime() + 3600 * 1000);

      // Lanzar reprogramación simultánea de ambas sesiones al mismo target
      const [p1, p2] = await Promise.all([
        request("adminA", "POST", `sessions/${sess1Id}/reschedule`, {
          startsAt: targetStart.toISOString(),
          endsAt: targetEnd.toISOString(),
        }),
        request("recepcionA", "POST", `sessions/${sess2Id}/reschedule`, {
          startsAt: targetStart.toISOString(),
          endsAt: targetEnd.toISOString(),
        }),
      ]);

      const statuses = [p1.statusCode, p2.statusCode].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it("CA-3: REVAL-01 rechaza con 409 si un socio inscrito no cubre la nueva fecha (vencido, pausa o solape)", async () => {
      // 1. Crear plan mensual y membresía que vence en 10 días
      const resPlan = await request("adminA", "POST", "plans", {
        name: "Plan Mensual 10d",
        priceCents: 30000,
        durationDays: 10,
        coverage: "unlimited",
      });
      const planId = resPlan.json().data.id;

      const resMs = await request("recepcionA", "POST", "memberships", {
        memberId: memberA,
        planId,
      });
      const msId = resMs.json().data.id;
      await request("adminA", "POST", "cash/sessions", { openingCents: 10000 });
      const resPay = await request("recepcionA", "POST", "payments", {
        membershipId: msId,
        amountCents: 30000,
        method: "cash",
      });
      await request("adminA", "POST", `payments/${resPay.json().data.id}/validate`);

      // Sesión día 3 (cubierta)
      const sessStart = new Date(Date.now() + 3 * 24 * 3600 * 1000);
      const sessEnd = new Date(sessStart.getTime() + 3600 * 1000);
      const resSess = await request("recepcionA", "POST", "sessions", {
        type: "grupal",
        instructorId: people.instructorA!.id,
        startsAt: sessStart.toISOString(),
        endsAt: sessEnd.toISOString(),
        capacity: 10,
      });
      const sessionId = resSess.json().data.id;
      await request("recepcionA", "POST", "bookings", { sessionId, memberId: memberA });

      // CASO A: Reprogramar a día 15 (período ya vencido de socioA) -> 409
      const expiredStart = new Date(Date.now() + 15 * 24 * 3600 * 1000);
      const expiredEnd = new Date(expiredStart.getTime() + 3600 * 1000);
      const resExpired = await request("recepcionA", "POST", `sessions/${sessionId}/reschedule`, {
        startsAt: expiredStart.toISOString(),
        endsAt: expiredEnd.toISOString(),
      });
      expect(resExpired.statusCode).toBe(409);

      // CASO B: Pausa activa en día 6-8, reprogramar a día 7 -> 409
      const pauseStart = new Date(Date.now() + 6 * 24 * 3600 * 1000);
      const pauseEnd = new Date(Date.now() + 8 * 24 * 3600 * 1000);
      const resPause = await request("adminA", "POST", `memberships/${msId}/pauses`, {
        idempotencyKey: randomUUID(),
        startsAt: pauseStart.toISOString(),
        endsAt: pauseEnd.toISOString(),
        reason: "Viaje laboral de 2 días",
      });
      expect(resPause.statusCode).toBe(200);

      const pausedStart = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      const pausedEnd = new Date(pausedStart.getTime() + 3600 * 1000);
      const resPaused = await request("recepcionA", "POST", `sessions/${sessionId}/reschedule`, {
        startsAt: pausedStart.toISOString(),
        endsAt: pausedEnd.toISOString(),
      });
      expect(resPaused.statusCode).toBe(409);

      // CASO C: Socio ya tiene otra reserva confirmada en la sesión a la que se reprograma -> 409
      const otherStart = new Date(Date.now() + 4 * 24 * 3600 * 1000);
      const otherEnd = new Date(otherStart.getTime() + 3600 * 1000);
      const resOtherSess = await request("adminA", "POST", "sessions", {
        type: "grupal",
        instructorId: people.instructorOther!.id,
        startsAt: otherStart.toISOString(),
        endsAt: otherEnd.toISOString(),
        capacity: 10,
      });
      const otherSessId = resOtherSess.json().data.id;
      await request("recepcionA", "POST", "bookings", {
        sessionId: otherSessId,
        memberId: memberA,
      });

      // Intento reprogramar sessionId al mismo horario de otherSessId
      const resOverlapMember = await request(
        "recepcionA",
        "POST",
        `sessions/${sessionId}/reschedule`,
        {
          startsAt: otherStart.toISOString(),
          endsAt: otherEnd.toISOString(),
        },
      );
      expect(resOverlapMember.statusCode).toBe(409);

      // Verificar que el horario de la sesión original se mantiene intacto
      const [sessRow] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
      expect(new Date(sessRow!.startsAt).toISOString()).toBe(sessStart.toISOString());
    });

    it("CA-4: Permisos por rol: instructor solo sus citas/bloqueos, socio 403, cross-tenant 404", async () => {
      // Sesión grupal de instructorA
      const gStart = new Date(Date.now() + 2 * 24 * 3600 * 1000);
      const gEnd = new Date(gStart.getTime() + 3600 * 1000);
      const resGrupal = await request("adminA", "POST", "sessions", {
        type: "grupal",
        instructorId: people.instructorA!.id,
        startsAt: gStart.toISOString(),
        endsAt: gEnd.toISOString(),
        capacity: 10,
      });
      const grupalId = resGrupal.json().data.id;

      // Cita de instructorA
      const cStart = new Date(Date.now() + 3 * 24 * 3600 * 1000);
      const cEnd = new Date(cStart.getTime() + 3600 * 1000);
      const resCita = await request("adminA", "POST", "sessions", {
        type: "cita",
        instructorId: people.instructorA!.id,
        startsAt: cStart.toISOString(),
        endsAt: cEnd.toISOString(),
        capacity: 1,
      });
      const citaId = resCita.json().data.id;

      const newStart = new Date(Date.now() + 10 * 24 * 3600 * 1000);
      const newEnd = new Date(newStart.getTime() + 3600 * 1000);

      // 1. Cross-tenant (adminB intenta sobre sesión de orgA) -> 404
      const resB = await request("adminB", "POST", `sessions/${citaId}/reschedule`, {
        startsAt: newStart.toISOString(),
        endsAt: newEnd.toISOString(),
      });
      expect(resB.statusCode).toBe(404);

      // 2. Socio intenta reprogramar -> 403
      const resSocio = await request("socioA", "POST", `sessions/${citaId}/reschedule`, {
        startsAt: newStart.toISOString(),
        endsAt: newEnd.toISOString(),
      });
      expect(resSocio.statusCode).toBe(403);

      // 3. Instructor sobre grupal -> 403
      const resInstGrupal = await request("instructorA", "POST", `sessions/${grupalId}/reschedule`, {
        startsAt: newStart.toISOString(),
        endsAt: newEnd.toISOString(),
      });
      expect(resInstGrupal.statusCode).toBe(403);

      // 4. Instructor ajeno sobre cita de instructorA -> 403
      const resOtherInst = await request(
        "instructorOther",
        "POST",
        `sessions/${citaId}/reschedule`,
        {
          startsAt: newStart.toISOString(),
          endsAt: newEnd.toISOString(),
        },
      );
      expect(resOtherInst.statusCode).toBe(403);

      // 5. Instructor sobre SU PROPIA cita -> 200
      const resOwnerInst = await request("instructorA", "POST", `sessions/${citaId}/reschedule`, {
        startsAt: newStart.toISOString(),
        endsAt: newEnd.toISOString(),
      });
      expect(resOwnerInst.statusCode).toBe(200);
    });
  },
);
