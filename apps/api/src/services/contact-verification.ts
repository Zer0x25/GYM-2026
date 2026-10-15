import { randomBytes, createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { members, contactVerifications, type Database } from "@gym/db";
import { ConfirmContactVerification, RequestContactVerification } from "@gym/contracts";
import type { SessionContext } from "../session.js";
import { conflict, forbidden, notFound, serviceUnavailable } from "../errors.js";
import { accountLink, type EmailDelivery } from "../email-delivery.js";
import { AuditService } from "./audit.js";

export class ContactVerificationService {
  constructor(
    private db: Database,
    private delivery?: EmailDelivery,
    private origin = "http://localhost:3000",
  ) {}
  private scope(actor: SessionContext, id: string) {
    if (actor.role !== "socio") throw forbidden();
    if (actor.memberId !== id) throw notFound("Socio no encontrado");
    return and(
      eq(members.id, id),
      eq(members.organizationId, actor.organizationId),
      eq(members.accountId, actor.accountId),
    );
  }
  async request(actor: SessionContext, id: string, input: unknown) {
    const scope = this.scope(actor, id);
    const { email } = RequestContactVerification.parse(input);
    if (!this.delivery) throw serviceUnavailable();
    const token = randomBytes(32).toString("hex");
    // Construct from trusted configuration before any persistent mutation.
    const url = accountLink(this.origin, "/verificar-contacto", token);
    const challenge = await this.db.transaction(async (tx) => {
      const [member] = await tx.select().from(members).where(scope).for("update");
      if (!member) throw notFound("Socio no encontrado");
      await tx
        .update(contactVerifications)
        .set({ cancelledAt: new Date() })
        .where(
          and(
            eq(contactVerifications.memberId, id),
            eq(contactVerifications.organizationId, actor.organizationId),
            isNull(contactVerifications.consumedAt),
            isNull(contactVerifications.cancelledAt),
          ),
        );
      const [row] = await tx
        .insert(contactVerifications)
        .values({
          organizationId: actor.organizationId,
          memberId: id,
          accountId: actor.accountId,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          targetEmail: email,
          previousEmail: member.contactEmail,
          expiresAt: new Date(Date.now() + 15 * 60_000),
        })
        .returning();
      return row!;
    });
    try {
      await this.delivery({ to: email, purpose: "contact-verification", url });
    } catch {
      await this.db
        .update(contactVerifications)
        .set({ cancelledAt: new Date() })
        .where(eq(contactVerifications.id, challenge.id));
      throw serviceUnavailable();
    }
    return { pending: true };
  }
  async confirm(actor: SessionContext, id: string, input: unknown) {
    const scope = this.scope(actor, id);
    const { token } = ConfirmContactVerification.parse(input);
    return this.db.transaction(async (tx) => {
      // Same lock order as issuance and staff updates: member, then challenges.
      const [member] = await tx.select().from(members).where(scope).for("update");
      if (!member) throw notFound("Socio no encontrado");
      const [challenge] = await tx
        .select()
        .from(contactVerifications)
        .where(
          and(
            eq(contactVerifications.tokenHash, createHash("sha256").update(token).digest("hex")),
            eq(contactVerifications.memberId, id),
            eq(contactVerifications.organizationId, actor.organizationId),
            eq(contactVerifications.accountId, actor.accountId),
          ),
        )
        .for("update");
      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.cancelledAt ||
        challenge.expiresAt <= new Date() ||
        challenge.previousEmail !== member.contactEmail
      ) {
        throw conflict("Enlace inválido, vencido o ya utilizado. Solicita una nueva verificación.");
      }
      const now = new Date();
      await tx
        .update(members)
        .set({ contactEmail: challenge.targetEmail, contactVerifiedAt: now })
        .where(scope);
      await tx
        .update(contactVerifications)
        .set({ consumedAt: now })
        .where(eq(contactVerifications.id, challenge.id));
      await new AuditService(this.db).record(
        {
          organizationId: actor.organizationId,
          actorId: actor.accountId,
          actorRole: actor.role,
          action: "contact.verify",
          entity: "member",
          entityId: id,
        },
        tx,
      );
      return { verified: true };
    });
  }
}
