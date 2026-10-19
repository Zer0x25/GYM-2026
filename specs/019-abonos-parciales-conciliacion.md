# Spec 019 — Abonos parciales con activación al 100% y estados de conciliación

Estado: Cerrada (2026-10-19) — Implementada y verificada; revisión humana Tier 1 pendiente al cierre
Nivel: Tier 1 — dinero, activación de derechos, caja/conciliación, concurrencia y migración aditiva.
Autoridad: validación explícita del usuario 2026-10-19 (`A3`); [PRD.md](../PRD.md) `REQ-1`, `REQ-2`, `REQ-3`, `REQ-8`, `CAL-2`, `CAL-3`; [ADR 0002](../docs/adr/0002-arquitectura-base.md), [ADR 0008](../docs/adr/0008-ajustes-devoluciones.md), [ADR 0009](../docs/adr/0009-creditos-por-modalidad-periodo.md) y [ADR 0010](../docs/adr/0010-ciclo-comercial-agenda-exportaciones.md). Commits locales autorizados; revisión humana al cierre.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:003-planes-pagos-caja, SPEC:014-ajustes-devoluciones, SPEC:016-periodos-creditos

## 1. Objetivo y alcance

- **Resultado observable:** Recepción y administración pueden registrar pagos parciales (abonos) contra una membresía (`0 < amountCents <= pendingCents`). Cada abono parcial validado por un `admin` distinto del registrador ingresa de inmediato a la sesión de caja abierta (`cash_movements`), pero el período confirmado (`membership_periods`), su ventana de cobertura y sus cuotas de créditos se crean y activan únicamente cuando la suma de abonos validados del ciclo alcanza el `100%` del precio objetivo del plan (`targetPriceCents`). Asimismo, cada sesión de caja cerrada y el reporte diario exponen explícitamente el estado de conciliación (`abierta`, `cuadrada`, `con_diferencia`).
- **Incluye:** migración aditiva `0016_partial_payments_reconciliation.sql`, actualización de contratos en `@gym/contracts`, lógica transaccional en `PaymentsService`, `CashService` y `OperationsService`, vistas en `Payments.tsx`, `Cash.tsx`, `MemberDetail.tsx`, `QuickPay.tsx` y `Reports.tsx`, suite de integración financiera con concurrencia y E2E.
- **Excluye:** líneas de crédito post-pago que activen cobertura antes de cubrir el `100%` del precio del plan (expresamente descartado en `A3`).

## 2. Contratos e invariantes

- **Ciclo de abonos por membresía (`PaymentsService`):**
  - Al iniciar el cobro de un período (o al asignar membresía / iniciar renovación), el precio objetivo del ciclo (`targetPriceCents`) se fija desde el plan aplicable (`nextPlanId` si fue programado en `017`, o `planId` actual).
  - Un pago provisional (`POST /api/v1/payments`) acepta `amountCents > 0` tal que la suma de pagos `validated` del ciclo actual aún sin período emitido más el nuevo `amountCents` no supere `targetPriceCents` (`409 AMOUNT_EXCEEDS_CYCLE_BALANCE` si excede el saldo pendiente del ciclo).
  - Al validar un abono (`POST /api/v1/payments/:id/decide` con `decision: 'validate'`, solo `admin` distinto de `registeredBy` y con sesión de caja abierta):
    1. Bloquea `memberships` y `payments` en orden estable y la `cash_session` abierta.
    2. Comprueba que `paidValidatedCents + payment.amountCents <= targetPriceCents` (si dos abonos concurrentes intentan sobrepagar el saldo restante del ciclo, el segundo recibe `409` sin crear movimiento de caja).
    3. Inserta siempre el `cash_movement` (`unique(payment_id)`) por `payment.amountCents` y escribe `audit_log`.
    4. Si `paidValidatedCents + payment.amountCents < targetPriceCents`: la membresía permanece sin nuevo `membership_period` (si era primera compra sigue `pending_payment`; si era renovación anticipada conserva su ventana anterior sin extenderla aún) y expone `cyclePaidCents` y `cycleRemainingCents`.
    5. Si `paidValidatedCents + payment.amountCents === targetPriceCents`: crea el `membership_period` inmutable en la misma transacción (vinculando los pagos del ciclo al período mediante `payments.periodId` y `membership_periods.paymentId` al pago completador), extiende `[startAt, endAt)` y habilita las cuotas de créditos del período.
- **Estados explícitos de conciliación (`CashService` y `OperationsService`):**
  - En `cash_sessions` y sus proyecciones de lectura (`GET /api/v1/cash/sessions`, `GET /api/v1/reports/daily`):
    - Si `state === 'open'` → `reconciliationState = 'abierta'`.
    - Si `state === 'closed'` y `discrepancyCents === 0` → `reconciliationState = 'cuadrada'`.
    - Si `state === 'closed'` y `discrepancyCents !== 0` → `reconciliationState = 'con_diferencia'`.
  - El reporte diario incluye además el resumen de abonos validados pendientes de completar ciclo (`partialCyclesPendingCents`, `partialCyclesCount`).

## 3. Comportamientos BDD y criterios verificables

