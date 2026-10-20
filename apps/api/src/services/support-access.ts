/**
 * Support Access Service (D-06, Spec 026).
 *
 * Implements temporary, explicit technical support access authorized by
 * an organization admin, with strict time-bounding, immediate revocation,
 * read-only/diagnostic summaries without sensitive data or passwords,
 * and immutable audit logging.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@gym/db";
import {
  organizations,
  members,
  plans,
  memberships,
  cashSessions,
  offlineEvents,
  auditLog,
  supportAccessGrants,
} from "@gym/db";
import { AppError } from "../errors.js";
import type {
  CreateSupportGrantRequest,
  SupportGrantRef,
  SupportDiagnosticSummary,
} from "@gym/contracts";

export interface SupportActor {
  organizationId: string;
  accountId: string;
  role: "admin" | "recepcion" | "instructor" | "socio";
}

function toGrantRef(row: typeof supportAccessGrants.$inferSelect): SupportGrantRef {
  return {
    id: row.id,
    organizationId: row.organizationId,
    grantedByAccountId: row.grantedByAccountId,
    supportEmail: row.supportEmail,
    reason: row.reason,
    scope: row.scope as "diagnostic" | "read_only",
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokedByAccountId: row.revokedByAccountId,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class SupportAccessService {
  constructor(private readonly db: Database) {}

  /**
   * Admin explicitly creates a temporary support access grant (15..1440 min).
   * Generates a single-use or time-bound ephemeral raw token returned ONLY once,
   * persisting only its SHA-256 hash.
   */
  async createGrant(
    actor: SupportActor,
    input: CreateSupportGrantRequest,
  ): Promise<{ grant: SupportGrantRef; token: string }> {
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "Solo admin puede otorgar acceso de soporte");
    }

    if (input.durationMinutes < 15 || input.durationMinutes > 1440) {
      throw new AppError(
        "VALIDATION_ERROR",
        "La duración debe estar entre 15 y 1440 minutos (máximo 24h)",
      );
    }

    // Generate random 32-byte raw token
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.durationMinutes * 60 * 1000);

    const [grantRow] = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(supportAccessGrants)
        .values({
          organizationId: actor.organizationId,
          grantedByAccountId: actor.accountId,
          supportEmail: input.supportEmail,
          reason: input.reason,
          scope: input.scope ?? "diagnostic",
          tokenHash,
          expiresAt,
          createdAt: now,
        })
        .returning();

      if (!inserted) {
        throw new AppError("INTERNAL_ERROR", "No se pudo registrar la concesión de soporte");
      }

      await tx.insert(auditLog).values({
        organizationId: actor.organizationId,
        actorId: actor.accountId,
        actorRole: "admin",
        action: "support.grant.create",
        entity: "support_grant",
        entityId: inserted.id,
        metadata: JSON.stringify({
          supportEmail: input.supportEmail,
          reason: input.reason,
          durationMinutes: input.durationMinutes,
          scope: input.scope ?? "diagnostic",
          expiresAt: expiresAt.toISOString(),
        }),
        createdAt: now,
      });

      return [inserted];
    });

    return {
      grant: toGrantRef(grantRow!),
      token: rawToken,
    };
  }

  /**
   * Admin lists all support grants for the organization.
   */
  async listGrants(actor: SupportActor): Promise<SupportGrantRef[]> {
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "Solo admin puede listar accesos de soporte");
    }

    const rows = await this.db
      .select()
      .from(supportAccessGrants)
      .where(eq(supportAccessGrants.organizationId, actor.organizationId))
      .orderBy(desc(supportAccessGrants.createdAt));

    return rows.map(toGrantRef);
  }

  /**
   * Admin immediately revokes a support grant in their organization.
   * Cross-tenant attempts respond with 404 NOT_FOUND (REQ-1 anti-enumeration).
   */
  async revokeGrant(
    actor: SupportActor,
    grantId: string,
  ): Promise<{ success: true; grant: SupportGrantRef }> {
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "Solo admin puede revocar accesos de soporte");
    }

    const now = new Date();

    const [updated] = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(supportAccessGrants)
        .where(
          and(
            eq(supportAccessGrants.id, grantId),
            eq(supportAccessGrants.organizationId, actor.organizationId),
          ),
        );

      if (!existing) {
        throw new AppError("NOT_FOUND", "Concesión de soporte no encontrada");
      }

      const [revoked] = await tx
        .update(supportAccessGrants)
        .set({
          revokedAt: existing.revokedAt ?? now,
          revokedByAccountId: existing.revokedByAccountId ?? actor.accountId,
        })
        .where(eq(supportAccessGrants.id, grantId))
        .returning();

      await tx.insert(auditLog).values({
        organizationId: actor.organizationId,
        actorId: actor.accountId,
        actorRole: "admin",
        action: "support.grant.revoke",
        entity: "support_grant",
        entityId: grantId,
        metadata: JSON.stringify({
          supportEmail: existing.supportEmail,
          revokedAt: now.toISOString(),
        }),
        createdAt: now,
      });

      return [revoked];
    });

    return {
      success: true,
      grant: toGrantRef(updated!),
    };
  }

  /**
   * Support diagnostic summary query with x-support-grant-token.
   * Rejects missing, invalid, expired or revoked tokens with 401 UNAUTHENTICATED.
   * Updates lastUsedAt and writes support.diagnostic.read to audit_log in the same transaction.
   * Returns aggregated non-sensitive operational metadata.
   */
  async getDiagnosticSummary(token: string | undefined): Promise<SupportDiagnosticSummary> {
    if (!token || typeof token !== "string" || token.trim().length === 0) {
      throw new AppError("UNAUTHENTICATED", "Cabecera x-support-grant-token requerida");
    }

    const tokenHash = createHash("sha256").update(token.trim()).digest("hex");
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      const [grant] = await tx
        .select()
        .from(supportAccessGrants)
        .where(eq(supportAccessGrants.tokenHash, tokenHash));

      if (!grant) {
        throw new AppError("UNAUTHENTICATED", "Token de soporte inválido o no reconocido");
      }

      if (grant.revokedAt !== null) {
        throw new AppError("UNAUTHENTICATED", "Concesión de soporte revocada");
      }

      if (new Date(grant.expiresAt).getTime() <= now.getTime()) {
        throw new AppError("UNAUTHENTICATED", "Concesión de soporte expirada");
      }

      // Mark lastUsedAt
      await tx
        .update(supportAccessGrants)
        .set({ lastUsedAt: now })
        .where(eq(supportAccessGrants.id, grant.id));

      // Audit read
      await tx.insert(auditLog).values({
        organizationId: grant.organizationId,
        actorId: grant.grantedByAccountId,
        actorRole: "support",
        action: "support.diagnostic.read",
        entity: "support_grant",
        entityId: grant.id,
        metadata: JSON.stringify({
          supportEmail: grant.supportEmail,
          grantId: grant.id,
          scope: grant.scope,
        }),
        createdAt: now,
      });

      // Fetch organization
      const [org] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, grant.organizationId));

      if (!org) {
        throw new AppError("NOT_FOUND", "Organización asociada a la concesión no encontrada");
      }

      // Counts
      const [memberCountRes] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(members)
        .where(eq(members.organizationId, grant.organizationId));

      const [activePlanCountRes] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(plans)
        .where(
          and(eq(plans.organizationId, grant.organizationId), eq(plans.active, true)),
        );

      const [membershipCountRes] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .where(eq(memberships.organizationId, grant.organizationId));

      const [outboxCountRes] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(offlineEvents)
        .where(eq(offlineEvents.organizationId, grant.organizationId));

      // Cash session
      const [openCash] = await tx
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.organizationId, grant.organizationId),
            eq(cashSessions.state, "open"),
          ),
        )
        .limit(1);

      return {
        organization: {
          id: org.id,
          name: org.name,
        },
        counts: {
          members: memberCountRes?.count ?? 0,
          activePlans: activePlanCountRes?.count ?? 0,
          memberships: membershipCountRes?.count ?? 0,
          outboxEvents: outboxCountRes?.count ?? 0,
        },
        cashSession: openCash
          ? {
              id: openCash.id,
              state: openCash.state,
              openedAt: openCash.openedAt.toISOString(),
            }
          : null,
        offlinePolicy: {
          enabled: org.offlineEnabled,
          freshnessHours: org.offlineFreshnessHours,
        },
        timestamp: now.toISOString(),
        grant: {
          id: grant.id,
          supportEmail: grant.supportEmail,
          scope: grant.scope as "diagnostic" | "read_only",
          expiresAt: grant.expiresAt.toISOString(),
        },
      };
    });
  }
}
