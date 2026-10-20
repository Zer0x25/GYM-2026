# Spec 023 — Empaquetado de producción, bootstrap limpio de organización y controles de piloto G2

Estado: Implementada y verificada — lista para despliegue en VPS G2
Nivel: Tier 1 — infraestructura de producción, aprovisionamiento de identidad administrativa inicial y control de bloqueo de menores (`D-05`) para el piloto G2.
Autoridad: decisión explícita del usuario 2026-10-19 (`A1..A4`, «pasamos G2»); [PRD.md](../PRD.md) `REQ-1`, `REQ-2`, `REQ-7`, `REQ-11`, `CAL-1`; [ADR 0002](../docs/adr/0002-arquitectura-base.md) y [ADR 0011](../docs/adr/0011-arranque-piloto-g2-empaquetado-controles.md). Commits locales autorizados; revisión humana al cierre.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:002-auth-tenant-socios, SPEC:006-revocacion-backup, SPEC:021-menores-correo-contratos, SPEC:022-aceptacion-ci-staging

## 1. Objetivo y alcance

- **Resultado observable:** El repositorio cuenta con todos los artefactos ejecutables para levantar el entorno de producción/piloto G2 en un VPS Linux propio sin datos ficticios:
  1. **Bootstrap limpio (`pnpm bootstrap:org` / `bootstrapOrganization`):** crea de forma idempotente la organización real y su primer administrador con credenciales configuradas por entorno (`BOOTSTRAP_ORG_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_NAME`), dejando en `0` las tablas de socios, planes, membresías, pagos y sesiones de caja.
  2. **Guardia operativa de menores (`ALLOW_MINOR_MEMBERS`):** cuando `ALLOW_MINOR_MEMBERS=false` (valor por defecto en `compose.prod.yaml`), `MembersService.create` y `MembersService.update` rechazan con `409 MINOR_REGISTRATION_DISABLED` el alta o conversión de socios menores, asegurando que el piloto inicial opere solo con mayores de edad hasta activar la bandera.
  3. **Artefactos Docker y scripts de backup/restore:** `Dockerfile` multi-stage, `compose.prod.yaml`, `Caddyfile`, `scripts/backup-db.sh` y `scripts/restore-db.sh` verificables y listos para usar en el VPS.
- **Incluye:** `apps/api/src/bootstrap-org.ts`, ajuste en `apps/api/src/services/members.ts`, `Dockerfile`, `compose.prod.yaml`, `Caddyfile`, `scripts/backup-db.sh`, `scripts/restore-db.sh`, `.env.example`, `package.json`, `apps/api/package.json`, `docs/operations/runbook.md` y suite de integración `apps/api/src/bootstrap-g2.integration.test.ts`.
- **Excluye:** almacenar credenciales o IPs reales en el repositorio.

## 2. Contratos e invariantes

- **Función y CLI `bootstrapOrganization(db, auth, input)` (`apps/api/src/bootstrap-org.ts`):**
  - Valida: `orgName` (`trim >= 2`), `adminEmail` (formato email válido, normalizado a minúsculas), `adminPassword` (`>= 10` caracteres, coherente con la política de contraseñas de `015`), `adminName` (`trim >= 2`). Si falta alguno o la contraseña tiene `< 10` caracteres, lanza error de validación sin tocar la BD.
  - Idempotencia: si la organización (`organizations.name === orgName`) o la cuenta (`identity_accounts.email === adminEmail`) ya existen, las reutiliza sin duplicar filas y asegura que exista la asignación activa `role = 'admin'` en `staff_assignments`.
  - Limpieza: jamás inserta registros en `members`, `plans`, `memberships`, `payments`, `cash_sessions` ni `sessions`.
- **Control `ALLOW_MINOR_MEMBERS` en `MembersService` (`apps/api/src/services/members.ts`):**
  - Helper `isMinorRegistrationAllowed()`: devuelve `false` cuando `process.env.ALLOW_MINOR_MEMBERS === 'false'` o `'0'`; devuelve `true` en caso contrario (preservando compatibilidad con las suites existentes de `021`). En `compose.prod.yaml` se define `ALLOW_MINOR_MEMBERS: ${ALLOW_MINOR_MEMBERS:-false}` para que el piloto G2 arranque bloqueado por defecto hasta decisión expresa.
  - Cuando `isMinorRegistrationAllowed() === false`, si `create` o `update` recibe `isMinor: true` o `adultResponsibleId` no nulo, lanza `conflict('MINOR_REGISTRATION_DISABLED')` (`409`).
- **Artefactos de contenedor y operación:**
  - `Dockerfile`: build multi-stage sobre `node:22-alpine` con `corepack enable`, compila todos los paquetes y genera tanto el runtime de `@gym/api` como los estáticos de `@gym/web/dist`.
  - `compose.prod.yaml` + `Caddyfile`: levantan `postgres:16-alpine`, `api` (migración + servidor Fastify), y `caddy:2-alpine` sirviendo el bundle estático de `apps/web/dist` y enrutando `/api/*` y `/health` a `api:3000`, con `EMAIL_DELIVERY_MODE=${EMAIL_DELIVERY_MODE:-disabled}` y `ALLOW_MINOR_MEMBERS=${ALLOW_MINOR_MEMBERS:-false}`.
  - `scripts/backup-db.sh` y `scripts/restore-db.sh`: scripts Bash con `set -euo pipefail` validados con `bash -n`.

