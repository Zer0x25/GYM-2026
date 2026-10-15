# 016 — Períodos y créditos por modalidad

Estado: Implementada y verificada — revisión humana pendiente
Nivel: Tier 1 — derechos, concurrencia, dinero y migración aditiva.
Autoridad: continuación del usuario; respuesta explícita 2026-10-15 «Sí, configurar cantidades por modalidad y período, sin acumulación». PRD REQ-2/4/5/7/8, SPEC REVAL-01/TX-01/TX-04, ADR 0002/0009; commits locales por PROMPT-MAESTRO. Sin push/despliegue/correo real/G2. Revisión adicional humana por usuario al cierre, propia no independiente.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3

## 1. Resultado y fuentes

Cerrar saldo limitado real, períodos confirmados y validación de cobertura a la fecha de clase. El PRD aprobado referencia el MVP confirmado de Notion: cupo y crédito limitado atómicos, restitución una vez y AC-215 pendiente administrativo. La simplificación histórica de spec 004 (beneficio booleano sin paquetes) se conserva como historia y se reemplaza para este alcance mediante decisión explícita del usuario; no editar ADR/spec cerrados. Cantidades son configuración expresa por gimnasio, sin números de negocio inventados.

## 2. Contratos e invariantes

- Plan limitado requiere classCredits {grupal,fija,cita}, cada entero 0..100000; 0 deniega esa modalidad. Sin configuración completa 400, nunca tratar limitado como ilimitado. none/unlimited conservan semántica existente y no aceptan cuotas limitadas. Leer expone configuración nullable para registros históricos, sin promoverlos.
- Cada pago validado crea en la misma transacción un membership_period inmutable por API: org/miembro/membresía/pago único, fechas consecutivas, cobertura y cuotas/condiciones capturadas del plan. Provisional/rechazado/sin caja no crea período ni créditos. Bloquear membresía al validar para serializar renovaciones concurrentes; mantener inicio agregado vigente al renovar anticipadamente, sin perder cobertura actual. Se conserva política de validación/roles/compensación 003/014; abonos/conciliación siguen en unidad futura, no redefinirlos aquí.
- Migración aditiva 0013 con snapshot legado de ventanas existentes; no reconstruir N créditos a partir de un booleano ni inventar cuotas históricas. Períodos limitados legados sin cuotas deniegan nuevas reservas hasta un período configurado y validado. Reservas históricas no se borran ni se fabrican consumos. Fixtures/seed ilimitados con ventana autoritativa pueden usar compatibilidad acotada sin saldo limitado; documentar ese límite.
- Reservar: socio solo sí mismo, staff solo org propia; sesión programada/futura/reservable, membresía cubre inicio de clase [start,end), plan/período permite reservas. Dentro de la misma transacción: lock sesión/cupo, lock membresías en orden estable y período elegido, comprobar saldo de modalidad y crear reserva más asiento -1 y auditoría. Sin cupo/saldo/cobertura: 409 y cero reserva/asiento. Reintento de misma sesión no consume dos veces (unique vigente). Períodos futuros confirmados pueden reservar su propia fecha; nunca tomar saldo de otro período/modalidad/tenant.
- credit_movements append-only: org/miembro/período/reserva/modalidad/actor, tipo commit(-1),return(+1),review(0). Unique (booking,kind) y checks; no descontar de nuevo por asistencia/ausencia. Saldo=cuota+sum movimientos; mutex del período/membresía impide sobreconsumo en sesiones distintas.
- Cancelar temprana/gimnasio devuelve al período original una vez si no ha vencido; tardía/ausencia no devuelve. Si venció, registrar review 0 y creditReviewRequired, sin saldo trasladado/prórroga (AC-215), visible en ficha/portal para revisión. No resolver compensación comercial todavía. Doble cancelación deja una fila/auditoría/asiento; mismos locks coherentes con asistencia.
- Revalidación al asistir: no necesita saldo libre adicional para una reserva ya comprometida. Pérdida de cobertura persiste cancelación/auditoría sin asistencia exitosa; responde 409 después de commit del rechazo. Endpoint staff online POST /members/:id/bookings/revalidate revalida futuras afectadas, libera plazas y nunca restaura al recuperar derechos. Nuevos comandos de pérdida confirmada deberán integrarlo en su unidad; no se promete tarea cron ni pausas inexistentes.
- GET /members/:id/credit-periods (admin/recepción o socio propio) y GET /me/credit-periods: períodos propios con fechas, cuotas/comprometidos/disponibles por modalidad y casos pendientes; 401/403/404 según alcance. Mismo resumen en overview. UI planes solicita cuotas expresas, portal/ficha muestran períodos y reclamaciones; nunca ofrecer saldo global acumulado.
- Rollback conserva tablas/asientos/relaciones; detener reservas limitadas y finanzas con versión que ignore períodos/ledger. Sin borrar saldos para revertir, sin dependencias ni datos reales.

