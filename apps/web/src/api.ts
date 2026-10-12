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
};
