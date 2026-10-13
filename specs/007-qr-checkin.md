# Spec: QR de ingreso y check-in supervisado (Entrega 5, REQ-7/REQ-8)

> Estado: Cerrada — backend implementado, verificado y sellado por el usuario
> Nivel: Tier 1 — Riesgo alto; justificación: es control de acceso físico; un error aquí admite a alguien sin cobertura (pérdida de ingresos, acceso indebido) o rechaza a un socio legítimo. El token de identidad es además una credencial compartible.
> Requisitos: REQ-7 (portal socio: QR propio), REQ-8 (concurrencia recepción sin doble operación), flujo PRD "reserva → asistencia/QR supervisado → cierre de caja"
> ADR aplicables: docs/adr/0002-arquitectura-base.md (§2.2 sesiones; §3 auditoría)
> Contexto (Notion): PRD §N "QR estático revocable para identificación e ingreso supervisado"; rol recepción "valida ingresos con QR"
> Trazabilidad: SPEC:CHECKIN (check-in valida cobertura), SPEC:QR-TOKEN (token estático revocable), SPEC:CHECKIN-ISO (aislamiento tenant del check-in)
> Aceptación: usuario, 2026-10-12, revisión humana Tier 1 (OK del usuario). Backend verificado (commit `bf906ce`); SPEC:CHECKIN/QR-TOKEN/CHECKIN-ISO contra Postgres real (8/8: cobertura, denegación, revocación, cross-tenant 404, QR propio, idempotencia, concurrencia recepción). QR estático revocable; check-in valida solo cobertura; recepción opera; admin re-emite y socio rota el suyo; backfill de token en migración 0008. UI (escáner + QR en portal) después, con el rediseño estructural del frente. Commits locales autorizados, sin push.

## 1. Objetivo y alcance

- **Resultado observable:** cada socio tiene un **QR estático** (token fijo) que lo identifica ante la recepción; la recepción lo escanea y el backend responde **si el socio tiene cobertura activa ahora** (ingreso permitido 200) o no (409), de forma **supervisada** (humano) y con aislamiento por tenant. El token es **revocable** por el admin ante abuso o compartir credencial.
- **Incluye (backend):**
  - **Token QR por socio** (`members.qrToken`): string opaco y fijo, generado al crear el socio, único globalmente (no adivinable, no secuencial). Revocable: `members.qrRevokedAt` (timestamp) — revocar invalida el token de inmediato sin borrarlo (queda rastro). Re-emitir genera uno nuevo.
  - **Check-in supervisado (SPEC:CHECKIN):** `POST /api/v1/checkin` con `{qrToken}` (rol admin/recepción). Resuelve el socio por token dentro del tenant, valida **cobertura activa**: existe membresía con ventana vigente (`startAt ≤ now < endAt`) y plan con `coverage ≠ 'none'`. Cobertura OK → 200 con identidad del socio (id, nombre) para que el recepcionista confirme visualmente. Sin cobertura / token revocado / token inexistente → 409 (y token de otro tenant → 404, anti-enumeración).
  - **Consulta del QR propio (REQ-7):** `GET /api/v1/me/qr` (rol socio) devuelve su token para renderizar el QR en su portal. El socio NUNCA escanea ni valida: solo muestra.
  - **Auditoría:** cada check-in escribe `audit_log` (`checkin.ok` / `checkin.denied`) en la misma transacción, con socio objetivo, resultado, cobertura observada y operador.
  - **Aislamiento tenant (REQ-1, TX-07):** el token se resuelve **solo** contra socios del tenant del operador; un token de otro tenant → 404 (no 403).
- **Excluye (explícito, para no prometer de más):**
  - **QR rotativo/TOTP:** el usuario eligió QR estático (decisión 2026-10-12); no hay refresco por tiempo. El control anti-compartir es la **revocación** + supervisión humana.
  - **Registro persistente de asistencia con anti doble-ingreso:** el usuario eligió "solo validación de cobertura" (decisión 2026-10-12). El check-in es una **consulta de autorización** (idempotente, sin efecto acumulable); la auditoría registra el evento pero no bloquea re-ingreso. Si el piloto pide control de aforo/anti doble-ingreso, es extensión documentada.
  - Integración con torniquete/puerta automática (v1.0 es supervisado por persona); biometría; apps nativas.
- **Decisiones fundamentadas (repo = fuente de verdad):**
  - **QR estático revocable** (PRD + decisión usuario): el token es fijo; la revocación (`qrRevokedAt`) es el mecanismo de control, no la rotación. Decidido.
  - **Check-in = autorización pura, no efecto** (decisión usuario "solo cobertura"): no hay contador de ingresos ni bloqueo por re-ingreso; idempotente por naturaleza. Decidido.
  - **Cobertura activa reutiliza la definición de Entrega 2/4** (membresía con ventana vigente + plan coverage≠none): un solo criterio de "tiene derechos", igual online y offline. Decidido.
  - **Token opaco y fijo, único global**: no lleva memberId/tenant encodeados (no se filtra información por el QR); se resuelve contra BD dentro del tenant. Revocable sin borrar. Decidido.

## 2. Contratos e invariantes

