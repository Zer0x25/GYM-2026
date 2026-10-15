import { and, eq, sql } from "drizzle-orm";
import { cashSessions, financialAdjustments, payments, type Database } from "@gym/db";
import { RegisterFinancialAdjustmentRequest } from "@gym/contracts";
import { conflict, forbidden, notFound, validationError } from "../errors.js";
import type { PaymentActor } from "./payments.js";
import { AuditService } from "./audit.js";

export class FinancialAdjustmentsService {
  constructor(private readonly db: Database) {}

  async list(actor: PaymentActor, paymentId: string) {
    if (actor.role !== "admin" && actor.role !== "recepcion") throw forbidden();
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.organizationId, actor.organizationId)));
    if (!payment) throw notFound("Pago no encontrado");
    const items = await this.db
      .select()
      .from(financialAdjustments)
      .where(
        and(
          eq(financialAdjustments.paymentId, paymentId),
          eq(financialAdjustments.organizationId, actor.organizationId),
        ),
      )
      .orderBy(financialAdjustments.createdAt);
    const compensatedCents = items.reduce((sum, row) => sum + row.amountCents, 0);
    return { items, compensatedCents, remainingCents: payment.amountCents - compensatedCents };
  }

  async register(actor: PaymentActor, paymentId: string, raw: RegisterFinancialAdjustmentRequest) {
    if (actor.role !== "admin") throw forbidden("Solo administración compensa pagos");
    const parsed = RegisterFinancialAdjustmentRequest.safeParse(raw);
    if (!parsed.success) throw validationError({ issues: parsed.error.issues });
    const input = parsed.data;
    return this.db.transaction(async (tx) => {
      // Serialize a key across different payments, then serialize each payment's balance.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${actor.organizationId + ":adjustment:" + input.idempotencyKey}, 0))`,
      );
      const [payment] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.organizationId, actor.organizationId)))
        .for("update");
      if (!payment) throw notFound("Pago no encontrado");
      const [existing] = await tx
        .select()
        .from(financialAdjustments)
        .where(
          and(
            eq(financialAdjustments.organizationId, actor.organizationId),
            eq(financialAdjustments.idempotencyKey, input.idempotencyKey),
          ),
        );
      if (existing) {
        if (
          existing.paymentId !== paymentId ||
          existing.amountCents !== input.amountCents ||
          existing.kind !== input.kind ||
          existing.reason !== input.reason
        )
          throw conflict("La clave ya pertenece a otra intención");
        return existing;
      }
      if (payment.state !== "validated") throw conflict("Solo se compensan pagos validados");
      const [used] = await tx
        .select({
          total: sql<number>`COALESCE(sum(${financialAdjustments.amountCents}),0)::bigint`,
        })
        .from(financialAdjustments)
        .where(
          and(
            eq(financialAdjustments.organizationId, actor.organizationId),
            eq(financialAdjustments.paymentId, paymentId),
          ),
        );
      if (Number(used?.total ?? 0) + input.amountCents > payment.amountCents)
        throw conflict("La compensación supera el importe disponible del pago");
      // Same lock used by cash.close: insertion cannot race past a committed closure.
      const [shift] = await tx
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.organizationId, actor.organizationId),
            eq(cashSessions.state, "open"),
          ),
        )
        .orderBy(cashSessions.openedAt)
        .for("update")
        .limit(1);
      if (!shift || shift.state !== "open")
        throw conflict("Abre un turno de caja antes de compensar");
      const [row] = await tx
        .insert(financialAdjustments)
        .values({
          organizationId: actor.organizationId,
          paymentId,
          sessionId: shift.id,
          actorId: actor.accountId,
          idempotencyKey: input.idempotencyKey,
          kind: input.kind,
          amountCents: input.amountCents,
          reason: input.reason,
          method: payment.method,
        })
        .returning();
      if (!row) throw conflict("No se pudo registrar la compensación");
      await new AuditService(this.db).record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "payment.compensate",
          entity: "financial_adjustment",
          entityId: row.id,
          metadata: {
            paymentId,
            sessionId: shift.id,
            kind: input.kind,
            amountCents: input.amountCents,
            reason: input.reason,
            idempotencyKey: input.idempotencyKey,
          },
        },
        tx,
      );
      return row;
    });
  }
}
