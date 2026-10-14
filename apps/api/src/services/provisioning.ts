/**
 * Provisioning service (spec 002): creates identities and their bindings.
 *
 * Accounts are created through the Better Auth admin API (password hashing
 * owned by Better Auth) and then bound to a tenant:
 * - staff → staff_assignments (one organization per staff member, D-02/C),
 * - socio → members row (portal login links via contact email).
 *
 * Public sign-up is disabled; only an authenticated admin of the target
 * organization may provision (enforced at the route layer).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { identityAccounts, members, staffAssignments } from "@gym/db";
import type { Database } from "@gym/db";
import type { Auth } from "../auth.js";
import { conflict } from "../errors.js";
import type { Role } from "@gym/contracts";

/** Opaque, globally-unique QR token (spec 007, SPEC:QR-TOKEN). Not
 *  sequential, carries no member/tenant data; resolved against the DB. */
export function generateQrToken(): string {
  return randomUUID().replace(/-/g, "");
}

export interface CreateStaffInput {
  email: string;
  password: string;
  name: string;
  role: Exclude<Role, "socio">;
  organizationId: string;
}

export interface CreateSocioInput {
  email: string;
  password: string;
  name: string;
  organizationId: string;
}

export class ProvisioningService {
  constructor(
    private readonly db: Database,
    private readonly auth: Auth,
  ) {}

  /**
   * Creates a staff account bound to exactly one organization.
   * The caller (route) must have verified the session belongs to an admin of
   * organizationId BEFORE calling this. The account is created with
   * Better Auth (password hashing owned by Better Auth) via the admin API
   * with an internal creation context that bypasses the public sign-up
   * restriction (disableSignUp: true keeps the public endpoint closed).
   */
  async createStaff(input: CreateStaffInput): Promise<{ accountId: string }> {
    const existing = await this.db
      .select()
      .from(identityAccounts)
      .where(eq(identityAccounts.email, input.email))
      .limit(1);
    if (existing[0]) throw conflict("Ya existe una cuenta con ese email");

    const created = await this.auth.api.createUser({
      body: {
        email: input.email,
        password: input.password,
        name: input.name,
        data: { emailVerified: true },
      },
    });

    const accountId = created.user.id;
    await this.db
      .insert(identityAccounts)
      .values({ id: accountId, email: input.email, passwordHash: "better-auth" });

    await this.db.insert(staffAssignments).values({
      organizationId: input.organizationId,
      accountId,
      role: input.role,
    });

    return { accountId };
  }

  /**
   * Creates a socio account: a members row plus the login account. The
   * memberId is what portal "my profile" endpoints use — the socio never
   * addresses members by id (REQ-7).
   */
  async createSocio(input: CreateSocioInput): Promise<{ accountId: string; memberId: string }> {
    const existing = await this.db
      .select()
      .from(identityAccounts)
      .where(eq(identityAccounts.email, input.email))
      .limit(1);
    if (existing[0]) throw conflict("Ya existe una cuenta con ese email");

    const [member] = await this.db
      .insert(members)
      .values({
        organizationId: input.organizationId,
        fullName: input.name,
        contactEmail: input.email,
        qrToken: generateQrToken(),
      })
      .returning();
    if (!member) throw conflict("No se pudo crear el socio");

    const created = await this.auth.api.createUser({
      body: {
        email: input.email,
        password: input.password,
        name: input.name,
        data: { emailVerified: true },
      },
    });

    const accountId = created.user.id;
    await this.db
      .insert(identityAccounts)
      .values({ id: accountId, email: input.email, passwordHash: "better-auth" });

    await this.db.update(members).set({ accountId }).where(eq(members.id, member.id));
    return { accountId, memberId: member.id };
  }
}
