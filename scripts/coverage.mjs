import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const url = "postgres://gym:gym-local-dev@localhost:55432/gym_test_coverage";
function run(cmd, args, env = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("docker", ["compose", "-p", "gym-2026-local", "-f", "compose.dev.yaml", "up", "-d", "--wait"]);
const exists = spawnSync(
  "docker",
  [
    "exec",
    "gym-2026-local-postgres-1",
    "psql",
    "-U",
    "gym",
    "-d",
    "gym_dev",
    "-tAc",
    "SELECT 1 FROM pg_database WHERE datname='gym_test_coverage'",
  ],
  { encoding: "utf8" },
);
if (exists.status !== 0) process.exit(exists.status ?? 1);
if (!exists.stdout.trim())
  run("docker", [
    "exec",
    "gym-2026-local-postgres-1",
    "createdb",
    "-U",
    "gym",
    "gym_test_coverage",
  ]);
run("pnpm", ["db:migrate"], { DATABASE_URL: url });
run(
  "pnpm",
  [
    "--filter",
    "@gym/api",
    "exec",
    "vitest",
    "run",
    "src/payments.integration.test.ts",
    "src/cash.integration.test.ts",
    "src/bookings.integration.test.ts",
    "src/credits.integration.test.ts",
    "src/transbank.integration.test.ts",
    "src/financial-adjustments.integration.test.ts",
    "src/memberships-lifecycle.integration.test.ts",
    "src/partial-payments.integration.test.ts",
    "src/sessions-reschedule.integration.test.ts",
    "--no-file-parallelism",
    "--coverage",
  ],
  { TEST_DATABASE_URL: url },
);
