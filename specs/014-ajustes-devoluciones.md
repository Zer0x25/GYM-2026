# Spec 014 — Ajustes y devoluciones compensatorias

Estado: Implementada y verificada — revisión humana pendiente
Nivel: Tier 1 — dinero, permisos, concurrencia y migración aditiva.
Autoridad: usuario 2026-10-15 «2:aprobado» sobre política presentada; delegación de implementación/commits locales de PROMPT-MAESTRO. Revisión humana al cierre, sin push ni despliegue.
Requisitos: PRD REQ-3, REQ-1/8/11, CAL-2/3; ADR 0002 y 0008. Spec 003 histórica se conserva; ahora se resuelve su política pendiente mediante nueva decisión explícita.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3

## 1. Resultado

Administración registra online una devolución o ajuste de salida contra un pago validado, con motivo y confirmación explícitos; persiste compensación inmutable sin editar pago/movimiento original ni membresía. Idempotencia conserva resultado de reintento; compensaciones acumuladas no superan importe cobrado. Correcciones que aumenten un cobro siguen el flujo existente de nuevo pago provisional y validación separada; no se inventa generación directa de ingresos.

## 2. Contratos e invariantes

- POST /api/v1/payments/:id/adjustments, solo admin autenticado: {idempotencyKey: UUID, kind: refund|adjustment, amountCents: entero positivo CLP <=2147483647, reason: trim 1..1000}. Representa salida manual compensatoria, no transferencia bancaria automática. Método hereda el pago original. Responde 200 {data: FinancialAdjustment}, igual en replay. Otra persona puede revisar auditoría; no se añade una segunda aprobación que el usuario no pidió.
- GET de la misma ruta, admin/recepción: {items, compensatedCents, remainingCents}. Socio/instructor 403, IDs ajenos 404. Forma inválida 400; estado no validado/sin caja/importe excedido/reutilización de clave para otra intención 409.
- Tabla financial_adjustments append-only por API: pago, organización, turno actual abierto, actor, método, importe positivo, tipo, motivo, clave única (org,key), timestamp. Foreign keys a registros existentes y CHECK de importe/tipo. No se borra/actualiza un pago validado ni sus movimientos originales.
- Bloquear fila payment dentro de transacción, sumar compensaciones bajo el bloqueo; serializar también claves de idempotencia por org/key para evitar carreras entre pagos distintos. Replay solo si pago/tipo/importe/motivo coinciden (misma organización), sin movimiento/auditoría nuevos. Actor inicial conserva atribución; admin autenticado del mismo tenant puede recuperar el resultado de esa intención.
- Bloquear turno de caja abierto antes de insertar. Cierre de turno usa mismo lock y resta compensaciones; una salida posterior a un cierre nunca altera el turno histórico. Compensación y audit_log en la misma transacción. No hay endpoint offline para compensar.
- Caja: respuesta de detalle añade adjustments, mantiene movements originales; cliente muestra salidas con signo negativo y motivo. Cierre esperado=apertura+ingresos-salidas del turno. Consolidación y reporte conservan campos de ingresos brutos y añaden salidas/neto explícitos; fecha diaria Santiago, sin reescribir fechas históricas. CSV conserva columnas existentes y añade salidas/neto.
- Migración 0011 aditiva; verificar en BD ficticia. Reversión conserva tabla/filas y no permite operar finanzas con versión antigua que desconozca las salidas; no borrar evidencia para revertir. Sin datos reales ni dependencias nuevas.

## 3. Criterios verificables

- CA-1: Dado pago validado, cuando admin compensa, entonces pago, movimiento original y membresía permanecen idénticos; fila de salida y auditoría persisten con motivo/actor/turno. Provisional/rechazado/sin turno son rechazados sin efecto.
- CA-2: Roles no autorizados 403 y tenant ajeno 404; entrada inválida o motivo vacío rechazados; suma nunca excede cobro.
- CA-3: Dos intenciones concurrentes que excederían el saldo dejan solo una salida; dos reenvíos concurrentes de misma clave devuelven mismo ID/una fila/una auditoría. Cambio de cuerpo bajo misma clave 409. Cierre concurrente y compensación nunca generan salida sobre turno cerrado ni alteran cierre histórico.
- CA-4: Caja/reporte/CSV muestran ingresos, salidas y neto correctos; turno con 30000 de ingreso y 5000 de compensación cierra con 25000 más apertura. No se resta dos veces un replay.
- CA-5: UI solo admin sobre pagos validados, motivo/importe obligatorios, confirmación previa sin mutación; reintento conserva clave y cuerpo; historia y errores reales visibles. UI/E2E con base real, viewport móvil sin overflow.
- CA-6: Pruebas rojas antes de implementar; suites completas pertinentes, cobertura >=80% conservada y gate raíz con integración real sin omitidos; diff/scope, docs/aprendizaje y checkpoint; aceptación humana pendiente explícita.

