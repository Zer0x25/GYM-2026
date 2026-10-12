/**
 * Audit service (spec 003, REQ-3).
 *
 * Every financial mutation writes ONE audit row in the SAME transaction as
 * the mutation itself. If the mutation rolls back, the audit row rolls back
 * with it — the log can never claim an action that did not happen, and can
 * never miss one that did.
 *
 * The log is append-only: there is deliberately no update/delete API.
 */
import { eq, and } from "drizzle-orm";
import type { Database } from "@gym/db";
import { auditLog } from "@gym/db";

export interface AuditInput {
  organizationId: string;
  actorId: string;
  actorRole: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown> | undefined;
}

/** A DB handle that participates in the caller's transaction. */
export type DbOrTx = Pick<Database, "insert">;

export class AuditService {
  constructor(private readonly db: Database) {}

  /**
   * Writes an audit row. Pass the transaction handle (tx) when the mutation
   * runs inside a transaction so the audit shares its fate.
   */
  async record(input: AuditInput, tx: DbOrTx = this.db): Promise<void> {
    await tx
      .insert(auditLog)
      .values({
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      })
      .returning({ id: auditLog.id });
  }

  /** Tenant-scoped read of the audit trail (newest first). */
  async list(organizationId: string, limit = 100) {
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, organizationId)))
      .orderBy(auditLog.createdAt)
      .limit(limit);
    return rows;
  }
}
