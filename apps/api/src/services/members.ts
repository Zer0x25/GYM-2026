/**
 * Members domain service (spec 002).
 *
 * Tenant isolation is the service's own responsibility: every read and write
 * filters by organizationId (REQ-1, TX-07). A socio addressing another member
 * of the same organization is still rejected (REQ-7) — same-tenant is not
 * permission. Member ids are opaque; not-found is returned for both
 * "does not exist" and "exists in another tenant" to avoid enumeration.
 */
import { and, eq, ilike, or, sql, isNull } from "drizzle-orm";
import type { Database } from "@gym/db";
import { members, contactVerifications } from "@gym/db";
import { generateQrToken } from "./provisioning.js";
import { forbidden, notFound, conflict, validationError } from "../errors.js";
import { AuditService } from "./audit.js";
import type { Role } from "@gym/contracts";

const publicFields = {
  id: members.id,
  organizationId: members.organizationId,
  fullName: members.fullName,
  contactEmail: members.contactEmail,
  adultResponsibleId: members.adultResponsibleId,
  createdAt: members.createdAt,
};

export interface MemberRow {
  id: string;
  organizationId: string;
  fullName: string;
  contactEmail: string | null;
  adultResponsibleId: string | null;
  isMinor: boolean;
  createdAt: Date;
}

export interface CreateMemberInput {
  fullName: string;
  contactEmail?: string | null | undefined;
  isMinor?: boolean | undefined;
  adultResponsibleId?: string | null | undefined;
}

export interface UpdateMemberInput {
  fullName?: string | undefined;
  contactEmail?: string | null | undefined;
  isMinor?: boolean | undefined;
  adultResponsibleId?: string | null | undefined;
}

export interface MemberActor {
  organizationId: string;
  role: Role;
  memberId?: string | undefined;
  accountId?: string | undefined;
}

function toMemberRow(row: {
  id: string;
  organizationId: string;
  fullName: string;
  contactEmail: string | null;
  adultResponsibleId: string | null;
  createdAt: Date;
}): MemberRow {
  return {
    ...row,
    isMinor: row.adultResponsibleId !== null,
  };
}

