import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill("SuperSecret123!");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ingresar", exact: true })).not.toBeVisible();
}
async function get(page: Page, resource: string) {
  const response = await page.request.get(`/api/v1/${resource}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).data;
}
test("SPEC 012 CA-5 Transbank manual conserva evidencia, se valida separado y exporta desglose", async ({
  page,
  browser,
}) => {
  await login(page, "admin@pilot.cl");
  let shift = await get(page, "cash/sessions/current");
  if (!shift) {
    const response = await page.request.post("/api/v1/cash/sessions", {
      data: { openingCents: 0 },
    });
    expect(response.status()).toBe(201);
    shift = (await response.json()).data;
  }
  const plans = await get(page, "plans");
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    locale: "es-CL",
    timezoneId: "America/Santiago",
    viewport: { width: 390, height: 844 },
  });
  const reception = await context.newPage();
  try {
    await login(reception, "recepcion@pilot.cl");
    const response = await reception.request.post("/api/v1/members", {
      data: { fullName: "Socio Transbank E2E" },
    });
    expect(response.status()).toBe(201);
    const member = (await response.json()).data;
    const assigned = await reception.request.post("/api/v1/memberships", {
      data: { memberId: member.id, planId: plans[0].id },
    });
    expect(assigned.status()).toBe(201);
    await reception.goto(`/panel/${member.id}`);
    await expect(
      reception.getByRole("heading", { name: "Socio Transbank E2E", exact: true }),
    ).toBeVisible();
    expect(
      await reception.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await reception.getByRole("button", { name: "Registrar cobro" }).click();
    await reception.getByRole("button", { name: new RegExp(plans[0].name) }).click();
    await reception.getByRole("button", { name: "Transbank externo" }).click();
    await expect(
      reception.getByRole("button", { name: "Registrar pago", exact: true }),
    ).toBeDisabled();
    await reception.getByLabel("Número de operación (obligatorio)").fill("OP-E2E-012");
    await reception.getByLabel("Comentario (obligatorio)").fill("Terminal externo mostrador");
    await reception.screenshot({ path: "/tmp/gym-012-transbank-mobile.png", fullPage: true });
    await reception.getByRole("button", { name: "Registrar pago", exact: true }).click();
    await expect(reception.getByText("OP-E2E-012", { exact: true })).toBeVisible();
    await expect(reception.getByText("Terminal externo mostrador", { exact: true })).toBeVisible();
    const rows = await get(reception, "payments?state=provisional");
    const payment = rows.find((row: { memberId: string }) => row.memberId === member.id);
    expect(payment).toMatchObject({
      method: "transbank",
      reference: "OP-E2E-012",
      comment: "Terminal externo mostrador",
      state: "provisional",
    });
    await page.goto("/payments");
    await page.getByRole("searchbox", { name: "Buscar pagos" }).fill("Socio Transbank E2E");
    await expect(page.getByText("Transbank externo", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Validar", exact: true }).click();
    expect((await get(page, `payments/${payment.id}`)).state).toBe("provisional");
    await page.getByRole("button", { name: "Confirmar validación" }).click();
    await expect
      .poll(async () => (await get(page, `payments/${payment.id}`)).state)
      .toBe("validated");
    const detail = await get(page, `cash/sessions/${shift.id}`);
    expect(
      detail.movements.filter((row: { paymentId: string }) => row.paymentId === payment.id),
    ).toHaveLength(1);
    expect(
      detail.movements.find((row: { paymentId: string }) => row.paymentId === payment.id).method,
    ).toBe("transbank");
    await page.goto("/reportes");
    await expect(page.getByText("Transbank externo", { exact: true })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar CSV" }).click();
    const csv = await readFile((await (await download).path())!, "utf8");
    expect(csv.split("\r\n")[0]).toContain("Transbank externo CLP");
    expect(Number(csv.split("\r\n")[1]!.split(",")[3])).toBe(payment.amountCents);
  } finally {
    await context.close();
  }
});
