# Estado del Proyecto: App GYM (GYM-2026) — Hito 0 completado; Hito 1 activo

- Fase: `project`; Hito 0 completado y sellado (bootstrap archivado como `.agents/bootstrap.md.done`). Gate de proyecto en verde tras el sellado.
- Modo de arranque: A (enriquecido desde Notion), 2026-10-11. Base de decisiones Notion: https://app.notion.com/p/3f529b8ebe2981fab0c2fa583efcdf15 (database 88e343f849ce4e4eae888d205b7dcc7b, 55 decisiones trasladadas).

## Última unidad — 001 · Andamiaje del monorepo (specs/001-andamiaje-monorepo.md, Tier 1)

- Meta: monorepo pnpm funcional con gate de proyecto verde.
- Entregado: `pnpm-workspace.yaml` + `package.json` raíz (scripts del gate); `tsconfig.base.json`; ESLint 9 flat config (raíz) y Prettier; `packages/contracts` (esquemas Zod: organización, sesión, miembro, plan, errores) con 6 tests; `packages/db` (esquema Drizzle: organizations, identity_accounts, staff_assignments, members, plans; drizzle.config.ts; createDb) con 5 tests; `apps/api` (Fastify: errores centralizados estables, plugin de contexto tenant, /health) con 6 tests; `apps/web` (Vite+React+router, PWA manifest + service worker de shell, esqueleto de rutas por rol) con build de producción OK; `docs/api/README.md` (contratos documentados); `docs/operations/runbook.md` (borrador); `.github/workflows/verify.yml` (Node 22 + pnpm 9 + Postgres 16 de servicio); `.env.example` con nombres ficticios.
- Verificaciones (evidencia real): `pnpm -r lint` OK (4 workspaces); `pnpm -r typecheck` OK; `pnpm -r build` OK (web: 166 kB bundle); `pnpm -r test` 17 tests OK (contracts 6, db 5, api 6, web 0 con passWithNoTests); `./scripts/verify.sh` salida 0 en `initializing`.
- CA verificados: CA-1 (gate corre y propaga fallos — estructura de scripts con set -euo pipefail y verify-project.sh sin `|| true`), CA-2 (CI ejecuta el mismo gate — workflow actualizado con runtime), CA-3 (contrato rechaza payload inválido con error estable — tests de contracts), CA-4 (contexto tenant desde header verificado — test de api), CA-5 (`grep -ri sauna` en código de v1.0: cero coincidencias), CA-6 (esqueleto offline documentado como pendiente; SW de shell sin modo privilegiado), CA-7 (`.env.example` solo nombres ficticios; `.gitignore` cubre `.env*` salvo ejemplo).
- Commit: pendiente de autorización del usuario (cambios locales).
- Revisión Tier 1: pendiente de revisión humana del usuario antes de sellar `phase=project`.
- Aprendizaje: `docs/learning.md` (hallazgos del Modo A y la limitación del gate con marcadores HITO0_PENDING).

## Unidad 002 · Cerrada

- 002 · Auth, tenant y roles + socios y permisos (specs/002-auth-tenant-socios.md, Tier 1) — **CERRADA 2026-10-12 tras verificación humana del usuario** (login funcional en el navegador, sesión con org+rol desde datos almacenados, panel, portal del socio, aislamiento cross-tenant probado). Gate verde; 5/5 tests de integración; commits `1c09224`, `f0dee1a`, `678b0b1`, `6df3928` locales sin push.
- CA verificados: CA-1/CA-2 (sesión con org+rol; cross-tenant 404), CA-3 (listado filtrado por tenant), CA-4 (socio edita solo su contacto), CA-6 (sign-out invalida servidor), CA-8 (sin sauna).
- Bug de producción corregido y registrado en skill `better-auth-fastify-wiring`: Set-Cookie múltiple en el bridge WHATWG (reply.raw.setHeader con getSetCookie()).

## Unidad 003 · Cerrada

- 003 · Planes, membresías, pagos con validación y caja (specs/003-planes-pagos-caja.md, Tier 1) — **CERRADA 2026-10-12 tras OK del usuario** (sellar 003 y arrancar spec 004). BACKEND + UI implementados y verificados. Decisión del usuario 2026-10-12: backend primero, UI después en una sola pasada con el design system de ADR-0003 (Tailwind v3 + Radix/shadcn). Backend verificado end-to-end por HTTP real (ciclo completo de dinero + cierre de turno concurrente idempotente); UI con typecheck+lint+build verdes y 10/10 tests (6 guards + 4 shell smoke).
- Invariantes centrales verificadas con tests de integración contra PostgreSQL real (no mocks): pago registrado NO concede cobertura hasta validación humana (SPEC:PAY-01); pago validado inmutable y terminal (D-03/B); validación solo por admin y NUNCA sobre pago propio (SPEC:PAY-02, separación de funciones); movimiento de caja creado UNA vez en la misma transacción que el pago validado (unique `cash_movements.payment_id` = clave de idempotencia real); dinero validado solo cae en turno abierto (sin turno, validar falla 409 — sin dinero huérfano); cierre de turno idempotente bajo concurrencia (TX-05: un 200 y un 409 con `FOR UPDATE` + `WHERE state='open'`); renovación extiende la ventana desde el fin previo (sin huecos); auditoría de toda mutación financiera en la MISMA transacción; conciliación diaria con expected = apertura + Σ movimientos y discrepancia declarada−esperada registrada sin bloquear.
- Entregado: esquema (plans, memberships, payments, cashSessions, cashMovements, auditLog + migración 0005); contratos (CreatePlanRequest, PlanDetail, CreateMembershipRequest, MembershipRef, RegisterPaymentRequest, DecidePaymentRequest, OpenCashSessionRequest, CloseCashSessionRequest); servicios (plans, memberships, payments, cash, audit); rutas v1 completas en `app.ts`; 14 tests de integración nuevos (payments 8, cash 6) sobre BDs aisladas por archivo; UI ADR-0003 (Panel/Pagos/Caja/Portal + shell + QuickPay); docs API/runbook. Commits `db9c077`, `530697e`, `a9af0bb` locales sin push.

