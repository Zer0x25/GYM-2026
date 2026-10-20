# ADR 0012 — Controles operativos y jurídicos para piloto G2: custodia offline, consentimiento de menores (D-05), soporte temporal (D-06) y diagnóstico de producción

- **Fecha:** 2026-10-19
- **Estado:** Aceptado por el usuario (selección explícita de las unidades `024..027` y olas de ejecución para G2).
- **Relacionado:** [PRD.md](../../PRD.md) (`REQ-1`, `REQ-2`, `REQ-7`, `REQ-9`, `REQ-11`, `CAL-1`, `CAL-3`), [ADR 0002](./0002-arquitectura-base.md), [ADR 0007](./0007-offline-cliente.md), [ADR 0010](./0010-ciclo-comercial-agenda-exportaciones.md), [ADR 0011](./0011-arranque-piloto-g2-empaquetado-controles.md) y [Spec 023](../../specs/023-empaquetado-produccion-bootstrap-g2.md).

## 1. Decisiones confirmadas para el cierre de la preparación G2

1. **Custodia, pérdida/revocación diferida y panel de reconstrucción de equipos offline (`P-09.3` — Spec 024):**
   - Extender el ciclo de vida de `devices` (`packages/db/src/schema.ts`, migración `0019_device_custody_loss.sql`) con metadatos de custodia y baja por pérdida/robo: `revokedReason` (`"rotacion" | "perdida_robo" | "baja_operador" | "otro"`), `revokedNotes`, `custodyConfirmedAt` y `custodyReference`.
   - En `POST /api/v1/devices/:id/revoke`, exigir o aceptar motivo estructurado y nota opcional, registrando `offline.device.revoke` en `audit_log` con dichos metadatos. Cuando un dispositivo en estado `revocado` sincroniza eventos rezagados (`POST /api/v1/offline/lease/sync`), el servidor sigue conservándolos como `rechazado` (sin efectos financieros ni de cobertura) y adjunta el motivo de revocación para revisión humana.
   - En `Offline.tsx`, incorporar para `admin` el panel de **Auditoría y reconstrucción de cadena (`SPEC:OFF-RECON`)** que consume `GET /api/v1/offline/events` y `POST /api/v1/offline/reconstruct`, mostrando el resultado de integridad (`eventsChecked`, `chainIntact`, `brokenAt`) y el listado de eventos sincronizados/duplicados/rechazados por equipo.
   - Corregir en `apps/web/src/api.ts` y `apps/web/src/pages/Team.tsx` la firma de `api.revokeSession(accountId, sessionId)` y añadir la acción `api.revokeAllSessions(accountId)` (`POST /api/v1/admin/sessions/revoke-all`) para que la revocación administrativa en equipos compartidos cumpla el contrato `RevokeSessionRequest` (`{ accountId, sessionId }`).

2. **Consentimiento documental de adulto responsable (`D-05`) y política de menores por organización (Spec 025):**
   - Extender `organizations` y `members` (`packages/db/src/schema.ts`, migración `0020_minor_guardian_consent.sql`):
     - `organizations.minorRegistrationEnabled` (`boolean`, default `false`): permite que `admin` consulte y conmute la habilitación de menores para su organización (`GET/POST /api/v1/members/minor-policy`) únicamente cuando el entorno del servidor lo autorice (`ALLOW_MINOR_MEMBERS !== "false"`), o bien operar bajo la guarda global.
     - `members.guardianConsentRef` (`text`, folio/referencia del acta o autorización firmada por el adulto responsable) y `members.guardianConsentAt` (`timestamp with time zone`).
   - Cuando se da de alta o convierte a un socio en menor (`isMinor: true` / `adultResponsibleId` presente) con registro de menores habilitado, exigir `guardianConsentRef` no vacío (`1..200` caracteres) además de `adultResponsibleId` válido del mismo tenant, sellando `guardianConsentAt` en el servidor y auditando `member.minor_consent.recorded` en la misma transacción.
   - En `Panel.tsx` y `MemberDetail.tsx`, consultar la política de menores y deshabilitar/ocultar el alta de menores con aviso claro cuando esté desactivada (`ALLOW_MINOR_MEMBERS=false` o política de organización apagada), y solicitar el folio de consentimiento (`guardianConsentRef`) cuando esté habilitada.

3. **Acceso temporal de soporte (`D-06`) con expiración estricta y auditoría inmutable (Spec 026):**
   - Materializar la tabla `support_access_grants` (`packages/db/src/schema.ts`, migración `0021_support_access_grants.sql`) con aislamiento por `organizationId`: `id`, `organizationId`, `grantedByAccountId`, `supportEmail`, `reason`, `scope` (`"read_only" | "diagnostic"`), `tokenHash` (SHA-256 del token efímero de un solo uso o portador temporal, nunca el token en claro), `expiresAt` (máximo 24 horas), `revokedAt`, `revokedByAccountId`, `lastUsedAt` y `createdAt`.
   - Solo un `admin` del gimnasio puede otorgar (`POST /api/v1/admin/support-grants`), listar (`GET /api/v1/admin/support-grants`) o revocar (`POST /api/v1/admin/support-grants/:id/revoke`) una concesión temporal para su propia organización, exigiendo motivo (`reason`) y duración acotada (`15` a `1440` minutos).
   - Proveer el endpoint de diagnóstico acotado `GET /api/v1/support/diagnostic-summary` autenticado mediante cabecera `x-support-grant-token` que verifica hash, vigencia (`expiresAt > now()`), no revocación (`revokedAt IS NULL`), actualiza `lastUsedAt`, registra auditoría `support.diagnostic.read` en `audit_log` del gimnasio y devuelve únicamente metadatos operativos agregados (estado de migraciones, conteos de entidades, salud de cola offline y estado de caja sin exponer contraseñas, tokens QR ni PII sensible).

4. **Diagnóstico operativo de producción, healthchecks profundos y cierre G2 (Spec 027):**
   - Añadir `GET /health/ready` (verifica conectividad real a PostgreSQL `SELECT 1` y estado de configuración crítica sin exponer secretos) y `GET /api/v1/admin/system-status` (solo `admin`, devuelve resumen operativo del tenant: política de menores, modo de correo, política offline, versión y estado de backup/auditoría).
   - Proveer `scripts/smoke-prod.sh` (`bash -n` limpio y ejecutable) para verificar post-despliegue en el VPS (`GET /health`, `GET /health/ready`, cabeceras de seguridad y respuesta del front).
   - Sincronizar el 100% de las rutas nuevas (`024`..`027`) en `docs/api/README.md` (verificado por `api-docs-sync.test.ts`), actualizar `docs/operations/runbook.md` y sellar la matriz G2 en `docs/product/aceptacion-mvp.md` y `STATE.md`.

## 2. Coordinación de agentes en paralelo (Olas G2)

- **Ola 1 (Paralela — 3 worktrees independientes):** `Spec 024` (`0019`), `Spec 025` (`0020`) y `Spec 026` (`0021`). Para evitar conflictos de merge en archivos compartidos (`packages/db/src/schema.ts`, `packages/db/drizzle/meta/_journal.json`, `packages/contracts/src/index.ts`, `apps/api/src/app.ts`, `docs/api/README.md`), la integración a `main` se realiza secuencialmente al terminar cada agente y la sincronización final de `docs/api/README.md` y CI E2E se consolida en la **Ola 2 (`Spec 027`)**.
- **Ola 2 (Secuencial de cierre):** `Spec 027` se ejecuta una vez fusionadas `024`, `025` y `026` en `main`.
