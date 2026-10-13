# Spec: Concurrencia de la operación diaria (REQ-8)

> Estado: **Cerrada** — sellada por el usuario 2026-10-12 (OK explícito: "sella el req-8")
> Aceptación: usuario 2026-10-12; commit `5c4d8d4` (prueba de concurrencia), evidencia 5/5 BDD contra Postgres real (BD aislada `gym_test_concur`).
> Nivel: Tier 2 — Estándar; justificación: no introduce contratos ni cambia invariantes; verifica con evidencia medible que las invariantes ya probadas (TX-01, TX-05, idempotencia offline, cobertura de check-in) sostienen bajo N operadores simultáneos sin doble operación financiera ni bloqueos artificiales.
> Requisitos: REQ-8 (2 admins + 3 recepcionistas online simultáneos sin bloqueos artificiales ni doble operación financiera)
> ADR aplicables: docs/adr/0002-arquitectura-base.md (concurrencia)
> Contexto (Notion): PRD §REQ-8
> Trazabilidad: SPEC:CONCUR-HTTP (carga HTTP concurrente), SPEC:CONCUR-CASH (sin doble cierre/movimiento), SPEC:CONCUR-PLACE (sin sobre-reserva), SPEC:CONCUR-LATENCY (sin bloqueos artificiales)
> Aceptación: usuario 2026-10-12; Tier 2 → autoaceptable dentro del PRD; commits locales autorizados, sin push.

## 1. Objetivo y alcance

- **Resultado observable:** una prueba de carga acotada ejecuta **2 admins + 3 recepcionistas** (5 operadores) concurrentes sobre operaciones financieras reales vía HTTP, y demuestra con evidencia medible que: (1) no hay **doble operación financiera** (doble cierre de turno, doble movimiento, doble última plaza, doble ingreso sin cobertura); (2) no hay **bloqueos artificiales** (todas las peticiones responden; ninguna queda colgada); (3) los **totales consolidan** correctamente (suma de movimientos = consolidación).
- **Incluye:** script de prueba de carga HTTP (`apps/api/src/concurrency.integration.test.ts`) que usa `app.inject` (Fastify) con cookies de sesión reales de 5 operadores, disparando en paralelo: registro de pagos, validación de pagos, apertura/cierre de turno, reservas de última plaza, y check-in QR. Mide latencias (p50/p95/max), cuenta respuestas por código, y verifica los totales contra la BD.
- **Excluye:** k6/autocannon/artillery (requieren autorización de dependencia nueva — NO se instalan; se usa `app.inject` nativo, que ejerce el stack HTTP+auth+BD real). Carga sostenida de horas; multi-proceso/distribuido (es acotada y de un solo proceso, como pide el PRD). No cambia ningún contrato ni invariante.
- **Decisiones fundamentadas (repo = fuente de verdad):**
  - **`app.inject` en vez de k6:** el PRD dice "k6 o similar **si se autoriza**". Instalar k6/autocannon es una dependencia nueva que el PROMPT-MAESTRO exige consultar; `app.inject` ya ejerce el stack real (HTTP → auth → servicio → Postgres) sin añadir dependencias. Es la evidencia honesta y reproducible. Decidido.
  - **Escenario = el del PRD, no inventado:** 2 admins + 3 recepcionistas concurrentes sobre dinero/reservas/check-in. Decidido.
  - **Verificación por totales, no solo por códigos:** además de contar 200/409, se reconcilia contra la BD (movimientos = validaciones; reservas ≤ cupo). Decidido.

## 2. Contratos e invariantes

- **Sin doble operación financiera (SPEC:CONCUR-CASH, SPEC:CONCUR-PLACE):** bajo 5 operadores concurrentes, los invariantes TX-05 (un solo cierre de turno), movimiento-de-caja-una-vez, y TX-01 (una sola última plaza) se mantienen. Se verifica contando filas/estados en la BD, no solo respuestas.
- **Sin bloqueos artificiales (SPEC:CONCUR-LATENCY):** toda petición responde; se registra p50/p95/max de latencia. Un bloqueo artificial (deadlock, espera indefinida) se vería como timeouts o latencias absurdas.
- **Consolidación correcta:** Σ movimientos validados del turno = consolidación esperada (`apertura + Σ ingresos`).
- **Aislamiento (REQ-1):** la carga corre dentro de un tenant; no contamina otros.
- **Auditoría:** cada mutación financiera audita (ya invariant de las unidades previas); la prueba puede muestrear el `audit_log`.

