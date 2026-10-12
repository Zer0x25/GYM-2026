# App GYM (GYM-2026) — MVP v1.0

Plataforma web multi-organización para gimnasios independientes (una sede por organización): administración de socios, membresías y pagos manuales; clases grupales y personalizadas; portal del socio; y continuidad offline controlada para el piloto. Sauna expresamente fuera de v1.0.

**Estado:** Hito 0 sellado (2026-10-11, gate verde). Hito 1 en preparación: siguiente unidad `specs/001-andamiaje-monorepo.md` (andamiaje del monorepo pnpm).

## Stack

Vite + React (SPA/PWA) · Fastify · PostgreSQL + Drizzle · Better Auth (self-hosted) · TypeScript · Tailwind · Vitest + Supertest + Playwright · pnpm workspaces (monorepo) · despliegue en VPS Linux propio (Docker Compose).

## Estructura

```
apps/web        # SPA/PWA React + Vite (panel staff + portal socio)
apps/api        # Fastify: auth, contexto tenant, servicios de dominio, sync
packages/contracts  # esquemas versionados de request/response/eventos
packages/db     # esquema Drizzle, migraciones SQL versionadas
docs/api/       # contratos HTTP documentados
docs/operations/runbook.md  # despliegue en VPS (borrador)
specs/          # unidades de trabajo (specs por tier, trazabilidad Notion)
```

## Fuentes de verdad

| Archivo | Responsabilidad |
|---|---|
| PRD.md | Alcance, exclusiones y aceptación final (REQ/CAL) |
| AGENTS.md | Reglas operativas vigentes y DoD |
| docs/adr/ | Decisiones históricas; arquitectura del producto en 0002 |
| PROMPT-MAESTRO.md | Invocación de Hito 1, delegación y autoridad confirmada |
| specs/ | Contrato, criterios y evidencia de una unidad |
| STATE.md | Meta, trabajo activo, pendientes y checkpoint |
| docs/learning.md | Hallazgos útiles con evidencia |

El alcance proviene del documento «MVP v1.0 · Cierre final para aprobación» aprobado en Notion el 10-10-2026 (G0), trasladado por Modo A. Notion es contexto (decisiones de negocio), nunca fuente de verdad ejecutable; el gate no depende de Notion.

## Verificación

```sh
./scripts/verify.sh
```

Ejecuta integridad documental, sintaxis Bash, contrato del gate y, en `initializing`/`project`, `scripts/verify-project.sh` (lint, typecheck, build, unitarias e integración del monorepo). Es el mismo comando para cierre local, hook y CI.

## Puesta en marcha (una vez creado el andamiaje)

```sh
corepack enable && pnpm install
docker compose up -d postgres      # PostgreSQL 16 para desarrollo
cp .env.example .env               # nombres ficticios; valores reales fuera del repo
pnpm -r build
pnpm -r test                       # unitarias + integración (Supertest)
./scripts/verify.sh
```

El detalle de ambientes, secretos, backup/restore y pasos remotos vive en `docs/operations/runbook.md`. El piloto con datos reales (G2) requiere autorización explícita y la validación de pendientes críticos (menores, soporte, parámetros offline) registrados en STATE.
