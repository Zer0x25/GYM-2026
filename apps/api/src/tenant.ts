/**
 * Tenant context for the API.
 *
 * The organization is resolved from the VERIFIED session — never from the
 * client. Every domain service receives a TenantContext and must filter all
 * reads/writes by organizationId (REQ-1: cross-tenant isolation).
 *
 * Until the auth unit (Entrega 1) wires Better Auth, the scaffold builds the
 * context from explicit headers for smoke tests and the API defaults to the
 * demo organization configured in .env (development only).
 */
import type { Role } from "@gym/contracts";

export interface TenantContext {
  organizationId: string;
  actorId: string;
  role: Role;
}

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

export function assertTenantContext(ctx: TenantContext | undefined): asserts ctx is TenantContext {
  if (!ctx || !ctx.organizationId || !ctx.actorId) {
    throw new TenantContextError("Tenant context is required and must come from the verified session");
  }
}

/** Attaches a tenant context to a request (Fastify plugin helper). */
export const TENANT_HEADER = "x-organization-id";
