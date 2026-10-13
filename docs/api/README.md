# API contracts — App GYM (GYM-2026)

Contratos HTTP documentados. Los esquemas ejecutables viven en
`packages/contracts` (fuente única); este documento es la vista legible.
El backend es autoridad: la UI nunca autoriza por sí sola.

## Convenciones

- Base path: `/api/v1`; superficie de autenticación en `/api/auth/*` (Better Auth).
- Formato: JSON. Respuestas OK envueltas en `{ data: ... }`.
- Errores: forma estable `{ error: { code, message, details? } }`.
- Códigos de error: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401),
  `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_ERROR` (500).
- Tenant: resuelto desde la sesión verificada (lectura autoritativa en BD,
  sin caché de cookie); nunca desde el cliente (REQ-1, TX-07).
- Roles: `admin`, `recepcion`, `instructor`, `socio`. Matriz por ruta abajo.
- Sin endpoints de sauna en v1.0 (MVP-SAUNA-01/B).

## Health

### `GET /health`

Sin autenticación. `200` → `{ "status": "ok" }`.

## Auth (Better Auth, `/api/auth/*`)

| Endpoint | Uso |
|---|---|
| `POST /api/auth/sign-in/email` | Login; setea cookies httpOnly `gym.session_token` + `gym.session_data` |
| `POST /api/auth/sign-out` | Invalida la sesión en servidor (requiere header `Origin` = baseURL) |
| `GET /api/auth/get-session` | Sesión cruda de Better Auth (uso interno/debug) |

### `GET /api/v1/auth/session`

Sesión enriquecida con organización y rol (derivados de datos almacenados).
`401` sin sesión válida.

Respuesta `200` (`SessionResponse`):

```json
{
  "data": {
    "user": { "id": "<text-id>", "email": "admin@a.cl", "name": "admin@a.cl" },
    "organization": { "id": "<uuid>", "name": "Gimnasio A" },
    "role": "admin"
  }
}
```

## Organizations

### `POST /api/v1/organizations`

Solo en arranque (sin sesión previa). Crea el tenant.

Request (`CreateOrganizationRequest`): `{ "name": "Gimnasio Piloto" }`
Respuesta `201`: `{ "data": { "id": "<uuid>", "name": "..." } }`
Errores: 400 `VALIDATION_ERROR`; 403 si ya hay sesión.

## Provisioning (admin / recepción)

### `POST /api/v1/staff` — rol admin

Crea cuenta staff con rol y la vincula a la organización de la sesión.
El `organizationId` del body se ignora: siempre el de la sesión.

Request: `{ "email", "password" (≥10), "name", "role": "admin|recepcion|instructor" }`
Respuesta `201`: `{ "data": { "accountId": "<text-id>" } }`
Errores: 401 sin sesión; 403 si rol ≠ admin; 409 email duplicado; 400 validación.

### `POST /api/v1/socios` — roles admin, recepción

Crea cuenta de socio + fila de miembro en la organización de la sesión.

Request: `{ "email", "password" (≥10), "name" }`
Respuesta `201`: `{ "data": { "accountId": "<text-id>", "memberId": "<uuid>" } }`
Errores: 401/403/409/400 como arriba.

## Members

| Método y ruta | Roles permitidos | Notas |
|---|---|---|
| `GET /api/v1/members?q=` | admin, recepcion, instructor | Listado filtrado por tenant; `q` busca en nombre/email |
| `POST /api/v1/members` | admin, recepcion | Alta de socio (sin login) en la organización de la sesión |
| `GET /api/v1/members/:id` | admin, recepcion, instructor, socio | Socio solo su propio id (otros → 404/403) |
| `GET /api/v1/members/me` | socio | Perfil propio (memberId de la sesión) |
| `PATCH /api/v1/members/:id/contact` | admin, recepcion, socio | Socio solo su propio contacto (D-04/B) |

Request `CreateMemberRequest`: `{ "fullName", "contactEmail"? }`
Request `PATCH .../contact`: `{ "contactEmail": "<email>" | null }`
Respuesta: `{ "data": { "id", "organizationId", "fullName", "contactEmail", "createdAt" } }`
Errores: 401 sin sesión; 403 rol insuficiente o socio sobre ajeno;
404 recurso inexistente o de otro tenant; 400 validación.

