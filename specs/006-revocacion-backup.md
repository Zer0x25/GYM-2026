# Spec: Revocación de sesión y backup/restore (Entrega 5, REQ-11)

> Estado: Aprobada por el usuario 2026-10-12 (backend primero; backup/restore con evidencia real sobre Docker)
> Nivel: Tier 1 — Riesgo alto; justificación: toca seguridad y permisos (revocación de sesiones en equipos compartidos) y continuidad operativa (backup/restore probado antes del piloto); un error deja sesiones vivas tras un despido o deja al gimnasio sin respaldo recuperable.
> Requisitos: REQ-11 (backup/restauración central probado antes del piloto; sesiones de equipo compartido, roles, revocaciones, privacidad y auditoría verificados)
> ADR aplicables: docs/adr/0002-arquitectura-base.md (§2.2 sesiones Better Auth; §3 auditoría)
> Contexto (Notion): PRD §REQ-11; AUTH-01 (equipos compartidos), D-06 (acceso temporal, diferido)
> Trazabilidad: SPEC:REVOKE (revocación de sesión cross-device), SPEC:BACKUP (backup/restore verificado)
> Aceptación: aprobada por el usuario 2026-10-12; Tier 1 → cierre pendiente de revisión humana; commits locales autorizados, sin push.

## 1. Objetivo y alcance

- **Resultado observable:** un administrador ve las **sesiones activas** de una cuenta de su organización y puede **revocar una** o **todas** (al desvincular personal o ante un equipo compartido comprometido); la sesión revocada deja de resolver en el siguiente request (no basta con que expire). En paralelo, existe un **runbook de backup/restore ejecutado y probado en staging** antes de cualquier piloto con datos reales (G2), con evidencia adjunta.
- **Incluye (backend de la Entrega 5, pieza de sesiones de REQ-11):**
  - **Listado de sesiones activas** de una cuenta (admin): sesiones no expiradas de la cuenta, con metadatos útiles (creada, IP, user-agent) para decidir cuál revocar. Scoped al tenant del admin.
  - **Revocación de una sesión** por id (admin): la sesión se elimina server-side; el portador del cookie revocado recibe 401 en el siguiente request.
  - **Revocación masiva** de todas las sesiones de una cuenta (admin): útil al desvincular personal o ante compromiso de equipo compartido (AUTH-01).
  - **Auto-revocación controlada:** una cuenta puede cerrar **otras** sesiones propias (no la actual) — cierra sesiones en dispositivos olvidados sin perder la sesión en uso.
  - **Auditoría:** cada revocación escribe `audit_log` en la misma transacción (`session.revoke`, `session.revoke_all`), con actor, objetivo, organización e IP.
  - **Aislamiento tenant (REQ-1, TX-07):** un admin solo lista/revoca sesiones de cuentas de su propia organización; una cuenta de otro tenant es inalcanzable (404, no 403 — anti-enumeración).
  - **Backup/restore:** runbook reproducible (`pg_dump`/`pg_restore` o `docker compose exec` equivalente) + verificación de restore en staging documentada en `docs/operations/runbook.md`. No es código de aplicación: es procedimiento + evidencia de ejecución.
- **Excluye:** acceso temporal de soporte (D-06, diferido); revocación *proactiva* por inactividad (no requerida; la expiración de 12h ya cubre el piso); rotación obligatoria de contraseñas (no requerida); cifrado de backups en tránsito entre regiones (fuera de v1.0; el backup es a almacenamiento del propio VPS); restauración granular por tabla (el restore es de base completa en staging).
- **Decisiones fundamentadas en el PRD/ADR (repo = fuente de verdad):**
  - **Operar sobre la tabla `session` de Better Auth directamente** (no el plugin admin): el proyecto ya es dueño de su esquema de auth vía el adaptador Drizzle (ADR-0002 §2.2), así que listar/borrar filas de `session` filtradas por `user_id` es el camino más simple y sin superficie extra. La revocación borra la fila → el token deja de resolver de inmediato. Decidido.
  - **La pertenencia al tenant de la cuenta objetivo se resuelve por datos almacenados**, nunca por headers: una cuenta pertenece al org si (a) tiene `staff_assignments` activa en ese org, o (b) su email coincide con un `members.contact_email` de ese org. Sin pertenencia → 404 (no se filtra existencia entre tenants, REQ-1/TX-07). Decidido.
  - **El administrador revoca; la cuenta cierra las suyas salvo la actual:** separación de funciones — nadie revoca la sesión con la que está operando sin querer. Decidido.
  - **Backup/restore es procedimiento verificado, no feature de UI:** REQ-11 pide que esté *probado antes del piloto*, no que el usuario lo dispare desde la app. Decidido.

