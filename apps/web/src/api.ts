import type {
  OfflineLeaseResponse,
  RegisterFinancialAdjustmentRequest,
  FinancialAdjustmentRef,
  ReconciliationState,
} from "@gym/contracts";
/**
 * Minimal API client for the GYM API.
 *
 * Transport detail: cookies travel with credentials:'include' (Better Auth
 * sets httpOnly cookies at sign-in; the proxy rule keeps them first-party in
 * dev). The UI never sees or stores tokens — the session is server state.
 */
const API_BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const payload = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code: string; message: string; details?: unknown };
  };
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("gym:session-expired"));
    const err = payload.error ?? { code: "HTTP_ERROR", message: `HTTP ${res.status}` };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  if (method !== "GET") window.dispatchEvent(new Event("gym:data-changed"));
  return payload.data as T;
}

async function downloadFile(path: string, defaultFilename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("gym:session-expired"));
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { code: string; message: string; details?: unknown };
    };
    const err = payload.error ?? { code: "HTTP_ERROR", message: `HTTP ${res.status}` };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const disposition = res.headers.get("content-disposition");
  let filename = defaultFilename;
  if (disposition) {
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match?.[1]) filename = match[1];
  }
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface OrganizationRef {
  id: string;
  name: string;
}

export interface SessionData {
  user: SessionUser;
  organization: OrganizationRef;
  role: "admin" | "recepcion" | "instructor" | "socio";
}

export interface Member {
  id: string;
  organizationId: string;
  fullName: string;
  contactEmail: string | null;
  isMinor?: boolean;
  adultResponsibleId?: string | null;
  adultResponsibleName?: string | null;
  createdAt: string;
}

// --- Entrega 2: plans, memberships, payments, cash ---------------------------

export interface Plan {
  id: string;
  organizationId: string;
  name: string;
  priceCents: number;
  durationDays: number;
  coverage: "none" | "unlimited" | "limited";
  grupalCredits?: number | null;
  fijaCredits?: number | null;
  citaCredits?: number | null;
  version?: number;
  active: boolean;
  createdAt: string;
}

export interface MembershipPause {
  id: string;
  organizationId: string;
  membershipId: string;
  periodId: string;
  actorId: string;
  startsAt: string;
  endsAt: string;
  extendedDays: number;
  reason: string;
  state: "active" | "lifted";
  createdAt: string;
}

export interface Membership {
  id: string;
  organizationId: string;
  memberId: string;
  planId: string;
  nextPlanId?: string | null;
  nextPlan?: { id: string; name: string } | null;
  startAt: string | null;
  endAt: string | null;
  lastPaymentId: string | null;
  createdAt: string;
  /** Derived state, computed by the backend on every read. */
  state?: "pending_payment" | "active" | "expired";
  plan?: Plan;
  pauses?: MembershipPause[];
  activePause?: {
    id: string;
    startsAt: string;
    endsAt: string;
    reason: string;
    extendedDays: number;
  } | null;
  cycleTargetCents?: number;
  cyclePaidCents?: number;
  cycleRemainingCents?: number;
}

export type FinancialAdjustment = FinancialAdjustmentRef;

export type PaymentState = "provisional" | "validated" | "rejected";

export interface Payment {
  id: string;
  organizationId: string;
  memberId: string;
  membershipId: string;
  planId: string;
  amountCents: number;
  method: "cash" | "transfer" | "transbank";
  reference: string | null;
  comment?: string | null;
  state: PaymentState;
  registeredBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  periodId?: string | null;
  createdAt: string;
}

