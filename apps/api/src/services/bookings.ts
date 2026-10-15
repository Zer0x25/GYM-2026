/**
 * Bookings service (spec 004) — reservations, the last-slot concurrency
 * guard (TX-01) and idempotent cancellation with single credit move (TX-04).
 *
 * Invariants (backend is the authority, ADR-0002 §3):
 *  1. LAST SLOT (REQ-4, TX-01): two members racing for the last slot →
 *     exactly one confirms, the other gets 409 without consuming benefit.
 *     Mechanism: inside the transaction, lock the session row FOR UPDATE and
 *     re-check confirmedCount < capacity before inserting. The unique
 *     (sessionId, memberId) blocks the same member double-booking.
 *  2. BENEFIT ONCE (REQ-4): beneficioComprometido is set true on confirm and
 *     never re-consumed; a rejected booking never sets it.
 *  3. COVERAGE REVALIDATION (SPEC:REVAL-01): the member must have an active
 *     membership whose coverage satisfies the session's required coverage.
 *  4. CANCEL + CREDIT ONCE (REQ-5, TX-04): cancel moves the booking to
 *     'cancelada' and writes the cancellation row in the SAME transaction.
 *     The unique on bookingCancellations.bookingId is the idempotency key:
 *     a second (concurrent) cancel fails → 409, credit never moves twice.
 *  5. Policy: temprana/gimnasio return credit; tardia/ausencia retain it.
 *     The window is the template's cancellationWindowHours.
 *  6. Every read/write filters by organizationId (REQ-1, TX-07); a socio
 *     only ever books/cancels their own (memberId from the session, never
 *     the client — REQ-7).
 */
import { and, count, eq, sql } from "drizzle-orm";
import type { Database } from "@gym/db";
import { bookingCancellations, bookings, classTemplates, members, sessions } from "@gym/db";
import { conflict, forbidden, notFound } from "../errors.js";
import { BookingCreditsService } from "./booking-credits.js";
import { AppError } from "../errors.js";
import { AuditService } from "./audit.js";

export interface BookingActor {
  organizationId: string;
  accountId: string;
  role: "admin" | "recepcion" | "instructor" | "socio";
  /** Member id for a socio (from the session). Absent for staff. */
  memberId?: string | undefined;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const HOUR_MS = 60 * 60 * 1000;

export class BookingsService {
  private readonly audit: AuditService;

  constructor(private readonly db: Database) {
    this.audit = new AuditService(db);
  }

