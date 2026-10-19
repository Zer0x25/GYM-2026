# Spec 020 — Matriz de exportaciones operativas CSV (socios, vigencias y asistencia)

Estado: Aprobada — base validada por el usuario; lista para fase roja e implementación tras Unidad 019
Nivel: Tier 2 — proyecciones de lectura y exportación CSV con control de permisos por rol y aislamiento multi-tenant.
Autoridad: validación explícita del usuario 2026-10-19 (`A4`); [PRD.md](../PRD.md) `REQ-1`, `REQ-2`, `REQ-4`, `REQ-5`, `REQ-7`, `CAL-3`; [ADR 0002](../docs/adr/0002-arquitectura-base.md) y [ADR 0010](../docs/adr/0010-ciclo-comercial-agenda-exportaciones.md). Autoaceptación Tier 2 dentro del PRD y la base confirmada; commits locales autorizados.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:010-app-operativa, SPEC:012-transbank-manual, SPEC:016-periodos-creditos

## 1. Objetivo y alcance

- **Resultado observable:** Administración y recepción pueden descargar en formato CSV (`text/csv; charset=utf-8`), además del reporte financiero diario existente, los tres padrones operativos requeridos por la matriz de aceptación ([aceptacion-mvp.md](../docs/product/aceptacion-mvp.md)): (1) Socios, (2) Vigencias/períodos y créditos, y (3) Reservas y asistencia por rango de fechas, estrictamente acotados a su `organizationId` y sin exponer secretos ni tokens QR.
- **Incluye:** contratos de query y validación en `@gym/contracts`, métodos de exportación en `OperationsService`, endpoints `GET /api/v1/reports/members.csv`, `GET /api/v1/reports/memberships.csv` y `GET /api/v1/reports/attendance.csv`, controles de descarga en `Reports.tsx`, pruebas de integración (aislamiento, roles, escapado CSV anti-inyección de fórmulas) y prueba E2E.
- **Excluye:** exportación de `qrToken`, hashes de tokens o datos de otras organizaciones.

## 2. Contratos e invariantes

- **Permisos y seguridad transversal:**
  - Solo `admin` y `recepcion` autenticados pueden invocar las rutas `/api/v1/reports/*.csv`. `instructor` y `socio` reciben `403 FORBIDDEN`; no autenticado recibe `401`.
  - Toda consulta filtra por `actor.organizationId` (`REQ-1`).
  - **Sanitización CSV:** todo campo de texto libre (`fullName`, `contactEmail`, `planName`, `reason`) se escapa según RFC 4180 y neutraliza prefijos de fórmula (`=`, `+`, `-`, `@`, `\t`, `\r`) anteponiendo apóstrofo `'` cuando corresponda.
- **Endpoints y columnas:**
  1. `GET /api/v1/reports/members.csv`:
     - Columnas: `member_id,full_name,contact_email,contact_verified,adult_responsible_id,qr_state,membership_status,created_at`.
     - Nunca incluye `qr_token` (solo `qr_state`: `activo | revocado | sin_emitir`).
  2. `GET /api/v1/reports/memberships.csv`:
     - Columnas: `membership_id,member_id,member_name,plan_name,coverage,state,period_starts_at,period_ends_at,grupal_available,fija_available,cita_available,pending_review_count,next_plan_id`.
  3. `GET /api/v1/reports/attendance.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`:
     - Valida `from <= to` y rango máximo de 93 días (`400` si formato o rango inválido).
     - Columnas: `booking_id,session_id,session_type,template_name,instructor_id,starts_at,member_id,member_name,booking_state,attendance_outcome,cancellation_type,credit_returned`.

## 3. Comportamientos BDD y criterios verificables

