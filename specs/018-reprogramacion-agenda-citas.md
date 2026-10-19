# Spec 018 — Reprogramación de sesiones y citas personalizadas en agenda unificada

Estado: Cerrada — Implementada y verificada según DoD de AGENTS.md §9.
Nivel: Tier 1 — concurrencia de agenda (`TX-02`), preservación de créditos comprometidos y revalidación de cobertura a la nueva fecha (`REVAL-01`).
Autoridad: validación explícita del usuario 2026-10-19 (`A2`); [PRD.md](../PRD.md) `REQ-1`, `REQ-4`, `REQ-5`, `REQ-6`, `REQ-7`, `CAL-2`, `CAL-3`; [ADR 0002](../docs/adr/0002-arquitectura-base.md), [ADR 0009](../docs/adr/0009-creditos-por-modalidad-periodo.md) y [ADR 0010](../docs/adr/0010-ciclo-comercial-agenda-exportaciones.md). Commits locales autorizados; revisión humana al cierre.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:004-clases-reservas, SPEC:016-periodos-creditos, SPEC:017-catalogo-pausas-cambio-plan

## 1. Objetivo y alcance

- **Resultado observable:** Administración, recepción y el instructor titular (para sus propias sesiones `cita` y `bloqueo`) pueden reprogramar el horario (`startsAt`, `endsAt`) de una sesión futura en estado `programada` dentro de la agenda unificada del instructor. Las reservas confirmadas se trasladan con la sesión conservando su crédito ya comprometido siempre que ningún socio inscrito pierda cobertura en la nueva fecha/hora (incluyendo ventanas de período y pausas activas de `017`). El nuevo horario y el historial de reprogramación son visibles en la agenda de staff y en el portal del socio.
- **Incluye:** migración aditiva `0018_session_reschedule.sql` (metadatos de última reprogramación en `sessions`), contrato `RescheduleSessionRequest`, comando transaccional `SessionsService.reschedule`, ruta `POST /api/v1/sessions/:id/reschedule`, UI en `Classes.tsx`, `SessionDetail.tsx` y `Portal.tsx`, suites de integración con concurrencia `TX-02` y E2E.
- **Excluye:** cambio de modalidad de la sesión (`grupal` ↔ `fija` ↔ `cita`), que exige cancelar y crear nueva sesión para no violar las cuotas por modalidad de [ADR 0009](../docs/adr/0009-creditos-por-modalidad-periodo.md).

## 2. Contratos e invariantes

- **Endpoint `POST /api/v1/sessions/:id/reschedule`:**
  - Entrada `RescheduleSessionRequest`: `{ startsAt: ISO datetime, endsAt: ISO datetime, reason?: trim 1..500 }`, con `endsAt > startsAt` y `startsAt` en el futuro respecto al reloj del servidor (`400`/`409` si la sesión ya inició, no está `programada` o el nuevo horario es pasado).
  - **Permisos y aislamiento:**
    - Otra organización → `404`.
    - `socio` → `403`.
    - `instructor`: permitido únicamente si `session.instructorId === actor.accountId` y `session.type` es `'cita'` o `'bloqueo'`; sobre sesiones de otro instructor o sobre `grupal`/`fija` → `403`.
    - `admin` y `recepcion`: permitido sobre cualquier sesión `programada` de su organización.
- **Invariantes transaccionales (`TX-02` + `REVAL-01`):**
  1. Adquiere el advisory lock transaccional del instructor (`pg_advisory_xact_lock` por `organizationId + instructorId`, idéntico a `SessionsService.create`) y bloquea la fila `sessions` con `FOR UPDATE`.
  2. Comprueba que no exista otra sesión `programada` (distinta de `session.id`) del mismo instructor cuyo intervalo `[startsAt, endsAt)` se solape con el nuevo horario (`409 SESSION_OVERLAP`).
  3. Carga todas las reservas `confirmada` de la sesión y bloquea sus membresías/períodos asociados en orden estable. Para cada reserva confirmada verifica que el socio tenga cobertura efectiva en el nuevo `startsAt` (dentro de `[period.startsAt, period.endsAt)` del período comprometido o de un período confirmado de la misma modalidad, y fuera de cualquier pausa activa de `017`) y que el socio no tenga otra reserva `confirmada` en una sesión distinta que se solape con el nuevo `[startsAt, endsAt)`.
  4. Si algún socio inscrito no tiene cobertura en la nueva fecha o presenta conflicto horario, rechaza toda la operación con `409 RESCHEDULE_MEMBER_UNCOVERED` (indicando la causa) sin mover la sesión ni alterar reservas o créditos.
  5. Si todos los inscritos cumplen cobertura, actualiza `sessions.startsAt`, `sessions.endsAt`, `sessions.rescheduledAt = now()`, `sessions.rescheduledFromStartsAt` y `sessions.rescheduledCount = rescheduledCount + 1`, conserva intactas las filas `bookings` y `credit_movements` (el crédito `commit (-1)` ya tomado sigue válido sin doble descuento) y registra `audit_log` (`session.rescheduled`).

## 3. Comportamientos BDD y criterios verificables

