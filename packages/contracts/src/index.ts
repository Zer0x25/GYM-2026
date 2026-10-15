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
  "SERVICE_UNAVAILABLE",
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
  grupalCredits: z.number().int().nonnegative().nullable().optional(),
  fijaCredits: z.number().int().nonnegative().nullable().optional(),
  citaCredits: z.number().int().nonnegative().nullable().optional(),
});
export type PlanRef = z.infer<typeof PlanRef>;

export const ClassCredits = z.object({
  grupal: z.number().int().min(0).max(100000),
  fija: z.number().int().min(0).max(100000),
  cita: z.number().int().min(0).max(100000),
});
export type ClassCredits = z.infer<typeof ClassCredits>;
export const CreatePlanRequest = z
  .object({
    name: z.string().min(1).max(200),
    priceCents: z.number().int().nonnegative(),
    durationDays: z.number().int().positive(),
    coverage: z.enum(["none", "unlimited", "limited"]),
    classCredits: ClassCredits.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.coverage === "limited") !== Boolean(value.classCredits)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["classCredits"],
        message: "Configura cuotas completas solo para cobertura limitada",
      });
    }
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

export const PaymentMethod = z.enum(["cash", "transfer", "transbank"]);
export type PaymentMethod = z.infer<typeof PaymentMethod>;
export const TransbankEvidence = z.object({
  reference: z.string().trim().min(1).max(200),
  comment: z.string().trim().min(1).max(1000),
});

export const RegisterPaymentRequest = z
  .object({
    membershipId: z.string().uuid(),
    amountCents: z.number().int().nonnegative(),
    method: PaymentMethod,
    /** Mandatory when method === "transfer" (REQ-2). */
    reference: z
      .string()
      .min(1)
      .transform((value) => value.trim())
      .optional(),
    comment: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.method === "transbank") {
      const evidence = TransbankEvidence.safeParse(value);
      if (!evidence.success) for (const issue of evidence.error.issues) ctx.addIssue(issue);
    }
  });
export type RegisterPaymentRequest = z.infer<typeof RegisterPaymentRequest>;

export const PaymentRef = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  memberId: z.string().uuid(),
  membershipId: z.string().uuid(),
  planId: z.string().uuid(),
  amountCents: z.number().int(),
  method: PaymentMethod,
  reference: z.string().nullable(),
  comment: z.string().nullable().optional(),
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

export const RegisterFinancialAdjustmentRequest = z.object({
  idempotencyKey: z.string().uuid(),
  kind: z.enum(["refund", "adjustment"]),
  amountCents: z.number().int().positive().max(2147483647),
  reason: z.string().trim().min(1).max(1000),
});
export type RegisterFinancialAdjustmentRequest = z.infer<typeof RegisterFinancialAdjustmentRequest>;

export const FinancialAdjustmentRef = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  paymentId: z.string().uuid(),
  sessionId: z.string().uuid(),
  actorId: z.string(),
  idempotencyKey: z.string().uuid(),
  kind: z.enum(["refund", "adjustment"]),
  method: PaymentMethod,
  amountCents: z.number().int().positive(),
  reason: z.string(),
  createdAt: z.string(),
});
export type FinancialAdjustmentRef = z.infer<typeof FinancialAdjustmentRef>;

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
  method: PaymentMethod,
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
    transbank: z.number().int().default(0),
  }),
  movementCount: z.number().int(),
});
export type CashConsolidation = z.infer<typeof CashConsolidation>;

export const ApiOk = <T extends z.ZodTypeAny>(data: T) => z.object({ data });
export type ApiOk<T> = { data: T };

// --- Entrega 3: clases, sesiones, agenda y reservas ---------------------------

export const ClassType = z.enum(["grupal", "fija"]);
export type ClassType = z.infer<typeof ClassType>;

export const SessionType = z.enum(["grupal", "fija", "cita", "bloqueo"]);
export type SessionType = z.infer<typeof SessionType>;

export const SessionState = z.enum(["programada", "cancelada", "completada"]);
export type SessionState = z.infer<typeof SessionState>;

export const BookingState = z.enum(["confirmada", "cancelada", "ausente"]);
export type BookingState = z.infer<typeof BookingState>;

export const CancellationType = z.enum(["temprana", "tardia", "gimnasio", "ausencia"]);
export type CancellationType = z.infer<typeof CancellationType>;

export const CreateClassTemplateRequest = z.object({
  name: z.string().min(1),
  type: ClassType,
  capacity: z.number().int().positive(),
  reservationWindowHours: z.number().int().nonnegative().default(0),
  cancellationWindowHours: z.number().int().nonnegative().default(24),
  coverageRequired: z.enum(["none", "unlimited", "limited"]).default("unlimited"),
});
export type CreateClassTemplateRequest = z.infer<typeof CreateClassTemplateRequest>;

export const ClassTemplateDetail = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string(),
  type: ClassType,
  capacity: z.number().int(),
  reservationWindowHours: z.number().int(),
  cancellationWindowHours: z.number().int(),
  coverageRequired: z.enum(["none", "unlimited", "limited"]),
  active: z.boolean(),
  createdAt: z.string(),
});
export type ClassTemplateDetail = z.infer<typeof ClassTemplateDetail>;

