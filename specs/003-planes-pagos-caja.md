# Spec: Planes, membresías y pagos manuales con validación (Entrega 2)

> Estado: Aprobada
> Nivel: Tier 1 — Riesgo alto; justificación: introduce dinero (cobros, validación, caja) y derechos de acceso derivados del estado de pagos; un error aquí concede o niega acceso indebido y compromete la integridad financiera del piloto.
> Requisitos: REQ-2 (alta de socio → plan → cobro con referencia → validación humana → derechos), REQ-3 (caja por turno, conciliación, TX-05: dos cierres simultáneos → uno rechazado; movimiento validado no sobrescribible)
> ADR aplicables: docs/adr/0002-arquitectura-base.md
> Contexto (Notion): https://app.notion.com/p/3f529b8ebe298146a7eed6cfa0d2f2e1 (G1 · Especificación técnica MVP v1.0, §5 «Planes y pagos» y §7 «Caja»)
> Trazabilidad: SPEC:PAY-01 (pago registrado NO concede cobertura hasta validación humana), SPEC:PAY-02 (separación registro/validación), SPEC:D-03/B (ajustes auditados), SPEC:TX-05 (cierre de caja idempotente)
> Aceptación: usuario, 2026-10-12; Tier 1 → cierre pendiente de revisión humana; commits locales autorizados, sin push.

## 1. Objetivo y alcance

- **Resultado observable:** el staff define planes configurables (precio, duración, cobertura, períodos); un socio puede inscribirse en un plan y el recepcionista registra un cobro manual con referencia; el cobro **queda provisional** hasta que un admin lo valida; solo entonces se confirman derechos. La caja registra movimientos por turno con cierre no sobrescribible y conciliación diaria. Un socio con pago validado vigente aparece con membresía activa; con pago provisional o vencido, no.
- **Incluye:**
  - Planes (admin): CRUD con `nombre`, `precio`, `duraciónDias`, `cobertura` (qué permite: reservas grupales/personalizadas), `activo`. Alcance por tenant.
  - Membresías de socio (admin/recepción): asignar plan a un miembro → crea membresía `pendiente_pago` con `inicioVigencia`.
  - Pagos manuales (admin/recepción): registrar cobro con `monto`, `método` (efectivo | transferencia), `referencia` (obligatoria en transferencia), opcional `comprobante` (fuera de alcance v1.0: solo campo texto). Estado inicial: `provisional`.
  - Validación de pago (admin, rol distinto del que registró — separación de funciones): `provisional` → `validado` | `rechazado` con `motivo`. **Un pago validado no es sobrescribible** (inmutabilidad, D-03/B).
  - Derechos: una membresía con al menos un pago validado vigente (dentro del período) tiene estado `activa`; con pago provisional o rechazado, `pendiente_pago`; vencida la fecha → `vencida`. Los derechos se derivan del estado de pagos — nunca de un campo booleano manual.
  - Caja (admin/recepción): cada pago validado genera un movimiento de caja (ingreso). Movimientos inmutables una vez validados. Turno: apertura/cierre por usuario con `montoApertura`, `montoCierre` (calculado) y `estado`. Dos cierres simultáneos del mismo turno → uno rechazado (TX-05). Consolidación diaria: suma por método con desglose.
  - Auditoría: tabla `audit_log` (actor, acción, entidad, entidad_id, timestamp, organización) para toda operación financiera (registro, validación, rechazo, cierre de turno).
  - API REST con contratos Zod en `packages/contracts`; servicios en `apps/api/src/services/`; tests de integración contra Postgres real.
- **Excluye:** pagos integrados/Transbank API (futuro); comprobantes/imágenes de transferencia (campo texto de referencia únicamente); facturación (CM-01 diferida); reembolsos/devoluciones (decisión futura; solo ajustes con motivo auditable); sauna (MVP-SAUNA-01/B); UI (se hace después, en la pasada de diseño); reservas/clases (Entrega 3).
- **Pendientes críticos / supuestos aceptados:** supuesto: la separación registro/validación se cumple por rol (admin valida, recepción/admin registran — un admin puede hacer ambas cosas en esta entrega; la restricción estricta «otra persona» queda anotada como evolución); supuesto: montos en CLP enteros (sin decimales); pendiente: política de ajustes/anulaciones (D-03/B requiere ADR propio antes del piloto).

## 2. Contratos e invariantes

