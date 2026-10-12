import "dotenv/config";
import { buildServer } from "./app.js";
import { createAuth } from "./auth.js";
import { createDb } from "@gym/db";

async function main() {
  const db = createDb();
  const auth =
    process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32
      ? createAuth({
          db,
          secret: process.env.AUTH_SECRET,
          baseURL: process.env.AUTH_URL ?? "http://localhost:3000",
        })
      : undefined;
  if (!auth) {
    console.warn(
      "[api] AUTH_SECRET no configurado (<32 chars): las rutas de auth responden 501. " +
        "Configurar AUTH_SECRET en .env (openssl rand -base64 32).",
    );
  }
  const app = await buildServer({ db, auth });
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
