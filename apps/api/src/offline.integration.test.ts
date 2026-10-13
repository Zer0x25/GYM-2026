/**
 * Entrega 4 integration tests — offline controlado (spec 005, REQ-9).
 *
 * Concurrency invariants verified against a REAL Postgres:
 *   TX-06 (idempotencia): dos sync simultáneos del MISMO event_id → un solo
 *         efecto (un pago, un evento); el duplicado devuelve el resultado
 *         almacenado sin re-aplicar.
 *   TX-06 (duplicado de negocio): dos event_id DISTINTOS con la misma huella
 *         (folio + tipo + monto) → ambos se conservan, el segundo marcado
 *         duplicado_negocio (nunca se descarta).
 *   SPEC:PAY-01/prohibición: el cobro_provisional offline crea pago provisional
 *         SIN movimiento de caja ni cobertura.
 *   SPEC:OFF-FRESH: ingreso_contingencia con instantánea vencida → 409.
 *   REQ-1/TX-07: un dispositivo/evento de otro tenant es inalcanzable (404).
 *
 * Isolated DB: gym_test_offline (:55432). TRUNCATE-clean per test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createDb } from "@gym/db";
import { createAuth } from "./auth.js";
import { OfflineService } from "./services/offline.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://gym:***@localhost:55432/gym_test_offline";
const RUN = Boolean(process.env.TEST_DATABASE_URL);

const db = createDb(DATABASE_URL);
const auth = createAuth({ db, secret: "test-secret-32-chars-minimum-xxxxxxxxxxx", baseURL: "http://localhost:3000" });
const offline = new OfflineService(db);

const ORG = randomUUID();
const PLAN = randomUUID();
let ADMIN = "acc-offline-admin";
let MEMBER = "";
let DEVICE = "";

const adminActor = { organizationId: ORG, accountId: ADMIN, role: "admin" as const };

async function truncateAll() {
  await db.execute(sql`
    TRUNCATE membership_snapshots, offline_events, devices,
             payments, cash_sessions, cash_movements, audit_log,
             memberships, plans, members, staff_assignments,
             identity_accounts, organizations, "user", session, account, verification
    RESTART IDENTITY CASCADE
  `);
}

async function seedOrg() {
  await db.execute(sql`INSERT INTO organizations (id, name, offline_enabled, offline_freshness_hours)
                          VALUES (${ORG}, 'Gym Offline', true, 72) ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`INSERT INTO plans (id, organization_id, name, price_cents, duration_days, coverage, active)
                          VALUES (${PLAN}, ${ORG}, 'Mensual', 30000, 30, 'unlimited', true)
                          ON CONFLICT (id) DO NOTHING`);
  const user = await auth.api.createUser({
    body: { email: "admin-off@test.cl", password: "SuperSecret123!", name: "Admin Off", data: { emailVerified: true } },
  });
  ADMIN = user.user.id;
  adminActor.accountId = ADMIN;

  MEMBER = randomUUID();
  await db.execute(sql`INSERT INTO members (id, organization_id, full_name) VALUES (${MEMBER}, ${ORG}, 'Socio Off')`);
  await db.execute(sql`INSERT INTO memberships (id, organization_id, member_id, plan_id, start_at, end_at)
                          VALUES (${randomUUID()}, ${ORG}, ${MEMBER}, ${PLAN}, now(), now() + interval '30 days')`);

  const device = await offline.registerDevice(adminActor, { accountId: ADMIN, label: "Tablet recepción" });
  DEVICE = device.id;
}

function cobroEvent(eventId: string, folio: string, amount = 30000) {
  return {
    eventId,
    type: "cobro_provisional" as const,
    folioExterno: folio,
    memberId: MEMBER,
    capturedAt: new Date().toISOString(),
    amountCents: amount,
    method: "cash" as const,
  };
}

describe.skipIf(!RUN)("Entrega 4 — offline controlado (spec 005)", () => {
  beforeAll(async () => {
    const alive = await db.execute(sql`SELECT 1`).then(() => true).catch(() => false);
    if (!alive) throw new Error("Test DB not reachable: " + DATABASE_URL);
    await seedOrg();
  });

  afterAll(async () => {
    await truncateAll();
  });

  beforeEach(async () => {
    await truncateAll();
    await seedOrg();
  });

  // TX-06 idempotencia: mismo event_id, dos sync concurrentes → un efecto.
  it("TX-06: mismo event_id reenviado aplica el efecto una sola vez (concurrencia real)", async () => {
    const ev = cobroEvent(randomUUID(), "F-100");
    const results = await Promise.allSettled([
      offline.sync(adminActor, { deviceId: DEVICE, events: [ev] }),
      offline.sync(adminActor, { deviceId: DEVICE, events: [ev] }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);

    // Exactamente un pago provisional creado para ese event_id.
    const payments = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM payments WHERE reference = 'F-100'`,
    );
    expect(Number((payments[0] as { n: number }).n)).toBe(1);

    // Exactamente un evento almacenado (idempotency key).
    const events = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM offline_events WHERE event_id = ${ev.eventId}`,
    );
    expect(Number((events[0] as { n: number }).n)).toBe(1);

    // Y ese pago es provisional (sin derechos, sin movimiento de caja).
    const pay = await db.execute(sql`SELECT state FROM payments WHERE reference = 'F-100'`);
    expect((pay[0] as { state: string }).state).toBe("provisional");
    const movements = await db.execute(sql`SELECT COUNT(*)::int AS n FROM cash_movements`);
    expect(Number((movements[0] as { n: number }).n)).toBe(0);
  });
  // TX-06 duplicado de negocio: dos event_id, misma huella → ambos + marca.
  it("TX-06: dos event_id con misma huella de negocio → ambos conservados, segundo marcado", async () => {
    const r1 = await offline.sync(adminActor, { deviceId: DEVICE, events: [cobroEvent(randomUUID(), "F-200", 50000)] });
    const r2 = await offline.sync(adminActor, { deviceId: DEVICE, events: [cobroEvent(randomUUID(), "F-200", 50000)] });

    const res1 = r1.results[0]!;
    const res2 = r2.results[0]!;
    expect(res1.status).toBe("sincronizado");
    expect(res2.status).toBe("duplicado");

    // Ambos eventos conservados (no se descarta ninguno).
    const events = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM offline_events WHERE folio_externo = 'F-200'`,
    );
    expect(Number((events[0] as { n: number }).n)).toBe(2);

    // El segundo marcado duplicado_negocio.
    const dup = await db.execute(
      sql`SELECT state FROM offline_events WHERE event_id = ${res2.eventId}`,
    );
    expect((dup[0] as { state: string }).state).toBe("duplicado_negocio");
  });

  // Dispositivo revocado: eventos conservados y marcados rechazado, sin efectos.
  it("dispositivo revocado conserva los eventos marcados rechazado, sin efectos", async () => {
    await offline.revokeDevice(adminActor, DEVICE);
    const r = await offline.sync(adminActor, { deviceId: DEVICE, events: [cobroEvent(randomUUID(), "F-300")] });
    expect(r.results[0]!.status).toBe("rechazado");
    const payments = await db.execute(sql`SELECT COUNT(*)::int AS n FROM payments WHERE reference = 'F-300'`);
    expect(Number((payments[0] as { n: number }).n)).toBe(0);
  });

  // Frescura: instantánea vencida → 409.
  it("SPEC:OFF-FRESH: ingreso con instantánea vencida se rechaza (409)", async () => {
    const stale = new Date(Date.now() - 80 * 3600 * 1000).toISOString(); // > 72h
    await expect(
      offline.ingressContingencia(adminActor, {
        deviceId: DEVICE,
        memberId: MEMBER,
        snapshotCapturedAt: stale,
        coverage: "unlimited",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  // Frescura OK: instantánea reciente pasa.
  it("SPEC:OFF-FRESH: ingreso con instantánea fresca se admite", async () => {
    const fresh = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
    const r = await offline.ingressContingencia(adminActor, {
      deviceId: DEVICE,
      memberId: MEMBER,
      snapshotCapturedAt: fresh,
      coverage: "unlimited",
    });
    expect(r.admitted).toBe(true);
  });

  // Reconstrucción: cadena íntegra tras varios eventos.
  it("SPEC:OFF-RECON: la cadena de hashes queda íntegra tras varios eventos", async () => {
    await offline.sync(adminActor, { deviceId: DEVICE, events: [cobroEvent(randomUUID(), "F-400", 10000)] });
    await offline.sync(adminActor, { deviceId: DEVICE, events: [cobroEvent(randomUUID(), "F-401", 20000)] });
    const recon = await offline.reconstruct(ORG, DEVICE);
    expect(recon.eventsChecked).toBe(2);
    expect(recon.chainIntact).toBe(true);
    expect(recon.brokenAt).toBeNull();
  });

  // Cross-tenant: dispositivo de otro tenant → 404.
  it("TX-07: dispositivo de otro tenant es not-found (anti-enumeración)", async () => {
    await expect(offline.getDevice(randomUUID(), DEVICE)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
