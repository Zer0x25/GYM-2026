/**
 * Dev seed: creates the pilot organization + admin/socio accounts with known
 * credentials so the app is usable with one command. Idempotent: existing
 * rows are reused, never duplicated.
 *
 * Run:  pnpm --filter @gym/api seed:dev     (requires DATABASE_URL + AUTH_SECRET)
 *
 * Credentials (FICTIONAL — dev only, never production):
 *   org:     "Gimnasio Piloto"
 *   admin:   admin@pilot.cl   / SuperSecret123!   (role admin)
 *   socio:   socio@pilot.cl   / SuperSecret123!   (role socio)
 *   miembro: "Miembro Sin Cuenta" (member without login)
 *
 * Entrega 2 demo data (money flows for human review):
 *   - 2 plans (Mensual $30.000 / Trimestral $80.000)
 *   - memberships in each state: pending_payment, active, expired
 *   - an OPEN cash session (opening $20.000) so payments can be validated
 *   - 2 provisional payments (awaiting admin decision) + 1 validated
 */
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import {
  cashMovements,
  cashSessions,
  createDb,
  identityAccounts,
  members,
  memberships,
  organizations,
  payments,
  plans,
  staffAssignments,
  classTemplates,
  sessions,
  authUsers,
} from "@gym/db";
import { createAuth } from "./auth.js";

const log = (msg: string) => {
  process.stdout.write(`${msg}\n`);
};

const DB_URL = process.env.DATABASE_URL;
const SECRET = process.env.AUTH_SECRET;

if (!DB_URL) {
  process.stderr.write(
    "Falta DATABASE_URL (ej: postgres://gym:gym-local-dev@localhost:5432/gym)\n",
  );
  process.exit(1);
}
if (!SECRET || SECRET.length < 32) {
  process.stderr.write("Falta AUTH_SECRET (>=32 chars). Ej: openssl rand -base64 32\n");
  process.exit(1);
}

const ORG_NAME = "Gimnasio Piloto";
const DEV_PASSWORD = "SuperSecret123!";
const DEV_ADMIN = { email: "admin@pilot.cl", password: DEV_PASSWORD, name: "Admin Piloto" };
const DEV_SOCIO = { email: "socio@pilot.cl", password: DEV_PASSWORD, name: "Socio Piloto" };
// Extra staff so the dev login quick-role buttons have a home to land on.
const DEV_STAFF: { email: string; name: string; role: "admin" | "recepcion" | "instructor" }[] = [
  { email: "admin2@pilot.cl", name: "Segundo Admin Piloto", role: "admin" },
  { email: "recepcion@pilot.cl", name: "Recepción Piloto", role: "recepcion" },
  { email: "instructor@pilot.cl", name: "Instructor Piloto", role: "instructor" },
];

const db = createDb(DB_URL);
const auth = createAuth({
  db,
  secret: SECRET,
  baseURL: process.env.AUTH_URL ?? "http://localhost:3000",
});

async function ensureAccount(email: string, password: string, name: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(identityAccounts)
    .where(eq(identityAccounts.email, email));
  if (existing) {
    log(`  cuenta ya existe: ${email}`);
    return existing.id;
  }
  const created = await auth.api.createUser({
    body: { email, password, name, data: { emailVerified: true } },
  });
  await db
    .insert(identityAccounts)
    .values({ id: created.user.id, email, passwordHash: "better-auth" });
  log(`  cuenta creada: ${email}`);
  return created.user.id;
}

