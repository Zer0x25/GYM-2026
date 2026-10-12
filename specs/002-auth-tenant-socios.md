# Spec: Auth, tenant y roles + socios y permisos (Entrega 1)

> Estado: Aprobada
> Nivel: Tier 1 — Riesgo alto; justificación: define identidad, sesiones, aislamiento entre organizaciones y el modelo de permisos sobre el que se apoyan dinero, reservas y portal; un error aquí compromete todos los módulos posteriores.
> Requisitos: REQ-1 (aislamiento multi-organización), REQ-7 (portal solo datos propios)
> ADR aplicables: docs/adr/0002-arquitectura-base.md
> Contexto (Notion): https://app.notion.com/p/3f529b8ebe298146a7eed6cfa0d2f2e1 (G1 · Especificación técnica de implementación MVP v1.0, §4 «Org/Auth» y §8 «Seguridad, privacidad y operación»)
> Trazabilidad: SPEC:ADR-002 (stack), SPEC:D-02/C (un empleado, una organización), SPEC:D-01 (una sede por organización), SPEC:AUTH-02 (concurrencia segura por transacciones, no por límites de login)
> Aceptación: usuario, 2026-10-12 (invocación «Lee y ejecuta PROMPT-MAESTRO.md»); Tier 1 → cierre pendiente de revisión humana; commits locales autorizados, sin push.

## 1. Objetivo y alcance

- **Resultado observable:** un staff (admin/recepción/instructor) puede autenticarse con usuario individual (incluso en equipo compartido), su sesión queda ligada a una organización y un rol, y toda consulta o comando se filtra por organización: un socio de la organización A nunca ve ni puede alcanzar recursos de la organización B (IDOR probado). El socio (portal) puede leer y modificar **solo** su propio perfil y contacto. CRUD de socios para admin/recepción con alta, búsqueda y ficha; instructores ven solo su agenda (esqueleto autorizado de rutas).
- **Incluye:**
  - Autenticación con Better Auth (self-hosted, Fastify) usando el adaptador Drizzle sobre las tablas propias (`identity_accounts`, sesiones de Better Auth). Sesiones por persona con caducidad (`SESSION_TTL_HOURS`); cambio de turno en equipo compartido no expone la sesión anterior (la sesión vive en cookie/token del navegador, no en el DOM).
  - Verificación de permisos en servidor: `tenant + actor + rol + recurso` en cada ruta protegida; helpers `requireRole(...)` y `assertTenant(ctx)`.
  - `GET /api/v1/auth/session` → `SessionResponse` (user, organization, role).
  - `POST /api/v1/members` (admin/recepción): alta de socio con `organizationId` tomado **de la sesión**, nunca del body.
  - `GET /api/v1/members?q=` (admin/recepción/instructor según recurso): búsqueda/listado **filtrado por tenant**.
  - `GET /api/v1/members/:id` y `PATCH /api/v1/members/:id/contact` (socio: solo el propio, vía identidad de sesión; admin/recepción: cualquiera de su organización).
  - Roles: `admin`, `recepcion`, `instructor`, `socio` (enum en `staff_assignments` y vínculo socio↔cuenta).
  - Alta de organización y de la primera cuenta staff (bootstrap de tenant) como endpoint de provisión interna.
  - Web: pantalla de login, cierre de sesión, vista de sesión, panel con listado/búsqueda de socios (admin/recepción) y portal «mi perfil» (socio) consumiendo los contratos de `packages/contracts`.
  - Migraciones Drizzle de las tablas de Better Auth (`user`, `session`, `account`, `verification`) y ajustes al esquema propio.
