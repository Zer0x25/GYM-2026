# Spec 013 — Integración y E2E obligatorios en CI

Estado: Implementada y verificada localmente — revisión humana y ejecución remota pendientes.
Nivel: Tier 1 — fortalece verificaciones automáticas de cierre; no cambia criterios de producto ni reduce controles.
Autoridad: continuación del usuario del cierre del MVP y la brecha de CI identificada; PROMPT-MAESTRO autoriza implementación y commits locales, revisión humana al cierre. Sin push/despliegue.
Requisitos: CAL-1, REQ-1..REQ-9 y REQ-11 (ejecución de pruebas existentes); arquitectura ADR 0002, offline ADR 0007.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3

## 1. Resultado y límites

CI debe preparar una BD ficticia migrada, exportar TEST_DATABASE_URL y ejecutar el mismo ./scripts/verify.sh sin suites de integración omitidas. Después debe instalar Chromium/dependencias del stack Playwright ya autorizado y ejecutar E2E de producción. Cada fallo obligatorio detiene el flujo. No modificar gate raíz, scripts de gobernanza, umbrales, dependencias ni permisos de GitHub. No afirmar éxito remoto sin publicar/observar una ejecución autorizada.

## 2. Contrato de ejecución y aislamiento

- Usar PostgreSQL de servicio de Actions para integración, DATABASE_URL y TEST_DATABASE_URL dirigidas a esa misma BD ficticia. Worker mínimo/máximo 1 y suites de integración seriales como el perfil existente; no fixture IDs residuales.
- Preparación falla antes de instalar/migrar si TEST_DATABASE_URL no existe. pnpm install --frozen-lockfile, migración con esa URL y gate raíz deben propagar salida no cero.
- E2E conserva runner existente: Compose gym-2026-local, puerto 55432, única BD reseteable gym_e2e, puertos API 3100/web 5174 y secreto aleatorio efímero. No apunta a producción, no importa credenciales locales ni usa datos reales. Service PostgreSQL de integración usa 5432 y no se comparte con el reset E2E.
- Instalar Chromium con pnpm exec playwright install --with-deps chromium; no añadir paquetes npm ni actualizar lockfile. Migración/compilación/E2E secuenciales para evitar competir por dist.
- Runner fijado a ubuntu-24.04 para mantener el entorno Linux documentado/compatible en vez de seguir migraciones de ubuntu-latest. Referencias de implementación: https://playwright.dev/docs/ci-intro y https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md (Docker Compose disponible). No cambia el destino VPS ni el stack de la app.
- Revisión humana por el usuario al cierre; evidencia adicional adversaria sobre variables ausentes y migración fallida. La propia revisión no se presenta como independiente.

## 3. Criterios y verificación

- CA-1: Sin TEST_DATABASE_URL, preparación rechazada antes de instalar/migrar. Con variable, migración usa esa URL; un fallo de migración termina el paso. Verificación adversaria del literal shell del workflow con comandos simulados en directorio temporal.
- CA-2: Workflow conserva ./scripts/verify.sh y exporta todos los workers=1; suites reales con BD migrada pasan sin omitidos. Sin continue-on-error ni condición que vuelva opcionales preparación/gate/E2E.
- CA-3: Instala Chromium antes de pnpm test:e2e; runner completo con build/preview real pasa y devuelve fallos como salida no cero. Pasos secuenciales en un mismo job. La falta de ejecución remota queda documentada hasta push autorizado.
- CA-4: Scope y diff de esta unidad limitados a sus rutas nuevas, registros y documentación; paquete previo 012 permanece intacto. Gate raíz y pruebas técnicas apropiadas verdes; checkpoint/commit local y revisión humana pendiente explícitos.

## 4. Archivos autorizados

- .github/workflows/verify.yml
- PRD.md
- PROMPT-MAESTRO.md
- STATE.md
- apps/api/src/members.integration.test.ts
- apps/api/src/services/cash.ts
- apps/api/src/services/offline.ts
- apps/api/src/services/operations.ts
- apps/api/src/services/payments.ts
- apps/api/src/transbank.integration.test.ts
- apps/web/src/api.ts
- apps/web/src/components/QuickPay.tsx
- apps/web/src/lib/payment-method.ts
- apps/web/src/pages/Cash.tsx
- apps/web/src/pages/MemberDetail.tsx
- apps/web/src/pages/Offline.tsx
- apps/web/src/pages/Payments.tsx
- apps/web/src/pages/Reports.tsx
- apps/web/src/transbank.test.tsx
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0010_payment_comment.sql
- packages/db/drizzle/meta/_journal.json
- packages/db/src/schema.ts
- scripts/coverage.mjs
- specs/012-transbank-manual.md
- specs/013-ci-integracion-e2e.md
- tests/e2e/transbank.spec.ts