async function main() {
  // --- Organization (idempotent by name) -----------------------------------
  let [org] = await db.select().from(organizations).where(eq(organizations.name, ORG_NAME));
  if (!org) {
    [org] = await db.insert(organizations).values({ name: ORG_NAME }).returning();
    log(`organización creada: ${ORG_NAME}`);
  } else {
    log(`organización ya existe: ${ORG_NAME}`);
  }
  if (!org) throw new Error("No se pudo crear/obtener la organización");

  // --- Admin ----------------------------------------------------------------
  const adminId = await ensureAccount(DEV_ADMIN.email, DEV_ADMIN.password, DEV_ADMIN.name);
  const [adminAssignment] = await db
    .select()
    .from(staffAssignments)
    .where(
      and(eq(staffAssignments.accountId, adminId), eq(staffAssignments.organizationId, org.id)),
    );
  if (!adminAssignment) {
    await db
      .insert(staffAssignments)
      .values({ organizationId: org.id, accountId: adminId, role: "admin" });
    log(`  rol admin asignado en ${ORG_NAME}`);
  }

  // --- Extra staff (recepcion / instructor) for dev quick-login --------------
  for (const staff of DEV_STAFF) {
    const staffId = await ensureAccount(staff.email, DEV_PASSWORD, staff.name);
    const [existing] = await db
      .select()
      .from(staffAssignments)
      .where(
        and(eq(staffAssignments.accountId, staffId), eq(staffAssignments.organizationId, org.id)),
      );
    if (!existing) {
      await db
        .insert(staffAssignments)
        .values({ organizationId: org.id, accountId: staffId, role: staff.role });
      log(`  rol ${staff.role} asignado: ${staff.email}`);
    }
  }

  // --- Socio (account + member) ---------------------------------------------
  const socioAccountId = await ensureAccount(DEV_SOCIO.email, DEV_SOCIO.password, DEV_SOCIO.name);
  const [socioMember] = await db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, org.id), eq(members.contactEmail, DEV_SOCIO.email)));
  if (!socioMember) {
    await db.insert(members).values({
      organizationId: org.id,
      accountId: socioAccountId,
      qrToken: crypto.randomUUID().replaceAll("-", ""),
      fullName: DEV_SOCIO.name,
      contactEmail: DEV_SOCIO.email,
    });
    log(`  miembro creado: ${DEV_SOCIO.name}`);
  } else if (!socioMember.accountId) {
    await db
      .update(members)
      .set({ accountId: socioAccountId })
      .where(eq(members.id, socioMember.id));
  }

  // --- Member without login --------------------------------------------------
  const [plainMember] = await db
    .select()
    .from(members)
    .where(eq(members.fullName, "Miembro Sin Cuenta"));
  if (!plainMember) {
    await db.insert(members).values({
      organizationId: org.id,
      fullName: "Miembro Sin Cuenta",
      qrToken: crypto.randomUUID().replaceAll("-", ""),
    });
    log("  miembro sin cuenta creado");
  }

  const [recep] = await db
    .select()
    .from(identityAccounts)
    .where(eq(identityAccounts.email, "recepcion@pilot.cl"));
  await seedEntrega2(org.id, adminId, recep!.id);
  // Explicit fictional legacy snapshots for direct demo windows; no limited quotas invented.
  await db.execute(sql`INSERT INTO membership_periods (organization_id,member_id,membership_id,starts_at,ends_at,coverage,plan_name,price_cents,duration_days)
    SELECT m.organization_id,m.member_id,m.id,m.start_at,m.end_at,p.coverage,p.name,p.price_cents,p.duration_days
    FROM memberships m JOIN plans p ON p.id=m.plan_id AND p.organization_id=m.organization_id
    WHERE m.organization_id=${org.id} AND m.start_at IS NOT NULL AND m.end_at>m.start_at
    AND NOT EXISTS (SELECT 1 FROM membership_periods mp WHERE mp.membership_id=m.id)`);
  const [coach] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.email, "instructor@pilot.cl"));
  let [template] = await db
    .select()
    .from(classTemplates)
    .where(
      and(
        eq(classTemplates.organizationId, org.id),
        eq(classTemplates.name, "Entrenamiento funcional"),
      ),
    );
  if (!template) {
    [template] = await db
      .insert(classTemplates)
      .values({
        organizationId: org.id,
        name: "Entrenamiento funcional",
        type: "grupal",
        capacity: 12,
        reservationWindowHours: 0,
        cancellationWindowHours: 24,
        coverageRequired: "unlimited",
      })
      .returning();
  }
  const [next] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.organizationId, org.id),
        eq(sessions.templateId, template!.id),
        eq(sessions.state, "programada"),
      ),
    );
  if (!next && coach) {
    const start = new Date(Date.now() + 24 * 3600000);
    start.setMinutes(0, 0, 0);
    await db.insert(sessions).values({
      organizationId: org.id,
      templateId: template!.id,
      type: "grupal",
      instructorId: coach.id,
      startsAt: start,
      endsAt: new Date(start.getTime() + 3600000),
      capacity: 12,
      createdBy: adminId,
    });
  }

  log("\nSeed listo. Credenciales de desarrollo (NO produccion):");
  log(`  org:         ${ORG_NAME}`);
  log(`  admin:       ${DEV_ADMIN.email} / ${DEV_PASSWORD}`);
  log(`  admin2:      admin2@pilot.cl / ${DEV_PASSWORD}`);
  log(`  recepcion:   recepcion@pilot.cl / ${DEV_PASSWORD}`);
  log(`  instructor:  instructor@pilot.cl / ${DEV_PASSWORD}`);
  log(`  socio:       ${DEV_SOCIO.email} / ${DEV_PASSWORD}`);
  process.exit(0);
}

/**
 * Entrega 2 demo data: plans, memberships in each state, an open cash
 * session, and payments awaiting admin decision. Idempotent so re-running
 * never duplicates money.
 */