- **Dinero (REQ-2, TX-03):** el estado de un pago solo avanza `provisional → validado | rechazado`. Validado y rechazado son **terminales** — no existen transiciones de salida. Un pago validado no puede modificarse (inmutabilidad): correcciones solo por movimiento de ajuste auditable, nunca por update del pago.
- **Separación de funciones (SPEC:PAY-02):** `POST /payments/:id/validate` requiere rol `admin`. Un usuario no puede validar un pago que él mismo registró (mismo `actorId`) → 403 `FORBIDDEN`. Nota: en esta entrega el chequeo de mismo actor se aplica; si el piloto requiere distinta persona, se endurece por configuración.
- **Derechos derivados (REQ-2):** el estado de membresía se calcula desde los pagos, no se almacena editable: `activa` si ∃ pago validado con `fechaValidacion` dentro del período `[inicioVigencia, inicioVigencia + duraciónDias)`; `pendiente_pago` si no hay pago validado vigente pero la membresía existe; `vencida` si la fecha de fin ya pasó. Renovación = nuevo pago validado sobre la misma membresía (o nueva membresía — decisión de implementación documentada: **renovación por nuevo pago que extiende el período**).
- **Caja (REQ-3, TX-05):** movimiento de caja se crea **solo** cuando un pago pasa a `validado` (nunca en provisional — dinero no confirmado no entra a caja). Movimiento inmutable. Cierre de turno: transacción con lock (SELECT ... FOR UPDATE o equivalente transaccional) que verifica `estado = abierto`; dos cierres simultáneos → el segundo recibe 409 `CONFLICT`. El `montoCierre` esperado se calcula como `montoApertura + Σ ingresos del turno`; la diferencia contra lo declarado se registra como `descuadre` (no bloquea, se audita).
- **Aislamiento (REQ-1, TX-07):** todo query filtra por `organizationId` de la sesión; ningún ID de plan/pago/movimiento se acepta del cliente para escritura cruzada. Un pago de la org A es inalcanzable desde la org B (404, no 403, para no filtrar existencia).
- **Concurrencia (REQ-8):** dos admins registrando pagos simultáneos no generan duplicados de movimiento de caja (el movimiento se crea una única vez por pago, en la misma transacción de validación).
- **Montos:** CLP, enteros, ≥ 0. `monto` del pago debe coincidir con `precio` del plan (advertencia si difiere, no bloqueo — descuentos se autorizan; quedan registrados).
- **Errores:** códigos estables: `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409 (cierre duplicado, transición inválida), `INTERNAL_ERROR` 500.
- **Auditoría:** `audit_log` con `actorId`, `actorRole`, `accion`, `entidad`, `entidadId`, `organizationId`, `timestamp`, `metadata` (JSON: monto, motivo). Toda mutación financiera escribe auditoría en la misma transacción.

## 3. Comportamientos BDD y aceptación

```gherkin
Escenario BDD-1: Pago registrado NO concede cobertura hasta validación (REQ-2)
  Dado una membresía "pendiente_pago" del socio S1 en la organización A
  Cuando recepción registra un pago provisional de $30.000 por transferencia con referencia "TRX-123"
  Entonces el pago queda en estado "provisional"
  Y la membresía de S1 sigue "pendiente_pago" (sin derechos)
  Y NO se crea movimiento de caja

Escenario BDD-2: Validación por admin confirma derechos y crea movimiento de caja
  Dado el pago provisional del escenario anterior
  Cuando un admin (distinto del registrador) valida el pago
  Entonces el pago queda "validado" (inmutable)
  Y la membresía de S1 pasa a "activa" con vigencia calculada
  Y se crea un movimiento de caja (ingreso, transferencia, $30.000)
  Y audit_log registra la validación con actor y timestamp

Escenario BDD-3: Recepción no puede validar pagos; admin no valida su propio registro
  Dado una sesión de recepción y un pago provisional
  Cuando recepción intenta POST /payments/:id/validate
  Entonces responde 403 FORBIDDEN
  Y dado un pago provisional registrado por el admin X
  Cuando X intenta validarlo
  Entonces responde 403 FORBIDDEN (separación de funciones)

Escenario BDD-4: Pago validado es inmutable
  Dado un pago en estado "validado"
  Cuando se intenta modificarlo por cualquier vía
  Entonces responde 409 CONFLICT
  Y el registro original permanece intacto en la base

Escenario BDD-5: Cierre de turno idempotente bajo concurrencia (TX-05, REQ-3)
  Dado un turno abierto con 2 ingresos validados ($30.000 + $25.000)
  Cuando dos peticiones simultáneas cierran el mismo turno
  Entonces una responde 200 con montoCierre calculado ($55.000 + apertura)
  Y la otra responde 409 CONFLICT
  Y el turno queda cerrado una sola vez

Escenario BDD-6: Aislamiento de datos financieros entre organizaciones
  Dado una sesión de admin de la organización A
  Cuando consulta pagos/movimientos con un ID de la organización B
  Entonces responde 404 (sin filtrar existencia)
  Y la consolidación diaria de A nunca incluye montos de B

Escenario BDD-7: Renovación extiende vigencia
  Dado una membresía activa que vence en 5 días
  Cuando se registra y valida un nuevo pago del plan
  Entonces la vigencia se extiende desde la fecha de fin anterior
  Y la membresía permanece "activa" sin lapsos