## 4. Archivos autorizados

- packages/db/src/index.ts
- .github/workflows/verify.yml
- PRD.md
- PROMPT-MAESTRO.md
- STATE.md
- apps/api/src/app.ts
- apps/api/src/financial-adjustments.integration.test.ts
- apps/api/src/members.integration.test.ts
- apps/api/src/services/cash.ts
- apps/api/src/services/financial-adjustments.ts
- apps/api/src/services/offline.ts
- apps/api/src/services/operations.ts
- apps/api/src/services/payments.ts
- apps/api/src/transbank.integration.test.ts
- apps/api/vitest.config.ts
- apps/web/src/api.ts
- apps/web/src/components/PaymentAdjustmentDialog.tsx
- apps/web/src/components/QuickPay.tsx
- apps/web/src/financial-adjustments.test.tsx
- apps/web/src/lib/payment-method.ts
- apps/web/src/pages/Cash.tsx
- apps/web/src/pages/MemberDetail.tsx
- apps/web/src/pages/Offline.tsx
- apps/web/src/pages/Payments.tsx
- apps/web/src/pages/Reports.tsx
- apps/web/src/transbank.test.tsx
- docs/adr/0008-ajustes-devoluciones.md
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0010_payment_comment.sql
- packages/db/drizzle/0011_financial_adjustments.sql
- packages/db/drizzle/meta/_journal.json
- packages/db/src/schema.ts
- scripts/coverage.mjs
- specs/012-transbank-manual.md
- specs/013-ci-integracion-e2e.md
- specs/014-ajustes-devoluciones.md
- tests/e2e/adjustments.spec.ts
- tests/e2e/transbank.spec.ts

## 5. Alcance del lote y verificación

Se incluyen rutas heredadas de 012/013 solo para comparación contra origin/main=eac204f, sin alterar ref ni omitir scope-lock. Cambios nuevos únicamente en las rutas descritas por esta unidad; comparar además contra f34cf4d. ADR aceptados históricos no se editan.

Aplica AGENTS §9. PostgreSQL real en BD ficticia por suite; preparación trunca org/identidad, IDs de returning, restauración repetible. Ejecutar primero tests/rojo, luego mínimos y verde; suites de integración, cobertura y E2E seriales, gate con TEST_DATABASE_URL y workers=1. Revisión adicional humana al cierre y pruebas adversarias de concurrencia/permisos/idempotencia; revisión propia no independiente.

## 6. Evidencia y checkpoint

Inicial: no existen ruta/ledger compensatorio; unidad 013 en f34cf4d, main limpio con dos commits locales. Política aprobada registrada en ADR 0008 antes de implementar. Pregunta 1:C resuelve preparación de identidad sin correo real; se abordará como unidad 015 independiente. Contador 0. Commit local autorizado solo tras verificación, sin publicación.


- CA-1: `pnpm --filter @gym/api exec vitest run src/financial-adjustments.integration.test.ts` → 7/7 contra PostgreSQL real; originales/membresía intactos, ledger y auditoría persistidos; estados inválidos sin efecto (/tmp/gym-014-green.log).
- CA-2: mismo comando → 7/7; roles, aislamiento tenant, entrada inválida y límites rechazados, sin efectos.
- CA-3: mismo comando → 7/7; concurrencia de saldo/clave/cierre, replay tras cierre y conflicto de cuerpo comprobados con estado persistido.
- CA-4: `pnpm test:e2e` → 9/9; caja 30000−5000+1000=26000, diferencia 0; reporte/consolidación y CSV de regresión verificados además por integración (/tmp/gym-014-e2e-final.log).
- CA-5: `pnpm --filter @gym/web exec vitest run src/financial-adjustments.test.tsx` → 2/2; confirmación previa, rol y reintento con misma intención; E2E 9/9. Captura móvil /tmp/gym-014-cash-mobile.png inspeccionada sin overflow; espera del fin de transición del sidebar antes de capturar.
- CA-6: rojo API 7/7 por ruta ausente y rojo UI por acción ausente antes de implementar (/tmp/gym-014-red.log); `pnpm test:integration` → 12 suites sin omitidos; `pnpm test:coverage` → 51 pruebas, 96.71% statements/lines, módulo compensaciones 100%; `TEST_DATABASE_URL=… VITEST_*_FORKS=1 VITEST_*_THREADS=1 ./scripts/verify.sh` → salida 0, 167/167 sin omitidos, lint/typecheck/build verdes (/tmp/gym-014-gate.log). `bash scripts/verify-scope.sh` y `git diff --check` → 0.

Checkpoint: implementación y revisión propia verificadas; revisión humana Tier 1 del usuario pendiente, no se presenta como independiente. Commit local de unidad 014 por ID, sin push. Siguiente: 015 recuperación/verificación preparada con transporte deshabilitado, conforme 1:C. Contador 0; sin datos reales ni dependencias nuevas.
