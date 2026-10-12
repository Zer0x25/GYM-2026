/**
 * Shared HTTP contracts for App GYM (GYM-2026).
 *
 * These schemas are the single source of truth for request/response shapes
 * between apps/web and apps/api. They carry NO authorization logic: the
 * backend is always the authority (see docs/adr/0002-arquitectura-base.md).
 *
 * Documentation lives in docs/api/<resource>.md. When a contract changes,
 * update the doc and version the schema.
 */
import { z } from "zod";

/** Stable error codes returned by the API. */
export const ErrorCode = z.enum([
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "INTERNAL_ERROR",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorResponse = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Roles defined for the MVP (ADR-0002 §2.2). */
export const Role = z.enum(["admin", "recepcion", "instructor", "socio"]);
export type Role = z.infer<typeof Role>;

/**
 * Organization (tenant). One venue per organization in v1.0 (D-01).
 * The organization is resolved from the verified session, never from the client.
 */
export const OrganizationRef = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});
export type OrganizationRef = z.infer<typeof OrganizationRef>;

export const CreateOrganizationRequest = z.object({
  name: z.string().min(1).max(200),
});
export type CreateOrganizationRequest = z.infer<typeof CreateOrganizationRequest>;

/** Authenticated session context returned by /auth/session. */
export const SessionResponse = z.object({
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
  }),
  organization: OrganizationRef,
  role: Role,
});
export type SessionResponse = z.infer<typeof SessionResponse>;

/** Member (socio) core fields for v1.0 (N block). */
export const MemberRef = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  fullName: z.string().min(1),
  contactEmail: z.string().email().optional(),
});
export type MemberRef = z.infer<typeof MemberRef>;

export const CreateMemberRequest = z.object({
  fullName: z.string().min(1).max(200),
  contactEmail: z.string().email().optional(),
});
export type CreateMemberRequest = z.infer<typeof CreateMemberRequest>;

/** Plan (membership plan) definition, configurable per gym (P-MEM-02.1/B). */
export const PlanRef = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  durationDays: z.number().int().positive(),
  coverage: z.enum(["none", "unlimited", "limited"]),
});
export type PlanRef = z.infer<typeof PlanRef>;

export const CreatePlanRequest = z.object({
  name: z.string().min(1).max(200),
  priceCents: z.number().int().nonnegative(),
  durationDays: z.number().int().positive(),
  coverage: z.enum(["none", "unlimited", "limited"]),
});
export type CreatePlanRequest = z.infer<typeof CreatePlanRequest>;

// ---------------------------------------------------------------------------
// Entrega 2 — memberships, payments, cash (spec 003).
// Money is integer CLP cents everywhere. A provisional payment NEVER grants
// rights; only a validated payment does (SPEC:PAY-01). Validated/rejected
// are terminal states; validated is immutable (D-03/B).
// ---------------------------------------------------------------------------

export const PlanDetail = PlanRef.extend({
  active: z.boolean(),
  createdAt: z.string(),
});
export type PlanDetail = z.infer<typeof PlanDetail>;

export const CreateMembershipRequest = z.object({
  memberId: z.string().uuid(),
  planId: z.string().uuid(),
});
export type CreateMembershipRequest = z.infer<typeof CreateMembershipRequest>;

export const MembershipRef = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  memberId: z.string().uuid(),
  planId: z.string().uuid(),
  /** Derived state — computed from payments, never stored editable. */
  state: z.enum(["pending_payment", "active", "expired"]),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
});
export type MembershipRef = z.infer<typeof MembershipRef>;

export const RegisterPaymentRequest = z.object({
  membershipId: z.string().uuid(),
  amountCents: z.number().int().nonnegative(),
  method: z.enum(["cash", "transfer"]),
  /** Mandatory when method === "transfer" (REQ-2). */
  reference: z.string().min(1).optional(),
});
export type RegisterPaymentRequest = z.infer<typeof RegisterPaymentRequest>;

export const PaymentRef = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  memberId: z.string().uuid(),
  membershipId: z.string().uuid(),
  planId: z.string().uuid(),
  amountCents: z.number().int(),
  method: z.enum(["cash", "transfer"]),
  reference: z.string().nullable(),
  state: z.enum(["provisional", "validated", "rejected"]),
  registeredBy: z.string(),
  decidedBy: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type PaymentRef = z.infer<typeof PaymentRef>;

export const DecidePaymentRequest = z.object({
  /** Mandatory for rejections (auditable reason, D-03/B). */
  reason: z.string().min(1).optional(),
});
export type DecidePaymentRequest = z.infer<typeof DecidePaymentRequest>;

export const OpenCashSessionRequest = z.object({
  openingCents: z.number().int().nonnegative(),
});
export type OpenCashSessionRequest = z.infer<typeof OpenCashSessionRequest>;

export const CloseCashSessionRequest = z.object({
  /** Declared count by the staff member (audited against expected). */
  declaredClosingCents: z.number().int().nonnegative(),
});
export type CloseCashSessionRequest = z.infer<typeof CloseCashSessionRequest>;

export const CashSessionRef = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  openedBy: z.string(),
  closedBy: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  openingCents: z.number().int(),
  declaredClosingCents: z.number().int().nullable(),
  expectedClosingCents: z.number().int().nullable(),
  discrepancyCents: z.number().int().nullable(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
});
export type CashSessionRef = z.infer<typeof CashSessionRef>;

export const CashMovementRef = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  paymentId: z.string().uuid(),
  type: z.enum(["income"]),
  method: z.enum(["cash", "transfer"]),
  amountCents: z.number().int(),
  createdAt: z.string(),
});
export type CashMovementRef = z.infer<typeof CashMovementRef>;

export const CashConsolidation = z.object({
  sessionId: z.string().uuid(),
  date: z.string(),
  openingCents: z.number().int(),
  /** Sum of validated movements of the day (all methods). */
  totalCents: z.number().int(),
  byMethod: z.object({
    cash: z.number().int(),
    transfer: z.number().int(),
  }),
  movementCount: z.number().int(),
});
export type CashConsolidation = z.infer<typeof CashConsolidation>;

export const ApiOk = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data });
export type ApiOk<T> = { data: T };
