import { describe, beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Plans } from "./pages/Plans.js";
import { MemberDetail } from "./pages/MemberDetail.js";
import { Portal } from "./pages/Portal.js";
import { api } from "./api.js";

vi.mock("./session.js", () => ({
  useSession: () => ({ session: { role: "admin" } }),
}));

vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: {
    listPlans: vi.fn(),
    createPlan: vi.fn(),
    updatePlan: vi.fn(),
    memberOverview: vi.fn(),
    schedulePlanChange: vi.fn(),
    createMembershipPause: vi.fn(),
    portalOverview: vi.fn(),
    schedule: vi.fn(),
    myBookings: vi.fn(),
    myQr: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listPlans).mockResolvedValue([]);
  vi.mocked(api.createPlan).mockResolvedValue({ id: "p1" } as never);
  vi.mocked(api.updatePlan).mockResolvedValue({ id: "p1" } as never);
  vi.mocked(api.schedulePlanChange).mockResolvedValue({ id: "m1" } as never);
  vi.mocked(api.createMembershipPause).mockResolvedValue({ id: "pause-1" } as never);
  vi.mocked(api.schedule).mockResolvedValue([]);
  vi.mocked(api.myBookings).mockResolvedValue([]);
  vi.mocked(api.myQr).mockResolvedValue({ qrToken: "test-token" } as never);
});

afterEach(cleanup);

describe("SPEC 017 CA-5 — Ciclo de membresías en UI", () => {
  it("Plans.tsx permite editar y archivar/desactivar un plan existente", async () => {
    vi.mocked(api.listPlans).mockResolvedValue([
      {
        id: "plan-1",
        organizationId: "org-1",
        name: "Plan Mensual",
        priceCents: 35000,
        durationDays: 30,
        coverage: "unlimited",
        active: true,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);

    render(<Plans />);
    expect(await screen.findByText("Plan Mensual")).toBeTruthy();

    // Debe existir botón para editar plan
    const editBtn = await screen.findByRole("button", { name: /editar/i });
    fireEvent.click(editBtn);

    // Modificar precio
    const priceInput = screen.getByLabelText(/precio/i) as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "40000" } });

    // Guardar cambios
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() =>
      expect(api.updatePlan).toHaveBeenCalledWith(
        "plan-1",
        expect.objectContaining({
          priceCents: 40000,
        }),
      ),
    );
  });

  it("MemberDetail.tsx permite pausar membresía con motivo y programar cambio de plan", async () => {
    vi.mocked(api.listPlans).mockResolvedValue([
      {
        id: "plan-1",
        organizationId: "org-1",
        name: "Plan Actual",
        priceCents: 30000,
        durationDays: 30,
        coverage: "unlimited",
        active: true,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "plan-2",
        organizationId: "org-1",
        name: "Plan Siguiente",
        priceCents: 45000,
        durationDays: 30,
        coverage: "unlimited",
        active: true,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);

    vi.mocked(api.memberOverview).mockResolvedValue({
      member: {
        id: "member-1",
        organizationId: "org-1",
        fullName: "Socio Prueba",
        contactEmail: "socio@prueba.cl",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      memberships: [
        {
          id: "m-1",
          organizationId: "org-1",
          memberId: "member-1",
          planId: "plan-1",
          startAt: "2026-10-01T00:00:00.000Z",
          endAt: "2026-10-31T00:00:00.000Z",
          lastPaymentId: "p-1",
          createdAt: "2026-10-01T00:00:00.000Z",
          state: "active",
          plan: {
            id: "plan-1",
            organizationId: "org-1",
            name: "Plan Actual",
            priceCents: 30000,
            durationDays: 30,
            coverage: "unlimited",
            active: true,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        },
      ],
      payments: [],
      creditPeriods: [],
    } as never);

    render(
      <MemoryRouter>
        <MemberDetail />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Socio Prueba")).toBeTruthy();

    // Debe existir acción para pausar membresía
    const pauseBtn = await screen.findByRole("button", { name: /pausar/i });
    fireEvent.click(pauseBtn);

    // Llenar formulario de pausa
    fireEvent.change(screen.getByLabelText(/motivo/i), {
      target: { value: "Reposo médico por 7 días" },
    });
    fireEvent.change(screen.getByLabelText(/inicio/i), {
      target: { value: "2026-10-15T00:00" },
    });
    fireEvent.change(screen.getByLabelText(/fin/i), {
      target: { value: "2026-10-22T00:00" },
    });

    fireEvent.click(screen.getByRole("button", { name: /confirmar pausa|registrar pausa/i }));
    await waitFor(() =>
      expect(api.createMembershipPause).toHaveBeenCalledWith(
        "m-1",
        expect.objectContaining({
          reason: "Reposo médico por 7 días",
        }),
      ),
    );

    // Debe existir acción para programar cambio de plan
    const scheduleBtn = await screen.findByRole("button", { name: /programar cambio|cambiar plan/i });
    fireEvent.click(scheduleBtn);

    const selectPlan = screen.getByLabelText(/siguiente plan|nuevo plan/i) as HTMLSelectElement;
    fireEvent.change(selectPlan, { target: { value: "plan-2" } });

    fireEvent.click(screen.getByRole("button", { name: /guardar cambio|confirmar cambio/i }));
    await waitFor(() =>
      expect(api.schedulePlanChange).toHaveBeenCalledWith(
        "m-1",
        expect.objectContaining({
          nextPlanId: "plan-2",
        }),
      ),
    );
  });

  it("Portal.tsx muestra pausa activa y cambio de plan programado para próxima renovación", async () => {
    vi.mocked(api.portalOverview).mockResolvedValue({
      member: {
        id: "member-1",
        organizationId: "org-1",
        fullName: "Socio Portal",
        contactEmail: "portal@socio.cl",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      memberships: [
        {
          id: "m-1",
          organizationId: "org-1",
          memberId: "member-1",
          planId: "plan-1",
          nextPlanId: "plan-2",
          nextPlan: { id: "plan-2", name: "Plan Pro Anual" },
          startAt: "2026-10-01T00:00:00.000Z",
          endAt: "2026-11-05T00:00:00.000Z",
          lastPaymentId: "p-1",
          createdAt: "2026-10-01T00:00:00.000Z",
          state: "active",
          activePause: {
            id: "p-1",
            startsAt: "2026-10-10T00:00:00.000Z",
            endsAt: "2026-10-15T00:00:00.000Z",
            reason: "Viaje de trabajo",
            extendedDays: 5,
          },
          plan: {
            id: "plan-1",
            organizationId: "org-1",
            name: "Plan Básico",
            priceCents: 20000,
            durationDays: 30,
            coverage: "unlimited",
            active: true,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        },
      ],
      creditPeriods: [],
    } as never);

    render(<Portal />);
    expect(await screen.findByText("Mi membresía")).toBeTruthy();

    // Muestra alerta de pausa activa
    expect(await screen.findByText(/pausada|pausa activa/i)).toBeTruthy();
    expect(screen.getByText(/Viaje de trabajo/)).toBeTruthy();

    // Muestra cambio de plan programado
    expect(await screen.findByText(/Plan Pro Anual/)).toBeTruthy();
  });
});