## Historial de unidades backend

- **008 · Concurrencia de la operación diaria (REQ-8)** — **CERRADA y SELLADA por el usuario 2026-10-12** (commit `5c4d8d4`). Prueba de carga con `app.inject` (stack real, sin k6/autocannon): 2 admins + 3 recepcionistas concurrentes, 5/5 BDD verdes contra Postgres real (`gym_test_concur`) — TX-05 (1 ok + 4× 409, una sola fila cerrada), movimiento único (5 movimientos, uno por pago), TX-01 (1 confirmada, cupo no excedido), check-in concurrente coherente, latencia p50=60ms/p95=91ms/max=93ms. **No queda ninguna unidad del plan de entrega abierta: el backend del template está completo** (004, 005, 006, 007 Tier 1 selladas + 008 Tier 2 sellada).
- **007 · QR de ingreso y check-in supervisado** (`specs/007-qr-checkin.md`, REQ-7/REQ-8, Tier 1) — **BACKEND implementado, verificado y SELLADO por el usuario 2026-10-12** (8/8). UI (escáner recepción + QR portal) después, con el rediseño estructural del frente.
- Invariantes verificadas con tests de integración contra Postgres REAL (no mocks), 8/8 en BD aislada `gym_test_qr`: **SPEC:CHECKIN** — cobertura activa (ventana vigente + plan coverage≠none) → allowed=true con identidad; vencida/coverage=none → allowed=false con motivo; **SPEC:QR-TOKEN** — token opaco único; revocado → denied; re-emitir restaura; **SPEC:CHECKIN-ISO** — token de otro tenant → 404 (no 403); **REQ-7** — el socio solo ve su QR; **idempotencia** — mismo QR dos veces → ambos allowed (autorización, no efecto); **REQ-8** — dos recepcionistas en paralelo → coherentes. La denegación por cobertura es decisión de negocio (200 + allowed:false), no error de transporte. Cada check-in audita checkin.ok/denied en la misma transacción.
- Entregado backend: migración `0008_qr_checkin` (members +qr_token unique +qr_revoked_at, backfill con gen_random_uuid); contratos (CheckinRequest/Response, MyQrResponse); servicio `checkin.ts` (emitir/rotar token en provisioning, resolver token scoped al tenant, validar cobertura activa reusando la definición de Entrega 2/offline, auditar); rutas v1 (`POST /checkin`, `GET /me/qr`, `POST /me/qr/rotate`, `POST /members/:id/qr/reissue`, `POST /members/:id/qr/revoke`).
- Tests: **41/41 de integración verdes** (payments 8, cash 6, bookings 6, offline 7, revoke 6, checkin 8) con BDs aisladas por archivo + gate del proyecto verde (lint, typecheck, build, unit). **Sellada con OK del usuario 2026-10-12.** UI (escáner en recepción + QR en portal del socio) después, con el rediseño estructural del frente.
- **Unidades Tier 1 ya selladas (OK del usuario 2026-10-12): 004, 005, 006.** Siguiente pieza del backend tras 007: REQ-8 (prueba de carga de recepcionistas) y cierre de meta. El frente sigue CONGELADO hasta el rediseño estructural con decisiones del usuario.
- Invariantes verificadas con tests de integración contra Postgres REAL (no mocks), 6/6 en BD aislada `gym_test_revoke`: **SPEC:REVOKE** — revocar una sesión borra la fila de `session` y el listado ya no la ve (efecto server-side, no depende del cliente); **revoke-all** elimina todas las sesiones de la cuenta y audita el conteo; **auto-revocación** cierra las otras sesiones y CONSERVA la actual (usa `sessionId` de la sesión en uso, resuelto en el hook de auth); **socio del mismo tenant** (sin fila staff, vinculado por email) puede ser revocado por su admin; **TX-07** — cuenta de otro tenant → 404 (anti-enumeración, no 403); **separación de funciones** — recepcion/instructor revocando ajenas → 403. Pertenencia al tenant de la cuenta objetivo resuelta por datos almacenados: `staff_assignments` activa en el org O email = `members.contact_email` del org.
- Entregado backend: contratos (SessionInfo, ListSessionsQuery, RevokeSessionRequest, RevokeAllSessionsRequest, RevokeResult); servicio `session-revocation.ts` (pertenencia tenant, listado, revoke/revoke-all sobre `session`, auto-revoke con exclusión de la sesión actual, auditoría en la misma transacción); rutas v1 (`GET /admin/sessions`, `POST /admin/sessions/revoke`, `POST /admin/sessions/revoke-all`, `POST /me/sessions/revoke-others`); `SessionContext.sessionId` capturado del hook de auth. **SPEC:BACKUP ejecutado de verdad**: backup `pg_dump -Fc` de la BD dev, restore en BD limpia `gym_restore_check`, conteos idénticos (organizations 1, members 2, payments 4, users 3) + query de humo por dominio OK; evidencia y runbook reproducible en `docs/operations/runbook.md`.
- Tests: **32/32 de integración verdes** (payments 8, cash 6, bookings 6, offline 7, revoke 6) con BDs aisladas por archivo + gate del proyecto verde (lint, typecheck, build, unit). **Sellada con OK del usuario 2026-10-12.** UI de administración de sesiones después, con el rediseño estructural del frente.
- 005 · Offline controlado (`specs/005-offline-controlado.md`, REQ-9, Tier 1) — **BACKEND implementado, verificado y SELLADO por el usuario 2026-10-12** (7/7). UI/cliente offline congelada a propósito hasta definir la estructura del frente con el usuario. Parámetros offline CONFIGURABLES por organización (`organizations.offline_enabled`, `offline_freshness_hours` default 72 = valor de trabajo NO aprobado, P-09.3.1b), no cableados.
- **004 (clases/reservas)**: BACKEND + UI implementados, verificados y **SELLADOS con OK del usuario 2026-10-12**.
- **Decisión del usuario 2026-10-12**: el frente actual no convence en lo ESTRUCTURAL (IA/layout, no colores); se congela toda la UI y se rediseña con decisiones del usuario cuando toque el frente, para dedicarle foco total. Mientras tanto, avance solo de backend.
- **Decisión del usuario 2026-10-12**: commits locales autorizados; **push a origin/main SOLO cuando el usuario lo pida explícitamente**.
- Pendientes críticos (resolver antes del piloto real G2)