export const CreateSessionRequest = z.object({
  templateId: z.string().uuid().optional(),
  type: SessionType,
  instructorId: z.string().min(1),
  startsAt: z.string(),
  endsAt: z.string(),
  capacity: z.number().int().positive().default(1),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const SessionDetail = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  templateId: z.string().uuid().nullable(),
  type: SessionType,
  instructorId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  capacity: z.number().int(),
  state: SessionState,
  /** Confirmed bookings count (derived; drives the last-slot check). */
  confirmedCount: z.number().int(),
  createdAt: z.string(),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

export const CreateBookingRequest = z.object({
  sessionId: z.string().uuid(),
});
export type CreateBookingRequest = z.infer<typeof CreateBookingRequest>;

export const BookingDetail = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  memberId: z.string().uuid(),
  state: BookingState,
  periodId: z.string().uuid().nullable().optional(),
  beneficioComprometido: z.boolean(),
  createdAt: z.string(),
});
export type BookingDetail = z.infer<typeof BookingDetail>;

export const CancelBookingRequest = z.object({
  type: CancellationType,
  reason: z.string().optional(),
});
export type CancelBookingRequest = z.infer<typeof CancelBookingRequest>;

export const BookingCancellationDetail = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  bookingId: z.string().uuid(),
  type: CancellationType,
  creditReturned: z.boolean(),
  creditReviewRequired: z.boolean().optional(),
  reason: z.string().nullable(),
  actorId: z.string(),
  actorRole: z.string(),
  createdAt: z.string(),
});
export type BookingCancellationDetail = z.infer<typeof BookingCancellationDetail>;

export const MarkAttendanceRequest = z.object({
  /** "asistio" → confirmada attendance; "ausencia" → no-show (REQ-5). */
  outcome: z.enum(["asistio", "ausencia"]),
});
export type MarkAttendanceRequest = z.infer<typeof MarkAttendanceRequest>;

/** Unified instructor agenda entry (grupal/fija/cita/bloqueo merged). */
export const AgendaEntry = z.object({
  sessionId: z.string().uuid(),
  type: SessionType,
  startsAt: z.string(),
  endsAt: z.string(),
  capacity: z.number().int(),
  confirmedCount: z.number().int(),
  state: SessionState,
  templateName: z.string().nullable(),
});
export type AgendaEntry = z.infer<typeof AgendaEntry>;

// --- Entrega 4: offline controlado (spec 005) --------------------------------

/** Device lifecycle: habilitado emits; revocado is kept for audit but inert. */
export const DeviceState = z.enum(["habilitado", "revocado"]);
export type DeviceState = z.infer<typeof DeviceState>;

export const DeviceType = z.enum(["cobro_provisional", "ingreso_contingencia", "excepcion"]);
export type DeviceType = z.infer<typeof DeviceType>;

export const OfflineEventState = z.enum([
  "pendiente",
  "sincronizado",
  "rechazado",
  "duplicado_negocio",
]);
export type OfflineEventState = z.infer<typeof OfflineEventState>;

/** Register a pre-authorized device (admin). One org + one operator. */
export const RegisterDeviceRequest = z.object({
  accountId: z.string().min(1),
  label: z.string().min(1),
  publicKey: z.string().min(1).optional(),
});
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequest>;

/**
 * A single offline event as emitted by the device (sync batch entry).
 * eventId is device-generated (the idempotency key); folioExterno is the
 * operator's own reference (business-duplicate fingerprint).
 */
export const OfflineEventInput = z.object({
  eventId: z.string().uuid(),
  type: DeviceType,
  folioExterno: z.string().min(1),
  cashSessionId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  capturedAt: z.string(),
  amountCents: z.number().int().optional(),
  method: PaymentMethod.optional(),
  payload: z.string().optional(),
});
export type OfflineEventInput = z.infer<typeof OfflineEventInput>;

/** Sync batch: many events, each acknowledged independently (idempotent). */
export const SyncEventsRequest = z.object({
  deviceId: z.string().uuid(),
  events: z.array(OfflineEventInput).min(1),
});
export type SyncEventsRequest = z.infer<typeof SyncEventsRequest>;

/** Per-event acknowledgment: sincronizado | duplicado | rechazado. */
export const SyncResultEntry = z.object({
  eventId: z.string().uuid(),
  status: z.enum(["sincronizado", "duplicado", "rechazado"]),
  reason: z.string().optional(),
  /** Payment id when a provisional cobro was applied (Entrega 2 link). */
  paymentId: z.string().uuid().optional(),
});
export type SyncResultEntry = z.infer<typeof SyncResultEntry>;

export const SyncEventsResponse = z.object({
  results: z.array(SyncResultEntry),
});
export type SyncEventsResponse = z.infer<typeof SyncEventsResponse>;