## 3. Criterios verificables

- CA-1: contratos de cuotas/planes, período solo tras validar, rollback sin caja, snapshot de cuotas/condiciones y renovaciones consecutivas bajo concurrencia sin perder inicio vigente.
- CA-2: sin cobertura a fecha/inicio futuro incorrecto/none/pasada/tenant ajeno no reserva; futuro confirmado sí. Limitado sin configuración/cero de modalidad denegado.
- CA-3: última plaza y último crédito entre sesiones distintas: una gana, ninguna reserva rechazada descuenta; replay/duplicado no duplica; modalidades/períodos aislados.
- CA-4: cancelaciones/asistencia/ausencia idempotentes y saldo persistido; temprana/gimnasio devuelve una vez, tardía/ausencia no; vencido crea revisión visible sin transferencia ni prórroga.
- CA-5: revalidación de futuras/al asistir libera y audita si pierde cobertura; recuperar no restaura; permisos/tenant/propiedad probados. Resumen no expone ajenos.
- CA-6: UI con cuotas explícitas/períodos/saldo real, móvil sin overflow y E2E de ciclo real; regresiones, cobertura >=80% y gate raíz sin omitidos; evidencia/aprendizaje/checkpoint/commit local. Revisión humana pendiente.

## 4. Archivos autorizados

- .github/workflows/verify.yml
- PRD.md
- PROMPT-MAESTRO.md
- STATE.md
- apps/api/src/account-recovery.integration.test.ts
- apps/api/src/app.ts
- apps/api/src/auth-flow.integration.test.ts
- apps/api/src/auth.ts
- apps/api/src/credits.integration.test.ts
- apps/api/src/email-delivery.ts
- apps/api/src/errors.ts
- apps/api/src/financial-adjustments.integration.test.ts
- apps/api/src/members.integration.test.ts
- apps/api/src/operations.integration.test.ts
- apps/api/src/safe-request.test.ts
- apps/api/src/safe-request.ts
- apps/api/src/seed-dev.ts
- apps/api/src/services/booking-credits.ts
- apps/api/src/services/bookings.ts
- apps/api/src/services/cash.ts
- apps/api/src/services/contact-verification.ts
- apps/api/src/services/financial-adjustments.ts
- apps/api/src/services/members.ts
- apps/api/src/services/offline.ts
- apps/api/src/services/operations.ts
- apps/api/src/services/payments.ts
- apps/api/src/services/sessions.ts
- apps/api/src/services/plans.ts
- apps/api/src/transbank.integration.test.ts
- apps/api/vitest.config.ts
- apps/web/src/App.tsx
- apps/web/src/account-recovery.test.tsx
- apps/web/src/api.ts
- apps/web/src/components/CreditPeriods.tsx
- apps/web/src/components/PaymentAdjustmentDialog.tsx
- apps/web/src/components/QuickPay.tsx
- apps/web/src/credits.test.tsx
- apps/web/src/financial-adjustments.test.tsx
- apps/web/src/lib/payment-method.ts
- apps/web/src/pages/AccountRecovery.tsx
- apps/web/src/pages/Cash.tsx
- apps/web/src/pages/Login.tsx
- apps/web/src/pages/MemberDetail.tsx
- apps/web/src/pages/Offline.tsx
- apps/web/src/pages/Payments.tsx
- apps/web/src/pages/SessionDetail.tsx
- apps/web/src/pages/Plans.tsx
- apps/web/src/pages/Portal.tsx
- apps/web/src/pages/Reports.tsx
- apps/web/src/pages/VerifyContact.tsx
- apps/web/src/transbank.test.tsx
- docs/adr/0008-ajustes-devoluciones.md
- docs/adr/0009-creditos-por-modalidad-periodo.md
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0010_payment_comment.sql
- packages/db/drizzle/0011_financial_adjustments.sql
- packages/db/drizzle/0012_contact_verification.sql
- packages/db/drizzle/0013_membership_credits.sql
- packages/db/drizzle/meta/_journal.json
- packages/db/src/index.ts
- packages/db/src/schema.ts
- scripts/coverage.mjs
- specs/012-transbank-manual.md
- specs/013-ci-integracion-e2e.md
- specs/014-ajustes-devoluciones.md
- specs/015-recuperacion-contacto.md
- specs/016-periodos-creditos.md
- tests/e2e/account.spec.ts
- tests/e2e/adjustments.spec.ts
- tests/e2e/credits.spec.ts
- tests/e2e/operation.spec.ts
- tests/e2e/transbank.spec.ts

