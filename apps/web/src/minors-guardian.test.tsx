import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Panel } from "./pages/Panel.js";
import { MemberDetail } from "./pages/MemberDetail.js";
import { api, type MemberOverview } from "./api.js";
import { useSession } from "./session.js";

vi.mock("./session.js", () => ({ useSession: vi.fn() }));
vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: {
    listMembers: vi.fn(),
    listMemberships: vi.fn(),
    listPlans: vi.fn(),
    minorPolicy: vi.fn(),
    setMinorPolicy: vi.fn(),
    createMember: vi.fn(),
    updateMember: vi.fn(),
    memberOverview: vi.fn(),
  },
}));

const mocked = vi.mocked(api);

describe("SPEC 025 CA-3 — Sincronización UI de política de menores y consentimiento D-05", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(useSession).mockReturnValue({
      session: {
        user: { id: "admin-1", email: "admin@gym.test", name: "Admin" },
        organization: { id: "org-1", name: "Gimnasio Central" },
        role: "admin",
      },
      loading: false,
      reload: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    mocked.listMembers.mockResolvedValue([
      {
        id: "adult-1",
        organizationId: "org-1",
        fullName: "Adulto Responsable",
        contactEmail: "adulto@gym.test",
        isMinor: false,
        createdAt: "2026-10-10",
      },
    ]);
    mocked.listMemberships.mockResolvedValue([]);
    mocked.listPlans.mockResolvedValue([]);
  });

  it("Panel bloquea alta de menor si minorPolicy está deshabilitada (enabled=false)", async () => {
    mocked.minorPolicy.mockResolvedValue({
      enabled: false,
      orgEnabled: false,
      serverLocked: false,
    });

    render(
      <MemoryRouter>
        <Panel />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Nuevo socio")).toBeTruthy();
    fireEvent.click(screen.getByText("Nuevo socio"));

    // Verifica que aparezca el aviso de restricción D-05
    expect(await screen.findByText(/Restricción de piloto \(D-05\)/i)).toBeTruthy();

    // El checkbox 'Es menor de edad' debe estar deshabilitado
    const minorCheckbox = screen.getByLabelText(/Es menor de edad/i) as HTMLInputElement;
    expect(minorCheckbox.disabled).toBe(true);
  });

  it("Panel permite alta de menor y captura guardianConsentRef si minorPolicy está habilitada", async () => {
    mocked.minorPolicy.mockResolvedValue({
      enabled: true,
      orgEnabled: true,
      serverLocked: false,
    });
    mocked.createMember.mockResolvedValue({
      id: "minor-1",
      organizationId: "org-1",
      fullName: "Menor Con Consentimiento",
      contactEmail: null,
      isMinor: true,
      adultResponsibleId: "adult-1",
      guardianConsentRef: "ACTA-2026-0042",
      createdAt: "2026-10-19",
    });

    render(
      <MemoryRouter>
        <Panel />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Nuevo socio")).toBeTruthy();
    fireEvent.click(screen.getByText("Nuevo socio"));

    const minorCheckbox = (await screen.findByLabelText(
      /Es menor de edad/i,
    )) as HTMLInputElement;
    expect(minorCheckbox.disabled).toBe(false);

    fireEvent.click(minorCheckbox);
    expect(minorCheckbox.checked).toBe(true);

    // Campos de menor visibles: adulto responsable y folio D-05
    expect(screen.getByLabelText(/Adulto responsable/i)).toBeTruthy();
    expect(screen.getByLabelText(/Folio \/ acta de autorización/i)).toBeTruthy();

    // Completar formulario
    fireEvent.change(screen.getByLabelText(/Nombre completo/i), {
      target: { value: "Menor Con Consentimiento" },
    });
    fireEvent.change(screen.getByLabelText(/Adulto responsable/i), {
      target: { value: "adult-1" },
    });
    fireEvent.change(screen.getByLabelText(/Folio \/ acta de autorización/i), {
      target: { value: "ACTA-2026-0042" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Crear socio" }));

    await waitFor(() => {
      expect(mocked.createMember).toHaveBeenCalledWith(
        expect.objectContaining({
          fullName: "Menor Con Consentimiento",
          isMinor: true,
          adultResponsibleId: "adult-1",
          guardianConsentRef: "ACTA-2026-0042",
        }),
      );
    });
  });

  it("Panel permite al admin conmutar la política de menores", async () => {
    mocked.minorPolicy.mockResolvedValue({
      enabled: true,
      orgEnabled: true,
      serverLocked: false,
    });
    mocked.setMinorPolicy.mockResolvedValue({
      enabled: false,
      orgEnabled: false,
      serverLocked: false,
    });

    render(
      <MemoryRouter>
        <Panel />
      </MemoryRouter>,
    );

    const toggleBtn = await screen.findByRole("button", { name: /Menores: Habilitados/i });
    expect(toggleBtn).toBeTruthy();

    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(mocked.setMinorPolicy).toHaveBeenCalledWith(false);
    });
  });

  it("MemberDetail exhibe guardianConsentRef y permite actualizarlo a staff", async () => {
    const overview: MemberOverview = {
      member: {
        id: "minor-1",
        organizationId: "org-1",
        fullName: "Menor Aprobado",
        contactEmail: "contacto@tutor.cl",
        isMinor: true,
        adultResponsibleId: "adult-1",
        adultResponsibleName: "Adulto Tutor",
        guardianConsentRef: "ACTA-2026-0042",
        guardianConsentAt: "2026-10-19T15:30:00.000Z",
        createdAt: "2026-10-19",
      },
      memberships: [],
      payments: [],
      creditPeriods: [],
    };
    mocked.memberOverview.mockResolvedValue(overview);
    mocked.listPlans.mockResolvedValue([]);
    mocked.updateMember.mockResolvedValue({
      ...overview.member,
      guardianConsentRef: "ACTA-2026-0099",
    });

    render(
      <MemoryRouter initialEntries={["/panel/minor-1"]}>
        <Routes>
          <Route path="/panel/:id" element={<MemberDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Menor Aprobado")).toBeTruthy();
    expect(screen.getByText(/Socio menor de edad/i)).toBeTruthy();
    expect(screen.getByText("Adulto Tutor")).toBeTruthy();
    expect(screen.getByText("ACTA-2026-0042")).toBeTruthy();
    expect(screen.getByText(/sellado el/i)).toBeTruthy();

    // Actualizar acta / consentimiento
    const consentInput = screen.getByLabelText(
      /Actualizar acta\/folio de consentimiento \(D-05\)/i,
    );
    fireEvent.change(consentInput, { target: { value: "ACTA-2026-0099" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mocked.updateMember).toHaveBeenCalledWith("minor-1", {
        guardianConsentRef: "ACTA-2026-0099",
      });
    });
  });
});
