# Spec 021 — Vínculo de menores a adulto responsable (D-05), adaptador de correo configurable y cierre de contratos (CAL-3)

Estado: Aprobada — base validada por el usuario; lista para fase roja e implementación tras Unidad 020
Nivel: Tier 1 — privacidad y representación de menores (`D-05`), transporte de correo de identidad/contacto y auditoría completa de contratos HTTP (`CAL-3`).
Autoridad: validación explícita del usuario 2026-10-19 (`A5`); [PRD.md](../PRD.md) `REQ-1`, `REQ-2`, `REQ-7`, `REQ-11`, `CAL-3`; [ADR 0002](../docs/adr/0002-arquitectura-base.md) y [ADR 0010](../docs/adr/0010-ciclo-comercial-agenda-exportaciones.md). Commits locales autorizados; revisión humana al cierre.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:002-auth-tenant-socios, SPEC:015-recuperacion-contacto

## 1. Objetivo y alcance

- **Resultado observable:**
  1. **Menores (`D-05`):** En alta y edición de socios (`members`), staff (`admin`/`recepcion`) puede registrar a un socio menor vinculado obligatoriamente a un `adultResponsibleId` válido del mismo gimnasio (socio adulto existente en la misma organización). Un socio con `adultResponsibleId` no puede ser designado como adulto responsable de otro menor ni modificar por sí mismo su correo de contacto en el portal (`403`/`409`: la gestión de contacto recae en staff/adulto responsable).
  2. **Adaptador de entrega de correo (`REQ-7`, `015`):** `apps/api/src/email-delivery.ts` incorpora un adaptador configurable por variables de entorno (`EMAIL_DELIVERY_MODE=disabled|webhook_or_smtp`, `EMAIL_FROM`, `EMAIL_WEBHOOK_URL` / transporte HTTP/SMTP sin añadir dependencias no autorizadas y apagado por defecto `disabled` en dev/CI), activando `GET /api/v1/account/email-capabilities` solo cuando la configuración esté completa y probando timeouts, aislamiento de fallos y cero exposición de tokens en logs.
  3. **Cierre documental `CAL-3`:** `docs/api/README.md` documenta el 100% de los endpoints `v1` implementados (`001`–`021`) con esquemas de entrada/salida, códigos de error estables, permisos por rol e `idempotencyKey`.
- **Incluye:** migración aditiva `0017_minor_guardian_constraints.sql`, contratos `CreateMemberRequest`/`UpdateMemberRequest`/`MemberDetail` en `@gym/contracts`, validaciones en `MembersService` y `ContactVerificationService`, adaptador en `email-delivery.ts`, UI en `Panel.tsx`, `MemberDetail.tsx` y `Portal.tsx`, `.env.example` con variables ficticias y actualización exhaustiva de `docs/api/README.md`.
- **Excluye:** portal delegado multi-hijo (excluido expresamente en `PRD.md` v1.0), ingreso de datos reales de menores sin la validación jurídica `G2` y credenciales reales en el repositorio.

## 2. Contratos e invariantes

- **Gestión de adulto responsable (`MembersService`):**
  - `CreateMemberRequest` y `UpdateMemberRequest` admiten `{ isMinor?: boolean, adultResponsibleId?: UUID | null }`.
  - Invariantes:
    1. Si `isMinor === true`, `adultResponsibleId` es obligatorio (`400` si falta). Si `adultResponsibleId` se envía con UUID, `isMinor` se asume `true`.
    2. `adultResponsibleId` debe existir en `members` dentro del **mismo** `organizationId` (`404` si no existe o pertenece a otro tenant), no puede ser el propio `member.id` (`400`) y el socio responsable no puede tener a su vez `adultResponsibleId !== null` (un menor no puede ser adulto responsable de otro menor → `409 INVALID_ADULT_RESPONSIBLE`).
    3. Un socio que es `adultResponsibleId` de algún menor no puede ser marcado como menor (`409`).
    4. En `ContactVerificationService.requestVerification` y `PATCH /api/v1/members/:id`, si el actor es `socio` y su ficha tiene `adultResponsibleId !== null`, el servidor rechaza con `403 MINOR_CONTACT_MANAGED_BY_GUARDIAN` cualquier intento de cambiar o eliminar el correo de contacto por autogestión.
- **Adaptador de entrega de correo (`email-delivery.ts`):**
  - Por defecto `EMAIL_DELIVERY_MODE=disabled` (conserva `passwordReset: false, contactVerification: false`).
  - Cuando `EMAIL_DELIVERY_MODE=http` (o transporte configurado con `EMAIL_TRANSPORT_URL` y `EMAIL_FROM` válidos), construye un `EmailTransport` con `AbortSignal.timeout(5000)`, sin reintentos ciegos que dupliquen tokens y sin registrar jamás el enlace o token en logs.
- **Verificación de `CAL-3`:**
  - Prueba automatizada verifica que cada ruta registrada en `apps/api/src/app.ts` bajo `/api/v1/` esté documentada en `docs/api/README.md` con método, ruta, roles y códigos de estado.

## 3. Comportamientos BDD y criterios verificables