- P-09.3.1b y cifrado resueltos el 2026-10-14 en ADR 0007: permiso firmado de máximo 72 h, revalidación online, AES-GCM/frase local. Pendiente validar equipos y procedimientos de custodia/pérdida/revocación diferida en el piloto.
- Validación jurídica de datos de menores (D-05) y acceso temporal de soporte (D-06).
- Política integral P-09.3; VPS concreto, región y recursos.

- Falta de progreso: contador 0, sin bloqueo.

## Meta actual — App GYM funcional (2026-10-19)

Unidad activa: 022-aceptacion-ci-staging — Verificada; lista para revisión humana y cierre G1 (2026-10-19)

## Unidad 022 — Revisión humana Tier 1, CI remota, staging VPS y cierre G1 — Tier 1 — Verificada (2026-10-19)

- **Autoridad:** Petición directa del usuario «resuelve la issues #6 · Revisión humana Tier 1, CI remota, staging VPS y cierre G1» (`specs/022-aceptacion-ci-staging.md`); PRD `REQ-1..REQ-11`, `CAL-1..CAL-3`; [PROMPT-MAESTRO.md](PROMPT-MAESTRO.md) §Cierre de meta; [ADR 0002](docs/adr/0002-arquitectura-base.md), [ADR 0007](docs/adr/0007-parametros-offline-cifrado.md) y [ADR 0010](docs/adr/0010-ciclo-comercial-agenda-exportaciones.md). Nivel: `Tier 1`.
- **Entregado y Verificado (CA-1..CA-4):**
  1. *CA-1 (Suite local completa y exclusión de sauna):*
     - `./scripts/verify.sh`: superado con código 0 (109 tests unitarios API + 46 web, typecheck, lint, build sin errores).
     - `pnpm test:coverage`: 77 tests pasados, 96.96% statements/lines (supera umbral del 80%).
     - `pnpm test:e2e`: 14/14 tests Playwright completados en 46.7s sobre preview de producción.
     - `grep -ri sauna apps/ packages/`: cero rutas ni tablas en código de producto (`REQ-10` verificado).
     - Lista de chequeo interactiva para revisión humana de unidades Tier 1 (`010`, `012`..`021`).
  2. *CA-2 (CI remota en GitHub Actions — CAL-1):*
     - Ejecución real en verde de `.github/workflows/verify.yml` sobre `origin/main` (commit `8c9168d109ba7cbbe8ee94ac810e61b112e6214e`, run ID `39323982842`, job ID `118305030133`).
     - Pasos ejecutados: preparación de BD PostgreSQL migrada con Drizzle `0000..0017`, ejecución de `./scripts/verify.sh` e instalación/ejecución completa de 14 pruebas E2E de Playwright.
  3. *CA-3 (Staging VPS, Backup/Restore y Contingencia Offline — REQ-9, REQ-11):*
     - Procedimiento de backup y restore ejecutado con éxito: `pg_dump -Fc` de base de datos local y `pg_restore` sobre base limpia de verificación `gym_restore_check`. Conteos 1:1 verificados (`organizations 1, members 2, payments 3, sessions 1, users 5`) y query de humo por dominio (`Miembro Sin Cuenta -> 1 pago`, `Socio Piloto -> 2 pagos`) con limpieza posterior.
     - Flujo de contingencia offline (`REQ-9`): validado con pruebas unitarias (`offline.test.ts`, `contingency-protocol.test.ts`), integración (`offline.integration.test.ts`), bóveda cifrada AES-GCM con frase local (`offline-vault.test.ts`) y E2E de 2 dispositivos offline que conservan cobros y sincronizan de forma idempotente (`operation.spec.ts:167`).
     - Runbook de staging con Docker Compose y Caddy reverse proxy documentado en `docs/operations/runbook.md`.
  4. *CA-4 (Sello de matriz G1):*
     - `docs/product/aceptacion-mvp.md` y `STATE.md` actualizados con el 100% de los criterios `MVP-AC-01..AC-10` verificados en G1.
     - Frontera con G2 explícitamente delimitada (inicio del piloto en terreno con socios y datos reales sujeto a autorización separada y validaciones jurídicas `D-05`/`D-06`).
- **Contador de falta de progreso:** 0, sin bloqueos.
- **Siguiente paso:** Presentar al usuario la lista de chequeo de revisión humana Tier 1 para confirmación explícita de cierre.

