import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export { schema };
export {
  organizations,
  authUsers,
  authSessions,
  authAccounts,
  authVerifications,
  contactVerifications,
  identityAccounts,
  staffAssignments,
  members,
  plans,
  memberships,
  membershipPeriods,
  membershipPauses,
  creditMovements,
  payments,
  cashSessions,
  cashMovements,
  financialAdjustments,
  classTemplates,
  sessions,
  bookings,
  bookingCancellations,
  devices,
  offlineEvents,
  membershipSnapshots,
  auditLog,
  supportAccessGrants,
} from "./schema.js";

/**
 * Creates a Drizzle client bound to the schema.
 * DATABASE_URL must be provided via environment (never committed).
 */
export function createDb(databaseUrl: string = process.env.DATABASE_URL ?? "") {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (set it from .env, never commit real secrets).");
  }
  const sql = postgres(databaseUrl, { max: 10 });
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createDb>;
