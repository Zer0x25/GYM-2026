import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const env = {
  ...process.env,
  DATABASE_URL: "postgres://gym:gym-local-dev@localhost:55432/gym_e2e",
  AUTH_SECRET: randomBytes(32).toString("base64url"),
  AUTH_URL: "http://localhost:3100",
  TRUSTED_ORIGINS: "http://localhost:5174,http://localhost:3100",
  PORT: "3100",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  VITE_API_URL: "http://127.0.0.1:3100",
};
function run(cmd, args, overrides = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    env: { ...env, ...overrides },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${cmd} falló (${result.status})`);
  }
  return result.stdout;
}
const children = [];
function start(cmd, args, label) {
  const child = spawn(cmd, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (data) => appendFileSync(`/tmp/gym-e2e-${label}.log`, data));
  child.stderr.on("data", (data) => appendFileSync(`/tmp/gym-e2e-${label}.log`, data));
  return child;
}
function stop() {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
}
process.once("SIGINT", () => {
  stop();
  process.exit(130);
});
process.once("SIGTERM", () => {
  stop();
  process.exit(143);
});
try {
  run("docker", [
    "compose",
    "-p",
    "gym-2026-local",
    "-f",
    "compose.dev.yaml",
    "up",
    "-d",
    "--wait",
  ]);
  const container = "gym-2026-local-postgres-1";
  // Only the dedicated fictional E2E DB is reset. No production or development DB is touched.
  const exists = run("docker", [
    "exec",
    container,
    "psql",
    "-U",
    "gym",
    "-d",
    "gym_dev",
    "-tAc",
    "SELECT 1 FROM pg_database WHERE datname='gym_e2e'",
  ]);
  if (exists.trim())
    run("docker", ["exec", container, "dropdb", "-U", "gym", "--force", "gym_e2e"]);
  run("docker", ["exec", container, "createdb", "-U", "gym", "gym_e2e"]);
  run("pnpm", ["-r", "build"], { NODE_ENV: "production" });
  run("pnpm", ["db:migrate"]);
  run("pnpm", ["seed:dev"]);
  start("node", ["apps/api/dist/server.js"], "api");
  start(
    "pnpm",
    ["--filter", "@gym/web", "preview", "--host", "127.0.0.1", "--port", "5174", "--strictPort"],
    "web",
  );
  for (const url of ["http://localhost:3100/health", "http://localhost:5174"]) {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try {
        if ((await fetch(url)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* Starting. */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error(`No arrancó ${url}`);
  }
  const result = spawn("pnpm", ["exec", "playwright", "test"], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  const code = await new Promise((resolve) => result.once("exit", resolve));
  if (code !== 0) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  stop();
}