## Unidad 019 — Abonos parciales con activación al 100% y estados de conciliación — Tier 1 — Cerrada (2026-10-19)

- **Autoridad:** Petición directa del usuario «resuelve la issues #5 · Abonos parciales con activación al 100% y conciliación» (`specs/019-abonos-parciales-conciliacion.md`); PRD `REQ-1`, `REQ-2`, `REQ-3`, `REQ-8`, `CAL-2`, `CAL-3`; `ADR 0002`, `ADR 0008`, `ADR 0009` y `ADR 0010` §A3. Clasificación: `Tier 1` (afecta dinero, activación de derechos, caja, concurrencia y migración). Commits locales autorizados, sin push a remoto.
- **Entregado:**
  1. *Esquema y migración aditiva:* Migración `0016_partial_payments_reconciliation.sql` agregando `memberships.cycle_target_cents` y `payments.period_id` con índice `payments_period_idx`.
  2. *Contratos:* `ReconciliationState` (`abierta`, `cuadrada`, `con_diferencia`), `CashSessionRef.reconciliationState`, `MembershipRef.cycleTargetCents / cyclePaidCents / cycleRemainingCents`, `PaymentRef.periodId / decidedAt`.
  3. *Lógica financiera y transaccional:*
     - `PaymentsService`: Validación con bloqueo pesimista `FOR UPDATE` sobre `memberships`, comprobando saldo acumulado de pagos validados del ciclo. Abonos parciales ingresan a caja abierta de inmediato sin emitir período ni créditos. Al completar el 100% emite período único inmutable vinculando todos los pagos del ciclo (`periodId`), resetea `cycleTargetCents`, y extiende vigencia. Bloqueo de sobrepago concurrente con 409 `AMOUNT_EXCEEDS_CYCLE_BALANCE`.
     - `CashService`: Función pura `deriveReconciliationState` expone `abierta`, `cuadrada` o `con_diferencia` según discrepancia al cerrar sesión y en listado.
     - `OperationsService`: `dailyReport` calcula agregados `partialCyclesPendingCents` y `partialCyclesCount`, y proyecta `reconciliationState` en sesiones del reporte.
     - `app.ts`: Inyección de balance de ciclo en endpoints de membresía y nueva ruta `/api/v1/cash/sessions`.
  4. *Web UI:*
     - `QuickPay.tsx`: Muestra barra/insignia de progreso de abonos y saldo restante.
     - `MemberDetail.tsx`: Muestra estado de abono parcial y montos pagados/pendientes.
     - `Cash.tsx`: Etiqueta de conciliación (`Cuadrada` / `Con diferencia`) en último turno cerrado.
     - `Reports.tsx`: Muestra estado de conciliación en tabla de turnos y tarjeta de estadísticas «Ciclos en abono».
- **Evidencia verificable:**
  - `CA-1:` `pnpm --filter @gym/api exec vitest run src/partial-payments.integration.test.ts -t "CA-1"` (1 passed).
  - `CA-2:` `pnpm --filter @gym/api exec vitest run src/partial-payments.integration.test.ts -t "CA-2"` (1 passed).
  - `CA-3:` `pnpm --filter @gym/api exec vitest run src/partial-payments.integration.test.ts -t "CA-3"` (1 passed) + `pnpm --filter @gym/contracts test` (17 passed).
  - `CA-4:` `pnpm --filter @gym/api exec vitest run src/partial-payments.integration.test.ts -t "CA-4"` (1 passed).
  - `CA-5:` `pnpm --filter @gym/web test src/partial-payments.test.tsx` (4 passed).
  - `CA-6:` `./scripts/verify.sh` verde (lint, build, typecheck, tests en 4 workspaces) + cobertura financiera `node scripts/coverage.mjs` (73 passed, 96.96% statements).
- **Contador de falta de progreso:** 0, sin bloqueos.
- **Siguiente paso:** Revisión humana de cierre de la unidad 019.

## Unidad 018 — Reprogramación de agenda y citas personalizadas — Tier 1 — Cerrada (2026-10-19)

- **Autoridad:** petición directa del usuario «resuelve la issue #4 · Reprogramación de sesiones y citas en agenda unificada»; PRD REQ-1, REQ-4, REQ-5, REQ-6, REQ-7, CAL-2, CAL-3; ADR 0002, ADR 0009 y ADR 0010 §1.2. Nivel Tier 1 con spec aprobada `specs/018-reprogramacion-agenda-citas.md`. Commits locales autorizados, sin push a remoto.
- **Entregado:**
  1. *Base de datos y contratos:* Migración `0018_session_reschedule.sql` añadiendo `rescheduled_at`, `rescheduled_from_starts_at` y `rescheduled_count` (default 0) en `sessions`. Contrato `RescheduleSessionRequest` con validación Zod de ventana temporal y motivo sanitizado opcional; extensión de `SessionDetail` y tipos de cliente.
  2. *Servicios y backend:* Método `SessionsService.reschedule` con control de permisos por rol (admin/recepcion en cualquier sesión; instructor solo en citas o bloqueos propios; socio 403; cross-tenant 404). Concurrencia segura `TX-02` con advisory lock `pg_advisory_xact_lock` sobre `(organizationId, instructorId)` y `FOR UPDATE` sobre la fila de la sesión, evitando solapamientos concurrentes (409 `SESSION_OVERLAP`).
  3. *Revalidación de cobertura (REVAL-01):* Validación atómica de que ningún socio inscrito quede descubierto en la nueva fecha (verifica expiración de vigencia, pausas activas de spec 017 y reservas duplicadas en sesiones simultáneas, retornando 409 `RESCHEDULE_MEMBER_UNCOVERED`). Conservación íntegra de `bookings` (`confirmada`) y `credit_movements` sin cobros ni reembolsos duplicados. Registro de evento `session.rescheduled` en `audit_log`.
  4. *UI (apps/web):* Modal interactivo de reprogramación en `SessionDetail.tsx` con selector de fechas y motivo; distintivo visual «Horario reprogramado» en `SessionDetail.tsx`, agenda semanal `Classes.tsx` y portal del socio `Portal.tsx`.
  5. *Documentación y sincronización (CAL-3):* Documentación de `POST /api/v1/sessions/:id/reschedule` en `docs/api/README.md` sincronizada con `api-docs-sync.test.ts`.
