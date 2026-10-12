/**
 * Memberships service (spec 003).
 *
 * Assigns a plan to a member (membresía). The membership starts WITHOUT a
 * validity window (pending_payment); the window is set by the FIRST
 * validated payment (PaymentsService.validate) — never at assignment.
 * Tenant-scoped like every other service (REQ-1, TX-07).
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "@gym/db";
import { members, memberships, plans } from "@gym/db";
import { notFound } from "../errors.js";

export class MembershipsService {
  constructor(private readonly db: Database) {}

  /**
   * Creates a membership (socio inscripto en un plan) with NO validity
   * window yet: state is pending_payment until a payment is validated.
   */
  async assign(organizationId: string, memberId: string, planId: string) {
    const member = await this.findMember(organizationId, memberId);
    if (!member) throw notFound("Socio no encontrado");
    const plan = await this.findPlan(organizationId, planId);
    if (!plan) throw notFound("Plan no encontrado");

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
