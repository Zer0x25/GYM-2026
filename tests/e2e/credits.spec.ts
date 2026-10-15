import { test, expect, type Page } from "@playwright/test";
const password = "SuperSecret123!";
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ingresar", exact: true })).not.toBeVisible();
}
async function post<T>(page: Page, path: string, data: object): Promise<T> {
  const res = await page.request.post(`/api/v1/${path}`, { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).data;
}
test("SPEC016 cuotas explícitas, saldo por período y cancelación real en portal móvil", async ({
  page,
}) => {
  await login(page, "admin@pilot.cl");
  await page.goto("/planes");
  await page.getByRole("button", { name: "Nuevo plan" }).click();
  await page.getByLabel("Nombre del plan").fill("Limitado E2E");
  await page.getByLabel("Cobertura").selectOption("limited");
  await page.getByLabel("Créditos grupales por período").fill("1");
  await page.getByLabel("Créditos de fijas por período").fill("2");
  await page.getByLabel("Créditos de citas por período").fill("0");
  await page.getByRole("button", { name: "Crear plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Limitado E2E" })).toBeVisible();
  const plans = (await (await page.request.get("/api/v1/plans")).json()).data as {
    id: string;
    name: string;
  }[];
  const plan = plans.find((p) => p.name === "Limitado E2E")!;
  const staff = (await (await page.request.get("/api/v1/instructors")).json()).data as {
    accountId: string;
    id: string;
  }[];
  const instructor = staff[0]!;
  const at = new Date(Date.now() + 72 * 3600_000);
  const sessions = [];
  for (let i = 0; i < 2; i++)
    sessions.push(
      await post<{ id: string }>(page, "sessions", {
        type: "grupal",
        instructorId: instructor.accountId ?? instructor.id,
        startsAt: new Date(at.getTime() + i * 7200_000).toISOString(),
        endsAt: new Date(at.getTime() + i * 7200_000 + 3600_000).toISOString(),
        capacity: 5,
      }),
    );
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await login(page, "recepcion@pilot.cl");
  const socio = await post<{ memberId: string }>(page, "socios", {
    email: "credito.e2e@pilot.cl",
    password,
    name: "Socio Créditos E2E",
  });
  const ms = await post<{ id: string }>(page, "memberships", {
    memberId: socio.memberId,
    planId: plan.id,
  });
  const payment = await post<{ id: string }>(page, "payments", {
    membershipId: ms.id,
    method: "cash",
    amountCents: 30000,
  });
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await login(page, "admin@pilot.cl");
  const current = (await (await page.request.get("/api/v1/cash/sessions/current")).json()).data;
  if (!current) await post(page, "cash/sessions", { openingCents: 0 });
  await post(page, `payments/${payment.id}/validate`, {});
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await login(page, "credito.e2e@pilot.cl");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("1 de 1 disponibles", { exact: true })).toBeVisible();
  await post(page, "bookings", { sessionId: sessions[0]!.id });
  await page.reload();
  await expect(page.getByText("0 de 1 disponibles", { exact: true })).toBeVisible();
  const denied = await page.request.post("/api/v1/bookings", {
    data: { sessionId: sessions[1]!.id },
  });
  expect(denied.status()).toBe(409);
  await page.getByRole("button", { name: "Cancelar reserva", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar cancelación", exact: true }).click();
  await expect(page.getByText("1 de 1 disponibles", { exact: true })).toBeVisible();
  await post(page, "bookings", { sessionId: sessions[1]!.id });
  await page.reload();
  await expect(page.getByText("0 de 1 disponibles", { exact: true })).toBeVisible();
  await expect(page.getByText("2 de 2 disponibles", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/gym-016-credits-mobile.png", fullPage: true });
  const periods = (await (await page.request.get("/api/v1/me/credit-periods")).json()).data;
  expect(periods).toHaveLength(1);
  expect(periods[0].credits.grupal.available).toBe(0);
  expect(periods[0].credits.fija.available).toBe(2);
  expect(periods[0].credits.cita.available).toBe(0);
});
