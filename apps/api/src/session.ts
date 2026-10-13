/**
 * Authenticated session context (spec 002).
 *
 * A resolved session carries:
 * - accountId: the Better Auth user id (actor),
 * - organizationId: the tenant the actor belongs to (from staff_assignments
 *   for staff, or members.organization_id for socios),
 * - role: admin | recepcion | instructor | socio,
 * - memberId: set only for socios, used by "my profile" endpoints so the
 *   socio can never address another member by id (REQ-7).
 */
import type { TenantContext } from "./tenant.js";

export interface SessionContext extends TenantContext {
  accountId: string;
  email: string;
  memberId?: string | undefined;
  /** Better Auth session row id — the session making THIS request. Used by
   *  self-revocation ("close my other sessions") so it never logs the actor
   *  out of the device in use (spec 006, SPEC:REVOKE). */
  sessionId?: string | undefined;
}

/** Builds a SessionContext filling actorId from accountId (they are the same
 *  actor: the authenticated user id). */
export function makeSessionContext(
  base: Omit<SessionContext, "actorId">,
): SessionContext {
  return { ...base, actorId: base.accountId };
}
