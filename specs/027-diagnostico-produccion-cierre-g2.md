# Spec 027 — Diagnóstico operativo de producción, smoke-check post-despliegue y cierre de preparación G2

Estado: Abierta — lista para implementación (Ola 2 G2 — ejecutar tras fusionar 024, 025 y 026)
Nivel: Tier 1 — verificación integral de controles G2 (`D-05`, `D-06`, `P-09.3`), sondas de salud/diagnóstico de producción, sincronización documental (`CAL-3`) y sello de preparación de piloto en VPS (`REQ-1..REQ-11`).
Autoridad: decisión explícita del usuario 2026-10-19 (`A1`, `A2`); [PRD.md](../PRD.md) `REQ-1..REQ-11`, `CAL-1..CAL-3`; [ADR 0002](../docs/adr/0002-arquitectura-base.md), [ADR 0011](../docs/adr/0011-arranque-piloto-g2-empaquetado-controles.md) y [ADR 0012](../docs/adr/0012-controles-operativos-juridicos-g2.md). Commits locales autorizados; revisión humana al cierre.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:022-aceptacion-ci-staging, SPEC:023-empaquetado-produccion-bootstrap-g2, SPEC:024-custodia-reconstruccion-offline-g2, SPEC:025-consentimiento-menores-d05-g2, SPEC:026-acceso-temporal-soporte-d06-g2

## 1. Objetivo y alcance

- **Resultado observable:**
  1. **Sonda de preparación de base de datos (`GET /health/ready`) y estado del sistema (`GET /api/v1/admin/system-status`):**
     - `GET /health/ready` verifica conectividad real con PostgreSQL (`SELECT 1`) y devuelve `{ status: "ready", db: "ok" }` (`200`) o `503 SERVICE_UNAVAILABLE` si la base de datos no responde.
     - `GET /api/v1/admin/system-status` (exclusivo para `admin` del tenant) devuelve el resumen de controles de G2 de su organización: estado de política de menores (`enabled`, `serverLocked`), modo de entrega de correo (`disabled` / `configured`), estado de política offline (`enabled`, `freshnessHours`, conteo de dispositivos habilitados/revocados), concesiones de soporte activas (`activeSupportGrants`) y timestamp de servidor.
  2. **Script reproducible de humo post-despliegue (`scripts/smoke-prod.sh`):** Script Bash ejecutable (`chmod +x`, validado con `bash -n`) que comprueba contra una URL base (`BASE_URL`, default `http://localhost:3000`) que `/health` y `/health/ready` responden `200`, y que las rutas protegidas rechazan peticiones anónimas con `401`.
  3. **Sincronización 100% de contratos y documentación (`CAL-3`) y cierre de preparación G2:**
     - `docs/api/README.md` documenta todas las rutas añadidas en `024`, `025`, `026` y `027`, pasando `apps/api/src/api-docs-sync.test.ts`.
     - `docs/operations/runbook.md`, `docs/product/aceptacion-mvp.md` y `STATE.md` quedan actualizados con la evidencia integrada de `023`–`027` (incluyendo cobertura `>= 80%` y E2E Playwright en verde).
- **Incluye:** contratos `SystemStatusResponse` en `@gym/contracts`, rutas `/health/ready` y `/api/v1/admin/system-status` en `apps/api/src/app.ts`, tarjeta o indicador de estado en `Dashboard.tsx` / `Reports.tsx`, `scripts/smoke-prod.sh`, test de integración `apps/api/src/system-status-g2.integration.test.ts`, sincronización de `docs/api/README.md`, `docs/operations/runbook.md`, `docs/product/aceptacion-mvp.md` y `STATE.md`.
- **Excluye:** exposición de variables secretas (`AUTH_SECRET`, `DATABASE_URL`) en cualquier endpoint.

## 2. Contratos e invariantes

- **`GET /health/ready`:** público para el orquestador/reverse-proxy; ejecuta `SELECT 1` sobre `opts.db` y responde `200 { status: "ready", db: "ok" }` sin filtrar cadenas de conexión.
- **`GET /api/v1/admin/system-status`:**
  - Requiere rol `admin` (`403` para otros roles, `401` sin sesión).
  - Devuelve `SystemStatusResponse`:
    - `organization: { id, name }`
    - `minorPolicy: { enabled, orgEnabled, serverLocked }`
    - `emailDelivery: { mode: "disabled" | "configured", passwordReset: boolean, contactVerification: boolean }`
    - `offline: { enabled: boolean, freshnessHours: number, enabledDevicesCount: number, revokedDevicesCount: number }`
    - `supportAccess: { activeGrantsCount: number }`
    - `serverTime: string`
- **Sincronización documental (`CAL-3`):** `apps/api/src/api-docs-sync.test.ts` verifica que el 100% de las rutas `/api/v1/*` estén documentadas en `docs/api/README.md`.

## 3. Comportamientos BDD y criterios verificables

```gherkin
Escenario BDD-1: Verificación de salud profunda y estado de controles G2 por tenant
  Dado un gimnasio inicializado con bootstrapOrganization y un admin autenticado
  Cuando se consulta GET /health/ready
  Entonces responde 200 con { status: "ready", db: "ok" }
  Cuando el admin consulta GET /api/v1/admin/system-status
  Entonces recibe el estado consolidado de política de menores (D-05), correo, dispositivos offline (P-09.3) y concesiones activas de soporte (D-06) de su organización
  Y un usuario con rol recepcion o socio recibe 403 FORBIDDEN
```

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-1, REQ-11, CAL-3 | `GET /health/ready` y `GET /api/v1/admin/system-status` responden según contrato, aplicando aislamiento por organización y restricción a rol `admin`. | `apps/api/src/system-status-g2.integration.test.ts` |
| CA-2 | REQ-11, CAL-1 | `scripts/smoke-prod.sh` es ejecutable, pasa `bash -n` y verifica `/health`, `/health/ready` y rechazo `401` en `/api/v1/admin/system-status`. | `bash -n scripts/smoke-prod.sh` + `apps/api/src/system-status-g2.integration.test.ts` |
| CA-3 | CAL-1, CAL-2, CAL-3 | `api-docs-sync.test.ts` en verde para todas las rutas `001`–`027`, `./scripts/verify.sh` en verde y `pnpm test:coverage` `>= 80%`. | `./scripts/verify.sh` + `pnpm test:coverage` |
| CA-4 | REQ-1..REQ-11 | `docs/operations/runbook.md`, `docs/product/aceptacion-mvp.md` y `STATE.md` actualizados con la matriz de preparación G2 completa (`023`–`027`). | Revisión documental y `./scripts/verify.sh` |

## 4. Archivos autorizados

- STATE.md
- apps/api/src/api-docs-sync.test.ts
- apps/api/src/app.ts
- apps/api/src/system-status-g2.integration.test.ts
- apps/web/src/api.ts
- apps/web/src/pages/Dashboard.tsx
- compose.prod.yaml
- docs/adr/0012-controles-operativos-juridicos-g2.md
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- scripts/smoke-prod.sh
- specs/027-diagnostico-produccion-cierre-g2.md

## 5. Verificación y DoD

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Comandos de cierre:** `pnpm --filter @gym/api exec vitest run src/system-status-g2.integration.test.ts src/api-docs-sync.test.ts`, `bash -n scripts/smoke-prod.sh`, `pnpm test:coverage` y `./scripts/verify.sh`.

## 6. Evidencia y checkpoint

- Pendiente de ejecución por el agente asignado a la Issue de la Unidad `027` tras fusionar la Ola 1 (`024`, `025`, `026`).