  /**
   * Reserves a slot (REQ-4). The whole last-slot check runs under a lock on
   * the session row so two concurrent last-slot bookings cannot both win.
   */
  async create(actor: BookingActor, sessionId: string, memberId: string) {
    if (!["admin", "recepcion", "socio"].includes(actor.role)) throw forbidden();
    const [member] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.organizationId, actor.organizationId), eq(members.id, memberId)));
    if (!member) throw notFound("Socio no encontrado");
    // A socio can only book for themselves (REQ-7): the memberId comes from
    // the session; staff may book on behalf of a member.
    if (actor.role === "socio" && actor.memberId !== memberId) {
      throw forbidden("Un socio solo reserva para sí mismo");
    }
    const session = await this.getSession(actor.organizationId, sessionId);
    if (session.state !== "programada") throw conflict("La sesión no está disponible");
    if (session.type === "bloqueo") throw conflict("Un bloqueo no es reservable");

    return this.db.transaction(async (tx) => {
      // Lock the session row: serializes concurrent last-slot bookings.
      const [locked] = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, actor.organizationId)))
        .for("update")
        .limit(1);
      if (!locked) throw notFound("Sesión no encontrada");
      if (locked.state !== "programada") throw conflict("La sesión cambió de estado");
      if (locked.startsAt <= new Date()) throw conflict("La sesión ya comenzó");

      // Last-slot check under the lock (TX-01).
      const confirmed = await this.countConfirmed(sessionId, tx);
      if (confirmed >= locked.capacity) {
        throw conflict("No quedan plazas disponibles en esta sesión");
      }

      const [existing] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.organizationId, actor.organizationId),
            eq(bookings.sessionId, sessionId),
            eq(bookings.memberId, memberId),
          ),
        );
      if (existing) throw conflict("Ya tenés una reserva en esta sesión");
      const choice = await new BookingCreditsService(this.db).choose(tx, actor, memberId, locked);
      let row;
      try {
        [row] = await tx
          .insert(bookings)
          .values({
            organizationId: actor.organizationId,
            sessionId,
            memberId,
            periodId: choice.periodId,
            state: "confirmada",
            beneficioComprometido: true, // committed exactly once, here (REQ-4)
            createdBy: actor.accountId,
          })
          .returning();
      } catch (e) {
        // Unique (sessionId, memberId): the member already booked this slot.
        if (isUniqueViolation(e)) throw conflict("Ya tenés una reserva en esta sesión");
        throw e;
      }
      if (!row) throw notFound("Reserva no encontrada");
      await new BookingCreditsService(this.db).commit(tx, actor, memberId, row.id, choice);

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "booking.create",
          entity: "booking",
          entityId: row.id,
          metadata: { sessionId, memberId, beneficioComprometido: true },
        },
        tx,
      );

      return row;
    });
  }

  /**
   * Cancels a booking (REQ-5). The credit move and the state change happen
   * in ONE transaction; the unique on bookingCancellations.bookingId makes a
   * second (concurrent) cancel a 409 — credit moves exactly once (TX-04).
   */
  async cancel(
    actor: BookingActor,
    bookingId: string,
    input: { type: "temprana" | "tardia" | "gimnasio" | "ausencia"; reason?: string | undefined },
  ) {
    if (actor.role === "socio" && (input.type === "gimnasio" || input.type === "ausencia"))
      throw forbidden("El socio no autoriza cancelaciones del gimnasio ni ausencias");
    const booking = await this.getById(actor.organizationId, bookingId);
    // A socio may only cancel their own booking (REQ-7).
    if (actor.role === "socio" && booking.memberId !== actor.memberId) {
      throw notFound("Reserva no encontrada");
    }
    if (booking.state === "cancelada") throw conflict("La reserva ya está cancelada");
    if (booking.state === "ausente") throw conflict("La reserva ya fue marcada como ausencia");

    const session = await this.getSession(actor.organizationId, booking.sessionId);
    return this.db.transaction(async (tx) => {
      // Lock the booking: serializes concurrent cancels of the same booking.
      const [locked] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, actor.organizationId)))
        .for("update")
        .limit(1);
      if (!locked) throw notFound("Reserva no encontrada");
      if (locked.state === "cancelada") throw conflict("La reserva ya está cancelada");

      let type = input.type;
      if (type === "temprana" || type === "tardia") {
        if (session.startsAt <= new Date())
          throw conflict("La sesión ya comenzó; recepción debe registrar el resultado");
        const hours = await this.templateCancellationWindow(
          actor.organizationId,
          session.templateId,
        );
        type = withinCancellationWindow(session.startsAt, hours) ? "temprana" : "tardia";
      }
      const creditReturned = type === "temprana" || type === "gimnasio";
      const [updated] = await tx
        .update(bookings)
        .set({ state: "cancelada" })
        .where(and(eq(bookings.id, bookingId), eq(bookings.state, "confirmada")))
        .returning();
      if (!updated) throw conflict("La reserva cambió de estado durante la cancelación");

      const effect = creditReturned
        ? await new BookingCreditsService(this.db).restore(tx, actor, bookingId)
        : { creditReturned: false, creditReviewRequired: false };
      let cancellation;
      try {
        [cancellation] = await tx
          .insert(bookingCancellations)
          .values({
            organizationId: actor.organizationId,
            bookingId,
            type,
            ...effect,
            reason: input.reason ?? null,
            actorId: actor.accountId,
            actorRole: actor.role,
          })
          .returning();
      } catch (e) {
        // Unique on bookingId: already cancelled → idempotent rejection.
        if (isUniqueViolation(e))
          throw conflict("Esta reserva ya tiene una cancelación registrada");
        throw e;
      }
      if (!cancellation) throw conflict("No se pudo registrar la cancelación");

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "booking.cancel",
          entity: "booking",
          entityId: bookingId,
          metadata: { type, ...effect, reason: input.reason ?? null },
        },
        tx,
      );

      return { booking: updated, cancellation };
    });
  }

  /** Marks attendance: asistio keeps confirmada; ausencia retains credit (REQ-5). */
  async markAttendance(actor: BookingActor, bookingId: string, outcome: "asistio" | "ausencia") {
    if (actor.role === "socio") throw forbidden("Solo staff marca asistencia");
    const booking = await this.getById(actor.organizationId, bookingId);
    if (booking.state !== "confirmada") throw conflict("La reserva no está confirmada");

    const result = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.organizationId, actor.organizationId), eq(bookings.id, bookingId)))
        .for("update");
      if (!locked || locked.state !== "confirmada") throw conflict("La reserva cambió de estado");
      const session = await this.getSession(actor.organizationId, locked.sessionId);
      try {
        await new BookingCreditsService(this.db).choose(
          tx,
          actor,
          locked.memberId,
          session,
          locked,
        );
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "CONFLICT") throw error;
        await this.cancelLostCoverage(tx, actor, locked);
        return null;
      }
      if (outcome === "ausencia") {
        const [row] = await tx
          .update(bookings)
          .set({ state: "ausente" })
          .where(and(eq(bookings.id, bookingId), eq(bookings.state, "confirmada")))
          .returning();
        if (!row) throw conflict("La reserva cambió de estado");
        // ausencia also records a cancellation row (credit retained) once.
        try {
          await tx.insert(bookingCancellations).values({
            organizationId: actor.organizationId,
            bookingId,
            type: "ausencia",
            creditReturned: false,
            reason: "Ausencia marcada por staff",
            actorId: actor.accountId,
            actorRole: actor.role,
          });
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
        }
        await this.audit.record(
          {
            organizationId: actor.organizationId,
            actorId: actor.accountId,
            actorRole: actor.role,
            action: "booking.attendance",
            entity: "booking",
            entityId: bookingId,
            metadata: { outcome: "ausencia" },
          },
          tx,
        );
        return row;
      }
      // asistio: attendance confirmed, no state change needed.
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "booking.attendance",
          entity: "booking",
          entityId: bookingId,
          metadata: { outcome: "asistio" },
        },
        tx,
      );
      return booking;
    });
    if (!result)
      throw conflict("Cobertura perdida: reserva cancelada y plaza liberada", {
        cancelled: true,
        bookingId,
      });
    return result;
  }

  private async cancelLostCoverage(
    tx: Tx,
    actor: BookingActor,
    booking: typeof bookings.$inferSelect,
  ) {
    const effect = await new BookingCreditsService(this.db).restore(tx, actor, booking.id);
    await tx
      .update(bookings)
      .set({ state: "cancelada" })
      .where(and(eq(bookings.id, booking.id), eq(bookings.organizationId, actor.organizationId)));
    await tx.insert(bookingCancellations).values({
      organizationId: actor.organizationId,
      bookingId: booking.id,
      type: "gimnasio",
      ...effect,
      reason: "Pérdida confirmada de cobertura",
      actorId: actor.accountId,
      actorRole: actor.role,
    });
    await this.audit.record(
      {
        organizationId: actor.organizationId,
        actorId: actor.accountId,
        actorRole: actor.role,
        action: "booking.coverage-lost",
        entity: "booking",
        entityId: booking.id,
        metadata: effect,
      },
      tx,
    );
  }
  async cancelForSession(tx: Tx, actor: BookingActor, sessionId: string) {
    if (actor.role !== "admin" && actor.role !== "recepcion") throw forbidden();
    const rows = await tx
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.organizationId, actor.organizationId),
          eq(bookings.sessionId, sessionId),
          eq(bookings.state, "confirmada"),
        ),
      )
      .orderBy(bookings.id)
      .for("update");
    await new BookingCreditsService(this.db).lockMembers(
      tx,
      actor.organizationId,
      rows.map((row) => row.memberId),
    );
    for (const booking of rows) {
      const effect = await new BookingCreditsService(this.db).restore(tx, actor, booking.id);
      await tx.update(bookings).set({ state: "cancelada" }).where(eq(bookings.id, booking.id));
      await tx.insert(bookingCancellations).values({
        organizationId: actor.organizationId,
        bookingId: booking.id,
        type: "gimnasio",
        ...effect,
        reason: "Sesión cancelada por el gimnasio",
        actorId: actor.accountId,
        actorRole: actor.role,
      });
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "booking.cancel",
          entity: "booking",
          entityId: booking.id,
          metadata: { type: "gimnasio", ...effect },
        },
        tx,
      );
    }
  }
  async revalidate(actor: BookingActor, memberId: string) {
    if (actor.role !== "admin" && actor.role !== "recepcion") throw forbidden();
    const [member] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.organizationId, actor.organizationId), eq(members.id, memberId)));
    if (!member) throw notFound("Socio no encontrado");
    const candidates = await this.db
      .select({ id: bookings.id })
      .from(bookings)
      .innerJoin(
        sessions,
        and(eq(bookings.sessionId, sessions.id), eq(sessions.organizationId, actor.organizationId)),
      )
      .where(
        and(
          eq(bookings.organizationId, actor.organizationId),
          eq(bookings.memberId, memberId),
          eq(bookings.state, "confirmada"),
          sql`${sessions.startsAt} > now()`,
        ),
      );
    let cancelled = 0;
    for (const candidate of candidates) {
      const changed = await this.db.transaction(async (tx) => {
        const [booking] = await tx
          .select()
          .from(bookings)
          .where(
            and(eq(bookings.organizationId, actor.organizationId), eq(bookings.id, candidate.id)),
          )
          .for("update");
        if (!booking || booking.state !== "confirmada") return false;
        const session = await this.getSession(actor.organizationId, booking.sessionId);
        try {
          await new BookingCreditsService(this.db).choose(tx, actor, memberId, session, booking);
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== "CONFLICT") throw error;
          await this.cancelLostCoverage(tx, actor, booking);
          return true;
        }
        return false;
      });
      if (changed) cancelled++;
    }
    return { cancelled };
  }

  async listByMember(organizationId: string, memberId: string) {
    return this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.organizationId, organizationId), eq(bookings.memberId, memberId)))
      .orderBy(bookings.createdAt);
  }

  async listBySession(organizationId: string, sessionId: string) {
    return this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.organizationId, organizationId), eq(bookings.sessionId, sessionId)))
      .orderBy(bookings.createdAt);
  }

  async getById(organizationId: string, bookingId: string) {
    const rows = await this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Reserva no encontrada");
    return row;
  }

  // --- internals --------------------------------------------------------------

  private async getSession(organizationId: string, sessionId: string) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Sesión no encontrada");
    return row;
  }

  private async countConfirmed(sessionId: string, tx?: Tx): Promise<number> {
    const db = tx ?? this.db;
    const rows = await db
      .select({ n: count() })
      .from(bookings)
      .where(and(eq(bookings.sessionId, sessionId), eq(bookings.state, "confirmada")));
    return Number(rows[0]?.n ?? 0);
  }

  private async templateCancellationWindow(
    organizationId: string,
    templateId: string | null,
  ): Promise<number> {
    if (!templateId) return 24;
    const rows = await this.db
      .select({ h: classTemplates.cancellationWindowHours })
      .from(classTemplates)
      .where(
        and(eq(classTemplates.id, templateId), eq(classTemplates.organizationId, organizationId)),
      )
      .limit(1);
    return rows[0]?.h ?? 24;
  }
}

/** True when the error is a Postgres unique violation (SQLSTATE 23505). */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505"
  );
}

/** temprana iff the session starts at least `windowHours` from now. */
export function withinCancellationWindow(startsAt: Date, windowHours: number): boolean {
  return startsAt.getTime() - Date.now() >= windowHours * HOUR_MS;
}
