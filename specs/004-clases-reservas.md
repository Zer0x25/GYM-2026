# Spec: Clases grupales y personalizadas, agenda de instructor y reservas (Entrega 3)

> Estado: Cerrada — implementada, verificada y sellada por el usuario
> Nivel: Tier 1 — Riesgo alto; justificación: introduce concurrencia sobre un recurso escaso (última plaza) y compromiso de beneficio de socio con revalidación de cobertura; un error aquí sobre-reserva plazas, consume beneficios de más, o permite solapes de agenda que rompen la operación del gimnasio.
> Requisitos: REQ-4 (clases grupales configurables: cupo, última plaza bajo concurrencia, beneficio comprometido una sola vez), REQ-5 (cancelaciones temprana/tardía/gimnasio, ausencia y revalidación de cobertura), REQ-6 (personalizadas fijas + citas, agenda unificada de instructor sin solapes)
> ADR aplicables: docs/adr/0002-arquitectura-base.md
> Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981fab0c2fa583efcdf15 (PRD §C «Clases y reservas»; decisión P-RES-02/Ambas)
> Trazabilidad: SPEC:TX-01 (última plaza bajo concurrencia), SPEC:TX-02 (sin solapes de agenda), SPEC:TX-04 (liberación de plaza y crédito exactamente una vez), SPEC:REVAL-01 (revalidación de cobertura a la fecha de sesión)
> Aceptación: usuario, 2026-10-12, revisión humana Tier 1 (OK del usuario). Backend (`1aa5fc8`) + UI (`0db3e41`) verificados; invariantes TX-01/TX-02/TX-04/REVAL-01/TX-07 contra Postgres real. Commits locales autorizados, sin push.

## 1. Objetivo y alcance

- **Resultado observable:** el staff define clases grupales (cupo, ventana y política de cancelación configurables) y personalizadas en ambas modalidades (sesiones fijas publicadas + citas por agenda individual de instructor, P-RES-02/Ambas); la agenda de cada instructor está unificada y sin solapes; un socio con membresía activa reserva plaza/cita con beneficio comprometido una sola vez; la cancelación libera la plaza y devuelve o retiene el crédito exactamente una vez según la política (temprana/tardía/gimnasio/ausencia).
- **Incluye:**
  - **Clases grupales (admin):** CRUD de plantilla (nombre, cupo, ventana de reserva, política de cancelación en horas, cobertura requerida) y de **sesiones** (fecha/hora, instructor asignado, estado). Alcance por tenant.
  - **Personalizadas (admin/instructor):** sesiones **fijas** publicadas (recurrentes) + **citas** por agenda individual del instructor. Ambas modalidades (P-RES-02/Ambas).
  - **Agenda unificada de instructor (instructor/admin):** vista que consolida grupales, fijas, citas y **bloqueos** (indisponibilidad) del instructor. Sin solapes entre sí (TX-02).
  - **Reservas (socio/recepción/admin):** reserva firme de socio con membresía activa; **compromiso de beneficio una sola vez** (REQ-4). Revalidación de cobertura a la fecha de la sesión (SPEC:REVAL-01).
  - **Cancelaciones (REQ-5):** política temprana (devuelve crédito) / tardía (retiene) / por gimnasio (siempre devuelve) / ausencia (retiene y registra). Liberación de plaza y movimiento de crédito **exactamente una vez** (TX-04).
  - **Asistencia (instructor/recepción):** marcar asistencia/ausencia de la sesión (base para REQ-5 y para el QR de ingreso de la Entrega 5).
  - **Auditoría:** toda mutación de reserva/cancelación/asistencia en `audit_log`, en la misma transacción.
  - **API REST con contratos Zod** en `packages/contracts`; servicios en `apps/api/src/services/`; tests de integración contra Postgres real.
- **Excluye:** reserva de sauna (MVP-SAUNA-01/B, fuera de v1.0); reserva firme offline (v1.1, P-09.3); pagos por clase suelta (dinero ya cubierto por Entrega 2; aquí solo se compromete beneficio de membresía); notificaciones SMS/WhatsApp; listas de espera con orden garantizado (v1.1 salvo que el piloto lo pida); apps nativas; QR de ingreso físico (Entrega 5).
- **Decisiones fundamentadas en el PRD (repo = fuente de verdad):**
  - **Modalidad personalizada "Ambas"** (P-RES-02, PRD §C y REQ-6): sesiones fijas publicadas + citas por agenda individual de instructor. Decidido.
  - **Beneficio comprometido una sola vez** (REQ-4) y **crédito movido exactamente una vez** (TX-04): invariantes con test. Decidido.
  - **Ventana de reserva y cancelación configurables** por plantilla (PRD §C). Decidido.
  - **Beneficio = acceso derivado de la membresía activa** (PRD: "beneficios confirmados", "revalidación de cobertura"): la membresía activa es lo que habilita reservar; el campo `coverage` del plan (Entrega 2) define qué clases cubre. Decisión de implementación: en v1.0 el beneficio es el acceso que otorga la membresía vigente — **no** se modelan paquetes de "N clases" compradas (no existen en el PRD ni en la Entrega 2; si el piloto los pide, es extensión documentada, no un supuesto).
  - **Política de ausencia (v1.0):** la ausencia retiene el beneficio consumido y queda registrada; el sistema **no** acumula strikes ni bloquea reservas por ausencias (el PRD menciona "ausencia" como tipo de cancelación, no define penalización acumulada). Decisión de implementación conservadora: registrar y retener; cualquier acumulación de sanciones es evolución futura.

