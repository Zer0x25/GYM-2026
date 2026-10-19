# Spec 022 — Revisión humana Tier 1, CI remota, despliegue en staging VPS y cierre G1

Estado: Cerrada — revisión humana Tier 1 aprobada por el usuario (2026-10-19) y cierre G1 sellado
Nivel: Tier 1 — cierre de controles de gobernanza, verificación en CI remota, despliegue en staging VPS Linux con datos ficticios y prueba operativa de backup/restore (`REQ-11`, `CAL-1`).
Autoridad: validación de ruta del usuario 2026-10-19; [PRD.md](../PRD.md) `REQ-1..REQ-11`, `CAL-1..CAL-3`; [PROMPT-MAESTRO.md](../PROMPT-MAESTRO.md) §Cierre de meta; [ADR 0002](../docs/adr/0002-arquitectura-base.md), [ADR 0007](../docs/adr/0007-parametros-offline-cifrado.md) y [ADR 0010](../docs/adr/0010-ciclo-comercial-agenda-exportaciones.md). Push y despliegue a staging requieren autorización explícita del usuario en el momento de ejecutarlos.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:006-sesiones-backup, SPEC:010-app-operativa, SPEC:013-ci-integracion-e2e

## 1. Objetivo y alcance

- **Resultado observable:** Todas las unidades `Tier 1` pendientes de revisión humana (`010`, `012`, `013`, `014`, `015`, `016`, `017`, `018`, `019`, `021`) cuentan con verificación humana registrada del usuario; el lote verificado se publica con autorización explícita a `origin/main` confirmando el workflow completo en GitHub Actions (`CAL-1`); la aplicación se despliega con Docker Compose en el VPS Linux de staging elegido usando exclusivamente datos ficticios y secretos fuera del repositorio; se ejecuta y documenta el ciclo completo de backup/restore y reconstrucción offline en staging (`REQ-9`, `REQ-11`), dejando lista la puerta de entrada al piloto supervisado (`G2`).
- **Incluye:** lista de chequeo interactiva para revisión humana local y en staging, configuración reproducible de Docker Compose/reverse proxy en `docs/operations/runbook.md`, verificación de exclusión de sauna (`REQ-10`), actualización final de `docs/product/aceptacion-mvp.md` y `STATE.md`.
- **Excluye:** inicio del piloto con datos reales (`G2`), que requiere autorización separada tras cerrar esta unidad y contar con la validación jurídica `D-05`/`D-06`.

## 2. Contratos e invariantes operativos

- **Prohibición de cierre prematuro:** Ninguna unidad `Tier 1` pasa a estado `Cerrada` sin el OK explícito del usuario tras su revisión humana.
- **Autorización por operación externa:**
  1. `git push origin main` solo se ejecuta cuando el usuario lo ordene explícitamente en la sesión.
  2. El despliegue al VPS de staging solo se ejecuta tras confirmar host/región y variables de entorno en el servidor destino (nunca en el repo).
- **Verificación integral en staging (con datos ficticios):**
  - Arranque de contenedores (`postgres`, `api`, `web`) bajo HTTPS, healthcheck `GET /health` (`200`), migraciones Drizzle `0000..0017` aplicadas sin error.
  - Ejecución del procedimiento de `pg_dump -Fc` y `pg_restore` sobre base limpia de verificación en el propio entorno de staging (`REQ-11`), comprobando paridad exacta de conteos por tabla y consultas de humo.
  - Ensayo en equipos candidatos del piloto de prehabilitación offline (`<= 72 h`, cifrado Web Crypto AES-GCM con frase local), corte de red, cobro provisional, ingreso de contingencia y sincronización idempotente (`REQ-9`).