- **Token QR (SPEC:QR-TOKEN):** `members.qrToken` único global, opaco (aleatorio criptográfico), no secuencial. `members.qrRevokedAt` (timestamp nullable): si `≠ null`, el token está revocado. Re-emisión genera un nuevo token y limpia `qrRevokedAt`. El socio consulta el suyo vía `GET /me/qr`; el admin puede re-emitirlo vía `POST /members/:id/qr`.
- **Check-in (SPEC:CHECKIN):** `POST /api/v1/checkin {qrToken}` → 200 `{allowed:true, member:{id,fullName}, coverage, membershipEndsAt}` si hay cobertura activa; 409 `{allowed:false, reason}` si no hay cobertura, token revocado o socio inexistente-en-tenant; 404 si el token es de otro tenant o no existe (anti-enumeración, REQ-1/TX-07). Rol admin/recepción.
- **Cobertura activa:** membresía del socio con `startAt ≤ now < endAt` y `plan.coverage ∈ {unlimited, limited}`. `coverage = none` → sin ingreso. Sin membresía vigente → sin ingreso.
- **Aislamiento (REQ-1, TX-07):** el check-in resuelve el token **solo** dentro del `organizationId` del operador. Token válido globalmente pero de otro tenant → 404 (no se filtra si existe en otro lado).
- **Autorización (REQ-1, roles):** check-in = admin/recepción. `GET /me/qr` = socio (solo el propio). Re-emitir QR = admin (y auto-servicio para el socio que quiera rotar el suyo, `POST /me/qr/rotate`).
- **Auditoría:** `audit_log` acción `checkin.ok`/`checkin.denied`, `entity = "member"`, `entityId` = socio, metadata con `coverage`, `membershipEndsAt`, `reason` (si denied). Toda consulta de check-in audita en la misma transacción.
- **Errores:** `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404 (token de otro tenant/inexistente), `CONFLICT` 409 (sin cobertura / token revocado), `INTERNAL_ERROR` 500.

## 3. Comportamientos BDD y aceptación

```gherkin
Escenario BDD-1: Check-in con cobertura activa (SPEC:CHECKIN)
  Dado un socio con membresía vigente (ventana activa, plan coverage≠none) y su QR
  Cuando la recepción escanea el QR (POST /checkin)
  Entonces responde 200 allowed=true con la identidad del socio
  Y la recepción confirma visualmente y autoriza el ingreso
  Y queda auditado checkin.ok

Escenario BDD-2: Check-in sin cobertura (SPEC:CHECKIN)
  Dado un socio con membresía vencida o plan coverage=none
  Cuando la recepción escanea su QR
  Entonces responde 409 allowed=false con el motivo
  Y queda auditado checkin.denied (sin negar el servicio: solo no autoriza)

Escenario BDD-3: Token revocado (SPEC:QR-TOKEN)
  Dado un socio cuyo QR fue revocado por el admin (compartir credencial)
  Cuando se escanea ese QR
  Entonces responde 409 (token revocado)
  Y el admin puede re-emitir uno nuevo

Escenario BDD-4: Aislamiento cross-tenant (SPEC:CHECKIN-ISO, REQ-1/TX-07)
  Dado un recepcion de la organización A
  Cuando escanea un QR válido pero de un socio de la organización B
  Entonces responde 404 (no filtra existencia entre tenants)

Escenario BDD-5: QR propio del socio (REQ-7)
  Dado un socio autenticado
  Cuando consulta GET /me/qr
  Entonces recibe su token para renderizar el QR en su portal
  Y nunca puede escanear/validar otros QRs

Escenario BDD-6: Check-in es idempotente (decisión usuario)
  Dado un socio con cobertura activa
  Cuando la recepción escanea el mismo QR dos veces seguidas
  Entonces ambas responden 200 (no hay bloqueo por re-ingreso; es autorización, no efecto)
```

## 4. Diseño de datos (borrador)

- `members`: + `qrToken` (text unique, opaco) + `qrRevokedAt` (timestamptz nullable). Generados al crear el socio (provisioning); re-emitibles.
- Sin tablas nuevas: el check-in es consulta; la auditoría usa `audit_log` existente.
- Contratos Zod: `CheckinRequest {qrToken}`, `CheckinResponse {allowed, member?, coverage?, membershipEndsAt?, reason?}`, `MyQrResponse {qrToken}`.

## 5. Plan de implementación y verificación

- **Backend primero:** migración (members +qrToken +qrRevokedAt); contratos; servicio `checkin.ts` (emitir/rotar token, resolver token scoped al tenant, validar cobertura activa, auditar); rutas v1 (`POST /checkin`, `GET /me/qr`, `POST /me/qr/rotate`, `POST /members/:id/qr` admin re-emitir); integrar generación de token en ProvisioningService.createSocio.
- Tests de integración contra Postgres real: BDD-1..BDD-6 (cobertura activa 200, sin cobertura 409, token revocado 409, cross-tenant 404, socio ve su QR, idempotencia). Concurrencia: dos recepcionistas escaneando el mismo QR simultáneo → ambos 200 coherentes (REQ-8, sin doble operación financiera — no hay efecto que duplicar).
- **UI después** (congelada): escáner en recepción (kiosco) y QR en el portal del socio, con el rediseño estructural del usuario.
- **Cobertura (CAL-2):** el módulo es acceso; cobertura alta en checkin (cobertura, revocación, aislamiento).
- **Gate y DoD** por unidad (scripts/verify.sh); evidencia real adjunta.

## 6. Criterios de aceptación

- CA-1 (SPEC:CHECKIN): cobertura activa → 200 allowed=true con identidad; auditado.
- CA-2 (SPEC:CHECKIN): sin cobertura / token revocado → 409 con motivo; auditado como denied.
- CA-3 (SPEC:QR-TOKEN): token opaco único; revocable (409 inmediato); re-emisible.
- CA-4 (REQ-1/TX-07): token de otro tenant → 404 (anti-enumeración).
- CA-5 (REQ-7): socio ve su QR propio; no escanea ni valida otros.
- CA-6 (idempotencia): mismo QR dos veces → ambos 200 (autorización, no efecto).
- CA-7 (REQ-8): dos recepcionistas escaneando el mismo QR en paralelo → respuestas coherentes, sin doble operación.
- CA-8 (MVP-SAUNA-01/B): cero tablas/servicios/rutas de sauna.
