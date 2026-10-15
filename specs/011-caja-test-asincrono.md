# Spec 011 — Espera del estado de Caja en el smoke test

Estado: Cerrada — verificada localmente; commit de esta unidad y publicación según checkpoint.
Nivel: Tier 3 — corrección de sincronización del test; conserva la expectativa de caja abierta, contratos financieros y controles del gate.
Autoridad: reporte del usuario «dio rojo» (2026-10-14), continuidad de la publicación solicitada y delegación de correcciones/commits de PROMPT-MAESTRO. Se usa spec breve en lugar de registro ligero porque verify-scope.sh localiza la unidad activa mediante specs; no se modifica ese control.
Fuente: criterios 5 y 8 de spec 010 y Cash.tsx: título inmediato, estado del turno tras cargar sesión y movimientos. Corrección técnica de verificación, sin cambios de producto ni ADR.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981fab0c2fa583efcdf15

## 1. Resultado y límites

Eliminar la carrera de shell.test.tsx: conservar la comprobación de «Abierto» y esperar su aparición. No modificar código productivo, dependencias, CI ni gate; no sellar la revisión humana pendiente de 010.

## 2. Contrato de verificación

Controlar la resolución de getCashSession con una promesa diferida, sin sleeps ni timeouts ampliados. Restauración: resolución explícita y limpieza de mocks por el fixture existente.

## 3. Criterios

- CA-1: Dada una caja abierta cuya respuesta de movimientos está pendiente, cuando aparece el título, entonces todavía no aparece «Abierto»; tras resolver la respuesta, el test espera y verifica «Abierto».
- CA-2: La suite web y el gate raíz completo con integración real pasan conservando todas las expectativas y controles existentes; diff limitado a las rutas autorizadas.

## 4. Archivos autorizados

- specs/011-caja-test-asincrono.md
- STATE.md
- docs/learning.md
- apps/web/src/shell.test.tsx

## 5. DoD y checkpoint

Aplica AGENTS §9. Commit de corrección autorizado por delegación, identificado por ID 011 sin segundo commit para anotar su propio hash; publicación como continuación del push solicitado. Falta de progreso: 0. Siguiente paso operativo: comprobar CI del commit corregido; revisión humana de 010 sigue pendiente.

## 6. Evidencia

- Diagnóstico: GitHub Actions 38661089570 falla en shell.test.tsx:257, «Unable to find an element with the text: Abierto»; 25/26 tests web pasan. El mismo fallo ocurrió antes del push local y pasó por temporización en la repetición.
- CA-1: `pnpm --filter @gym/web exec vitest run src/shell.test.tsx -t 'renders the cash page at /cash'` con respuesta diferida y lectura inmediata → salida 1, mismo error de «Abierto» (rojo reproducible, /tmp/gym-011-red.log). Tras resolver la respuesta y usar findByText: `pnpm --filter @gym/web test` → salida 0, 26/26 tests (sin omitidos, /tmp/gym-011-web.log), incluida ausencia durante carga y estado final esperado.
- CA-2: `TEST_DATABASE_URL=<BD ficticia gym_test_gate> VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 VITEST_MAX_THREADS=1 VITEST_MIN_THREADS=1 ./scripts/verify.sh` → salida 0, 148/148 pruebas reales sin omitidos (111 API, 26 web, 6 contracts, 5 db); lint/build/typecheck y contrato del gate verdes (/tmp/gym-011-gate-final.log). `git diff --check` → salida 0; `bash scripts/verify-scope.sh` → alcance 011 válido. Diff revisado: solo test y registros autorizados; ninguna expectativa eliminada, sin cambios de producto/CI/dependencias.
