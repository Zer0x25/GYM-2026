# Spec 012 — Registro manual Transbank y trazabilidad de aceptación

Estado: Implementada y verificada — revisión humana Tier 1 pendiente.
Nivel: Tier 1 — amplía el método de cobro manual y las proyecciones financieras; conserva autoridad y transacciones existentes.
Autoridad: usuario «continua» el 2026-10-14 tras la lista de brechas; implementación y commits locales conforme a PROMPT-MAESTRO. No concede push, despliegue, datos reales ni aceptación humana de cierre.
Requisitos: PRD REQ-2, REQ-3, REQ-9 y CAL-3; corrección documental justificada para la matriz de aceptación final.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Decisiones: ADR 0002 y 0007. No cambia arquitectura ni incorpora pasarela/SDK/proveedor. La spec 003 conserva su historial; reembolsos y política de ajustes siguen pendientes de definición, no se infieren del método.

## 1. Resultado y límites

Registrar un cobro realizado en un terminal externo como `transbank`, con número de operación y comentario, manteniendo los métodos `cash`/`transfer`. Mostrarlo como Transbank externo en ficha, pagos, caja, reporte diario y CSV. La app solo registra evidencia declarada: no cobra tarjeta, confirma liquidación bancaria ni conecta con Transbank.

Completar matriz PRD/requisitos agrupados → evidencia real → brechas. Actualizar únicamente pendientes desfasados de duración/cifrado offline y publicación, sin modificar aceptación, ADR históricos ni specs cerradas. Otras capacidades detectadas se registran; no se declaran entregadas por esta unidad.

## 2. Contratos, invariantes y datos

- Método aditivo `transbank` en contratos y tipos de pagos/movimientos/eventos. Número de operación (`reference`, trim, máximo 200) y comentario (`comment`, trim, máximo 1000) obligatorios para Transbank online. Transferencia conserva su referencia obligatoria y efectivo su contrato actual. Código 400 por forma de entrada; servicio rechaza falta de evidencia antes de insertar.
- `payments.comment` nullable por migración aditiva; históricos conservados. No se cambia enum SQL: columnas de método existentes son text. Reversión: mantener columna al volver al código previo y no operar nuevos cobros Transbank hasta restaurar código compatible; nunca borrar registros para revertir. Probar migración en BD ficticia y regresión de métodos existentes.
- Pago registrado o sincronizado sigue provisional, sin movimientos ni derechos. Solo otro admin valida online; movimiento/auditoría/ventana de membresía atómicos; repetición rechazada y un solo movimiento. Todos los IDs resueltos bajo tenant, 404 para ajenos; recepción/socio no adquieren permisos nuevos.
- En offline, folio externo independiente obligatorio; operación/comentario van dentro del payload conservado/cifrado, distintos del folio. Método Transbank sin evidencia se conserva como evento rechazado sin crear pago. Reenvío del mismo event_id no duplica; no se ejecuta ninguna operación bancaria offline.
- Totales y consolidación incluyen los tres métodos una vez, con desglose separado. Se conserva la fórmula de cierre actual (apertura más movimientos por todos los métodos); esta unidad no redefine caja física ni política financiera.
- No almacenar PAN, CVV, datos de tarjeta o credenciales del terminal; formularios solo operación/comentario. Auditoría con datos mínimos existentes.

## 3. Criterios y BDD

- CA-1: Dado Transbank externo, cuando recepción registra operación/comentario válidos, entonces persisten método, referencia y comentario; provisional sin derechos ni caja. Sin evidencia o método desconocido → rechazo sin insertar.
- CA-2: Dado un cobro provisional, cuando otro admin valida, entonces crea un único movimiento Transbank y derechos según contrato; recepción/autovalidación/tenant ajeno rechazados. Los métodos anteriores conservan comportamiento.
- CA-3: Dados cobros validados por tres métodos, cuando se consulta caja/reporte/cierre, entonces total y desglose coinciden con filas persistidas sin clasificar tarjeta como transferencia.
- CA-4: Dada outbox autorizada, cuando sincroniza/reenvía Transbank con evidencia, entonces un pago provisional conserva operación/comentario y folio independiente; sin evidencia, evento rechazado preservado. UI permite capturar operación/comentario y muestra rechazo/error real.
- CA-5: Dada la interfaz, cuando se registra cobro Transbank y se consultan pagos/caja/reporte, entonces rótulo y CSV distinguen el método. Tests UI e integración; E2E del flujo productivo más regresión existente.
- CA-6: Matriz distingue evidencia ejecutada de cobertura parcial/pendientes, enlaza requisitos y fuentes; duración/cifrado offline reflejan ADR 0007 sin presentar staging/G2 ni revisión humana como completados. Gate raíz, cobertura financiera y E2E pasan con datos ficticios.

## 4. Archivos autorizados

- specs/012-transbank-manual.md
- STATE.md
- docs/learning.md
- docs/product/aceptacion-mvp.md
- docs/api/README.md
- docs/operations/runbook.md
- PRD.md
- PROMPT-MAESTRO.md
- packages/contracts/src/index.ts
- packages/contracts/src/contracts.test.ts
- packages/db/src/schema.ts
- packages/db/drizzle/0010_payment_comment.sql
- packages/db/drizzle/meta/_journal.json
- apps/api/src/services/payments.ts
- apps/api/src/services/cash.ts
- apps/api/src/services/operations.ts
- apps/api/src/services/offline.ts
- apps/api/src/transbank.integration.test.ts
- apps/api/src/members.integration.test.ts
- apps/web/src/api.ts
- apps/web/src/lib/payment-method.ts
- apps/web/src/components/QuickPay.tsx
- apps/web/src/pages/Payments.tsx
- apps/web/src/pages/MemberDetail.tsx
- apps/web/src/pages/Cash.tsx
- apps/web/src/pages/Reports.tsx
- apps/web/src/pages/Offline.tsx
- apps/web/src/transbank.test.tsx
- tests/e2e/transbank.spec.ts
- scripts/coverage.mjs