```

| ID | Requisito PRD | Escenario / criterio | Prueba o verificación | Resultado esperado |
|---|---|---|---|---|
| CA-1 | REQ-2 | BDD-1 | test integración: registro provisional → membresía pendiente_pago, sin movimiento de caja | membresía sin derechos; caja sin ingreso |
| CA-2 | REQ-2 | BDD-2 | test integración: validación → validado + membresía activa + movimiento | estados correctos; movimiento creado una vez |
| CA-3 | REQ-2 | BDD-3 | test integración: recepción valida → 403; admin valida propio → 403 | ambos rechazados |
| CA-4 | REQ-2 | BDD-4 | test integración: update sobre validado → 409 | registro intacto |
| CA-5 | REQ-3 | BDD-5 | test concurrencia: dos cierres simultáneos | 200 + 409; turno cerrado una vez |
| CA-6 | REQ-1 | BDD-6 | test aislamiento: ID de org B → 404 | sin fuga de datos |
| CA-7 | REQ-2 | BDD-7 | test integración: renovación → vigencia extendida | sin lapsos de cobertura |
| CA-8 | REQ-3 | Auditoría | test integración: cada mutación financiera escribe audit_log | registro con actor/acción/metadata |
| CA-9 | REQ-10 | Exclusión sauna | grep del árbol | cero tablas/rutas de sauna |

## 4. Archivos autorizados

- **Editables:**
  - `specs/003-planes-pagos-caja.md` (esta spec)
  - `STATE.md`
  - `docs/learning.md`
  - `packages/contracts/src/index.ts` (nuevos esquemas: Plan, Membership, Payment, CashMovement, CashSession, AuditLog)
  - `packages/db/src/schema.ts` (nuevas tablas: plans, memberships, payments, cash_movements, cash_sessions, audit_log)
  - `packages/db/drizzle/**` (migraciones generadas)
  - `apps/api/src/services/payments.ts`, `apps/api/src/services/cash.ts`, `apps/api/src/services/plans.ts`, `apps/api/src/services/audit.ts` (nuevos)
  - `apps/api/src/app.ts` (rutas nuevas)
  - `apps/api/src/services/*.test.ts` y `apps/api/src/payments.integration.test.ts`, `apps/api/src/cash.integration.test.ts` (nuevos tests)
  - `docs/api/README.md` (contratos documentados)
- **Protegidos:** `apps/web/**` (la UI se toca en la unidad de diseño posterior, no aquí); `apps/api/src/auth.ts`, `apps/api/src/session.ts`, `apps/api/src/services/members.ts`, `apps/api/src/resolve-session.ts` (lógica de sesión ya verificada — solo lectura).

## 5. Verificación y DoD

- **DoD común:** AGENTS.md; TDD para comportamiento financiero; comandos exactos de cierre.
- **Comandos y suites de cierre:**
  - `./scripts/verify.sh` (gate completo: lint, typecheck, build, tests) — debe salir 0.
  - `TEST_DATABASE_URL=postgres://gym:gym-local-dev@localhost:55432/gym_test pnpm --filter @gym/api test` (integración con Postgres real).
  - Cobertura en módulos de dinero ≥ 80% (CAL-2): `pnpm --filter @gym/api test -- --coverage` con reporte adjunto.
- **Chequeo rápido de iteración:** `pnpm --filter @gym/api test` (unitarias) tras cada cambio.
- **Revisión Tier 1:** pendiente de revisión humana del usuario antes de cerrar (igual que la 002): el usuario valida los flujos de dinero vía API/tests antes de que se construya UI encima.
- **Condiciones adicionales:**
  - CA-9: `grep -ri sauna packages/db/src apps/api/src` → 0 coincidencias.
  - Idempotencia verificada en TX-05 (test de concurrencia explícito).
  - Ningún secreto en el repo; `.env.example` actualizado si se agregan variables.

## 6. Cierre y continuidad

- **Evidencia:** [completar al cierre — comandos y resultados reales; los tests de concurrencia y dinero son la evidencia central]
- **Aprendizaje:** [completar al cierre — hallazgo con evidencia en docs/learning.md o sin hallazgos nuevos]
- **Commit:** local sin push, mensaje `feat(api): planes, membresías, pagos con validación y caja`; commit requerido para cierre.
- **Checkpoint en STATE:** cobertura del PRD (REQ-2, REQ-3 completos para backend; REQ-4/5/6 pendientes Entrega 3), siguiente paso (UI de la Entrega 2 con el design system del ADR-0003) y bloqueos con contador.
- **Continuidad:** capacidades opcionales en docs/agent-capabilities.md; offline (REQ-9) sigue pendiente de parámetros P-09.3.1b.
