# Spec 024 — Custodia, pérdida/revocación diferida y panel de reconstrucción de equipos offline (P-09.3) + revocación en Team.tsx

Estado: Abierta — lista para implementación (Ola 1 G2)
Nivel: Tier 1 — custodia y revocación diferida de dispositivos offline (`REQ-9`, `ADR 0007`), integridad de cadena de eventos (`SPEC:OFF-RECON`) y revocación administrativa de sesiones en equipos compartidos (`REQ-11`).
Autoridad: decisión explícita del usuario 2026-10-19 (`A1`, `A2`); [PRD.md](../PRD.md) `REQ-1`, `REQ-9`, `REQ-11`, `CAL-1`, `CAL-3`; [ADR 0002](../docs/adr/0002-arquitectura-base.md), [ADR 0007](../docs/adr/0007-offline-cliente.md) y [ADR 0012](../docs/adr/0012-controles-operativos-juridicos-g2.md). Commits locales autorizados; revisión humana al cierre.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:005-offline-controlado, SPEC:006-revocacion-backup, SPEC:010-app-operativa

## 1. Objetivo y alcance

- **Resultado observable:**
  1. **Custodia y baja por pérdida/robo de equipos offline (`P-09.3`):** El modelo `devices` y sus endpoints permiten registrar la referencia de custodia (`custodyReference`, `custodyConfirmedAt`) al habilitar un equipo y exigir motivo estructurado (`revokedReason`: `"rotacion" | "perdida_robo" | "baja_operador" | "otro"`) y nota (`revokedNotes`) al revocarlo (`POST /api/v1/devices/:id/revoke`). Si un equipo revocado por pérdida o robo reconecta más tarde e intenta sincronizar su outbox (`POST /api/v1/offline/lease/sync`), todos sus eventos se conservan como evidencia con estado `rechazado` e incluyen en `rejectReason` el motivo de revocación (`dispositivo revocado (perdida_robo)`), sin activar membresías ni crear pagos/movimientos de caja.
  2. **Panel de reconstrucción e inspección de cadena (`SPEC:OFF-RECON`) en `Offline.tsx`:** La vista de administración en `Offline.tsx` permite elegir cualquier dispositivo del gimnasio, ejecutar la verificación de cadena de hashes (`POST /api/v1/offline/reconstruct`) y visualizar los eventos recibidos por el servidor (`GET /api/v1/offline/events`) con su folio externo, estado (`sincronizado`, `duplicado_negocio`, `rechazado`) y motivo de rechazo.
  3. **Revocación individual y total de sesiones en `Team.tsx` (`REQ-11`):** Corrige `api.revokeSession(accountId, sessionId)` en `apps/web/src/api.ts` y `apps/web/src/pages/Team.tsx` para enviar `{ accountId, sessionId }` conforme a `RevokeSessionRequest`, y añade el botón «Cerrar todas las sesiones» (`POST /api/v1/admin/sessions/revoke-all` vía `api.revokeAllSessions(accountId)`).
- **Incluye:** migración aditiva `0019_device_custody_loss.sql`, actualización de `devices` en `packages/db/src/schema.ts`, contratos `RegisterDeviceRequest` / `RevokeDeviceRequest` / `DeviceDetail` en `@gym/contracts`, actualización de `OfflineService` y rutas en `apps/api/src/app.ts`, UI en `Offline.tsx` y `Team.tsx`, y suites de prueba en API y Web.
- **Excluye:** borrado físico de eventos offline (prohibido por `ADR 0007`: siempre se conservan para auditoría) y alteración del cifrado AES-GCM en IndexedDB.

## 2. Contratos e invariantes

- **Esquema `devices` (`0019_device_custody_loss.sql`):**
  - Añade columnas opcionales en `devices`:
    - `custody_reference text` (ej. acta o identificador físico del equipo asignado).
    - `custody_confirmed_at timestamp with time zone`.
    - `revoked_reason text` (`'rotacion' | 'perdida_robo' | 'baja_operador' | 'otro'`).
    - `revoked_notes text`.
- **Contratos HTTP (`@gym/contracts`):**
  - `DeviceRevokeReason = z.enum(["rotacion", "perdida_robo", "baja_operador", "otro"])`.
  - `RegisterDeviceRequest`: admite `custodyReference: z.string().trim().min(1).max(200).optional()`. Si se envía, `OfflineService.registerDevice` sella `custodyConfirmedAt = new Date()`.
  - `RevokeDeviceRequest = z.object({ reason: DeviceRevokeReason.default("otro"), notes: z.string().trim().max(500).optional() }).optional()` (retrocompatible cuando el body viene vacío `{}`).
