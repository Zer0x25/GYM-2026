# Spec 025 — Consentimiento documental de adulto responsable para menores (D-05) y política por organización

Estado: Abierta — lista para implementación (Ola 1 G2)
Nivel: Tier 1 — privacidad y representación jurídica de menores (`D-05`), control de habilitación por organización y trazabilidad de consentimiento firmado (`REQ-2`, `REQ-7`, `REQ-11`).
Autoridad: decisión explícita del usuario 2026-10-19 (`A1`, `A2`); [PRD.md](../PRD.md) `REQ-1`, `REQ-2`, `REQ-7`, `REQ-11`, `CAL-1`, `CAL-3`; [ADR 0002](../docs/adr/0002-arquitectura-base.md), [ADR 0011](../docs/adr/0011-arranque-piloto-g2-empaquetado-controles.md) y [ADR 0012](../docs/adr/0012-controles-operativos-juridicos-g2.md). Commits locales autorizados; revisión humana al cierre.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3
Trazabilidad: SPEC:002-auth-tenant-socios, SPEC:021-menores-correo-contratos, SPEC:023-empaquetado-produccion-bootstrap-g2

## 1. Objetivo y alcance

- **Resultado observable:**
  1. **Política de registro de menores por organización (`GET/POST /api/v1/members/minor-policy`):** Cada organización posee el indicador `minorRegistrationEnabled` (default `true` en desarrollo/test cuando `ALLOW_MINOR_MEMBERS` no es `"false"`, pero gobernable por el `admin` del gimnasio). Si a nivel servidor `ALLOW_MINOR_MEMBERS=false` (`ADR 0011`), la política efectiva devuelve `enabled: false, serverLocked: true` y bloquea toda alta/conversión de menores con `409 MINOR_REGISTRATION_DISABLED`. Cuando el servidor lo permite (`ALLOW_MINOR_MEMBERS=true` o no fijado en `"false"`), el `admin` puede activar/desactivar la política para su organización, auditando `member.minor_policy.updated`.
  2. **Evidencia documental de consentimiento del adulto responsable (`D-05`):** Cuando se registra o convierte a un socio como menor (`isMinor: true` o `adultResponsibleId` no nulo), se admite/exige la referencia del documento/acta firmada por el adulto responsable (`guardianConsentRef`, ej. `"ACTA-2026-0042"`) y el servidor sella automáticamente `guardianConsentAt` y audita `member.minor_consent.recorded` junto con el `adultResponsibleId`.
  3. **Sincronización en UI (`Panel.tsx` y `MemberDetail.tsx`):** La interfaz consulta `GET /api/v1/members/minor-policy`; cuando el registro de menores está deshabilitado, muestra el aviso de restricción de piloto (`D-05`) e impide marcar «Es menor de edad». Cuando está habilitado, permite capturar el folio/referencia de autorización (`guardianConsentRef`) junto con el adulto responsable y lo exhibe en la ficha del socio.
- **Incluye:** migración aditiva `0020_minor_guardian_consent.sql`, columnas en `organizations` y `members` (`packages/db/src/schema.ts`), contratos en `@gym/contracts`, lógica en `MembersService` (`apps/api/src/services/members.ts`), rutas en `apps/api/src/app.ts`, UI en `Panel.tsx` y `MemberDetail.tsx`, y pruebas de integración y UI.
- **Excluye:** portal delegado multi-hijo (fuera de v1.0 según `PRD.md`).

## 2. Contratos e invariantes

- **Esquema (`0020_minor_guardian_consent.sql`):**
  - `organizations.minor_registration_enabled boolean NOT NULL DEFAULT true`.
  - `members.guardian_consent_ref text`.
  - `members.guardian_consent_at timestamp with time zone`.
- **Contratos (`@gym/contracts`):**
  - `MinorPolicyResponse = z.object({ enabled: z.boolean(), orgEnabled: z.boolean(), serverLocked: z.boolean() })`.
  - `UpdateMinorPolicyRequest = z.object({ enabled: z.boolean() })`.
  - `CreateMemberRequest` y `UpdateMemberRequest`: añaden `guardianConsentRef: z.string().trim().min(1).max(200).nullable().optional()`.
  - `MemberDetail`: añade `guardianConsentRef: z.string().nullable().optional()` y `guardianConsentAt: z.string().nullable().optional()`.
