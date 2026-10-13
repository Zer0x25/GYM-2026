/**
 * Client-side permission helpers — a MIRROR of the backend RBAC matrix
 * (docs/api/README.md "Matriz RBAC"; enforced authoritatively in
 * apps/api/src/roles.ts + per-route requireRole).
 *
 * Purpose is UX only: hide nav/actions a role cannot use so staff never
 * hits a 403 they could have avoided seeing. The API re-validates every
 * call — these helpers NEVER authorize, they only gate what we render.
 * When the backend matrix changes, update this file to match.
 */
import type { SessionData } from "./api.js";

export type Role = SessionData["role"];

/** Roles that operate reception (mostrador, cash shift, payments register). */
export const RECEPTION_ROLES: Role[] = ["admin", "recepcion"];

/**
 * Can operate the mostrador (supervised check-in). Matrix: POST /checkin
 * and GET /checkins/recent → admin, recepcion.
 */
export function canUseMostrador(role: Role | undefined): boolean {
  return role === "admin" || role === "recepcion";
}

/**
 * Can open/close the cash shift and see cash movements. Matrix: all
 * /cash/* routes → admin, recepcion.
 */
export function canUseCash(role: Role | undefined): boolean {
  return role === "admin" || role === "recepcion";
}

/**
 * Can see the payments tray (register + history). Matrix: GET/POST
 * /payments → admin, recepcion. Instructor has no payments access.
 */
export function canUsePayments(role: Role | undefined): boolean {
  return role === "admin" || role === "recepcion";
}

/**
 * Can validate/reject a payment (separation of functions). Matrix:
 * POST /payments/:id/validate|reject → admin only.
 */
export function canDecidePayments(role: Role | undefined): boolean {
  return role === "admin";
}

/**
 * Can create members / register payments / memberships. Matrix: POST
 * /members, /socios, /memberships, /payments → admin, recepcion.
 */
export function canManageMembers(role: Role | undefined): boolean {
  return role === "admin" || role === "recepcion";
}

/**
 * Can see the members list (read). Matrix: GET /members → admin,
 * recepcion, instructor.
 */
export function canReadMembers(role: Role | undefined): boolean {
  return role === "admin" || role === "recepcion" || role === "instructor";
}

/**
 * Can see classes/agenda, create sessions and mark attendance. Matrix:
 * /class-templates, /sessions, /bookings, attendance → admin, recepcion,
 * instructor (socio only its own, never in the staff shell).
 */
export function canUseClasses(role: Role | undefined): boolean {
  return role === "admin" || role === "recepcion" || role === "instructor";
}