## 5. Verificación y revisión

Aplica AGENTS §9. Primero contratos/tests y rojo por método ausente; luego implementación mínima. Integración con Postgres real y fixtures aislados por suite, truncado/recreación repetibles, IDs retornados por inserts. Migrar BD ficticia; nunca resetear datos reales. Ejecutar gate con TEST_DATABASE_URL y workers=1, `pnpm test:integration`, `pnpm test:coverage` y `pnpm test:e2e` serialmente para no competir por dist/fixtures. Sin dependencias nuevas.

Revisión adicional: humana por el usuario al cierre conforme a PROMPT-MAESTRO; tests adversarios de permisos, tenant, evidencia faltante, replay y totales como evidencia técnica. Revisión propia no independiente. Sin aceptación humana la unidad queda implementada/verificada con cierre Tier 1 pendiente.

## 6. Evidencia y continuidad

Inicial: código solo admite cash/transfer; reporte suma ambos; no hay flujo Transbank ni comment persistido. Git main limpio en eac204f. Siguiente paso: pruebas rojas y migración aditiva. Falta de progreso: 0. Preguntas asíncronas pendientes para canal de correo y política de devoluciones/ajustes; trabajo independiente continúa. No se reinicia 010 ni se declara aceptación final.

Ampliación previa a editar: `pnpm test:integration` reprodujo `duplicate key user_pkey` en members.integration.test.ts al reutilizar gym_test_members. Su fixture trunca socios/organizaciones pero conserva usuarios de ejecución previa; no es un fallo de producto ni de Transbank. Se autoriza incluir la tabla de identidad en el truncado del fixture ficticio, conservando todas las aserciones de aislamiento. Verificar la misma suite dos veces y después el runner completo; no borrar la BD para ocultar la falta de limpieza.

Ampliación previa a editar coverage.mjs: incluir la nueva suite financiera Transbank en el reporte CAL-2 (el runner previo mide solo tres archivos). Conservar umbrales/configuración. QA visual detectó que la ficha crece horizontalmente por el mínimo implícito del grid con la tabla ampliada; corregir dentro de MemberDetail.tsx ya autorizado y verificar viewport móvil con DOM y captura.

### Evidencia ejecutada

- CA-1: `pnpm --filter @gym/contracts test` antes de implementación → 1 fallo esperado por transbank ausente; tras implementar → 8/8. `vitest run src/transbank.integration.test.ts` → rojo 4 fallos/1 paso por método/evidencia ausentes; verde 5/5 contra Postgres real (/tmp/gym-012-api-red.log y /tmp/gym-012-api-green.log), persistencia provisional y rechazo sin filas comprobados.
- CA-2: suite Transbank 5/5 → recepción 403, autovalidación 403, tenant ajeno 404, validación por otro admin 200 y repetición 409; exactamente un movimiento, vigencia actualizada. `pnpm test:integration` → 11 suites completas sin omisiones (/tmp/gym-012-integration-final.log), preserva regresiones de efectivo/transferencia.
- CA-3: suite Transbank → tres ingresos validados de 30000, total 90000, desglose 30000 por método, cierre esperado 91000 con apertura 1000 y diferencia 0; filas y respuestas coinciden.
- CA-4: suite Transbank → replay devuelve mismo paymentId, una fila provisional con OP-777/comentario, folio FOLIO-77 independiente, cero movimientos; evento sin evidencia conservado rechazado. Suites offline/operaciones y E2E previo de dos dispositivos siguen verdes.
- CA-5: `vitest run src/transbank.test.tsx` rojo 2/2 por controles/etiqueta ausentes, luego 2/2 verdes. `pnpm test:e2e` → 8/8 con backend/preview/Postgres reales, incluye captura Transbank, validación separada, movimiento único y CSV con columna/importe correctos (/tmp/gym-012-e2e-final.log). Inspección visual /tmp/gym-012-transbank-mobile.png (390 px) y aserción DOM confirman ficha sin desbordamiento horizontal tras corregir el grid.
- CA-6: migración 0010 aplicada en BDs ficticias; `pnpm test:coverage` → 44/44, 95.98% statements/lines, 97.67% functions y 75% branches (informativo), umbral 80% conservado (/tmp/gym-012-coverage-final.log). `./scripts/verify.sh` con TEST_DATABASE_URL=gym_test_gate y workers min/max 1 → salida 0, 157/157 sin omitidos (116 API, 28 web, 8 contracts, 5 db), lint/build/typecheck verdes (/tmp/gym-012-gate.log). Scope de 30 rutas validado; diff revisado sin cambios ajenos. Matriz/docs actualizadas; staging, correo, política financiera y aceptación humana no se declaran completos.
- Corrección del fixture: members 8/8 en dos corridas seguidas sobre la misma BD (/tmp/gym-012-members-first.log y /tmp/gym-012-members-repeat.log), luego runner completo verde. `git diff --check` y `node --check scripts/coverage.mjs` → salida 0.

Checkpoint: commit local de unidad 012 autorizado por PROMPT-MAESTRO, sin push; se referencia por ID sin un segundo commit para registrar su propio hash. Siguiente unidad independiente: CI con integración/E2E, preservando la revisión humana pendiente de 010/012 y las preguntas de canal de correo/política de ajustes. Contador de falta de progreso: 0.
