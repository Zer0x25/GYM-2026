import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Reports } from "./pages/Reports.js";
import { SessionProvider } from "./session.js";
import { api } from "./api.js";

vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: {
    session: vi.fn(),
    dailyReport: vi.fn(),
    downloadMembersCsv: vi.fn(),
    downloadMembershipsCsv: vi.fn(),
    downloadAttendanceCsv: vi.fn(),
  },
}));

const mocked = vi.mocked(api);
const adminUser = {
  user: { id: "admin-1", name: "Admin", email: "admin@test.cl" },
  organization: { id: "org-1", name: "Gym Test" },
  role: "admin" as const,
};

function renderReports() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <Reports />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("SPEC 020 CA-4 Reports.tsx exportaciones operativas CSV", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.session.mockResolvedValue(adminUser);
    mocked.dailyReport.mockResolvedValue({
      date: "2026-10-19",
      timeZone: "America/Santiago",
      cash: 50000,
      transfer: 30000,
      transbank: 20000,
      income: 100000,
      movements: 4,
      shifts: [],
    });
  });

  it("renderiza controles para los 4 reportes CSV (financiero, socios, vigencias, asistencia)", async () => {
    renderReports();
    expect(await screen.findByRole("button", { name: /Exportar CSV|Exportar CSV financiero/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /socios.*csv/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /vigencias.*csv/i })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /asistencia.*csv/i })).toBeTruthy();
  });

  it("permite descargar socios y vigencias invocando los endpoints correspondientes", async () => {
    renderReports();
    const btnMembers = await screen.findByRole("button", { name: /socios.*csv/i });
    fireEvent.click(btnMembers);
    await waitFor(() => expect(mocked.downloadMembersCsv).toHaveBeenCalled());

    const btnMemberships = await screen.findByRole("button", { name: /vigencias.*csv/i });
    fireEvent.click(btnMemberships);
    await waitFor(() => expect(mocked.downloadMembershipsCsv).toHaveBeenCalled());
  });

  it("descarga asistencia por rango de fechas y valida rango máximo", async () => {
    renderReports();
    const fromInput = await screen.findByLabelText(/desde|fecha desde/i);
    const toInput = await screen.findByLabelText(/hasta|fecha hasta/i);
    const btnAttendance = await screen.findByRole("button", { name: /asistencia.*csv/i });

    fireEvent.change(fromInput, { target: { value: "2026-10-01" } });
    fireEvent.change(toInput, { target: { value: "2026-10-15" } });
    fireEvent.click(btnAttendance);

    await waitFor(() => expect(mocked.downloadAttendanceCsv).toHaveBeenCalledWith("2026-10-01", "2026-10-15"));

    // Rango inválido: from > to
    fireEvent.change(fromInput, { target: { value: "2026-10-20" } });
    fireEvent.change(toInput, { target: { value: "2026-10-10" } });
    expect(await screen.findByText(/rango inválido|menor o igual/i)).toBeTruthy();
  });
});
