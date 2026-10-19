/**
 * Sessions service (spec 004) — class templates, sessions and the unified
 * instructor agenda.
 *
 * Invariants (backend is the authority, ADR-0002 §3):
 *  1. No instructor may hold two commitments that overlap in time
 *     (grupal + fija + cita + bloqueo) → TX-02 / REQ-6.
 *  2. Every read/write filters by organizationId (REQ-1, TX-07): a session
 *     from another tenant behaves as not-found (no existence leak).
 *  3. Every mutation writes its audit row in the same transaction.
 */
import { and, asc, eq, gt, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import type { Database } from "@gym/db";
import {
  bookings,
  classTemplates,
  membershipPauses,
  membershipPeriods,
  memberships,
  sessions,
} from "@gym/db";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import { BookingsService } from "./bookings.js";
import { AuditService } from "./audit.js";

export interface SessionActor {
  organizationId: string;
  accountId: string;
  role: "admin" | "recepcion" | "instructor" | "socio";
}

export interface CreateSessionInput {
  templateId?: string | undefined;
  type: "grupal" | "fija" | "cita" | "bloqueo";
  instructorId: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
}

export interface RescheduleSessionInput {
  startsAt: Date;
  endsAt: Date;
  reason?: string | undefined;
}

export class SessionsService {
  private readonly audit: AuditService;

  constructor(private readonly db: Database) {
    this.audit = new AuditService(db);
  }

  // --- Class templates (admin only) -----------------------------------------

  async createTemplate(
    actor: SessionActor,
    input: {
      name: string;
      type: "grupal" | "fija";
      capacity: number;
      reservationWindowHours?: number;
      cancellationWindowHours?: number;
      coverageRequired?: "none" | "unlimited" | "limited";
    },
  ) {
    if (actor.role !== "admin") throw forbidden("Solo un administrador crea plantillas de clase");
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(classTemplates)
        .values({
          organizationId: actor.organizationId,
          name: input.name,
          type: input.type,
          capacity: input.capacity,
          reservationWindowHours: input.reservationWindowHours ?? 0,
          cancellationWindowHours: input.cancellationWindowHours ?? 24,
          coverageRequired: input.coverageRequired ?? "unlimited",
        })
        .returning();
      if (!row) throw notFound("Plantilla no encontrada");
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "class_template.create",
          entity: "class_template",
          entityId: row.id,
          metadata: { name: input.name, type: input.type, capacity: input.capacity },
        },
        tx,
      );
      return row;
    });
  }

  async listTemplates(organizationId: string) {
    return this.db
      .select()
      .from(classTemplates)
      .where(eq(classTemplates.organizationId, organizationId))
      .orderBy(classTemplates.name);
  }

  // --- Sessions ---------------------------------------------------------------

  /**
   * Creates a session (grupal/fija/cita/bloqueo). Rejects any real overlap
   * with an existing scheduled commitment of the same instructor (TX-02).
   * The `SELECT ... FOR UPDATE` on conflicting rows serializes two racing
   * creates so both cannot pass the overlap check.
   */
  async create(actor: SessionActor, input: CreateSessionInput) {
    if (input.endsAt <= input.startsAt) {
      throw validationError({
        issues: [{ path: ["endsAt"], message: "El fin debe ser posterior al inicio" }],
      });
    }
    if (input.type === "bloqueo" && actor.role === "socio") {
      throw forbidden("Un socio no crea bloqueos de agenda");
    }

    return this.db.transaction(async (tx) => {
      // A row lock cannot protect an empty agenda. Serialize by tenant + instructor first.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.organizationId + ":" + input.instructorId}, 0))`,
      );
      const overlap = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.organizationId, actor.organizationId),
            eq(sessions.instructorId, input.instructorId),
            eq(sessions.state, "programada"),
            lt(sessions.startsAt, input.endsAt),
            gt(sessions.endsAt, input.startsAt),
          ),
        )
        .for("update")
        .limit(1);
      if (overlap[0]) {
        throw conflict("El instructor ya tiene un compromiso que se solapa en ese horario");
      }

      const [row] = await tx
        .insert(sessions)
        .values({
          organizationId: actor.organizationId,
          templateId: input.templateId ?? null,
          type: input.type,
          instructorId: input.instructorId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          capacity: input.type === "bloqueo" ? 0 : input.capacity,
          state: "programada",
          createdBy: actor.accountId,
        })
        .returning();
      if (!row) throw notFound("Sesión no encontrada");

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "session.create",
          entity: "session",
          entityId: row.id,
          metadata: {
            type: input.type,
            instructorId: input.instructorId,
            startsAt: input.startsAt.toISOString(),
            endsAt: input.endsAt.toISOString(),
          },
        },
        tx,
      );

      return row;
    });
  }

  /** Cancels a session (el gimnasio cancela). Bookings keep their own policy. */
  async cancel(actor: SessionActor, sessionId: string) {
    if (actor.role !== "admin" && actor.role !== "recepcion") throw forbidden();
    const session = await this.getById(actor.organizationId, sessionId);
    if (session.state === "cancelada") throw conflict("La sesión ya está cancelada");
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(sessions)
        .set({ state: "cancelada" })
        .where(and(eq(sessions.id, sessionId), eq(sessions.state, "programada")))
        .returning();
      if (!row) throw conflict("La sesión cambió de estado");
      await new BookingsService(this.db).cancelForSession(tx, actor, sessionId);
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "session.cancel",
          entity: "session",
          entityId: sessionId,
          metadata: {},
        },
        tx,
      );
      return row;
    });
  }

  /**
   * Reschedules a scheduled session in the future (spec 018).
   * Invariants (TX-02 + REVAL-01):
   * 1. Advisory lock on instructor + row lock on sessions.
   * 2. Checks instructor agenda overlap (TX-02).
   * 3. Revalidates confirmed bookings' coverage and prevents member double booking (REVAL-01).
   * 4. Updates session with rescheduled metadata and audit row without altering bookings or credit deductions.
   */
  async reschedule(actor: SessionActor, sessionId: string, input: RescheduleSessionInput) {
    if (input.endsAt <= input.startsAt) {
      throw validationError({
        issues: [{ path: ["endsAt"], message: "El fin debe ser posterior al inicio" }],
      });
    }
    if (input.startsAt <= new Date()) {
      throw conflict("El nuevo horario debe estar en el futuro respecto al servidor", {
        reason: "PAST_SCHEDULE",
      });
    }

    return this.db.transaction(async (tx) => {
      // 1. Anti-enumeration: look up within actor's tenant
      const [session] = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, actor.organizationId)))
        .for("update");

      if (!session) {
        throw notFound("Sesión no encontrada");
      }

      // Permissions check
      if (actor.role === "socio") {
        throw forbidden("Un socio no puede reprogramar sesiones");
      }
      if (actor.role === "instructor") {
        if (
          session.instructorId !== actor.accountId ||
          (session.type !== "cita" && session.type !== "bloqueo")
        ) {
          throw forbidden("Un instructor solo reprograma sus propias citas o bloqueos");
        }
      } else if (actor.role !== "admin" && actor.role !== "recepcion") {
        throw forbidden();
      }

      // State and date checks
      if (session.state !== "programada") {
        throw conflict("La sesión no está programada");
      }
      if (session.startsAt <= new Date()) {
        throw conflict("La sesión ya inició o ya pasó");
      }

      // Advisory lock on instructor (TX-02)
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.organizationId + ":" + session.instructorId}, 0))`,
      );

      // Check overlap for the instructor (TX-02)
      const overlap = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.organizationId, actor.organizationId),
            eq(sessions.instructorId, session.instructorId),
            eq(sessions.state, "programada"),
            ne(sessions.id, session.id),
            lt(sessions.startsAt, input.endsAt),
            gt(sessions.endsAt, input.startsAt),
          ),
        )
        .for("update")
        .limit(1);

      if (overlap[0]) {
        throw conflict("El instructor ya tiene un compromiso que se solapa en ese horario", {
          reason: "SESSION_OVERLAP",
        });
      }

      // Check confirmed bookings & member coverage (REVAL-01)
      const confirmedBookings = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.sessionId, session.id), eq(bookings.state, "confirmada")));

      if (confirmedBookings.length > 0) {
        const memberIds = Array.from(new Set(confirmedBookings.map((b) => b.memberId))).sort();

        // Lock memberships and periods in stable order
        await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, actor.organizationId),
              inArray(memberships.memberId, memberIds),
            ),
          )
          .orderBy(asc(memberships.id))
          .for("update");

        await tx
          .select({ id: membershipPeriods.id })
          .from(membershipPeriods)
          .where(
            and(
              eq(membershipPeriods.organizationId, actor.organizationId),
              inArray(membershipPeriods.memberId, memberIds),
            ),
          )
          .orderBy(asc(membershipPeriods.id))
          .for("update");

        for (const b of confirmedBookings) {
          // Check double booking for the member
          const [otherBooking] = await tx
            .select({ id: bookings.id })
            .from(bookings)
            .innerJoin(sessions, eq(bookings.sessionId, sessions.id))
            .where(
              and(
                eq(bookings.organizationId, actor.organizationId),
                eq(bookings.memberId, b.memberId),
                eq(bookings.state, "confirmada"),
                ne(bookings.sessionId, session.id),
                eq(sessions.state, "programada"),
                lt(sessions.startsAt, input.endsAt),
                gt(sessions.endsAt, input.startsAt),
              ),
            )
            .limit(1);

          if (otherBooking) {
            throw conflict("Un socio inscrito ya tiene otra reserva en ese horario", {
              reason: "RESCHEDULE_MEMBER_UNCOVERED",
            });
          }

          // Check coverage at new startsAt
          let covered = false;
          let targetMembershipId: string | null = null;

          if (b.periodId) {
            const [period] = await tx
              .select()
              .from(membershipPeriods)
              .where(
                and(
                  eq(membershipPeriods.organizationId, actor.organizationId),
                  eq(membershipPeriods.id, b.periodId),
                ),
              );

            if (period && period.startsAt <= input.startsAt && period.endsAt > input.startsAt) {
              covered = true;
              targetMembershipId = period.membershipId;
            } else {
              // Check if member has another confirmed period of the same modality covering the date
              const periods = await tx
                .select()
                .from(membershipPeriods)
                .where(
                  and(
                    eq(membershipPeriods.organizationId, actor.organizationId),
                    eq(membershipPeriods.memberId, b.memberId),
                    lte(membershipPeriods.startsAt, input.startsAt),
                    gt(membershipPeriods.endsAt, input.startsAt),
                  ),
                );
              const modality = session.type as "grupal" | "fija" | "cita";
              const validPeriod = periods.find((p) => {
                if (p.coverage === "unlimited") return true;
                if (p.coverage === "limited") {
                  const quota =
                    modality === "grupal"
                      ? p.grupalCredits
                      : modality === "fija"
                        ? p.fijaCredits
                        : p.citaCredits;
                  return quota !== null && quota > 0;
                }
                return false;
              });
              if (validPeriod) {
                covered = true;
                targetMembershipId = validPeriod.membershipId;
              }
            }
          } else {
            const msList = await tx
              .select()
              .from(memberships)
              .where(
                and(
                  eq(memberships.organizationId, actor.organizationId),
                  eq(memberships.memberId, b.memberId),
                ),
              );
            const validMs = msList.find(
              (m) =>
                m.startAt &&
                m.endAt &&
                m.startAt <= input.startsAt &&
                m.endAt > input.startsAt,
            );
            if (validMs) {
              covered = true;
              targetMembershipId = validMs.id;
            }
          }

          if (!covered || !targetMembershipId) {
            throw conflict("El socio no tiene cobertura vigente en la nueva fecha", {
              reason: "RESCHEDULE_MEMBER_UNCOVERED",
            });
          }

          // Check active pause on the membership covering the new startsAt
          const [pause] = await tx
            .select({ id: membershipPauses.id })
            .from(membershipPauses)
            .where(
              and(
                eq(membershipPauses.organizationId, actor.organizationId),
                eq(membershipPauses.membershipId, targetMembershipId),
                eq(membershipPauses.state, "active"),
                lte(membershipPauses.startsAt, input.startsAt),
                gt(membershipPauses.endsAt, input.startsAt),
              ),
            )
            .limit(1);

          if (pause) {
            throw conflict("El socio tiene una pausa activa en la nueva fecha", {
              reason: "RESCHEDULE_MEMBER_UNCOVERED",
            });
          }
        }
      }

      // Update session
      const [updatedSession] = await tx
        .update(sessions)
        .set({
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          rescheduledAt: new Date(),
          rescheduledFromStartsAt: session.startsAt,
          rescheduledCount: (session.rescheduledCount ?? 0) + 1,
        })
        .where(eq(sessions.id, session.id))
        .returning();

      if (!updatedSession) {
        throw conflict("No se pudo actualizar la sesión");
      }

      // Audit record
      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "session.rescheduled",
          entity: "session",
          entityId: session.id,
          metadata: {
            fromStartsAt: session.startsAt.toISOString(),
            fromEndsAt: session.endsAt.toISOString(),
            toStartsAt: input.startsAt.toISOString(),
            toEndsAt: input.endsAt.toISOString(),
            reason: input.reason ?? null,
            rescheduledCount: updatedSession.rescheduledCount,
          },
        },
        tx,
      );

      return updatedSession;
    });
  }

  async getById(organizationId: string, sessionId: string) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Sesión no encontrada");
    return row;
  }

  /** Bookable sessions of the org within a time range (portal/recepción). */
  async listBookable(organizationId: string, from: Date, to: Date) {
    return this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.organizationId, organizationId),
          eq(sessions.state, "programada"),
          or(eq(sessions.type, "grupal"), eq(sessions.type, "fija"), eq(sessions.type, "cita")),
          gt(sessions.startsAt, from),
          lt(sessions.startsAt, to),
        ),
      )
      .orderBy(sessions.startsAt);
  }

  /**
   * Unified instructor agenda (REQ-6): every commitment of the instructor
   * in a range, merged regardless of type. No overlap can exist (enforced
   * at create time), so this is a coherent timeline.
   */
  async agenda(organizationId: string, instructorId: string, from: Date, to: Date) {
    return this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.organizationId, organizationId),
          eq(sessions.instructorId, instructorId),
          gt(sessions.startsAt, from),
          lt(sessions.startsAt, to),
        ),
      )
      .orderBy(sessions.startsAt);
  }
}
