# Runbook de despliegue — App GYM (GYM-2026)

Borrador (spec 001). Detalle de ambientes y secretos se completa con la unidad
de infraestructura; el VPS concreto y su región quedan pendientes en STATE.

## Entrega operativa 010 (2026-10-14)

Arranque reproducible: `pnpm install --frozen-lockfile` seguido de `pnpm dev`. Usa Compose `gym-2026-local`, contenedor `gym-2026-local-postgres-1`, volumen `gym-2026-local_gym_local_data`, puerto local `55432`, BD `gym_dev`, API `3000` y web `5173`. Configuración de runtime en `.env.local` generada con secreto aleatorio y permisos 0600; no imprimir ni commitear su contenido. Ctrl+C detiene los grupos de procesos web/API y conserva PostgreSQL y datos. No elimina contenedores ni volúmenes de otros proyectos.

`pnpm dev:prepare` aplica migraciones y seed sin iniciar servidores. El seed crea cinco cuentas ficticias (admin, segundo admin, recepción, instructor y socio), planes/membresías, caja y una clase. Es idempotente; no ejecutar en ambientes con datos reales. La migración 0009 agrega vínculo estable de cuenta al socio y backfill solo sin ambigüedades de email; revisar filas sin account_id antes de migrar datos existentes. Reversión técnica: revertir código consumidor y retirar índice/columna solo tras backup probado; no borrar socios ni cuentas para revertir.

### PWA de producción local y contingencia

`pnpm start` prepara los mismos datos locales e inicia API `3000` y web preview `4173`, suministrando `.env.local` sin exponer secretos. Usar este modo para probar recarga offline con el build y service worker; detener `pnpm dev` antes para liberar la API. Es producción del frontend en entorno local, no un despliegue de staging/producción. API local escucha en loopback y conserva cookies de desarrollo; staging exige TLS y NODE_ENV=production según el runbook. `scripts/e2e.mjs` usa preview con entorno efímero en puertos aislados.

El service worker precarga HTML y assets versionados; nunca Cache Storage para `/api/*`. El dispositivo se habilita por administración y cada operador obtiene un permiso firmado de hasta 72 h. La outbox y snapshot se cifran en IndexedDB (ADR 0007); frase local solo en memoria. Bloquear, salir y recargar requieren desbloqueo posterior. No perder la frase ni borrar el perfil del navegador con eventos pendientes; exportar copia cifrada y conservar folios externos. La restauración no sobrescribe una copia ya existente: restaurar en otro perfil controlado. Al reconectar, revalidar sesión/dispositivo/política, sincronizar por evento y revisar rechazos/duplicados antes de dar por conciliada la jornada. Los cobros reconocidos quedan provisionales en Pagos hasta la validación separada.

### Verificación aislada

- `pnpm test:integration`: crea/reusa BDs `gym_test_<suite>`, migra cada una y ejecuta su archivo; no silencia fallos.
- `pnpm test:coverage`: BD `gym_test_coverage`, suites dinero/reservas en serie; mantiene umbral CAL-2 ≥80% statements/lines.
- `pnpm test:e2e`: resetea solo `gym_e2e`; API `3100`, web preview `5174`; Chromium con locale es-CL/timezone America/Santiago. Conserva trazas de fallos en `/tmp/gym-e2e-results`; servicios auxiliares se detienen al salir.
- Gate raíz con integración: preparar una BD ficticia exclusiva y migrada, exportar `TEST_DATABASE_URL`, `VITEST_MAX_FORKS=1`, `VITEST_MIN_FORKS=1`, `VITEST_MAX_THREADS=1`, `VITEST_MIN_THREADS=1` y ejecutar `./scripts/verify.sh`. Un solo worker evita que fixtures que truncan tablas compartan la BD simultáneamente. Ningún test se omite y no se cambia el gate.

Las instrucciones manuales históricas de las entregas backend se conservan debajo para trazabilidad; para uso actual preferir el coordinador y las bases aisladas anteriores.

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
7. Health check: `curl https://<host>/health` → `{"status":"ok"}`.

## Backup y restore (REQ-11, SPEC:BACKUP)

Backup completo de PostgreSQL y restore probado antes de cualquier piloto con
datos reales (G2). Ejecutado y verificado sobre el contenedor de dev
(`gym-dev-pg`, BD `gym`) el 2026-10-12 — evidencia real adjunta más abajo.

### 1. Backup

```bash
# Dump en formato custom (comprimido, permite pg_restore selectivo).
docker exec gym-dev-pg pg_dump -U gym -d gym -Fc -f /tmp/gym_backup.dump
docker cp gym-dev-pg:/tmp/gym_backup.dump ./gym_backup.dump
# Copiar ./gym_backup.dump al almacenamiento externo/off-box del VPS.
```

