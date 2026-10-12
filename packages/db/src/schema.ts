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

/** Identity account (staff or member login). Better Auth accounts live here
 *  alongside the profile; roles are per-organization via staff_assignments. */
export const identityAccounts = pgTable(
  "identity_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("identity_accounts_email_idx").on(t.email)],
);

/** Staff assignment: binds a user to exactly one organization with one role
 *  (D-02/C: one operational affiliation per staff member in the first launch). */
export const staffAssignments = pgTable(
  "staff_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => identityAccounts.id),
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
  identityAccounts,
  staffAssignments,
  members,
  plans,
};
