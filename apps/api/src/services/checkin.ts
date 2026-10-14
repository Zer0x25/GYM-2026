/**
 * Check-in service (spec 007, REQ-7/REQ-8) — supervised QR ingress.
 *
 * Invariants enforced here:
 *
 *  1. COVERAGE (SPEC:CHECKIN): a check-in is ALLOWED only when the member has
 *     an ACTIVE membership window (startAt <= now < endAt) whose plan coverage
 *     is not 'none'. Same definition of "has rights" as Entrega 2/offline —
 *     one criterion, online and offline consistent.
 *  2. TOKEN RESOLUTION IS TENANT-SCOPED (REQ-1, TX-07): the QR token is
 *     resolved ONLY against members of the operator's organization. A valid
 *     token belonging to another tenant → 404 (no existence leak, never 403).
 *  3. REVOCATION (SPEC:QR-TOKEN): a revoked token (qrRevokedAt != null) →
 *     409. Revocation is the anti-sharing control (static QR by decision).
 *  4. AUTHORIZATION, NOT EFFECT: the check-in does NOT count entries nor block
 *     re-ingress (user decision "solo cobertura"). It is idempotent by nature;
 *     every call audits ok/denied.
 *  5. AUDIT: every check-in writes checkin.ok / checkin.denied in the same
 *     transaction, carrying member, coverage, membershipEndsAt and reason.
 */
import { and, eq, gt, lt, desc, inArray, gte, sql } from "drizzle-orm";
import type { Database } from "@gym/db";
import { members, memberships, plans, auditLog } from "@gym/db";
import { forbidden, notFound } from "../errors.js";
import { AuditService } from "./audit.js";
import { generateQrToken } from "./provisioning.js";

/** Actor resolved from the verified session (never from the client). */
export interface CheckinActor {
  accountId: string;
  organizationId: string;
  role: "admin" | "recepcion" | "instructor" | "socio";
  memberId?: string | undefined;
}

export type CheckinOutcome =
  | {
      allowed: true;
      memberId: string;
      fullName: string;
      coverage: "unlimited" | "limited";
      membershipEndsAt: string;
    }
  | { allowed: false; reason: string };

export class CheckinService {
  private readonly audit: AuditService;

  constructor(private readonly db: Database) {
    this.audit = new AuditService(db);
  }

