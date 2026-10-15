import { and, asc, eq, sql, inArray } from "drizzle-orm";
import {
  creditMovements,
  membershipPeriods,
  memberships,
  plans,
  members,
  type Database,
} from "@gym/db";
import { conflict, forbidden, notFound } from "../errors.js";
import type { BookingActor } from "./bookings.js";
export type CreditTx = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Modality = "grupal" | "fija" | "cita";
type Session = { type: string; startsAt: Date };
const modalities = ["grupal", "fija", "cita"] as const;
const quotaFor = (
  period: { grupalCredits: number | null; fijaCredits: number | null; citaCredits: number | null },
  modality: Modality,
) =>
  modality === "grupal"
    ? period.grupalCredits
    : modality === "fija"
      ? period.fijaCredits
      : period.citaCredits;

export class BookingCreditsService {
  constructor(private readonly db: Database) {}
  private async net(tx: Pick<Database, "select">, org: string, period: string, modality: Modality) {
    const [row] = await tx
      .select({ n: sql<number>`COALESCE(SUM(${creditMovements.quantity}),0)::int` })
      .from(creditMovements)
      .where(
        and(
          eq(creditMovements.organizationId, org),
          eq(creditMovements.periodId, period),
          eq(creditMovements.modality, modality),
        ),
      );
    return Number(row?.n ?? 0);
  }
  async choose(
    tx: CreditTx,
    actor: BookingActor,
    memberId: string,
    session: Session,
    existing?: { id: string; periodId: string | null },
  ) {
    if (!modalities.includes(session.type as Modality)) throw conflict("Modalidad no reservable");
    const modality = session.type as Modality;
    // Stable order across memberships; every reservation of this member shares these locks.
    const ms = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, actor.organizationId),
          eq(memberships.memberId, memberId),
        ),
      )
      .orderBy(asc(memberships.id))
      .for("update");
    for (const membership of ms) {
      if (
        !membership.startAt ||
        !membership.endAt ||
        membership.startAt > session.startsAt ||
        membership.endAt <= session.startsAt
      )
        continue;
      const periods = await tx
        .select()
        .from(membershipPeriods)
        .where(
          and(
            eq(membershipPeriods.organizationId, actor.organizationId),
            eq(membershipPeriods.membershipId, membership.id),
            eq(membershipPeriods.memberId, memberId),
          ),
        )
        .orderBy(asc(membershipPeriods.endsAt), asc(membershipPeriods.id))
        .for("update");
      for (const period of periods) {
        if (existing?.periodId && period.id !== existing.periodId) continue;
        if (period.startsAt > session.startsAt || period.endsAt <= session.startsAt) continue;
        if (period.coverage === "unlimited")
          return { periodId: period.id, limited: false, modality };
        if (period.coverage !== "limited") continue;
        const quota = quotaFor(period, modality);
        if (quota === null || quota === 0) continue;
        if (existing) {
          const [commit] = await tx
            .select()
            .from(creditMovements)
            .where(
              and(
                eq(creditMovements.organizationId, actor.organizationId),
                eq(creditMovements.bookingId, existing.id),
                eq(creditMovements.periodId, period.id),
                eq(creditMovements.kind, "commit"),
              ),
            );
          if (commit) return { periodId: period.id, limited: true, modality };
        } else if (quota + (await this.net(tx, actor.organizationId, period.id, modality)) > 0)
          return { periodId: period.id, limited: true, modality };
      }
      // Compatibility for pre-period unlimited fixtures/windows only; never grant limited quotas.
      if (!periods.length && !existing?.periodId) {
        const [plan] = await tx
          .select()
          .from(plans)
          .where(
            and(eq(plans.organizationId, actor.organizationId), eq(plans.id, membership.planId)),
          );
        if (plan?.coverage === "unlimited") return { periodId: null, limited: false, modality };
      }
    }
    throw conflict("La membresía no cubre la fecha/modalidad o no quedan créditos en ese período");
  }
  async commit(
    tx: CreditTx,
    actor: BookingActor,
    memberId: string,
    bookingId: string,
    choice: { periodId: string | null; limited: boolean; modality: Modality },
  ) {
    if (choice.limited && choice.periodId)
      await tx.insert(creditMovements).values({
        organizationId: actor.organizationId,
        memberId,
        periodId: choice.periodId,
        bookingId,
        modality: choice.modality,
        kind: "commit",
        quantity: -1,
        actorId: actor.accountId,
      });
  }
  async lockMembers(tx: CreditTx, org: string, memberIds: string[]) {
    if (!memberIds.length) return;
    await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.organizationId, org), inArray(memberships.memberId, memberIds)))
      .orderBy(asc(memberships.id))
      .for("update");
  }
  async restore(tx: CreditTx, actor: BookingActor, bookingId: string) {
    const [commit] = await tx
      .select()
      .from(creditMovements)
      .where(
        and(
          eq(creditMovements.organizationId, actor.organizationId),
          eq(creditMovements.bookingId, bookingId),
          eq(creditMovements.kind, "commit"),
        ),
      );
    if (!commit) return { creditReturned: true, creditReviewRequired: false };
    const [period] = await tx
      .select()
      .from(membershipPeriods)
      .where(
        and(
          eq(membershipPeriods.organizationId, actor.organizationId),
          eq(membershipPeriods.id, commit.periodId),
        ),
      )
      .for("update");
    if (!period) throw conflict("No se encontró el período comprometido");
    const review = period.endsAt <= new Date();
    await tx.insert(creditMovements).values({
      organizationId: actor.organizationId,
      memberId: commit.memberId,
      periodId: period.id,
      bookingId,
      modality: commit.modality,
      kind: review ? "review" : "return",
      quantity: review ? 0 : 1,
      actorId: actor.accountId,
    });
    return { creditReturned: !review, creditReviewRequired: review };
  }
  async list(actor: BookingActor, memberId: string) {
    if (!["admin", "recepcion", "socio"].includes(actor.role)) throw forbidden();
    if (actor.role === "socio" && actor.memberId !== memberId)
      throw notFound("Socio no encontrado");
    const [member] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.organizationId, actor.organizationId), eq(members.id, memberId)));
    if (!member) throw notFound("Socio no encontrado");
    // One repeatable-read snapshot prevents quota/ledger drift in the response.
    return this.db.transaction(
      async (tx) => {
        const periods = await tx
          .select()
          .from(membershipPeriods)
          .where(
            and(
              eq(membershipPeriods.organizationId, actor.organizationId),
              eq(membershipPeriods.memberId, memberId),
            ),
          )
          .orderBy(asc(membershipPeriods.startsAt), asc(membershipPeriods.id));
        const result = [];
        for (const period of periods) {
          const credits = {} as Record<
            Modality,
            { quota: number | null; committed: number; available: number | null }
          >;
          for (const modality of modalities) {
            const quota = period.coverage === "limited" ? quotaFor(period, modality) : null;
            const committed = -(await this.net(tx, actor.organizationId, period.id, modality));
            credits[modality] = {
              quota,
              committed,
              available: quota === null ? null : quota - committed,
            };
          }
          const reviews = await tx
            .select({ bookingId: creditMovements.bookingId })
            .from(creditMovements)
            .where(
              and(
                eq(creditMovements.organizationId, actor.organizationId),
                eq(creditMovements.periodId, period.id),
                eq(creditMovements.kind, "review"),
              ),
            );
          result.push({
            id: period.id,
            startsAt: period.startsAt.toISOString(),
            endsAt: period.endsAt.toISOString(),
            coverage: period.coverage,
            planName: period.planName,
            credits,
            reviewCount: reviews.length,
            reviewBookingIds: reviews.map((r) => r.bookingId),
          });
        }
        return result;
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
}
