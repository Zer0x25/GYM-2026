/**
 * Drizzle schema for App GYM (GYM-2026) — MVP v1.0 scaffolding.
 *
 * Scope notes (ADR-0002 / Notion decisions):
 * - No sauna / generic bookable-resource tables in v1.0 (MVP-SAUNA-01/B).
 * - One venue per organization (D-01); staff member bound to a single
 *   organization in the first launch (D-02/C).
 * - Tenant isolation is enforced by the API (tenant + actor + role + resource);
 *   every table carries organization_id and every query filters by it.
 * - Table names and cardinality are initial; refined per module in later units.
 */
import { pgTable, text, timestamp, uuid, integer, boolean, index } from "drizzle-orm/pg-core";

/** Organization (tenant). One venue per organization in v1.0. */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Better Auth core tables (self-hosted identity, ADR-0002 §2.2).
// Managed by the drizzleAdapter; we declare them here so a single migration
// owns the whole schema. Ids are text (Better Auth generates its own ids).
// ---------------------------------------------------------------------------

export const authUsers = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  fullName: text("full_name"),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Admin plugin fields (Better Auth).
  role: text("role").notNull().default("user"),
  banned: boolean("banned"),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // Admin plugin field (Better Auth).
    impersonatedBy: text("impersonated_by"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const authAccounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const authVerifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Identity account (staff or member login). The id is the Better Auth user
 *  id (a text id), so this table uses text ids and links to auth users by id.
 *  Roles are per-organization via staff_assignments. */
export const identityAccounts = pgTable(
  "identity_accounts",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("identity_accounts_email_idx").on(t.email)],
);

/** Staff assignment: binds a user to exactly one organization with one role
 *  (D-02/C: one operational affiliation per staff member in the first launch).
 *  accountId references the Better Auth user id (text). */
export const staffAssignments = pgTable(
  "staff_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    accountId: text("account_id")
      .notNull()
      .references(() => authUsers.id),
    role: text("role", { enum: ["admin", "recepcion", "instructor"] }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("staff_assignments_org_idx").on(t.organizationId)],
);

/** Member (socio) profile. Minors link to an adult responsible (D-05/B). */
export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    fullName: text("full_name").notNull(),
    contactEmail: text("contact_email"),
    adultResponsibleId: uuid("adult_responsible_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("members_org_idx").on(t.organizationId)],
);

/** Plan definition, configurable per gym (P-MEM-02.1/B). */
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
    durationDays: integer("duration_days").notNull(),
    coverage: text("coverage", { enum: ["none", "unlimited", "limited"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plans_org_idx").on(t.organizationId)],
);

export const schema = {
  organizations,
  authUsers,
  authSessions,
  authAccounts,
  authVerifications,
  identityAccounts,
  staffAssignments,
  members,
  plans,
};