## 2. Contratos e invariantes

- **Listado de sesiones (REQ-11):** `GET /api/v1/admin/sessions?accountId=` devuelve las sesiones activas de esa cuenta (solo si pertenece al tenant del admin). Cada entrada (`SessionInfo`): `id`, `createdAt`, `expiresAt`, `ipAddress`, `userAgent`. No se exponen tokens.
- **Revocación de una sesión (SPEC:REVOKE):** `POST /api/v1/admin/sessions/revoke` con `{accountId, sessionId}`. Elimina la fila de `session`; idempotente (revocar una ya revocada/no existente → 404). Escribe auditoría.
- **Revocación masiva (SPEC:REVOKE):** `POST /api/v1/admin/sessions/revoke-all` con `{accountId}`. Elimina todas las sesiones de la cuenta. Escribe auditoría con el conteo (`RevokeResult.revoked`).
- **Auto-revocación (SPEC:REVOKE):** `POST /api/v1/me/sessions/revoke-others` cierra todas las sesiones de la cuenta actual excepto la que hace la petición. Cualquier rol autenticado.
- **Aislamiento (REQ-1, TX-07):** todo query filtra por `organizationId` resuelta de la sesión del admin (nunca de un header del cliente). Revocar/listar una cuenta de otro tenant → 404.
- **Autorización (REQ-1, roles):** listar/revocar sesiones ajenas = solo `admin`. Auto-revocación = cualquier cuenta autenticada, solo sobre sí misma. Un `recepcion`/`instructor` no puede revocar sesiones de otros → 403.
- **Backup/restore (SPEC:BACKUP):** el runbook documenta (1) comando de backup completo, (2) comando de restore en una BD de staging limpia, (3) verificación post-restore (conteos de tablas clave, una query de humo por dominio: socios, pagos, sesiones), (4) periodicidad y retención. Evidencia de una ejecución real adjunta en el cierre.
- **Auditoría:** `audit_log` con acción `session.revoke` / `session.revoke_all`, `actorId`, `actorRole`, `entity = "session"`, `entityId` = id de sesión o cuenta objetivo, `organizationId`, IP del actor, timestamp. Toda revocación escribe auditoría en la misma transacción.
- **Errores:** `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404 (cuenta o sesión de otro tenant o inexistente), `INTERNAL_ERROR` 500.

## 3. Comportamientos BDD y aceptación

```gherkin
Escenario BDD-1: Admin revoca una sesión de su organización (SPEC:REVOKE)
  Dado un admin de la organización A con una sesión activa de otra cuenta de A
  Cuando revoca esa sesión por su id
  Entonces la sesión se elimina server-side
  Y el portador de ese cookie recibe 401 en el siguiente request
  Y queda registrado en auditoría (session.revoke)

Escenario BDD-2: Revocación masiva al desvincular personal (SPEC:REVOKE)
  Dado un admin de A y una cuenta de A con 3 sesiones activas en equipos distintos
  Cuando ejecuta revoke-all sobre esa cuenta
  Entonces las 3 sesiones se eliminan
  Y ninguna vuelve a resolver (401)
  Y la auditoría registra session.revoke_all con el conteo

Escenario BDD-3: Auto-revocación de dispositivos olvidados (SPEC:REVOKE)
  Dado una cuenta con sesiones en 2 dispositivos
  Cuando desde uno de ellos pide revoke-others
  Entonces la sesión del otro dispositivo se elimina
  Y la sesión actual sigue siendo válida (no se auto-desloguea)

