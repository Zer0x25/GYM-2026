import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Mostrador } from "./pages/Mostrador.js";
import { Portal } from "./pages/Portal.js";
import { SessionProvider } from "./session.js";
import { api, ApiError } from "./api.js";

vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: {
    session: vi.fn(),
    recentCheckins: vi.fn(),
    listMembers: vi.fn(),
    checkin: vi.fn(),
    checkinMember: vi.fn(),
    portalOverview: vi.fn(),
    myQr: vi.fn(),
    schedule: vi.fn(),
    myBookings: vi.fn(),
    rotateQr: vi.fn(),
  },
}));
const mocked = vi.mocked(api);
const user = {
  user: { id: "a", name: "Ana", email: "a@test.cl" },
  organization: { id: "org", name: "Gym" },
  role: "socio" as const,
};
function view(element: React.ReactNode) {
  return render(
    <MemoryRouter>
      <SessionProvider>{element}</SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.session.mockResolvedValue(user);
  mocked.recentCheckins.mockResolvedValue([]);
  mocked.listMembers.mockResolvedValue([
    {
      id: "m",
      organizationId: "org",
      fullName: "Camila Rojas",
      contactEmail: null,
      createdAt: new Date().toISOString(),
    },
  ]);
  mocked.portalOverview.mockResolvedValue({
    member: {
      id: "m",
      organizationId: "org",
      fullName: "Camila",
      contactEmail: null,
      createdAt: new Date().toISOString(),
    },
    memberships: [],
  });
  mocked.myQr.mockResolvedValue({ qrToken: "opaque-member-qr" });
  mocked.schedule.mockResolvedValue([]);
  mocked.myBookings.mockResolvedValue([]);
});
describe("SPEC 010 capacidades de recepción y portal", () => {
  it("CA-2 búsqueda por nombre selecciona socio y usa validación del servidor", async () => {
    mocked.checkinMember.mockResolvedValue({
      allowed: true,
      memberId: "m",
      fullName: "Camila Rojas",
    });
    view(<Mostrador />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar socio por nombre" }), {
      target: { value: "Camila" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Camila Rojas/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Validar ingreso" }));
    await waitFor(() => expect(mocked.checkinMember).toHaveBeenCalledWith("m"));
    expect(mocked.checkin).not.toHaveBeenCalled();
  });
  it("CA-2 feed fallido informa desactualización, nunca EN VIVO", async () => {
    mocked.recentCheckins.mockRejectedValue(new Error("sin red"));
    view(<Mostrador />);
    expect(await screen.findByText(/No se pudieron actualizar/)).toBeTruthy();
    expect(screen.queryByText("EN VIVO")).toBeNull();
  });
  it("CA-2 fallo de transporte se diferencia de QR desconocido", async () => {
    mocked.checkin.mockRejectedValue(new Error("red"));
    view(<Mostrador />);
    fireEvent.change(screen.getByRole("textbox", { name: "Token de QR" }), {
      target: { value: "qr" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validar QR" }));
    expect(await screen.findByText("No se pudo validar el ingreso")).toBeTruthy();
    expect(screen.queryByText("QR no reconocido")).toBeNull();
  });
  it("CA-3 portal carga QR propio y no consulta planes administrativos", async () => {
    view(<Portal />);
    expect(await screen.findByRole("heading", { name: "Mi acceso" })).toBeTruthy();
    await waitFor(() => expect(mocked.myQr).toHaveBeenCalled());
    expect(await screen.findByTestId("member-qr")).toBeTruthy();
  });
  it("CA-3 error en QR se muestra sin inventar acceso válido", async () => {
    mocked.myQr.mockRejectedValue(new ApiError(409, "CONFLICT", "QR revocado"));
    view(<Portal />);
    expect(await screen.findByText("QR revocado")).toBeTruthy();
    expect(screen.queryByTestId("member-qr")).toBeNull();
  });
});
