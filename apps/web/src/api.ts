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
    const err = payload.error ?? { code: "HTTP_ERROR", message: `HTTP ${res.status}` };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }
  return payload.data as T;
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
  active: boolean;
  createdAt: string;
}

export interface Membership {
  id: string;
  organizationId: string;
  memberId: string;
  planId: string;
  startAt: string | null;
  endAt: string | null;
  lastPaymentId: string | null;
  createdAt: string;
  /** Derived state, computed by the backend on every read. */
  state?: "pending_payment" | "active" | "expired";
}

export type PaymentState = "provisional" | "validated" | "rejected";

export interface Payment {
  id: string;
  organizationId: string;
  memberId: string;
  membershipId: string;
  planId: string;
  amountCents: number;
  method: "cash" | "transfer";
  reference: string | null;
  state: PaymentState;
  registeredBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  createdAt: string;
}

export interface CashSession {
  id: string;
  organizationId: string;
  openedBy: string;
  closedBy: string | null;
  state: "open" | "closed";
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
  method: "cash" | "transfer";
  amountCents: number;
  createdAt: string;
}

export interface Consolidation {
  sessionId: string;
  date: string;
  openingCents: number;
  totalCents: number;
  byMethod: { cash: number; transfer: number };
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

export const api = {
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
    }).then(() => undefined),
  listMembers: (q?: string) =>
    request<Member[]>("GET", `/members${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  createMember: (input: { fullName: string; contactEmail?: string | null }) =>
    request<Member>("POST", "/members", input),
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
  }) => request<Plan>("POST", "/plans", input),

  listMemberships: () => request<Membership[]>("GET", "/memberships"),
  getMembership: (id: string) => request<Membership>("GET", `/memberships/${id}`),
  createMembership: (input: { memberId: string; planId: string }) =>
    request<Membership>("POST", "/memberships", input),
  myMemberships: () => request<Membership[]>("GET", "/memberships/mine"),

  registerPayment: (input: {
    membershipId: string;
    amountCents: number;
    method: "cash" | "transfer";
    reference?: string;
  }) => request<Payment>("POST", "/payments", input),
  listPayments: (state?: PaymentState) =>
    request<Payment[]>("GET", `/payments${state ? `?state=${state}` : ""}`),
  getPayment: (id: string) => request<Payment>("GET", `/payments/${id}`),
  validatePayment: (id: string) => request<Payment>("POST", `/payments/${id}/validate`),
  rejectPayment: (id: string, reason: string) =>
    request<Payment>("POST", `/payments/${id}/reject`, { reason }),

  openCashSession: (openingCents: number) =>
    request<CashSession>("POST", "/cash/sessions", { openingCents }),
  currentCashSession: () => request<CashSession | null>("GET", "/cash/sessions/current"),
  closeCashSession: (id: string, declaredClosingCents: number) =>
    request<CashSession>("POST", `/cash/sessions/${id}/close`, { declaredClosingCents }),
  getCashSession: (id: string) =>
    request<{ session: CashSession; movements: CashMovement[] }>("GET", `/cash/sessions/${id}`),
  consolidation: (date?: string) =>
    request<Consolidation>("GET", `/cash/consolidation${date ? `?date=${date}` : ""}`),

  // --- Entrega 3: classes, sessions, bookings (spec 004) ----------------------
  listClassTemplates: () => request<ClassTemplate[]>("GET", "/class-templates"),
  createClassTemplate: (input: CreateClassTemplateInput) =>
    request<ClassTemplate>("POST", "/class-templates", input),

  listSessions: (from?: string, to?: string) =>
    request<Session[]>("GET", `/sessions${from || to ? `?${from ? `from=${from}` : ""}${to ? `${from ? "&" : ""}to=${to}` : ""}` : ""}`),
  getSession: (id: string) => request<Session>("GET", `/sessions/${id}`),
  createSession: (input: CreateSessionInput) => request<Session>("POST", "/sessions", input),
  cancelSession: (id: string) => request<Session>("POST", `/sessions/${id}/cancel`),

  agenda: (instructorId: string, from?: string, to?: string) =>
    request<Session[]>("GET", `/agenda?instructorId=${instructorId}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`),

  createBooking: (input: { sessionId: string; memberId?: string }) =>
    request<Booking>("POST", "/bookings", input),
  myBookings: () => request<Booking[]>("GET", "/bookings/mine"),
  listBookings: (sessionId: string) => request<Booking[]>("GET", `/bookings?sessionId=${sessionId}`),
  cancelBooking: (id: string, input: { type: CancellationType; reason?: string }) =>
    request<{ booking: Booking; cancellation: BookingCancellation }>("POST", `/bookings/${id}/cancel`, input),
  markAttendance: (id: string, outcome: "asistio" | "ausencia") =>
    request<Booking>("POST", `/bookings/${id}/attendance`, { outcome }),

  // --- Entrega 5: QR de ingreso y check-in supervisado (spec 007) ----------
  /** Supervised check-in: reception scans a member's QR. Coverage denial is
   *  a business decision (200 + allowed:false), never a transport error. */
  checkin: (qrToken: string) =>
    request<CheckinResult>("POST", "/checkin", { qrToken }),
  /** The socio's own QR token (REQ-7): only ever their own. */
  myQr: () => request<{ qrToken: string }>("GET", "/me/qr"),
  /** Live feed of the organization's recent check-ins (mostrador view). */
  recentCheckins: (limit = 50) =>
    request<CheckinFeedEntry[]>("GET", `/checkins/recent?limit=${limit}`),
};