## 5. Verificación y checkpoint

Rutas heredadas de 012–015 solo para scope-lock vs origin/main=eac204f; delta propio vs fe715cd y sin cambios ajenos. Pruebas primero rojas, luego mínimo verde con PostgreSQL ficticio/migración repetible; integración, cobertura/E2E y ./scripts/verify.sh obligatorios. Revisión humana de derechos/dinero por usuario al cierre. Contador inicial 0, ninguna revisión propia independiente.


Ampliación antes de editar: SessionsService.cancel debe restituir/cancelar reservas dentro de su propia transacción al cancelar el gimnasio, para no dejar créditos comprometidos en una clase cancelada; incluir sessions.ts. SessionDetail debe recargar tras rechazo de asistencia que haya persistido cancelación, para mostrar estado auténtico; incluir esa página. Antes de tomar locks de saldo, rechazar reserva existente bajo lock de sesión, evitando inversión de locks con una cancelación concurrente. No ampliar roles de cancelación del gimnasio.


Experimento temporal de migración: objetivo comprobar upgrade real de 0012 a 0013 con membresías/reservas ficticias ilimitadas y limitadas previas; límite BDs gym_016_migration y gym_016_migration_unlimited para variantes separadas, nunca gym_dev/datos reales. Copiar migraciones previas a directorio temporal, aplicar, insertar fixture con IDs de returning, aplicar 0013 real y verificar ventanas/reservas conservadas, cuotas legadas null y ledger vacío. Limpiar copia temporal y cerrar conexión en finally; conservar solo BD ficticia como evidencia, sin instalar dependencias ni cambiar servicios.


Diagnóstico del ensayo: primera comparación falló por llamar toISOString sobre el string que entrega postgres-js en ese cliente. No fue fallo de migración; hipótesis reducida con TypeError. Comparación temporal/cobertura realizada después en SQL, fixtures limitados e ilimitados previos a 0013, ambas BDs dieron preservación exacta y cero ledger inventado; reejecutar migración no duplica snapshots (/tmp/gym-016-migration-upgrade-final.log). Directorios temporales limpiados; contador 0.


## 6. Evidencia por criterio y cierre técnico