- **Invariantes (`OfflineService` y `SessionRevocation`):**
  - Aislamiento multi-tenant (`REQ-1`): revocar o reconstruir un `deviceId` de otra organización responde `404 NOT_FOUND`.
  - En `revokeDevice`, registra en `audit_log` la acción `offline.device.revoke` con `{ reason, notes }` en la misma transacción.
  - En `syncLeased` / `sync`, cuando `device.state === "revocado"`, cada evento se persiste con `state: "rechazado"` y `rejectReason` que incluye `device.revokedReason` si existe (ej. `"Dispositivo revocado (perdida_robo)"`).
  - En `Team.tsx`, `api.revokeSession(target.id, revoke.id)` envía `{ accountId: target.id, sessionId: revoke.id }` y `api.revokeAllSessions(target.id)` envía `{ accountId: target.id }`.

## 3. Comportamientos BDD y criterios verificables

```gherkin
Escenario BDD-1: Custodia y revocación diferida por pérdida/robo conservando evidencia sin efectos
  Dado un dispositivo habilitado con custodyReference "ACTA-EQ-01" en Gimnasio A
  Cuando el admin lo revoca con reason="perdida_robo" y notes="Extraviado en recepción"
  Y el dispositivo intenta sincronizar un cobro_provisional rezagado al reconectar
  Entonces el dispositivo queda con state="revocado", revokedReason="perdida_robo"
  Y el evento se conserva en offline_events con state="rechazado" y sin crear pago ni movimiento de caja
  Y la reconstrucción POST /api/v1/offline/reconstruct confirma chainIntact=true

Escenario BDD-2: Revocación de sesión individual y global desde Team.tsx
  Dado un miembro del staff con sesiones activas en el diálogo de Team.tsx
  Cuando el admin revoca una sesión individual o pulsa "Cerrar todas las sesiones"
  Entonces el cliente invoca /api/v1/admin/sessions/revoke con { accountId, sessionId } o /revoke-all con { accountId }
  Y la lista de sesiones se actualiza inmediatamente
```

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-1, REQ-9 | `registerDevice` registra `custodyReference`/`custodyConfirmedAt`; `revokeDevice` guarda `revokedReason`/`revokedNotes`, audita en la misma transacción y rechaza IDs de otro tenant con `404`. | `apps/api/src/offline.integration.test.ts` |
| CA-2 | REQ-9 | Eventos sincronizados desde un dispositivo revocado por `perdida_robo` quedan en estado `rechazado` con el motivo en `rejectReason`, sin generar pagos ni activar derechos, y `reconstruct` verifica `chainIntact: true`. | `apps/api/src/offline.integration.test.ts` |
| CA-3 | REQ-9 | `Offline.tsx` permite al `admin` registrar `custodyReference`, seleccionar motivo al revocar e inspeccionar la reconstrucción (`chainIntact`, `eventsChecked`) y la tabla de eventos del servidor. | `apps/web/src/offline-custody.test.tsx` |
| CA-4 | REQ-11 | `Team.tsx` y `api.ts` envían `{ accountId, sessionId }` al revocar una sesión e incorporan revocación total (`revoke-all`) por cuenta. | `apps/web/src/offline-custody.test.tsx` + `apps/api/src/session-revocation.integration.test.ts` |
| CA-5 | CAL-1 | `./scripts/verify.sh` en verde sin errores de lint, tipos, build ni tests. | `./scripts/verify.sh` |

## 4. Archivos autorizados

- STATE.md
- apps/api/src/app.ts
- apps/api/src/offline.integration.test.ts
- apps/api/src/services/offline.ts
- apps/api/src/session-revocation.integration.test.ts
- apps/web/src/api.ts
- apps/web/src/offline-custody.test.tsx
- apps/web/src/pages/Offline.tsx
- apps/web/src/pages/Team.tsx
- docs/adr/0012-controles-operativos-juridicos-g2.md
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0019_device_custody_loss.sql
- packages/db/drizzle/meta/_journal.json
- packages/db/src/index.ts
- packages/db/src/schema.ts
- specs/024-custodia-reconstruccion-offline-g2.md

## 5. Verificación y DoD

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Comandos de cierre:** `pnpm --filter @gym/api exec vitest run src/offline.integration.test.ts src/session-revocation.integration.test.ts`, `pnpm --filter @gym/web exec vitest run src/offline-custody.test.tsx` y `./scripts/verify.sh`.

## 6. Evidencia y checkpoint

- Pendiente de ejecución por el agente asignado a la Issue de la Unidad `024`.