Escenario BDD-4: Aislamiento cross-tenant (REQ-1, TX-07)
  Dado un admin de la organización A
  Cuando intenta listar o revocar sesiones de una cuenta de la organización B
  Entonces recibe 404 (no filtra existencia entre tenants)

Escenario BDD-5: Separación de funciones (REQ-1)
  Dado un recepcion o instructor
  Cuando intenta revocar sesiones de otra cuenta
  Entonces recibe 403 FORBIDDEN (solo admin revoca ajenas)

Escenario BDD-6: Backup/restore probado (SPEC:BACKUP)
  Dado el procedimiento documentado en el runbook
  Cuando se ejecuta backup y se restaura en una BD de staging limpia
  Entonces el restore completa sin error
  Y la verificación post-restore confirma integridad (conteos + query de humo por dominio)
```

## 4. Diseño de datos (borrador)

- Sin tablas nuevas: las sesiones viven en `session` (Better Auth, ya existe). La revocación borra filas de `session`; la auditoría vive en `audit_log` (ya existe).
- Pertenencia al tenant de una cuenta objetivo (usada por listado y revocación): la cuenta pertenece al org si existe `staff_assignments(accountId, active=true, organizationId=org)` **o** `members(contact_email = identity_accounts.email, organizationId=org)`. Sin match → 404.
- Contratos Zod (`@gym/contracts`): `SessionInfo` (id, createdAt, expiresAt, ipAddress, userAgent), `ListSessionsQuery` (accountId), `RevokeSessionRequest` (accountId, sessionId), `RevokeAllSessionsRequest` (accountId), `RevokeResult` (revoked).

## 5. Plan de implementación y verificación

- **Backend primero** (disciplina 002/003/004/005):
  - Contratos Zod (SessionInfo, ListSessionsQuery, RevokeSessionRequest, RevokeAllSessionsRequest, RevokeResult) en `packages/contracts`.
  - Servicio `session-revocation.ts` (`apps/api/src/services/`): verificación de pertenencia al tenant, listado scoped, revocación unitaria/masiva sobre `session`, auto-revocación "otras sesiones" (conserva la actual), auditoría en la misma transacción.
  - Rutas v1 en `app.ts`: `GET /api/v1/admin/sessions`, `POST /api/v1/admin/sessions/revoke`, `POST /api/v1/admin/sessions/revoke-all`, `POST /api/v1/me/sessions/revoke-others`.
  - Runbook de backup/restore en `docs/operations/runbook.md` + ejecución real de verificación en staging (evidencia adjunta al cierre).
  - Tests de integración contra Postgres real: BDD-1..BDD-5 (revocación efectiva — la fila se borra y el listado ya no la ve; masiva; auto-revocación conserva la actual; cross-tenant 404; separación de funciones 403).
- **UI después** (congelada a propósito): panel de "sesiones activas" y botón de revocación en administración, con el rediseño estructural del usuario.
- **Cobertura (CAL-2):** el módulo es seguridad; cobertura alta en el servicio de revocación (pertenencia, listado, revoke, revoke-all, auto-revoke, aislamiento).
- **Gate y DoD** por unidad (scripts/verify.sh); evidencia real adjunta.

## 6. Criterios de aceptación

- CA-1 (SPEC:REVOKE): admin revoca una sesión de su org → la fila se borra y el listado ya no la ve; auditada.
- CA-2 (SPEC:REVOKE): revoke-all elimina todas las sesiones de la cuenta y audita el conteo (`revoked`).
- CA-3 (SPEC:REVOKE): auto-revocación cierra las otras sesiones y conserva la actual.
- CA-4 (REQ-1/TX-07): listar/revocar cuenta de otro tenant → 404.
- CA-5 (REQ-1): recepcion/instructor revocando ajenas → 403.
- CA-6 (SPEC:BACKUP): backup y restore ejecutados y verificados en staging; evidencia adjunta en el cierre.
- CA-7: toda revocación audita en la misma transacción (actor, objetivo, org, IP).
- CA-8 (MVP-SAUNA-01/B): cero tablas/servicios/rutas de sauna.
