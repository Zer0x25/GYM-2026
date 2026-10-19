/**
 * Payments service (spec 003, REQ-2) — the money core of Entrega 2.
 *
 * Invariants enforced here (the backend is the authority, ADR-0002 §3):
 *
 *  1. A registered payment is PROVISIONAL and grants NO rights
 *     (SPEC:PAY-01, REQ-2). Rights derive from VALIDATED payments only.
 *  2. The state machine is terminal: provisional -> validated | rejected.
 *     No transition out of validated or rejected exists.
 *  3. A validated payment is IMMUTABLE (D-03/B): no update/delete path.
 *  4. Separation of functions (SPEC:PAY-02): only `admin` decides, and an
 *     admin can NEVER decide a payment they registered themselves.
 *  5. Validation creates the cash movement ONCE, in the same transaction
 *     as the state change and the audit row (unique constraint on
 *     cash_movements.payment_id is the idempotency key).
 *  6. Every mutation writes its audit row in the same transaction.
 *  7. Validation extends the membership window from the previous end date
 *     (no coverage gaps on renewal).
 *
 * All reads/writes filter by organizationId (REQ-1, TX-07): cross-tenant
 * ids behave as not-found, never as forbidden-with-details.
 */
import { and, eq } from "drizzle-orm";
import { TransbankEvidence } from "@gym/contracts";
import type { Database } from "@gym/db";
import {
  cashMovements,
  cashSessions,
  membershipPeriods,
  memberships,
  payments,
  plans,
} from "@gym/db";
import { conflict, forbidden, notFound } from "../errors.js";
import { AuditService } from "./audit.js";

export interface PaymentActor {
  organizationId: string;
  accountId: string;
  role: "admin" | "recepcion" | "instructor" | "socio";
}

export interface RegisterPaymentInput {
  membershipId: string;
  amountCents: number;
  method: "cash" | "transfer" | "transbank";
  reference?: string | undefined;
  comment?: string | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Drizzle transaction handle — structurally the db, bound to one tx. */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class PaymentsService {
  private readonly audit: AuditService;

  constructor(private readonly db: Database) {
    this.audit = new AuditService(db);
  }

  /**
   * Registers a PROVISIONAL payment (cobro manual). No rights, no cash
   * movement. Transfer payments must carry a bank reference (REQ-2).
   * Audit row written in the same (implicit single-statement) transaction.
   */
  async register(actor: PaymentActor, input: RegisterPaymentInput) {
    if (input.method === "transfer" && !input.reference?.trim()) {
      throw conflict("La transferencia requiere una referencia bancaria");
    }
    if (input.method === "transbank" && !TransbankEvidence.safeParse(input).success) {
      throw conflict("Transbank externo requiere número de operación y comentario válidos");
    }
    const membership = await this.findMembership(actor.organizationId, input.membershipId);
    if (!membership) throw notFound("Membresía no encontrada");
    const targetPlanId = membership.nextPlanId ?? membership.planId;
    const plan = await this.findPlan(actor.organizationId, targetPlanId);
    if (!plan) throw notFound("Plan no encontrado");

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(payments)
        .values({
          organizationId: actor.organizationId,
          memberId: membership.memberId,
          membershipId: membership.id,
          planId: targetPlanId,
          amountCents: input.amountCents,
          method: input.method,
          reference: input.reference?.trim() ?? null,
          comment: input.comment?.trim() || null,
          state: "provisional",
          registeredBy: actor.accountId,
        })
        .returning();
      if (!row) throw notFound("Pago no encontrado");

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "payment.register",
          entity: "payment",
          entityId: row.id,
          metadata: {
            amountCents: input.amountCents,
            method: input.method,
            membershipId: membership.id,
          },
        },
        tx,
      );

