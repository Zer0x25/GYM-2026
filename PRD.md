# PRD — App GYM (GYM-2026), primera entrega MVP v1.0

> Estado: **Aprobado por el usuario**, 2026-10-11, derivado del documento «MVP v1.0 · Cierre final para aprobación» de Notion (https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3), aprobado formalmente el 10-10-2026 (G0) y trasladado a este repo por Modo A (enriquecido) con las decisiones de esta sesión.
> Trazabilidad: cada requisito cita su código de decisión en Notion.

## Problema y resultado

Gimnasios independientes (una sede operativa por organización) necesitan gestionar socios, membresías, pagos manuales, clases (grupales y personalizadas), reservas, asistencia, QR de ingreso y caja sin ERP caro ni planillas, con segregación de datos entre organizaciones y continuidad operativa controlada en cortes de red. Resultado observable: un administrador, un recepcionista, instructores y socios operan la jornada completa del gimnasio desde una app web con portal para socios y respaldo offline auditado para cobros y accesos.

## Usuarios y flujos principales

| Actor | Rol | Flujo principal |
|---|---|---|
| Administración | admin | Configura organización, planes, clases y personalizadas; valida pagos; autoriza excepciones, devoluciones y ajustes; revisa conciliación. |
| Recepción | recepción | Registra cobros manuales y cierra su turno; valida ingresos con QR; gestiona reservas; opera offline prehabilitado. |
| Instructor/preparador | instructor | Consulta su agenda unificada (grupales, personalizadas fijas, citas, bloqueos); registra asistencia. |
| Socio | socio | Portal: perfil, períodos y beneficios, QR propio, calendario, reservas/cancelaciones, edición de contacto. |

Flujos completos por dominio (fuente detallada PRD-01/02/03 v1.5, archivados como trazables; FL-01..FL-20): alta de socio → asignación de plan → cobro manual con referencia → validación humana → derechos confirmados → reserva de clase → asistencia/QR supervisado → cierre de caja.

## Alcance de entrega

- **Incluye (N + C + P + offline controlado, decisión MVP-CUT-01/Sí y MVP):**
  - **N — Administración, recepción e ingreso:** organizaciones (una sede), roles (admin/recepción/instructor/socio) con segregación tenant, fichas de socios, contacto editable propio con verificación, menores vinculados a adulto responsable, planes y membresías configurables (precio, duración, cobertura, períodos), pagos manuales (efectivo, transferencia, Transbank externo) con validación humana separada, caja por turno y consolidación diaria, QR estático revocable para identificación e ingreso supervisado.
  - **C — Clases y reservas:** clases grupales configurables (Zumba, Spinning, otras) con cupo, ventana y cancelación configurables; **personalizadas en ambas modalidades** (sesiones fijas publicadas + citas por agenda individual de entrenador, decisión P-RES-02/Ambas); agenda unificada por entrenador sin solapes; reserva firme con revalidación de cobertura a la fecha de la sesión.
  - **P — Portal del socio:** sesión/recuperación, perfil, períodos y beneficios confirmados, QR propio, calendario, reserva/cancelación grupal y personalizada (ambas modalidades), edición solo de contacto.
  - **Offline controlado (requisito transversal del piloto):** dispositivos y operadores prehabilitados, cobros provisionales offline, ingreso de contingencia con membresía sincronizada con ≤72 h de frescura, outbox local con folio independiente para dinero/excepciones, reconciliación y reconstrucción auditada (P-09.3.2/B, P-09.3.3).
- **Excluye / futuro:**
  - **Sauna fuera de v1.0** (decisión MVP-SAUNA-01/B): sin reservas ni API de sauna; el gimnasio la gestiona externamente. Módulo de reservas de recursos en v1.1.
  - Pagos integrados/pasarelas/Transbank API; multisede; empleado con roles activos en varias organizaciones (D-02/C limita a una al inicio); acceso global de propietario multi-organización (P-11/D-08 pendiente); facturación comercial (CM-01 diferida); rutinas/nutrición/wearables; control automatizado de puertas/biometría; reserva firme offline; apps nativas obligatorias; portal delegado de menores no validado; notificaciones SMS/WhatsApp no requeridas; nodo LAN secundario.
- **Destino de aceptación:** ejecución local reproducible + staging en VPS propio (Linux) del equipo; piloto con datos reales (G2) **no autorizado** hasta superar sus criterios. Despliegue a producción requiere autorización propia.
- **Restricciones:** contexto Chile (revisión legal pendiente para datos de menores, D-05 validación jurídica); concurrencia objetivo de piloto 2 admins + 3 recepcionistas online (AUTH-02); secretos fuera del repo; ningún pago provisional concede derechos.

## Requisitos y aceptación final

