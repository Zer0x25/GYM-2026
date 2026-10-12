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
cp apps/api/.env.example apps/api/.env    # editar; NUNCA secretos reales en el repo
# AUTH_SECRET: openssl rand -base64 32   (≥32 chars, fuera del repo)
pnpm db:migrate          # aplica migraciones (packages/db)
pnpm seed:dev            # org + admin/socio de prueba (idempotente)
pnpm -r dev              # web (5173) + api (3000)
./scripts/verify.sh
```

Credenciales de desarrollo sembradas (ficticias, NO producción):

| Rol | Email | Password |
|---|---|---|
| admin | `admin@pilot.cl` | `SuperSecret123!` |
| socio | `socio@pilot.cl` | `SuperSecret123!` |

Además crea la organización «Gimnasio Piloto» y un miembro sin cuenta.

### Datos de demo de la Entrega 2 (dinero)

`pnpm seed:dev` además siembra (idempotente, sin duplicar dinero):

- **Planes:** Mensual $30.000 (30 días) y Trimestral $80.000 (90 días).
- **Membresías en cada estado:** una `active` (socio piloto), una `pending_payment`
  (miembro sin cuenta, sin ventana hasta validar el primer pago).
- **Turno de caja abierto** (apertura $20.000) para que los pagos provisionales
  puedan validarse.
- **Pagos:** 1 validado (con su movimiento de caja) + 2 provisionales esperando
  decisión. Los provisionales están registrados por el admin, así que **otro
  admin distinto debe validarlos** (separación de funciones, SPEC:PAY-02).

### Flujo de dinero para probar a mano (con la API en :3000)

```sh
# 1) login y guardar cookie
curl -s -c /tmp/cj.txt -X POST http://localhost:3000/api/auth/sign-in/email \
  -H "Content-Type: application/json" -H "Origin: http://localhost:3000" \
  -d '{"email":"admin@pilot.cl","password":"SuperSecret123!"}'
C="-b /tmp/cj.txt -H Origin:http://localhost:3000"

# 2) ver planes, membresías (estado derivado), turno y pagos provisionales
curl -s $C http://localhost:3000/api/v1/plans
curl -s $C http://localhost:3000/api/v1/memberships
curl -s $C http://localhost:3000/api/v1/cash/sessions/current
curl -s $C "http://localhost:3000/api/v1/payments?state=provisional"

# 3) el admin NO puede validar su propio registro → 403 (esperado)
curl -s $C -X POST http://localhost:3000/api/v1/payments/<id>/validate
```

Para completar la validación, creá un **segundo admin** (`POST /api/v1/staff`,
rol admin) y validá con su cookie: el pago pasa a `validated`, la membresía a
`active` y se crea el movimiento de caja. Sin turno abierto, validar → 409.

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
