# Spec: Offline controlado — outbox, folios, sincronización idempotente y reconstrucción (Entrega 4)

> Estado: Cerrada — backend implementado, verificado y sellado por el usuario
> Nivel: Tier 1 — Riesgo alto; justificación: introduce escrituras locales sin conexión que luego se reconcilian contra un servidor autoritativo; un error aquí duplica dinero, fabrica derechos o pierde eventos. Es el requisito transversal del piloto.
> Requisitos: REQ-9 (offline controlado: dispositivos prehabilitados, cobros provisionales offline, ingreso de contingencia ≤72h, outbox con folio, reenvío idempotente, reconstrucción auditable)
> ADR aplicables: docs/adr/0002-arquitectura-base.md (§2.5 offline; §3 obligaciones y prohibiciones)
> Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981fab0c2fa583efcdf15 (PRD §Offline controlado; P-09.3.1/B, P-09.3.2/B, P-09.3.3)
> Trazabilidad: SPEC:TX-06 (idempotencia offline por event_id), SPEC:OFF-FRESH (frescura ≤72h configurable), SPEC:OFF-FOLIO (folio externo independiente), SPEC:OFF-RECON (reconstrucción auditable)
> Aceptación: usuario, 2026-10-12, revisión humana Tier 1 (OK del usuario). Backend verificado (commit `56349d0`); invariantes TX-06/SPEC:OFF-FRESH/OFF-FOLIO/OFF-RECON contra Postgres real (7/7). Parámetros offline quedan configurables por org (no aprobados: P-09.3.1b, cifrado). UI/cliente offline congelada a propósito hasta el rediseño estructural del frente. Commits locales autorizados, sin push.

## 1. Objetivo y alcance

- **Resultado observable:** un dispositivo **prehabilitado** de un operador puede, sin conexión, registrar eventos provisionales (cobros, ingresos de contingencia, excepciones) en un outbox local con folio propio; al reconectar, el backend los acepta de forma **idempotente** (mismo `event_id` → efecto una vez; dos `event_id` para el mismo hecho → ambos conservados y marcados posible duplicado de negocio); el servidor sigue siendo autoridad y permite **reconstruir** el estado a partir de la cadena de eventos auditada.
- **Incluye (backend de la Entrega 4):**
  - **Modelo de dispositivos prehabilitados** (`devices`): un dispositivo pertenece a una organización, tiene un operador (cuenta), un estado (habilitado/revocado) y una clave de identidad criptográfica. Revocable (D-06 / acceso temporal de soporte queda diferido).
  - **Outbox de eventos (`offline_events`):** cada evento conserva `event_id` (UUID generado en el dispositivo), tenant, dispositivo, actor, turno (sesión de caja) cuando aplica, `folio_externo` (referible del operador, independiente del id), timestamp declarativo del dispositivo, tipo (`cobro_provisional` | `ingreso_contingencia` | `excepcion`), payload y permiso relevante. Estado: `pendiente | sincronizado | rechazado | duplicado_negocio`.
  - **Sincronización idempotente (SPEC:TX-06):** el endpoint de sync acepta un lote de eventos; por `event_id` inserta o ignora (unique `(tenant, event_id)`). Dos `event_id` distintos con la misma huella de negocio (tenant + folio_externo + tipo + monto) → ambos se conservan y el segundo se marca `duplicado_negocio` (no se descarta: es evidencia).
  - **Cobros provisionales offline:** un `cobro_provisional` **no** valida pago ni activa derechos (prohibición ADR-0002 §3); crea un pago en estado `provisional` ligado al evento offline, que luego pasa por la validación humana de la Entrega 2. Sin turno de caja abierto → el evento se acepta pero el movimiento de caja queda pendiente hasta validación (regla de dinero de 003: dinero validado solo cae en turno abierto).
  - **Ingreso de contingencia (≤72h):** un `ingreso_contingencia` usa una **instantánea de membresía** con frescura máxima configurable (SPEC:OFF-FRESH). El parámetro de frescura (72h es valor de trabajo, **no aprobado**) y el cifrado del almacenamiento local quedan **inyectados por configuración**, no cableados — resueltos antes de habilitar usuarios reales (G2).
  - **Reconstrucción auditable (SPEC:OFF-RECON):** endpoint/operación que reproduce el estado de un tenant/dispositivo desde la cadena `offline_events` + `audit_log`, con verificación de integridad (cadena de hashes por evento).
  - **Auditoría:** toda mutación offline escribe `audit_log` en la misma transacción, con `event_id` en metadata para trazabilidad dispositivo→servidor.
  - **API REST con contratos Zod** en `packages/contracts`; servicios en `apps/api/src/services/`; tests de integración contra Postgres real.
