/**
 * Plans service (spec 003).
 *
 * Tenant isolation is the service's own responsibility: every read and write
 * filters by organizationId (REQ-1, TX-07). Plan ids from another tenant
 * behave as not-found (no enumeration).
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "@gym/db";
import { plans } from "@gym/db";
import { notFound } from "../errors.js";
import { CreatePlanRequest } from "@gym/contracts";

export class PlansService {
  constructor(private readonly db: Database) {}

  /** Lists the organization's plans (newest first). */
  async list(organizationId: string) {
    return this.db
      .select()
      .from(plans)
      .where(eq(plans.organizationId, organizationId))
      .orderBy(plans.createdAt);
  }

  /** Fetches one plan of the caller's organization. */
  async getById(organizationId: string, planId: string) {
    const rows = await this.db
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.organizationId, organizationId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound("Plan no encontrado");
    return row;
  }

  /** Creates a plan in the caller's organization. */
  async create(organizationId: string, input: CreatePlanRequest) {
    input = CreatePlanRequest.parse(input);
    const [row] = await this.db
      .insert(plans)
      .values({
        organizationId,
        name: input.name,
        priceCents: input.priceCents,
        durationDays: input.durationDays,
        coverage: input.coverage,
        grupalCredits: input.classCredits?.grupal ?? null,
        fijaCredits: input.classCredits?.fija ?? null,
        citaCredits: input.classCredits?.cita ?? null,
      })
      .returning();
    if (!row) throw notFound("Plan no encontrado");
    return row;
  }
}