```gherkin
Escenario BDD-1: Dos abonos parciales entran a caja por separado y activan el período solo al completar el 100%
  Dado un plan de $30.000 con 8 clases grupales y un socio con membresía pendiente de pago
  Cuando recepción registra un primer abono de $10.000 y el admin lo valida con caja abierta
  Entonces la caja suma $10.000, el ciclo muestra $10.000 pagados / $20.000 pendientes y el socio aún NO tiene período activo ni créditos
  Cuando recepción registra el segundo abono de $20.000 y el admin lo valida
  Entonces la caja suma $30.000 acumulados y se crea un único membership_period activo con 8 créditos grupales

Escenario BDD-2: Bloqueo de sobrepago concurrente y estado de conciliación de caja
  Dado un ciclo con saldo pendiente de $10.000 y dos abonos provisionales de $10.000 registrados por error
  Cuando dos admins intentan validar ambos abonos simultáneamente
  Entonces solo uno se valida (200) activando el período y el otro se rechaza (409) sin duplicar ingreso ni período
```

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-2, REQ-3 | Abono parcial validado (`amountCents < targetPriceCents`) crea `cash_movement` inmediato pero NO crea `membership_period` ni concede check-in/reservas hasta alcanzar el `100%` del precio del ciclo. | `apps/api/src/partial-payments.integration.test.ts` |
| CA-2 | REQ-2, REQ-8 | Al validar el abono que completa `100%` de `targetPriceCents`, se emite exactamente un `membership_period` con sus créditos y se vinculan todos los abonos del ciclo; intentos de validar por encima del saldo pendiente devuelven `409` bajo concurrencia. | `apps/api/src/partial-payments.integration.test.ts` |
| CA-3 | REQ-3, CAL-3 | Cierre de turno y reporte diario exponen `reconciliationState: 'abierta' | 'cuadrada' | 'con_diferencia'` consistente con `discrepancyCents` y las compensaciones de `014`. | `apps/api/src/partial-payments.integration.test.ts` + `packages/contracts/src/contracts.test.ts` |
| CA-4 | REQ-1, REQ-2, REQ-3 | Separación de funciones (`admin` no valida cobro propio), aislamiento cross-tenant (`404`) y prohibición a `recepcion`/`instructor`/`socio` de validar (`403`). | `apps/api/src/partial-payments.integration.test.ts` |
| CA-5 | REQ-2, REQ-3 | UI en `QuickPay.tsx`, `Payments.tsx`, `MemberDetail.tsx` y `Cash.tsx` muestra progreso de abono (`pagado / pendiente`) y etiqueta de conciliación (`Cuadrada` / `Con diferencia`). | `apps/web/src/partial-payments.test.tsx` + `tests/e2e/operation.spec.ts` |
| CA-6 | CAL-1, CAL-2 | Fase roja previa; cobertura financiera `>= 80%`; `./scripts/verify.sh` verde sin omitidos; documentación y checkpoint actualizados. | `./scripts/verify.sh` + `pnpm test:coverage` + `pnpm test:e2e` |

## 4. Archivos autorizados

- STATE.md
- apps/api/src/app.ts
- apps/api/src/memberships-lifecycle.integration.test.ts
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

## 5. Verificación, DoD y reversión

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Secuencia TDD en sesión de codificación:** pruebas rojas en `partial-payments.integration.test.ts` y `partial-payments.test.tsx` → migración `0016_partial_payments_reconciliation.sql` y servicios → `./scripts/verify.sh`, `pnpm test:coverage` y `pnpm test:e2e`.
- **Reversión:** migración aditiva (`payments.period_id`, `memberships.cycle_target_cents`); conserva todos los movimientos de caja e historial de pagos.
- **Revisión Tier 1:** revisión humana del usuario al cierre.

## 6. Evidencia y checkpoint

- **Estado final:** Implementada, verificada y cerrada (2026-10-19). Revisión humana Tier 1 requerida antes del despliegue.
- CA-1: `pnpm --filter @gym/api exec vitest run src/partial-payments.integration.test.ts -t "CA-1"` ejecutado con éxito (1 passed). Abonos parciales generan movimiento en caja abierta inmediatamente pero no emiten `membership_period` ni conceden check-in ni créditos.
- CA-2: `pnpm --filter @gym/api exec vitest run src/partial-payments.integration.test.ts -t "CA-2"` ejecutado con éxito (1 passed). El abono que cubre el 100% de `targetPriceCents` emite exactamente un período inmutable, vincula todos los pagos del ciclo vía `payments.periodId`, y los sobrepagos concurrentes se rechazan con `409 AMOUNT_EXCEEDS_CYCLE_BALANCE`.
- CA-3: `pnpm --filter @gym/api exec vitest run src/partial-payments.integration.test.ts -t "CA-3"` ejecutado con éxito (1 passed) y `pnpm --filter @gym/contracts test` (17 passed). Cierre de turno y reportes exponen `reconciliationState` (`abierta`, `cuadrada`, `con_diferencia`) y métricas de abonos acumulados.
- CA-4: `pnpm --filter @gym/api exec vitest run src/partial-payments.integration.test.ts -t "CA-4"` ejecutado con éxito (1 passed). Separación de funciones estricta (admin no valida pagos propios, rechazo 400), recepción/instructor/socio reciben 403, y aislamiento cross-tenant 404.
- CA-5: `pnpm --filter @gym/web test src/partial-payments.test.tsx` ejecutado con éxito (4 passed). Componentes `QuickPay.tsx`, `MemberDetail.tsx`, `Cash.tsx` y `Reports.tsx` muestran saldo pendiente, progreso de abonos y etiquetas de conciliación.
- CA-6: `./scripts/verify.sh` salida 0 (lint, typecheck, build y tests de 4 workspaces) y `node scripts/coverage.mjs` con 73 tests pasando y 96.96% statements / 96.96% lines en módulos financieros (umbral >= 80% superado).