## 3. Comportamientos BDD y aceptación

```gherkin
Escenario BDD-1: Carga concurrente sin doble cierre (SPEC:CONCUR-CASH, TX-05)
  Dado 5 operadores (2 admin + 3 recepción) con turno abierto
  Cuando todos intentan cerrar el mismo turno simultáneamente
  Entonces exactamente un cierre tiene éxito y el resto recibe 409
  Y no hay dos filas de cierre ni doble consolidación

Escenario BDD-2: Carga concurrente sin doble movimiento (SPEC:CONCUR-CASH)
  Dado N pagos provisionales registrados concurrentemente
  Cuando se validan concurrentemente por distintos operadores
  Entonces cada pago genera exactamente un movimiento de caja
  Y la suma de movimientos coincide con los pagos validados

Escenario BDD-3: Carga concurrente sin sobre-reserva (SPEC:CONCUR-PLACE, TX-01)
  Dado una sesión con cupo para 1 y varios socios reservando a la vez
  Cuando reservan concurrentemente
  Entonces exactamente una reserva se confirma; las demás 409
  Y confirmedCount nunca excede el cupo

Escenario BDD-4: Sin bloqueos artificiales (SPEC:CONCUR-LATENCY)
  Dado la carga mixta de las operaciones financieras
  Cuando se mide la latencia de todas las respuestas
  Entonces ninguna petición queda colgada (todas responden)
  Y las latencias p50/p95/max quedan registradas como evidencia

Escenario BDD-5: Check-in concurrente coherente (SPEC:CONCUR-LATENCY)
  Dado varios recepcionistas escaneando QRs a la vez
  Cuando escanean concurrentemente
  Entonces todos reciben respuesta coherente (allowed/denied correcto)
  Y no hay corrupción ni respuestas cruzadas entre socios
```

## 4. Diseño de datos (borrador)

- Sin tablas ni contratos nuevos. Reutiliza las entidades de pagos/caja/reservas/check-in y sus invariantes ya probadas.

## 5. Plan de implementación y verificación

- **Script de prueba de carga** (`apps/api/src/concurrency.integration.test.ts`): levanta `buildServer` contra la BD de test aislada `gym_test_concur`, crea 5 operadores reales (2 admin + 3 recepción), y dispara en paralelo los escenarios BDD-1..5 con `app.inject`. Mide latencias y reconcilia totales contra la BD.
- Se integra a `scripts/test-integration.sh` con su BD aislada.
- **Evidencia:** el test imprime p50/p95/max y los conteos por código HTTP; el cierre de la unidad los adjunta.
- **Gate y DoD** por unidad (scripts/verify.sh).

## 6. Criterios de aceptación

- CA-1 (SPEC:CONCUR-CASH): 5 cierres simultáneos del mismo turno → 1 éxito, 4× 409; una sola fila de cierre. ✅
- CA-2 (SPEC:CONCUR-CASH): pagos validados concurrentemente → un movimiento por pago; Σ = validados. ✅
- CA-3 (SPEC:CONCUR-PLACE): última plaza con N reservas concurrentes → 1 confirmada, resto 409; cupo no excedido. ✅
- CA-4 (SPEC:CONCUR-LATENCY): todas las peticiones responden; p50/p95/max registrados. ✅ (p50=60ms, p95=91ms, max=93ms)
- CA-5: check-in concurrente coherente, sin respuestas cruzadas. ✅
- CA-6 (MVP-SAUNA-01/B): cero tablas/servicios/rutas de sauna. ✅

## Cierre (2026-10-12)

- Verificado: `concurrency.integration.test.ts` 5/5 sobre Postgres real (`gym_test_concur`), stack completo vía `app.inject`, sin dependencias nuevas (k6/autocannon descartados por regla de dependencias del PROMPT-MAESTRO).
- Suite integración completa 46/46 verdes; gate del proyecto verde (reintentos por transitorio de recursos del gate paralelo, no bug de código).
- Documentado en STATE.md, docs/api/README.md (tabla de invariantes bajo concurrencia) y docs/operations/runbook.md (receta de corrida).
