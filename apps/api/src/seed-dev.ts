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
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { createDb, identityAccounts, members, organizations, staffAssignments } from "@gym/db";
import { createAuth } from "./auth.js";

const log = (msg: string) => {
  process.stdout.write(`${msg}\n`);
};

const DB_URL = process.env.DATABASE_URL;
const SECRET = process.env.AUTH_SECRET;

if (!DB_URL) {
  process.stderr.write("Falta DATABASE_URL (ej: postgres://gym:gym-local-dev@localhost:5432/gym)\n");
  process.exit(1);
}
if (!SECRET || SECRET.length < 32) {
  process.stderr.write("Falta AUTH_SECRET (>=32 chars). Ej: openssl rand -base64 32\n");
  process.exit(1);
}

const ORG_NAME = "Gimnasio Piloto";
const DEV_ADMIN = { email: "admin@pilot.cl", password: "SuperSecret123!", name: "Admin Piloto" };
const DEV_SOCIO = { email: "socio@pilot.cl", password: "SuperSecret123!", name: "Socio Piloto" };

const db = createDb(DB_URL);
const auth = createAuth({ db, secret: SECRET, baseURL: process.env.AUTH_URL ?? "http://localhost:3000" });

async function ensureAccount(email: string, password: string, name: string): Promise<string> {
  const [existing] = await db.select().from(identityAccounts).where(eq(identityAccounts.email, email));
  if (existing) {
    log(`  cuenta ya existe: ${email}`);
    return existing.id;
  }
  const created = await auth.api.createUser({
    body: { email, password, name, data: { emailVerified: true } },
  });
  await db.insert(identityAccounts).values({ id: created.user.id, email, passwordHash: "better-auth" });
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
    .where(and(eq(staffAssignments.accountId, adminId), eq(staffAssignments.organizationId, org.id)));
  if (!adminAssignment) {
    await db.insert(staffAssignments).values({ organizationId: org.id, accountId: adminId, role: "admin" });
    log(`  rol admin asignado en ${ORG_NAME}`);
  }

  // --- Socio (account + member) ---------------------------------------------
  await ensureAccount(DEV_SOCIO.email, DEV_SOCIO.password, DEV_SOCIO.name);
  const [socioMember] = await db
    .select()
    .from(members)
    .where(and(eq(members.organizationId, org.id), eq(members.contactEmail, DEV_SOCIO.email)));
  if (!socioMember) {
    await db.insert(members).values({
      organizationId: org.id,
      fullName: DEV_SOCIO.name,
      contactEmail: DEV_SOCIO.email,
    });
    log(`  miembro creado: ${DEV_SOCIO.name}`);
  }

  // --- Member without login --------------------------------------------------
  const [plainMember] = await db.select().from(members).where(eq(members.fullName, "Miembro Sin Cuenta"));
  if (!plainMember) {
    await db.insert(members).values({
      organizationId: org.id,
      fullName: "Miembro Sin Cuenta",
    });
    log("  miembro sin cuenta creado");
  }

  log("\nSeed listo. Credenciales de desarrollo (NO produccion):");
  log(`  org:   ${ORG_NAME}`);
  log(`  admin: ${DEV_ADMIN.email} / ${DEV_ADMIN.password}`);
  log(`  socio: ${DEV_SOCIO.email} / ${DEV_SOCIO.password}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed fallo:", err);
  process.exit(1);
});
