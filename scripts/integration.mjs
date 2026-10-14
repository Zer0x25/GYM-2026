import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write(r.stderr ?? "");
    process.stdout.write(r.stdout ?? "");
    throw new Error(`${cmd} falló (${r.status})`);
  }
  return r.stdout;
};
run("docker", ["compose", "-p", "gym-2026-local", "-f", "compose.dev.yaml", "up", "-d", "--wait"]);
const container = "gym-2026-local-postgres-1";
const files = readdirSync(resolve(root, "apps/api/src"))
  .filter((p) => p.endsWith(".integration.test.ts"))
  .sort();
for (const file of files) {
  const name = "gym_test_" + file.replace(".integration.test.ts", "").replaceAll("-", "_");
  const query = run("docker", [
    "exec",
    container,
    "psql",
    "-U",
    "gym",
    "-d",
    "gym_dev",
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname='${name}'`,
  ]);
  if (!query.trim()) run("docker", ["exec", container, "createdb", "-U", "gym", name]);
  const url = `postgres://gym:gym-local-dev@localhost:55432/${name}`;
  run("pnpm", ["db:migrate"], { DATABASE_URL: url });
  const output = run("pnpm", ["--filter", "@gym/api", "exec", "vitest", "run", `src/${file}`], {
    TEST_DATABASE_URL: url,
  });
  console.log(
    output
      .split("\n")
      .filter((line) => /✓|Test Files|Tests |Duration|p50|p95|latenc/.test(line))
      .join("\n"),
  );
}
console.log(
  `Integración completa: ${files.length} archivos, bases ficticias aisladas; sin pruebas omitidas.`,
);