## Plans (Entrega 2)

| Método y ruta | Roles permitidos | Notas |
|---|---|---|
| `GET /api/v1/plans` | admin, recepcion, instructor | Listado de planes activos del tenant |
| `POST /api/v1/plans` | admin | Crear plan |
| `GET /api/v1/plans/:id` | admin, recepcion, instructor | Detalle |

Request `CreatePlanRequest`: `{ "name", "priceCents", "durationDays", "coverage": "none|unlimited|limited" }`
Dinero en **centavos CLP enteros** (sin decimales). Respuesta `201` → `PlanDetail`.

## Memberships (Entrega 2)

| Método y ruta | Roles permitidos | Notas |
|---|---|---|
| `POST /api/v1/memberships` | admin, recepcion | Asigna un plan a un socio (membresía) |
| `GET /api/v1/memberships` | admin, recepcion, instructor | Listado con estado derivado |
| `GET /api/v1/memberships/mine` | socio | Solo las propias |
| `GET /api/v1/memberships/:id` | admin, recepcion, instructor, socio | Socio solo la propia (otras → 404) |

Request `CreateMembershipRequest`: `{ "memberId", "planId" }`.
La membresía nace **sin ventana de vigencia** (`state: "pending_payment"`); la ventana se
abre con el **primer pago validado**. El `state` es **derivado** de los pagos validados en
cada lectura: `pending_payment` (sin ventana) · `active` (vigente hoy) · `expired` (fin pasado).
La renovación extiende desde el fin previo (sin huecos).

## Payments (Entrega 2 — REQ-2)

| Método y ruta | Roles permitidos | Notas |
|---|---|---|
| `POST /api/v1/payments` | admin, recepcion | Registra un pago **provisional** |
| `GET /api/v1/payments?state=` | admin, recepcion | Listado; `state` = provisional\|validated\|rejected |
| `GET /api/v1/payments/:id` | admin, recepcion | Detalle |
| `POST /api/v1/payments/:id/validate` | **admin** | Valida: otorga derechos + crea movimiento de caja |
| `POST /api/v1/payments/:id/reject` | **admin** | Rechaza (requiere `reason`) |

Request `POST /payments`: `{ "membershipId", "amountCents", "method": "cash|transfer", "reference"? }`.
Una `transfer` **exige** `reference` (400 si falta).

Invariantes verificadas (backend autoridad):
- El pago registrado es **provisional y NO otorga cobertura** hasta validación humana (SPEC:PAY-01).
- **Separación de funciones (SPEC:PAY-02):** solo `admin` decide, y **nunca** un pago que él
  mismo registró (403).
- El pago **validado es inmutable** y el estado es **terminal**: re-validar o validar un
  rechazado → 409.
- La validación crea el **movimiento de caja una sola vez**, en la **misma transacción** que el
  cambio de estado y la auditoría (unique `cash_movements.payment_id` = clave de idempotencia).
- **Dinero validado solo cae en turno abierto**: sin turno, validar → 409 (sin dinero huérfano).
- Toda mutación financiera escribe su **auditoría en la misma transacción** (rollback revierte ambas).

## Concurrencia (REQ-8, spec 008)

No agrega endpoints: ejercita los ya definidos con 2 admins + 3 recepcionistas
concurrentes sobre el stack real y verifica que las invariantes de dinero y cupo
sostienen bajo concurrencia (prueba en `apps/api/src/concurrency.integration.test.ts`).

| Invariante | Evidencia bajo 5 operadores concurrentes |
|---|---|
| TX-05 cierre de turno idempotente | 5 cierres del mismo turno → 1 ok + 4× 409; una sola fila `closed` |
| Movimiento de caja único por pago | 5 pagos validados en paralelo → exactamente 5 movimientos |
| TX-01 cupo no excedido | 5 reservas de la última plaza → 1 confirmada; `confirmed_count` nunca > capacidad |
| Check-in coherente | 6 socios QR en paralelo → respuestas coherentes |

Latencia medida (30 requests): p50=60ms, p95=91ms, max=93ms, sin bloqueos
artificiales. La prueba usa `app.inject` con cookie real — no se agregan
dependencias de carga (k6/autocannon).

