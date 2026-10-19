/**
 * Memberships service (spec 003, spec 017).
 *
 * Assigns a plan to a member (membresía). The membership starts WITHOUT a
 * validity window (pending_payment); the window is set by the FIRST
 * validated payment (PaymentsService.validate) — never at assignment.
 * Tenant-scoped like every other service (REQ-1, TX-07).
 */
import { and, eq, sql, lte, gt, gte, lt } from "drizzle-orm";
import type { Database } from "@gym/db";
import {
  members,
  memberships,
  plans,
  membershipPeriods,
  membershipPauses,
  bookings,
  sessions,
  bookingCancellations,
} from "@gym/db";
import { conflict, forbidden, notFound } from "../errors.js";
import { CreateMembershipPauseRequest } from "@gym/contracts";
import { AuditService } from "./audit.js";
import { BookingCreditsService } from "./booking-credits.js";
import type { BookingActor } from "./bookings.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MembershipActor {
  organizationId: string;
  accountId: string;
  role: "admin" | "recepcion" | "instructor" | "socio";
}

export class MembershipsService {
  private readonly audit: AuditService;

  constructor(private readonly db: Database) {
    this.audit = new AuditService(db);
  }

  /**
   * Creates a membership (socio inscripto en un plan) with NO validity
   * window yet: state is pending_payment until a payment is validated.
   */
  async assign(organizationId: string, memberId: string, planId: string) {
    const member = await this.findMember(organizationId, memberId);
    if (!member) throw notFound("Socio no encontrado");
    const plan = await this.findPlan(organizationId, planId);
    if (!plan) throw notFound("Plan no encontrado");
    if (!plan.active) throw conflict("No se puede asignar un plan inactivo");

    const [row] = await this.db
      .insert(memberships)
      .values({
        organizationId,
        memberId,
        planId,
        // startAt/endAt stay null until the first validated payment.
      })
      .returning();
    if (!row) throw notFound("Membresía no encontrada");
    return row;
  }

