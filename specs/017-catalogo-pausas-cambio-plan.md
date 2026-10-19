# Spec 017 — Edición de catálogo, pausas autorizadas y cambio de plan

Estado: Cerrada — contratos, migración 0014, API, UI web, integración PostgreSQL, cobertura 97% y E2E Playwright verificados
Nivel: Tier 1 — derechos de membresía, vigencia temporal, revalidación de reservas con créditos y migración aditiva.
Autoridad: validación explícita del usuario 2026-10-19 (`A1`); [PRD.md](../PRD.md) `REQ-1`, `REQ-2`, `REQ-5`, `REQ-7`, `CAL-2`, `CAL-3`; [ADR 0002](../docs/adr/0002-arquitectura-base.md), [ADR 0009](../docs/adr/0009-creditos-por-modalidad-periodo.md) y [ADR 0010](../docs/adr/0010-ciclo-comercial-agenda-exportaciones.md). Commits locales autorizados por unidad verificada; revisión humana al cierre.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:003-planes-pagos-caja, SPEC:016-periodos-creditos

## 1. Objetivo y alcance

- **Resultado observable:** Administración puede actualizar las condiciones comerciales de un plan del catálogo (`plans`) y activarlo/desactivarlo para futuras contrataciones o renovaciones sin alterar ningún período ya emitido (`membership_periods`). Administración puede registrar y levantar pausas auditadas sobre una membresía con período vigente, extendiendo su fecha de término por los días efectivos pausados y cancelando automáticamente las reservas futuras que caigan dentro del intervalo pausado (restituyendo su crédito al período original). Administración y recepción pueden dejar programado un cambio de plan (`nextPlanId`) para el próximo período de renovación.
- **Incluye:** migración aditiva `0014_catalog_pauses_plan_changes.sql`, contratos Zod en `@gym/contracts`, lógica transaccional en `PlansService`, `MembershipsService`, `PaymentsService` y `BookingCreditsService`, endpoints en `apps/api/src/app.ts`, vistas en `Plans.tsx`, `MemberDetail.tsx` y `Portal.tsx`, pruebas de integración PostgreSQL, cobertura financiera y E2E.
- **Excluye:** abonos parciales (Unidad `019`), reprogramación de sesiones (Unidad `018`) y prórrogas comerciales arbitrarias sin pausa registrada.

## 2. Contratos e invariantes

- **Edición de catálogo (`PATCH /api/v1/plans/:id`, solo `admin`):**
  - Entrada `UpdatePlanRequest`: `{ name?: string, priceCents?: int > 0, durationDays?: int > 0, coverage?: 'none'|'unlimited'|'limited', classCredits?: { grupal, fija, cita } | null, active?: boolean }`.
  - Si `coverage === 'limited'` (nuevo o resultante), `classCredits` completo (`0..100000` por modalidad) es obligatorio (`400` si falta); si `coverage !== 'limited'`, las cuotas por modalidad quedan `null`.
  - Invariante de inmutabilidad: actualizar `plans` incrementa `version` (entero `>= 1`, default `1`) y jamás modifica filas existentes en `membership_periods` ni recalcula créditos de períodos ya validados. Un plan con `active = false` rechaza nuevas asignaciones (`POST /api/v1/memberships` → `409`) y cambios programados hacia él (`409`).
- **Cambio de plan para el siguiente período (`POST /api/v1/memberships/:id/schedule-plan-change`, `admin` y `recepcion`):**
  - Entrada `SchedulePlanChangeRequest`: `{ nextPlanId: UUID | null }`.
  - Verifica aislamiento tenant (`404` si la membresía o el plan pertenecen a otra organización) y que `nextPlanId` esté `active = true` (`409` si inactivo).
  - El período actual (`membership_periods`) mantiene intactos su cobertura, duración y créditos. Al registrar un nuevo pago de renovación sobre esa membresía (o al validarlo), si `nextPlanId` está definido, el pago y el nuevo `membership_period` toman las condiciones vigentes de `nextPlanId`, actualizan `memberships.planId = nextPlanId` y limpian `nextPlanId = null` en la misma transacción.