- **Evidencia verificable:**
  - `CA-1:` `POST /api/v1/sessions/:id/reschedule` mueve horario, audita `session.rescheduled`, conserva reservas confirmadas y no descuenta créditos adicionales (4/4 en `apps/api/src/sessions-reschedule.integration.test.ts`).
  - `CA-2:` `TX-02` concurrencia real y permisos de rol (recepcion ok, instructor propio ok, ajeno 403, socio 403, cross-tenant 404, 2 reprogramaciones solapadas concurrentes = 1 ok 200 y 1 409).
  - `CA-3:` `REVAL-01` rechaza con 409 si un socio inscrito no cubre la nueva fecha por período vencido, pausa activa de membresía o reserva concurrente en otra sesión (4/4 en `sessions-reschedule.integration.test.ts`).
  - `CA-4:` `SessionDetail.tsx`, `Classes.tsx` y `Portal.tsx` muestran distintivo «Horario reprogramado»; 4/4 en `apps/web/src/sessions-reschedule.test.tsx` + 14/14 en `node scripts/e2e.mjs`.
  - Cobertura financiera: `node scripts/coverage.mjs` (72 passed, 97.09% statements/lines, umbral >= 80% superado).
  - Gate de calidad: `./scripts/verify.sh` superado en verde (lint, build, typecheck, tests en 4 workspaces y verify-scope verificado).
- **Contador de falta de progreso:** 0, sin bloqueos.
- **Siguiente paso:** Revisión humana de cierre de la unidad 018. Continuar según la ruta MVP con `019-abonos-parciales-conciliacion`.

## Unidad 021 — Menores de edad, adaptador de correo y contratos (CAL-3) — Tier 1 — Cerrada (2026-10-19)

## Unidad 020 — Matriz de exportaciones operativas CSV — Tier 2 — CERRADA (2026-10-19)

- **Autoridad:** petición directa del usuario «Resuelve la Issue #2 (specs/020-exportaciones-operativas-csv.md)»; PRD REQ-1, REQ-2, REQ-4, REQ-5, REQ-7, CAL-3; ADR 0010 §1.4. Nivel Tier 2 autoaceptado dentro del PRD y base aprobada.
- **Alcance entregado:** contratos `AttendanceReportQuery` en `@gym/contracts`; métodos `membersCsv`, `membershipsCsv`, `attendanceCsv` con sanitización anti-fórmulas en `OperationsService`; rutas `GET /api/v1/reports/*.csv` con control de roles (`admin`, `recepcion` permitidos; `instructor`, `socio` 403; anónimo 401) y aislamiento estricto multi-tenant (`organizationId`); controles de descarga en `Reports.tsx` (`/reportes`) y cliente `api.ts`; pruebas en `contracts.test.ts`, `operations.integration.test.ts`, `reports-export.test.tsx` y suite E2E `tests/e2e/operation.spec.ts`.
- **Verificación y evidencia (DoD completa):**
  - CA-1: `GET /api/v1/reports/members.csv` y `memberships.csv` proyectan datos del tenant (`org`) con estado verificado de contacto, adulto responsable, `qr_state` (`activo|revocado|sin_emitir`), vigencias y créditos disponibles por modalidad, omitiendo `qrToken` (19/19 en `operations.integration.test.ts`).
  - CA-2: `GET /api/v1/reports/attendance.csv?from=...&to=...` exporta reservas, asistencias y cancelaciones del rango, y rechaza con `400 VALIDATION_ERROR` rangos con `from > to` o superiores a 93 días corridos (19/19 en `operations.integration.test.ts`).
  - CA-3: `instructor` y `socio` reciben `403 FORBIDDEN` en los 3 endpoints; anónimo recibe `401`; inyección de fórmulas neutralizada con apóstrofo `'` inicial y RFC 4180.
  - CA-4: `Reports.tsx` (`/reportes`) permite descargar los 4 reportes CSV (financiero diario + socios, vigencias/créditos, reservas/asistencia) con validación de rango reactiva; 3/3 en `reports-export.test.tsx`, 12/12 en `pnpm test:e2e` (`node scripts/e2e.mjs`) sobre preview de producción y PostgreSQL ficticio (`gym_e2e`); `./scripts/verify.sh` superado en verde (lint, build, typecheck, tests y verify-scope sin advertencias).
- **Contador de falta de progreso:** 0, sin bloqueos.
- **Siguiente paso:** Crear commit local para la unidad 020 verificado contra `Archivos autorizados`.

## Unidad 017 — Catálogo editable, pausas autorizadas y cambio de plan — Tier 1 — Implementada/verificada; revisión humana pendiente