## Cash (Entrega 2 — REQ-3)

| Método y ruta | Roles permitidos | Notas |
|---|---|---|
| `POST /api/v1/cash/sessions` | admin, recepcion | Abre turno (un solo turno abierto por org) |
| `GET /api/v1/cash/sessions/current` | admin, recepcion | Turno abierto (badge de topbar) |
| `POST /api/v1/cash/sessions/:id/close` | admin, recepcion | Cierra (idempotente bajo concurrencia) |
| `GET /api/v1/cash/sessions/:id` | admin, recepcion | Turno + movimientos |
| `GET /api/v1/cash/consolidation?date=` | admin, recepcion | Consolidado del día por método |

Request `POST /sessions`: `{ "openingCents" }`. Request `POST .../close`: `{ "declaredClosingCents" }`.

- **Cierre idempotente (TX-05):** `FOR UPDATE` + `WHERE state='open'` dentro de la transacción →
  dos cierres simultáneos del mismo turno dan **un 200 y un 409**.
- **Conciliación:** `expectedClosing = apertura + Σ movimientos validados`; la discrepancia
  `declarado − esperado` se registra, nunca bloquea el cierre.
- **Sin API de movimiento manual:** los movimientos solo los crea la validación de un pago.

## Entrega 3 · Clases, agenda y reservas (spec 004)

Contratos (esquemas Zod en `@gym/contracts`, fuente única):

- `ClassType` = `grupal | fija`; `SessionType` = `grupal | fija | cita | bloqueo`
- `SessionState` = `programada | cancelada | completada`; `BookingState` = `confirmada | cancelada | ausente`
- `CancellationType` = `temprana | tardia | gimnasio | ausencia`
- `CreateClassTemplateRequest`, `CreateSessionRequest`, `CreateBookingRequest`, `CancelBookingRequest`, `MarkAttendanceRequest`

Rutas v1:

| Ruta | Roles | Notas |
|---|:--:|---|
| `POST /api/v1/class-templates` | admin | Plantilla (cupo, ventana de reserva/cancelación, cobertura) |
| `GET /api/v1/class-templates` | todos | Listado por tenant |
| `POST /api/v1/sessions` | admin, recepcion, instructor | Crea sesión; rechaza solape del instructor (TX-02) |
| `GET /api/v1/sessions?from=&to=` | todos | Sesiones reservables |
| `GET /api/v1/sessions/:id` | todos | Detalle |
| `POST /api/v1/sessions/:id/cancel` | admin, recepcion | Cancela la sesión |
| `GET /api/v1/agenda?instructorId=&from=&to=` | admin, recepcion, instructor | Agenda unificada del instructor (REQ-6) |
| `POST /api/v1/bookings` | admin, recepcion, socio | Reserva; última plaza bajo concurrencia (TX-01) |
| `GET /api/v1/bookings/mine` | socio | Reservas propias |
| `GET /api/v1/bookings?sessionId=` | admin, recepcion, instructor | Reservas de una sesión |
| `POST /api/v1/bookings/:id/cancel` | admin, recepcion, socio | Cancela; crédito una vez (TX-04) |
| `POST /api/v1/bookings/:id/attendance` | admin, recepcion, instructor | Marca asistencia/ausencia |

Invariantes (verificadas con tests de integración contra Postgres real, `apps/api/scripts/test-integration.sh`):

- **TX-01 (última plaza, concurrencia):** la reserva bloquea la fila de sesión `FOR UPDATE` y re-chequea
  `confirmedCount < capacity` dentro de la transacción → dos socios por la última plaza dan **un 201 y un 409**;
  el perdedor NUNCA compromete beneficio (el insert no ocurre). El unique `(session_id, member_id)` bloquea la
  doble reserva del mismo socio.
- **REQ-4 (beneficio una vez):** `beneficioComprometido` se pone `true` solo al confirmar; una reserva rechazada
  no lo toca.
- **REVAL-01 (cobertura):** sin membresía con ventana activa el socio no puede reservar (409).
- **TX-02 (sin solapes):** el instructor no puede tener dos compromisos solapados
  (`startsAt < otro.endsAt AND endsAt > otro.startsAt`, mismo instructor, `programada`), verificado bajo
  `FOR UPDATE` para serializar creaciones en carrera.
