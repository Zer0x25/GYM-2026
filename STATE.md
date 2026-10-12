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

## Unidad activa

- 002 · Auth, tenant y roles + socios y permisos (specs/002-auth-tenant-socios.md, Tier 1) — **implementada y verificada; pendiente de revisión humana del usuario antes de cerrar**. Gate completo en verde (lint, typecheck, build, 22 tests: 14 unit + 8 integración contra Postgres real). Commit local `edfc8fa` sin push.
- Verificado por CA: CA-1/CA-2 (sesión con org+role desde datos almacenados; cross-tenant 404 sin fuga), CA-3 (listado/búsqueda filtrados por tenant; organizationId del body ignorado), CA-4 (socio edita solo su contacto; ajeno → FORBIDDEN), CA-8 (`grep -ri sauna` en código: 0).
- Pendiente de esta unidad: rutas HTTP (POST /api/v1/members, GET /api/v1/members, /auth/session) y pantallas de login/panel/portal en apps/web — el servicio, sesión y reglas de permiso están hechos y probados; el cableado fino de rutas+UI es el remanente.
- Siguiente paso (Entrega 2): planes/períodos/beneficios + pagos manuales/validación + caja/QR.

## Pendientes críticos (resolver antes del piloto real G2)

- Parámetro de permiso offline P-09.3.1b (duración exacta y verificación; 72 h es valor de trabajo derivado, no aprobado).
- Cifrado/gestión de claves del almacenamiento local offline y revocación diferida.
- Validación jurídica de datos de menores (D-05) y acceso temporal de soporte (D-06).
- Política integral P-09.3; VPS concreto, región y recursos.

- Falta de progreso: contador 0, sin bloqueo.

## Cobertura y límites

El traslado desde Notion cubre decisiones de negocio y alcance; no certifica la implementación. Las pruebas de aislamiento, transacciones (TX-01..TX-07), offline (idempotencia, folios, reconstrucción) y backup/restore se ejecutarán en las unidades de entrega 1..5 del plan G1 con evidencia real. G2 (piloto con datos reales) no está autorizado.
