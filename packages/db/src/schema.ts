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
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";

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
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plans_org_idx").on(t.organizationId)],
);

/**
 * Membership (membresía): binds a member to a plan with a validity window.
 *
 * Rights are DERIVED from payments, never stored as an editable flag:
 * active when a validated payment covers the window [start, start + duration);
 * pending_payment when no validated payment yet; expired when the window ended.
 * Renewal = a new validated payment extends the window (no coverage gaps).
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    /** Start of the current validity window (set at first validated payment). */
    startAt: timestamp("start_at", { withTimezone: true }),
    /** End of the current validity window (start + plan.durationDays). */
    endAt: timestamp("end_at", { withTimezone: true }),
    /** Last payment that extended the window (denormalized for audit reads). */
    lastPaymentId: uuid("last_payment_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memberships_org_idx").on(t.organizationId),
    index("memberships_member_idx").on(t.memberId),
  ],
);

/**
 * Manual payment (cobro manual, REQ-2).
 *
 * State machine (terminal states, TX-03): provisional -> validated | rejected.
 * A validated payment is IMMUTABLE (D-03/B): corrections only via an audited
 * adjustment, never an UPDATE. A provisional payment grants NO rights.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    /** Amount in CLP cents (integer). Must match plan.priceCents (warn on diff). */
    amountCents: integer("amount_cents").notNull(),
    method: text("method", { enum: ["cash", "transfer"] }).notNull(),
    /** Bank transfer reference (REQUIRED for method=transfer). */
    reference: text("reference"),
    state: text("state", { enum: ["provisional", "validated", "rejected"] })
      .notNull()
      .default("provisional"),
    /** Staff account that REGISTERED the payment (separation of functions). */
    registeredBy: text("registered_by")
      .notNull()
      .references(() => authUsers.id),
    /** Staff account that VALIDATED/REJECTED (must differ from registeredBy). */
    decidedBy: text("decided_by").references(() => authUsers.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Mandatory auditable reason for rejections. */
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_org_idx").on(t.organizationId),
    index("payments_state_idx").on(t.organizationId, t.state),
    index("payments_member_idx").on(t.memberId),
  ],
);

/**
 * Cash session (turno de caja, REQ-3): one open/closed shift per user.
 * Closing is IDEMPOTENT under concurrency (TX-05): two simultaneous closes
 * of the same session -> one 200, one 409. Sessions are never deleted.
 */
export const cashSessions = pgTable(
  "cash_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    openedBy: text("opened_by")
      .notNull()
      .references(() => authUsers.id),
    closedBy: text("closed_by").references(() => authUsers.id),
    state: text("state", { enum: ["open", "closed"] }).notNull().default("open"),
    openingCents: integer("opening_cents").notNull(),
    /** Declared closing amount (staff count). */
    declaredClosingCents: integer("declared_closing_cents"),
    /** Expected closing = opening + validated movements of the session. */
    expectedClosingCents: integer("expected_closing_cents"),
    /** Difference declared - expected (audited, never blocking). */
    discrepancyCents: integer("discrepancy_cents"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("cash_sessions_org_idx").on(t.organizationId, t.state)],
);

/**
 * Cash movement (movimiento de caja): created ONLY when a payment is
 * validated (money never enters the cash until validated). IMMUTABLE once
 * created — no updates, no deletes (D-03/B).
 */
export const cashMovements = pgTable(
  "cash_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => cashSessions.id),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    type: text("type", { enum: ["income"] }).notNull(),
    method: text("method", { enum: ["cash", "transfer"] }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cash_movements_session_idx").on(t.sessionId),
    // One movement per payment: the uniqueness guard is the real idempotency
    // key (a payment can never produce two cash entries).
    unique("cash_movements_payment_unique").on(t.paymentId),
  ],
);

/**
 * Class template (plantilla de clase): defines a group or fixed class with
 * its capacity, reservation window, cancellation window and required
 * coverage. Configurable per tenant (admin). The template is the recipe;
 * concrete occurrences are `sessions`.
 */