### 2. Restore en una BD de staging limpia

```bash
# BD de staging limpia.
docker exec gym-dev-pg psql -U gym -d postgres -c "DROP DATABASE IF EXISTS gym_restore_check"
docker exec gym-dev-pg psql -U gym -d postgres -c "CREATE DATABASE gym_restore_check"
docker cp ./gym_backup.dump gym-dev-pg:/tmp/gym_backup.dump
docker exec gym-dev-pg pg_restore -U gym -d gym_restore_check --no-owner /tmp/gym_backup.dump
```

### 3. Verificación post-restore (integridad)

Conteos que deben coincidir entre origen y restaurado:

```bash
docker exec gym-dev-pg psql -U gym -d gym_restore_check -tAc "
SELECT 'organizations', count(*) FROM organizations
UNION ALL SELECT 'members', count(*) FROM members
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'users', count(*) FROM \"user\";"
```

Query de humo por dominio (join socios + pagos):

```bash
docker exec gym-dev-pg psql -U gym -d gym_restore_check -tAc "
SELECT m.full_name, count(p.id) AS pagos
FROM members m LEFT JOIN payments p ON p.member_id = m.id
GROUP BY m.full_name ORDER BY m.full_name;"
```

### 4. Periodicidad y retención (propuesta, a confirmar con el VPS)

- Backup diario automático (cron/systemd timer en el VPS) a almacenamiento
  externo al propio host.
- Retención: 7 diarios + 4 semanales (rotación; ajustable).

### Evidencia de la ejecución real (2026-10-12, `gym-dev-pg`)

- Backup: `pg_dump -Fc` → 61K.
- Restore en BD limpia `gym_restore_check` → sin errores.
- Conteos idénticos origen vs restaurado: `organizations 1, members 2,
  payments 4, sessions 0, users 3`.
- Query de humo OK en la BD restaurada: `Miembro Sin Cuenta → 2 pagos`,
  `Socio Piloto → 2 pagos`.
- La BD de staging de la verificación se eliminó tras la comprobación.

> Nota: el destino concreto del backup (VPS y región) queda pendiente de
> elección del usuario; el procedimiento es el mismo, solo cambia la ruta de
> almacenamiento externo.

## Entrega 3 · clases y reservas (receta curl, spec 004)

Con cookie de admin (`$A`), un instructor (`inst-1`) y un socio con membresía activa:

```bash
# 1) Plantilla de clase (admin)
TPL=$(curl -s -X POST localhost:3000/api/v1/class-templates -b "$A" -H 'content-type: application/json' \
  -d '{"name":"Spinning AM","type":"grupal","capacity":4,"cancellationWindowHours":24}' | jq -r .data.id)

# 2) Sesión grupal de esa plantilla (mañana 10:00–11:00)
SID=$(curl -s -X POST localhost:3000/api/v1/sessions -b "$A" -H 'content-type: application/json' -d '{
  "templateId":"'$TPL'","type":"grupal","instructorId":"inst-1",
  "startsAt":"2026-10-13T13:00:00Z","endsAt":"2026-10-13T14:00:00Z","capacity":4}' | jq -r .data.id)

# 3) Solape del mismo instructor → 409 (TX-02)
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/v1/sessions -b "$A" \
  -H 'content-type: application/json' -d '{
  "type":"fija","instructorId":"inst-1","startsAt":"2026-10-13T13:30:00Z",
  "endsAt":"2026-10-13T14:30:00Z","capacity":1}'   # → 409

# 4) Reservar (socio o recepción). Cupo 4: 4 reservas pasan, la 5ª → 409 (TX-01).
curl -s -X POST localhost:3000/api/v1/bookings -b "$A" -H 'content-type: application/json' \
  -d '{"sessionId":"'$SID'","memberId":"'$MEMBER'"}'

# 5) Cancelar temprana (>24h) devuelve crédito; tardía lo retiene. Doble cancel → 409 (TX-04).
curl -s -X POST localhost:3000/api/v1/bookings/$BID/cancel -b "$A" -H 'content-type: application/json' \
  -d '{"type":"temprana"}'

# 6) Agenda unificada del instructor
curl -s 'localhost:3000/api/v1/agenda?instructorId=inst-1' -b "$A"
```

Para correr los tests de integración (cada uno contra su BD aislada): `apps/api/scripts/test-integration.sh`.

## Prueba de concurrencia (REQ-8, spec 008)

Verifica que la operación diaria con 2 admins + 3 recepcionistas simultáneos no
produce doble operación financiera ni bloqueos, sobre el stack real
(`app.inject`: HTTP→auth→servicio→Postgres; sin k6/autocannon).

```sh
cd apps/api
TEST_DATABASE_URL="postgres://gym:gymtestpass@localhost:55432/gym_test_concur" \
  pnpm exec vitest run src/concurrency.integration.test.ts
```