- **TX-04 (crédito una vez):** la cancelación mueve la reserva a `cancelada` y escribe la fila de cancelación en
  la MISMA transacción; el unique `booking_cancellations.booking_id` es la clave de idempotencia → una segunda
  (concurrente) cancelación da **409** y el crédito nunca se mueve dos veces.
- **REQ-5 (política):** `temprana`/`gimnasio` devuelven crédito; `tardía`/`ausencia` lo retienen. La ventana es
  `class_templates.cancellation_window_hours` (default 24 h).
- **TX-07 (aislamiento):** toda lectura/escritura filtra por `organization_id`; un recurso de otro tenant
  devuelve **404** (sin fuga de existencia).
- **REQ-7 (propio):** un socio solo reserva/cancela para sí (`memberId` de la sesión, nunca del cliente).

## Entrega 4 · Offline controlado (spec 005, REQ-9)

Contratos (esquemas Zod en `@gym/contracts`, fuente única):

- `DeviceState` = `habilitado | revocado`; `OfflineEventState` = `pendiente | sincronizado | rechazado | duplicado_negocio`
- `RegisterDeviceRequest`, `SyncEventsRequest`/`SyncEventsResponse`, `OfflineEventInput`, `SyncResultEntry`, `IngressContingenciaRequest`, `ReconstructRequest`/`ReconstructResponse`

Rutas v1:

| Ruta | Roles | Notas |
|---|:--:|---|
| `POST /api/v1/devices` | admin | Registra dispositivo prehabilitado (org + operador) |
| `GET /api/v1/devices` | admin | Listado por tenant |
| `POST /api/v1/devices/:id/revoke` | admin | Revoca (eventos futuros inertes, conservados) |
| `POST /api/v1/offline/sync` | admin, recepcion, instructor | Ingesta idempotente del outbox (TX-06) |
| `GET /api/v1/offline/events?deviceId=` | admin, recepcion | Eventos sincronizados |
| `POST /api/v1/offline/ingreso` | admin, recepcion, instructor | Ingreso de contingencia con control de frescura |
| `POST /api/v1/offline/reconstruct` | admin | Reconstrucción auditable + verificación de hashes |

Invariantes (verificadas con tests de integración contra Postgres real, `apps/api/scripts/test-integration.sh`):

- **TX-06 idempotencia:** el mismo `event_id` reenviado → efecto una vez. El evento con unique `(organization_id, event_id)` se inserta PRIMERO como barrera; el perdedor de una carrera concurrente reproduce el resultado almacenado y NO crea un segundo pago.
- **TX-06 duplicado de negocio (REQ-9):** dos `event_id` distintos con la misma huella `(org, folio_externo, tipo, monto)` → ambos conservados; el segundo marcado `duplicado_negocio` (nunca se descarta: es evidencia).
- **Prohibición ADR-0002 §3:** el `cobro_provisional` offline crea un pago **provisional** (Entrega 2) SIN movimiento de caja ni cobertura; requiere validación humana.
- **SPEC:OFF-FRESH:** `ingreso_contingencia` con instantánea más vieja que `organizations.offline_freshness_hours` (default 72h = valor de trabajo, configurable) → 409.
- **Dispositivo revocado:** eventos conservados y marcados `rechazado`, sin efectos.
- **SPEC:OFF-RECON:** `reconstruct` reproduce la cadena y verifica hashes encadenados por evento.
- **TX-07:** dispositivo/evento de otro tenant → 404.

## Entrega 5 · Revocación de sesión (spec 006, REQ-11)

Rutas v1:

| Ruta | Roles | Notas |
|---|:--:|---|
| `GET /api/v1/admin/sessions?accountId=` | admin | Sesiones activas de una cuenta del tenant |
| `POST /api/v1/admin/sessions/revoke` | admin | Revoca una sesión (`{accountId, sessionId}`) |
| `POST /api/v1/admin/sessions/revoke-all` | admin | Revoca todas las sesiones de la cuenta |
| `POST /api/v1/me/sessions/revoke-others` | todos | Cierra MIS otras sesiones; conserva la actual |

