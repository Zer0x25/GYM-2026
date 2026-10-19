/**
 * Spec 023 — Empaquetado de producción, bootstrap limpio de organización y controles de piloto G2.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  cashSessions,
  createDb,
  members,
  memberships,
  organizations,
  payments,
  plans,
  staffAssignments,
  type Database,
} from "@gym/db";
import { createAuth } from "./auth.js";
import { bootstrapOrganization } from "./bootstrap-org.js";
import { MembersService } from "./services/members.js";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const ROOT_DIR = resolve(import.meta.dirname, "../../..");

describe("Spec 023 — Artefactos de producción G2 (CA-3)", () => {
  it("CA-3: existen Dockerfile, compose.prod.yaml, Caddyfile y scripts de backup/restore con guardias G2", () => {
    for (const rel of [
      "Dockerfile",
      "compose.prod.yaml",
      "Caddyfile",
      "scripts/backup-db.sh",
      "scripts/restore-db.sh",
    ]) {
      expect(existsSync(resolve(ROOT_DIR, rel)), `Falta ${rel}`).toBe(true);
    }
    const compose = readFileSync(resolve(ROOT_DIR, "compose.prod.yaml"), "utf8");
    expect(compose).toContain("ALLOW_MINOR_MEMBERS: ${ALLOW_MINOR_MEMBERS:-false}");
    expect(compose).toContain("EMAIL_DELIVERY_MODE: ${EMAIL_DELIVERY_MODE:-disabled}");
  });
});

describe.skipIf(!DATABASE_URL)("Spec 023 — Bootstrap limpio y guardia de menores G2 (CA-1, CA-2)", () => {
  let db: Database;
  const prevAllowMinor = process.env.ALLOW_MINOR_MEMBERS;

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    await db.execute(
      sql`TRUNCATE organizations, identity_accounts, staff_assignments, members, plans, memberships, payments, cash_sessions, "user" RESTART IDENTITY CASCADE`,
    );
  });

  afterEach(() => {
    if (prevAllowMinor === undefined) {
      delete process.env.ALLOW_MINOR_MEMBERS;
    } else {
      process.env.ALLOW_MINOR_MEMBERS = prevAllowMinor;
    }
  });

  it("CA-1: bootstrapOrganization crea organización + admin autenticable con 0 filas demo y es idempotente", async () => {
    const auth = createAuth({
      db,
      secret: "0123456789abcdef0123456789abcdef0123456789abcdef",
      baseURL: "http://localhost:3000",
    });

    await expect(
      bootstrapOrganization(db, auth, {
        orgName: "Gimnasio G2 Real",
        adminEmail: "admin@g2real.cl",
        adminPassword: "short",
        adminName: "Admin G2",
      }),
    ).rejects.toThrow(/contraseña/i);

    const first = await bootstrapOrganization(db, auth, {
      orgName: "Gimnasio G2 Real",
      adminEmail: "Admin@G2Real.cl",
      adminPassword: "ClaveSeguraPiloto2026!",
      adminName: "Admin G2 Real",
    });
    const second = await bootstrapOrganization(db, auth, {
      orgName: "Gimnasio G2 Real",
      adminEmail: "admin@g2real.cl",
      adminPassword: "ClaveSeguraPiloto2026!",
      adminName: "Admin G2 Real",
    });

    expect(second.organizationId).toBe(first.organizationId);
    expect(second.adminAccountId).toBe(first.adminAccountId);
    expect(first.createdOrganization).toBe(true);
    expect(second.createdOrganization).toBe(false);

    const orgRows = await db.select().from(organizations);
    const staffRows = await db.select().from(staffAssignments);
    const memberRows = await db.select().from(members);
    const planRows = await db.select().from(plans);
    const membershipRows = await db.select().from(memberships);
    const paymentRows = await db.select().from(payments);
    const cashRows = await db.select().from(cashSessions);

    expect(orgRows).toHaveLength(1);
    expect(staffRows).toHaveLength(1);
    expect(staffRows[0]?.role).toBe("admin");
    expect(memberRows).toHaveLength(0);
    expect(planRows).toHaveLength(0);
    expect(membershipRows).toHaveLength(0);
    expect(paymentRows).toHaveLength(0);
    expect(cashRows).toHaveLength(0);
  });

  it("CA-2: ALLOW_MINOR_MEMBERS=false rechaza con 409 MINOR_REGISTRATION_DISABLED el alta o conversión de menores", async () => {
    const [org] = await db.select().from(organizations);
    expect(org).toBeDefined();
    const service = new MembersService(db);
    const actor = { organizationId: org!.id, role: "admin" as const, accountId: "admin-1" };

    const adult = await service.create(actor, {
      fullName: "Adulto Titular G2",
      contactEmail: "adulto@g2real.cl",
    });

    process.env.ALLOW_MINOR_MEMBERS = "false";

    await expect(
      service.create(actor, {
        fullName: "Menor Bloqueado G2",
        isMinor: true,
        adultResponsibleId: adult.id,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "MINOR_REGISTRATION_DISABLED",
    });

    const otherAdult = await service.create(actor, {
      fullName: "Otro Adulto G2",
    });

    await expect(
      service.update(actor, otherAdult.id, {
        isMinor: true,
        adultResponsibleId: adult.id,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "MINOR_REGISTRATION_DISABLED",
    });

    process.env.ALLOW_MINOR_MEMBERS = "true";
    const allowedMinor = await service.create(actor, {
      fullName: "Menor Autorizado G2",
      isMinor: true,
      adultResponsibleId: adult.id,
    });
    expect(allowedMinor.isMinor).toBe(true);
    expect(allowedMinor.adultResponsibleId).toBe(adult.id);
  });
});
