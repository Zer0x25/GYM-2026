/**
 * Better Auth wiring (spec 002).
 *
 * Self-hosted identity in Fastify (ADR-0002 §2.2). Accounts and sessions live
 * in PostgreSQL through our own Drizzle adapter over @gym/db — no external
 * auth provider, no vendor lock. Roles and tenant binding are NOT stored by
 * Better Auth; they live in our staff_assignments/members tables and are
 * resolved per request by resolveSession().
 *
 * Secrets come from the environment (AUTH_SECRET) — never from the repo.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import type { Database } from "@gym/db";
import * as schema from "@gym/db";

export interface AuthOptions {
  db: Database;
  secret: string;
  baseURL: string;
}

/** Minimal structural type of the Better Auth instance (the inferred type
 *  with the admin plugin is not portable across module boundaries).
 *  Consuming code uses the documented calls only. */
export interface GymAuth {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession(opts: {
      headers: Headers;
      query?: { disableCookieCache?: boolean };
    }): Promise<{ user: { id: string; email: string } } | null>;
    signInEmail(opts: { body: { email: string; password: string } }): Promise<{
      headers: Headers;
      user: { id: string; email: string };
    }>;
    signUpEmail(opts: { body: { email: string; password: string; name: string } }): Promise<{
      user: { id: string; email: string };
    }>;
    createUser(opts: {
      body: { email: string; password: string; name: string; data?: Record<string, unknown> };
    }): Promise<{ user: { id: string; email: string } }>;
    signOut(opts: { headers: Headers }): Promise<{ success: boolean }>;
  };
}

/**
 * Builds the Better Auth instance. The Drizzle adapter maps its core tables
 * (user/session/account/verification, declared in @gym/db) onto our
 * PostgreSQL schema; our domain tables stay separate.
 */
export function createAuth(opts: AuthOptions): GymAuth {
  if (!opts.secret || opts.secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 chars (generate: openssl rand -base64 32)");
  }
  const sessionTtlHours = Number(process.env.SESSION_TTL_HOURS ?? 12) || 12;
  // The real Better Auth instance is structurally compatible with GymAuth for
  // the calls we make; the full inferred type is not portable across modules.
  const instance = betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    // Better Auth only receives its four core tables (keyed by model name);
    // our domain tables are never exposed to the auth adapter.
    database: drizzleAdapter(opts.db, {
      provider: "pg",
      schema: {
        user: schema.authUsers,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // Sign-up via the PUBLIC endpoint is disabled (invitation-only in GYM);
      // admins create accounts through ProvisioningService (admin plugin's
      // createUser), which is a server-side call, not the public endpoint.
      disableSignUp: true,
    },
    session: {
      expiresIn: 60 * 60 * sessionTtlHours,
      updateAge: 60 * 60,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    plugins: [
      // Admin plugin: ProvisioningService uses auth.api.createUser() to
      // create accounts server-side (invitation-only); the public sign-up
      // endpoint stays disabled.
      admin(),
    ],
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
  return instance as unknown as GymAuth;
}

export type Auth = GymAuth;