- **Invariantes (`MembersService`):**
  - La política efectiva es `enabled = !serverLocked && org.minorRegistrationEnabled`, donde `serverLocked = process.env.ALLOW_MINOR_MEMBERS === "false" || process.env.ALLOW_MINOR_MEMBERS === "0"`.
  - Si `enabled === false`, cualquier alta o actualización que deje `adultResponsibleId !== null` o `isMinor === true` lanza `409 MINOR_REGISTRATION_DISABLED`.
  - Si un socio pasa a tener `adultResponsibleId !== null` y se envía `guardianConsentRef`, se guarda limpio y se sella `guardianConsentAt = new Date()`. Si ya tenía `guardianConsentRef` o no se envía en flujos legacy, si se proporciona se actualiza y audita; si el socio deja de ser menor (`isMinor: false`), se limpian `adultResponsibleId`, `guardianConsentRef` y `guardianConsentAt`.
  - `POST /api/v1/members/minor-policy` requiere rol `admin`; si `serverLocked === true` e intenta habilitar (`enabled: true`), responde `409 MINOR_REGISTRATION_DISABLED`.

## 3. Comportamientos BDD y criterios verificables

```gherkin
Escenario BDD-1: Bloqueo por política de organización o servidor y registro de consentimiento D-05
  Dado un gimnasio con minorRegistrationEnabled=false
  Cuando recepción intenta registrar un menor con adultResponsibleId válido
  Entonces recibe 409 MINOR_REGISTRATION_DISABLED
  Cuando el admin habilita minorRegistrationEnabled=true (con ALLOW_MINOR_MEMBERS!=false)
  Y recepción registra al menor indicando adultResponsibleId y guardianConsentRef="ACTA-MENOR-101"
  Entonces el menor queda creado con guardianConsentRef="ACTA-MENOR-101" y guardianConsentAt sellado
  Y se registra auditoría en audit_log
```

| ID | Requisito PRD | Criterio verificable | Verificación prevista |
|---|---|---|---|
| CA-1 | REQ-1, REQ-2, REQ-11 | `GET/POST /api/v1/members/minor-policy` respeta aislamiento por tenant, solo `admin` modifica, y `ALLOW_MINOR_MEMBERS=false` impone `serverLocked: true` rechazando activación con `409`. | `apps/api/src/members.integration.test.ts` |
| CA-2 | REQ-2, REQ-7, REQ-11 | Al crear o editar un menor con política activa, se persisten `guardianConsentRef` y `guardianConsentAt`, se proyectan en `MemberDetail` y se limpian si pasa a adulto. | `apps/api/src/members.integration.test.ts` + `packages/contracts/src/contracts.test.ts` |
| CA-3 | REQ-2, REQ-7 | `Panel.tsx` y `MemberDetail.tsx` reflejan el estado de `minorPolicy` (bloqueando alta de menor si `enabled=false` o permitiendo editar política y `guardianConsentRef` si `enabled=true`). | `apps/web/src/minors-guardian.test.tsx` |
| CA-4 | CAL-1 | `./scripts/verify.sh` en verde sin errores de lint, tipos, build ni tests. | `./scripts/verify.sh` |

## 4. Archivos autorizados

- STATE.md
- apps/api/src/app.ts
- apps/api/src/members.integration.test.ts
- apps/api/src/services/members.ts
- apps/web/src/api.ts
- apps/web/src/minors-guardian.test.tsx
- apps/web/src/pages/MemberDetail.tsx
- apps/web/src/pages/Panel.tsx
- docs/adr/0012-controles-operativos-juridicos-g2.md
- docs/api/README.md
- docs/learning.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0020_minor_guardian_consent.sql
- packages/db/drizzle/meta/_journal.json
- packages/db/src/index.ts
- packages/db/src/schema.ts
- specs/025-consentimiento-menores-d05-g2.md

## 5. Verificación y DoD

- **DoD común:** [AGENTS.md](../AGENTS.md) §9.
- **Comandos de cierre:** `pnpm --filter @gym/api exec vitest run src/members.integration.test.ts`, `pnpm --filter @gym/web exec vitest run src/minors-guardian.test.tsx` y `./scripts/verify.sh`.

## 6. Evidencia y checkpoint

- Pendiente de ejecución por el agente asignado a la Issue de la Unidad `025`.
