import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill("SuperSecret123!");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ingresar", exact: true })).not.toBeVisible();
}
async function get(page: Page, path: string) {
  const response = await page.request.get(`/api/v1/${path}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(`/api/v1/${path}`, { data });
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}
async function closeCurrent(page: Page) {
  const current = await get(page, "cash/sessions/current");
  if (!current) return;
  const detail = await get(page, `cash/sessions/${current.id}`);
  const total =
    current.openingCents +
    detail.movements.reduce(
      (sum: number, row: { amountCents: number }) => sum + row.amountCents,
      0,
    ) -
    (detail.adjustments ?? []).reduce(
      (sum: number, row: { amountCents: number }) => sum + row.amountCents,
      0,
    );
  await post(page, `cash/sessions/${current.id}/close`, { declaredClosingCents: total });
}
test("SPEC 014 devolución explícita conserva pago/membresía y caja neta", async ({
  page,
  browser,
}) => {
  await login(page, "admin@pilot.cl");
  await closeCurrent(page);
  const shift = await post(page, "cash/sessions", { openingCents: 1000 });
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const reception = await context.newPage();
  try {
    await login(reception, "recepcion@pilot.cl");
    const member = await post(reception, "members", { fullName: "Socio Ajuste E2E" });
    const plans = await get(reception, "plans");
    const membership = await post(reception, "memberships", {
      memberId: member.id,
      planId: plans[0].id,
    });
    const payment = await post(reception, "payments", {
      membershipId: membership.id,
      amountCents: 30000,
      method: "cash",
    });
    await post(page, `payments/${payment.id}/validate`, {});
    const original = await get(page, `payments/${payment.id}`);
    const originalMembership = (await get(page, "memberships")).find(
      (row: { id: string }) => row.id === membership.id,
    );
    await page.goto("/payments");
    await page.getByRole("button", { name: "Validados", exact: true }).click();
    await page.getByRole("searchbox", { name: "Buscar pagos" }).fill("Socio Ajuste E2E");
    await page.getByRole("button", { name: "Devolver / ajustar" }).click();
    await page.getByLabel("Importe a compensar (CLP)").fill("5000");
    await page.getByLabel("Motivo de la compensación").fill("Devolución parcial autorizada");
    await page.getByRole("button", { name: "Revisar compensación" }).click();
    expect((await get(page, `payments/${payment.id}/adjustments`)).items).toHaveLength(0);
    await page.getByRole("button", { name: "Confirmar devolución", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Compensar pago validado" })).not.toBeVisible();
    await expect
      .poll(async () => (await get(page, `payments/${payment.id}/adjustments`)).items)
      .toHaveLength(1);
    expect(await get(page, `payments/${payment.id}`)).toEqual(original);
    expect(
      (await get(page, "memberships")).find((row: { id: string }) => row.id === membership.id),
    ).toEqual(originalMembership);
    await page.goto("/cash");
    await expect(page.getByRole("cell", { name: "Devolución", exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () =>
        page.locator("aside").evaluate((element) => element.getBoundingClientRect().right),
      )
      .toBeLessThanOrEqual(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: "/tmp/gym-014-cash-mobile.png", fullPage: true });
    const closed = await post(page, `cash/sessions/${shift.id}/close`, {
      declaredClosingCents: 26000,
    });
    expect(closed).toMatchObject({ expectedClosingCents: 26000, discrepancyCents: 0 });
  } finally {
    await context.close();
    await closeCurrent(page);
    await post(page, "cash/sessions", { openingCents: 0 });
  }
});
