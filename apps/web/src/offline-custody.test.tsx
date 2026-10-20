import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Offline } from "./pages/Offline.js";
import { Team } from "./pages/Team.js";
import { SessionProvider } from "./session.js";
import { api } from "./api.js";

vi.mock("./api.js", async () => {
  const original = await vi.importActual<typeof import("./api.js")>("./api.js");
  return {
    ...original,
    api: {
      ...original.api,
      session: vi.fn(),
      ownDevices: vi.fn(),
      offlinePolicy: vi.fn(),
      staff: vi.fn(),
      devices: vi.fn(),
      registerDevice: vi.fn(),
      revokeDevice: vi.fn(),
      reconstruct: vi.fn(),
      offlineEvents: vi.fn(),
      accountSessions: vi.fn(),
      revokeSession: vi.fn(),
      revokeAllSessions: vi.fn(),
    },
  };
});

vi.mock("./lib/offline-vault.js", async () => {
  const original =
    await vi.importActual<typeof import("./lib/offline-vault.js")>("./lib/offline-vault.js");
  return {
    ...original,
    listVaults: vi.fn().mockResolvedValue([]),
    getVault: vi.fn().mockResolvedValue(null),
  };
});

const adminSession = {
  user: { id: "admin-1", name: "Admin Test", email: "admin@test.cl" },
  organization: { id: "org-1", name: "Gym Central" },
  role: "admin" as const,
};

function renderWithProviders(component: React.ReactNode) {
  return render(
    <MemoryRouter>
      <SessionProvider>{component}</SessionProvider>
    </MemoryRouter>,
  );
}

