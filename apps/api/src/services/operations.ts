import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  auditLog,
  bookingCancellations,
  cashMovements,
  creditMovements,
  financialAdjustments,
  cashSessions,
  authUsers,
  bookings,
  classTemplates,
  members,
  membershipPeriods,
  memberships,
  payments,
  plans,
  sessions,
  staffAssignments,
  type Database,
} from "@gym/db";
import { AttendanceReportQuery } from "@gym/contracts";
import { forbidden, notFound, validationError } from "../errors.js";
import { BookingCreditsService } from "./booking-credits.js";
import { PaymentsService } from "./payments.js";
import type { CheckinActor } from "./checkin.js";

function escapeCsvCell(value: unknown, isText = true): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  if (isText && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvRow(cells: { value: unknown; isText?: boolean }[]): string {
  return cells.map((c) => escapeCsvCell(c.value, c.isText ?? false)).join(",");
}

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
    return {
      member,
      memberships: await Promise.all(
        rows.map(async (r) => ({
          ...r.membership,
          plan: r.plan,
          state: await paymentsService.membershipState(organizationId, r.membership.id),
        })),
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

  async membersCsv(actor: CheckinActor): Promise<string> {
    if (actor.role !== "admin" && actor.role !== "recepcion") {
      throw forbidden("Solo recepción y administración descargan reportes");
    }
    const memberRows = await this.db
      .select({
        id: members.id,
        fullName: members.fullName,
        contactEmail: members.contactEmail,
        contactVerifiedAt: members.contactVerifiedAt,
        adultResponsibleId: members.adultResponsibleId,
        qrToken: members.qrToken,
        qrRevokedAt: members.qrRevokedAt,
        createdAt: members.createdAt,
      })
      .from(members)
      .where(eq(members.organizationId, actor.organizationId))
      .orderBy(asc(members.createdAt), asc(members.id));

    const msRows = await this.db
      .select({
        memberId: memberships.memberId,
        startAt: memberships.startAt,
        endAt: memberships.endAt,
      })
      .from(memberships)
      .where(eq(memberships.organizationId, actor.organizationId))
      .orderBy(desc(memberships.createdAt));

    const now = new Date();
    const lines = [
      "member_id,full_name,contact_email,contact_verified,adult_responsible_id,qr_state,membership_status,created_at",
    ];

    for (const m of memberRows) {
      const memberMs = msRows.filter((ms) => ms.memberId === m.id);
      let status = "sin_membresia";
      if (memberMs.length > 0) {
        const hasActive = memberMs.some(
          (ms) => ms.startAt && ms.endAt && new Date(ms.startAt) <= now && new Date(ms.endAt) > now,
        );
        if (hasActive) {
          status = "active";
        } else {
          const hasPending = memberMs.some((ms) => !ms.endAt);
          status = hasPending ? "pending_payment" : "expired";
        }
      }
      const qrState = m.qrRevokedAt ? "revocado" : m.qrToken ? "activo" : "sin_emitir";
      lines.push(
        buildCsvRow([
          { value: m.id, isText: false },
          { value: m.fullName, isText: true },
          { value: m.contactEmail ?? "", isText: true },
          { value: m.contactVerifiedAt ? "true" : "false", isText: false },
          { value: m.adultResponsibleId ?? "", isText: false },
          { value: qrState, isText: false },
          { value: status, isText: false },
          { value: m.createdAt.toISOString(), isText: false },
        ]),
      );
    }
    return lines.join("\r\n") + "\r\n";
  }

  async membershipsCsv(actor: CheckinActor): Promise<string> {
    if (actor.role !== "admin" && actor.role !== "recepcion") {
      throw forbidden("Solo recepción y administración descargan reportes");
    }
    const rows = await this.db
      .select({
        membershipId: memberships.id,
        memberId: memberships.memberId,
        memberName: members.fullName,
        planName: plans.name,
        planCoverage: plans.coverage,
        startAt: memberships.startAt,
        endAt: memberships.endAt,
      })
      .from(memberships)
      .innerJoin(
        members,
        and(eq(members.id, memberships.memberId), eq(members.organizationId, actor.organizationId)),
      )
      .innerJoin(
        plans,
        and(eq(plans.id, memberships.planId), eq(plans.organizationId, actor.organizationId)),
      )
      .where(eq(memberships.organizationId, actor.organizationId))
      .orderBy(desc(memberships.createdAt), asc(memberships.id));

    const periods = await this.db
      .select()
      .from(membershipPeriods)
      .where(eq(membershipPeriods.organizationId, actor.organizationId))
      .orderBy(desc(membershipPeriods.endsAt), desc(membershipPeriods.startsAt));

    const moves = await this.db
      .select({
        periodId: creditMovements.periodId,
        modality: creditMovements.modality,
        kind: creditMovements.kind,
        quantity: creditMovements.quantity,
      })
      .from(creditMovements)
      .where(eq(creditMovements.organizationId, actor.organizationId));

    const now = new Date();
    const lines = [
      "membership_id,member_id,member_name,plan_name,coverage,state,period_starts_at,period_ends_at,grupal_available,fija_available,cita_available,pending_review_count,next_plan_id",
    ];

    for (const r of rows) {
      const state = !r.endAt
        ? "pending_payment"
        : new Date(r.endAt) > now
          ? "active"
          : "expired";

      const msPeriods = periods.filter((p) => p.membershipId === r.membershipId);
      const activePeriod =
        msPeriods.find((p) => new Date(p.startsAt) <= now && new Date(p.endsAt) > now) ??
        msPeriods[0];

      const periodStartsAt = activePeriod
        ? activePeriod.startsAt.toISOString()
        : r.startAt
          ? r.startAt.toISOString()
          : "";
      const periodEndsAt = activePeriod
        ? activePeriod.endsAt.toISOString()
        : r.endAt
          ? r.endAt.toISOString()
          : "";
      const coverage = activePeriod?.coverage ?? r.planCoverage;

      let grupalAvail: number | string = "";
      let fijaAvail: number | string = "";
      let citaAvail: number | string = "";
      let reviewCount = 0;

      if (activePeriod) {
        if (activePeriod.coverage === "limited") {
          const calcAvail = (quota: number | null, mod: "grupal" | "fija" | "cita") => {
            if (quota === null) return "";
            const net = moves
              .filter((m) => m.periodId === activePeriod.id && m.modality === mod)
              .reduce((s, m) => s + m.quantity, 0);
            return quota - -net;
          };
          grupalAvail = calcAvail(activePeriod.grupalCredits, "grupal");
          fijaAvail = calcAvail(activePeriod.fijaCredits, "fija");
          citaAvail = calcAvail(activePeriod.citaCredits, "cita");
        }
        reviewCount = moves.filter(
          (m) => m.periodId === activePeriod.id && m.kind === "review",
        ).length;
      }

      lines.push(
        buildCsvRow([
          { value: r.membershipId, isText: false },
          { value: r.memberId, isText: false },
          { value: r.memberName, isText: true },
          { value: r.planName, isText: true },
          { value: coverage, isText: false },
          { value: state, isText: false },
          { value: periodStartsAt, isText: false },
          { value: periodEndsAt, isText: false },
          { value: grupalAvail, isText: false },
          { value: fijaAvail, isText: false },
          { value: citaAvail, isText: false },
          { value: reviewCount, isText: false },
          { value: "", isText: false }, // next_plan_id
        ]),
      );
    }

    return lines.join("\r\n") + "\r\n";
  }

  async attendanceCsv(actor: CheckinActor, fromDate: string, toDate: string): Promise<string> {
    if (actor.role !== "admin" && actor.role !== "recepcion") {
      throw forbidden("Solo recepción y administración descargan reportes");
    }
    const query = AttendanceReportQuery.safeParse({ from: fromDate, to: toDate });
    if (!query.success) throw validationError({ issues: query.error.issues });

    const start = sql`${fromDate}::date::timestamp AT TIME ZONE 'America/Santiago'`;
    const end = sql`(${toDate}::date + interval '1 day')::timestamp AT TIME ZONE 'America/Santiago'`;

    const bkgRows = await this.db
      .select({
        bookingId: bookings.id,
        sessionId: sessions.id,
        sessionType: sessions.type,
        templateName: classTemplates.name,
        instructorId: sessions.instructorId,
        startsAt: sessions.startsAt,
        memberId: bookings.memberId,
        memberName: members.fullName,
        bookingState: bookings.state,
        cancellationType: bookingCancellations.type,
        creditReturned: bookingCancellations.creditReturned,
      })
      .from(bookings)
      .innerJoin(
        sessions,
        and(eq(sessions.id, bookings.sessionId), eq(sessions.organizationId, actor.organizationId)),
      )
      .innerJoin(
        members,
        and(eq(members.id, bookings.memberId), eq(members.organizationId, actor.organizationId)),
      )
      .leftJoin(
        classTemplates,
        and(
          eq(classTemplates.id, sessions.templateId),
          eq(classTemplates.organizationId, actor.organizationId),
        ),
      )
      .leftJoin(
        bookingCancellations,
        and(
          eq(bookingCancellations.bookingId, bookings.id),
          eq(bookingCancellations.organizationId, actor.organizationId),
        ),
      )
      .where(
        and(
          eq(bookings.organizationId, actor.organizationId),
          gte(sessions.startsAt, start),
          lt(sessions.startsAt, end),
        ),
      )
      .orderBy(asc(sessions.startsAt), asc(bookings.createdAt));

    const attendanceEvents =
      bkgRows.length > 0
        ? await this.db
            .select({ id: auditLog.entityId, metadata: auditLog.metadata })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.organizationId, actor.organizationId),
                eq(auditLog.action, "booking.attendance"),
                inArray(
                  auditLog.entityId,
                  bkgRows.map((r) => r.bookingId),
                ),
              ),
            )
            .orderBy(desc(auditLog.createdAt))
        : [];

    const attendanceMap = new Map<string, string>();
    for (const ev of attendanceEvents) {
      if (!attendanceMap.has(ev.id)) {
        const outcome = (JSON.parse(ev.metadata ?? "{}") as { outcome?: string }).outcome;
        if (outcome === "asistio" || outcome === "ausencia") attendanceMap.set(ev.id, outcome);
      }
    }

    const lines = [
      "booking_id,session_id,session_type,template_name,instructor_id,starts_at,member_id,member_name,booking_state,attendance_outcome,cancellation_type,credit_returned",
    ];

    for (const r of bkgRows) {
      const outcome =
        attendanceMap.get(r.bookingId) ?? (r.bookingState === "ausente" ? "ausencia" : "");
      const cancType = r.cancellationType ?? "";
      const credRet = r.cancellationType ? (r.creditReturned ? "true" : "false") : "";

      lines.push(
        buildCsvRow([
          { value: r.bookingId, isText: false },
          { value: r.sessionId, isText: false },
          { value: r.sessionType, isText: false },
          { value: r.templateName ?? "", isText: true },
          { value: r.instructorId, isText: false },
          { value: r.startsAt.toISOString(), isText: false },
          { value: r.memberId, isText: false },
          { value: r.memberName, isText: true },
          { value: r.bookingState, isText: false },
          { value: outcome, isText: false },
          { value: cancType, isText: false },
          { value: credRet, isText: false },
        ]),
      );
    }

    return lines.join("\r\n") + "\r\n";
  }
}
