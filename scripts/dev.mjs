import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(resolve(root, "apps/api/package.json"));
const { parse } = require("dotenv");
const configPath = resolve(root, ".env.local");
if (!existsSync(configPath))
  writeFileSync(
    configPath,
    `DATABASE_URL=postgres://gym:gym-local-dev@localhost:55432/gym_dev\nAUTH_SECRET=${randomBytes(32).toString("base64url")}\nAUTH_URL=http://localhost:3000\nTRUSTED_ORIGINS=http://localhost:5173,http://localhost:3000,http://localhost:4173\n`,
    { mode: 0o600 },
  );
const env = {
  ...process.env,
  ...parse(readFileSync(configPath)),
  NODE_ENV: "development",
  HOST: "127.0.0.1",
};
const dbUrl = new URL(env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname))
  throw new Error(
    "El arranque local solo inicializa PostgreSQL en localhost. Usa el runbook para otro ambiente.",
  );
const children = new Set();
let stopping = false;
function run(cmd, args, options = {}) {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env,
      stdio: "inherit",
      detached: true,
      ...options,
    });
    children.add(child);
    child.once("error", fail);
    child.once("exit", (code) => {
      children.delete(child);
      if (code === 0) ok();
      else fail(new Error(`${cmd} terminó con código ${code}`));
    });
  });
}
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
}
process.on("SIGINT", () => {
  stop();
  process.exitCode = 0;
});
process.on("SIGTERM", () => {
  stop();
  process.exitCode = 0;
});
try {
  await run("docker", [
    "compose",
    "-p",
    "gym-2026-local",
    "-f",
    "compose.dev.yaml",
    "up",
    "-d",
    "--wait",
  ]);
  await run("pnpm", ["-r", "build"], { env: { ...env, NODE_ENV: "production" } });
  await run("pnpm", ["db:migrate"]);
  await run("pnpm", ["seed:dev"]);
  if (!process.argv.includes("--prepare")) {
    const preview = process.argv.includes("--preview");
    console.log(
      `\nApp GYM: http://localhost:${preview ? 4173 : 5173} · API: http://localhost:3000\nCtrl+C cierra web/API; la base local se conserva.`,
    );
    await Promise.all([
      run("pnpm", ["--filter", "@gym/api", "start"]),
      run("pnpm", [
        "--filter",
        "@gym/web",
        preview ? "preview" : "dev",
        "--host",
        "127.0.0.1",
        "--strictPort",
        ...(preview ? ["--port", "4173"] : []),
      ]),
    ]);
  }
} catch (error) {
  if (!stopping) {
    console.error(error.message);
    process.exitCode = 1;
  }
  stop();
}