/** Contingency ingress: uses a membership snapshot with freshness control. */
export const IngressContingenciaRequest = z.object({
  deviceId: z.string().uuid(),
  memberId: z.string().uuid(),
  /** Snapshot captured by the device; checked against org freshness limit. */
  snapshotCapturedAt: z.string(),
  coverage: z.enum(["none", "unlimited", "limited"]),
});
export type IngressContingenciaRequest = z.infer<typeof IngressContingenciaRequest>;

/** Auditable reconstruction of a tenant/device event chain (SPEC:OFF-RECON). */
export const ReconstructRequest = z.object({
  deviceId: z.string().uuid().optional(),
});
export type ReconstructRequest = z.infer<typeof ReconstructRequest>;

export const ReconstructResponse = z.object({
  eventsChecked: z.number().int(),
  chainIntact: z.boolean(),
  brokenAt: z.string().uuid().nullable(),
});
export type ReconstructResponse = z.infer<typeof ReconstructResponse>;

// ── Entrega 5 · Revocación de sesión (spec 006, REQ-11) ─────────────────────

/** Active session metadata for an account (no tokens exposed) (SPEC:REVOKE). */
export const SessionInfo = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type SessionInfo = z.infer<typeof SessionInfo>;

export const ListSessionsQuery = z.object({
  accountId: z.string().min(1),
});
export type ListSessionsQuery = z.infer<typeof ListSessionsQuery>;

export const RevokeSessionRequest = z.object({
  accountId: z.string().min(1),
  sessionId: z.string().min(1),
});
export type RevokeSessionRequest = z.infer<typeof RevokeSessionRequest>;

export const RevokeAllSessionsRequest = z.object({
  accountId: z.string().min(1),
});
export type RevokeAllSessionsRequest = z.infer<typeof RevokeAllSessionsRequest>;

export const RevokeResult = z.object({
  revoked: z.number().int(),
});
export type RevokeResult = z.infer<typeof RevokeResult>;

// ── QR de ingreso y check-in (spec 007, REQ-7/REQ-8) ────────────────────────

export const CheckinRequest = z.object({
  qrToken: z.string().min(1),
});
export type CheckinRequest = z.infer<typeof CheckinRequest>;

export const CheckinResponse = z.object({
  allowed: z.boolean(),
  /** Identity for the receptionist to confirm visually (present when allowed). */
  member: z
    .object({
      id: z.string().uuid(),
      fullName: z.string(),
    })
    .optional(),
  /** Active plan coverage observed at check-in time. */
  coverage: z.enum(["unlimited", "limited"]).optional(),
  /** When the current membership window ends (for the receptionist's info). */
  membershipEndsAt: z.string().optional(),
  /** Reason when allowed=false. */
  reason: z.string().optional(),
});
export type CheckinResponse = z.infer<typeof CheckinResponse>;

export const MyQrResponse = z.object({
  qrToken: z.string(),
});
export type MyQrResponse = z.infer<typeof MyQrResponse>;

// SPEC 010 — operational HTTP inputs; roles/tenant are always resolved server-side.
export const OfflineLeaseRequest = z.object({ deviceId: z.string().uuid() });
export const OfflinePolicyUpdateRequest = z.object({ enabled: z.boolean() });
export const DailyReportQuery = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, "Fecha inválida"),
});
export const ScheduleQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export const InstructorInfo = z.object({ id: z.string(), name: z.string() });
export const StaffInfo = InstructorInfo.extend({
  email: z.string().email(),
  role: z.enum(["admin", "recepcion", "instructor"]),
});
export const OfflineMemberSnapshot = z.object({
  id: z.string().uuid(),
  name: z.string(),
  qrToken: z.string().nullable(),
  membershipId: z.string().uuid().nullable(),
  coverage: z.enum(["none", "unlimited", "limited"]),
  endAt: z.string().datetime().nullable(),
  price: z.number().int().nonnegative(),
  proof: z.string(),
});
export const OfflineLeaseResponse = z.object({
  deviceId: z.string().uuid(),
  organizationId: z.string().uuid(),
  accountId: z.string(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  members: z.array(OfflineMemberSnapshot),
  permit: z.string(),
});
export type OfflineLeaseResponse = z.infer<typeof OfflineLeaseResponse>;

/** SPEC 015: possession of a contact address never grants login identity. */
export const RequestContactVerification = z.object({ email: z.string().trim().email().max(254) });
export const ConfirmContactVerification = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
export const EmailCapabilities = z.object({
  passwordReset: z.boolean(),
  contactVerification: z.boolean(),
});

export const PeriodCreditBalance = z.object({
  quota: z.number().int().nonnegative().nullable(),
  committed: z.number().int().nonnegative(),
  available: z.number().int().nullable(),
});
export const CreditPeriodSummary = z.object({
  id: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  coverage: z.enum(["none", "unlimited", "limited"]),
  planName: z.string(),
  credits: z.object({
    grupal: PeriodCreditBalance,
    fija: PeriodCreditBalance,
    cita: PeriodCreditBalance,
  }),
  reviewCount: z.number().int().nonnegative(),
  reviewBookingIds: z.array(z.string().uuid()),
});