function isMinorRegistrationAllowed(): boolean {
  const raw = process.env.ALLOW_MINOR_MEMBERS?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  return true;
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
    return rows.map(toMemberRow);
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
    if (
      (input.isMinor === true ||
        (input.adultResponsibleId !== undefined && input.adultResponsibleId !== null)) &&
      !isMinorRegistrationAllowed()
    ) {
      throw conflict("MINOR_REGISTRATION_DISABLED");
    }
    if (input.isMinor && !input.adultResponsibleId) {
      throw validationError({ message: "adultResponsibleId es obligatorio para un menor" });
    }
    if (input.adultResponsibleId) {
      const [guardian] = await this.db
        .select({ id: members.id, adultResponsibleId: members.adultResponsibleId })
        .from(members)
        .where(
          and(
            eq(members.id, input.adultResponsibleId),
            eq(members.organizationId, actor.organizationId),
          ),
        );
      if (!guardian) {
        throw notFound("Adulto responsable no encontrado");
      }
      if (guardian.adultResponsibleId !== null) {
        throw conflict("INVALID_ADULT_RESPONSIBLE");
      }
    }

    const [row] = await this.db
      .insert(members)
      .values({
        organizationId: actor.organizationId,
        fullName: input.fullName,
        qrToken: generateQrToken(),
        contactEmail: input.contactEmail ?? null,
        adultResponsibleId: input.adultResponsibleId ?? null,
      })
      .returning(publicFields);
    if (!row) throw notFound("Socio no encontrado");
    return toMemberRow(row);
  }

  /**
   * Updates a member (admin/recepcion or socio self-management).
   */
  async update(
    actor: MemberActor,
    memberId: string,
    input: UpdateMemberInput,
  ): Promise<MemberRow> {
    if (actor.role === "socio" && actor.memberId !== memberId) {
      throw forbidden("Un socio solo puede editar su propio contacto");
    }
    const existing = await this.findOwn(actor, memberId);
    if (!existing) throw notFound("Socio no encontrado");

    if (actor.role === "socio") {
      if (existing.adultResponsibleId !== null) {
        throw forbidden("MINOR_CONTACT_MANAGED_BY_GUARDIAN");
      }
      if (
        input.fullName !== undefined ||
        input.isMinor !== undefined ||
        input.adultResponsibleId !== undefined
      ) {
        throw forbidden("Un socio solo puede gestionar su propio contacto");
      }
      if (input.contactEmail !== undefined) {
        return this.updateContact(actor, memberId, input.contactEmail);
      }
      return existing;
    }

    if (input.adultResponsibleId === memberId) {
      throw validationError({ message: "Un socio no puede ser su propio adulto responsable" });
    }
    const isBecomingMinor =
      input.isMinor === true ||
      (input.adultResponsibleId !== undefined && input.adultResponsibleId !== null);

    if (isBecomingMinor && !isMinorRegistrationAllowed()) {
      throw conflict("MINOR_REGISTRATION_DISABLED");
    }

    if (
      input.isMinor === true &&
      input.adultResponsibleId === undefined &&
      !existing.adultResponsibleId
    ) {
      throw validationError({ message: "adultResponsibleId es obligatorio para un menor" });
    }

    if (input.adultResponsibleId !== undefined && input.adultResponsibleId !== null) {
      const [guardian] = await this.db
        .select({ id: members.id, adultResponsibleId: members.adultResponsibleId })
        .from(members)
        .where(
          and(
            eq(members.id, input.adultResponsibleId),
            eq(members.organizationId, actor.organizationId),
          ),
        );
      if (!guardian) throw notFound("Adulto responsable no encontrado");
      if (guardian.adultResponsibleId !== null) throw conflict("INVALID_ADULT_RESPONSIBLE");
    }

    if (isBecomingMinor) {
      const minors = await this.db
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.adultResponsibleId, memberId),
            eq(members.organizationId, actor.organizationId),
          ),
        )
        .limit(1);
      if (minors.length > 0) {
        throw conflict("Un adulto responsable de menores no puede ser marcado como menor");
      }
    }

    let targetAdultId = existing.adultResponsibleId;
    if (input.adultResponsibleId !== undefined) {
      targetAdultId = input.adultResponsibleId;
    } else if (input.isMinor === false) {
      targetAdultId = null;
    }

    return this.db.transaction(async (tx) => {
      const scope = and(eq(members.id, memberId), eq(members.organizationId, actor.organizationId));
      await tx.select({ id: members.id }).from(members).where(scope).for("update");
      const updates: {
        fullName?: string;
        contactEmail?: string | null;
        contactVerifiedAt?: Date | null;
        adultResponsibleId?: string | null;
      } = {};
      if (input.fullName !== undefined) updates.fullName = input.fullName;
      if (input.contactEmail !== undefined) {
        updates.contactEmail = input.contactEmail;
        updates.contactVerifiedAt = null;
      }
      if (targetAdultId !== existing.adultResponsibleId) {
        updates.adultResponsibleId = targetAdultId;
      }

      const [row] = await tx.update(members).set(updates).where(scope).returning(publicFields);
      if (input.contactEmail !== undefined) {
        await tx
          .update(contactVerifications)
          .set({ cancelledAt: new Date() })
          .where(
            and(
              eq(contactVerifications.memberId, memberId),
              eq(contactVerifications.organizationId, actor.organizationId),
              isNull(contactVerifications.consumedAt),
              isNull(contactVerifications.cancelledAt),
            ),
          );
      }
      if (actor.accountId) {
        await new AuditService(this.db).record(
          {
            organizationId: actor.organizationId,
            actorId: actor.accountId,
            actorRole: actor.role,
            action: "member.update",
            entity: "member",
            entityId: memberId,
            metadata: { ...input },
          },
          tx,
        );
      }
      if (!row) throw notFound("Socio no encontrado");
      return toMemberRow(row);
    });
  }

  /**
   * Staff may replace contacts inside their tenant, clearing proof of possession.
   * A socio may remove their own contact; assigning an address goes through
   * ContactVerificationService (SPEC015). fullName stays protected.
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
    if (actor.role === "socio" && existing.adultResponsibleId !== null) {
      throw forbidden("MINOR_CONTACT_MANAGED_BY_GUARDIAN");
    }
    if (actor.role === "socio" && contactEmail !== null) {
      throw conflict("Debes verificar el nuevo correo antes de cambiar tu contacto.");
    }
    return this.db.transaction(async (tx) => {
      const scope = and(eq(members.id, memberId), eq(members.organizationId, actor.organizationId));
      await tx.select({ id: members.id }).from(members).where(scope).for("update");
      const [row] = await tx
        .update(members)
        .set({ contactEmail, contactVerifiedAt: null })
        .where(scope)
        .returning(publicFields);
      await tx
        .update(contactVerifications)
        .set({ cancelledAt: new Date() })
        .where(
          and(
            eq(contactVerifications.memberId, memberId),
            eq(contactVerifications.organizationId, actor.organizationId),
            isNull(contactVerifications.consumedAt),
            isNull(contactVerifications.cancelledAt),
          ),
        );
      if (actor.role !== "socio" && actor.accountId) {
        await new AuditService(this.db).record(
          {
            organizationId: actor.organizationId,
            actorId: actor.accountId,
            actorRole: actor.role,
            action: "member.contact_update",
            entity: "member",
            entityId: memberId,
            metadata: { previousEmail: existing.contactEmail, newEmail: contactEmail },
          },
          tx,
        );
      }
      if (!row) throw notFound("Socio no encontrado");
      return toMemberRow(row);
    });
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
    return rows[0] ? toMemberRow(rows[0]) : undefined;
  }
}