Evidencia de la última corrida (2026-10-12): 5/5 escenarios verdes —
TX-05 cierre concurrente de turno (1 ok + 4× 409, una sola fila cerrada);
movimiento único (5 pagos validados en paralelo → 5 movimientos, uno por pago);
TX-01 última plaza (5 reservas concurrentes → 1 confirmada, cupo no excedido);
check-in QR concurrente coherente; latencia p50=60ms, p95=91ms, max=93ms.

## Pendientes (ver STATE.md)

- Elección del VPS concreto, región y recursos.
- Proxy/TLS, monitoreo y logging.
- Parámetros offline P-09.3.1b y cifrado local (antes de habilitar offline).
- Validación jurídica de datos de menores (D-05) antes del piloto real (G2).


### Evidencia de operación 010

El 2026-10-14 se ejecutó `pnpm start`: /health en 3000 y web 4173 dieron 200. SIGINT detuvo ambos grupos de procesos y conservó PostgreSQL (2 socios, 3 pagos). Backup de gym_dev con pg_dump custom y restore --exit-on-error en BD nueva gym_010_restore_check con migración 0009: conteos idénticos (members 2, account_id vinculados 1, QR 2, payments 3, memberships 2, sessions 1, cash_movements 1, staff 4). Esta prueba es local y con datos ficticios; restore en staging sigue pendiente antes de G2.

## Unidad 012 — Migración y operación de Transbank manual

Aplicar migración aditiva `0010_payment_comment` mediante `pnpm db:migrate` contra la BD elegida antes de iniciar el nuevo backend; agrega payments.comment nullable, sin borrar datos ni cambiar estados o importes históricos. La ampliación de métodos usa columnas text ya existentes y no requiere enum PostgreSQL ni pasarela externa. Verificar en una BD ficticia/migrada antes de staging; registrar método/operación/comentario y comprobar que queda provisional hasta la validación separada.

Reversión: conservar la columna nueva y sus datos. No operar nuevos cobros Transbank con una versión antigua que no reconoce ese método; restaurar la versión compatible o mantener detenido el registro de cobros afectados. No convertir Transbank a transferencia ni borrar movimientos para volver atrás. La outbox anterior sigue siendo compatible; los eventos nuevos conservan evidencia del terminal en payload y folio independiente. No almacenar datos de tarjeta en comentarios/folios ni enviar dinero desde la app.

La duración de 72 horas y el cifrado ya fueron aceptados en ADR 0007. La validación de dispositivos/procedimientos reales, staging/restore y privacidad/G2 siguen pendientes. El inventario actual de aceptación está en docs/product/aceptacion-mvp.md.

## Unidad 013 — CI completa configurada

El workflow usa ubuntu-24.04, PostgreSQL de servicio en 5432 y TEST_DATABASE_URL igual a DATABASE_URL. La preparación exige la variable, instala con lockfile congelado y migra esa BD antes de invocar el mismo ./scripts/verify.sh. Los cuatro límites de workers Vitest son 1; integración requiere cero suites omitidas. Después instala Chromium/dependencias con Playwright y ejecuta pnpm test:e2e sin continue-on-error. E2E usa el runner existente, su Compose en 55432 y gym_e2e exclusiva; no reutiliza ni resetea la BD de integración de Actions.

Verificado localmente: ensayos de ausencia de variable y propagación de migración fallida; preparación y gate literales en BD ficticia nueva, 157/157 sin omitidos; E2E del código/runner sin cambios, 8/8. Esto no acredita la instalación del navegador/paquetes de sistema en un runner remoto ni un resultado Actions aún no ejecutado. Publicar únicamente con autorización de push y comprobar el run del SHA publicado; si falla preparación, corregir causa, sin omitir migración/integración/E2E. Revisión humana de la unidad sigue pendiente.

## Unidad 014 — Salidas compensatorias

Migración aditiva 0011_financial_adjustments, sin modificar pagos/movimientos anteriores. Aplicar con pnpm db:migrate antes del backend nuevo; probar en BD ficticia. Reversión conserva ledger/auditoría: detener operaciones financieras hasta usar versión que incluya compensaciones en saldos y cierres; una versión vieja mostraría solo ingresos. No eliminar filas para revertir.

Admin abre Pagos → Validados → Devolver / ajustar, consulta disponible, registra importe/motivo y confirma. Ante respuesta de red fallida, reintentar en la misma confirmación: mantiene clave y cuerpo. No confundir una nueva intención con un replay; revisar historial antes de repetir manualmente una devolución. La app registra el hecho declarado, no devuelve dinero por pasarela; comprobar la salida externa y no incluir datos de tarjeta en el motivo. La membresía no pierde vigencia automáticamente, según ADR 0008.
