/**
 * Better Auth wiring (spec 002).
 *
 * Self-hosted identity in Fastify (ADR-0002 §2.2). Accounts and sessions live
 * in PostgreSQL through our own Drizzle adapter over @gym/db — no external
 * auth provider, no vendor lock. Roles and tenant binding are NOT stored by
 * Better Auth; they live in our staff_assignments/members tables and are
 * resolved per request by resolveSession() below.
 *
 * Secrets come from the environment (AUTH_SECRET) — never from the repo.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "@gym/db";
import * as schema from "@gym/db";

export interface AuthOptions {
  db: Database;
  secret: string;
  baseURL: string;
  /** Extra cookies: none by default; Bearer plugin added for API clients. */
}

/**
 * Builds the Better Auth instance. The Drizzle adapter maps its core tables
 * (user/session/account/verification) onto our PostgreSQL schema; our domain
 * tables (organizations, staff_assignments, members) stay separate.
 */
export function createAuth(opts: AuthOptions) {
  if (!opts.secret || opts.secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 chars (generate: openssl rand -base64 32)");
  }
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    database: drizzleAdapter(opts.db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // Sign-up is invitation-only in GYM: the public flow must not create
      // accounts. Staff/socio accounts are provisioned by admins (spec 002).
      disableSignUp: true,
    },
    session: {
      expiresIn: 60 * 60 * (Number(process.env.SESSION_TTL_HOURS ?? 12) || 12),
      updateAge: 60 * 60,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    advanced: {
      // Shared staff machines (AUTH-01): httpOnly, same-site lax, secure in prod.
      useSecureCookies: process.env.NODE_ENV === "production",
      cookiePrefix: "gym",
    },
    user: {
      additionalFields: {
        // Role/tenant are resolved per-request from staff_assignments; we keep
        // the Better Auth user record minimal (identity only).
        fullName: { type: "string", required: false, input: false },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
