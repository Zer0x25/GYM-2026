/**
 * Session resolution (spec 002).
 *
 * The Better Auth session proves WHO the actor is. This module answers
 * WHERE (organization) and WHAT (role) they may act:
 *
 * - staff: the active row of staff_assignments for the account (one
 *   organization per staff member, D-02/C). No active assignment → no session
 *   context (UNAUTHENTICATED), never a downgraded role.
 * - socio: the member row linked to the account by immutable accountId; memberId
 *   is set so "my profile" endpoints can scope without trusting client ids.
 *
 * The organizationId is ALWAYS derived here from stored data — a client can
 * never set it (REQ-1, TX-07).
 */
import { and, eq } from "drizzle-orm";
import type { Database } from "@gym/db";
import { identityAccounts, members, staffAssignments } from "@gym/db";
import type { Role } from "@gym/contracts";
import { makeSessionContext, type SessionContext } from "./session.js";

export interface BetterAuthUser {
  id: string;
  email: string;
  name?: string | null;
}

const STAFF_ROLES: Role[] = ["admin", "recepcion", "instructor"];

function isStaffRole(role: string): role is Role {
  return (STAFF_ROLES as string[]).includes(role);
}

/**
 * Resolves the full session context for an authenticated account.
 * Returns undefined when the account has no active binding (staff without
 * assignment, or socio without member row) — the caller responds 401.
 */
export async function resolveSession(
  db: Database,
  user: BetterAuthUser,
): Promise<SessionContext | undefined> {
  const assignments = await db
    .select()
    .from(staffAssignments)
    .innerJoin(identityAccounts, eq(staffAssignments.accountId, identityAccounts.id))
    .where(and(eq(staffAssignments.accountId, user.id), eq(staffAssignments.active, true)))
    .limit(1);

  const assignment = assignments[0];
  if (assignment && isStaffRole(assignment.staff_assignments.role)) {
    return makeSessionContext({
      accountId: user.id,
      email: user.email,
      organizationId: assignment.staff_assignments.organizationId,
      role: assignment.staff_assignments.role,
    });
  }

  const memberRows = await db.select().from(members).where(eq(members.accountId, user.id)).limit(1);

  const member = memberRows[0];
  if (member) {
    return makeSessionContext({
      accountId: user.id,
      email: user.email,
      organizationId: member.organizationId,
      role: "socio",
      memberId: member.id,
    });
  }

  return undefined;
}