- Autoridad: resolución de Issue #1 (`specs/017-catalogo-pausas-cambio-plan.md`); validación explícita del usuario (`A1`, ADR 0010); PRD REQ-1, REQ-2, REQ-5, REQ-7, CAL-2, CAL-3. Commits locales autorizados por unidad verificada; revisión humana al cierre.
- Entregado:
  - Migración aditiva Drizzle `0014_catalog_pauses_plan_changes.sql` (`plans.version`, `memberships.nextPlanId`, `membershipPeriods.planVersion`, tabla `membershipPauses`).
  - Contratos Zod en `@gym/contracts`: `UpdatePlanRequest`, `SchedulePlanChangeRequest`, `CreateMembershipPauseRequest`, `MembershipPauseRef`, `PlanRef.version`, `MembershipRef.nextPlanId`.
  - Backend API: `PlansService.update` (versionado inmutable y toggle activo/archivado), `MembershipsService.schedulePlanChange` (aislamiento y validación de plan activo), `MembershipsService.createPause` (idempotencia por clave, extensión de fin de vigencia, cancelación de reservas con restitución de créditos), `CheckinService` (denegación de ingreso por membresía pausada con motivo `membership_paused`), `BookingCreditsService` (bloqueo de reservas dentro de intervalos pausados) y `PaymentsService` (consumo de `nextPlanId` y snapshot de `planVersion` en renovaciones).
  - Web UI: edición de catálogo y versión en `Plans.tsx`, modal de pausa y selector de cambio de plan en `MemberDetail.tsx`, alerta de pausa activa con motivo y aviso de plan futuro en `Portal.tsx`.
- Evidencia final:
  - Gate raíz `./scripts/verify.sh`: salida 0 (lint, typecheck, build, unit tests 149/149).
  - Integración PostgreSQL `TEST_DATABASE_URL`: 15 suites de integración completas sin omitidos; `memberships-lifecycle.integration.test.ts` 4/4 pasando.
  - Cobertura financiera (`node scripts/coverage.mjs`): 68/68 pruebas, 97.09% statements/lines (umbral >= 80% superado holgadamente).
  - Suite E2E Playwright (`node scripts/e2e.mjs`): 12/12 pasando en 24.4s, incluyendo prueba completa de SPEC017 y viewport móvil sin overflow (screenshot `/tmp/gym-017-pauses-mobile.png`).
- Checkpoint: unidad 017 lista para commit local con Conventional Commits. Revisión humana Tier 1 requerida. Siguiente unidad en ruta: `018-reprogramacion-agenda-citas`. Contador de falta de progreso: 0.

## Unidad 016 — Períodos y créditos por modalidad — Tier 1 — Implementada/verificada; revisión humana pendiente

- Autoridad: «continua» y respuesta explícita a cuotas separadas por modalidad/período, sin acumulación; ADR 0009 registrado antes de código. Spec 016, revisión humana al cierre y commits locales sin push.
- Evidencia final: gate raíz salida 0, 197/197 (145 API, 36 web, 11 contratos, 5 db), sin omitidos; integración completa 14 suites sin omitidos, E2E 11/11, cobertura 64 pruebas/97.23% statements-lines, booking-credits 100%. Trece casos de créditos prueban límite concurrente entre sesiones, última plaza, cancelación multi-clase/multi-socio sin deadlock, restitución/reclamo único, snapshot y renovación consecutiva sin perder inicio. Migración desde 0012 probada en BDs ficticias limitada/ilimitada, sin saldos inventados ni pérdida de reservas; captura móvil inspeccionada. Detalle por CA en spec 016.
- Checkpoint final: unidad 016 en `c4c07de`. Revisiones humanas 010/012/013/014/015/016 pendientes. Fuente/decisión cuantitativa en ADR 0009; no alterar históricos. Siguiente unidad activa para codificar: `017-catalogo-pausas-cambio-plan` según ADR 0010 y ruta 017–022. Matriz actualizada; meta abierta y contador 0.

## Unidad 015 — Recuperación y contacto verificado — Tier 1 — Implementada/verificada; revisión humana y entrega real pendientes

- Autoridad: usuario «1:C» y «continua»; preparar sin proveedor/envío real. Spec 015, transporte de prueba exclusivamente ficticio, revisión humana al cierre; commits locales, sin push.
- Diagnóstico 015: gate encontró una expectativa HTTP antigua en auth-flow (PATCH sin verificar 200→409); spec amplía ruta antes de actualizar test al contrato vigente, conserva aislamiento/eliminación propia y prueba completa de verificación en nueva suite. Contador 0, causa reducida y corrección acotada.
- Evidencia final: gate raíz salida 0, 181/181 (132 API, 34 web, 10 contratos, 5 db), sin omitidos; integración 13 suites en BDs aisladas, E2E 10/10 sobre preview, cobertura financiera 96.71% (51 pruebas). Token de reset de un uso entre dos instancias, caducidad, contraseña/sesiones; contacto atómico con prueba, cuenta estable, permisos/reenvío/fallo de entrega comprobados. Captura móvil inspeccionada; diff propio 33 rutas, scope del lote 63 rutas y estructura correctos. Detalle por CA en spec 015; aprendizaje actualizado.
- Límite: correo real apagado, sin proveedor/credenciales/adaptador. Núcleo probado solo con buzón ficticio; activar entrega exige su unidad, controles operativos y revisar atomicidad global del reset en Better Auth 1.7.7, documentada en runbook. No declarar REQ-7 ni MVP completos.
- Checkpoint final: unidad 014 en e9ee19d; commit local de 015 identificado por ID, sin push. Remoto main verificado sigue eac204f. Revisiones humanas 010/012/013/014/015 pendientes por PROMPT-MAESTRO/AGENTS. Próximo paso: revisar estas entregas; siguiente brecha de producto en matriz es créditos/períodos y revalidación, contrastar reglas confirmadas y consultar ambigüedades de negocio antes de spec nueva. Meta abierta, sin bloqueo técnico; contador 0.

