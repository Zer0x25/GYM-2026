# ADR 0002: Arquitectura base — App GYM MVP v1.0

> **Sobre la numeración:** ADR del **proyecto derivado** (GYM-2026), reservado para la arquitectura base. Los ADR `0000–0006` son del molde (gobernanza del flujo agéntico) y sirven de ejemplo/guía.

- **Fecha:** 2026-10-11
- **Estado:** Aceptado
- **Aplica a:** GYM-2026 (App GYM), MVP v1.0 — módulos N (administración/recepción/ingreso), C (clases/reservas), P (portal socio), offline controlado
- **Relacionado / reemplaza:** Traslada las decisiones Notion ADR-002 (stack base: Vite/React SPA-PWA + Fastify + PostgreSQL) y ADR-003 (Drizzle ORM) confirmadas el 10-10-2026, y cierra las puertas G1 abiertas (auth, hosting, tooling, offline) según las decisiones de esta sesión. Complementa el documento de alcance MVP v1.0 aprobado en Notion.

---

## 1. Contexto y Problema

App GYM es una plataforma web multi-organización para gimnasios independientes con una sede operativa por organización. El alcance MVP v1.0 (N+C+P+offline) fue aprobado explícitamente por el usuario el 10-10-2026 (G0) y trasladado a este repo vía Modo A (enriquecido desde Notion). Quedaban abiertas decisiones técnicas de la puerta G1:

1. **Estructura de repositorio:** cómo organizar web, API, contratos y esquema de base de datos compartidos sin duplicar tipos ni autorización.
2. **Proveedor de identidad:** debe soportar staff/socios, roles (admin/recepción/instructor/socio), tenant (organización), revocación y sesiones seguras en equipos compartidos.
3. **Destino de despliegue:** dónde corre web + API + PostgreSQL para piloto y staging.
4. **Marco de pruebas:** qué compone el gate de proyecto.
5. **Mecanismo offline:** almacenamiento local, outbox y reconciliación para la continuidad controlada del piloto (P-09.3).

Alternativas consideradas por puerta: GYM-WS (monorepo pnpm vs. dos repos vs. monolito Vite único); G1-AUTH (Better Auth vs. Clerk vs. Supabase Auth); G1-HOST (Neon+Vercel vs. VPS propio vs. Cloudflare; VPS Hetzner); G1-TEST (Vitest+Supertest+Playwright vs. Vitest+Supertest solo vs. Jest); G1-OFF (incluir offline en el andamiaje ahora vs. dejarlo pendiente).

## 2. Decisión

1. **Monorepo pnpm workspaces:** `apps/web` (React/Vite SPA-PWA), `apps/api` (Fastify), `packages/contracts` (esquemas de request/response/eventos versionados, sin lógica de privilegios), `packages/db` (esquema Drizzle, migraciones SQL versionadas, datos de prueba). Un solo repositorio con CI única; los contratos compartidos evitan divergencia front/back. Queda **fuera**: microservicios, Kafka, Kubernetes, BaaS obligatorio.

2. **Better Auth self-hosted en Fastify** (librería TypeScript): sesiones, roles y verificación de permisos implementados en el backend; sin vendor lock ni costos de SaaS. Autorización por `tenant + actor + rol + recurso`, verificada siempre en el servidor (nunca en la UI ni confiando en IDs del cliente). La identidad externa gestionada (tipo Clerk) se descarta por costo/lock-in; Supabase Auth se descarta por acoplar auth a una Postgres gestionada específica, incompatible con el VPS propio decidido.

3. **VPS Linux propio** para staging y piloto: web (estáticos + PWA), API y PostgreSQL se despliegan con Docker Compose; el VPS concreto puede elegirse entre cloud o servidor local del equipo (no necesariamente una máquina fija). Secretos fuera del repositorio; ambientes dev/staging/prod separados; backup/restore probado antes del piloto real. Alternativa gestionada (Neon+Vercel) descartada: US$0 en piloto pero añade lock-in y separa datos de la operación propia. Cloudflare Workers+D1 descartado: no encaja con Fastify+PostgreSQL.

4. **Vitest + Supertest + Playwright** (todo npm, integrado a Vite/TypeScript): Vitest para unitarias e integración de API vía Supertest; Playwright para E2E de flujos críticos. Jest descartado (más lento con Vite). El gate de proyecto ejecuta lint + typecheck + unitarias + integración; E2E corre como verificación del cierre de las unidades de flujo.