  /**
   * Schedules a plan change for the next renewal period (SPEC 017).
   * Allowed for admin and recepcion.
   */
  async schedulePlanChange(actor: MembershipActor, membershipId: string, nextPlanId: string | null) {
    if (actor.role !== "admin" && actor.role !== "recepcion") {
      throw forbidden("Solo administración y recepción pueden programar cambio de plan");
    }
    const membership = await this.getById(actor.organizationId, membershipId);

    if (nextPlanId !== null) {
      const plan = await this.findPlan(actor.organizationId, nextPlanId);
      if (!plan) throw notFound("Plan no encontrado");
      if (!plan.active) throw conflict("No se puede programar un plan inactivo");
    }

    const [updated] = await this.db
      .update(memberships)
      .set({ nextPlanId })
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, actor.organizationId)))
      .returning();

    if (!updated) throw notFound("Membresía no encontrada");

    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.accountId,
      actorRole: actor.role,
      action: "membership.schedule_plan_change",
      entity: "membership",
      entityId: membershipId,
      metadata: { previousNextPlanId: membership.nextPlanId, nextPlanId },
    });

    return updated;
  }

  /**
   * Registers an authorized membership pause (SPEC 017, admin only).
   * Extends the current period endsAt and membership endAt, and cancels future bookings in the pause interval.
   */
  async createPause(actor: MembershipActor, membershipId: string, rawInput: CreateMembershipPauseRequest) {
    if (actor.role !== "admin") {
      throw forbidden("Solo un administrador puede registrar pausas de membresía");
    }
    const input = CreateMembershipPauseRequest.parse(rawInput);
    const pauseStarts = new Date(input.startsAt);
    const pauseEnds = new Date(input.endsAt);
    const extendedDays = Math.ceil((pauseEnds.getTime() - pauseStarts.getTime()) / DAY_MS);
    if (extendedDays < 1) throw conflict("La pausa debe durar al menos 1 día");

    return this.db.transaction(async (tx) => {
      // Advisory lock scoped to this tenant and idempotencyKey
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.organizationId + ":pause:" + input.idempotencyKey}, 0))`,
      );

      const [existing] = await tx
        .select()
        .from(membershipPauses)
        .where(
          and(
            eq(membershipPauses.organizationId, actor.organizationId),
            eq(membershipPauses.idempotencyKey, input.idempotencyKey),
          ),
        );

      if (existing) {
        if (
          existing.membershipId === membershipId &&
          new Date(existing.startsAt).getTime() === pauseStarts.getTime() &&
          new Date(existing.endsAt).getTime() === pauseEnds.getTime() &&
          existing.reason === input.reason
        ) {
          return existing;
        }
        throw conflict("La clave de idempotencia ya fue utilizada con otros parámetros");
      }

      // Lock membership row
      const [membership] = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, actor.organizationId)))
        .for("update");
      if (!membership) throw notFound("Membresía no encontrada");

      // Find active period covering startsAt
      const periods = await tx
        .select()
        .from(membershipPeriods)
        .where(
          and(
            eq(membershipPeriods.organizationId, actor.organizationId),
            eq(membershipPeriods.membershipId, membershipId),
            lte(membershipPeriods.startsAt, pauseStarts),
            gt(membershipPeriods.endsAt, pauseStarts),
          ),
        )
        .for("update")
        .limit(1);

      const period = periods[0];
      if (!period) {
        throw conflict("La membresía no tiene un período vigente que cubra la fecha de inicio de la pausa");
      }

      // Check overlapping active pauses for this membership
      const [overlap] = await tx
        .select()
        .from(membershipPauses)
        .where(
          and(
            eq(membershipPauses.organizationId, actor.organizationId),
            eq(membershipPauses.membershipId, membershipId),
            eq(membershipPauses.state, "active"),
            lt(membershipPauses.startsAt, pauseEnds),
            gt(membershipPauses.endsAt, pauseStarts),
          ),
        )
        .limit(1);

      if (overlap) {
        throw conflict("Ya existe una pausa que se solapa con el intervalo solicitado");
      }

      // Extend membership_periods.endsAt and memberships.endAt
      const newPeriodEndsAt = new Date(period.endsAt.getTime() + extendedDays * DAY_MS);
      await tx
        .update(membershipPeriods)
        .set({ endsAt: newPeriodEndsAt })
        .where(eq(membershipPeriods.id, period.id));

      if (membership.endAt) {
        const newMembershipEndAt = new Date(membership.endAt.getTime() + extendedDays * DAY_MS);
        await tx
          .update(memberships)
          .set({ endAt: newMembershipEndAt })
          .where(eq(memberships.id, membership.id));
      }

      // Cancel future confirmed bookings falling inside [startsAt, endsAt)
      const bookingsToCancel = await tx
        .select({
          id: bookings.id,
          sessionId: bookings.sessionId,
          startsAt: sessions.startsAt,
        })
        .from(bookings)
        .innerJoin(sessions, eq(sessions.id, bookings.sessionId))
        .where(
          and(
            eq(bookings.organizationId, actor.organizationId),
            eq(bookings.memberId, membership.memberId),
            eq(bookings.state, "confirmada"),
            gte(sessions.startsAt, pauseStarts),
            lt(sessions.startsAt, pauseEnds),
          ),
        );

      const creditsService = new BookingCreditsService(this.db);
      for (const b of bookingsToCancel) {
        await tx
          .update(bookings)
          .set({ state: "cancelada" })
          .where(eq(bookings.id, b.id));

        const effect = await creditsService.restore(tx, actor as BookingActor, b.id);
        await tx.insert(bookingCancellations).values({
          organizationId: actor.organizationId,
          bookingId: b.id,
          type: "gimnasio",
          creditReturned: effect.creditReturned,
          creditReviewRequired: effect.creditReviewRequired,
          reason: input.reason,
          actorId: actor.accountId,
          actorRole: actor.role,
        });
      }

      // Record pause
      const [pause] = await tx
        .insert(membershipPauses)
        .values({
          organizationId: actor.organizationId,
          membershipId: membership.id,
          periodId: period.id,
          actorId: actor.accountId,
          idempotencyKey: input.idempotencyKey,
          startsAt: pauseStarts,
          endsAt: pauseEnds,
          extendedDays,
          reason: input.reason,
          state: "active",
        })
        .returning();

      if (!pause) throw conflict("No se pudo registrar la pausa");

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "membership.paused",
          entity: "membership",
          entityId: membership.id,
          metadata: {
            pauseId: pause.id,
            startsAt: pauseStarts.toISOString(),
            endsAt: pauseEnds.toISOString(),
            extendedDays,
            reason: input.reason,
            cancelledBookings: bookingsToCancel.length,
          },
        },
        tx,
      );

      return pause;
    });
  }

  /** Lists memberships of the organization. */
  async list(organizationId: string) {
    return this.db
      .select()
      .from(memberships)
      .where(eq(memberships.organizationId, organizationId))
      .orderBy(memberships.createdAt);
  }

  /** Lists memberships of one member (portal: solo las propias). */
  async listByMember(organizationId: string, memberId: string) {
    return this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.memberId, memberId)))
      .orderBy(memberships.createdAt);
  }

  async getById(organizationId: string, membershipId: string) {
    const rows = await this.db
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Membresía no encontrada");
    return row;
  }

  private async findMember(organizationId: string, memberId: string) {
    const rows = await this.db
      .select()
      .from(members)
      .where(and(eq(members.id, memberId), eq(members.organizationId, organizationId)))
      .limit(1);
    return rows[0];
  }

  private async findPlan(organizationId: string, planId: string) {
    const rows = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.organizationId, organizationId)))
      .limit(1);
    return rows[0];
  }
}
