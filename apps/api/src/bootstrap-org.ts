/**
 * Clean G2 organization & initial admin provisioning (Spec 023, ADR 0011).
 *
 * Unlike `seed-dev.ts` (which creates fictional demo members, plans, cash
 * sessions, and payments for local development), `bootstrapOrganization`
 * creates ONLY the target organization and its first `admin` staff account,
 * leaving all operational tables empty. Idempotent on re-run.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import {
  createDb,
  identityAccounts,
  organizations,
  staffAssignments,
  type Database,
} from "@gym/db";
import { createAuth } from "./auth.js";

export type AuthInstance = ReturnType<typeof createAuth>;

export interface BootstrapOrgInput {
  orgName: string;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
}

export interface BootstrapOrgResult {
  organizationId: string;
  organizationName: string;
  adminAccountId: string;
  adminEmail: string;
  createdOrganization: boolean;
  createdAdminAccount: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function bootstrapOrganization(
  db: Database,
  auth: AuthInstance,
  input: BootstrapOrgInput,
): Promise<BootstrapOrgResult> {
  const orgName = input.orgName.trim();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const adminPassword = input.adminPassword;
  const adminName = input.adminName.trim();

  if (orgName.length < 2) {
    throw new Error("El nombre de la organización debe tener al menos 2 caracteres");
  }
  if (!EMAIL_RE.test(adminEmail)) {
    throw new Error("El correo del administrador no es válido");
  }
  if (!adminPassword || adminPassword.length < 10) {
    throw new Error("La contraseña del administrador debe tener al menos 10 caracteres");
  }
  if (adminName.length < 2) {
    throw new Error("El nombre del administrador debe tener al menos 2 caracteres");
  }

  let createdOrganization = false;
  let [org] = await db.select().from(organizations).where(eq(organizations.name, orgName));
  if (!org) {
    [org] = await db.insert(organizations).values({ name: orgName }).returning();
    createdOrganization = true;
  }
  if (!org) {
    throw new Error("No se pudo crear u obtener la organización");
  }

  let createdAdminAccount = false;
  const [existingAccount] = await db
    .select()
    .from(identityAccounts)
    .where(eq(identityAccounts.email, adminEmail));

  let adminAccountId: string;
  if (existingAccount) {
    adminAccountId = existingAccount.id;
  } else {
    const created = await auth.api.createUser({
      body: {
        email: adminEmail,
        password: adminPassword,
        name: adminName,
        data: { emailVerified: true },
      },
    });
    adminAccountId = created.user.id;
    await db
      .insert(identityAccounts)
      .values({ id: adminAccountId, email: adminEmail, passwordHash: "better-auth" });
    createdAdminAccount = true;
  }

  const [assignment] = await db
    .select()
    .from(staffAssignments)
    .where(
      and(
        eq(staffAssignments.accountId, adminAccountId),
        eq(staffAssignments.organizationId, org.id),
      ),
    );
  if (!assignment) {
    await db.insert(staffAssignments).values({
      organizationId: org.id,
      accountId: adminAccountId,
      role: "admin",
      active: true,
    });
  } else if (assignment.role !== "admin" || !assignment.active) {
    await db
      .update(staffAssignments)
      .set({ role: "admin", active: true })
      .where(eq(staffAssignments.id, assignment.id));
  }

  return {
    organizationId: org.id,
    organizationName: org.name,
    adminAccountId,
    adminEmail,
    createdOrganization,
    createdAdminAccount,
  };
}

async function runCli() {
  const dbUrl = process.env.DATABASE_URL;
  const secret = process.env.AUTH_SECRET;
  const orgName = process.env.BOOTSTRAP_ORG_NAME ?? "";
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "";
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  const adminName = process.env.BOOTSTRAP_ADMIN_NAME ?? "Administración";

  if (!dbUrl) {
    process.stderr.write("Falta DATABASE_URL\n");
    process.exit(1);
  }
  if (!secret || secret.length < 32) {
    process.stderr.write("Falta AUTH_SECRET (>=32 caracteres)\n");
    process.exit(1);
  }
  const db = createDb(dbUrl);
  const auth = createAuth({
    db,
    secret,
    baseURL: process.env.AUTH_URL ?? "http://localhost:3000",
  });
  const res = await bootstrapOrganization(db, auth, {
    orgName,
    adminEmail,
    adminPassword,
    adminName,
  });
  process.stdout.write(
    `Bootstrap G2 OK: org="${res.organizationName}" (${res.organizationId}), admin="${res.adminEmail}" (${res.adminAccountId})\n`,
  );
  process.exit(0);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runCli().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error en bootstrap:org: ${msg}\n`);
    process.exit(1);
  });
}