Invariantes (verificadas con tests de integración contra Postgres real):

- **SPEC:REVOKE:** la revocación borra la fila de `session` → el token deja de resolver de inmediato (server-side, no depende del cliente).
- **Pertenencia al tenant (REQ-1, TX-07):** la cuenta objetivo pertenece al org si tiene `staff_assignments` activa en ese org o su email coincide con un `members.contact_email` del org; si no → 404 (anti-enumeración).
- **Separación de funciones:** solo `admin` revoca sesiones ajenas; cualquier cuenta auto-revoca las suyas salvo la actual; recepcion/instructor revocando ajenas → 403.
- **Auditoría:** cada revocación escribe `session.revoke`/`session.revoke_all` en la misma transacción (actor, objetivo, org, IP).

Backup/restore (SPEC:BACKUP): runbook reproducible + verificación real sobre Docker en `docs/operations/runbook.md` (backup `pg_dump -Fc`, restore en BD limpia, conteos idénticos + query de humo por dominio).

## Entrega 5 · QR de ingreso y check-in supervisado (spec 007, REQ-7/REQ-8)

Rutas v1:

| Ruta | Roles | Notas |
|---|:--:|---|
| `POST /api/v1/checkin` | admin, recepcion | Escaneo supervisado `{qrToken}` → cobertura activa |
| `GET /api/v1/me/qr` | socio | Su propio QR (REQ-7) |
| `POST /api/v1/me/qr/rotate` | socio | Rota su QR (invalida el anterior) |
| `POST /api/v1/members/:id/qr/reissue` | admin | Re-emite el QR de un socio |
| `POST /api/v1/members/:id/qr/revoke` | admin | Revoca el QR (anti-compartir) |

Invariantes (verificadas con tests de integración contra Postgres real):

- **SPEC:CHECKIN:** el check-in permite el ingreso solo con **cobertura activa** — membresía con ventana vigente (`startAt ≤ now < endAt`) y plan `coverage ≠ none`. Misma definición de "tiene derechos" que Entrega 2 y offline (un solo criterio). La denegación por cobertura es una **decisión de negocio (200 + allowed:false con motivo)**, no un error de transporte — la recepción debe ver el porqué.
- **SPEC:QR-TOKEN:** token estático, opaco, único global, sin datos de socio/tenant encodeados; se resuelve contra la BD dentro del tenant. Revocable (`qrRevokedAt`, se conserva para trazabilidad) y re-emisible. El QR estático + revocación + supervisión humana es el control anti-compartir (decisión del usuario; sin TOTP).
- **SPEC:CHECKIN-ISO (REQ-1/TX-07):** el token se resuelve SOLO contra socios del tenant del operador; un token válido de otro tenant → **404** (anti-enumeración, no 403).
- **Autorización, no efecto (decisión usuario "solo cobertura"):** el check-in no cuenta ingresos ni bloquea re-ingreso; es idempotente por naturaleza. Cada check-in audita `checkin.ok`/`checkin.denied` (socio, cobertura, motivo) en la misma transacción.
- **REQ-8:** dos recepcionistas escaneando el mismo QR en paralelo → respuestas coherentes (verificado).

## Matriz RBAC (estado real del código)

Autoridad: `requireRole(session, [roles])` antes de todo acceso a datos
(`apps/api/src/roles.ts`; orden de autoridad admin > recepcion > instructor > socio).
El rol socio se restringe además por **propiedad** (el `memberId` sale de la sesión,
nunca del cliente) y el cross-tenant es **404** (no 403: sin fuga de existencia).
"✓" = permitido · "—" = prohibido (403) · "propio" = solo su propio recurso (ajeno → 404).

