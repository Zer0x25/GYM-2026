import { defineConfig } from "vitest/config";

/**
 * Vitest projects for @gym/api:
 * - unit: pure logic tests (roles, service rules) — no database.
 * - integration: tests against a real PostgreSQL at TEST_DATABASE_URL;
 *   when the variable is absent they skip themselves (describe.skipIf),
 *   so the gate stays green without a database.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integration.test.ts", "**/node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
          environment: "node",
          hookTimeout: 30_000,
          testTimeout: 30_000,
          // Integration tests TRUNCATE the schema in beforeAll, so files
          // must never run concurrently against the same database.
          fileParallelism: false,
        },
      },
    ],
  },
});
