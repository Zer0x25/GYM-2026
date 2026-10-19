import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  auditLog,
  cashMovements,
  financialAdjustments,
  cashSessions,
  authUsers,
  bookings,
  classTemplates,
  members,
  memberships,
  membershipPauses,
  payments,
  plans,
  sessions,
  staffAssignments,
  type Database,
} from "@gym/db";
import { forbidden, notFound } from "../errors.js";
import { BookingCreditsService } from "./booking-credits.js";
import { PaymentsService } from "./payments.js";
import type { CheckinActor } from "./checkin.js";

/** Read projections only. Financial and booking commands keep their existing authority. */
export class OperationsService {
  constructor(private readonly db: Database) {}

  async roster(actor: CheckinActor, sessionId: string) {
    if (actor.role === "socio") throw forbidden("Solo el equipo consulta asistencia");
    const [session] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, actor.organizationId)));
    if (!session) throw notFound("Sesión no encontrada");
    const rows = await this.db
      .select()
      .from(bookings)
      .where(
        and(eq(bookings.organizationId, actor.organizationId), eq(bookings.sessionId, sessionId)),
      )
      .orderBy(bookings.createdAt);
    if (!rows.length) return [];
    const events = await this.db
      .select({ id: auditLog.entityId, metadata: auditLog.metadata })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, actor.organizationId),
          eq(auditLog.action, "booking.attendance"),
          inArray(
            auditLog.entityId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .orderBy(desc(auditLog.createdAt));
    const attendance = new Map<string, "asistio" | "ausencia">();
    for (const ev of events) {
      if (!attendance.has(ev.id)) {
        const outcome = (JSON.parse(ev.metadata ?? "{}") as { outcome?: string }).outcome;
        if (outcome === "asistio" || outcome === "ausencia") attendance.set(ev.id, outcome);
      }
    }
    return rows.map((row) => ({ ...row, attendance: attendance.get(row.id) ?? null }));
  }

  async dailyReport(actor: CheckinActor, date: string) {
    if (actor.role !== "admin" && actor.role !== "recepcion")
      throw forbidden("Solo recepción y administración consultan finanzas");
    const start = sql`${date}::date::timestamp AT TIME ZONE 'America/Santiago'`;
    const end = sql`(${date}::date + interval '1 day')::timestamp AT TIME ZONE 'America/Santiago'`;
    const rows = await this.db
      .select({
        method: cashMovements.method,
        total: sql<number>`COALESCE(sum(${cashMovements.amountCents}),0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(cashMovements)
      .where(
        and(
          eq(cashMovements.organizationId, actor.organizationId),
          gte(cashMovements.createdAt, start),
          lt(cashMovements.createdAt, end),
        ),
      )
      .groupBy(cashMovements.method);
    const shifts = await this.db
      .select({
        id: cashSessions.id,
        state: cashSessions.state,
        openedAt: cashSessions.openedAt,
        closedAt: cashSessions.closedAt,
        openingCents: cashSessions.openingCents,
        declaredClosingCents: cashSessions.declaredClosingCents,
        expectedClosingCents: cashSessions.expectedClosingCents,
        discrepancyCents: cashSessions.discrepancyCents,
      })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.organizationId, actor.organizationId),
          gte(cashSessions.openedAt, start),
          lt(cashSessions.openedAt, end),
        ),
      )
      .orderBy(cashSessions.openedAt);
    const outflows = await this.db
      .select({
        kind: financialAdjustments.kind,
        total: sql<number>`COALESCE(sum(${financialAdjustments.amountCents}),0)::bigint`,
      })
      .from(financialAdjustments)
      .where(
        and(
          eq(financialAdjustments.organizationId, actor.organizationId),
          gte(financialAdjustments.createdAt, start),
          lt(financialAdjustments.createdAt, end),
        ),
      )
      .groupBy(financialAdjustments.kind);
    const refunds = Number(outflows.find((r) => r.kind === "refund")?.total ?? 0);
    const adjustments = Number(outflows.find((r) => r.kind === "adjustment")?.total ?? 0);
    const cash = rows.find((r) => r.method === "cash")?.total ?? 0,
      transfer = rows.find((r) => r.method === "transfer")?.total ?? 0,
      transbank = rows.find((r) => r.method === "transbank")?.total ?? 0;
    return {
      date,
      timeZone: "America/Santiago",
      cash,
      transfer,
      transbank,
      income: cash + transfer + transbank,
      refunds,
      adjustments,
      outflow: refunds + adjustments,
      net: cash + transfer + transbank - refunds - adjustments,
      movements: rows.reduce((v, r) => v + r.count, 0),
      shifts,
    };
  }

  async instructors(organizationId: string) {
    return this.db
      .select({ id: authUsers.id, name: authUsers.name })
      .from(staffAssignments)
      .innerJoin(authUsers, eq(authUsers.id, staffAssignments.accountId))
      .where(
        and(
          eq(staffAssignments.organizationId, organizationId),
          eq(staffAssignments.active, true),
          eq(staffAssignments.role, "instructor"),
        ),
      )
      .orderBy(authUsers.name);
  }

  async staff(actor: CheckinActor) {
    if (actor.role !== "admin") throw forbidden("Solo administración consulta el equipo");
    return this.db
      .select({
        id: authUsers.id,
        name: authUsers.name,
        email: authUsers.email,
        role: staffAssignments.role,
      })
      .from(staffAssignments)
      .innerJoin(authUsers, eq(authUsers.id, staffAssignments.accountId))
      .where(
        and(
          eq(staffAssignments.organizationId, actor.organizationId),
          eq(staffAssignments.active, true),
        ),
      )
      .orderBy(authUsers.name);
  }

  async schedule(organizationId: string, from?: Date, to?: Date) {
    const conditions = [eq(sessions.organizationId, organizationId)];
    if (from) conditions.push(gte(sessions.startsAt, from));
    if (to) conditions.push(lt(sessions.startsAt, to));
    const rows = await this.db
      .select({ session: sessions, title: classTemplates.name, instructorName: authUsers.name })
      .from(sessions)
      .leftJoin(
        classTemplates,
        and(
          eq(classTemplates.id, sessions.templateId),
          eq(classTemplates.organizationId, organizationId),
        ),
      )
      .leftJoin(
        staffAssignments,
        and(
          eq(staffAssignments.accountId, sessions.instructorId),
          eq(staffAssignments.organizationId, organizationId),
          eq(staffAssignments.role, "instructor"),
          eq(staffAssignments.active, true),
        ),
      )
      .leftJoin(authUsers, eq(authUsers.id, staffAssignments.accountId))
      .where(and(...conditions))
      .orderBy(sessions.startsAt);
    const counts = await this.db
      .select({ sessionId: bookings.sessionId, count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(and(eq(bookings.organizationId, organizationId), eq(bookings.state, "confirmada")))
      .groupBy(bookings.sessionId);
    const map = new Map(counts.map((r) => [r.sessionId, r.count]));
    const labels: Record<string, string> = {
      grupal: "Clase grupal",
      fija: "Personalizada fija",
      cita: "Cita personalizada",
      bloqueo: "Bloqueo de agenda",
    };
    return rows.map((r) => ({
      ...r.session,
      title: r.title ?? labels[r.session.type] ?? "Clase",
      instructorName: r.instructorName ?? "Instructor",
      booked: map.get(r.session.id) ?? 0,
      remaining: Math.max(0, r.session.capacity - (map.get(r.session.id) ?? 0)),
    }));
  }

  private async profile(organizationId: string, memberId: string) {
    const [member] = await this.db
      .select({
        id: members.id,
        organizationId: members.organizationId,
        fullName: members.fullName,
        contactEmail: members.contactEmail,
        createdAt: members.createdAt,
      })
      .from(members)
      .where(and(eq(members.organizationId, organizationId), eq(members.id, memberId)));
    if (!member) throw notFound("Socio no encontrado");
    const rows = await this.db
      .select({ membership: memberships, plan: plans })
      .from(memberships)
      .innerJoin(
        plans,
        and(eq(plans.id, memberships.planId), eq(plans.organizationId, organizationId)),
      )
      .where(
        and(eq(memberships.organizationId, organizationId), eq(memberships.memberId, memberId)),
      )
      .orderBy(desc(memberships.createdAt));
    const paymentsService = new PaymentsService(this.db);
    const now = new Date();
    return {
      member,
      memberships: await Promise.all(
        rows.map(async (r) => {
          let nextPlan = null;
          if (r.membership.nextPlanId) {
            const [np] = await this.db
              .select({ id: plans.id, name: plans.name })
              .from(plans)
              .where(
                and(eq(plans.id, r.membership.nextPlanId), eq(plans.organizationId, organizationId)),
              );
            nextPlan = np ?? null;
          }
          const pauses = await this.db
            .select()
            .from(membershipPauses)
            .where(
              and(
                eq(membershipPauses.organizationId, organizationId),
                eq(membershipPauses.membershipId, r.membership.id),
              ),
            )
            .orderBy(desc(membershipPauses.createdAt));

          const activePause =
            pauses.find((p) => p.state === "active" && p.startsAt <= now && p.endsAt > now) ??
            pauses.find((p) => p.state === "active" && p.endsAt > now) ??
            null;

          return {
            ...r.membership,
            plan: r.plan,
            nextPlan,
            pauses,
            activePause,
            state: await paymentsService.membershipState(organizationId, r.membership.id),
          };
        }),
      ),
    };
  }

  async memberOverview(actor: CheckinActor, memberId: string) {
    if (actor.role !== "admin" && actor.role !== "recepcion")
      throw forbidden("Solo recepción y administración consultan la ficha operativa");
    const profile = await this.profile(actor.organizationId, memberId);
    const history = await this.db
      .select()
      .from(payments)
      .where(
        and(eq(payments.organizationId, actor.organizationId), eq(payments.memberId, memberId)),
      )
      .orderBy(desc(payments.createdAt));
    return {
      ...profile,
      payments: history,
      creditPeriods: await new BookingCreditsService(this.db).list(actor, memberId),
    };
  }

  async portal(actor: CheckinActor) {
    if (actor.role !== "socio" || !actor.memberId)
      throw forbidden("Se requiere una cuenta de socio vinculada");
    return {
      ...(await this.profile(actor.organizationId, actor.memberId)),
      creditPeriods: await new BookingCreditsService(this.db).list(actor, actor.memberId),
    };
  }
}