async function seedEntrega2(orgId: string, adminId: string, recepId: string) {
  // --- Plans (idempotent by name) -------------------------------------------
  const planDefs = [
    { name: "Mensual", priceCents: 30000, durationDays: 30, coverage: "unlimited" as const },
    { name: "Trimestral", priceCents: 80000, durationDays: 90, coverage: "unlimited" as const },
  ];
  const planIds: Record<string, string> = {};
  for (const p of planDefs) {
    let [row] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.organizationId, orgId), eq(plans.name, p.name)));
    if (!row) {
      [row] = await db
        .insert(plans)
        .values({ organizationId: orgId, ...p })
        .returning();
      log(`  plan creado: ${p.name}`);
    }
    planIds[p.name] = row!.id;
  }

  // --- Members ---------------------------------------------------------------
  const allMembers = await db.select().from(members).where(eq(members.organizationId, orgId));
  const socio = allMembers.find((m) => m.contactEmail === DEV_SOCIO.email) ?? allMembers[0];
  const plain = allMembers.find((m) => m.fullName === "Miembro Sin Cuenta");
  if (!socio) throw new Error("No hay miembros para la demo de membresías");

  // --- Membership in each state ----------------------------------------------
  const now = new Date();
  const DAY = 24 * 60 * 60 * 1000;

  // active: valid window now.
  let [active] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.organizationId, orgId), eq(memberships.planId, planIds["Mensual"]!)));
  if (!active) {
    [active] = await db
      .insert(memberships)
      .values({
        organizationId: orgId,
        memberId: socio.id,
        planId: planIds["Mensual"]!,
        startAt: new Date(now.getTime() - 5 * DAY),
        endAt: new Date(now.getTime() + 25 * DAY),
      })
      .returning();
    log("  membresia activa creada (socio piloto)");
  }

  // pending_payment: a second member, no validated payment yet.
  let pendingMembershipId: string | null = null;
  if (plain) {
    const [pending] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, orgId), eq(memberships.memberId, plain.id)));
    if (!pending) {
      const [created] = await db
        .insert(memberships)
        .values({
          organizationId: orgId,
          memberId: plain.id,
          planId: planIds["Trimestral"]!,
          // startAt/endAt stay null until the first validated payment.
        })
        .returning();
      pendingMembershipId = created!.id;
      log("  membresia pendiente de pago creada (miembro sin cuenta)");
    } else {
      pendingMembershipId = pending.id;
    }
  }

  // --- Open cash session (so provisional payments can be validated) ----------
  let [session] = await db
    .select()
    .from(cashSessions)
    .where(and(eq(cashSessions.organizationId, orgId), eq(cashSessions.state, "open")));
  if (!session) {
    [session] = await db
      .insert(cashSessions)
      .values({ organizationId: orgId, openedBy: adminId, state: "open", openingCents: 20000 })
      .returning();
    log("  turno de caja abierto (apertura $20.000)");
  }

  // --- Payments ---------------------------------------------------------------
  const existing = await db.select().from(payments).where(eq(payments.organizationId, orgId));
  if (existing.length === 0) {
    // One validated payment (already confirmed, generates the cash movement).
    const [validated] = await db
      .insert(payments)
      .values({
        organizationId: orgId,
        memberId: socio.id,
        membershipId: active!.id,
        planId: planIds["Mensual"]!,
        amountCents: 30000,
        method: "cash",
        state: "validated",
        registeredBy: recepId,
        decidedBy: adminId,
        decidedAt: now,
      })
      .returning();
    log("  pago validado de demo creado (membresia activa)");
    // Its cash movement — the ONLY place money lands.
    const [existingMovement] = await db
      .select()
      .from(cashMovements)
      .where(eq(cashMovements.paymentId, validated!.id));
    if (!existingMovement) {
      await db.insert(cashMovements).values({
        organizationId: orgId,
        sessionId: session!.id,
        paymentId: validated!.id,
        type: "income",
        method: "cash",
        amountCents: 30000,
      });
    }
    // Two provisional payments awaiting admin decision (registered by admin,
    // so a DIFFERENT admin must decide them — separation of functions).
    await db.insert(payments).values([
      {
        organizationId: orgId,
        memberId: socio.id,
        membershipId: active!.id,
        planId: planIds["Mensual"]!,
        amountCents: 30000,
        method: "transfer",
        reference: "TRX-DEMO-001",
        state: "provisional",
        registeredBy: recepId,
      },
      {
        organizationId: orgId,
        memberId: plain?.id ?? socio.id,
        membershipId: pendingMembershipId ?? active!.id,
        planId: planIds["Trimestral"]!,
        amountCents: 80000,
        method: "cash",
        state: "provisional",
        registeredBy: recepId,
      },
    ]);
    log("  2 pagos provisionales creados (esperan decision de admin)");
  }
}

main().catch((err) => {
  console.error("Seed fallo:", err);
  process.exit(1);
});