```gherkin
Escenario BDD-1: Descarga de CSV de socios, vigencias y asistencia acotada al tenant y sin tokens sensibles
  Dado dos organizaciones A y B con socios, períodos activos y asistencias registradas
  Cuando recepción de la organización A descarga members.csv, memberships.csv y attendance.csv
  Entonces cada CSV contiene únicamente filas de la organización A con las cabeceras esperadas
  Y ningún CSV contiene el valor de qrToken de ningún socio

Escenario BDD-2: Rechazo a instructor y socio
  Dado un usuario con rol instructor o socio autenticado
  Cuando solicita cualquiera de los endpoints /api/v1/reports/*.csv
  Entonces recibe 403 FORBIDDEN
```

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-1, REQ-2, CAL-3 | `GET /api/v1/reports/members.csv` y `memberships.csv` devuelven `200 text/csv` solo con filas del tenant del actor, reflejando estado de contacto verificado, adulto responsable, vigencia y saldos por modalidad, sin exponer `qrToken`. | `apps/api/src/operations.integration.test.ts` |
| CA-2 | REQ-4, REQ-5, CAL-3 | `GET /api/v1/reports/attendance.csv?from=...&to=...` exporta reservas, asistencia (`asistio`/`ausencia`) y cancelaciones del rango, y rechaza con `400` rangos inválidos (`from > to` o `> 93` días). | `apps/api/src/operations.integration.test.ts` |
| CA-3 | REQ-1, REQ-7 | `instructor` y `socio` reciben `403` en los tres endpoints; anónimo recibe `401`; textos con `=CMD(...)` o comillas se escapan de forma segura. | `apps/api/src/operations.integration.test.ts` |
| CA-4 | CAL-1, CAL-3 | `Reports.tsx` permite descargar los 4 reportes CSV (financiero diario, socios, vigencias/créditos, reservas/asistencia); `./scripts/verify.sh` y E2E en verde. | `apps/web/src/reports-export.test.tsx` + `tests/e2e/operation.spec.ts` + `./scripts/verify.sh` |

## 4. Archivos autorizados

- STATE.md
- apps/api/src/app.ts
- apps/api/src/memberships-lifecycle.integration.test.ts
- apps/api/src/operations.integration.test.ts
- apps/api/src/partial-payments.integration.test.ts
- apps/api/src/services/booking-credits.ts
- apps/api/src/services/bookings.ts
- apps/api/src/services/cash.ts
- apps/api/src/services/checkin.ts
- apps/api/src/services/financial-adjustments.ts
- apps/api/src/services/memberships.ts
- apps/api/src/services/operations.ts
- apps/api/src/services/payments.ts
- apps/api/src/services/plans.ts
- apps/api/src/services/sessions.ts
- apps/api/src/sessions-reschedule.integration.test.ts
- apps/web/src/api.ts
- apps/web/src/components/CreditPeriods.tsx
- apps/web/src/components/QuickPay.tsx
- apps/web/src/memberships-lifecycle.test.tsx
- apps/web/src/pages/Cash.tsx
- apps/web/src/pages/Classes.tsx
- apps/web/src/pages/MemberDetail.tsx
- apps/web/src/pages/Payments.tsx
- apps/web/src/pages/Plans.tsx
- apps/web/src/pages/Portal.tsx
- apps/web/src/pages/Reports.tsx
- apps/web/src/pages/SessionDetail.tsx
- apps/web/src/partial-payments.test.tsx
- apps/web/src/reports-export.test.tsx
- apps/web/src/sessions-reschedule.test.tsx
- docs/adr/0010-ciclo-comercial-agenda-exportaciones.md
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0014_catalog_pauses_plan_changes.sql
- packages/db/drizzle/0015_session_reschedule.sql
- packages/db/drizzle/0016_partial_payments_reconciliation.sql
- packages/db/drizzle/meta/_journal.json
- packages/db/src/index.ts
- packages/db/src/schema.ts
- scripts/coverage.mjs
- specs/017-catalogo-pausas-cambio-plan.md
- specs/018-reprogramacion-agenda-citas.md
- specs/019-abonos-parciales-conciliacion.md
- specs/020-exportaciones-operativas-csv.md
- specs/021-menores-correo-contratos.md
- specs/022-aceptacion-ci-staging.md
- tests/e2e/credits.spec.ts
- tests/e2e/operation.spec.ts

## 5. Verificación y DoD

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Secuencia TDD en sesión de codificación:** añadir casos rojos en `operations.integration.test.ts` y `reports-export.test.tsx` → implementar proyecciones CSV y botones en `Reports.tsx` → ejecutar `./scripts/verify.sh` y `pnpm test:e2e`.

## 6. Evidencia y checkpoint

- **Estado actual:** Spec validada y registrada en la sesión de planificación de base (2026-10-19). Pendiente de fase roja e implementación tras Unidad `019`.