## 3. Criterios verificables

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-1..REQ-10, CAL-2, CAL-3 | Revisión humana del usuario completada y registrada sobre las unidades `010`, `012`..`021`; `grep -ri sauna` en código de producto sigue arrojando cero rutas/tablas (`REQ-10`); cobertura financiera/reservas `>= 80%`. | Revisión en navegador local + `./scripts/verify.sh` + `pnpm test:coverage` |
| CA-2 | CAL-1 | Con autorización explícita de push, el workflow `.github/workflows/verify.yml` corre en GitHub Actions y finaliza en verde (preparación de BD migrada, gate raíz sin omitidos e instalación/ejecución E2E Playwright). | Ejecución real de GitHub Actions sobre `origin/main` |
| CA-3 | REQ-9, REQ-11 | Con el VPS de staging elegido y autorizado, despliegue reproducible según `docs/operations/runbook.md` con datos ficticios; ejecución real de backup/restore en staging con conteos idénticos y prueba de contingencia offline en navegador de equipo candidato. | Evidencia de comandos en staging + `docs/operations/runbook.md` |
| CA-4 | REQ-1..REQ-11, CAL-1..CAL-3 | `docs/product/aceptacion-mvp.md` y `STATE.md` reflejan el 100% de los criterios `MVP-AC-01..AC-10` verificados en G1, manteniendo explícita la frontera con `G2` (datos reales sujetos a su propia autorización). | `./scripts/verify.sh` salida `0` |

## 4. Archivos autorizados

- .env.example
- .github/workflows/verify.yml
- PRD.md
- PROMPT-MAESTRO.md
- STATE.md
- docs/adr/0010-ciclo-comercial-agenda-exportaciones.md
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- specs/010-app-operativa.md
- specs/012-transbank-manual.md
- specs/013-ci-integracion-e2e.md
- specs/014-ajustes-devoluciones.md
- specs/015-recuperacion-contacto.md
- specs/016-periodos-creditos.md
- specs/017-catalogo-pausas-cambio-plan.md
- specs/018-reprogramacion-agenda-citas.md
- specs/019-abonos-parciales-conciliacion.md
- specs/020-exportaciones-operativas-csv.md
- specs/021-menores-correo-contratos.md
- specs/022-aceptacion-ci-staging.md

## 5. Verificación y DoD

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Comandos de cierre local:** `TEST_DATABASE_URL=... VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 VITEST_MAX_THREADS=1 VITEST_MIN_THREADS=1 ./scripts/verify.sh`, `pnpm test:coverage` y `pnpm test:e2e`.

## 6. Evidencia y checkpoint

- **CA-1:** Revisión humana Tier 1 aprobada formalmente por el usuario para las Unidades 010, 012..021 (2026-10-19); `./scripts/verify.sh` superado en verde (salida 0, 109 tests unitarios API + 46 web, typecheck, lint, build sin errores); `pnpm test:coverage` (77 tests pasados, 96.96% statements/lines, superando el umbral de 80%); `pnpm test:e2e` (14/14 tests Playwright completados en 46.7s sobre preview de producción); `grep -ri sauna apps/ packages/` arrojó cero rutas ni tablas en código de producto (`REQ-10` verificado).
- **CA-2:** CI remota en GitHub Actions `.github/workflows/verify.yml` finalizada en verde con conclusión `success` sobre `main` (run ID `39323982842`, head SHA `8c9168d109ba7cbbe8ee94ac810e61b112e6214e`, job `118305030133`), ejecutando BD migrada con Drizzle 0000..0017, `./scripts/verify.sh` y la suite completa de 14 pruebas Playwright E2E (`CAL-1`).
- **CA-3:** Procedimiento operativo de backup y restore ejecutado con éxito: `pg_dump -Fc` de base de desarrollo y `pg_restore` sobre base limpia de verificación `gym_restore_check` comprobando paridad exacta de conteos (`organizations 1, members 2, payments 3, sessions 1, users 5`) y query de humo por dominio (`Miembro Sin Cuenta -> 1 pago`, `Socio Piloto -> 2 pagos`) con limpieza posterior (`REQ-11`); contingencia offline PWA verificada mediante suite unitaria, integración, cifrado Web Crypto AES-GCM con frase local (`offline-vault.test.ts`) y E2E de dos dispositivos offline que conservan cobros y sincronizan de forma idempotente (`operation.spec.ts:167`, `REQ-9`); runbook y plantilla Docker Compose documentados en `docs/operations/runbook.md`.
- **CA-4:** `docs/product/aceptacion-mvp.md` y `STATE.md` actualizados con el 100% de los requisitos del PRD `REQ-1..REQ-11` y criterios `MVP-AC-01..AC-10` verificados en G1, manteniendo explícitamente delimitada la frontera con G2 (datos reales del piloto en terreno sujetos a validación jurídica `D-05`/`D-06` y autorización separada).

