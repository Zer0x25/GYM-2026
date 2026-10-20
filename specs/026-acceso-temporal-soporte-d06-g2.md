# Spec 026 — Acceso temporal de soporte (D-06) con expiración estricta, autorización del administrador y auditoría inmutable

Estado: Cerrada — implementada y verificada (Ola 1 G2)
Nivel: Tier 1 — seguridad, control de acceso temporal de soporte técnico (`D-06`), aislamiento multi-tenant (`REQ-1`) y auditoría (`REQ-11`).
Autoridad: decisión explícita del usuario 2026-10-19 (`A1`, `A2`); [PRD.md](../PRD.md) `REQ-1`, `REQ-11`, `CAL-1`, `CAL-3`; [ADR 0002](../docs/adr/0002-arquitectura-base.md) y [ADR 0012](../docs/adr/0012-controles-operativos-juridicos-g2.md). Commits locales autorizados; revisión humana al cierre.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:002-auth-tenant-socios, SPEC:006-revocacion-backup

## 1. Objetivo y alcance

- **Resultado observable:**
  1. **Concesión explícita por el administrador del gimnasio (`D-06`):** El soporte técnico nunca tiene acceso permanente ni silencioso a una organización. Solo un `admin` autenticado puede emitir una concesión temporal (`POST /api/v1/admin/support-grants`) indicando `supportEmail`, `reason` (`5..500` caracteres), `scope` (`"diagnostic"` o `"read_only"`) y `durationMinutes` (`15..1440`, máximo 24 horas). El servidor devuelve el token efímero en claro **únicamente en el momento de creación** y almacena solo su `tokenHash` (SHA-256) en `support_access_grants`.
  2. **Listado y revocación inmediata:** El `admin` puede listar las concesiones de su organización (`GET /api/v1/admin/support-grants`) y revocar cualquiera de forma inmediata (`POST /api/v1/admin/support-grants/:id/revoke`), dejando rastro inmutable en `audit_log` (`support.grant.create`, `support.grant.revoke`).
  3. **Diagnóstico acotado sin exposición de secretos ni PII sensible (`GET /api/v1/support/diagnostic-summary`):** Portando la cabecera `x-support-grant-token`, soporte puede consultar un resumen operativo del gimnasio (identificador y nombre de organización, conteos de socios, planes activos, membresías, estado de la sesión de caja actual sin mutar dinero, estado de política offline y conteo de eventos en outbox). Si el token no existe, expiró o fue revocado, responde `401 UNAUTHENTICATED`. Cada lectura válida actualiza `lastUsedAt` y escribe una fila en `audit_log` (`support.diagnostic.read`).
  4. **Interfaz en `Team.tsx`:** Añade en la vista de administración de equipo (`Team.tsx`) una sección «Acceso temporal de soporte (D-06)» para emitir el permiso temporal, copiar el token efímero por única vez y revocar permisos activos.
- **Incluye:** migración `0021_support_access_grants.sql`, tabla `supportAccessGrants` en `packages/db/src/schema.ts`, contratos en `@gym/contracts`, servicio `apps/api/src/services/support-access.ts`, rutas en `apps/api/src/app.ts`, sección en `apps/web/src/pages/Team.tsx` y pruebas de integración y UI.
- **Excluye:** mutaciones financieras o de membresías por parte de soporte (el alcance es estrictamente diagnóstico/lectura acotada).

## 2. Contratos e invariantes

- **Esquema `support_access_grants` (`0021_support_access_grants.sql`):**
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `organization_id uuid NOT NULL REFERENCES organizations(id)`
  - `granted_by_account_id text NOT NULL REFERENCES "user"(id)`
  - `support_email text NOT NULL`
  - `reason text NOT NULL`
  - `scope text NOT NULL DEFAULT 'diagnostic'` (`'diagnostic' | 'read_only'`)
  - `token_hash text NOT NULL UNIQUE`
  - `expires_at timestamp with time zone NOT NULL`
  - `revoked_at timestamp with time zone`
  - `revoked_by_account_id text REFERENCES "user"(id)`
  - `last_used_at timestamp with time zone`
  - `created_at timestamp with time zone NOT NULL DEFAULT now()`
- **Invariantes (`SupportAccessService`):**
  - `durationMinutes` entre `15` y `1440` (máximo 24h).
  - Ningún rol distinto de `admin` puede crear, listar o revocar concesiones (`403 FORBIDDEN`).
  - Un `admin` de la organización A que intente revocar una concesión de la organización B recibe `404 NOT_FOUND` (`REQ-1`).
  - `tokenHash` se calcula con `createHash("sha256").update(rawToken).digest("hex")`; `rawToken` tiene al menos 32 bytes aleatorios en hex/base64url y jamás se persiste ni escribe en logs.
  - `GET /api/v1/support/diagnostic-summary` exige cabecera `x-support-grant-token`, rechaza tokens inválidos/expirados/revocados con `401 UNAUTHENTICATED`, y en la misma transacción actualiza `last_used_at` e inserta en `audit_log` (`action: "support.diagnostic.read"`).