5. **Offline incluido desde el andamiaje:** almacenamiento local candidato IndexedDB en dispositivos prehabilitados, outbox de eventos provisionales con ID/actor/dispositivo/folio, y sincronización idempotente (`event_id + tenant/device`). Postgres es autoridad; IndexedDB nunca es segundo maestro central. Parámetros abiertos (duración exacta del permiso P-09.3.1b, cifrado/gestión de claves, reloj y anti-manipulación) quedan **pendientes** (estado en STATE.md) y se resuelven antes de habilitar el modo offline con usuarios reales (pruebas incluidas).

6. **Límites permanentes de la decisión:** sin endpoints ni tablas de sauna (decisión MVP-SAUNA-01/B: sauna fuera de v1.0, backlog v1.1); sin pagos integrados (Transbank externo con registro manual); una sede por organización; empleado con una sola adscripción operativa al inicio (D-02/C); ningún pago provisional concede derechos; ninguna reserva firme offline; el backend es autoridad de reservas, pagos y derechos.

## 3. Aplicabilidad y Reglas para Agentes

- **Obligaciones:**
  - Toda ruta de `apps/api` verifica `tenant + actor + rol + recurso` antes de cualquier lectura o comando; las pruebas de cada módulo de datos incluyen aislamiento cross-tenant e IDOR.
  - Las operaciones de dinero, reservas y derechos se ejecutan en transacciones con las invariantes TX-01..TX-07 del plan G1 (último cupo, agenda, membresía/pago, cancelación, caja, idempotencia offline, aislamiento); nunca `last-write-wins` silencioso en estado contractual o financiero.
  - Los contratos HTTP viven en `packages/contracts` y se documentan en `docs/api` con estados, errores e idempotency keys; los esquemas de request/response se validan en el backend (los de la UI no autorizan nada).
  - Las migraciones Drizzle se versionan en `packages/db`; los datos de prueba usan fixtures deterministas, sin secretos.
  - El gate de proyecto `./scripts/verify.sh` debe propagar errores (sin `|| true`) y cubrir lint, typecheck, unitarias e integración como mínimo.
  - Los eventos offline conservan `event_id`, tenant, dispositivo, actor, turno, timestamp declarativo, permiso relevante y folio de referencia; el reconocimiento central es idempotente.
- **Prohibiciones:**
  - No crear endpoints, tablas, pantallas ni tests de sauna ni de recursos reservables genéricos en v1.0.
  - No validar pagos, activar derechos ni firmar reservas offline.
  - No duplicar autorización entre UI y backend, ni confiar en restricciones de interfaz para autorizar acciones.
  - No introducir dependencias sin justificación registrada; no fijar versiones sin verificar compatibilidad.
  - No usar `status` como única fuente de verdad transaccional de pagos/derechos (comandos explícitos con validación).
  - No almacenar secretos reales en código, specs, fixtures ni repositorio.

## 4. Consecuencias

### Positivas

- Contratos compartidos en un monorepo: un cambio de API es un cambio atómico con su schema y sus tipos.
- Better Auth self-hosted: costo cero de licencias y control total de sesiones, roles y tenant; alineado con el perfil «el backend es autoridad».
- VPS propio: control de datos y de operación; sin lock-in de PaaS; costos predecibles.
- Offline desde el andamiaje: el modo de contingencia se diseña junto a los flujos online, no como parche posterior.

### Negativas / Trade-offs

- Monorepo con pnpm: CI única más lenta a medida que crece; requiere disciplina de alcance por unidad.
- Better Auth: más código propio de sesiones/roles que un SaaS como Clerk; la seguridad de sesiones en equipos compartidos es responsabilidad del equipo.
- VPS propio: operación real (backup, restore, firewall, actualizaciones) recae en el equipo; sin autoescalado.
- IndexedDB/offline: cuotas por navegador, confiabilidad de escritura y cifrado local por verificar en los equipos del piloto antes de habilitar usuarios reales.

### Verificación / Migración

- Verificación por unidad: REQ-1..REQ-11 y CAL-1..CAL-3 del PRD con evidencia en specs (aislamiento, TX-01..TX-07, idempotencia offline, exclusión de sauna, backup/restore).
- Migración: no aplica (proyecto nuevo). Reversión: la arquitectura online (N+C+P sin offline) es alcanzable si ADR-G1-OFF no supera sus pruebas; en ese caso el alcance MVP mantendría online y el offline pasaría a backlog por decisión registrada.
- Delegación: esta ADR y su alcance quedan registrados en `PROMPT-MAESTRO.md`; cambios posteriores requieren ADR nuevo (0007+) con aceptación del usuario.
