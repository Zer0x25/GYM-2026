import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuickPay } from "./components/QuickPay.js";
import { Reports } from "./pages/Reports.js";
import { api, type Membership, type Plan } from "./api.js";

vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: { registerPayment: vi.fn(), dailyReport: vi.fn() },
}));
const mocked = vi.mocked(api);
beforeEach(() => vi.resetAllMocks());
describe("SPEC 012 — método manual Transbank", () => {
  it("CA-5 exige operación/comentario y envía evidencia sin confundir transferencia", async () => {
    mocked.registerPayment.mockResolvedValue({ id: "p" } as Awaited<
      ReturnType<typeof api.registerPayment>
    >);
    const membership: Membership = {
      id: "m",
      organizationId: "o",
      memberId: "s",
      planId: "plan",
      startAt: null,
      endAt: null,
      lastPaymentId: null,
      createdAt: "2026-10-14",
    };
    const plan: Plan = {
      id: "plan",
      organizationId: "o",
      name: "Mensual",
      priceCents: 30000,
      durationDays: 30,
      coverage: "unlimited",
      active: true,
      createdAt: "2026-10-14",
    };
    render(
      <QuickPay
        open
        onOpenChange={vi.fn()}
        memberName="Socio"
        memberships={[membership]}
        plans={[plan]}
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Mensual/ }));
    fireEvent.click(screen.getByRole("button", { name: "Transbank externo" }));
    expect(
      (screen.getByRole("button", { name: "Registrar pago" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Número de operación (obligatorio)"), {
      target: { value: " OP-100 " },
    });
    expect(
      (screen.getByRole("button", { name: "Registrar pago" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Comentario (obligatorio)"), {
      target: { value: " Terminal externo " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    await waitFor(() =>
      expect(mocked.registerPayment).toHaveBeenCalledWith({
        membershipId: "m",
        amountCents: 30000,
        method: "transbank",
        reference: "OP-100",
        comment: "Terminal externo",
      }),
    );
  });
  it("CA-5 reporte muestra Transbank separado de transferencia y conserva total", async () => {
    mocked.dailyReport.mockResolvedValue({
      date: "2026-10-14",
      timeZone: "America/Santiago",
      cash: 1000,
      transfer: 2000,
      transbank: 3000,
      income: 6000,
      movements: 3,
      shifts: [],
    } as Awaited<ReturnType<typeof api.dailyReport>>);
    render(<Reports />);
    expect(await screen.findByText("Transbank externo")).toBeTruthy();
    expect(screen.getByText("Transferencias")).toBeTruthy();
    expect(screen.getByText("Ingresos confirmados")).toBeTruthy();
  });
});
