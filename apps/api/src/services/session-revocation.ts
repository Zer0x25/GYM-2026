/**
 * Session revocation service (spec 006, REQ-11) — shared-machine logout.
 *
 * Invariants enforced here:
 *
 *  1. TENANT SCOPING (REQ-1, TX-07): a target account belongs to the admin's
 *     organization ONLY if it has an active staff_assignments row in that org
 *     OR its email matches a members.contact_email of that org. Otherwise the
 *     account is unreachable → 404 (never 403: no existence leak across
 *     tenants).
 *  2. ROLE SEPARATION: only an admin lists/revokes ANOTHER account's sessions.
 *     Any authenticated account may revoke its OWN other sessions.
 *  3. REVOCATION IS SERVER-SIDE: deleting the `session` row invalidates the
 *     token immediately; the next request with that cookie gets 401. There is
 *     no reliance on the client "logging out".
 *  4. AUDIT: every revoke writes its audit row in the same transaction,
 *     carrying actor, target account, org and IP.
 */
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Database } from "@gym/db";
import { authSessions, identityAccounts, members, staffAssignments } from "@gym/db";
import { forbidden, notFound } from "../errors.js";
import { AuditService } from "./audit.js";

/** Actor resolved from the verified session (never from the client). */
export interface RevocationActor {
  accountId: string;
  organizationId: string;
  role: "admin" | "recepcion" | "instructor" | "socio";
}

export interface SessionInfoRow {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class SessionRevocationService {
  private readonly audit: AuditService;

  constructor(private readonly db: Database) {
    this.audit = new AuditService(db);
  }

  /**
   * Confirms a target account belongs to the actor's organization.
   * Returns the account's email (needed for the socio path) or throws 404
   * when the account is unknown or belongs to another tenant (TX-07).
   */
  private async assertAccountInTenant(
    tx: Database | Tx,
    actor: RevocationActor,
    targetAccountId: string,
  ): Promise<void> {
    // Staff path: an active assignment in this org already proves belonging.
    const staff = await tx
      .select({ accountId: staffAssignments.accountId })
      .from(staffAssignments)
      .where(
        and(
          eq(staffAssignments.accountId, targetAccountId),
          eq(staffAssignments.organizationId, actor.organizationId),
          eq(staffAssignments.active, true),
        ),
      )
      .limit(1);
    if (staff[0]) return;

    // Socio path: the account's email must match a member of this org.
    const [acct] = await tx
      .select({ email: identityAccounts.email })
      .from(identityAccounts)
      .where(eq(identityAccounts.id, targetAccountId))
      .limit(1);
    if (acct) {
      const [member] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.contactEmail, acct.email),
            eq(members.organizationId, actor.organizationId),
          ),
        )
        .limit(1);
      if (member) return;
    }

    throw notFound("Cuenta no encontrada");
  }

  /** Active (non-expired) sessions of an account in the actor's tenant. */
  async listSessions(actor: RevocationActor, targetAccountId: string): Promise<SessionInfoRow[]> {
    if (actor.role !== "admin") {
      throw forbidden("Solo un administrador lista las sesiones de otras cuentas");
    }
    await this.assertAccountInTenant(this.db, actor, targetAccountId);
    const rows = await this.db
      .select({
        id: authSessions.id,
        createdAt: authSessions.createdAt,
        expiresAt: authSessions.expiresAt,
        ipAddress: authSessions.ipAddress,
        userAgent: authSessions.userAgent,
      })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, targetAccountId),
          gt(authSessions.expiresAt, new Date()),
        ),
      )
      .orderBy(authSessions.createdAt);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      ipAddress: r.ipAddress ?? null,
      userAgent: r.userAgent ?? null,
    }));
  }

  /** Revokes a single session of an account in the actor's tenant. */
  async revokeSession(
    actor: RevocationActor,
    targetAccountId: string,
    sessionId: string,
    ip?: string,
  ): Promise<void> {
    if (actor.role !== "admin") {
      throw forbidden("Solo un administrador revoca sesiones de otras cuentas");
    }
    await this.db.transaction(async (tx) => {
      await this.assertAccountInTenant(tx, actor, targetAccountId);
      const deleted = await tx
        .delete(authSessions)
        .where(and(eq(authSessions.id, sessionId), eq(authSessions.userId, targetAccountId)))
        .returning({ id: authSessions.id });
      if (deleted.length === 0) throw notFound("Sesión no encontrada");

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "session.revoke",
          entity: "session",
          entityId: sessionId,
          metadata: { targetAccountId, ip: ip ?? null },
        },
        tx,
      );
    });
  }

  /** Revokes ALL sessions of an account in the actor's tenant. Returns count. */
  async revokeAllSessions(
    actor: RevocationActor,
    targetAccountId: string,
    ip?: string,
  ): Promise<number> {
    if (actor.role !== "admin") {
      throw forbidden("Solo un administrador revoca sesiones de otras cuentas");
    }
    return this.db.transaction(async (tx) => {
      await this.assertAccountInTenant(tx, actor, targetAccountId);
      const deleted = await tx
        .delete(authSessions)
        .where(eq(authSessions.userId, targetAccountId))
        .returning({ id: authSessions.id });

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "session.revoke_all",
          entity: "session",
          entityId: targetAccountId,
          metadata: { targetAccountId, revoked: deleted.length, ip: ip ?? null },
        },
        tx,
      );
      return deleted.length;
    });
  }

  /**
   * Closes all of the CURRENT account's sessions except the one making the
   * request (currentSessionId). Any authenticated role. Never logs the actor
   * out of the device in use.
   */
  async revokeOthers(
    actor: RevocationActor,
    currentSessionId: string,
    ip?: string,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const mine = await tx
        .select({ id: authSessions.id })
        .from(authSessions)
        .where(eq(authSessions.userId, actor.accountId));
      const toDelete = mine.filter((s) => s.id !== currentSessionId).map((s) => s.id);
      if (toDelete.length > 0) {
        await tx.delete(authSessions).where(inArray(authSessions.id, toDelete));
      }

      await this.audit.record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "session.revoke_all",
          entity: "session",
          entityId: actor.accountId,
          metadata: { self: true, currentSessionId, revoked: toDelete.length, ip: ip ?? null },
        },
        tx,
      );
      return toDelete.length;
    });
  }
}
