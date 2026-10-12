/**
 * Deterministic fixtures for auth/tenant integration tests (spec 002).
 *
 * Two fictional organizations A and B with fixed UUIDs. The same seed runs in
 * every CI execution; truncation between suites restores a clean state.
 */
export const ORG_A = "11111111-1111-4111-8111-111111111111";
export const ORG_B = "22222222-2222-4222-8222-222222222222";

export const STAFF_ADMIN_A = {
  email: "admin.a@gym.test",
  password: "SuperSecret123!",
  role: "admin" as const,
};

export const STAFF_RECEPCION_A = {
  email: "recepcion.a@gym.test",
  password: "SuperSecret123!",
  role: "recepcion" as const,
};

export const STAFF_ADMIN_B = {
  email: "admin.b@gym.test",
  password: "SuperSecret123!",
  role: "admin" as const,
};

export const SOCIO_A1 = {
  email: "socio.a1@gym.test",
  password: "SuperSecret123!",
  fullName: "Socio A Uno",
};

export const SOCIO_A2 = {
  email: "socio.a2@gym.test",
  password: "SuperSecret123!",
  fullName: "Socio A Dos",
};

export const TEST_SECRET = "integration-test-secret-not-for-production-000000";
