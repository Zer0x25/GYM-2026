# Spec 010 — App GYM operativa

Estado: Implementada y verificada — revisión humana Tier 1 de cierre pendiente.
Nivel: Tier 1 — conecta superficies de dinero, sesiones y contingencia; conserva los contratos financieros y de permisos existentes.
Autoridad: petición del usuario 2026-10-14 «entregame una app funcional, con las capacidades de un app de gym moderna» y delegación de PROMPT-MAESTRO. Revoca la congelación del frente para completar la app. Commits locales autorizados; sin push ni despliegue remoto. La vigencia offline de 72 horas con revalidación al reconectar fue confirmada expresamente por el usuario en esta sesión.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981fab0c2fa583efcdf15
Trazabilidad: SPEC:002-auth-tenant-socios SPEC:003-planes-pagos-caja SPEC:004-clases-reservas SPEC:005-offline-controlado SPEC:007-qr-checkin SPEC:009-frente-mostrador

## 1. Resultado y límites

Completar los flujos del PRD REQ-1..REQ-11, con interfaz responsive por rol, navegación por tareas, fichas de socios, alta y asignación de plan, cobro provisional, decisión humana confirmada, caja y conciliación, clases/agenda/asistencia, QR propio y recepción, personal, sesiones y contingencia. Arranque local reproducible y pruebas contra PostgreSQL real. No altera la arquitectura ni añade servicios externos, pasarelas, rutinas/nutrición, datos reales, menores ni soporte temporal. Las decisiones críticas de privacidad y staging siguen pendientes; no se declara G2 autorizado.

## 2. Invariantes, seguridad y datos

El servidor decide tenant/rol/recurso. Un pago provisional no concede derechos. Validación por otro administrador, movimiento único en transacción, caja y reservas concurrentes preservadas. Cancelaciones con razón y confirmación. QR revocado/ajeno y errores de red diferenciados, sin permitir acceso ante incertidumbre. Listados de instructores/proyección pública sin email ni secretos para socios; personal y sesiones administrativos. Búsqueda manual resuelve cobertura en servidor sin revelar token. Operaciones offline ligadas a operador/dispositivo habilitado, permiso máximo 72h, revalidación al reconectar, folio externo obligatorio, outbox durable e idempotente; persistencia local y cifrado requieren ADR aceptado antes de implementarse. Retención local solo datos mínimos; ninguna contraseña o cookie en IndexedDB. Revisión adicional acordada: humana por el usuario al cierre, más tests adversarios de aislamiento/revocación/expiración; revisión propia no se considera independiente.

## 3. Criterios y escenarios verificables

- CA-1: Dado un socio nuevo, cuando recepción lo crea/asigna plan/cobra, entonces persisten socio, membresía y pago provisional; solo otro admin lo valida y activa derechos. Tests UI + integración/E2E.
- CA-2: Dado QR o búsqueda por nombre, cuando se valida ingreso, entonces servidor devuelve permitido/denegado/desconocido, feed solo del día y estado de actualización honesto. Tests API y UI.
- CA-3: Dado socio autenticado, cuando abre portal, entonces ve QR escaneable, vigencia, beneficios confirmados y reservas propias; puede reservar/cancelar sin acceso ajeno. Tests y E2E.
- CA-4: Dado staff/instructor, cuando programa grupal/fija/cita/bloqueo o asistencia, entonces agenda, cupo, cobertura y solape cumplen contratos existentes; nombres humanos y estados visibles. Integración y E2E.
- CA-5: Dado dinero provisional, cuando admin decide o staff cierra caja, entonces confirma explícitamente y la vista distingue pendiente, confirmado, error y diferencia; refresca caja tras cambios. Tests y E2E.
- CA-6: Dado roles distintos y un equipo compartido, cuando navegan o cierran sesiones, entonces solo ven acciones permitidas, errores 401 invalidan sesión y revocaciones son autoritativas. Tests adversarios.
- CA-7: Dado 2 dispositivos de ficción prehabilitados, cuando operan desconectados/reenvían/reconectan, entonces outbox conservada, efecto idempotente, folio y rechazo visible; permiso expira a 72h y se revalida al reconectar. Pendiente de decisión del mecanismo de cifrado.
- CA-8: Dado checkout local, cuando arranca con instrucciones reproducibles y ejecuta gate + suites integradas, entonces web/API/Postgres operan, tests obligatorios no se presentan como ejecutados si fueron omitidos y build funciona. Evidencia de comandos y estado real.

## 4. Archivos autorizados

