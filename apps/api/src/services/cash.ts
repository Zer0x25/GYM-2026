/**
 * Cash service (spec 003, REQ-3) — turnos de caja y conciliación.
 *
 * Invariants:
 *  1. A session is opened with a declared opening amount; only ONE session
 *     can be open per organization at a time.
 *  2. Movements are created ONLY by payment validation (PaymentsService) —
 *     this service never creates income directly.
 *  3. Closing is IDEMPOTENT under concurrency (TX-05): the UPDATE carries
 *     `WHERE state = 'open'` inside a transaction, so two simultaneous
 *     closes of the same session yield exactly one 200 and one 409.
 *  4. expectedClosing = opening + Σ validated movements of the session;
 *     the discrepancy (declared − expected) is recorded, never blocking.
 *  5. Movements are immutable: no update/delete API exists here.
 *  6. Daily consolidation aggregates validated movements by method.
 *
 * All reads/writes filter by organizationId (REQ-1, TX-07).
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@gym/db";
import { cashMovements, cashSessions } from "@gym/db";
import { conflict, forbidden, notFound } from "../errors.js";
import { AuditService } from "./audit.js";

export interface CashActor {
  organizationId: string;
  accountId: string;
  role: "admin" | "recepcion" | "instructor" | "socio";
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class CashService {
  private readonly audit: AuditService;

  constructor(private readonly db: Database) {
    this.audit = new AuditService(db);
  }

  /** Opens a cash session (turno). Rejects if the org already has one open. */
  async open(actor: CashActor, openingCents: number) {
    const existing = await this.findOpenSession(actor.organizationId);
    if (existing) throw conflict("Ya hay un turno de caja abierto");

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(cashSessions)
        .values({
          organizationId: actor.organizationId,
          openedBy: actor.accountId,
          state: "open",
          openingCents,
        })
        .returning();
      if (!row) throw notFound("Turno no encontrado");

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "cash.open",
          entity: "cash_session",
          entityId: row.id,
          metadata: { openingCents },
        },
        tx,
      );

      return row;
    });
  }

  /**
   * Closes the session (TX-05). The `WHERE state = 'open'` inside the
   * transaction is the idempotency guard: under two simultaneous closes,
   * one UPDATE matches a row and the other matches none → 409.
   */
  async close(actor: CashActor, sessionId: string, declaredClosingCents: number) {
    const session = await this.getById(actor.organizationId, sessionId);
    if (session.state === "closed") throw conflict("El turno ya está cerrado");

    return this.db.transaction(async (tx) => {
      // Lock the row for the duration of the transaction so two concurrent
      // closes serialize; the second then fails the state guard.
      const locked = await tx
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.id, sessionId),
            eq(cashSessions.organizationId, actor.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!locked[0]) throw notFound("Turno no encontrado");
      if (locked[0].state === "closed") throw conflict("El turno ya está cerrado");

      const expectedClosingCents =
        locked[0].openingCents + (await this.movementsTotal(locked[0].id, tx));
      const discrepancyCents = declaredClosingCents - expectedClosingCents;

      const [closed] = await tx
        .update(cashSessions)
        .set({
          state: "closed",
          closedBy: actor.accountId,
          closedAt: new Date(),
          declaredClosingCents,
          expectedClosingCents,
          discrepancyCents,
        })
        .where(and(eq(cashSessions.id, sessionId), eq(cashSessions.state, "open")))
        .returning();
      if (!closed) throw conflict("El turno cambió de estado durante el cierre");

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "cash.close",
          entity: "cash_session",
          entityId: sessionId,
          metadata: {
            declaredClosingCents,
            expectedClosingCents,
            discrepancyCents,
          },
        },
        tx,
      );

      return closed;
    });
  }

  /** Current open session of the organization (badge de topbar). */
  async findOpenSession(organizationId: string) {
    const rows = await this.db
      .select()
      .from(cashSessions)
      .where(and(eq(cashSessions.organizationId, organizationId), eq(cashSessions.state, "open")))
      .limit(1);
    return rows[0];
  }

  async getById(organizationId: string, sessionId: string) {
    const rows = await this.db
      .select()
      .from(cashSessions)
      .where(and(eq(cashSessions.id, sessionId), eq(cashSessions.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Turno no encontrado");
    return row;
  }

  /** Immutable movement feed of a session (newest first). */
  async movements(organizationId: string, sessionId: string) {
    const session = await this.getById(organizationId, sessionId);
    return this.db
      .select()
      .from(cashMovements)
      .where(
        and(
          eq(cashMovements.organizationId, organizationId),
          eq(cashMovements.sessionId, session.id),
        ),
      )
      .orderBy(cashMovements.createdAt);
  }

  /**
   * Daily consolidation: validated movements of the day, by method.
   * Reads across all sessions of the organization for the given day.
   */
  async consolidateDay(organizationId: string, day: Date) {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);

    const rows = await this.db
      .select({
        method: cashMovements.method,
        total: sql<number>`COALESCE(SUM(${cashMovements.amountCents}), 0)::int`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(cashMovements)
      .where(
        and(
          eq(cashMovements.organizationId, organizationId),
          gte(sql`${cashMovements.createdAt}`, start.toISOString()),
          sql`${cashMovements.createdAt} <= ${end.toISOString()}`,
        ),
      )
      .groupBy(cashMovements.method);

    const byMethod = { cash: 0, transfer: 0, transbank: 0 };
    let movementCount = 0;
    for (const r of rows) {
      byMethod[r.method] += Number(r.total);
      movementCount += Number(r.count);
    }
    const totalCents = byMethod.cash + byMethod.transfer + byMethod.transbank;

    const session = await this.findOpenSession(organizationId);
    return {
      sessionId: session?.id ?? "",
      date: day.toISOString().slice(0, 10),
      openingCents: session?.openingCents ?? 0,
      totalCents,
      byMethod,
      movementCount,
    };
  }

  /** Σ amounts of a session's movements (used at close time). */
  private async movementsTotal(sessionId: string, tx?: Tx): Promise<number> {
    const db = tx ?? this.db;
    const rows = await db
      .select({ total: sql<number>`COALESCE(SUM(${cashMovements.amountCents}), 0)::int` })
      .from(cashMovements)
      .where(eq(cashMovements.sessionId, sessionId));
    return Number(rows[0]?.total ?? 0);
  }
}

export { forbidden };
