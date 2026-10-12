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

export const ApiOk = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data });
export type ApiOk<T> = { data: T };
