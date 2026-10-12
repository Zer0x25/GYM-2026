# Runbook de despliegue — App GYM (GYM-2026)

Borrador (spec 001). Detalle de ambientes y secretos se completa con la unidad
de infraestructura; el VPS concreto y su región quedan pendientes en STATE.

## Componentes

- `apps/web` — SPA/PWA React (estáticos). Se sirve tras build (`dist/`).
- `apps/api` — Fastify (Node 22).
- `packages/db` — PostgreSQL 16 + migraciones Drizzle.
- Proxy inverso (nginx o Caddy) con TLS terminado. *Pendiente de definir.*

## Desarrollo local

```sh
corepack enable
pnpm install
docker compose up -d postgres
cp .env.example .env        # editar valores ficticios; NUNCA secretos reales en el repo
pnpm -r db:generate         # genera migraciones desde packages/db/src/schema.ts
pnpm -r db:migrate          # aplica migraciones
pnpm -r dev                 # web (5173) + api (3000)
./scripts/verify.sh
```

## Staging / piloto en VPS

1. Aprovisionar el VPS (Linux) con Docker y Docker Compose.
2. Clonar el repo y fijar el tag de la versión.
3. Configurar `.env` **en el servidor** (fuera del repo) con los valores reales.
4. `pnpm install --frozen-lockfile && pnpm -r build`.
5. `pnpm -r db:migrate` contra la base de staging.
6. Levantar `apps/api` (p. ej. systemd unit o servicio Compose) y servir
   `apps/web/dist` tras el proxy.
7. Health check: `curl https://<host>/api/v1/health` → `{"status":"ok"}`.

## Backup y restore

- Backup diario de PostgreSQL (`pg_dump`) a almacenamiento externo.
- Restore probado en staging antes de cualquier piloto con datos reales
  (REQ-11). Procedimiento exacto se documenta al implementar la unidad de
  operación; el gate no lo cubre todavía.

## Pendientes (ver STATE.md)

- Elección del VPS concreto, región y recursos.
- Proxy/TLS, monitoreo y logging.
- Parámetros offline P-09.3.1b y cifrado local (antes de habilitar offline).
- Validación jurídica de datos de menores (D-05) antes del piloto real (G2).