- **Excluye:** menores y adulto responsable funcional (D-05 validación jurídica pendiente; el campo existe, la lógica no); portal delegado de menores; recuperación de credenciales por email (requiere decisión de canal; se deja pendiente documentado); multi-organización por empleado (D-02/C lo prohíbe en el lanzamiento); 2FA; pagos, clases y reservas (unidades siguientes); reservas de sauna.
- **Pendientes críticos / supuestos aceptados:** supuestos: sesión Bearer/cookie httpOnly con `AUTH_SECRET` fuera del repo (`.env`); email como identificador de staff; supuesto de测试: BD Postgres real para integración (docker local); pendiente: canal de recuperación de credenciales y validación legal de menores (STATE).

## 2. Contratos e invariantes

- **Aislamiento (REQ-1, TX-07):** ningún `organizationId` puede venir del cliente en comandos; se resuelve de `staff_assignments` vía la sesión. Toda query de datos de socio/plan lleva `WHERE organization_id = $session.organizationId`. Pruebas: (a) socio A solicita socio de B por ID → 403/404 sin filtrar datos; (b) ID alterado en path → igual; (c) socio sin asignación activa → 401.
- **Sesiones:** la sesión se emite solo tras credenciales válidas; expira según `SESSION_TTL_HOURS`; el cierre de sesión invalida la sesión en servidor (no solo en cliente). Equipo compartido: la sesión pertenece al usuario individual (D-02/C, AUTH-01); no hay usuario genérico «recepción».
- **Roles y permisos (helper único):** matriz mínima — `admin`: todo dentro de su organización; `recepcion`: socios, contactos, (después) caja; `instructor`: su agenda y asistencias (esqueleto); `socio`: solo su perfil/contacto y (después) sus reservas. La comprobación ocurre en el backend; la UI solo refleja.
- **Errores:** mismos códigos estables (`UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400). Un socio autenticado pidiendo recurso ajeno recibe 404 (no filtrar existencia) o 403 según el caso, nunca 200 con datos.
- **Datos y esquema:** `members` ya declarado en `packages/db`; esta unidad añade: `account_id` (vínculo socio↔cuenta, opcional en v1.0 para socios sin login), índice único `(organization_id, contact_email)` no obligatorio (contacto editable), y las tablas de Better Auth vía `getAuthTables`/adapter.
- **Fixtures:** dos organizaciones ficticias (A y B) con usuarios de prueba deterministas (mismo conjunto en cada corrida); restauración por truncado entre pruebas de integración.

## 3. Comportamientos BDD y aceptación

```gherkin
Escenario BDD-1: Staff autenticado obtiene sesión con organización y rol
  Dado un staff admin de la organización A con credenciales válidas
  Cuando POST /api/v1/auth/sign-in con email y password correctos
  Entonces recibe cookie de sesión httpOnly
  Y GET /api/v1/auth/session devuelve { user, organization: A, role: "admin" }

Escenario BDD-2: Aislamiento entre organizaciones por ID alterado
  Dado una sesión de staff de la organización A
  Cuando solicita GET /api/v1/members/<id-de-B>
  Entonces responde 404 sin filtrar datos de B
  Y el log de auditoría registra el intento sin datos sensibles

Escenario BDD-3: Socio solo ve y edita su propio perfil
  Dado una sesión de socio S1 de la organización A
  Cuando PATCH /api/v1/members/<id-de-S2>/contact con nuevos datos
  Entonces responde 403/404
  Y cuando PATCH /api/v1/members/<id-de-S1>/contact con email válido
  Entonces responde 200 y el cambio persiste verificado por consulta

Escenario BDD-4: Recepción no puede crear cuentas staff
  Dado una sesión de recepción de la organización A
  Cuando POST /api/v1/members con datos válidos
  Entonces responde 201 (recepción puede dar de alta socios)
  Y cuando intenta un comando de administración reservado a admin
  Entonces responde 403

Escenario BDD-5: Cambio de turno en equipo compartido
  Dado un equipo compartido con sesión del usuario U1
  Cuando U1 cierra sesión e inicia U2
  Entonces la sesión de U1 queda invalidada en servidor
  Y la UI no muestra datos de U1 tras el cambio
```

| ID | Requisito PRD | Escenario / criterio | Prueba o verificación | Resultado esperado |
|---|---|---|---|---|
| CA-1 | REQ-1 | BDD-1 | Integración Supertest contra Postgres de prueba | 200 + SessionResponse válido (Zod) con org A |
| CA-2 | REQ-1 | BDD-2 | Integración: GET socio de B con sesión de A | 404; sin datos de B en respuesta ni logs |
| CA-3 | REQ-1 | — | Integración: comando con `organizationId` en body | Ignorado; se usa el de la sesión |
| CA-4 | REQ-7 | BDD-3 | Integración: socio edita perfil ajeno | 403/404; edición propia 200 y persiste |
| CA-5 | — | BDD-4 | Integración: matriz rol×ruta (admin/recepción/instructor/socio) | Cada combinación según matriz §2 |
| CA-6 | — | BDD-5 | Integración: login U2 tras logout U1 | Sesión U1 inválida (401 en ruta protegida) |
| CA-7 | CAL-3 | — | Revisión de docs/api: cada ruta nueva documentada | Contratos request/response/estados presentes |
| CA-8 | REQ-10 | — | `grep -ri sauna` en diff de la unidad | Cero coincidencias |

## 4. Archivos autorizados

- **Editables:**
  - `packages/contracts/src/index.ts` (schemas de auth/socios), `packages/contracts/src/*.test.ts`
  - `packages/db/src/schema.ts` (vínculo account_id + tablas de auth), `packages/db/src/*.test.ts`, `packages/db/drizzle/*` (migraciones generadas)
  - `apps/api/src/**` (auth, plugins de sesión, rutas members, helpers de permisos, auditoría), `apps/api/src/*.test.ts`, `apps/api/vitest.config.ts` (nuevo, integración con Postgres)
  - `apps/web/src/**` (login, logout, panel socios, portal perfil), `apps/web/src/*.test.tsx`
  - `docs/api/**` (contratos de auth y members), `docs/operations/runbook.md` (variables de auth)
  - `specs/002-auth-tenant-socios.md` (esta spec), `STATE.md`, `docs/learning.md`
- **Protegidos:** `AGENTS.md`, ADR existentes, `.agents/**` salvo uso de perfil, `scripts/verify*.sh` y `scripts/tests/**` (no debilitar), `packages/db` salvo lo indicado, `apps/web` salvo lo indicado.

## 5. Verificación y DoD

- **DoD común:** AGENTS.md §9.
- **Comandos y suites de cierre:** `./scripts/verify.sh` (raíz → `scripts/verify-project.sh`: lint, typecheck, build, tests de todos los workspaces; los tests de integración de API requieren Postgres de prueba levantado — el gate lo levanta vía Docker si está disponible, o documenta el requisito).
- **Chequeo rápido de iteración:** `pnpm --filter @gym/api test` y `pnpm --filter @gym/contracts test` (no sustituyen el cierre).
- **Revisión Tier 1:** revisión humana por el usuario al cierre (seguridad de sesiones, aislamiento, permisos); el agente no la presenta como independiente.
- **Condiciones adicionales:** las pruebas de integración usan Postgres real (no mocks de BD); cero datos de B en respuestas de A; auditoría de intentos cross-tenant sin datos sensibles.

## 6. Cierre y continuidad

- **Evidencia:** salida de `./scripts/verify.sh` + conteo de tests nuevos y resultados por CA; hash del commit.
- **Aprendizaje:** hallazgo (p. ej. configuración del adapter Drizzle de Better Auth, cookie vs Bearer en equipos compartidos) en `docs/learning.md` o «sin hallazgos nuevos».
- **Commit:** local autorizado (`feat(auth): sesiones, tenant y CRUD de socios con aislamiento`), sin push.
- **Checkpoint en STATE:** siguiente unidad = Entrega 2 (planes/períodos/beneficios + pagos manuales + caja/QR).
- **Continuidad:** checkpoint según AGENTS.