- CA-1: `TEST_DATABASE_URL=… pnpm --filter @gym/api exec vitest run src/credits.integration.test.ts` → 13/13 (incluidas en gate final); cuotas completas exigidas, provisional/caja ausente sin período, snapshot que no cambia al editar catálogo, tres renovaciones consecutivas y mutex de membresía. Contratos 11/11. Ensayo real 0012→0013 en dos BDs ficticias limitadas/ilimitadas: fechas/cobertura/reserva preservadas, cuotas null, cero ledger y repetición sin duplicados (/tmp/gym-016-migration-upgrade-final.log).
- CA-2: misma suite → 13/13; cobertura a fecha, inicio incorrecto, none, cuota cero/configuración legada ausente y sesión pasada rechazados; período futuro confirmado sí reserva su fecha. Ningún rechazo fabrica compromiso.
- CA-3: misma suite → 13/13; último crédito entre sesiones distintas, última plaza con dos limitados, duplicado y cancelación simultánea; ledger y saldos persistidos. Nueva carrera de dos clases con varios socios canceladas simultáneamente → cuatro consumos/cuatro devoluciones, saldo restituido, cero reservas confirmadas y sin deadlock.
- CA-4: misma suite → 13/13; temprana concurrente restituye una vez, tardía/ausencia retienen, asistencia repetida no descuenta otra vez, AC-215 review 0 visible y sin devolución/traslado, clase cancelada por gimnasio devuelve una vez. Socio no puede forzar tipo gimnasio.
- CA-5: misma suite y regresión → anónimo 401, tenant/miembro ajenos 404, revalidación socio 403; pérdida al asistir persiste cancelación y devuelve 409, barrido staff cancela futuras; recuperar no restaura. Respuesta real de períodos validada contra CreditPeriodSummary; lecturas en snapshot consistente.
- CA-6: rojo inicial API 9 fallos (/tmp/gym-016-red.log): rutas/períodos/ledger/cuotas/cobertura ausentes; uno detectó nombre incorrecto del helper de caja del fixture, corregido sin cambiar expectativa. UI inicial detectó label de fixture incorrecto; se corrigió al label real y no se presenta como evidencia roja del producto. `pnpm --filter @gym/web exec vitest run src/credits.test.tsx` → 2/2, cantidades sin defaults de negocio y revisión vencida/saldos separados (/tmp/gym-016-ui-green.log). `pnpm test:e2e` → 11/11 sobre preview/BD ficticia, incluye crear plan con cuotas, validar pago, agotar/devolver/reusar crédito desde portal, reservas y controles offline/financieros anteriores (/tmp/gym-016-e2e.log). Captura móvil /tmp/gym-016-credits-mobile.png inspeccionada sin overflow.
- CA-6: `TEST_DATABASE_URL=… VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 VITEST_MAX_THREADS=1 VITEST_MIN_THREADS=1 ./scripts/verify.sh` → salida 0, 197/197 (145 API, 36 web, 11 contratos, 5 db), sin omitidos; lint/build/typecheck verdes (/tmp/gym-016-gate-final.log). Segundo gate tras añadir carrera multi-clase/multi-socio; implementación de E2E sin cambios después de su 11/11.
- CA-6: `pnpm test:coverage` → salida 0, 64/64, 97.23% statements/lines, 96.55% funciones, 75.65% ramas informativas; booking-credits 100% statements/lines/functions (/tmp/gym-016-coverage.log). Umbral >=80% conservado; ningún control reducido.

Checkpoint: revisión propia del diff y alcance, aprendizaje/matriz/runbook actualizados. Revisión humana del usuario requerida y pendiente, no independiente. Commit local de unidad 016 por ID, sin push/despliegue/correo/G2. Próxima brecha de membresías: pausas autorizadas/cambio siguiente período y edición/versionado del catálogo, con reglas aún por concretar; abonos/conciliación y exportaciones también pendientes en matriz. Meta abierta, contador 0.


Verificación final adicional: `pnpm test:integration` → salida 0, 14 suites reales en BDs ficticias aisladas, ninguna omitida (/tmp/gym-016-integration.log). `git diff --check`, `bash scripts/verify-scope.sh` (77 rutas del lote) y `bash scripts/verify-structure.sh` → 0. Delta propio vs fe715cd: 32 rutas autorizadas, sin cambios ajenos. Directorios temporales de ensayo limpiados.