export interface CashSession {
  id: string;
  organizationId: string;
  openedBy: string;
  closedBy: string | null;
  state: "open" | "closed";
  reconciliationState?: ReconciliationState;
  openingCents: number;
  declaredClosingCents: number | null;
  expectedClosingCents: number | null;
  discrepancyCents: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface CashMovement {
  id: string;
  organizationId: string;
  sessionId: string;
  paymentId: string;
  type: "income";
  method: "cash" | "transfer" | "transbank";
  amountCents: number;
  createdAt: string;
}

export interface Consolidation {
  sessionId: string;
  date: string;
  openingCents: number;
  totalCents: number;
  byMethod: { cash: number; transfer: number; transbank?: number };
  movementCount: number;
}

/** Formats integer centavos CLP as a locale string. Money is always integer. */
export function formatCLP(cents: number): string {
  return `$${cents.toLocaleString("es-CL")}`;
}

// --- Entrega 3: classes, sessions, bookings (spec 004) ----------------------

export type ClassType = "grupal" | "fija";
export type SessionType = "grupal" | "fija" | "cita" | "bloqueo";
export type SessionState = "programada" | "cancelada" | "completada";
export type BookingState = "confirmada" | "cancelada" | "ausente";
export type CancellationType = "temprana" | "tardia" | "gimnasio" | "ausencia";

export interface ClassTemplate {
  id: string;
  organizationId: string;
  name: string;
  type: ClassType;
  capacity: number;
  reservationWindowHours: number;
  cancellationWindowHours: number;
  coverageRequired: "none" | "unlimited" | "limited";
  active: boolean;
  createdAt: string;
}

export interface CreateClassTemplateInput {
  name: string;
  type: ClassType;
  capacity: number;
  reservationWindowHours?: number;
  cancellationWindowHours?: number;
  coverageRequired?: "none" | "unlimited" | "limited";
}

export interface Session {
  id: string;
  organizationId: string;
  templateId: string | null;
  type: SessionType;
  instructorId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  state: SessionState;
  createdBy: string;
  createdAt: string;
  rescheduledAt?: string | null;
  rescheduledFromStartsAt?: string | null;
  rescheduledCount?: number;
}

export interface CreateSessionInput {
  templateId?: string;
  type: SessionType;
  instructorId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
}

export interface Booking {
  attendance?: "asistio" | "ausencia" | null;
  id: string;
  organizationId: string;
  sessionId: string;
  memberId: string;
  state: BookingState;
  beneficioComprometido: boolean;
  createdBy: string;
  createdAt: string;
}

export interface BookingCancellation {
  id: string;
  organizationId: string;
  bookingId: string;
  type: CancellationType;
  creditReturned: boolean;
  reason: string | null;
  actorId: string;
  actorRole: string;
  createdAt: string;
}

// --- Entrega 5: QR de ingreso y check-in (spec 007) ------------------------

/** Check-in outcome. allowed=false is a BUSINESS decision (coverage), not an
 *  error — the receptionist sees the reason and can act on it. */
export interface CheckinResult {
  allowed: boolean;
  memberId?: string;
  fullName?: string;
  member?: { id: string; fullName: string };
  coverage?: "unlimited" | "limited";
  membershipEndsAt?: string;
  reason?: string;
}

/** One entry of the reception live feed (projection of the audit trail). */
export interface CheckinFeedEntry {
  id: string;
  memberId: string;
  fullName: string;
  outcome: "ok" | "denied";
  detail: string | null;
  at: string;
}

async function accountCommand(path: string, body: object): Promise<void> {
  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      "ACCOUNT_RECOVERY_FAILED",
      response.status === 429
        ? "Demasiados intentos. Espera antes de volver a intentar."
        : path === "reset-password"
          ? "No se pudo cambiar la contraseña. El enlace puede haber vencido o ya fue utilizado."
          : "La recuperación no está disponible. Intenta más tarde.",
    );
  }
}