- **Excluye:** validación de pagos offline, activación de derechos offline, reserva firme offline (prohibiciones ADR-0002 §3; P-09.3 reserva firme offline es v1.1); cifrado del almacenamiento local IndexedDB (lado cliente, resuelve el parámetro antes de G2 — aquí solo se define el contrato de clave de dispositivo); resolución del parámetro P-09.3.1b (72h es trabajo, no aprobado); acceso temporal de soporte (D-06, diferido); sauna (fuera de v1.0).
- **Decisiones fundamentadas en el PRD/ADR (repo = fuente de verdad):**
  - **Idempotencia por `event_id` + tenant/device** (ADR-0002 §2.5, REQ-9, SPEC:TX-06): el reconocimiento central es idempotente; reenviar el mismo evento no duplica efecto. Decidido.
  - **Postgres autoridad; IndexedDB nunca segundo maestro** (ADR-0002 §2.5). Decidido.
  - **Ningún pago provisional concede derechos; nada se valida offline** (ADR-0002 §3 prohibiciones). Decidido.
  - **Folio externo independiente** (PRD §offline: "folio independiente para dinero/excepciones"): el operario genera una referencia propia; el sistema la conserva para detectar duplicados de negocio. Decidido.
  - **Frescura ≤72h como parámetro configurable, no cableado** (P-09.3.1b es valor de trabajo derivado): el backend lee el límite de configuración por organización; el default documentado es 72h pero es sustituible sin tocar código. Decisión de implementación explícita y reversible.
  - **Doble event_id para el mismo hecho → ambos conservados y marcados** (REQ-9, SPEC:TX-06): no hay "last-write-wins" silencioso; la ambigüedad queda registrada para resolución humana.

## 2. Contratos e invariantes

- **Idempotencia de sync (REQ-9, TX-06):** el mismo `event_id` reenviado → **efecto una vez**. Implementación: unique `(organizationId, eventId)` en `offline_events`; el insert con `ON CONFLICT DO NOTHING` devuelve el evento existente sin re-aplicar efectos; la respuesta de sync es por-evento (`sincronizado | duplicado | rechazado`).
- **Duplicado de negocio (REQ-9, TX-06):** dos `event_id` distintos con igual huella `(organizationId, folioExterno, tipo, amountCents)` → ambos insertados; el segundo marcado `duplicado_negocio`. Nunca se descarta en silencio.
- **Cobro provisional offline (REQ-2 + prohibición):** el evento de tipo `cobro_provisional` genera un `payments` en estado `provisional` con `reference = folio_externo` y origen offline; **no** crea movimiento de caja ni activa membresía hasta la validación humana de la Entrega 2. El dinero validado después solo cae en turno abierto (regla 003).
- **Frescura de instantánea (SPEC:OFF-FRESH):** un `ingreso_contingencia` referencia una instantánea de membresía (`membership_snapshots`) con `capturedAt`; si `ahora − capturedAt > limiteFrescura` (config por org, default 72h trabajo) → el ingreso se rechaza (`409`) con motivo, para evitar puerta abierta con datos viejos.
- **Aislamiento (REQ-1, TX-07):** todo query filtra por `organizationId`; un evento/dispositivo de otro tenant es inalcanzable (404). El dispositivo solo puede emitir eventos de su propia organización (verificado server-side por la clave/registro del dispositivo).
- **Revocación de dispositivo:** un dispositivo `revocado` que intente sincronizar → sus eventos se aceptan pero marcados `rechazado` con motivo "dispositivo revocado" (se conservan para auditoría; no se aplican efectos).
- **Errores:** `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409 (duplicado de negocio marcado, frescura excedida, dispositivo revocado), `INTERNAL_ERROR` 500.
- **Auditoría:** `audit_log` con `actorId`, `actorRole`, accion (`offline.sync`, `offline.device.enable/revoke`, `offline.ingreso`, `offline.reconstruct`), entidad, entidadId, organizationId, timestamp, metadata con `event_id` y `folio_externo`. Toda mutación escribe auditoría en la misma transacción.

## 3. Comportamientos BDD y aceptación

```gherkin
Escenario BDD-1: Reenvío idempotente — mismo event_id, efecto una vez (REQ-9, TX-06)
  Dado un dispositivo que sincronizó el evento E (event_id=X) con éxito
  Cuando reintenta sincronizar el mismo event_id=X (reconexión parcial, duplicado de red)
  Entonces el backend NO duplica el efecto (no segundo pago, no segundo movimiento)
  Y responde que el evento ya estaba sincronizado

Escenario BDD-2: Dos event_id para el mismo hecho → ambos conservados y marcados (REQ-9, TX-06)
  Dado un evento con folio_externo=F, tipo=cobro_provisional, monto=$30.000
  Cuando llega un segundo evento con event_id distinto pero misma huella (folio F, tipo y monto)
  Entonces ambos eventos se conservan
  Y el segundo se marca "posible duplicado de negocio" (no se descarta)

Escenario BDD-3: Cobro provisional offline no concede derechos (ADR-0002 §3)
  Dado un cobro_provisional sincronizado desde un dispositivo
  Cuando se consulta la membresía del socio
  Entonces sigue sin cobertura activa (el pago queda provisional)
  Y no hay movimiento de caja hasta la validación humana