- specs/010-app-operativa.md
- STATE.md
- docs/learning.md
- apps/web/src/*
- apps/web/src/**/*
- apps/web/public/*
- apps/web/package.json
- apps/web/vite.config.ts
- apps/api/src/app.ts
- apps/api/src/server.ts
- apps/api/src/seed-dev.ts
- apps/api/src/services/checkin.ts
- apps/api/src/services/offline.ts
- apps/api/src/services/operations.ts
- apps/api/src/services/sessions.ts
- apps/api/src/operations.integration.test.ts
- apps/api/src/services/members.ts
- apps/api/src/services/provisioning.ts
- apps/api/src/services/session-revocation.ts
- apps/api/src/resolve-session.ts
- apps/api/src/resolve-session.test.ts
- apps/api/src/members.integration.test.ts
- apps/api/src/auth-flow.integration.test.ts
- apps/api/src/session-revocation.integration.test.ts
- packages/db/src/schema.ts
- packages/db/drizzle/0009_member_account.sql
- packages/db/drizzle/meta/_journal.json
- apps/api/src/checkin.integration.test.ts
- apps/api/src/offline.integration.test.ts
- packages/contracts/src/index.ts
- package.json
- pnpm-lock.yaml
- scripts/dev.mjs
- scripts/e2e.mjs
- scripts/integration.mjs
- scripts/coverage.mjs
- playwright.config.ts
- tests/e2e/*
- compose.dev.yaml
- docs/api/README.md
- docs/operations/runbook.md
- docs/adr/0007-offline-cliente.md
- README.md
- .gitignore

Rutas de runtime/test/manifest necesarias para entrega reproducible. No se modifica lógica de gate, CI ni ADR históricos; nuevas dependencias solo si decisión aceptada/autorización específica las permite. No se modifican reglas financieras selladas salvo defecto explícito cubierto por regresión.

Ampliación 2026-10-14 antes de editar: vínculo nullable `members.account_id` a identidad, backfill solo de emails no ambiguos; la provisión establece el vínculo y el cambio de contacto no cambia titularidad. Corrige dependencia de contacto editable sin alterar el permiso propio. Conserva filas/datos, migración aditiva reversible (no se elimina dato antiguo). Generar QR para altas nuevas y excluir `/api` del cache SW: defectos observados en diagnóstico. Pruebas de persistencia, cuenta estable, no hijack y tenant. Ajustes de tests solo frente a esta fuente confirmada y migración; no reducir aserciones.

## 5. Verificación y cierre

DoD: AGENTS §9. Primero tests focalizados rojos por capacidades ausentes; implementación mínima, tests verdes. Gate raíz, integración real (BDs ficticias aisladas), E2E de roles y persistencia, inspección responsive navegador, diff y scope. Registrar por CA comando y resultado real. Cobertura dinero/reservas CAL-2 debe medirse sin debilitar umbral. Checkpoint y aprendizaje al cerrar. Commit local verificado; revisión humana Tier 1 pendiente antes del cierre final del producto.

## 6. Evidencia

Baseline: gate verde con 81 integraciones omitidas. Esta unidad ejecutó gate con BD ficticia migrada y worker único; no usa ese baseline como aceptación.

- CA-1: `pnpm test:e2e` → alta de socio con portal/plan, cobro provisional, confirmación separada, pago persisted validated y movimiento único; 7/7 en build/preview y PostgreSQL real. `pnpm test:integration` → suites financieras y roles en BDs aisladas, sin omitidos.
- CA-2: `pnpm --filter @gym/web test` → 26/26 incluyendo búsqueda por nombre con validación del servidor, error de feed y transporte distinto de QR desconocido. `operations.integration.test.ts` → ingreso manual, revocación, tenant y filtro de fecha de Santiago verdes.
- CA-3: `pnpm test:e2e` → portal móvil 390×844, QR visible, reserva/cancelación persistidas, edición de contacto y recarga conservando identidad; lectura de staff/pagos 403. Inspección visual `/tmp/gym-portal-mobile.png`, sin overflow horizontal.
- CA-4: `operations.integration.test.ts` → agenda/cupos, solape concurrente sobre agenda vacía con fixture repetible de PostgreSQL y asistencia recuperada de auditoría; tests verdes. `pnpm test:e2e` → cita con instructor real y entrada por rol. Suites reservas/cancelación/asistencia de spec 004 siguen verdes.
- CA-5: `pnpm test:e2e` → decisión no ocurre antes de Confirmar, cierre con diferencia de $100 persistida y badge de caja actualizado. `operations.integration.test.ts` → informe diario divide por fecha Santiago y rechaza instructor. `pnpm test:coverage` → 39 tests reales, 96.24% statements/lines, 97.67% functions, 74.69% branches; umbral ≥80% statements/lines cumplido, ramas informativas como política CAL-2.
- CA-6: `operations.integration.test.ts` → pertenencia de ficha y proyección pública, identidad estable, email no concede identidad, bootstrap anónimo 403 con base inicializada, ingreso legado sin firma 403. Suites auth/tenant/revocación → verdes. `pnpm test:e2e` → instructor sin finanzas y socio con rechazos HTTP reales.
- CA-7: `pnpm test:e2e` → dos perfiles/dispositivos prehabilitados, cobro offline, recarga completa sin red, desbloqueo de outbox persistida, reconexión, recuperación de sesión, revalidación y replay: exactamente dos folios/pagos provisionales, sin duplicar; Cache Storage contiene cero rutas API. Tests crypto reales → frase incorrecta/ciphertext alterado rechazados, expiración/retroceso/actor ajeno bloqueados. Tests backend → permiso firmado 72h, tamper, revocación y cadena concurrente reconstruible, verdes.
- CA-8: `./scripts/verify.sh` con TEST_DATABASE_URL de BD gym_test_gate y VITEST_MAX/MIN_FORKS/THREADS=1 → salida 0, 148 pruebas aprobadas (111 API, 26 web, 6 contracts, 5 db), ninguna omitida; lint/build/typecheck verdes, scope de 65 rutas validado. `node --check` de coordinador/runners → salida 0. Arranque `pnpm start`, parada SIGINT y revisión de diff se registran al terminar debajo.

Rojos reales antes de corrección: operaciones ausentes (suite no carga), vínculo por contacto (1/8 falla), UI de búsqueda/feed/QR (5/5 fallan), reconstrucción concurrente (1/13 falla), solape forzado (dos éxitos; 1/13 falla), informe/roster ausentes y arranque anónimo (201 frente a 403). No se inventó fase roja para presentación. El primer intento de tests offline de permiso/cifrado terminó mientras se implementaba; se conserva su resultado real, sin atribuirle un rojo inexistente.

Revisión adicional: humana por el usuario pendiente según PROMPT-MAESTRO. Esta evidencia prepara una app local operativa; no declara aceptación final del PRD, staging ni G2 autorizados. Commit local de implementación verificada autorizado y preparado, identificado por unidad 010; sin push.


Dependencias: qrcode autorizada expresamente por el usuario 2026-10-14; @types/qrcode transitiva de desarrollo. TanStack y AlertDialog según ADR 0003, Playwright según ADR 0002. ADR 0007 aceptado expresamente antes de implementación offline.

Ampliación antes de editar SessionsService: prueba adversaria de dos publicaciones simultáneas sobre agenda vacía (TX-02). El bloqueo de filas no serializa filas inexistentes; si se reproduce, usar bloqueo transaccional por organización/instructor. Conserva rechazo de solapes y contratos.

Corrección de límites HTTP antes de implementar (evidencia roja operations.integration.test.ts): arranque anónimo de organización solo en base no inicializada y endpoint legado de ingreso sin firma rechazado. ADR 0007 exige prueba firmada; los comandos core de spec 005 siguen probados, pero la superficie HTTP solo permite snapshot/permiso verificados. Conserva códigos estables y registra esta restricción en contratos.


Cierre operativo verificado: `pnpm start` → HTTP 200 en /health (3000) y web preview (4173), datos ficticios listos; SIGINT al coordinador → ambos puertos detenidos y PostgreSQL conservado (2 socios, 3 pagos). `pg_dump -Fc` y `pg_restore --exit-on-error` a BD limpia gym_010_restore_check → 2 socios, 1 vínculo estable, 2 QR, 3 pagos, 2 membresías, 1 sesión, 1 movimiento y 4 staff idénticos. Es una prueba local, no acredita restore en staging.

Diff revisado contra alcance y decisiones, sin cambios ajenos ni dependencias no autorizadas; QR qrcode aprobado, TanStack v8 compatible con React 18, AlertDialog según ADR 0003 y Playwright según ADR 0002. Ningún ADR histórico 0000–0006 fue modificado; 0007 fue propuesto y aceptado antes de implementar el mecanismo. Los secretos de runtime permanecen en .env.local ignorado y no se imprimen.

Gate final de cierre técnico: `./scripts/verify.sh` (TEST_DATABASE_URL aislado + worker único) → salida 0, 148/148 tests, lint/typecheck/build verdes, scope 65 rutas. No quedan comprobaciones técnicas previstas pendientes; revisión humana, staging/G2 y requisitos jurídicos siguen pendientes.
