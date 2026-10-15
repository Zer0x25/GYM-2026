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

## Meta actual — App GYM funcional (2026-10-14)

Unidad activa: 013-ci-integracion-e2e

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
