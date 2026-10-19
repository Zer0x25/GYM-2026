import { describe, beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QuickPay } from "./components/QuickPay.js";
import { MemberDetail } from "./pages/MemberDetail.js";
import { Cash } from "./pages/Cash.js";
import { Reports } from "./pages/Reports.js";
import { api } from "./api.js";

vi.mock("./session.js", () => ({
  useSession: () => ({ session: { role: "admin", user: { id: "admin-1" } } }),
}));

vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: {
    listPlans: vi.fn(),
    listMembers: vi.fn(),
    registerPayment: vi.fn(),
    memberOverview: vi.fn(),
    currentCashSession: vi.fn(),
    getCashSession: vi.fn(),
    openCashSession: vi.fn(),
    closeCashSession: vi.fn(),
    dailyReport: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("SPEC 019 CA-5 — UI de abonos parciales y estados de conciliación", () => {
  it("QuickPay.tsx muestra progreso de abono (pagado / pendiente) y permite registrar abonos", async () => {
    const memberships = [
      {
        id: "m1",
        organizationId: "org-1",
        memberId: "mem-1",
        planId: "p1",
        startAt: null,
        endAt: null,
        lastPaymentId: null,
        createdAt: "2026-10-19T10:00:00.000Z",
        state: "pending_payment" as const,
        cycleTargetCents: 30000,
        cyclePaidCents: 10000,
        cycleRemainingCents: 20000,
      },
    ];
    const plans = [
      {
        id: "p1",
        organizationId: "org-1",
        name: "Plan 8 Clases",
        priceCents: 30000,
        durationDays: 30,
        coverage: "limited" as const,
        active: true,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ];

    render(
      <QuickPay
        open={true}
        onOpenChange={() => {}}
        memberName="Juan Pérez"
        memberships={memberships}
        plans={plans}
        onDone={() => {}}
      />,
    );

    // Debe mostrar progreso pagado / pendiente en la selección de membresía
    expect(await screen.findByText(/Plan 8 Clases/i)).toBeTruthy();
    expect(screen.getByText(/10\.000 pagado \/ \$20\.000 pendiente/i)).toBeTruthy();

    // Seleccionar la membresía
    fireEvent.click(screen.getByText(/Plan 8 Clases/i));

    // El monto por defecto debe ser el saldo pendiente ($20.000)
    const amountInput = screen.getByLabelText(/Monto \(CLP\)/i) as HTMLInputElement;
    expect(amountInput.value).toBe("20000");

    // Permite ajustar el monto a un abono parcial menor (ej. $10.000)
    fireEvent.change(amountInput, { target: { value: "10000" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar pago/i }));

    await waitFor(() =>
      expect(api.registerPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          membershipId: "m1",
          amountCents: 10000,
        }),
      ),
    );
  });

  it("MemberDetail.tsx muestra en Membresías y cobertura el progreso del abono (pagado / pendiente)", async () => {
    vi.mocked(api.memberOverview).mockResolvedValue({
      member: {
        id: "mem-1",
        organizationId: "org-1",
        fullName: "Juan Pérez",
        contactEmail: "juan@example.test",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      memberships: [
        {
          id: "m1",
          organizationId: "org-1",
          memberId: "mem-1",
          planId: "p1",
          plan: {
            id: "p1",
            organizationId: "org-1",
            name: "Plan Mensual",
            priceCents: 30000,
            durationDays: 30,
            coverage: "unlimited" as const,
            active: true,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
          startAt: null,
          endAt: null,
          lastPaymentId: null,
          createdAt: "2026-10-19T10:00:00.000Z",
          state: "pending_payment" as const,
          cycleTargetCents: 30000,
          cyclePaidCents: 10000,
          cycleRemainingCents: 20000,
          pauses: [],
          activePause: null,
        },
      ],
      payments: [],
      creditPeriods: [],
    });
    vi.mocked(api.listPlans).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={["/members/mem-1"]}>
        <MemberDetail />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Juan Pérez")).toBeTruthy();
    expect(screen.getByText(/10\.000 pagado \/ \$20\.000 pendiente/i)).toBeTruthy();
  });

  it("Cash.tsx muestra la etiqueta de conciliación en el último cierre (Cuadrada / Con diferencia)", async () => {
    vi.mocked(api.currentCashSession).mockResolvedValue(null);

    render(<Cash />);

    // Abrir turno
    fireEvent.click(await screen.findByRole("button", { name: /Abrir turno/i }));
    const amountInput = screen.getByLabelText(/Monto de apertura/i);
    fireEvent.change(amountInput, { target: { value: "10000" } });
    vi.mocked(api.openCashSession).mockResolvedValue({
      id: "cs-1",
      organizationId: "org-1",
      openedBy: "admin-1",
      closedBy: null,
      state: "open",
      reconciliationState: "abierta",
      openingCents: 10000,
      declaredClosingCents: null,
      expectedClosingCents: null,
      discrepancyCents: null,
      openedAt: "2026-10-19T10:00:00.000Z",
      closedAt: null,
    });

    // Simular que ahora hay turno abierto y lo cerramos cuadrado
    vi.mocked(api.currentCashSession).mockResolvedValue({
      id: "cs-1",
      organizationId: "org-1",
      openedBy: "admin-1",
      closedBy: null,
      state: "open",
      reconciliationState: "abierta",
      openingCents: 10000,
      declaredClosingCents: null,
      expectedClosingCents: null,
      discrepancyCents: null,
      openedAt: "2026-10-19T10:00:00.000Z",
      closedAt: null,
    });
    vi.mocked(api.getCashSession).mockResolvedValue({
      session: {
        id: "cs-1",
        organizationId: "org-1",
        openedBy: "admin-1",
        closedBy: null,
        state: "open",
        reconciliationState: "abierta",
        openingCents: 10000,
        declaredClosingCents: null,
        expectedClosingCents: null,
        discrepancyCents: null,
        openedAt: "2026-10-19T10:00:00.000Z",
        closedAt: null,
      },
      movements: [],
      adjustments: [],
    });
    vi.mocked(api.closeCashSession).mockResolvedValue({
      id: "cs-1",
      organizationId: "org-1",
      openedBy: "admin-1",
      closedBy: "admin-1",
      state: "closed",
      reconciliationState: "cuadrada",
      openingCents: 10000,
      declaredClosingCents: 10000,
      expectedClosingCents: 10000,
      discrepancyCents: 0,
      openedAt: "2026-10-19T10:00:00.000Z",
      closedAt: "2026-10-19T18:00:00.000Z",
    });

    fireEvent.click(screen.getByRole("button", { name: /^Abrir turno$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(await screen.findByRole("button", { name: /Cerrar turno/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Cerrar turno/i }));

    const closeInput = screen.getByLabelText(/Monto declarado al cierre/i);
    fireEvent.change(closeInput, { target: { value: "10000" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirmar cierre/i }));

    // Debe mostrar la etiqueta Cuadrada
    expect(await screen.findByText(/Cuadrada/i)).toBeTruthy();
  });

  it("Reports.tsx muestra conciliación explícita (Cuadrada / Con diferencia) y resumen de ciclos en abono", async () => {
    vi.mocked(api.dailyReport).mockResolvedValue({
      date: "2026-10-19",
      timeZone: "America/Santiago",
      cash: 10000,
      transfer: 0,
      transbank: 0,
      income: 10000,
      refunds: 0,
      adjustments: 0,
      outflow: 0,
      net: 10000,
      movements: 1,
      partialCyclesPendingCents: 20000,
      partialCyclesCount: 1,
      shifts: [
        {
          id: "cs-1",
          organizationId: "org-1",
          openedBy: "usr-1",
          closedBy: "usr-2",
          state: "closed",
          reconciliationState: "cuadrada",
          openingCents: 10000,
          declaredClosingCents: 20000,
          expectedClosingCents: 20000,
          discrepancyCents: 0,
          openedAt: "2026-10-19T10:00:00.000Z",
          closedAt: "2026-10-19T18:00:00.000Z",
        },
      ],
    });

    render(<Reports />);

    expect(await screen.findByText(/Ciclos en abono/i)).toBeTruthy();
    expect(screen.getAllByText(/\$20\.000/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Cuadrada/i)).toBeTruthy();
  });
});