## 5. Límite de comparación del lote local

origin/main todavía es eac204f. El commit 6c16597 (012) está verificado y sin publicar; sus rutas se incluyen exclusivamente para que el scope-lock compare el lote pendiente contra origin/main sin omitir el control. Esta unidad solo puede editar .github/workflows/verify.yml, esta spec, STATE.md, docs/learning.md, docs/product/aceptacion-mvp.md y docs/operations/runbook.md. Revisar git diff 6c16597 --name-only para comprobar esa restricción; no se permite alterar implementación/contratos de 012 bajo esta lista heredada. No mover ni falsificar origin/main.

## 6. Experimento temporal y DoD

Ensayo técnico: objetivo comprobar ausencia de variable y propagación de fallo del literal de preparación. Límites: mocks pnpm temporales, sin red/instalación, sin tocar BD/servicios/secretos; comandos se ejecutan con entorno ficticio. Verificación: salida no cero y trazas de invocación esperadas. Limpieza: TemporaryDirectory elimina scripts/trazas al salir. PyYAML instalado se usa solo como herramienta local de inspección, sin dependencia del proyecto/CI ni instalaciones.

Aplica AGENTS §9. Ejecutar gate local con TEST_DATABASE_URL migrada y confirmar E2E actuales (no repetir sin cambios de código/runner salvo que el workflow revele otra condición). No se certifica Actions con una inspección YAML. Commit local autorizado con revisión humana pendiente; sin publicación. Contador sin progreso: 0. Siguiente paso: rojo por TEST_DATABASE_URL ausente en workflow y luego configuración mínima y ensayos adversarios.

## 7. Evidencia y checkpoint

- CA-1: `python3` + PyYAML sobre workflow inicial → AssertionError esperado por TEST_DATABASE_URL ausente. Ensayo del literal con TemporaryDirectory/pnpm simulado → variable ausente: salida no cero, cero invocaciones; migración fallida: salida 31 conservada y URL ficticia correcta; preparación válida: salida 0. Scripts/trazas temporales eliminados al salir.
- CA-2: `python3` extrae y ejecuta literalmente Prepare integration database y Run complete quality gate con URL de BD ficticia nueva gym_test_ci013, CI=true y resto de env del job → salida 0. `./scripts/verify.sh` ejecutado, 157/157 sin omitidos (116 API, 28 web, 8 contracts, 5 db), lint/build/typecheck y scope verdes (/tmp/gym-013-ci-local.log). Migraciones se aplicaron antes de las suites.
- CA-3: YAML parseado: pasos de preparación/gate/instalación Chromium/E2E en orden, sin continue-on-error ni condiciones opcionales; comando Playwright confirmado con CLI local y documentación oficial. `pnpm test:e2e` ya ejecutado sobre exactamente el mismo código/runner 012 → 8/8 (/tmp/gym-012-e2e-final.log); no hubo cambios de aplicación/runner desde esa evidencia. Instalación de paquetes de sistema y ejecución en Actions no se han realizado localmente ni se atribuyen como verificadas.
- CA-4: `git diff 6c16597 --name-only` limitado a seis rutas propias declaradas; implementación 012 intacta, .githooks/gate/lockfile/ADR sin cambios. `git diff --check`, integridad documental y scope-root → salida 0. Matriz/runbook/aprendizaje/checkpoint actualizados. GitHub requiere nuevo push explícito; no se declara CI remota verde de estos cambios.

Commit local de unidad 013 autorizado, identificado por su ID sin segundo commit para registrar hash propio. Revisión humana Tier 1 pendiente, igual que 010/012. Siguiente paso dependiente: respuesta sobre canal de correo y política de ajustes/devoluciones; luego specs de identidad/finanzas. Publicación/staging/G2 siguen sujetos a su autorización. Falta de progreso: 0; no se inventan políticas para continuar.