## 3. Comportamientos BDD y criterios verificables

```gherkin
Escenario BDD-1: Ciclo completo de concesión temporal de soporte D-06, uso auditado y revocación inmediata
  Dado un admin autenticado en Gimnasio A
  Cuando crea un permiso de soporte para "soporte@gym.cl" por 60 minutos con motivo "Revisión de cola offline"
  Entonces recibe 201 con el token efímero por única vez y en la base de datos solo existe token_hash
  Cuando soporte invoca GET /api/v1/support/diagnostic-summary con x-support-grant-token
  Entonces recibe 200 con conteos operativos de Gimnasio A y queda registrado support.diagnostic.read en audit_log
  Cuando el admin revoca la concesión y soporte vuelve a invocar el endpoint
  Entonces recibe 401 UNAUTHENTICATED
```

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-1, REQ-11 | Solo `admin` crea, lista y revoca concesiones de soporte (`15..1440` min); se almacena únicamente `tokenHash` SHA-256 y un intento cross-tenant responde `404`. | `apps/api/src/support-access.integration.test.ts` + `packages/contracts/src/contracts.test.ts` |
| CA-2 | REQ-1, REQ-11 | `GET /api/v1/support/diagnostic-summary` valida `x-support-grant-token`, rechaza expirados/revocados con `401`, sella `lastUsedAt`, audita `support.diagnostic.read` y no filtra secretos ni PII sensible. | `apps/api/src/support-access.integration.test.ts` |
| CA-3 | REQ-11 | `Team.tsx` permite al `admin` otorgar acceso temporal de soporte, visualizar el token recién emitido y revocar accesos vigentes. | `apps/web/src/support-access.test.tsx` |
| CA-4 | CAL-1 | `./scripts/verify.sh` en verde sin errores de lint, tipos, build ni tests. | `./scripts/verify.sh` |

## 4. Archivos autorizados

- STATE.md
- apps/api/src/app.ts
- apps/api/src/services/support-access.ts
- apps/api/src/support-access.integration.test.ts
- apps/web/src/api.ts
- apps/web/src/pages/Team.tsx
- apps/web/src/support-access.test.tsx
- docs/adr/0012-controles-operativos-juridicos-g2.md
- docs/api/README.md
- docs/learning.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0021_support_access_grants.sql
- packages/db/drizzle/meta/_journal.json
- packages/db/src/index.ts
- packages/db/src/schema.ts
- specs/026-acceso-temporal-soporte-d06-g2.md

## 5. Verificación y DoD

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Comandos de cierre:** `pnpm --filter @gym/api exec vitest run src/support-access.integration.test.ts`, `pnpm --filter @gym/web exec vitest run src/support-access.test.tsx` y `./scripts/verify.sh`.

## 6. Evidencia y checkpoint

- **Estado final:** Implementada, verificada y cerrada (2026-10-19). Revisión humana Tier 1 requerida antes del despliegue.
- CA-1: `pnpm --filter @gym/api exec vitest run src/support-access.integration.test.ts -t "CA-1"` ejecutado con éxito (1 passed) y `pnpm --filter @gym/contracts test src/contracts.test.ts` (21 passed). Concesión de soporte con duración 15..1440 min, almacenamiento estricto de tokenHash SHA-256, devolución de token en claro por única vez, solo rol admin autorizado y revocación cross-tenant rechazada con 404 (anti-enumeración).
- CA-2: `pnpm --filter @gym/api exec vitest run src/support-access.integration.test.ts -t "CA-2"` ejecutado con éxito (1 passed). `GET /api/v1/support/diagnostic-summary` valida cabecera `x-support-grant-token`, rechaza tokens inválidos/expirados/revocados con `401 UNAUTHENTICATED`, actualiza `lastUsedAt`, audita `support.diagnostic.read` en `audit_log` y retorna métricas operativas del tenant sin exponer credenciales ni PII sensible.
- CA-3: `pnpm --filter @gym/web exec vitest run src/support-access.test.tsx` ejecutado con éxito (3 passed). `Team.tsx` despliega la sección «Acceso temporal de soporte (D-06)», formulario de emisión con validación de expiración, modal interactivo de revelado único del token con copia a portapapeles, y confirmación de revocación inmediata.
- CA-4: `./scripts/verify.sh` ejecutado con éxito (código de salida 0). Calidad de código, compilación, tipos y pruebas superadas en los 4 workspaces sin regresiones (`lint`, `typecheck`, `build`, `unit`, `verify-scope`).
