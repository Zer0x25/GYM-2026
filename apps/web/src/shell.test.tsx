/**
 * Smoke test: the whole shell mounts without runtime errors (regression
 * guard for the ADR-0003 UI). Renders the App with a mocked API session and
 * exercises the money pages (Panel, Payments, Cash) at the component level
 * — so a runtime crash in any reception page fails here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App.js";
import * as apiModule from "./api.js";

const adminSession = {
  user: { id: "admin-1", email: "admin@pilot.cl", name: "Admin" },
  organization: { id: "org-1", name: "Gimnasio Piloto" },
  role: "admin" as const,
};

const mockApi = {
  session: vi.fn().mockResolvedValue(adminSession),
  signIn: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  listMembers: vi.fn().mockResolvedValue([
    { id: "m1", organizationId: "org-1", fullName: "Socio Uno", contactEmail: "s1@x.cl", createdAt: "2026-10-01T00:00:00Z" },
  ]),
  listMemberships: vi.fn().mockResolvedValue([
    { id: "mem1", organizationId: "org-1", memberId: "m1", planId: "p1", startAt: "2026-10-01", endAt: "2026-11-01", lastPaymentId: null, createdAt: "2026-10-01", state: "active" },
  ]),
  listPlans: vi.fn().mockResolvedValue([
    { id: "p1", organizationId: "org-1", name: "Mensual", priceCents: 30000, durationDays: 30, coverage: "unlimited", active: true, createdAt: "2026-10-01" },
  ]),
  listPayments: vi.fn().mockResolvedValue([
    { id: "pay1", organizationId: "org-1", memberId: "m1", membershipId: "mem1", planId: "p1", amountCents: 30000, method: "transfer", reference: "TRX-1", state: "provisional", registeredBy: "admin-1", decidedBy: null, decidedAt: null, reason: null, createdAt: "2026-10-12" },
  ]),
  currentCashSession: vi.fn().mockResolvedValue({
    id: "s1", organizationId: "org-1", openedBy: "admin-1", closedBy: null, state: "open", openingCents: 20000, declaredClosingCents: null, expectedClosingCents: null, discrepancyCents: null, openedAt: "2026-10-12", closedAt: null,
  }),
  getCashSession: vi.fn().mockResolvedValue({
    session: { id: "s1", organizationId: "org-1", openedBy: "admin-1", closedBy: null, state: "open", openingCents: 20000, openedAt: "2026-10-12", closedAt: null },
    movements: [],
  }),
  validatePayment: vi.fn().mockResolvedValue({}),
  rejectPayment: vi.fn().mockResolvedValue({}),
  registerPayment: vi.fn().mockResolvedValue({}),
  myMemberships: vi.fn().mockResolvedValue([]),
  me: vi.fn().mockResolvedValue({ id: "m1", organizationId: "org-1", fullName: "Socio Uno", contactEmail: null, createdAt: "2026-10-01" }),

  // Entrega 3: classes, sessions, bookings
  listClassTemplates: vi.fn().mockResolvedValue([
    { id: "t1", organizationId: "org-1", name: "Spinning", type: "grupal", capacity: 4, reservationWindowHours: 0, cancellationWindowHours: 24, coverageRequired: "unlimited", active: true, createdAt: "2026-10-01" },
  ]),
  createClassTemplate: vi.fn().mockResolvedValue({}),
  listSessions: vi.fn().mockResolvedValue([
    { id: "sess1", organizationId: "org-1", templateId: "t1", type: "grupal", instructorId: "inst-1", startsAt: "2026-10-13T13:00:00Z", endsAt: "2026-10-13T14:00:00Z", capacity: 4, state: "programada", createdBy: "admin-1", createdAt: "2026-10-12" },
  ]),
  getSession: vi.fn().mockResolvedValue({
    id: "sess1", organizationId: "org-1", templateId: "t1", type: "grupal", instructorId: "inst-1", startsAt: "2026-10-13T13:00:00Z", endsAt: "2026-10-13T14:00:00Z", capacity: 4, state: "programada", createdBy: "admin-1", createdAt: "2026-10-12",
  }),
  listBookings: vi.fn().mockResolvedValue([]),
  createBooking: vi.fn().mockResolvedValue({ id: "b1", state: "confirmada" }),
  cancelBooking: vi.fn().mockResolvedValue({ booking: { id: "b1", state: "cancelada" }, cancellation: { creditReturned: true } }),
  markAttendance: vi.fn().mockResolvedValue({ id: "b1", state: "confirmada" }),
  myBookings: vi.fn().mockResolvedValue([]),
  createSession: vi.fn().mockResolvedValue({}),
  cancelSession: vi.fn().mockResolvedValue({}),
  agenda: vi.fn().mockResolvedValue([]),
};

vi.spyOn(apiModule, "api", "get").mockReturnValue(mockApi as unknown as typeof apiModule.api);

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

describe("UI smoke (ADR-0003 shell + money pages)", () => {
  it("renders the shell with sidebar + cash badge at /panel", async () => {
    renderAppAt("/panel");
    await waitFor(() => expect(screen.getByText("Gimnasio Piloto")).toBeTruthy());
    // sidebar links present (some titles repeat the label — use getAllByText)
    expect(screen.getAllByText("Socios").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pagos").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Caja").length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(/Caja abierta/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Socio Uno")).toBeTruthy());
    expect(screen.getByText("Activa")).toBeTruthy();
  });

  it("renders the payments validation tray at /payments", async () => {
    renderAppAt("/payments");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Pagos" })).toBeTruthy());
    expect(await screen.findByRole("button", { name: /Validar/ })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Rechazar/ })).toBeTruthy();
  });

  it("renders the cash page at /cash", async () => {
    renderAppAt("/cash");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Caja" })).toBeTruthy());
    expect(screen.getByText("Abierto")).toBeTruthy();
  });

  it("validating a payment calls the API (admin authority)", async () => {
    renderAppAt("/payments");
    const validar = await screen.findByRole("button", { name: /Validar/ });
    validar.click();
    await waitFor(() => expect(mockApi.validatePayment).toHaveBeenCalledWith("pay1"));
  });

  it("renders the classes page (staff) with a new-session form and the roster", async () => {
    renderAppAt("/clases");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Clases y agenda" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Crear sesión" })).toBeTruthy();
    expect(await screen.findByText("inst-1")).toBeTruthy();
  });

  it("socio reserves a bookable session from the portal (booking flow)", async () => {
    const socioSession = { ...adminSession, role: "socio" as const };
    mockApi.session.mockResolvedValueOnce(socioSession);
    renderAppAt("/portal");
    const reservar = await screen.findByRole("button", { name: "Reservar" });
    reservar.click();
    await waitFor(() => expect(mockApi.createBooking).toHaveBeenCalledWith({ sessionId: "sess1" }));
  });
});
