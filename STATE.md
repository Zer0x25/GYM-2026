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

## Unidad activa

- 003 · Planes, membresías, pagos con validación y caja (specs/003-planes-pagos-caja.md, Tier 1) — **spec aprobada; BACKEND + UI implementados y verificados 2026-10-12**. Decisión del usuario 2026-10-12: backend primero, UI después en una sola pasada con el design system de ADR-0003 (Tailwind v3 + Radix/shadcn). Backend verificado end-to-end por HTTP real (ciclo completo de dinero + cierre de turno concurrente idempotente); UI con typecheck+lint+build verdes y 6/6 tests de guards.
- Invariantes centrales verificadas con tests de integración contra PostgreSQL real (no mocks): pago registrado NO concede cobertura hasta validación humana (SPEC:PAY-01); pago validado inmutable y terminal (D-03/B); validación solo por admin y NUNCA sobre pago propio (SPEC:PAY-02, separación de funciones); movimiento de caja creado UNA vez en la misma transacción que el pago validado (unique `cash_movements.payment_id` = clave de idempotencia real); dinero validado solo cae en turno abierto (sin turno, validar falla 409 — sin dinero huérfano); cierre de turno idempotente bajo concurrencia (TX-05: un 200 + un 409 con `FOR UPDATE` + `WHERE state='open'`); renovación extiende la ventana desde el fin previo (sin huecos); auditoría de toda mutación financiera en la MISMA transacción (si la mutación hace rollback, la auditoría también); conciliación diaria con expected = apertura + Σ movimientos y discrepancia declarada−esperada registrada sin bloquear.
- Entregado: esquema (plans, memberships, payments, cashSessions, cashMovements, auditLog + migración 0005); contratos (CreatePlanRequest, PlanDetail, CreateMembershipRequest, MembershipRef, RegisterPaymentRequest, DecidePaymentRequest, OpenCashSessionRequest, CloseCashSessionRequest); servicios (plans, memberships, payments, cash, audit); rutas v1 completas en `app.ts`; 14 tests de integración nuevos (payments 8, cash 6) sobre BDs aisladas por archivo (`gym_test_payments`, `gym_test_cash`) para evitar TRUNCATE mutuo.
- Evidencia real: gate verde (lint + typecheck + build + tests); `apps/api` 28 tests pasados / 13 skipped (los de Entrega 1 requieren TEST_DATABASE_URL explícita) + 13/13 con TEST_DATABASE_URL; separación de funciones verificada (recepción 403 al validar, admin 403 sobre pago propio); cierre concurrente 200+409.
- UI (ADR-0003): Tailwind v3 + Radix/shadcn con tokens CSS por tenant; componentes ui (button, card, input, label, badge, table, dialog, tabs, toaster); páginas Panel (socios + estado de membresía + cobro rápido), Payments (bandeja de validación provisional/validado/rechazado con validar/rechazar admin-only), Cash (turno, movimientos, conciliación con discrepancia), Portal (perfil + membresías propias); shell con sidebar por dominio + topbar con badge de caja. Bundle web 329KB (103KB gzip). El backend sigue siendo autoridad: la UI solo refleja 403/409 como toasts.
- Pendiente de esta unidad: revisión humana Tier 1 de los flujos de dinero y de la UI de recepción.
- Siguiente paso (Entrega 3): clases grupales + personalizadas + reservas (REQ-4/5/6).
## Pendientes críticos (resolver antes del piloto real G2)

- Parámetro de permiso offline P-09.3.1b (duración exacta y verificación; 72 h es valor de trabajo derivado, no aprobado).
- Cifrado/gestión de claves del almacenamiento local offline y revocación diferida.
- Validación jurídica de datos de menores (D-05) y acceso temporal de soporte (D-06).
- Política integral P-09.3; VPS concreto, región y recursos.

- Falta de progreso: contador 0, sin bloqueo.

## Cobertura y límites

El traslado desde Notion cubre decisiones de negocio y alcance; no certifica la implementación. Las pruebas de aislamiento, transacciones (TX-01..TX-07), offline (idempotencia, folios, reconstrucción) y backup/restore se ejecutarán en las unidades de entrega 1..5 del plan G1 con evidencia real. G2 (piloto con datos reales) no está autorizado.
