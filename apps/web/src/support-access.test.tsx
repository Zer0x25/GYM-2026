import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Team } from "./pages/Team.js";
import { SessionProvider } from "./session.js";
import { api, type SupportGrant } from "./api.js";

vi.mock("./api.js", async () => ({
  ...(await vi.importActual("./api.js")),
  api: {
    session: vi.fn(),
    staff: vi.fn(),
    createStaff: vi.fn(),
    accountSessions: vi.fn(),
    revokeSession: vi.fn(),
    supportGrants: vi.fn(),
    createSupportGrant: vi.fn(),
    revokeSupportGrant: vi.fn(),
  },
}));

const mocked = vi.mocked(api);

const adminUser = {
  user: { id: "admin-1", name: "Admin General", email: "admin@gym.cl" },
  organization: { id: "11111111-1111-4111-8111-111111111111", name: "Gimnasio Piloto" },
  role: "admin" as const,
};

const mockGrantActive: SupportGrant = {
  id: "22222222-2222-4222-8222-222222222222",
  organizationId: "11111111-1111-4111-8111-111111111111",
  grantedByAccountId: "admin-1",
  supportEmail: "soporte-1@gym.cl",
  reason: "Diagnóstico de outbox",
  scope: "diagnostic",
  tokenHash: "hash-sha256-1111",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  revokedAt: null,
  revokedByAccountId: null,
  lastUsedAt: null,
  createdAt: new Date().toISOString(),
};

const mockGrantRevoked: SupportGrant = {
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: "11111111-1111-4111-8111-111111111111",
  grantedByAccountId: "admin-1",
  supportEmail: "soporte-2@gym.cl",
  reason: "Revisión de caja finalizada",
  scope: "read_only",
  tokenHash: "hash-sha256-2222",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  revokedAt: new Date().toISOString(),
  revokedByAccountId: "admin-1",
  lastUsedAt: new Date().toISOString(),
  createdAt: new Date(Date.now() - 7200000).toISOString(),
};

function renderTeam() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <Team />
      </SessionProvider>
    </MemoryRouter>,
  );
}

describe("SPEC 026 CA-3: Team.tsx Acceso temporal de soporte D-06", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.session.mockResolvedValue(adminUser);
    mocked.staff.mockResolvedValue([
      { id: "admin-1", name: "Admin General", email: "admin@gym.cl", role: "admin" },
    ]);
    mocked.supportGrants.mockResolvedValue([mockGrantActive, mockGrantRevoked]);
  });

  it("renderiza la sección de acceso temporal de soporte (D-06) con la lista de permisos", async () => {
    renderTeam();

    expect(await screen.findByText(/Acceso temporal de soporte \(D-06\)/i)).toBeTruthy();
    expect(await screen.findByText("soporte-1@gym.cl")).toBeTruthy();
    expect(await screen.findByText("soporte-2@gym.cl")).toBeTruthy();
    expect(await screen.findByText(/Diagnóstico de outbox/i)).toBeTruthy();
    expect(await screen.findByText(/Activo/i)).toBeTruthy();
    expect(await screen.findByText(/Revocado/i)).toBeTruthy();
  });

  it("permite al admin emitir un permiso temporal y muestra el token efímero generado", async () => {
    const rawToken = "f4c9a80e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e";
    mocked.createSupportGrant.mockResolvedValue({
      grant: {
        id: "44444444-4444-4444-4444-444444444444",
        organizationId: "11111111-1111-4111-8111-111111111111",
        grantedByAccountId: "admin-1",
        supportEmail: "soporte-nuevo@gym.cl",
        reason: "Revisión urgente de turnos",
        scope: "diagnostic",
        tokenHash: "somehash",
        expiresAt: new Date(Date.now() + 1800000).toISOString(),
        revokedAt: null,
        revokedByAccountId: null,
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
      },
      token: rawToken,
    });

    renderTeam();

    const openBtn = await screen.findByRole("button", { name: /Otorgar acceso de soporte|Emitir acceso temporal/i });
    fireEvent.click(openBtn);

    const emailInput = await screen.findByLabelText(/Email de soporte/i);
    const reasonInput = await screen.findByLabelText(/Motivo/i);
    const submitBtn = await screen.findByRole("button", { name: /Emitir permiso|Crear acceso/i });

    fireEvent.change(emailInput, { target: { value: "soporte-nuevo@gym.cl" } });
    fireEvent.change(reasonInput, { target: { value: "Revisión urgente de turnos" } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mocked.createSupportGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          supportEmail: "soporte-nuevo@gym.cl",
          reason: "Revisión urgente de turnos",
        }),
      );
    });

    // Se muestra el token efímero con advertencia de copia única
    expect(await screen.findByText(rawToken)).toBeTruthy();
    expect(await screen.findByText(/no volverá a mostrarse/i)).toBeTruthy();
  });

  it("permite revocar un acceso de soporte activo de inmediato", async () => {
    mocked.revokeSupportGrant.mockResolvedValue({
      success: true,
      grant: {
        ...mockGrantActive,
        revokedAt: new Date().toISOString(),
        revokedByAccountId: "admin-1",
      },
    });

    renderTeam();

    const revokeButtons = await screen.findAllByRole("button", { name: /Revocar acceso/i });
    expect(revokeButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(revokeButtons[0]!);

    const confirmBtn = await screen.findByRole("button", { name: /Confirmar/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mocked.revokeSupportGrant).toHaveBeenCalledWith(mockGrantActive.id);
    });
  });
});