describe("Offline Custody, Reconstruction and Session Revocation (SPEC 024)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.session).mockResolvedValue(adminSession);
    vi.mocked(api.ownDevices).mockResolvedValue([]);
    vi.mocked(api.offlinePolicy).mockResolvedValue({ enabled: true, freshnessHours: 72 });
    vi.mocked(api.staff).mockResolvedValue([
      {
        id: "admin-1",
        name: "Admin Test",
        email: "admin@test.cl",
        role: "admin",
      },
      {
        id: "op-1",
        name: "Operador Recepción",
        email: "op@test.cl",
        role: "recepcion",
      },
    ]);
  });

  afterEach(cleanup);

  it("CA-3: Registro de dispositivo incluye referencia de custodia opcional", async () => {
    vi.mocked(api.devices).mockResolvedValue([]);
    vi.mocked(api.registerDevice).mockResolvedValue({
      id: "dev-new",
      accountId: "op-1",
      label: "Tablet Mostrador",
      state: "habilitado",
      custodyReference: "TAB-001-CUSTODIA",
      custodyConfirmedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    renderWithProviders(<Offline />);

    expect(
      await screen.findByRole("heading", { name: "Habilitación de dispositivos" }),
    ).toBeTruthy();
    await screen.findByRole("option", { name: /Operador Recepción/ });

    fireEvent.change(screen.getByLabelText("Operador"), { target: { value: "op-1" } });
    fireEvent.change(screen.getByLabelText("Nombre del dispositivo"), {
      target: { value: "Tablet Mostrador" },
    });
    fireEvent.change(screen.getByLabelText("Referencia de custodia"), {
      target: { value: "TAB-001-CUSTODIA" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Registrar dispositivo/i }));

    await waitFor(() => {
      expect(api.registerDevice).toHaveBeenCalledWith(
        "op-1",
        "Tablet Mostrador",
        "TAB-001-CUSTODIA",
      );
    });
  });

  it("CA-3: Listado de dispositivos muestra custodia y detalle estructurado de revocación", async () => {
    vi.mocked(api.devices).mockResolvedValue([
      {
        id: "dev-1",
        accountId: "op-1",
        label: "Tablet 1",
        state: "habilitado",
        custodyReference: "SERIE-12345",
        custodyConfirmedAt: "2026-10-15T10:00:00.000Z",
        createdAt: "2026-10-15T10:00:00.000Z",
      },
      {
        id: "dev-2",
        accountId: "op-1",
        label: "Tablet 2 Perdida",
        state: "revocado",
        custodyReference: "SERIE-99999",
        revokedReason: "perdida_robo",
        revokedNotes: "Extraviada en turno tarde",
        revokedAt: "2026-10-16T12:00:00.000Z",
        createdAt: "2026-10-10T10:00:00.000Z",
      },
    ]);

    renderWithProviders(<Offline />);

    expect(
      await screen.findByRole("heading", { name: "Habilitación de dispositivos" }),
    ).toBeTruthy();
    expect(await screen.findByText(/SERIE-12345/)).toBeTruthy();
    expect(screen.getByText(/confirmada:/)).toBeTruthy();

    expect(screen.getAllByText(/Tablet 2 Perdida/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/perdida_robo/)).toBeTruthy();
    expect(screen.getByText(/Extraviada en turno tarde/)).toBeTruthy();
  });

  it("CA-3: Diálogo de revocación captura motivo estructurado y notas", async () => {
    vi.mocked(api.devices).mockResolvedValue([
      {
        id: "dev-1",
        accountId: "op-1",
        label: "Tablet Activa",
        state: "habilitado",
        createdAt: "2026-10-15T10:00:00.000Z",
      },
    ]);
    vi.mocked(api.revokeDevice).mockResolvedValue({} as never);

    renderWithProviders(<Offline />);

    const revokeBtn = await screen.findByRole("button", { name: "Revocar" });
    fireEvent.click(revokeBtn);

    expect(
      await screen.findByRole("heading", { name: /Revocar dispositivo: Tablet Activa/ }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Motivo de revocación")).toBeTruthy();
    expect(screen.getByLabelText("Notas / Observaciones (opcional)")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Motivo de revocación"), {
      target: { value: "perdida_robo" },
    });
    fireEvent.change(screen.getByLabelText("Notas / Observaciones (opcional)"), {
      target: { value: "Robo en recepción" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar revocación" }));

    await waitFor(() => {
      expect(api.revokeDevice).toHaveBeenCalledWith("dev-1", {
        reason: "perdida_robo",
        notes: "Robo en recepción",
      });
    });
  });

  it("CA-4: Panel de Reconstrucción verifica la cadena de hash y consulta eventos de servidor", async () => {
    vi.mocked(api.devices).mockResolvedValue([
      {
        id: "dev-1",
        accountId: "op-1",
        label: "Tablet 1",
        state: "habilitado",
        createdAt: "2026-10-15T10:00:00.000Z",
      },
    ]);
    vi.mocked(api.reconstruct).mockResolvedValue({
      eventsChecked: 15,
      chainIntact: true,
      brokenAt: null,
    });
    vi.mocked(api.offlineEvents).mockResolvedValue([
      {
        id: "ev-rec-1",
        deviceId: "dev-1",
        eventId: "e1",
        folioExterno: "F-1001",
        type: "cobro_provisional",
        state: "sincronizado",
        rejectReason: null,
        capturedAt: "2026-10-19T10:00:00.000Z",
        hash: "abc1234567890abcdef",
        prevHash: null,
        createdAt: "2026-10-19T10:05:00.000Z",
      },
      {
        id: "ev-rec-2",
        deviceId: "dev-1",
        eventId: "e2",
        folioExterno: "F-1002",
        type: "cobro_provisional",
        state: "rechazado",
        rejectReason: "dispositivo revocado (perdida_robo)",
        capturedAt: "2026-10-19T10:01:00.000Z",
        hash: "def4567890123abcdef",
        prevHash: "abc1234567890abcdef",
        createdAt: "2026-10-19T10:06:00.000Z",
      },
    ]);

    renderWithProviders(<Offline />);

    expect(await screen.findByTestId("offline-recon-panel")).toBeTruthy();

    // Trigger reconstruction
    fireEvent.click(screen.getByRole("button", { name: /Verificar integridad de cadena/i }));

    await waitFor(() => {
      expect(api.reconstruct).toHaveBeenCalledWith(undefined);
    });
    expect(await screen.findByText(/Cadena intacta \(válida\)/)).toBeTruthy();
    expect(screen.getByText("15")).toBeTruthy();

    // Trigger events lookup
    fireEvent.click(screen.getByRole("button", { name: /Consultar eventos/i }));

    await waitFor(() => {
      expect(api.offlineEvents).toHaveBeenCalledWith(undefined);
    });
    expect(await screen.findByText("F-1001")).toBeTruthy();
    expect(screen.getByText("F-1002")).toBeTruthy();
    expect(screen.getByText("dispositivo revocado (perdida_robo)")).toBeTruthy();
  });

  it("CA-4: Team permite cerrar una sesión específica y cerrar todas las sesiones", async () => {
    vi.mocked(api.staff).mockResolvedValue([
      {
        id: "op-1",
        name: "Operador Test",
        email: "op@test.cl",
        role: "recepcion",
      },
    ]);
    vi.mocked(api.accountSessions).mockResolvedValue([
      {
        id: "sess-1",
        userAgent: "Chrome Mac",
        ipAddress: "127.0.0.1",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      },
      {
        id: "sess-2",
        userAgent: "Firefox Linux",
        ipAddress: "127.0.0.1",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]);
    vi.mocked(api.revokeSession).mockResolvedValue(undefined);
    vi.mocked(api.revokeAllSessions).mockResolvedValue({ revoked: 2 });

    renderWithProviders(<Team />);

    const sessionsBtn = await screen.findByRole("button", { name: "Ver sesiones" });
    fireEvent.click(sessionsBtn);

    expect(await screen.findByRole("heading", { name: "Sesiones de Operador Test" })).toBeTruthy();
    expect(screen.getByText("Chrome Mac")).toBeTruthy();
    expect(screen.getByText("Firefox Linux")).toBeTruthy();

    // Revoke single session
    const revokeBtns = screen.getAllByRole("button", { name: "Revocar sesión" });
    expect(revokeBtns[0]).toBeDefined();
    fireEvent.click(revokeBtns[0]!);

    // Click Confirmar in Confirm dialog
    const confirmBtn = await screen.findByRole("button", { name: "Confirmar" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(api.revokeSession).toHaveBeenCalledWith("op-1", "sess-1");
    });

    // Revoke all sessions
    const revokeAllBtn = screen.getByRole("button", { name: "Cerrar todas las sesiones" });
    fireEvent.click(revokeAllBtn);

    await waitFor(() => {
      expect(api.revokeAllSessions).toHaveBeenCalledWith("op-1");
    });
  });
});
