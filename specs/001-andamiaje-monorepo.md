# Spec: Andamiaje del monorepo GYM-2026 (apps/web, apps/api, packages/contracts, packages/db)

> Estado: Aprobada
> Nivel: Tier 1 — Riesgo alto; justificación: define la estructura base, contratos compartidos y la plataforma de build/gate sobre la que se apoyan todos los módulos de dinero, reservas y offline; un error aquí contamina cada unidad posterior.
> Requisitos: REQ-1, REQ-9, REQ-10, CAL-1, CAL-3
> ADR aplicables: docs/adr/0002-arquitectura-base.md
> Contexto (Notion): https://app.notion.com/p/3f529b8ebe298146a7eed6cfa0d2f2e1 (G1 · Especificación técnica de implementación MVP v1.0) y https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3 (MVP v1.0 · Cierre final para aprobación)
> Trazabilidad: SPEC:ADR-002 (stack base), SPEC:ADR-003 (Drizzle), SPEC:MVP (alcance MVP), SPEC:MVP-SAUNA-01/B (sauna fuera de v1.0)
> Aceptación: usuario, 2026-10-11, decisión A1 + GYM-WS/A de esta sesión (Modo A enriquecido); commits locales autorizados, sin push.

## 1. Objetivo y alcance

- **Resultado observable:** un monorepo pnpm funcional donde `apps/web` (Vite+React+PWA), `apps/api` (Fastify+Better Auth) y `packages/contracts` + `packages/db` (Drizzle) compilan, pasan typecheck/lint y ejecutan una prueba de humo de extremo a extremo (request Supertest → servicio → schema) con `./scripts/verify.sh` en verde. Incluye configuración del gate de proyecto, CI que ejecute el mismo gate y `.env.example` con nombres ficticios.
- **Incluye:** estructura de carpetas del monorepo; workspace `pnpm-workspace.yaml`; `package.json` raíz con scripts del gate; configs base de TypeScript, Vitest, Supertest, ESLint, Prettier; `packages/contracts` con los primeros esquemas versionados (organización, sesión/auth, miembro, plan) y tipos compartidos; `packages/db` con esquema Drizzle inicial (organización, identidad, miembro, plan, membresía, migración inicial); `apps/api` con arranque Fastify, plugin de contexto tenant, manejo centralizado de errores y verificación de permisos por `tenant+actor+rol+recurso`; `apps/web` con arranque Vite/React, rutas por rol esqueleto y conexión PWA (manifest + service worker mínimo); `scripts/verify-project.sh` con comandos exactos; `.github/workflows/verify.yml` (CI); `.env.example`; runbook de despliegue borrador en `docs/operations/runbook.md`; `docs/api/` con el primer contrato documentado.
- **Excluye:** endpoints de negocio de N/C/P (son unidades posteriores); lógica offline real (candidato IndexedDB y outbox quedan como siguientes unidades; aquí solo el esqueleto de almacenamiento local); despliegue real al VPS (solo runbook + pipeline listo); tablas/endpoints de sauna.
- **Pendientes críticos / supuestos aceptados:** parámetro P-09.3.1b (duración del permiso offline) y cifrado de almacenamiento local quedan `HITO0_PENDING` (ADR-G1-OFF); supuestos aceptados: Node 22, pnpm 9, PostgreSQL 16 en el VPS vía Docker Compose.

## 2. Contratos e invariantes

- **Contratos compartidos:** todos los requests/responses entre web y API se tipan desde `packages/contracts` (esquema versionado, sin lógica de privilegios); cada endpoint documentado en `docs/api/<recurso>.md` con estados y errores.
- **Aislamiento tenant (REQ-1):** el plugin de contexto de `apps/api` resuelve la organización desde la sesión verificada, nunca del cliente; una prueba de humo demuestra rechazo cross-tenant por ID alterado.
- **Errores:** manejo centralizado con códigos estables (validación, no autorizado, no encontrado, conflicto, error interno); respuesta JSON consistente; nunca exponer secretos ni datos de otros tenants en errores.
- **Gate:** `scripts/verify.sh` raíz + `scripts/verify-project.sh` (lint, typecheck, build, unitarias, integración); propagación de errores obligatoria.
- **CI:** GitHub Actions ejecuta `./scripts/verify.sh` en push/PR sobre main (runtime Node 22, pnpm, PostgreSQL de servicio para integración).
- **Secretos:** `.env.example` solo con nombres ficticios; `.gitignore` cubre `.env*` excepto `.env.example`.

## 3. Comportamientos BDD y aceptación

