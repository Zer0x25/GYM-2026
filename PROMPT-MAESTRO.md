# Prompt maestro — App GYM (GYM-2026)

> Generado el 2026-10-11 tras la Fase 3 del bootstrap (Modo A enriquecido desde Notion), con la decisión A1 del usuario: definir todo en una tanda y sellar Hito 0. Este documento registra la entrevista confirmada y es el punto de inicio de Hito 1.

- **Estado:** Aceptado por el usuario, 2026-10-11. Fuente de confirmación: decisiones de esta sesión (A1, commits locales, GYM-WS/A, G1-AUTH/A, G1-TEST/A, G1-HOST VPS propio, G1-OFF sí) sobre el alcance MVP v1.0 ya aprobado en Notion el 10-10-2026 (G0).
- **Arquitectura:** `docs/adr/0002-arquitectura-base.md`
- **Producto y aceptación:** `PRD.md` (aprobado 2026-10-11; traslada el documento «MVP v1.0 · Cierre final para aprobación» de Notion, aprobado el 10-10-2026).
- **Registro de entrevista:**
  - **Confirmadas:** alcance MVP N+C+P+offline (MVP-CUT-01/Sí, MVP); sauna fuera de v1.0 (MVP-SAUNA-01/B); stack Vite+React SPA/PWA, Fastify, PostgreSQL, Drizzle (ADR-002, ADR-003); monorepo pnpm (apps/web, apps/api, packages/contracts, packages/db); Better Auth self-hosted en Fastify; Vitest+Supertest+Playwright; despliegue en VPS Linux propio (el concreto por elegir, cloud o local); TypeScript estándar; Tailwind preferencia UI; commits locales por unidad verificada sin push.
  - **Supuestos aceptados:** Node 22, pnpm 9, PostgreSQL 16 en Docker Compose; umbral de cobertura CAL-2 ≥80% en módulos de dinero y reservas (derivado, ajustable solo por el usuario).
  - **Pendientes** (estado registrado en STATE.md): parámetro de permiso offline P-09.3.1b (duración exacta y verificación; 72 h es valor de trabajo derivado, no aprobado); cifrado y gestión de claves del almacenamiento local offline; revocación diferida; validación jurídica de datos de menores (D-05) y acceso temporal de soporte (D-06) — resolver antes del piloto real (G2); política integral P-09.3; VPS concreto y su región/recursos.
  - **No aplicables (v1.0):** sauna y reservas de recursos (v1.1); multisede; propietario multi-organización (P-11/D-08); monetización CM-01 (diferida); pagos integrados; notificaciones SMS/WhatsApp; rutinas/nutrición; apps nativas obligatorias.

## Meta de la primera entrega

Entregar la primera versión definida en `PRD.md`: plataforma web multi-organización con administración (socios, planes, membresías, pagos manuales, caja), clases grupales y personalizadas en ambas modalidades con agenda unificada de instructor, portal del socio y offline controlado del piloto (P-09.3), cumpliendo los requisitos REQ-1..REQ-11 y CAL-1..CAL-3 y la DoD de AGENTS. Sauna expresamente fuera de v1.0. Consultar allí alcance, exclusiones y restricciones; no mantener una copia aquí.

## Delegación confirmada

