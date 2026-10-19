import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Panel } from "./pages/Panel.js";
import { MemberDetail } from "./pages/MemberDetail.js";
import { Portal } from "./pages/Portal.js";
import { api } from "./api.js";

vi.mock("./session.js", () => ({
  useSession: () => ({ session: { role: "admin", accountId: "admin-1" } }),
}));

vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: {
    listMembers: vi.fn(),
    listMemberships: vi.fn(),
    listPlans: vi.fn(),
    createMember: vi.fn(),
    createSocio: vi.fn(),
    createMembership: vi.fn(),
    memberOverview: vi.fn(),
    portalOverview: vi.fn(),
    schedule: vi.fn(),
    myBookings: vi.fn(),
    myQr: vi.fn(),
    updateContact: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listMembers).mockResolvedValue([
    {
      id: "adulto-1",
      organizationId: "org-1",
      fullName: "Ana Adulta",
      contactEmail: "ana@gym.test",
      isMinor: false,
      adultResponsibleId: null,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ]);
  vi.mocked(api.listMemberships).mockResolvedValue([]);
  vi.mocked(api.listPlans).mockResolvedValue([]);
  vi.mocked(api.createMember).mockResolvedValue({
    id: "menor-1",
    organizationId: "org-1",
    fullName: "Hijo Menor",
    contactEmail: null,
    isMinor: true,
    adultResponsibleId: "adulto-1",
    createdAt: "2026-10-19T00:00:00.000Z",
  });
  vi.mocked(api.schedule).mockResolvedValue([]);
  vi.mocked(api.myBookings).mockResolvedValue([]);
  vi.mocked(api.myQr).mockResolvedValue({ qrToken: "qr-123" });
});

afterEach(cleanup);

it("CA-4 Panel: permite registrar a un socio menor seleccionando adulto responsable", async () => {
  render(
    <MemoryRouter>
      <Panel />
    </MemoryRouter>,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Nuevo socio" }));
  fireEvent.change(screen.getByLabelText("Nombre completo"), {
    target: { value: "Hijo Menor" },
  });

  // Desmarcar portal si aplica
  const portalCheckbox = screen.getByLabelText("Crear acceso al portal del socio");
  fireEvent.click(portalCheckbox);

  // Marcar menor
  const minorCheckbox = screen.getByLabelText(/Es menor de edad/i);
  fireEvent.click(minorCheckbox);

  // Seleccionar adulto responsable
  const guardianSelect = screen.getByLabelText(/Adulto responsable/i);
  fireEvent.change(guardianSelect, { target: { value: "adulto-1" } });

  fireEvent.click(screen.getByRole("button", { name: "Crear socio" }));

  await waitFor(() => {
    expect(api.createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Hijo Menor",
        isMinor: true,
        adultResponsibleId: "adulto-1",
      }),
    );
  });
});

it("CA-4 MemberDetail: muestra adulto responsable en la ficha del menor", async () => {
  vi.mocked(api.memberOverview).mockResolvedValue({
    member: {
      id: "menor-1",
      organizationId: "org-1",
      fullName: "Hijo Menor",
      contactEmail: "contacto@tutor.test",
      isMinor: true,
      adultResponsibleId: "adulto-1",
      adultResponsibleName: "Ana Adulta",
      createdAt: "2026-10-19T00:00:00.000Z",
    },
    memberships: [],
    payments: [],
    creditPeriods: [],
  });

  render(
    <MemoryRouter initialEntries={["/panel/menor-1"]}>
      <Routes>
        <Route path="/panel/:id" element={<MemberDetail />} />
      </Routes>
    </MemoryRouter>,
  );

  expect(await screen.findByText(/Hijo Menor/)).toBeDefined();
  expect(await screen.findByText(/Ana Adulta/)).toBeDefined();
});

it("CA-4 Portal: oculta edición de contacto cuando el socio es menor", async () => {
  vi.mocked(api.portalOverview).mockResolvedValue({
    member: {
      id: "menor-1",
      organizationId: "org-1",
      fullName: "Hijo Menor",
      contactEmail: "contacto@tutor.test",
      isMinor: true,
      adultResponsibleId: "adulto-1",
      adultResponsibleName: "Ana Adulta",
      createdAt: "2026-10-19T00:00:00.000Z",
    },
    memberships: [],
    creditPeriods: [],
  });

  render(
    <MemoryRouter>
      <Portal />
    </MemoryRouter>,
  );

  await screen.findByText(/Hijo Menor/);
  // El botón "Editar" de contacto NO debe estar disponible para un menor
  expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  expect(screen.getByText(/administrado por adulto responsable/i)).toBeDefined();
});