- **Pausas autorizadas de membresía (`POST /api/v1/memberships/:id/pauses`, solo `admin`):**
  - Entrada `CreateMembershipPauseRequest`: `{ idempotencyKey: UUID, startsAt: ISO datetime, endsAt: ISO datetime, reason: trim 1..1000 }`, con `endsAt > startsAt` y duración en días enteros exactos o redondeados hacia arriba (`pauseDays >= 1`).
  - Tabla `membership_pauses` (append-only con estado `active | lifted` o registro auditable): `id`, `organizationId`, `membershipId`, `periodId`, `actorId`, `idempotencyKey` (unique por `organizationId, idempotencyKey`), `startsAt`, `endsAt`, `extendedDays`, `reason`, `createdAt`.
  - Bajo lock transaccional de `memberships` y del `membership_period` vigente:
    1. Rechaza `409` si la membresía no tiene un período vigente que cubra `startsAt` o si se solapa con otra pausa activa del mismo período.
    2. Extiende `membership_periods.endsAt` y `memberships.endAt` en `+ extendedDays` días.
    3. Durante `[startsAt, endsAt)` el socio figura en estado `paused` para check-in (`POST /api/v1/checkin` devuelve `allowed: false, reason: 'membership_paused'`) y no puede reservar sesiones cuyo `startsAt` caiga dentro del intervalo pausado (`409`).
    4. Cancela en la misma transacción todas las reservas `confirmada` futuras del socio cuyo `sessions.startsAt` caiga dentro de `[startsAt, endsAt)`, registrando `booking_cancellations` (`type: 'gimnasio'`, `creditReturned: true`) y `credit_movements` (`kind: 'return'`, `+1`) hacia el período original una sola vez, y escribe `audit_log` (`membership.paused`).
    5. Replay con la misma `(organizationId, idempotencyKey)` e igual cuerpo devuelve `200` con la misma pausa sin volver a extender `endsAt` ni duplicar cancelaciones; cuerpo distinto bajo la misma clave devuelve `409`.

## 3. Comportamientos BDD y criterios verificables

```gherkin
Escenario BDD-1: Editar plan del catálogo preserva períodos emitidos y aplica solo a contrataciones nuevas
  Dado un socio con período validado bajo "Plan Trimestral" ($90.000, 12 grupales)
  Cuando el admin edita "Plan Trimestral" a $110.000 y 8 grupales
  Entonces el período ya emitido del socio conserva $90.000 y 12 grupales en membership_periods
  Y un nuevo pago validado posterior captura $110.000, 8 grupales y la nueva versión del plan

Escenario BDD-2: Pausa autorizada por admin extiende fin y libera reservas dentro del rango pausado
  Dado un socio con período limitado vigente [día 1, día 31) y una reserva confirmada en el día 10 (1 crédito comprometido)
  Cuando el admin registra una pausa de 5 días [día 8, día 13) con motivo médico
  Entonces el período pasa a vencer el día 36, la reserva del día 10 queda cancelada y el crédito se restituye una vez
  Y el socio no puede hacer check-in ni reservar clases dentro de [día 8, día 13), pero sí reservar en el día 33
```

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-2, CAL-3 | `PATCH /api/v1/plans/:id` actualiza catálogo e incrementa `version` sin mutar `membership_periods` existentes; plan desactivado rechaza nuevas asignaciones (`409`); planes limitados sin cuotas completas devuelven `400`. | `apps/api/src/memberships-lifecycle.integration.test.ts` + `packages/contracts/src/contracts.test.ts` |
| CA-2 | REQ-2, REQ-7 | `POST /api/v1/memberships/:id/schedule-plan-change` programa `nextPlanId` sin alterar el período en curso y lo materializa al validar la siguiente renovación; visible en ficha y portal. | `apps/api/src/memberships-lifecycle.integration.test.ts` |
| CA-3 | REQ-2, REQ-5, REQ-8 | `POST /api/v1/memberships/:id/pauses` (solo `admin`) es idempotente bajo concurrencia, extiende `endsAt`/`endAt` exactamente una vez, deniega check-in/reservas durante la pausa y cancela reservas futuras dentro del intervalo pausado restituyendo el crédito al período. | `apps/api/src/memberships-lifecycle.integration.test.ts` |
| CA-4 | REQ-1, REQ-7 | Aislamiento multi-tenant (`404` en IDs de otra organización) y control de roles (`recepcion`/`instructor`/`socio` → `403` al editar plan o pausar; `instructor`/`socio` → `403` al programar cambio de plan). | `apps/api/src/memberships-lifecycle.integration.test.ts` |
| CA-5 | REQ-2, REQ-7 | UI en `Plans.tsx` (editar/archivar plan), `MemberDetail.tsx` (pausar membresía con motivo y programar cambio de plan) y `Portal.tsx` (mostrar pausa activa, nueva fecha de fin y cambio programado); E2E y viewport móvil sin overflow. | `apps/web/src/memberships-lifecycle.test.tsx` + `tests/e2e/credits.spec.ts` |
| CA-6 | CAL-1, CAL-2 | Fase roja previa a implementación; cobertura financiera/reservas `>= 80%`; `./scripts/verify.sh` verde sin omitidos; actualización de `docs/api/README.md`, `STATE.md` y `docs/learning.md`. | `./scripts/verify.sh` + `pnpm test:coverage` + `pnpm test:e2e` |

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
- apps/web/src/api.ts
- apps/web/src/components/CreditPeriods.tsx
- apps/web/src/memberships-lifecycle.test.tsx
- apps/web/src/pages/MemberDetail.tsx
- apps/web/src/pages/Plans.tsx
- apps/web/src/pages/Portal.tsx
- docs/adr/0010-ciclo-comercial-agenda-exportaciones.md
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0014_catalog_pauses_plan_changes.sql
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