## 2. Contratos e invariantes

- **Última plaza bajo concurrencia (REQ-4, TX-01):** dos socios reservando la última plaza simultáneamente → **una confirma, la otra recibe rechazo claro (409 `CONFLICT`) sin consumir beneficio**. Implementación: transacción con lock sobre la fila de sesión (`SELECT ... FOR UPDATE`) que re-chequea `reservasConfirmadas < cupo` antes de insertar; el unique `(sesionId, socioId)` impide doble reserva del mismo socio.
- **Beneficio comprometido una sola vez (REQ-4):** una reserva confirmada compromete el beneficio exactamente una vez. Cancelar y volver a reservar la misma sesión no duplica el compromiso. La revalidación de cobertura ocurre **al confirmar la reserva y a la fecha de la sesión** (SPEC:REVAL-01): si la membresía dejó de estar activa para la fecha, la reserva se rechaza o se marca para revisión, según política.
- **Agenda sin solapes (REQ-6, TX-02):** ningún instructor puede tener dos compromisos que se solapen en el tiempo (grupal + fija + cita + bloqueo). Implementación: constraint de exclusión o chequeo transaccional `EXISTS (solape)` antes de insertar/actualizar sesión o bloqueo → 409 si hay solape real. Los bloqueos tienen prioridad (bloqueo gana sobre cita por confirmar).
- **Cancelación y crédito una sola vez (REQ-5, TX-04):** la transición de estado de una reserva es terminal por operación: `confirmada → cancelada` (con motivo y tipo) no se repite. Liberar la plaza y aplicar la política de crédito ocurren **en la misma transacción**, una sola vez. Doble cancelación concurrente → la segunda recibe 409 sin efecto (ni libera dos veces ni mueve crédito dos veces).
- **Políticas de cancelación (REQ-5):** `temprana` (dentro de ventana permitida → devuelve crédito), `tardía` (fuera de ventana → retiene crédito y registra), `por_gimnasio` (cancelación del establecimiento → siempre devuelve crédito, nunca penaliza al socio), `ausencia` (marcada por instructor/recepción tras la hora → retiene y registra). La política se evalúa contra la hora de la sesión y la ventana de la plantilla.
- **Aislamiento (REQ-1, TX-07):** todo query filtra por `organizationId`; ids de sesión/reserva de otro tenant son inalcanzables (404, no 403). Un socio solo ve y reserva **sus propias** reservas (REQ-7): el backend resuelve el socio de la sesión, nunca acepta `socioId` del cliente para el portal.
- **Montos/dinero:** esta entrega **no crea dinero**; solo compromete/libera beneficio derivado de la membresía. Cualquier cobro por clase sigue siendo un pago manual de la Entrega 2.
- **Errores:** `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409 (última plaza tomada, doble reserva, solape de agenda, doble cancelación, cobertura inválida), `INTERNAL_ERROR` 500.
- **Auditoría:** `audit_log` con `actorId`, `actorRole`, `accion` (`booking.create/cancel/attendance`, `session.create/update/block`), `entidad`, `entidadId`, `organizationId`, `timestamp`, `metadata`. Toda mutación escribe auditoría en la misma transacción.

## 3. Comportamientos BDD y aceptación

```gherkin
Escenario BDD-1: Última plaza bajo concurrencia — una confirma, otra rechaza (REQ-4, TX-01)
  Dado una sesión grupal con cupo 1 y 0 reservas
   Cuando dos socios intentan reservar la última plaza simultáneamente
  Entonces exactamente una reserva queda "confirmada"
  Y la otra recibe 409 CONFLICT
  Y el socio rechazado NO consume beneficio

Escenario BDD-2: Reserva compromete beneficio una sola vez
  Dado un socio con membresía activa y una reserva confirmada en la sesión S
  Cuando intenta reservar de nuevo la misma sesión S
  Entonces recibe 409 CONFLICT (ya tiene reserva)
  Y el compromiso de beneficio sigue siendo uno

