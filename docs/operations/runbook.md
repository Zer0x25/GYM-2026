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
docker run -d --name gym-dev-pg \
  -e POSTGRES_USER=gym -e POSTGRES_PASSWORD=gym-local-dev -e POSTGRES_DB=gym \
  -p 5432:5432 postgres:16-alpine
cp .env.example .env        # editar valores ficticios; NUNCA secretos reales en el repo
# AUTH_SECRET: openssl rand -base64 32  (fuera del repo)
pnpm --filter @gym/db db:generate    # genera migraciones desde packages/db/src/schema.ts
pnpm --filter @gym/db db:migrate     # aplica migraciones
pnpm -r dev                          # web (5173) + api (3000)
./scripts/verify.sh
```

Pruebas de integración de `apps/api` (opcionales, contra Postgres real):

```sh
docker run -d --name gym-test-pg \
  -e POSTGRES_USER=gym -e POSTGRES_PASSWORD=gym-local-dev -e POSTGRES_DB=gym_test \
  -p 55432:5432 postgres:16-alpine
DATABASE_URL=postgres://gym:gym-local-dev@localhost:55432/gym_test \
  pnpm --filter @gym/db db:migrate
TEST_DATABASE_URL=postgres://gym:gym-local-dev@localhost:55432/gym_test \
  pnpm --filter @gym/api test
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