## 3. Comportamientos BDD y criterios verificables

```gherkin
Escenario BDD-1: Bootstrap limpio de organización real en G2 sin datos ficticios
  Dada una base de datos PostgreSQL migrada y vacía
  Cuando se ejecuta bootstrapOrganization con "Gimnasio Real G2" y el correo del administrador
  Entonces se crea 1 organización, 1 cuenta con login funcional en /api/auth/sign-in/email y rol admin
  Y las tablas members, plans, memberships, payments y cash_sessions tienen exactamente 0 filas
  Y reejecutar bootstrapOrganization con los mismos datos es idempotente y mantiene 1 organización y 1 admin

Escenario BDD-2: Bloqueo de alta de menores cuando ALLOW_MINOR_MEMBERS=false en el arranque del piloto
  Dado ALLOW_MINOR_MEMBERS="false" en el entorno del servidor
  Cuando recepción o admin intenta crear o editar un socio con isMinor=true o adultResponsibleId
  Entonces recibe 409 MINOR_REGISTRATION_DISABLED y no se persiste el menor
```

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-1, REQ-2 | `bootstrapOrganization` crea organización + admin autenticable en Better Auth con `0` filas en `members`, `plans`, `memberships`, `payments` y `cash_sessions`, es idempotente y rechaza contraseñas `< 10` caracteres. | `apps/api/src/bootstrap-g2.integration.test.ts` |
| CA-2 | REQ-2, REQ-7, REQ-11 | Con `ALLOW_MINOR_MEMBERS=false`, `POST /api/v1/members` y `PATCH /api/v1/members/:id` rechazan con `409 MINOR_REGISTRATION_DISABLED` cualquier alta/conversión de menor; con `ALLOW_MINOR_MEMBERS=true` permiten el flujo `adultResponsibleId` de `021`. | `apps/api/src/bootstrap-g2.integration.test.ts` |
| CA-3 | REQ-11, CAL-1 | `Dockerfile`, `compose.prod.yaml`, `Caddyfile`, `scripts/backup-db.sh` y `scripts/restore-db.sh` existen, declaran `ALLOW_MINOR_MEMBERS:-false` y `EMAIL_DELIVERY_MODE:-disabled`, y pasan `bash -n`. | `apps/api/src/bootstrap-g2.integration.test.ts` + `bash -n scripts/backup-db.sh scripts/restore-db.sh` |
| CA-4 | CAL-1 | `./scripts/verify.sh` superado en verde con integración real y documentación operativa en `docs/operations/runbook.md` y `STATE.md`. | `./scripts/verify.sh` |

## 4. Archivos autorizados

- .dockerignore
- .env.example
- [C.]addyfile
- [D.]ockerfile
- STATE.md
- apps/api/package.json
- apps/api/src/bootstrap-g2.integration.test.ts
- apps/api/src/bootstrap-org.ts
- apps/api/src/services/members.ts
- compose.prod.yaml
- docs/adr/0011-arranque-piloto-g2-empaquetado-controles.md
- docs/adr/0012-controles-operativos-juridicos-g2.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- package.json
- scripts/backup-db.sh
- scripts/restore-db.sh
- specs/023-empaquetado-produccion-bootstrap-g2.md
- specs/024-custodia-reconstruccion-offline-g2.md
- specs/025-consentimiento-menores-d05-g2.md
- specs/026-acceso-temporal-soporte-d06-g2.md
- specs/027-diagnostico-produccion-cierre-g2.md

## 5. Verificación y DoD

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Comandos de cierre:** `pnpm --filter @gym/api exec vitest run src/bootstrap-g2.integration.test.ts`, `bash -n scripts/backup-db.sh scripts/restore-db.sh` y `./scripts/verify.sh`.

## 6. Evidencia y checkpoint

- **Fase roja:** `pnpm --filter @gym/api exec vitest run src/bootstrap-g2.integration.test.ts` falló inicialmente con `Failed to load url ./bootstrap-org.js` antes de la implementación.
- **CA-1:** `TEST_DATABASE_URL="postgres://gym:gym-local-dev@localhost:55432/gym_test_023" pnpm --filter @gym/api exec vitest run src/bootstrap-g2.integration.test.ts` → `3/3` pasados; CLI `pnpm bootstrap:org` ejecutado sobre `gym_test_023` creando 1 organización y 1 admin con 0 socios/planes/pagos demo y verificación idempotente.
- **CA-2:** `src/bootstrap-g2.integration.test.ts` + `src/members.integration.test.ts` → `13/13` pasados; `ALLOW_MINOR_MEMBERS=false` rechaza con `409 MINOR_REGISTRATION_DISABLED` tanto en `create` como en `update`, mientras `ALLOW_MINOR_MEMBERS=true` preserva el flujo `adultResponsibleId` de `021`.
- **CA-3:** `bash -n scripts/backup-db.sh scripts/restore-db.sh` → salida `0`; artefactos `Dockerfile`, `.dockerignore`, `compose.prod.yaml` y `Caddyfile` verificados.
- **CA-4:** `./scripts/verify.sh` superado en verde con `verify-structure.sh`, `verify-scope.sh`, `lint`, `typecheck`, `build` y suites de pruebas.