Escenario BDD-3: Agenda unificada sin solapes (REQ-6, TX-02)
  Dado un instructor con una sesión grupal de 10:00 a 11:00
  Cuando se intenta crear una cita personalizada del mismo instructor de 10:30 a 11:30
  Entonces recibe 409 CONFLICT (solape real)
  Y la agenda del instructor queda coherente

Escenario BDD-4: Cancelación temprana libera plaza y devuelve crédito una vez (REQ-5, TX-04)
  Dado una reserva confirmada dentro de la ventana de cancelación temprana
  Cuando el socio cancela
  Entonces la plaza se libera (cupo disponible +1)
  Y el crédito se devuelve
  Y una segunda cancelación concurrente recibe 409 sin liberar ni mover crédito otra vez

Escenario BDD-5: Cancelación tardía retiene crédito
  Dado una reserva confirmada fuera de la ventana de cancelación
  Cuando el socio cancela tarde
  Entonces la plaza se libera (otro socio puede tomarla)
  Y el crédito se retiene y queda registrado

Escenario BDD-6: Cancelación por gimnasio siempre devuelve crédito
  Dado una reserva confirmada
  Cuando el gimnasio cancela la sesión (o la reserva por su causa)
  Entonces el crédito se devuelve al socio sin penalización

Escenario BDD-7: Revalidación de cobertura (SPEC:REVAL-01)
  Dado una reserva confirmada para una sesión futura
  Y la membresía del socio vence antes de la fecha de la sesión
  Cuando se consulta la reserva cerca de la fecha
  Entonces la reserva se marca "cobertura por revalidar" o se rechaza según política

Escenario BDD-8: Aislamiento y portal (REQ-1, REQ-7)
  Dado un socio S1 de la organización A
  Cuando intenta ver o reservar sobre una sesión de la organización B
  Entonces recibe 404 (no filtra existencia)
  Y el backend solo acepta socioId de la sesión, nunca del cliente
```

## 4. Diseño de datos (borrador)

- `class_templates` (org, nombre, tipo `grupal|fija`, cupo, ventanaReservaHoras, ventanaCancelacionHoras, coberturaRequerida, activo)
- `sessions` (org, plantillaId?, tipo `grupal|fija|cita|bloqueo`, instructorId, fechaHoraInicio, fechaHoraFin, estado `programada|cancelada|completada`, cupo)
- `bookings` (org, sesionId, socioId, estado `confirmada|cancelada|ausente`, beneficioComprometido boolean, createdAt) — unique `(sesionId, socioId)`
- `booking_cancellations` (org, bookingId, tipo `temprana|tardia|gimnasio|ausencia`, creditoDevuelto boolean, motivo, actorId, createdAt) — una por booking (evita doble movimiento de crédito)
- Índices/constraints: unique `(sesionId, socioId)` en bookings; exclusión de solape por instructor (rango temporal) vía constraint transaccional; índice por `(org, instructorId, fechaHoraInicio)` para la agenda.

## 5. Plan de implementación y verificación

- **Backend primero** (misma disciplina que Entrega 2): esquema + migración; contratos Zod; servicios (`sessions`, `bookings`, `attendance`, `agenda`); rutas v1; tests de integración contra Postgres real con los 8 escenarios BDD, incluyendo **concurrencia real** (dos reservas simultáneas a la última plaza → 200+409; doble cancelación simultánea → 200+409).
- **UI después** en una sola pasada con ADR-0003: panel de clases/sesiones, agenda del instructor, reserva/cancelación en el portal del socio, marca de asistencia.
- **Cobertura (CAL-2):** ≥80% en los módulos de reservas (transacciones y políticas).
- **Gate y DoD** por unidad (scripts/verify.sh); evidencia real adjunta.

## 6. Criterios de aceptación

- CA-1 (TX-01): dos reservas simultáneas a la última plaza → una 200, otra 409, sin consumo de beneficio del rechazado.
- CA-2 (REQ-4): doble reserva del mismo socio a la misma sesión → 409; compromiso de beneficio único.
- CA-3 (TX-02): solape real de agenda de instructor (grupal/fija/cita/bloqueo) → 409.
- CA-4 (TX-04): cancelación libera plaza y mueve crédito exactamente una vez; doble cancelación concurrente → una 200, otra 409.
- CA-5 (REQ-5): políticas temprana/tardía/gimnasio/ausencia aplican crédito según ventana configurada.
- CA-6 (SPEC:REVAL-01): reserva sobre sesión futura con membresía que vence antes → revalidación registrada.
- CA-7 (REQ-1/REQ-7): aislamiento cross-tenant (404) y socio solo ve/gestiona sus reservas.
- CA-8: auditoría de toda mutación de reserva/cancelación/asistencia en la misma transacción.
- CA-9 (MVP-SAUNA-01/B): cero tablas/servicios/rutas de sauna.
