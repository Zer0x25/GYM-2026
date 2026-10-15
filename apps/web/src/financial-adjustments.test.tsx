import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Payments } from "./pages/Payments.js";
import { api, type Payment } from "./api.js";
import { useSession } from "./session.js";
vi.mock("./session.js", () => ({ useSession: vi.fn() }));
vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: {
    listPayments: vi.fn(),
    listMembers: vi.fn(),
    getFinancialAdjustments: vi.fn(),
    adjustPayment: vi.fn(),
  },
}));
const mocked = vi.mocked(api);
const payment: Payment = {
  id: "p",
  organizationId: "o",
  memberId: "m",
  membershipId: "ms",
  planId: "pl",
  amountCents: 30000,
  method: "cash",
  reference: null,
  state: "validated",
  registeredBy: "recep",
  decidedBy: "admin",
  decidedAt: "2026-10-15",
  reason: null,
  createdAt: "2026-10-15",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useSession).mockReturnValue({
    session: {
      user: { id: "admin", email: "admin@test.cl", name: "Admin" },
      organization: { id: "o", name: "Gym" },
      role: "admin",
    },
    loading: false,
    reload: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
  mocked.listPayments.mockImplementation(async (state) => (state === "validated" ? [payment] : []));
  mocked.listMembers.mockResolvedValue([
    {
      id: "m",
      organizationId: "o",
      fullName: "Socio",
      contactEmail: null,
      createdAt: "2026-10-15",
    },
  ]);
  mocked.getFinancialAdjustments.mockResolvedValue({
    items: [],
    compensatedCents: 0,
    remainingCents: 30000,
  });
});
describe("SPEC 014 CA-5 compensación explícita", () => {
  it("confirma antes de enviar y conserva la intención tras un fallo de transporte", async () => {
    mocked.adjustPayment
      .mockRejectedValueOnce(new Error("Sin respuesta de red"))
      .mockResolvedValueOnce({ id: "adjustment" } as never);
    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: "Validados" }));
    fireEvent.click(await screen.findByRole("button", { name: "Devolver / ajustar" }));
    fireEvent.change(await screen.findByLabelText("Importe a compensar (CLP)"), {
      target: { value: "5000" },
    });
    fireEvent.change(screen.getByLabelText("Motivo de la compensación"), {
      target: { value: " Error de cobro " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revisar compensación" }));
    expect(mocked.adjustPayment).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar devolución" }));
    expect(await screen.findByText("Sin respuesta de red")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar devolución" }));
    await waitFor(() => expect(mocked.adjustPayment).toHaveBeenCalledTimes(2));
    expect(mocked.adjustPayment.mock.calls[0]).toEqual(mocked.adjustPayment.mock.calls[1]);
    expect(mocked.adjustPayment.mock.calls[0]?.[1]).toMatchObject({
      amountCents: 5000,
      kind: "refund",
      reason: "Error de cobro",
    });
  });
  it("recepción no recibe acción para compensar", async () => {
    const current = vi.mocked(useSession)();
    vi.mocked(useSession).mockReturnValue({
      ...current,
      session: { ...current.session!, role: "recepcion" },
    });
    render(<Payments />);
    fireEvent.click(screen.getByRole("button", { name: "Validados" }));
    await screen.findByRole("cell", { name: "Socio" });
    expect(screen.queryByRole("button", { name: "Devolver / ajustar" })).toBeNull();
  });
});