export const classTemplates = pgTable(
  "class_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    type: text("type", { enum: ["grupal", "fija"] }).notNull(),
    /** Max concurrent bookings a session of this template accepts. */
    capacity: integer("capacity").notNull(),
    /** Hours before the session that reservation opens (0 = always open). */
    reservationWindowHours: integer("reservation_window_hours").notNull().default(0),
    /** Hours before the session that a cancellation is still "temprana". */
    cancellationWindowHours: integer("cancellation_window_hours").notNull().default(24),
    /** Plan coverage required to book (ties to plans.coverage). */
    coverageRequired: text("coverage_required", { enum: ["none", "unlimited", "limited"] })
      .notNull()
      .default("unlimited"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("class_templates_org_idx").on(t.organizationId)],
);

/**
 * Session (sesión): a concrete occurrence of a class — grupal, fija (fixed
 * published), cita (individual appointment) or bloqueo (instructor block).
 * All instructor commitments live here so the agenda can be unified and
 * checked for overlaps (TX-02). capacity snapshots the template at creation.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    templateId: uuid("template_id").references(() => classTemplates.id),
    type: text("type", { enum: ["grupal", "fija", "cita", "bloqueo"] }).notNull(),
    /** Instructor (staff account) that owns this slot. */
    instructorId: text("instructor_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Capacity for bookable sessions (grupal/fija/cita); bloqueo is ignored. */
    capacity: integer("capacity").notNull().default(1),
    state: text("state", { enum: ["programada", "cancelada", "completada"] })
      .notNull()
      .default("programada"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sessions_org_idx").on(t.organizationId),
    index("sessions_instructor_idx").on(t.instructorId, t.startsAt),
  ],
);

/**
 * Booking (reserva): a member's firm hold on a session. One per (session,
 * member) — the unique constraint is the real guard against double-booking
 * the same member (REQ-4). beneficioComprometido marks that the member's
 * access has been committed for this booking (set once, never re-consumed).
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id),
    state: text("state", { enum: ["confirmada", "cancelada", "ausente"] })
      .notNull()
      .default("confirmada"),
    /** True once the member's benefit is committed for this booking (REQ-4). */
    beneficioComprometido: boolean("beneficio_comprometido").notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bookings_org_idx").on(t.organizationId),
    index("bookings_session_idx").on(t.sessionId),
    // One booking per member per session — no double-booking the same slot.
    unique("bookings_session_member_unique").on(t.sessionId, t.memberId),
  ],
);

/**
 * Booking cancellation (cancelación): one row per booking cancellation,
 * recording the policy type (temprana/tardia/gimnasio/ausencia) and whether
 * the credit was returned. One-per-booking by design (unique on bookingId)
 * so the credit is moved exactly once (TX-04) even under concurrency.
 */
export const bookingCancellations = pgTable(
  "booking_cancellations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    type: text("type", { enum: ["temprana", "tardia", "gimnasio", "ausencia"] }).notNull(),
    /** Whether the member's benefit/credit was returned (temprana/gimnasio). */
    creditReturned: boolean("credit_returned").notNull().default(false),
    reason: text("reason"),
    actorId: text("actor_id").notNull(),
    actorRole: text("actor_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("booking_cancellations_org_idx").on(t.organizationId),
    // One cancellation per booking: the idempotency key for the credit move.
    unique("booking_cancellations_booking_unique").on(t.bookingId),
  ],
);

/**
 * Audit log (auditoría): every financial mutation writes one row in the SAME
 * transaction as the mutation itself (actor, action, entity, metadata).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => authUsers.id),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_org_idx").on(t.organizationId, t.createdAt)],
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
  memberships,
  payments,
  cashSessions,
  cashMovements,
  classTemplates,
  sessions,
  bookings,
  bookingCancellations,
  auditLog,
};