- **Specs:** autoaceptación dentro del alcance del PRD y esta delegación (incluye `specs/001-andamiaje-monorepo.md`).
- **Niveles:** el agente clasifica por riesgo según AGENTS y ADR 0005/0006; puede autoaceptar Tier 2 dentro del PRD; Tier 1 (arquitectura, seguridad/permisos, dinero, concurrencia, offline, cambios de controles de gobernanza) requiere revisión humana del usuario al cierre, registrada en la spec; ante incertidumbre conservar mayores controles.
- **Tier 3:** registro ligero en STATE autorizado, con aceptación del agente dentro del alcance; correcciones de contrato confirmado; sin ampliar alcance ni modificar specs cerradas.
- **ADR técnicos:** el agente puede aceptar ADR de ingeniería derivados de bajo impacto (p. ej. detalles de implementación de Vitest, estructura interna de módulos) registrando motivo, riesgo, reversibilidad y estado Derivada/Hipótesis; las decisiones de arquitectura, alcance, seguridad, costos o stack requieren aprobación humana (0007+).
- **Dependencias:** autorizadas las del stack decidido (Vite, React, Fastify, Drizzle, Better Auth, Vitest, Supertest, Playwright, pnpm, TypeScript, Tailwind) y sus transitivas; cualquier otra librería requiere consulta previa con justificación de necesidad y costo.
- **Commits:** autorizados por unidad verificada, incluyendo expresamente specs y registros ligeros; Conventional Commits; locales únicamente — **sin push, merge ni despliegue** (requieren autorización propia y explícita por operación).
- **Revisión Tier 1:** modalidad = revisión humana por el usuario al cierre de la unidad (para andamiaje, dinero, offline y controles de seguridad); el agente no presenta revisión propia como independiente; sin revisión acordada el cierre queda pendiente.
- **Verificación:** comandos en AGENTS; gate raíz `./scripts/verify.sh` (incluye `scripts/verify-project.sh`: lint, typecheck, build, unitarias, integración) en cada cierre; chequeo rápido de iteración autorizado por workspace (typecheck/tests focalizados) con cobertura declarada, sin sustituir el gate.
- **Continuidad:** STATE y unidad activa; capacidades opcionales según `docs/agent-capabilities.md`. Preferencia: checkpoint antes de compactar o cambiar de sesión; reanudar desde archivos.
- **Falta de progreso:** umbral de 3 intentos consecutivos sin progreso sobre el mismo problema; al alcanzarlo, detener reintentos, conservar checkpoint y solicitar intervención concreta con evidencia.
- **Aprendizaje:** hallazgos útiles en `docs/learning.md`; sin trámite adicional por unidad.
- **Requiere consulta:** cambios de alcance, stack, seguridad, costos, datos de menores, parámetros offline (P-09.3.1b, cifrado), elección del VPS concreto y cualquier compromiso fuera de los límites anteriores. Push, merge y despliegue requieren su propia autorización.

## Invocación de inicio

Al pedir «Lee y ejecuta PROMPT-MAESTRO.md para iniciar Hito 1», crea o retoma la meta con las capacidades disponibles según `docs/agent-capabilities.md`; STATE conserva objetivo y pendientes.

Leer PRD, AGENTS, STATE, el perfil y los ADR aplicables. Comprobar el estado real de Git y del gate. Descomponer la meta en unidades pequeñas ordenadas por dependencias y clasificarlas antes de editar: specs para Tier 2/1, registro ligero para Tier 3 autorizado. Secuencia inicial acordada (plan G1 de Notion):

1. **Andamiaje del monorepo** (spec 001, Tier 1): estructura, contratos, db, API esqueleto, web esqueleto, gate de proyecto, CI, runbook borrador.
2. **Entrega 1:** auth/tenant/roles + socios y permisos + pruebas de aislamiento (REQ-1, REQ-7).
3. **Entrega 2:** planes/períodos/beneficios + pagos manuales/validación + caja/QR + pruebas financieras (REQ-2, REQ-3).
4. **Entrega 3:** clases/grupales + personalizadas fijas/citas + agenda/instructor + reservas/portal + transacciones y pruebas (REQ-4, REQ-5, REQ-6).
5. **Entrega 4:** PWA y offline prehabilitado, outbox, folios, sync, conciliación, reconstrucción + pruebas de daño/pérdida en dispositivos ficticios (REQ-9).
6. **Entrega 5:** reportes mínimos, backup/restore, seguridad, integración y preparación del piloto supervisado (REQ-8, REQ-11).

Seguir el ciclo de AGENTS por unidad: clasificación y registro aceptado → contratos/pruebas o revisión pertinente → implementación → gate y controles DoD → aprendizaje y estado → commit cuando requerido y autorizado → checkpoint → siguiente unidad. Consultar ADR 0002 para stack y AGENTS para niveles; no duplicar esas reglas aquí.

## Cierre de meta

Antes de declarar la app completa, verificar todos los requisitos y evidencias finales del PRD (REQ-1..REQ-11, CAL-1..CAL-3) y la DoD, incluidos flujos integrados y los criterios agrupados MVP-AC-01..AC-10 del documento de alcance aprobado. Entregar evidencia, comandos de ejecución y limitaciones reales. Con criterios, verificaciones o commits requeridos pendientes, conservar la meta abierta. No ampliar el alcance ni reducir los criterios para cerrar. El piloto con datos reales (G2) no comienza sin autorización explícita del usuario.

## Reanudación

Después de compactar o cambiar de sesión, consultar STATE, la spec o registro ligero activo, los ADR aplicables y el aprendizaje relevante. Verificar Git y los artefactos; usar el checkpoint para continuar sin repetir tareas concluidas. Reclasificar no reinicia el contador de falta de progreso. Las modificaciones posteriores al alcance de este prompt requieren aprobación y una referencia a la nueva decisión.