| Recurso / ruta | admin | recepción | instructor | socio |
|---|:--:|:--:|:--:|:--:|
| POST /organizations | solo bootstrap | — | — | — |
| POST /staff | ✓ | — | — | — |
| POST /socios | ✓ | ✓ | — | — |
| GET /members | ✓ | ✓ | ✓ | — |
| POST /members | ✓ | ✓ | — | — |
| GET /members/:id | ✓ | ✓ | ✓ | propio |
| GET /members/me | — | — | — | propio |
| PATCH /members/:id/contact | ✓ | ✓ | — | propio |
| POST /members/:id/qr/reissue | ✓ | — | — | — |
| POST /members/:id/qr/revoke | ✓ | — | — | — |
| GET /plans | ✓ | ✓ | ✓ | — |
| POST /plans | ✓ | — | — | — |
| GET /plans/:id | ✓ | ✓ | ✓ | — |
| POST /memberships | ✓ | ✓ | — | — |
| GET /memberships | ✓ | ✓ | ✓ | — |
| GET /memberships/mine | — | — | — | propio |
| GET /memberships/:id | ✓ | ✓ | ✓ | propio |
| POST /payments | ✓ | ✓ | — | — |
| GET /payments | ✓ | ✓ | — | — |
| GET /payments/:id | ✓ | ✓ | — | — |
| POST /payments/:id/validate | ✓ | — | — | — |
| POST /payments/:id/reject | ✓ | — | — | — |
| POST /cash/sessions | ✓ | ✓ | — | — |
| GET /cash/sessions/current | ✓ | ✓ | — | — |
| POST /cash/sessions/:id/close | ✓ | ✓ | — | — |
| GET /cash/sessions/:id | ✓ | ✓ | — | — |
| GET /cash/consolidation | ✓ | ✓ | — | — |
| POST /class-templates | ✓ | — | — | — |
| GET /class-templates | ✓ | ✓ | ✓ | ✓ |
| POST /sessions | ✓ | ✓ | ✓ | — |
| GET /sessions | ✓ | ✓ | ✓ | ✓ |
| GET /sessions/:id | ✓ | ✓ | ✓ | ✓ |
| POST /sessions/:id/cancel | ✓ | ✓ | — | — |
| GET /agenda | ✓ | ✓ | ✓ | — |
| POST /bookings | ✓ | ✓ | — | propio |
| GET /bookings/mine | — | — | — | propio |
| GET /bookings | ✓ | ✓ | ✓ | — |
| POST /bookings/:id/cancel | ✓ | ✓ | — | propio |
| POST /bookings/:id/attendance | ✓ | ✓ | ✓ | — |
| POST /checkin | ✓ | ✓ | — | — |
| GET /checkins/recent | ✓ | ✓ | — | — |
| GET /me/qr | — | — | — | propio |
| POST /me/qr/rotate | — | — | — | propio |
| POST /devices | ✓ | — | — | — |
| GET /devices | ✓ | — | — | — |
| POST /devices/:id/revoke | ✓ | — | — | — |
| POST /offline/sync | ✓ | ✓ | ✓ | — |
| GET /offline/events | ✓ | ✓ | — | — |
| POST /offline/ingreso | ✓ | ✓ | ✓ | — |
| POST /offline/reconstruct | ✓ | — | — | — |
| GET /admin/sessions | ✓ | — | — | — |
| POST /admin/sessions/revoke | ✓ | — | — | — |
| POST /admin/sessions/revoke-all | ✓ | — | — | — |
| POST /me/sessions/revoke-others | ✓ | ✓ | ✓ | propio |

### Reglas transversales del modelo

- **Separación de funciones (dinero):** recepción registra pagos/membresías/caja, pero
  **solo admin valida o rechaza** (SPEC:PAY-02) y nunca un pago que él mismo registró.
- **Propiedad del socio (REQ-7):** `/me/*` y los `memberId` salen de la sesión; un socio
  sobre un recurso ajeno recibe **404** (no 403), verificado con test
  (`auth-flow.integration.test.ts` CA-4/REQ-7: GET y PATCH de otro socio).
- **Cross-tenant (TX-07):** todo filtra por `organization_id`; recurso de otro tenant → 404.
- **Solo-admin por diseño:** staff, planes, dispositivos offline, validación/rechazo de
  pagos, re-emisión/revocación de QR de terceros, reconstrucción offline y revocación de
  sesiones ajenas quedan fuera del alcance de recepción/instructor/socio.
- **Instructor = solo lectura de agenda/reservas + marca asistencia:** no toca dinero ni
  configuración; puede crear sesiones y marcar asistencia (REQ-6/REQ-5).
- **Revoke-others propio:** cualquier rol cierra SUS otras sesiones conservando la actual.