```gherkin
Escenario BDD-1: Alta de socio menor exige adulto responsable del mismo gimnasio y bloquea autogestión de contacto
  Dado un socio adulto Ana en el Gimnasio Norte y un socio adulto Pedro en el Gimnasio Sur
  Cuando recepción del Gimnasio Norte intenta registrar a un menor sin adultResponsibleId o apuntando a Pedro (otro tenant)
  Entonces recibe 400 (sin adulto) o 404 (otro tenant)
  Cuando lo registra vinculando a Ana (mismo tenant)
  Entonces el menor queda creado con adultResponsibleId = Ana.id y si inicia sesión en el portal no puede autogestionar cambio de correo (403)
```

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-1, REQ-2, REQ-11 | Alta/edición de menor valida `adultResponsibleId` del mismo tenant, impide auto-referencia o cadena menor→menor (`400`/`409`) y devuelve `404` ante ID de otro tenant. | `apps/api/src/members.integration.test.ts` + `packages/contracts/src/contracts.test.ts` |
| CA-2 | REQ-7, REQ-11 | Socio menor autenticado no puede solicitar verificación ni borrar contacto en autogestión (`403`); staff (`admin`/`recepcion`) sí puede actualizar contacto del menor auditando el cambio. | `apps/api/src/account-recovery.integration.test.ts` + `apps/api/src/members.integration.test.ts` |
| CA-3 | REQ-7, REQ-11 | Adaptador de correo en `email-delivery.ts` permanece deshabilitado por defecto, activa capacidades cuando se configura con endpoint local de prueba, aplica timeout y falla de forma segura (`503`) sin filtrar enlaces ni tokens. | `apps/api/src/account-recovery.integration.test.ts` |
| CA-4 | REQ-2, REQ-7 | UI en `Panel.tsx` / `MemberDetail.tsx` permite seleccionar adulto responsable y muestra vínculo en ficha y `Portal.tsx` (ocultando edición de contacto para menor). | `apps/web/src/minors-guardian.test.tsx` + `tests/e2e/account.spec.ts` |
| CA-5 | CAL-1, CAL-3 | `docs/api/README.md` cubre el 100% de las rutas `/api/v1/*` verificadas por test de consistencia documental; `./scripts/verify.sh` verde sin omitidos. | `apps/api/src/api-docs-sync.test.ts` + `./scripts/verify.sh` |

## 4. Archivos autorizados

- .env.example
- STATE.md
- apps/api/src/account-recovery.integration.test.ts
- apps/api/src/api-docs-sync.test.ts
- apps/api/src/app.ts
- apps/api/src/email-delivery.ts
- apps/api/src/members.integration.test.ts
- apps/api/src/memberships-lifecycle.integration.test.ts
- apps/api/src/operations.integration.test.ts
- apps/api/src/partial-payments.integration.test.ts
- apps/api/src/services/booking-credits.ts
- apps/api/src/services/bookings.ts
- apps/api/src/services/cash.ts
- apps/api/src/services/checkin.ts
- apps/api/src/services/contact-verification.ts
- apps/api/src/services/financial-adjustments.ts
- apps/api/src/services/members.ts
- apps/api/src/services/memberships.ts
- apps/api/src/services/operations.ts
- apps/api/src/services/payments.ts
- apps/api/src/services/plans.ts
- apps/api/src/services/sessions.ts
- apps/api/src/sessions-reschedule.integration.test.ts
- apps/web/src/api.ts
- apps/web/src/components/CreditPeriods.tsx
- apps/web/src/components/QuickPay.tsx
- apps/web/src/memberships-lifecycle.test.tsx
- apps/web/src/minors-guardian.test.tsx
- apps/web/src/pages/Cash.tsx
- apps/web/src/pages/Classes.tsx
- apps/web/src/pages/MemberDetail.tsx
- apps/web/src/pages/Panel.tsx
- apps/web/src/pages/Payments.tsx
- apps/web/src/pages/Plans.tsx
- apps/web/src/pages/Portal.tsx
- apps/web/src/pages/Reports.tsx
- apps/web/src/pages/SessionDetail.tsx
- apps/web/src/partial-payments.test.tsx
- apps/web/src/reports-export.test.tsx
- apps/web/src/sessions-reschedule.test.tsx
- docs/adr/0010-ciclo-comercial-agenda-exportaciones.md
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0014_catalog_pauses_plan_changes.sql
- packages/db/drizzle/0015_session_reschedule.sql
- packages/db/drizzle/0016_partial_payments_reconciliation.sql
- packages/db/drizzle/0017_minor_guardian_constraints.sql
- packages/db/drizzle/meta/_journal.json
- packages/db/src/index.ts
- packages/db/src/schema.ts
- scripts/coverage.mjs
- specs/017-catalogo-pausas-cambio-plan.md
- specs/018-reprogramacion-agenda-citas.md
- specs/019-abonos-parciales-conciliacion.md
- specs/020-exportaciones-operativas-csv.md
- specs/021-menores-correo-contratos.md
- specs/022-aceptacion-ci-staging.md
- tests/e2e/account.spec.ts
- tests/e2e/credits.spec.ts
- tests/e2e/operation.spec.ts

## 5. Verificación, DoD y reversión

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Secuencia TDD en sesión de codificación:** pruebas rojas en `members.integration.test.ts`, `account-recovery.integration.test.ts`, `api-docs-sync.test.ts` y `minors-guardian.test.tsx` → migración `0017_minor_guardian_constraints.sql`, servicios, UI y `docs/api/README.md` → `./scripts/verify.sh`, `pnpm test:coverage` y `pnpm test:e2e`.
- **Revisión Tier 1:** revisión humana del usuario al cierre; datos reales de menores siguen prohibidos hasta superar validación jurídica de `G2`.

## 6. Evidencia y checkpoint

- **Estado actual:** Spec validada y registrada en la sesión de planificación de base (2026-10-19). Pendiente de fase roja e implementación tras Unidad `020`.