Escenario BDD-4: Frescura de instantánea (SPEC:OFF-FRESH)
  Dado un ingreso_contingencia con instantánea capturada hace más del límite configurado (default 72h)
  Cuando el dispositivo sincroniza ese ingreso
  Entonces se rechaza con 409 CONFLICT (frescura excedida)
  Y queda registrado en auditoría

Escenario BDD-5: Dispositivo revocado (D-06 preparación)
  Dado un dispositivo revocado por el admin
  Cuando el dispositivo intenta sincronizar eventos
  Entonces los eventos se conservan marcados "rechazado: dispositivo revocado"
  Y no se aplica ningún efecto

Escenario BDD-6: Aislamiento y portal (REQ-1, REQ-7)
  Dado un dispositivo de la organización A
  Cuando intenta sincronizar un evento con organizationId de B
  Entonces recibe 404/403 según corresponda (no filtra existencia entre tenants)

Escenario BDD-7: Reconstrucción auditable (SPEC:OFF-RECON)
  Dada la cadena de offline_events + audit_log de un dispositivo
  Cuando se ejecuta la reconstrucción del tenant
  Entonces se reproduce el estado sincronizado y se verifica la integridad de la cadena
  Y cualquier hueco o manipulación de hash queda detectado

Escenario BDD-8: Sin offline para validar/firmar (prohibición)
  Dado cualquier evento offline
  Cuando llega al backend
  Entonces nunca valida un pago ni activa derechos por sí solo
  Y siempre requiere la validación humana de la Entrega 2 para el dinero
```

## 4. Diseño de datos (borrador)

- `devices` (org, accountId operador, etiqueta, estado `habilitado|revocado`, clavePublica, createdAt)
- `offline_events` (org, eventId UUID del dispositivo, deviceId, tipo `cobro_provisional|ingreso_contingencia|excepcion`, folioExterno, actorId, cashSessionId?, capturedAt del dispositivo, payload jsonb, amountCents?, estado `pendiente|sincronizado|rechazado|duplicado_negocio`, prevHash, hash, createdAt) — unique `(organizationId, eventId)`; índice `(organizationId, folioExterno, tipo, amountCents)` para detección de duplicado de negocio; hash encadenado para integridad.
- `membership_snapshots` (org, memberId, estadoCobertura, capturedAt, deviceId?, valida) — instantánea de membresía para ingreso de contingencia con control de frescura.
- Índices/constraints: unique `(organizationId, eventId)`; unique parcial de huella de negocio **no** se impone (se marca, no se bloquea, para no perder evidencia); índice por `(org, deviceId, createdAt)` para reconstrucción.
- Config: `organizations.offline_freshness_hours` (integer, default 72 — valor de trabajo, sustituible) y `organizations.offline_enabled` (boolean) para habilitar el permiso por organización.

## 5. Plan de implementación y verificación

- **Backend primero** (disciplina de 002/003/004): migración (devices, offline_events, membership_snapshots + config en organizations); contratos Zod (RegisterDeviceRequest, SyncEventsRequest/Response, OfflineEvent, IngressContingenciaRequest, ReconstructRequest/Response); servicios (`devices`, `offline` sync/reconstruct); rutas v1 (`POST /devices`, `PATCH /devices/:id/revoke`, `POST /offline/sync`, `GET /offline/events`, `POST /offline/ingreso`, `POST /offline/reconstruct`); tests de integración contra Postgres real con los 8 escenarios BDD, incluyendo **concurrencia real** de sync (dos lotes con el mismo event_id simultáneos → un efecto; dos event_id misma huella → ambos + marca).
- **UI (cliente offline) después**, ya con las decisiones de estructura del usuario: IndexedDB outbox, cola de reenvío, indicadores de frescura, y el rediseño estructural acordado. El lado cliente queda fuera de esta spec (backend primero).
- **Cobertura (CAL-2):** ≥80% en el módulo offline (idempotencia, frescura, duplicado de negocio).
- **Gate y DoD** por unidad (scripts/verify.sh); evidencia real adjunta.

## 6. Criterios de aceptación

- CA-1 (TX-06): mismo event_id reenviado → efecto una vez (test de concurrencia real: dos sync simultáneos del mismo event_id → un efecto).
- CA-2 (TX-06): dos event_id con misma huella de negocio → ambos conservados, segundo marcado `duplicado_negocio`.
- CA-3 (REQ-2/prohibición): cobro_provisional offline → pago provisional sin movimiento de caja ni cobertura, hasta validación humana.
- CA-4 (SPEC:OFF-FRESH): ingreso_contingencia con instantánea vencida (frescura excedida) → 409.
- CA-5: dispositivo revocado → eventos conservados y marcados rechazado, sin efectos.
- CA-6 (REQ-1/REQ-7): aislamiento cross-tenant (404/403); dispositivo solo emite para su organización.
- CA-7 (SPEC:OFF-RECON): reconstrucción reproduce el estado y verifica la cadena de hashes (detección de hueco/manipulación).
- CA-8: auditoría de toda mutación offline en la misma transacción, con event_id y folio_externo.
- CA-9 (MVP-SAUNA-01/B): cero tablas/servicios/rutas de sauna.