```gherkin
Escenario BDD-1: El gate de proyecto corre en el monorepo recién creado
  Dado el repositorio con el andamiaje de esta spec instalado
  Cuando ejecuto ./scripts/verify.sh
  Entonces lint, typecheck, build, unitarias e integración pasan con salida 0
  Y un fallo simulado en cualquier paso produce salida distinta de 0

Escenario BDD-2: El contrato compartido tipa el request entre web y API
  Dado un esquema en packages/contracts para crear organización
  Cuando la API valida un payload inválido
  Entonces responde 400 con el código de error estable documentado

Escenario BDD-3: Aislamiento tenant verificado en la prueba de humo
  Dado dos organizaciones ficticias A y B con sesiones de distinto rol
  Cuando una sesión de A solicita un recurso de B por ID alterado
  Entonces la API responde no autorizado/no encontrado sin filtrar datos de B
```

| ID | Requisito PRD | Escenario / criterio | Prueba o verificación | Resultado esperado |
|---|---|---|---|---|
| CA-1 | CAL-1 | BDD-1 | Ejecutar `./scripts/verify.sh` | Salida 0; fallo inducido (lint/type/test) → salida ≠ 0 |
| CA-2 | CAL-1 | BDD-1 | CI `.github/workflows/verify.yml` en PR | Job verde ejecutando el mismo gate |
| CA-3 | CAL-3 | BDD-2 | Test de contrato en packages/contracts | Payload inválido rechazado con error estable |
| CA-4 | REQ-1 | BDD-3 | Test de aislamiento en apps/api | Cross-tenant denegado |
| CA-5 | REQ-10 | — | Grep del árbol (`grep -ri sauna apps packages`) | Cero coincidencias en código de v1.0 |
| CA-6 | REQ-9 | Esqueleto offline | Revisión: estructura de outbox prevista en docs sin implementación activa | Documentada como pendiente (HITO0_PENDING), sin endpoints offline activos |
| CA-7 | CAL-1 | `.env.example` | Revisión | Solo nombres ficticios; `.gitignore` cubre `.env*` salvo ejemplo |

## 4. Archivos autorizados

- **Editables:** `pnpm-workspace.yaml`, `package.json` (raíz), `pnpm-lock.yaml`, `.gitignore`, `.env.example`, `tsconfig.base.json`, `eslint.config.*`, `prettier*`, `vitest.workspace.*`, `apps/web/**` (creación), `apps/api/**` (creación), `packages/contracts/**` (creación), `packages/db/**` (creación), `scripts/verify-project.sh` (creación), `.github/workflows/verify.yml` (creación), `docs/api/**` (creación), `docs/operations/runbook.md` (creación), `specs/001-andamiaje-monorepo.md` (esta spec), `STATE.md`, `docs/learning.md`.
- **Protegidos:** `AGENTS.md` (solo añadir sección de comandos del perfil si esta spec lo requiere, sin tocar gobernanza), ADR existentes, `.agents/**` salvo `project-profile.conf` (ya actualizado), `scripts/verify.sh`, `scripts/verify-scope.sh`, `scripts/verify-structure.sh`, `scripts/tests/**` (no debilitar).

## 5. Verificación y DoD

- **DoD común:** AGENTS.md §9; condiciones propias abajo.
- **Comandos y suites de cierre:** `./scripts/verify.sh` (raíz; incluye `scripts/verify-project.sh` en fase `initializing`/`project`).
- **Chequeo rápido de iteración:** `pnpm -r --filter ./packages/... typecheck` / tests focalizados por workspace (no sustituye el gate de cierre).
- **Revisión Tier 1:** revisión humana por el usuario al cierre (riesgo de estructura y gate); el agente no la presenta como independiente.
- **Condiciones adicionales:** pruebas de aislamiento y de error estable deben existir y pasar; cero referencias a sauna; `.env.example` sin secretos reales.

## 6. Cierre y continuidad

- **Evidencia:** salida de `./scripts/verify.sh` con resultados por comando; hash del commit de la unidad.
- **Aprendizaje:** entrada en `docs/learning.md` con hallazgo (p. ej. requisitos de pnpm/Node en el VPS, configuración de Postgres de servicio en CI) o «sin hallazgos nuevos».
- **Commit:** local autorizado por unidad verificada (`feat: andamiaje del monorepo GYM-2026`), sin push.
- **Checkpoint en STATE:** siguiente unidad = «Entrega 1: auth/tenant/roles + socios y permisos» del plan G1.
- **Continuidad:** checkpoint según AGENTS; capacidades opcionales en docs/agent-capabilities.md.