```gherkin
Escenario BDD-1: Reprogramar cita personalizada sin solape conserva la reserva y el crédito comprometido
  Dado un socio con período vigente de 4 citas y una cita reservada el martes a las 10:00 (3 créditos disponibles)
  Cuando recepción reprograma la cita al miércoles a las 11:00 dentro del mismo período y sin solape del instructor
  Entonces la sesión actualiza su horario al miércoles 11:00 con marca de reprogramación
  Y la reserva sigue confirmada con exactamente 3 créditos disponibles (sin segundo descuento)

Escenario BDD-2: Rechazo atómico si el nuevo horario choca con la agenda del instructor o cae fuera de la cobertura de un inscrito
  Dado una sesión con un socio cuyo período vence el 30 de octubre
  Cuando se intenta reprogramar la sesión al 2 de noviembre (o a una hora ocupada por un bloqueo del instructor)
  Entonces el servidor responde 409 y la sesión conserva su horario original sin alterar reservas ni créditos
```

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-6, CAL-3 | `POST /api/v1/sessions/:id/reschedule` mueve horario de `grupal`/`fija`/`cita`/`bloqueo` programada futura, registra `rescheduledFromStartsAt`/`rescheduledCount` y conserva `bookings` + `credit_movements` sin segundo descuento. | `apps/api/src/sessions-reschedule.integration.test.ts` + `packages/contracts/src/contracts.test.ts` |
| CA-2 | REQ-6, REQ-8 | Dos creaciones/reprogramaciones concurrentes hacia el mismo tramo horario del mismo instructor (`TX-02`) serializan por lock: una confirma `200` y la otra recibe `409`. | `apps/api/src/sessions-reschedule.integration.test.ts` |
| CA-3 | REQ-5, REQ-6 | Si algún socio con reserva `confirmada` no cubre la nueva fecha (período vencido, pausa activa `017` o solape con otra reserva del socio), devuelve `409` sin cambios parciales. | `apps/api/src/sessions-reschedule.integration.test.ts` |
| CA-4 | REQ-1, REQ-6, REQ-7 | Permisos por rol (`instructor` solo sus propias `cita`/`bloqueo`; `socio` `403`; otro tenant `404`). | `apps/api/src/sessions-reschedule.integration.test.ts` |
| CA-5 | REQ-6, REQ-7 | UI en `SessionDetail.tsx` / `Classes.tsx` para reprogramar y mostrar indicador de horario reprogramado en agenda staff y en `Portal.tsx`. | `apps/web/src/sessions-reschedule.test.tsx` + `tests/e2e/operation.spec.ts` |
| CA-6 | CAL-1, CAL-2 | Fase roja previa; cobertura `>= 80%`; `./scripts/verify.sh` verde sin omitidos; documentación y checkpoint actualizados. | `./scripts/verify.sh` + `pnpm test:coverage` + `pnpm test:e2e` |

## 4. Archivos autorizados

- STATE.md
- apps/api/src/app.ts
- apps/api/src/memberships-lifecycle.integration.test.ts
- apps/api/src/services/booking-credits.ts
- apps/api/src/services/bookings.ts
- apps/api/src/services/checkin.ts
- apps/api/src/services/memberships.ts
- apps/api/src/services/operations.ts
- apps/api/src/services/payments.ts
- apps/api/src/services/plans.ts
- apps/api/src/services/sessions.ts
- apps/api/src/sessions-reschedule.integration.test.ts
- apps/web/src/api.ts
- apps/web/src/components/CreditPeriods.tsx
- apps/web/src/memberships-lifecycle.test.tsx
- apps/web/src/pages/Classes.tsx
- apps/web/src/pages/MemberDetail.tsx
- apps/web/src/pages/Plans.tsx
- apps/web/src/pages/Portal.tsx
- apps/web/src/pages/SessionDetail.tsx
- apps/web/src/sessions-reschedule.test.tsx
- docs/adr/0010-ciclo-comercial-agenda-exportaciones.md
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0014_catalog_pauses_plan_changes.sql
- packages/db/drizzle/0018_session_reschedule.sql
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

## 5. Verificación, DoD y reversión

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Secuencia TDD en sesión de codificación:** primero pruebas rojas en `sessions-reschedule.integration.test.ts` y `sessions-reschedule.test.tsx`; luego migración `0018_session_reschedule.sql`, servicio, ruta y UI; cierre con `./scripts/verify.sh`, `pnpm test:coverage` y `pnpm test:e2e`.
- **Reversión:** columnas `rescheduled_at`, `rescheduled_from_starts_at`, `rescheduled_count` nullable/default `0` en `sessions`; no borra auditoría histórica.
- **Revisión Tier 1:** revisión humana del usuario al cierre.

## 6. Evidencia y checkpoint

- **CA-1:** `pnpm --filter @gym/api exec vitest run src/sessions-reschedule.integration.test.ts -t "CA-1"` (1 passed) y `pnpm --filter @gym/contracts test` (16 passed).
- **CA-2:** `pnpm --filter @gym/api exec vitest run src/sessions-reschedule.integration.test.ts -t "CA-2"` (1 passed, serialización TX-02 200 y 409).
- **CA-3:** `pnpm --filter @gym/api exec vitest run src/sessions-reschedule.integration.test.ts -t "CA-3"` (1 passed, REVAL-01 rechaza períodos vencidos, pausas activas 017 y solapes).
- **CA-4:** `pnpm --filter @gym/api exec vitest run src/sessions-reschedule.integration.test.ts -t "CA-4"` (1 passed, permisos por rol y aislamiento cross-tenant 404).
- **CA-5:** `pnpm --filter @gym/web test src/sessions-reschedule.test.tsx` (4 passed) y `node scripts/e2e.mjs` (14 passed en 31.8s, incluyendo flujo E2E de reprogramación y distintivo en portal).
- **CA-6:** `./scripts/verify.sh` superado en verde (lint, build, typecheck, tests en 4 workspaces y verify-scope verificado); `node scripts/coverage.mjs` (72 passed, 97.09% statements/lines).
- **Estado final:** Cerrada — Verificación completa según DoD de AGENTS.md §9. Commits locales autorizados, sin push a remoto.