      return row;
    });
  }

  /** Lists payments of the organization, optionally filtered by state. */
  async list(organizationId: string, state?: "provisional" | "validated" | "rejected") {
    const conditions = [eq(payments.organizationId, organizationId)];
    if (state) conditions.push(eq(payments.state, state));
    return this.db
      .select()
      .from(payments)
      .where(and(...conditions))
      .orderBy(payments.createdAt);
  }

  async getById(organizationId: string, paymentId: string) {
    const rows = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Pago no encontrado");
    return row;
  }

  /**
   * Validates a provisional payment (admin only, distinct actor). In one
   * transaction: payment -> validated; membership window extended; cash
   * movement created; audit row written.
   */
  async validate(actor: PaymentActor, paymentId: string) {
    if (actor.role !== "admin") {
      throw forbidden("Solo un administrador puede validar pagos");
    }
    const payment = await this.getById(actor.organizationId, paymentId);
    this.assertNotSelfDecision(actor, payment.registeredBy);
    this.assertProvisional(payment.state);

    return this.db.transaction(async (tx) => {
      // Atomic guard: the WHERE still requires provisional, so two racing
      // validations cannot both succeed.
      const [validated] = await tx
        .update(payments)
        .set({ state: "validated", decidedBy: actor.accountId, decidedAt: new Date() })
        .where(and(eq(payments.id, paymentId), eq(payments.state, "provisional")))
        .returning();
      if (!validated) throw conflict("El pago cambió de estado durante la validación");

      // Extend the membership window from the previous end (no gaps).
      const [membership] = await tx
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, actor.organizationId),
            eq(memberships.id, payment.membershipId),
          ),
        )
        .for("update");
      if (!membership) throw notFound("Membresía no encontrada");

      const targetPlanId = membership.nextPlanId ?? payment.planId;
      const plan = await this.findPlan(actor.organizationId, targetPlanId, tx);
      if (!plan) throw notFound("Plan no encontrado");

      const now = new Date();
      const previousEnd = membership.endAt ? new Date(membership.endAt) : null;
      const start = previousEnd && previousEnd > now ? previousEnd : now;
      const end = new Date(start.getTime() + plan.durationDays * DAY_MS);

      const updateValues: Record<string, unknown> = {
        startAt: previousEnd && previousEnd > now ? (membership.startAt ?? start) : start,
        endAt: end,
        lastPaymentId: paymentId,
      };
      if (membership.nextPlanId) {
        updateValues.planId = membership.nextPlanId;
        updateValues.nextPlanId = null;
      }

      await tx
        .update(memberships)
        .set(updateValues)
        .where(eq(memberships.id, membership.id));

      await tx.insert(membershipPeriods).values({
        organizationId: actor.organizationId,
        memberId: membership.memberId,
        membershipId: membership.id,
        paymentId,
        startsAt: start,
        endsAt: end,
        coverage: plan.coverage,
        planName: plan.name,
        priceCents: plan.priceCents,
        durationDays: plan.durationDays,
        planVersion: plan.version ?? 1,
        grupalCredits: plan.grupalCredits,
        fijaCredits: plan.fijaCredits,
        citaCredits: plan.citaCredits,
      });

      // Cash movement: created here and only here (validated money), and
      // ALWAYS inside an open session — validated money has a responsible
      // shift. No open session → refuse to validate (no orphan money).
      const session = await this.findOpenSession(actor.organizationId, tx);
      if (!session) {
        throw conflict("No hay un turno de caja abierto: abrilo antes de validar pagos");
      }
      await tx.insert(cashMovements).values({
        organizationId: actor.organizationId,
        sessionId: session.id,
        paymentId,
        type: "income",
        method: payment.method,
        amountCents: payment.amountCents,
      });

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "payment.validate",
          entity: "payment",
          entityId: paymentId,
          metadata: {
            amountCents: payment.amountCents,
            method: payment.method,
            membershipId: payment.membershipId,
          },
        },
        tx,
      );

      return validated;
    });
  }

  /**
   * Rejects a provisional payment (admin only, distinct actor). Terminal:
   * a rejected payment can never be validated afterwards. Reason mandatory.
   */
  async reject(actor: PaymentActor, paymentId: string, reason: string) {
    if (actor.role !== "admin") {
      throw forbidden("Solo un administrador puede rechazar pagos");
    }
    if (!reason?.trim()) throw conflict("El rechazo requiere un motivo auditable");
    const payment = await this.getById(actor.organizationId, paymentId);
    this.assertNotSelfDecision(actor, payment.registeredBy);
    this.assertProvisional(payment.state);

    return this.db.transaction(async (tx) => {
      const [rejected] = await tx
        .update(payments)
        .set({ state: "rejected", decidedBy: actor.accountId, decidedAt: new Date(), reason })
        .where(and(eq(payments.id, paymentId), eq(payments.state, "provisional")))
        .returning();
      if (!rejected) throw conflict("El pago cambió de estado durante el rechazo");

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "payment.reject",
          entity: "payment",
          entityId: paymentId,
          metadata: { reason },
        },
        tx,
      );

      return rejected;
    });
  }

  /**
   * Derived membership state (SPEC rights rule, REQ-2): computed from
   * payments on every read — never a stored, editable flag.
   */
  async membershipState(
    organizationId: string,
    membershipId: string,
  ): Promise<"pending_payment" | "active" | "expired"> {
    const membership = await this.findMembership(organizationId, membershipId);
    if (!membership) throw notFound("Membresía no encontrada");
    if (!membership.endAt) return "pending_payment";
    return new Date(membership.endAt) > new Date() ? "active" : "expired";
  }

  // --- internals ------------------------------------------------------------

  /** Separation of functions: nobody decides their own registration. */
  private assertNotSelfDecision(actor: PaymentActor, registeredBy: string): void {
    if (actor.accountId === registeredBy) {
      throw forbidden("No podés validar o rechazar un pago que vos mismo registraste");
    }
  }

  private assertProvisional(state: string): void {
    if (state === "validated") throw conflict("El pago ya está validado (inmutable)");
    if (state === "rejected") throw conflict("El pago ya fue rechazado");
  }

  private async findMembership(organizationId: string, membershipId: string, tx?: Tx) {
    const db = tx ?? this.db;
    const rows = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
      .limit(1);
    return rows[0];
  }

  private async findPlan(organizationId: string, planId: string, tx?: Tx) {
    const db = tx ?? this.db;
    const rows = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.organizationId, organizationId)))
      .limit(1);
    return rows[0];
  }

  /** The org's currently open cash session (the movement lands there). */
  private async findOpenSession(organizationId: string, tx?: Tx) {
    const db = tx ?? this.db;
    const rows = await db
      .select()
      .from(cashSessions)
      .where(and(eq(cashSessions.organizationId, organizationId), eq(cashSessions.state, "open")))
      .limit(1);
    return rows[0];
  }
}
