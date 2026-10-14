/**
 * Members domain service (spec 002).
 *
 * Tenant isolation is the service's own responsibility: every read and write
 * filters by organizationId (REQ-1, TX-07). A socio addressing another member
 * of the same organization is still rejected (REQ-7) — same-tenant is not
 * permission. Member ids are opaque; not-found is returned for both
 * "does not exist" and "exists in another tenant" to avoid enumeration.
 */
import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { Database } from "@gym/db";
import { members } from "@gym/db";
import { generateQrToken } from "./provisioning.js";
import { forbidden, notFound } from "../errors.js";
import type { Role } from "@gym/contracts";

const publicFields = {
  id: members.id,
  organizationId: members.organizationId,
  fullName: members.fullName,
  contactEmail: members.contactEmail,
  createdAt: members.createdAt,
};

export interface MemberRow {
  id: string;
  organizationId: string;
  fullName: string;
  contactEmail: string | null;
  createdAt: Date;
}

export interface CreateMemberInput {
  fullName: string;
  contactEmail?: string | null | undefined;
}

export interface MemberActor {
  organizationId: string;
  role: Role;
  memberId?: string | undefined;
}

export class MembersService {
  constructor(private readonly db: Database) {}

  /** Lists members of the caller's organization. Socio role may only list
   *  itself (delegated to `me`). Search matches name or contact email. */
  async list(actor: MemberActor, query?: string): Promise<MemberRow[]> {
    const conditions = [eq(members.organizationId, actor.organizationId)];
    if (query && query.trim().length > 0) {
      const q = `%${query.trim()}%`;
      conditions.push(or(ilike(members.fullName, q), ilike(members.contactEmail, q))!);
    }
    const rows = await this.db
      .select(publicFields)
      .from(members)
      .where(and(...conditions))
      .orderBy(members.fullName);
    return rows;
  }

  /** Fetches one member. Socio callers may only fetch themselves. */
  async getById(actor: MemberActor, memberId: string): Promise<MemberRow> {
    const row = await this.findOwn(actor, memberId);
    if (!row) throw notFound("Socio no encontrado");
    return row;
  }

  /** Returns the socio's own profile (portal «mi perfil»). */
  async me(actor: MemberActor): Promise<MemberRow> {
    if (!actor.memberId) throw forbidden("La sesión no está vinculada a un socio");
    const row = await this.findOwn(actor, actor.memberId);
    if (!row) throw notFound("Socio no encontrado");
    return row;
  }
  /** Creates a member inside the caller's organization. */
  async create(actor: MemberActor, input: CreateMemberInput): Promise<MemberRow> {
    const [row] = await this.db
      .insert(members)
      .values({
        organizationId: actor.organizationId,
        fullName: input.fullName,
        qrToken: generateQrToken(),
        contactEmail: input.contactEmail ?? null,
      })
      .returning(publicFields);
    if (!row) throw notFound("Socio no encontrado");
    return row;
  }

  /**
   * Updates the member's contact. A socio may update only their own contact
   * (D-04/B: autogestión limitada de contacto); staff may update any member
   * of their organization. fullName is NOT editable here (protected data).
   */
  async updateContact(
    actor: MemberActor,
    memberId: string,
    contactEmail: string | null,
  ): Promise<MemberRow> {
    if (actor.role === "socio" && actor.memberId !== memberId) {
      throw forbidden("Un socio solo puede editar su propio contacto");
    }
    const existing = await this.findOwn(actor, memberId);
    if (!existing) throw notFound("Socio no encontrado");
    const [row] = await this.db
      .update(members)
      .set({ contactEmail })
      .where(and(eq(members.id, memberId), eq(members.organizationId, actor.organizationId)))
      .returning(publicFields);
    if (!row) throw notFound("Socio no encontrado");
    return row;
  }

  /** Tenant-scoped lookup: never crosses organizations. */
  private async findOwn(actor: MemberActor, memberId: string): Promise<MemberRow | undefined> {
    const rows = await this.db
      .select(publicFields)
      .from(members)
      .where(
        and(
          eq(members.id, memberId),
          eq(members.organizationId, actor.organizationId),
          actor.memberId && actor.role === "socio" ? eq(members.id, actor.memberId) : sql`true`,
        ),
      )
      .limit(1);
    return rows[0];
  }
}
