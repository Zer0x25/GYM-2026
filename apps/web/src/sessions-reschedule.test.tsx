import { describe, beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SessionDetail } from "./pages/SessionDetail.js";
import { Classes } from "./pages/Classes.js";
import { Portal } from "./pages/Portal.js";
import { api } from "./api.js";

const mockSession = { role: "admin", user: { id: "user-admin-1" } };

vi.mock("./session.js", () => ({
  useSession: () => ({ session: mockSession }),
}));

vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: {
    getSession: vi.fn(),
    roster: vi.fn(),
    listMembers: vi.fn(),
    schedule: vi.fn(),
    listClassTemplates: vi.fn(),
    instructors: vi.fn(),
    rescheduleSession: vi.fn(),
    cancelSession: vi.fn(),
    createBooking: vi.fn(),
    portalOverview: vi.fn(),
    myBookings: vi.fn(),
    myQr: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.role = "admin";
  mockSession.user = { id: "user-admin-1" };
  vi.mocked(api.getSession).mockResolvedValue({
    id: "session-1",
    organizationId: "org-1",
    templateId: null,
    type: "cita",
    instructorId: "inst-1",
    startsAt: "2026-11-01T10:00:00.000Z",
    endsAt: "2026-11-01T11:00:00.000Z",
    capacity: 1,
    state: "programada",
    createdBy: "admin-1",
    createdAt: "2026-10-01T00:00:00.000Z",
    rescheduledCount: 0,
    rescheduledAt: null,
    rescheduledFromStartsAt: null,
  } as never);
  vi.mocked(api.roster).mockResolvedValue([]);
  vi.mocked(api.listMembers).mockResolvedValue([]);
  vi.mocked(api.schedule).mockResolvedValue([
    {
      id: "session-1",
      organizationId: "org-1",
      templateId: null,
      type: "cita",
      instructorId: "inst-1",
      startsAt: "2026-11-01T10:00:00.000Z",
      endsAt: "2026-11-01T11:00:00.000Z",
      capacity: 1,
      state: "programada",
      createdBy: "admin-1",
      createdAt: "2026-10-01T00:00:00.000Z",
      title: "Cita personalizada",
      instructorName: "Carlos Instructor",
      booked: 1,
      remaining: 0,
      rescheduledCount: 1,
      rescheduledAt: "2026-10-20T10:00:00.000Z",
      rescheduledFromStartsAt: "2026-10-31T10:00:00.000Z",
    } as never,
  ]);
  vi.mocked(api.listClassTemplates).mockResolvedValue([]);
  vi.mocked(api.instructors).mockResolvedValue([{ id: "inst-1", name: "Carlos Instructor" }]);
  vi.mocked(api.rescheduleSession).mockResolvedValue({ id: "session-1" } as never);
  vi.mocked(api.portalOverview).mockResolvedValue({
    member: { id: "m-1", fullName: "Socio Portal", contactEmail: "socio@gym.test" },
    memberships: [],
    creditPeriods: [],
  } as never);
  vi.mocked(api.myBookings).mockResolvedValue([
    {
      id: "b-1",
      organizationId: "org-1",
      sessionId: "session-1",
      memberId: "m-1",
      state: "confirmada",
      beneficioComprometido: true,
      createdBy: "m-1",
      createdAt: "2026-10-01T00:00:00.000Z",
    } as never,
  ]);
  vi.mocked(api.myQr).mockResolvedValue({ qrToken: "qr-123" } as never);
});

afterEach(cleanup);

describe("SPEC 018 CA-5 — Reprogramación de agenda y citas en UI", () => {
  it("SessionDetail.tsx permite reprogramar sesión y envía startsAt, endsAt y reason a api.rescheduleSession", async () => {
    render(
      <MemoryRouter initialEntries={["/clases/session-1"]}>
        <Routes>
          <Route path="/clases/:id" element={<SessionDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Detalle de sesión|Cita personalizada/)).toBeTruthy();

    const rescheduleBtn = await screen.findByRole("button", { name: /reprogramar/i });
    fireEvent.click(rescheduleBtn);

    const startInput = await screen.findByLabelText(/nuevo inicio/i);
    const endInput = screen.getByLabelText(/nuevo fin/i);
    const reasonInput = screen.getByLabelText(/motivo/i);

    fireEvent.change(startInput, { target: { value: "2026-11-05T14:00" } });
    fireEvent.change(endInput, { target: { value: "2026-11-05T15:00" } });
    fireEvent.change(reasonInput, { target: { value: "Solicitud del instructor" } });

    const submitBtn = screen.getByRole("button", { name: /confirmar reprogramaci[oó]n/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.rescheduleSession).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({
          startsAt: expect.any(String),
          endsAt: expect.any(String),
          reason: "Solicitud del instructor",
        }),
      );
    });
  });

  it("SessionDetail.tsx muestra indicador de reprogramación cuando rescheduledCount > 0", async () => {
    vi.mocked(api.getSession).mockResolvedValueOnce({
      id: "session-1",
      organizationId: "org-1",
      templateId: null,
      type: "cita",
      instructorId: "inst-1",
      startsAt: "2026-11-01T10:00:00.000Z",
      endsAt: "2026-11-01T11:00:00.000Z",
      capacity: 1,
      state: "programada",
      createdBy: "admin-1",
      createdAt: "2026-10-01T00:00:00.000Z",
      rescheduledCount: 1,
      rescheduledAt: "2026-10-20T10:00:00.000Z",
      rescheduledFromStartsAt: "2026-10-31T10:00:00.000Z",
    } as never);

    render(
      <MemoryRouter initialEntries={["/clases/session-1"]}>
        <Routes>
          <Route path="/clases/:id" element={<SessionDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/horario reprogramado|reprogramada/i)).toBeTruthy();
  });

  it("Classes.tsx muestra indicador de horario reprogramado en la agenda", async () => {
    render(
      <MemoryRouter>
        <Classes />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/horario reprogramado|reprogramada/i)).toBeTruthy();
  });

  it("Portal.tsx muestra indicador de reprogramación en las clases reservadas del socio", async () => {
    mockSession.role = "socio";
    render(
      <MemoryRouter>
        <Portal />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/horario reprogramado|reprogramada/i)).toBeTruthy();
  });
});
