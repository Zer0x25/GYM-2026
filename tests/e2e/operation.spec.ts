import { test, expect, type Page } from "@playwright/test";
const password = "SuperSecret123!";
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ingresar", exact: true })).not.toBeVisible();
}
async function get<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(`/api/v1/${path}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}
test.describe.serial("SPEC 010 jornada de gimnasio", () => {
  let newMemberId = "",
    paymentId = "",
    sessionId = "";
  test("recepción crea socio con portal, asigna plan y registra pago pendiente", async ({
    page,
  }) => {
    await login(page, "recepcion@pilot.cl");
    await expect(page.getByRole("heading", { name: "Mostrador", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Socios", exact: true }).click();
    await page.getByRole("button", { name: "Nuevo socio" }).click();
    await page.getByLabel("Nombre completo").fill("Camila E2E");
    await page.getByLabel("Email de contacto").fill("camila.e2e@pilot.cl");
    await page.getByLabel("Contraseña inicial").fill(password);
    await page.getByLabel("Plan inicial").selectOption({ label: "Mensual · 30 días" });
    await page.getByRole("button", { name: "Crear socio", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Camila E2E", exact: true })).toBeVisible();
    newMemberId = page.url().split("/").pop()!;
    await page.getByRole("button", { name: "Registrar cobro" }).click();
    await page.getByRole("button", { name: /Mensual/ }).click();
    await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
    await expect(page.getByText("Provisional", { exact: true })).toBeVisible();
    const rows = await get<{ id: string; memberId: string; state: string }[]>(
      page,
      "payments?state=provisional",
    );
    paymentId = rows.find((p) => p.memberId === newMemberId)!.id;
    expect(paymentId).toBeTruthy();
    const check = await page.request.post(`/api/v1/members/${newMemberId}/checkin`);
    expect((await check.json()).data.allowed).toBe(false);
  });
  test("administración confirma explícitamente y el estado persistido habilita ingreso", async ({
    page,
  }) => {
    await login(page, "admin@pilot.cl");
    await page.goto("/payments");
    await page.getByRole("searchbox", { name: "Buscar pagos" }).fill("Camila E2E");
    await page.getByRole("button", { name: "Validar", exact: true }).click();
    expect((await get<{ state: string }>(page, `payments/${paymentId}`)).state).toBe("provisional");
    await page.getByRole("button", { name: "Confirmar validación" }).click();
    await expect(page.getByText("No hay pagos en esta selección.")).toBeVisible();
    expect((await get<{ state: string }>(page, `payments/${paymentId}`)).state).toBe("validated");
    const check = await page.request.post(`/api/v1/members/${newMemberId}/checkin`);
    expect((await check.json()).data.allowed).toBe(true);
    const movements = await get<{ session: unknown; movements: { paymentId: string }[] }>(
      page,
      `cash/sessions/${(await get<{ id: string }>(page, "cash/sessions/current")).id}`,
    );
    expect(movements.movements.filter((m) => m.paymentId === paymentId)).toHaveLength(1);
  });
  test("agenda publica cita personalizada usando instructor del equipo", async ({ page }) => {
    await login(page, "admin@pilot.cl");
    await page.goto("/clases");
    await page.getByRole("button", { name: "Programar sesión", exact: true }).click();
    await page.getByLabel("Modalidad").selectOption("cita");
    await page
      .getByRole("dialog", { name: "Programar sesión" })
      .getByLabel("Instructor", { exact: true })
      .selectOption({ label: "Instructor Piloto" });
    const start = new Date(Date.now() + 4 * 3600000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    const local = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.getByLabel("Inicio", { exact: true }).fill(local(start));
    await page.getByLabel("Fin", { exact: true }).fill(local(end));
    await page.getByRole("button", { name: "Crear sesión", exact: true }).click();
    await expect(page.getByText("Cita personalizada", { exact: true }).first()).toBeVisible();
    const sessions = await get<{ id: string; type: string }[]>(page, "schedule");
    sessionId = sessions.find((s) => s.type === "cita")!.id;
  });
  test("socio móvil ve QR, reserva, cancela y conserva contacto hasta verificar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "camila.e2e@pilot.cl");
    await expect(page.getByRole("heading", { name: "Mi acceso" })).toBeVisible();
    await expect(page.getByAltText("Código QR personal de ingreso")).toBeVisible();
    await page.screenshot({ path: "/tmp/gym-portal-mobile.png", fullPage: true });
    await expect(page.getByText("Activa", { exact: true })).toBeVisible();
    const card = page.getByText("Cita personalizada", { exact: true }).locator("..").locator("..");
    await card.getByRole("button", { name: "Reservar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cancelar reserva" })).toBeVisible();
    const bookings = await get<{ id: string; sessionId: string; state: string }[]>(
      page,
      "bookings/mine",
    );
    expect(bookings.find((b) => b.sessionId === sessionId)?.state).toBe("confirmada");
    await page.getByRole("button", { name: "Cancelar reserva" }).click();
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();
    await expect(page.getByRole("button", { name: "Cancelar reserva" })).not.toBeVisible();
    expect(
      (await get<{ id: string; sessionId: string; state: string }[]>(page, "bookings/mine")).find(
        (b) => b.sessionId === sessionId,
      )?.state,
    ).toBe("cancelada");
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page.getByLabel("Email de contacto").fill("nuevo.contacto@pilot.cl");
    const previous = await get<{ contactEmail: string }>(page, "members/me");
    await page.getByRole("button", { name: "Solicitar verificación" }).click();
    await expect(page.getByText(/envío de correos está pendiente/)).toBeVisible();
    expect((await get<{ contactEmail: string }>(page, "members/me")).contactEmail).toBe(
      previous.contactEmail,
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Mi acceso" })).toBeVisible();
    await expect(page.getByText(previous.contactEmail, { exact: true })).toBeVisible();
    expect((await page.request.get("/api/v1/staff")).status()).toBe(403);
    expect((await page.request.get("/api/v1/payments")).status()).toBe(403);
    const width = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  });
  test("instructor entra en su agenda sin acciones financieras", async ({ page }) => {
    await login(page, "instructor@pilot.cl");
    await expect(page.getByRole("heading", { name: "Clases y agenda" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Caja", exact: true })).not.toBeVisible();
    expect((await page.request.get("/api/v1/payments")).status()).toBe(403);
  });
  test("dos dispositivos offline conservan cobros y reconcilian sin duplicar", async ({
    browser,
  }) => {
    const a = await browser.newContext(),
      b = await browser.newContext();
    const pageA = await a.newPage(),
      pageB = await b.newPage();
    for (const page of [pageA, pageB]) await login(page, "recepcion@pilot.cl");
    const admin = await browser.newContext();
    const adminPage = await admin.newPage();
    await login(adminPage, "admin@pilot.cl");
    const staff = await get<{ id: string; role: string }[]>(adminPage, "staff");
    const reception = staff.find((s) => s.role === "recepcion")!.id;
    expect(
      (await adminPage.request.post("/api/v1/offline/policy", { data: { enabled: true } })).ok(),
    ).toBeTruthy();
    let i = 0;
    for (const page of [pageA, pageB]) {
      const label = `E2E-Tablet-${++i}`;
      expect(
        (
          await adminPage.request.post("/api/v1/devices", { data: { accountId: reception, label } })
        ).ok(),
      ).toBeTruthy();
      await page.goto("/contingencia");
      await page.getByLabel("Dispositivo asignado a mi cuenta").selectOption({ label });
      await page
        .getByLabel("Frase local (mínimo 12 caracteres)")
        .fill("frase-e2e-contingencia-segura");
      await page.getByRole("button", { name: "Preparar contingencia", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Registrar contingencia" })).toBeVisible();
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.context().setOffline(true);
      await page.getByLabel("Socio", { exact: true }).selectOption({ label: "Camila E2E" });
      await page.getByLabel("Folio externo obligatorio").fill(`F-E2E-${i}`);
      await page.getByLabel("Monto (CLP)").fill("1000");
      await page.getByRole("button", { name: "Guardar cobro provisional" }).click();
      await expect(page.getByText("Pendiente de sincronización", { exact: true })).toBeVisible();
      await page.reload();
      await page.getByLabel("Dispositivo guardado").selectOption({ label });
      await page.getByLabel("Frase local de contingencia").fill("frase-e2e-contingencia-segura");
      await page.getByRole("button", { name: "Desbloquear", exact: true }).click();
      await expect(page.getByText("Pendiente de sincronización", { exact: true })).toBeVisible();
      const cachedApi = await page.evaluate(async () => {
        const keys = await caches.keys();
        const requests = (
          await Promise.all(
            keys.map(async (key) => (await (await caches.open(key)).keys()).map((r) => r.url)),
          )
        ).flat();
        return requests.filter((url) => new URL(url).pathname.startsWith("/api/"));
      });
      expect(cachedApi).toEqual([]);
      await page.context().setOffline(false);
      await page.getByRole("button", { name: "Sincronizar y revalidar" }).click();
      await expect(page.getByText("Reconocido por el servidor", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Sincronizar y revalidar" }).click();
    }
    const payments = await get<{ reference: string; state: string }[]>(adminPage, "payments");
    expect(payments.filter((p) => p.reference?.startsWith("F-E2E-"))).toHaveLength(2);
    expect(
      payments
        .filter((p) => p.reference?.startsWith("F-E2E-"))
        .every((p) => p.state === "provisional"),
    ).toBe(true);
    await a.close();
    await b.close();
    await admin.close();
  });
  test("cierre de turno confirmado guarda diferencia y actualiza estado de caja", async ({
    page,
  }) => {
    await login(page, "recepcion@pilot.cl");
    await page.goto("/cash");
    const current = await get<{ id: string; openingCents: number }>(page, "cash/sessions/current");
    const detail = await get<{ movements: { amountCents: number }[] }>(
      page,
      `cash/sessions/${current.id}`,
    );
    const expected = current.openingCents + detail.movements.reduce((s, m) => s + m.amountCents, 0);
    await page.getByRole("button", { name: "Cerrar turno", exact: true }).click();
    await page.getByLabel("Monto declarado al cierre (CLP)").fill(String(expected + 100));
    await page.getByRole("button", { name: "Confirmar cierre" }).click();
    await expect(page.getByText("Último cierre", { exact: true })).toBeVisible();
    expect(await get(page, "cash/sessions/current")).toBeNull();
    expect(
      (await get<{ session: { discrepancyCents: number } }>(page, `cash/sessions/${current.id}`))
        .session.discrepancyCents,
    ).toBe(100);
    await expect(page.getByRole("link", { name: "Caja cerrada" })).toBeVisible();
  });
  test("administración descarga los 4 reportes CSV en reports", async ({ page }) => {
    await login(page, "admin@pilot.cl");
    await page.goto("/reportes");
    await expect(page.getByRole("button", { name: /Exportar CSV/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Exportar socios CSV/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Exportar vigencias CSV/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Exportar asistencia CSV/i })).toBeVisible();

    const membersRes = await page.request.get("/api/v1/reports/members.csv");
    expect(membersRes.status()).toBe(200);
    expect(membersRes.headers()["content-type"]).toContain("text/csv");
    const membersCsv = await membersRes.text();
    expect(membersCsv).toContain("member_id,full_name,contact_email");
    expect(membersCsv).toContain("Camila E2E");
    expect(membersCsv).not.toContain("qrToken");

    const membershipsRes = await page.request.get("/api/v1/reports/memberships.csv");
    expect(membershipsRes.status()).toBe(200);
    expect(membershipsRes.headers()["content-type"]).toContain("text/csv");
    const membershipsCsv = await membershipsRes.text();
    expect(membershipsCsv).toContain("membership_id,member_id,member_name");

    const today = new Date().toISOString().slice(0, 10);
    const attendanceRes = await page.request.get(
      `/api/v1/reports/attendance.csv?from=${today}&to=${today}`,
    );
    expect(attendanceRes.status()).toBe(200);
    expect(attendanceRes.headers()["content-type"]).toContain("text/csv");
    const attendanceCsv = await attendanceRes.text();
    expect(attendanceCsv).toContain("booking_id,session_id,session_type");
  });

  test("SPEC 018 reprogramación de sesión actualiza horario, muestra distintivo y se refleja en portal", async ({
    page,
    browser,
  }) => {
    // 1. Recepción publica una cita y reserva para Camila
    await login(page, "recepcion@pilot.cl");
    await page.goto("/clases");
    await page.getByRole("button", { name: "Programar sesión", exact: true }).click();
    await page.getByLabel("Modalidad").selectOption("cita");
    await page
      .getByRole("dialog", { name: "Programar sesión" })
      .getByLabel("Instructor", { exact: true })
      .selectOption({ label: "Instructor Piloto" });
    const start = new Date(Date.now() + 10 * 3600000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    const local = (d: Date) =>
      new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.getByLabel("Inicio", { exact: true }).fill(local(start));
    await page.getByLabel("Fin", { exact: true }).fill(local(end));
    const [resCreate] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/api/v1/sessions") && res.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Crear sesión", exact: true }).click(),
    ]);
    expect(resCreate.ok()).toBe(true);
    const newSession = (await resCreate.json()).data as { id: string };
    expect(newSession?.id).toBeTruthy();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // 2. Entrar al detalle y reservar para Camila
    await page.goto(`/clases/${newSession.id}`);
    await page.getByLabel("Reservar para un socio").selectOption({ label: "Camila E2E" });
    await page.getByRole("button", { name: "Confirmar reserva" }).click();
    await expect(page.getByText("Camila E2E")).toBeVisible();

    // 3. Reprogramar la cita 2 horas después
    await page.getByRole("button", { name: "Reprogramar sesión" }).click();
    const newStart = new Date(start.getTime() + 2 * 3600000);
    const newEnd = new Date(newStart.getTime() + 3600000);
    await page.getByLabel("Nuevo inicio").fill(local(newStart));
    await page.getByLabel("Nuevo fin").fill(local(newEnd));
    await page.getByLabel("Motivo (opcional)").fill("Cambio de turno convenido");
    const [resReschedule] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes("/reschedule") && res.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Confirmar reprogramación" }).click(),
    ]);
    expect(resReschedule.ok()).toBe(true);
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // 4. Verificar distintivo en detalle y en agenda
    await expect(page.getByText("Horario reprogramado")).toBeVisible();
    await page.goto("/clases");
    await expect(page.getByText("Horario reprogramado").first()).toBeVisible();

    // 5. Socio entra al portal y ve su reserva con Horario reprogramado
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await login(memberPage, "camila.e2e@pilot.cl");
    await expect(memberPage.getByText("Horario reprogramado").first()).toBeVisible();
    await memberCtx.close();
  });
});