## Unidad 014 — Ajustes y devoluciones — Tier 1 — Implementada/verificada; revisión humana pendiente

- Autoridad 2026-10-15: usuario «1:C; 2:aprobado». Preparar identidad sin envío real ni proveedor; política financiera aceptada: solo admin online, motivo/compensación inmutables, límite al cobro, idempotencia y sin cambiar vigencia automáticamente. ADR 0008 y spec 014, revisión humana al cierre, commits locales sin push.
- Checkpoint: primero contratos/tests rojos, ledger compensatorio/caja/reportes/UI, concurrencia y permisos, cobertura/E2E/gate, evidencia y commit local; después unidad 015 de recuperación/verificación con entrega deshabilitada por defecto. Base f34cf4d; comparar lote contra origin/main sin modificar referencias. Falta de progreso 0.
- Evidencia final 014: integración 12 suites sin omitidos, módulo financiero 7/7, UI 2/2, E2E 9/9 con captura móvil inspeccionada, cobertura 96.71%, gate raíz 167/167 salida 0. Ledger inmutable/idempotente, límites, permisos, cierre concurrente y netos comprobados. Detalle por CA en spec 014 y aprendizaje actualizado. Commit local de unidad por ID, sin push; siguiente 015, primero spec y pruebas rojas. Contador 0.
- Revisiones 010/012/013/014 pendientes; datos reales, correo externo, publicación y staging/G2 no autorizados. Brechas restantes en matriz de aceptación.

## Unidad 013 — Integración y E2E en CI — Tier 1 — Implementada/verificada localmente; revisión humana/remota pendientes

- Autoridad: continuación del usuario sobre las brechas del MVP; CAL-1 y delegación confirmada. Spec 013, sin push/despliegue; revisión humana de cierre pendiente.
- Alcance propio: workflow, spec/STATE/aprendizaje/matriz/runbook. Scope-lock incluye rutas ya verificadas de 012 porque origin/main sigue en eac204f y 6c16597 está solo local; comparar esta unidad además contra 6c16597, sin modificar origin/main ni implementación anterior.
- Checkpoint: preparar TEST_DATABASE_URL migrada y Chromium, conservar gate raíz y ejecutar E2E como paso obligatorio. Rojo/configuración/ensayos adversarios/gate y commit local. Preguntas de correo/política financiera y revisiones 010/012 pendientes. Falta de progreso: 0.
- Evidencia: variable ausente rechazada antes de instalar/migrar, migración fallida propaga salida 31, orden/pasos obligatorios inspeccionados; preparación/gate literales del workflow sobre BD nueva gym_test_ci013 → salida 0, 157/157 sin omitidos, lint/build/typecheck verdes (/tmp/gym-013-ci-local.log). E2E del mismo código/runner: 8/8 en 012; ninguna modificación de aplicación después de 6c16597.
- Checkpoint final: commit local de unidad 013 por ID, sin push. Unidad 012 en 6c16597, 013 como siguiente commit local, revisiones humanas Tier 1 pendientes. Siguientes datos necesarios: canal de correo y política de ajustes/devoluciones, consultas asíncronas aún sin respuesta. La matriz conserva además brechas de membresías/créditos/menores/reprogramación/exportaciones. Staging/G2 no autorizados; no se declara app completa. Contador 0.

## Unidad 012 — Transbank manual y matriz de aceptación — Tier 1 — Implementada/verificada; revisión humana pendiente

- Autoridad: «continua», 2026-10-14; PRD REQ-2/3/9 y delegación confirmada. Spec specs/012-transbank-manual.md; revisión humana al cierre pendiente, commits locales autorizados, sin nuevo permiso de push/despliegue/G2.
- Objetivo: cobro manual Transbank con operación/comentario, proyecciones y outbox coherentes; matriz completa de aceptación con evidencia y brechas; corregir pendientes documentales ya resueltos por ADR 0007.
- Checkpoint: main limpio eac204f, CI 38661741866 verde; primero tests/rojo, implementación, integración/cobertura/E2E/gate y commit local de lo verificado. Falta de progreso: 0.
- Pendientes de información: canal de correo para recuperación/verificación y política de ajustes/devoluciones (preguntas asíncronas). Spec 003 excluyó devoluciones y dejó ajustes por definir; no se inventa política. Menores requieren validación jurídica antes de uso real. Unidad 010 sigue pendiente de aceptación humana.
- Matriz de aceptación: docs/product/aceptacion-mvp.md distingue núcleo probado de brechas en recuperación/contacto, menores, pausas/versiones, créditos limitados, abonos/ajustes, reprogramación y exportaciones. No se presenta el núcleo como MVP completo.
- Diagnóstico de verificación: runner de integración falló por usuarios residuales en fixture members (user_pkey); ampliación de alcance registrada antes de corregir su preparación, sin cambiar expectativas ni borrar la BD. Verificar dos ejecuciones consecutivas. Falta de progreso: 0 (causa reproducida).
- Evidencia final: members 8/8 dos veces en la misma BD; integración completa 11 suites sin omitidos; E2E 8/8 (Transbank/validación/CSV y regresión offline); cobertura 44 tests, 95.98% statements/lines. Gate raíz salida 0, 157/157 reales, sin omitidos, lint/build/typecheck/scope verdes. Logs y detalle por criterio en spec 012; aprendizaje actualizado.
- Checkpoint: commit local de unidad 012 (por ID, sin segundo commit para anotar hash); sin push. Siguiente unidad: CI integración/E2E; primer paso registrar spec Tier 1 y preparar BD migrada/navegador sin alterar el gate raíz. Correo y ajustes siguen esperando respuesta; aceptación humana de 010/012 y staging/G2 pendientes. Contador 0.

