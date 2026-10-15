import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { App } from "./App.js";
import { api } from "./api.js";
vi.mock("./api.js", async () => {
  const original = await vi.importActual<typeof import("./api.js")>("./api.js");
  return {
    ...original,
    api: {
      ...original.api,
      session: vi.fn().mockResolvedValue(null),
      emailCapabilities: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
      confirmContactVerification: vi.fn(),
      me: vi.fn(),
    },
  };
});
function Location() {
  const l = useLocation();
  return (
    <output data-testid="location">
      {l.pathname}
      {l.hash}
    </output>
  );
}
const mount = (path = "/recuperar") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Location />
    </MemoryRouter>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.session).mockResolvedValue(null as never);
  vi.mocked(api.emailCapabilities).mockResolvedValue({
    passwordReset: false,
    contactVerification: false,
  });
});
afterEach(cleanup);
it("CA-1/5 recuperación sin sesión informa correo pendiente y no intenta enviar", async () => {
  mount();
  expect(await screen.findByRole("heading", { name: "Recuperar acceso" })).toBeTruthy();
  await screen.findByText(/envío de correos está pendiente/i);
  fireEvent.change(screen.getByLabelText("Email de ingreso"), {
    target: { value: "socio@example.test" },
  });
  expect(
    (screen.getByRole("button", { name: "Solicitar recuperación" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(api.requestPasswordReset).not.toHaveBeenCalled();
});
it("CA-5 reset captura fragmento, valida confirmación y solo entonces envía contraseña", async () => {
  vi.mocked(api.resetPassword).mockResolvedValue(undefined);
  mount("/recuperar#token-ficticio");
  await screen.findByRole("heading", { name: "Cambiar contraseña" });
  await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/recuperar"));
  fireEvent.change(screen.getByLabelText("Nueva contraseña"), {
    target: { value: "FictionalPassword123!" },
  });
  fireEvent.change(screen.getByLabelText("Repetir contraseña"), {
    target: { value: "OtraPassword123!" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));
  expect(api.resetPassword).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("no coinciden");
  fireEvent.change(screen.getByLabelText("Repetir contraseña"), {
    target: { value: "FictionalPassword123!" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));
  await waitFor(() =>
    expect(api.resetPassword).toHaveBeenCalledWith("token-ficticio", "FictionalPassword123!"),
  );
  expect(await screen.findByText(/Contraseña actualizada/)).toBeTruthy();
});
it("CA-5 contacto no se consume por abrir enlace sin sesión", async () => {
  mount("/verificar-contacto#" + "a".repeat(64));
  expect(await screen.findByText(/Ingresa con tu cuenta y vuelve a abrir/)).toBeTruthy();
  expect(api.confirmContactVerification).not.toHaveBeenCalled();
});

it("CA-5 abrir enlace autenticado requiere confirmación explícita y usa socio resuelto por servidor", async () => {
  vi.mocked(api.session).mockResolvedValue({
    user: { id: "u1", name: "Socio", email: "ingreso@example.test" },
    organization: { id: "org", name: "Gym" },
    role: "socio",
  });
  vi.mocked(api.me).mockResolvedValue({
    id: "member-from-session",
    organizationId: "org",
    fullName: "Socio",
    contactEmail: "old@example.test",
    createdAt: "2026-10-15",
  });
  vi.mocked(api.confirmContactVerification).mockResolvedValue({ verified: true });
  const token = "a".repeat(64);
  mount("/verificar-contacto#" + token);
  const button = await screen.findByRole("button", { name: "Confirmar contacto" });
  expect(api.confirmContactVerification).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByTestId("location").textContent).toBe("/verificar-contacto"),
  );
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.confirmContactVerification).toHaveBeenCalledWith("member-from-session", token),
  );
  expect(await screen.findByText(/Contacto verificado y actualizado/)).toBeTruthy();
});