export const api = {
  emailCapabilities: () =>
    request<{ passwordReset: boolean; contactVerification: boolean }>(
      "GET",
      "/account/email-capabilities",
    ),
  requestPasswordReset: (email: string) => accountCommand("request-password-reset", { email }),
  resetPassword: (token: string, newPassword: string) =>
    accountCommand("reset-password", { token, newPassword }),
  requestContactVerification: (id: string, email: string) =>
    request<{ pending: boolean }>("POST", `/members/${id}/contact-verification`, { email }),
  confirmContactVerification: (id: string, token: string) =>
    request<{ verified: boolean }>("POST", `/members/${id}/contact/verify`, { token }),
  roster: (id: string) => request<Booking[]>("GET", `/sessions/${id}/roster`),
  dailyReport: (date: string) => request<DailyReport>("GET", `/reports/daily?date=${date}`),
  downloadMembersCsv: () => downloadFile("/reports/members.csv", "members.csv"),
  downloadMembershipsCsv: () => downloadFile("/reports/memberships.csv", "memberships.csv"),
  downloadAttendanceCsv: (from: string, to: string) =>
    downloadFile(
      `/reports/attendance.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      `attendance-${from}-${to}.csv`,
    ),
  memberOverview: (id: string) => request<MemberOverview>("GET", `/members/${id}/overview`),
  portalOverview: () => request<PortalOverview>("GET", "/me/overview"),
  schedule: (from?: string, to?: string) =>
    request<ScheduledSession[]>(
      "GET",
      `/schedule?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`,
    ),
  instructors: () => request<Instructor[]>("GET", "/instructors"),
  staff: () => request<Staff[]>("GET", "/staff"),
  createStaff: (input: {
    email: string;
    password: string;
    name: string;
    role: "admin" | "recepcion" | "instructor";
  }) => request<{ accountId: string }>("POST", "/staff", input),
  checkinMember: (id: string) => request<CheckinResult>("POST", `/members/${id}/checkin`),
  rotateQr: () => request<{ qrToken: string }>("POST", "/me/qr/rotate"),
  reissueQr: (id: string) => request<{ qrToken: string }>("POST", `/members/${id}/qr/reissue`),
  revokeQr: (id: string) => request<{ revoked: boolean }>("POST", `/members/${id}/qr/revoke`),
  accountSessions: (accountId: string) =>
    request<AccountSession[]>("GET", `/admin/sessions?accountId=${encodeURIComponent(accountId)}`),
  revokeSession: (sessionId: string) => request("POST", "/admin/sessions/revoke", { sessionId }),
  revokeOthers: () => request("POST", "/me/sessions/revoke-others"),
  supportGrants: () => request<SupportGrant[]>("GET", "/admin/support-grants"),
  createSupportGrant: (input: CreateSupportGrantInput) =>
    request<{ grant: SupportGrant; token: string }>("POST", "/admin/support-grants", input),
  revokeSupportGrant: (id: string) =>
    request<{ success: true; grant: SupportGrant }>("POST", `/admin/support-grants/${id}/revoke`),
  ownDevices: () => request<Device[]>("GET", "/offline/devices"),
  devices: () => request<Device[]>("GET", "/devices"),
  registerDevice: (accountId: string, label: string) =>
    request<Device>("POST", "/devices", { accountId, label }),
  revokeDevice: (id: string) => request<Device>("POST", `/devices/${id}/revoke`),
  offlinePolicy: () =>
    request<{ enabled: boolean; freshnessHours: number }>("GET", "/offline/policy"),
  setOfflinePolicy: (enabled: boolean) => request("POST", "/offline/policy", { enabled }),
  offlineLease: (deviceId: string) => request<OfflineLease>("POST", "/offline/lease", { deviceId }),
  offlineSync: (deviceId: string, events: OfflineEvent[]) =>
    request<{ results: SyncResult[] }>("POST", "/offline/lease/sync", { deviceId, events }),
  offlineEvents: () => request<ServerOfflineEvent[]>("GET", "/offline/events"),
  reconstruct: (deviceId: string) =>
    request<{ eventsChecked: number; chainIntact: boolean; brokenAt: string | null }>(
      "POST",
      "/offline/reconstruct",
      { deviceId },
    ),
  session: () => request<SessionData>("GET", "/auth/session"),
  signIn: (email: string, password: string) =>
    fetch("/api/auth/sign-in/email", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
          code?: string;
        };
        throw new ApiError(
          res.status,
          body.code ?? "SIGN_IN_FAILED",
          body.message ?? "No se pudo iniciar sesión",
        );
      }
    }),
  signOut: () =>
    fetch("/api/auth/sign-out", {
      method: "POST",
      credentials: "include",
      headers: { origin: window.location.origin },
    }).then(async (res) => {
      if (!res.ok)
        throw new ApiError(
          res.status,
          "SIGN_OUT_FAILED",
          "No se pudo cerrar la sesión. Reintenta.",
        );
      window.dispatchEvent(new Event("gym:session-expired"));
    }),
  listMembers: (q?: string) =>
    request<Member[]>("GET", `/members${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  createMember: (input: {
    fullName: string;
    contactEmail?: string | null;
    isMinor?: boolean;
    adultResponsibleId?: string | null;
  }) => request<Member>("POST", "/members", input),
  updateMember: (
    id: string,
    input: {
      fullName?: string;
      contactEmail?: string | null;
      isMinor?: boolean;
      adultResponsibleId?: string | null;
    },
  ) => request<Member>("PATCH", `/members/${id}`, input),
  createSocio: (input: { email: string; password: string; name: string }) =>
    request<{ accountId: string; memberId: string }>("POST", "/socios", input),
  me: () => request<Member>("GET", "/members/me"),
  updateContact: (id: string, contactEmail: string | null) =>
    request<Member>("PATCH", `/members/${id}/contact`, { contactEmail }),

  // --- Entrega 2 ---------------------------------------------------------------
  listPlans: () => request<Plan[]>("GET", "/plans"),
  createPlan: (input: {
    name: string;
    priceCents: number;
    durationDays: number;
    coverage: "none" | "unlimited" | "limited";
    classCredits?: { grupal: number; fija: number; cita: number };
  }) => request<Plan>("POST", "/plans", input),
  updatePlan: (
    id: string,
    input: {
      name?: string;
      priceCents?: number;
      durationDays?: number;
      coverage?: "none" | "unlimited" | "limited";
      classCredits?: { grupal: number; fija: number; cita: number } | null;
      active?: boolean;
    },
  ) => request<Plan>("PATCH", `/plans/${id}`, input),

  listMemberships: () => request<Membership[]>("GET", "/memberships"),
  getMembership: (id: string) => request<Membership>("GET", `/memberships/${id}`),
  createMembership: (input: { memberId: string; planId: string }) =>
    request<Membership>("POST", "/memberships", input),
  schedulePlanChange: (membershipId: string, input: { nextPlanId: string | null }) =>
    request<Membership>("POST", `/memberships/${membershipId}/schedule-plan-change`, input),
  createMembershipPause: (
    membershipId: string,
    input: {
      idempotencyKey?: string;
      startsAt: string;
      endsAt: string;
      reason: string;
    },
  ) =>
    request<MembershipPause>("POST", `/memberships/${membershipId}/pauses`, {
      idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason,
    }),
  myMemberships: () => request<Membership[]>("GET", "/memberships/mine"),

  registerPayment: (input: {
    membershipId: string;
    amountCents: number;
    method: "cash" | "transfer" | "transbank";
    reference?: string;
    comment?: string;
  }) => request<Payment>("POST", "/payments", input),
  listPayments: (state?: PaymentState) =>
    request<Payment[]>("GET", `/payments${state ? `?state=${state}` : ""}`),
  getPayment: (id: string) => request<Payment>("GET", `/payments/${id}`),
  getFinancialAdjustments: (paymentId: string) =>
    request<{ items: FinancialAdjustment[]; compensatedCents: number; remainingCents: number }>(
      "GET",
      `/payments/${paymentId}/adjustments`,
    ),
  adjustPayment: (paymentId: string, input: RegisterFinancialAdjustmentRequest) =>
    request<FinancialAdjustment>("POST", `/payments/${paymentId}/adjustments`, input),
  validatePayment: (id: string) => request<Payment>("POST", `/payments/${id}/validate`),
  rejectPayment: (id: string, reason: string) =>
    request<Payment>("POST", `/payments/${id}/reject`, { reason }),

  listCashSessions: () => request<CashSession[]>("GET", "/cash/sessions"),
  openCashSession: (openingCents: number) =>
    request<CashSession>("POST", "/cash/sessions", { openingCents }),
  currentCashSession: () => request<CashSession | null>("GET", "/cash/sessions/current"),
  closeCashSession: (id: string, declaredClosingCents: number) =>
    request<CashSession>("POST", `/cash/sessions/${id}/close`, { declaredClosingCents }),
  getCashSession: (id: string) =>
    request<{
      session: CashSession;
      movements: CashMovement[];
      adjustments?: FinancialAdjustment[];
    }>("GET", `/cash/sessions/${id}`),
  consolidation: (date?: string) =>
    request<Consolidation>("GET", `/cash/consolidation${date ? `?date=${date}` : ""}`),

  // --- Entrega 3: classes, sessions, bookings (spec 004) ----------------------
  listClassTemplates: () => request<ClassTemplate[]>("GET", "/class-templates"),
  createClassTemplate: (input: CreateClassTemplateInput) =>
    request<ClassTemplate>("POST", "/class-templates", input),

  listSessions: (from?: string, to?: string) =>
    request<Session[]>(
      "GET",
      `/sessions${from || to ? `?${from ? `from=${from}` : ""}${to ? `${from ? "&" : ""}to=${to}` : ""}` : ""}`,
    ),
  getSession: (id: string) => request<Session>("GET", `/sessions/${id}`),
  createSession: (input: CreateSessionInput) => request<Session>("POST", "/sessions", input),
  cancelSession: (id: string) => request<Session>("POST", `/sessions/${id}/cancel`),
  rescheduleSession: (
    id: string,
    input: { startsAt: string; endsAt: string; reason?: string },
  ) => request<Session>("POST", `/sessions/${id}/reschedule`, input),


  agenda: (instructorId: string, from?: string, to?: string) =>
    request<Session[]>(
      "GET",
      `/agenda?instructorId=${instructorId}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`,
    ),

  createBooking: (input: { sessionId: string; memberId?: string }) =>
    request<Booking>("POST", "/bookings", input),
  myBookings: () => request<Booking[]>("GET", "/bookings/mine"),
  listBookings: (sessionId: string) =>
    request<Booking[]>("GET", `/bookings?sessionId=${sessionId}`),
  cancelBooking: (id: string, input: { type: CancellationType; reason?: string }) =>
    request<{ booking: Booking; cancellation: BookingCancellation }>(
      "POST",
      `/bookings/${id}/cancel`,
      input,
    ),
  markAttendance: (id: string, outcome: "asistio" | "ausencia") =>
    request<Booking>("POST", `/bookings/${id}/attendance`, { outcome }),

  // --- Entrega 5: QR de ingreso y check-in supervisado (spec 007) ----------
  /** Supervised check-in: reception scans a member's QR. Coverage denial is
   *  a business decision (200 + allowed:false), never a transport error. */
  checkin: (qrToken: string) => request<CheckinResult>("POST", "/checkin", { qrToken }),
  /** The socio's own QR token (REQ-7): only ever their own. */
  myQr: () => request<{ qrToken: string }>("GET", "/me/qr"),
  /** Live feed of the organization's recent check-ins (mostrador view). */
  recentCheckins: (limit = 50) =>
    request<CheckinFeedEntry[]>("GET", `/checkins/recent?limit=${limit}&today=true`),
};

export interface Instructor {
  id: string;
  name: string;
}
export interface Staff extends Instructor {
  email: string;
  role: "admin" | "recepcion" | "instructor";
}
export interface ScheduledSession extends Session {
  title: string;
  instructorName: string;
  booked: number;
  remaining: number;
}
export interface CreditPeriod {
  id: string;
  startsAt: string;
  endsAt: string;
  coverage: "none" | "unlimited" | "limited";
  planName: string;
  credits: Record<
    "grupal" | "fija" | "cita",
    { quota: number | null; committed: number; available: number | null }
  >;
  reviewCount: number;
  reviewBookingIds: string[];
}
export interface PortalOverview {
  creditPeriods?: CreditPeriod[];
  member: Member;
  memberships: (Membership & { plan: Plan })[];
}
export interface MemberOverview extends PortalOverview {
  payments: Payment[];
}
export interface AccountSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}
export interface SupportGrant {
  id: string;
  organizationId: string;
  grantedByAccountId: string;
  supportEmail: string;
  reason: string;
  scope: "diagnostic" | "read_only";
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedByAccountId: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}
export interface CreateSupportGrantInput {
  supportEmail: string;
  reason: string;
  durationMinutes: number;
  scope?: "diagnostic" | "read_only";
}
export interface Device {
  id: string;
  accountId: string;
  label: string;
  state: "habilitado" | "revocado";
  createdAt: string;
}
export interface OfflineMember {
  id: string;
  name: string;
  qrToken: string | null;
  membershipId: string | null;
  coverage: "none" | "unlimited" | "limited";
  endAt: string | null;
  price: number;
  proof: string;
}
export type OfflineLease = OfflineLeaseResponse;

export interface OfflineEvent {
  eventId: string;
  type: "cobro_provisional" | "ingreso_contingencia" | "excepcion";
  folioExterno: string;
  memberId?: string;
  capturedAt: string;
  amountCents?: number;
  method?: "cash" | "transfer" | "transbank";
  payload: string;
}
export interface SyncResult {
  eventId: string;
  status: "sincronizado" | "duplicado" | "rechazado";
  reason?: string;
  paymentId?: string;
}
export interface ServerOfflineEvent {
  id: string;
  deviceId: string;
  eventId: string;
  folioExterno: string;
  type: string;
  state: string;
  rejectReason: string | null;
  createdAt: string;
}

export interface DailyReport {
  date: string;
  timeZone: string;
  cash: number;
  transfer: number;
  transbank?: number;
  income: number;
  refunds?: number;
  adjustments?: number;
  outflow?: number;
  net?: number;
  movements: number;
  shifts: CashSession[];
  partialCyclesPendingCents?: number;
  partialCyclesCount?: number;
}