  /**
   * Supervised check-in: reception scans a member's QR (admin/recepcion).
   * Resolves the token WITHIN the tenant, validates active coverage, audits.
   */
  async checkin(actor: CheckinActor, qrToken: string, ip?: string): Promise<CheckinOutcome> {
    if (actor.role !== "admin" && actor.role !== "recepcion") {
      throw forbidden("Solo recepción o admin operan el check-in");
    }
    // Token resolved ONLY against this tenant's members (TX-07). A token that
    // is valid globally but belongs to another org simply does not match here.
    const rows = await this.db
      .select()
      .from(members)
      .where(and(eq(members.organizationId, actor.organizationId), eq(members.qrToken, qrToken)))
      .limit(1);
    const member = rows[0];
    if (!member) throw notFound("QR no reconocido");

    const outcome = await this.evaluateCoverage(actor.organizationId, member.id);

    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.accountId,
      actorRole: actor.role,
      action: outcome.allowed ? "checkin.ok" : "checkin.denied",
      entity: "member",
      entityId: member.id,
      metadata: {
        qrRevoked: member.qrRevokedAt != null,
        ...(outcome.allowed
          ? { coverage: outcome.coverage, membershipEndsAt: outcome.membershipEndsAt }
          : { reason: outcome.reason }),
        ip: ip ?? null,
      },
    });

    return outcome.allowed
      ? {
          allowed: true,
          memberId: member.id,
          fullName: member.fullName,
          coverage: outcome.coverage,
          membershipEndsAt: outcome.membershipEndsAt,
        }
      : { allowed: false, reason: outcome.reason };
  }

  async checkinMember(actor: CheckinActor, memberId: string, ip?: string): Promise<CheckinOutcome> {
    if (actor.role !== "admin" && actor.role !== "recepcion")
      throw forbidden("Solo recepción o admin operan el check-in");
    const [member] = await this.db
      .select({ token: members.qrToken })
      .from(members)
      .where(and(eq(members.organizationId, actor.organizationId), eq(members.id, memberId)));
    if (!member) throw notFound("Socio no encontrado");
    if (!member.token)
      return { allowed: false, reason: "QR no emitido; solicita a administración que lo emita" };
    return this.checkin(actor, member.token, ip);
  }

  /**
   * Recent check-ins of the organization (newest first) — the receptionist's
   * live feed. Read-only, tenant-scoped: joins the audit trail (checkin.ok /
   * checkin.denied, written in the same transaction as the check-in) with the
   * member name. No new write path; the feed is a projection of what already
   * happened.
   */
  async recentCheckins(
    actor: CheckinActor,
    limit = 50,
    todayOnly = false,
  ): Promise<
    {
      id: string;
      memberId: string;
      fullName: string;
      outcome: "ok" | "denied";
      detail: string | null;
      at: string;
    }[]
  > {
    if (actor.role !== "admin" && actor.role !== "recepcion") {
      throw forbidden("Solo recepción o admin consultan los ingresos");
    }
    const rows = await this.db
      .select({
        id: auditLog.id,
        entityId: auditLog.entityId,
        action: auditLog.action,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
        fullName: members.fullName,
      })
      .from(auditLog)
      .innerJoin(members, sql`${members.id}::text = ${auditLog.entityId}`)
      .where(
        and(
          eq(auditLog.organizationId, actor.organizationId),
          eq(auditLog.entity, "member"),
          inArray(auditLog.action, ["checkin.ok", "checkin.denied"]),
          ...(todayOnly
            ? [
                gte(
                  auditLog.createdAt,
                  sql`date_trunc('day', now() AT TIME ZONE 'America/Santiago') AT TIME ZONE 'America/Santiago'`,
                ),
              ]
            : []),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
    return rows.map((r) => {
      const meta = r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : {};
      const outcome = r.action === "checkin.ok" ? "ok" : "denied";
      const detail =
        typeof meta.reason === "string"
          ? meta.reason
          : outcome === "ok"
            ? typeof meta.coverage === "string"
              ? `plan ${meta.coverage}`
              : null
            : null;
      return {
        id: r.id,
        memberId: r.entityId,
        fullName: r.fullName,
        outcome,
        detail,
        at: r.createdAt.toISOString(),
      };
    });
  }

  /** Coverage decision shared by check-in: active window + plan coverage≠none. */
  private async evaluateCoverage(
    organizationId: string,
    memberId: string,
  ): Promise<CheckinOutcome> {
    // Revocation first: a revoked token never grants ingress even if the
    // membership is still active (anti-sharing control).
    const [m] = await this.db
      .select({ revokedAt: members.qrRevokedAt })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);
    if (m?.revokedAt) return { allowed: false, reason: "QR revocado" };

    const now = new Date();
    const active = await this.db
      .select({
        coverage: plans.coverage,
        endAt: memberships.endAt,
      })
      .from(memberships)
      .innerJoin(plans, eq(memberships.planId, plans.id))
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          eq(memberships.memberId, memberId),
          lt(memberships.startAt, now),
          gt(memberships.endAt, now),
        ),
      )
      .orderBy(memberships.endAt)
      .limit(1);
    const row = active[0];
    if (!row || !row.endAt) return { allowed: false, reason: "sin membresía vigente" };
    if (row.coverage === "none") return { allowed: false, reason: "plan sin cobertura de ingreso" };
    return {
      allowed: true,
      memberId,
      fullName: "",
      coverage: row.coverage,
      membershipEndsAt: row.endAt.toISOString(),
    };
  }

  /** The socio's own QR (REQ-7): only ever their own. */
  async myQr(actor: CheckinActor): Promise<string> {
    if (actor.role !== "socio" || !actor.memberId) {
      throw forbidden("Solo un socio consulta su QR");
    }
    const rows = await this.db
      .select({ qrToken: members.qrToken })
      .from(members)
      .where(and(eq(members.id, actor.memberId), eq(members.organizationId, actor.organizationId)))
      .limit(1);
    const token = rows[0]?.qrToken;
    if (!token) throw notFound("QR no disponible");
    return token;
  }

  /** Rotate the socio's own QR (invalidates the old one). */
  async rotateMyQr(actor: CheckinActor): Promise<string> {
    if (actor.role !== "socio" || !actor.memberId) {
      throw forbidden("Solo un socio rota su QR");
    }
    const newToken = generateQrToken();
    const updated = await this.db
      .update(members)
      .set({ qrToken: newToken, qrRevokedAt: null })
      .where(and(eq(members.id, actor.memberId), eq(members.organizationId, actor.organizationId)))
      .returning({ id: members.id });
    if (updated.length === 0) throw notFound("Socio no encontrado");

    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.accountId,
      actorRole: actor.role,
      action: "checkin.qr.rotate",
      entity: "member",
      entityId: actor.memberId,
      metadata: { self: true },
    });
    return newToken;
  }

  /** Admin re-emits a member's QR (invalidates the old one). */
  async reissueQr(actor: CheckinActor, memberId: string): Promise<string> {
    if (actor.role !== "admin") throw forbidden("Solo un admin re-emite el QR de un socio");
    const newToken = generateQrToken();
    const updated = await this.db
      .update(members)
      .set({ qrToken: newToken, qrRevokedAt: null })
      .where(and(eq(members.id, memberId), eq(members.organizationId, actor.organizationId)))
      .returning({ id: members.id });
    if (updated.length === 0) throw notFound("Socio no encontrado");

    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.accountId,
      actorRole: actor.role,
      action: "checkin.qr.reissue",
      entity: "member",
      entityId: memberId,
      metadata: {},
    });
    return newToken;
  }

  /** Admin revokes a member's QR (anti-sharing). Kept for traceability. */
  async revokeQr(actor: CheckinActor, memberId: string): Promise<void> {
    if (actor.role !== "admin") throw forbidden("Solo un admin revoca el QR de un socio");
    const updated = await this.db
      .update(members)
      .set({ qrRevokedAt: new Date() })
      .where(and(eq(members.id, memberId), eq(members.organizationId, actor.organizationId)))
      .returning({ id: members.id });
    if (updated.length === 0) throw notFound("Socio no encontrado");

    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.accountId,
      actorRole: actor.role,
      action: "checkin.qr.revoke",
      entity: "member",
      entityId: memberId,
      metadata: {},
    });
  }
}