## Unidad 011 — Espera del estado de Caja — Tier 3 — Cerrada

- Fuente/resultado: spec 010 CA-5/CA-8; el smoke test debe esperar el estado cargado de Caja. CI 38661089570 rojo por lectura inmediata de «Abierto» tras el título.
- Autoridad: reporte del usuario «dio rojo», 2026-10-14; corrección/commit según PROMPT-MAESTRO y continuidad de la publicación solicitada. Spec breve para mantener el scope-lock del gate existente.
- Alcance: specs/011-caja-test-asincrono.md, apps/web/src/shell.test.tsx, STATE.md y docs/learning.md; sin cambios de producto, dependencias ni controles.
- Verificación: rojo reproducible con promesa diferida (/tmp/gym-011-red.log), verde con espera del estado final; suite web 26/26, gate raíz salida 0 con 148/148 pruebas reales sin omitidos, lint/build/typecheck/scope y diff correctos (/tmp/gym-011-gate-final.log). Aprendizaje en docs/learning.md.
- Checkpoint: commit de corrección identificado por unidad 011, sin segundo commit para anotar su propio hash; publicación como continuación del push solicitado. Siguiente paso: comprobar CI del commit corregido, luego revisión humana de 010. Falta de progreso: 0. Unidad 010 publicada en 7852239, revisión humana Tier 1 todavía pendiente.

### Unidad 010 — Implementación publicada; revisión humana pendiente

- Tier 1; spec: specs/010-app-operativa.md. Implementación autorizada por petición actual del usuario, reemplaza la congelación del frente. Revisión humana al cierre según PROMPT-MAESTRO.
- Objetivo: flujos completos online por rol y contingencia controlada del PRD; arranque y verificación real. Las recomendaciones previas se convierten en implementación.
- Decisión confirmada: permiso offline máximo 72 horas con revalidación al reconectar (respuesta explícita del usuario 2026-10-14). Cifrado/gestión de claves aceptados por el usuario en ADR 0007: AES-GCM con frase local, permiso firmado y bloqueo al salir.
- Estado: implementación verificada, preparada para commit local de la unidad 010 según la delegación confirmada. Gate raíz real pasó con 148 tests (111 API incluyendo integración, 26 web, 6 contracts, 5 db), sin suites omitidas; CAL-2 96.24% statements/lines. 7/7 E2E pasan en preview de producción, incluida recarga offline en dos dispositivos, reconexión/replay y cero API cacheadas. Revisión humana Tier 1 pendiente.
- Diagnóstico resuelto: build de producción habilita SW y /contingencia mantiene su superficie al recuperar sesión; outbox conserva folios y snapshots firmados entre recargas. Evidencia final E2E 7/7 en /tmp/gym-010-e2e-prod.log.
- G2, datos reales y despliegue remoto no autorizados.
- Arranque y SIGINT comprobados: API/web 200, parada completa de ambos, PostgreSQL/datos conservados. Backup/restore 0009 en BD limpia: conteos idénticos. Diff y scope revisados (65 rutas).
- Gate final ejecutado: salida 0, 148/148 pruebas, ninguna omitida; E2E 7/7, coverage 96.24%, diff sin errores y scope válido.
- Commit/checkpoint: commit local de implementación de la unidad 010, identificado por su ID; no requiere otro commit para anotar su hash. Sin push.
- Siguiente paso: revisión humana del usuario sobre la app local (pnpm start, localhost:4173), requerida para sellar Tier 1. Luego preparar staging/privacidad/piloto únicamente con autorización y decisiones propias. No reiniciar entrevista ni repetir unidades backend cerradas.
- Falta de progreso: 0; cada fallo reciente ha reducido el problema con evidencia; sin bloqueo activo.

## CAL-2 — cobertura de módulos de dinero y reservas (2026-10-12)

- **CAL-2 CUMPLIDO** (decisión del usuario 2026-10-12): umbral ≥80% en statements/lines sobre `payments.ts`, `cash.ts`, `bookings.ts`, `memberships.ts`, medido con `@vitest/coverage-v8` contra Postgres real.
- Resultado: **statements/lines 96.2%** (payments 98%, cash 100%, bookings 94%, memberships 90%), **functions 97.7%**. Gate configurado con umbral 80% en statements/lines.
- **Branch coverage 76.5%**, deliberadamente NO gated: las ramas restantes son guards defensivos bajo lock transaccional (`if(!locked)` tras `FOR UPDATE`, fallbacks `?? 24`, `rows[0]?.h`) que no se ejercitan sin mockear el driver de BD — el proyecto solo testea contra Postgres real. Decisión del usuario: documentar, no forzar.
- Se cerró el hueco real detectado: `markAttendance` (asistio/ausencia, REQ-5), `listByMember`, `listBySession` y los caminos de error/borde de pagos/caja/reservas (transferencia sin referencia, membresía/pago/sesión inexistente 404, doble reserva, cancelar cancelada/ausente, recepción rechazando). Suite de integración pasó de 46 a **65 tests**.

## Cobertura y límites

El traslado desde Notion cubre decisiones de negocio y alcance; no certifica la implementación. Las pruebas de aislamiento, transacciones (TX-01..TX-07), offline (idempotencia, folios, reconstrucción) y backup/restore se ejecutarán en las unidades de entrega 1..5 del plan G1 con evidencia real. G2 (piloto con datos reales) no está autorizado.
