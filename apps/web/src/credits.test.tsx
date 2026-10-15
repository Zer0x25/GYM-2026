import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreditPeriods } from "./components/CreditPeriods.js";
import { Plans } from "./pages/Plans.js";
import { api } from "./api.js";
vi.mock("./session.js", () => ({ useSession: () => ({ session: { role: "admin" } }) }));
vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: { listPlans: vi.fn(), createPlan: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listPlans).mockResolvedValue([]);
  vi.mocked(api.createPlan).mockResolvedValue({ id: "p" } as never);
});
afterEach(cleanup);
it("CA-6 plan limitado pide cuotas expresas separadas sin cantidades de negocio por defecto", async () => {
  render(<Plans />);
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo plan" }));
  fireEvent.change(screen.getByLabelText("Nombre del plan"), {
    target: { value: "Plan limitado" },
  });
  fireEvent.change(screen.getByLabelText("Cobertura"), { target: { value: "limited" } });
  const fields = [
    "Créditos grupales por período",
    "Créditos de fijas por período",
    "Créditos de citas por período",
  ];
  fields.forEach((label, i) => {
    const input = screen.getByLabelText(label) as HTMLInputElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: String(i === 0 ? 1 : i === 1 ? 2 : 0) } });
  });
  fireEvent.click(screen.getByRole("button", { name: "Crear plan" }));
  await waitFor(() =>
    expect(api.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        coverage: "limited",
        classCredits: { grupal: 1, fija: 2, cita: 0 },
      }),
    ),
  );
});

it("CA-6 muestra saldo de cada modalidad y revisión vencida sin sumarlos", () => {
  const credits = {
    grupal: { quota: 1, committed: 1, available: 0 },
    fija: { quota: 2, committed: 0, available: 2 },
    cita: { quota: 0, committed: 0, available: 0 },
  };
  render(
    <CreditPeriods
      periods={[
        {
          id: "p",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: "2026-02-01T00:00:00.000Z",
          planName: "Limitado",
          coverage: "limited",
          credits,
          reviewCount: 1,
          reviewBookingIds: ["b"],
        },
      ]}
    />,
  );
  expect(screen.getByText("0 de 1 sin trasladar")).toBeTruthy();
  expect(screen.getByText("2 de 2 sin trasladar")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("revisión administrativa");
});
