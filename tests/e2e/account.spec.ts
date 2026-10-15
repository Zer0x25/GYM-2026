import { test, expect } from "@playwright/test";

test("SPEC015 recuperación pública informa correo pendiente, sin simulación de envío", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.getByRole("heading", { name: "Recuperar acceso" })).toBeVisible();
  await expect(page.getByText(/envío de correos está pendiente/)).toBeVisible();
  await page.getByLabel("Email de ingreso").fill("ausente@example.test");
  await expect(page.getByRole("button", { name: "Solicitar recuperación" })).toBeDisabled();
  const capability = await page.request.get("/api/v1/account/email-capabilities");
  expect((await capability.json()).data).toEqual({
    passwordReset: false,
    contactVerification: false,
  });
  const known = await page.request.post("/api/auth/request-password-reset", {
    data: { email: "admin@pilot.cl" },
  });
  const unknown = await page.request.post("/api/auth/request-password-reset", {
    data: { email: "ausente@example.test" },
  });
  expect(known.status()).toBe(400);
  expect(unknown.status()).toBe(400);
  expect(await known.json()).toEqual(await unknown.json());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/gym-015-recovery-mobile.png", fullPage: true });
  await page.goto("/verificar-contacto#" + "a".repeat(64));
  await expect(page.getByText(/Ingresa con tu cuenta y vuelve a abrir/)).toBeVisible();
  await expect(page).toHaveURL(/\/verificar-contacto$/);
});
