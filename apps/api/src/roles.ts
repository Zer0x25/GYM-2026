/**
 * Role authorization helpers (spec 002, REQ-1/REQ-7).
 *
 * The backend is the single authority: routes call requireRole BEFORE any
 * data access. Role order encodes authority: admin > recepcion >
 * instructor > socio. Membership (per-organization binding) is enforced
 * upstream: a session without an active staff assignment is rejected as
 * UNAUTHENTICATED, never as a role fallback.
 */
import type { Role } from "@gym/contracts";
import { forbidden, unauthenticated } from "./errors.js";
import type { TenantContext } from "./tenant.js";

const ROLE_ORDER: Record<Role, number> = {
  admin: 4,
  recepcion: 3,
  instructor: 2,
  socio: 1,
};

export function roleRank(role: Role): number {
  return ROLE_ORDER[role];
}

/** True when `role` appears in `allowed` (exact list; no hierarchy implied). */
export function isRoleAllowed(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role);
}

/**
 * Throws FORBIDDEN (403) unless the session role is in `allowed`.
 * Throws UNAUTHENTICATED (401) when there is no tenant context at all —
 * an anonymous request must never look like a permission problem.
 */
export function requireRole(ctx: TenantContext | undefined, allowed: readonly Role[]): void {
  if (!ctx) {
    throw unauthenticated("Se requiere sesión válida");
  }
  if (!isRoleAllowed(ctx.role, allowed)) {
    throw forbidden(`El rol '${ctx.role}' no puede realizar esta operación`);
  }
}