| ID | Requisito / comportamiento observable | Evidencia y resultado esperado |
|---|---|---|
| REQ-1 | Aislamiento multi-organización: dos gimnasios ficticios, UI y API (incluido ID alterado, sesiones de distinto rol) | Pruebas de aislamiento tenant (Vitest+Supertest): acceso cross-tenant denegado en 100% de casos; IDOR probado |
| REQ-2 | Alta de socio, asignación de plan, cobro manual con referencia, validación humana separada, derechos confirmados | Test de integración: pago registrado **no** concede cobertura; tras validación manual, derechos activos |
| REQ-3 | Caja por turnos/día, conciliación sin duplicados, auditoría, ajustes según D-03/B | Test transaccional TX-05: dos cierres simultáneos del mismo turno → uno rechazado; movimiento validado no sobrescribible |
| REQ-4 | Clases grupales configurables: cupo, última plaza bajo concurrencia, beneficio comprometido una sola vez | Test TX-01: dos peticiones simultáneas por última plaza → una confirma, otra recibe rechazo claro sin consumo de beneficio |
| REQ-5 | Cancelaciones temprana/tardía/gimnasio, ausencia y revalidación de cobertura | Test TX-04: liberación de plaza y devolución/retención de crédito exactamente una vez |
| REQ-6 | Personalizadas ambas modalidades (fijas + citas) con agenda unificada de instructor sin solapes | Test TX-02: solape real entre grupal/fija/cita/bloqueo del mismo instructor → rechazo |
| REQ-7 | Portal: solo datos y reservas propios; estado consistente; contacto editable autorizado | Test de autorización: socio no accede a recursos de otro ni a pagos/planes/datos legales |
| REQ-8 | Concurrencia: 2 administradores + 3 recepcionistas online simultáneos sin bloqueos artificiales ni doble operación financiera | Prueba de carga acotada (k6 o similar si se autoriza) o test de concurrencia documentado |
| REQ-9 | Offline controlado: 2+ dispositivos prehabilitados, eventos independientes, reconexión parcial, reenvío idempotente, cobro provisional, ingreso con frescura ≤72 h, folios externos, reconstrucción comprobable | Test TX-06: mismo event_id reenviado → efecto una vez; dos IDs para un mismo hecho → ambos conservados y marcados posible duplicado de negocio |
| REQ-10 | Exclusión efectiva de sauna en UI/API/operación de v1.0 | Grep/review del árbol: ninguna ruta `/sauna` ni tablas Resource/Sauna en migraciones; AC-RES-01..06 en backlog v1.1 |
| REQ-11 | Backup/restauración central probado antes del piloto; sesiones de equipo compartido, roles, revocaciones, privacidad y auditoría verificados | Runbook de backup/restore ejecutado en staging; test de revocación de sesión y auditoría de operaciones |
| CAL-1 | Gate de proyecto reproducible: `./scripts/verify.sh` verde (unitarias + integración + lint + typecheck) | Salida 0 en CI local; CI remota tras push autorizado |
| CAL-2 | Cobertura de pruebas en módulos de dinero y reservas ≥ 80% (umbral propuesto por derivar de TX-01..TX-07; ajustable solo por decisión del usuario) | Reporte de cobertura Vitest adjunto en el cierre de cada unidad de esos módulos |
| CAL-3 | Contratos HTTP documentados y versionados en docs/api para todos los endpoints | Revisión de /docs/api: cada endpoint con request/response/estados/errores e idempotency keys donde aplique |

Todos los requisitos de esta entrega son obligatorios; lo opcional va a «futuro». La aceptación final usa los criterios agrupados MVP-AC-01..AC-10 del documento de alcance aprobado (Notion) como trazabilidad padre.

## Supuestos y decisiones pendientes

- **Supuestos aceptados (esta sesión, Modo A):**
  - Monorepo pnpm workspaces: `apps/web`, `apps/api`, `packages/contracts`, `packages/db` (decisión GYM-WS).
  - Stack confirmado en Notion (ADR-002/ADR-003): Vite + React SPA/PWA + Fastify + PostgreSQL + Drizzle; TypeScript estándar; Tailwind preferencia UI.
  - Tests: Vitest + Supertest + Playwright (decisión G1-TEST).
  - Auth: Better Auth self-hosted en Fastify (decisión G1-AUTH).
  - Destino: VPS propio Linux (decisión G1-HOST); runbook con Docker Compose; el VPS concreto puede cambiar (no necesariamente zer0x-a1).
  - Commits: locales autorizados por unidad verificada; sin push automático.
- **Pendientes críticos** (registrados con su estado en STATE.md; resolver antes del piloto real):
  - P-09.3.1b resuelto el 2026-10-14: permiso máximo 72 h firmado y revalidado online; cifrado AES-GCM y frase local aceptados en ADR 0007. La comprobación en equipos reales y los procedimientos de custodia/pérdida/revocación diferida siguen pendientes antes del piloto.
  - Validación jurídica de datos de menores (D-05) y acceso temporal de soporte (D-06).
  - Política integral P-09.3 (mecanismo completo de autorización/verificación offline) y representación de menores.
- **No aplicables (v1.0):** sauna y reservas de recursos (v1.1); multisede; propietario multi-organización (P-11/D-08); monetización CM-01; pagos integrados; notificaciones SMS/WhatsApp; rutinas/nutrición.

La arquitectura vive en `docs/adr/0002-arquitectura-base.md`; autoridad e invocación en `PROMPT-MAESTRO.md`; pruebas y escenarios en specs; progreso en `STATE.md`. Cambios al alcance o criterios requieren confirmación registrada y nuevas decisiones cuando afecten arquitectura.

Matriz de cobertura y brechas observadas: `docs/product/aceptacion-mvp.md`. Inventaría evidencia y pendientes sin modificar el alcance ni declarar aceptación final.