## 5. Verificación, DoD y reversión

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Secuencia TDD en sesión de codificación:** (1) escribir pruebas en `contracts.test.ts`, `memberships-lifecycle.integration.test.ts` y `memberships-lifecycle.test.tsx` y confirmar fallo rojo; (2) aplicar migración aditiva `0014_catalog_pauses_plan_changes.sql` y lógica mínima; (3) ejecutar `pnpm test:integration`, `pnpm test:coverage`, `pnpm test:e2e` y `./scripts/verify.sh` con `TEST_DATABASE_URL` y workers=1.
- **Reversión:** migración `0014` puramente aditiva (`plans.version`, `memberships.next_plan_id`, `membership_periods.plan_version`, tabla `membership_pauses`); no borrar pausas ni períodos históricos para revertir.
- **Revisión Tier 1:** revisión humana del usuario al cierre de la implementación.

## 6. Evidencia y checkpoint

- CA-1: `TEST_DATABASE_URL=postgres://gym:gym-local-dev@localhost:55432/gym_test_memberships_lifecycle pnpm --filter @gym/api exec vitest run src/memberships-lifecycle.integration.test.ts` → 4/4; `pnpm --filter @gym/contracts test` → 14/14; PATCH /api/v1/plans/:id incrementa versión, valida cuotas completas en planes limitados y no altera membership_periods previos ni recalcula créditos; plan inactivo rechaza nuevas membresías con 409.
- CA-2: `TEST_DATABASE_URL=postgres://gym:gym-local-dev@localhost:55432/gym_test_memberships_lifecycle pnpm --filter @gym/api exec vitest run src/memberships-lifecycle.integration.test.ts` → 4/4; POST /api/v1/memberships/:id/schedule-plan-change programa nextPlanId sin alterar el período en curso y lo materializa al validar la siguiente renovación, asignando las nuevas condiciones y limpiando nextPlanId.
- CA-3: `TEST_DATABASE_URL=postgres://gym:gym-local-dev@localhost:55432/gym_test_memberships_lifecycle pnpm --filter @gym/api exec vitest run src/memberships-lifecycle.integration.test.ts` → 4/4; POST /api/v1/memberships/:id/pauses es idempotente por (organizationId, idempotencyKey), extiende endsAt y endAt por los días pausados, deniega check-in con 'membership_paused', bloquea reservas dentro del intervalo pausado y cancela reservas futuras dentro de la pausa restituyendo créditos.
- CA-4: `TEST_DATABASE_URL=postgres://gym:gym-local-dev@localhost:55432/gym_test_memberships_lifecycle pnpm --filter @gym/api exec vitest run src/memberships-lifecycle.integration.test.ts` → 4/4; aislamiento tenant devuelve 404 ante planes o membresías de otra organización; control de roles devuelve 403 a roles no autorizados (solo admin edita planes y pausa membresías; solo admin y recepción programan cambio de plan).
- CA-5: `pnpm --filter @gym/web test` → 39/39 (incluye src/memberships-lifecycle.test.tsx 3/3); UI en Plans.tsx (editar y activar/archivar), MemberDetail.tsx (modal de pausa y selector de cambio de plan) y Portal.tsx (alerta de pausa activa con motivo y aviso de próximo plan programado); `node scripts/e2e.mjs` → 12/12 en Playwright, incluyendo prueba E2E completa de SPEC017 y viewport móvil sin overflow horizontal (screenshot /tmp/gym-017-pauses-mobile.png).
- CA-6: fase roja documentada con fallos de rutas/contratos no implementados; `node scripts/coverage.mjs` → 68/68, 97.09% statements/lines (umbral >= 80% superado); `./scripts/verify.sh` → salida 0 en lint, typecheck, build y tests; documentación actualizada en docs/api/README.md, STATE.md y docs/learning.md.

Checkpoint: revisión propia del diff y alcance, aprendizaje/matriz/runbook/API docs actualizados. Revisión humana del usuario al cierre (Tier 1). Commit local de unidad 017 con Conventional Commits. Próxima unidad planificada: 018-reprogramacion-agenda-citas. Contador de falta de progreso en 0.
