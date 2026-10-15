# 015 — Recuperación de contraseña y verificación del contacto

Estado: Implementada y verificada — revisión humana pendiente
Nivel: Tier 1 — identidad, credenciales, permisos, concurrencia y migración aditiva.
Autoridad: usuario 2026-10-15 «1:C», preparar sin proveedor/envío real; «continua»; PRD REQ-1/7, D-04/B y delegación de PROMPT-MAESTRO. Commits locales autorizados; sin push/despliegue. Revisión adicional humana por usuario al cierre, propia no independiente.
Contexto (Notion): https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3

## 1. Resultado y límites

Preparar recuperación con Better Auth ya aprobado y cambio de contacto del socio únicamente tras demostrar posesión del nuevo correo. Transporte inyectable solo en pruebas con buzón ficticio; servidor operativo sin adaptador ni credenciales, capacidades falsas y UI explícita de correo pendiente. No enviar mensajes reales, instalar librerías, cambiar email de login, conceder identidad por coincidencia de contacto ni afectar cuentas/membresías ajenas. Correo real y prueba de entrega continúan pendientes, sin declarar el requisito completo.

## 2. Contratos e invariantes

- GET /api/v1/account/email-capabilities público: {passwordReset,contactVerification}, ambas false por defecto, sin consulta de existencia de cuenta. Transporte recibe propósito/destinatario/enlace, no contraseña; origen de enlace fijo de configuración confiable, nunca Host/redirect del cliente. No existe adaptador de producción en esta unidad.
- POST /api/auth/request-password-reset {email} y /api/auth/reset-password {token,newPassword}: Better Auth nativo; sin callback solicitud rechazada uniformemente (400), no genera tokens; con callback de prueba correo existente/desconocido misma respuesta genérica. Token 15 minutos, identificador hasheado en BD, un solo uso atómico, contraseña >=10, revoca sesiones existentes. No copia/registro de contraseña ni token en logs o respuestas de solicitud. No auto-login tras reset.
- POST /api/v1/members/:id/contact-verification {email}: solo socio autenticado sobre sí mismo, tenant/account/member desde sesión y datos; sin transporte 503 SERVICE_UNAVAILABLE y ningún cambio. Con transporte prueba: token aleatorio 32 bytes, solo SHA256 almacenado, caduca 15 minutos; guarda vínculo org/member/account y contacto previo. Serializar por miembro; nueva solicitud invalida anteriores. Respuesta 202 genérica sin token. Fallo de transporte cancela desafío y devuelve 503 sin contenido sensible. Entrega no altera contacto.
- POST /api/v1/members/:id/contact/verify {token}: sesión socio propia, lookup acotado y bloqueo de miembro/challenge consistente. Rechaza token inválido/caducado/usado/cancelado, otro tenant/socio y contacto previo cambiado. En transacción actualiza solo contactEmail/contactVerifiedAt, consume desafío y audita sin email/token. Un efecto bajo concurrencia; email de identidad/cuenta y roles permanecen intactos. GET nunca consume enlaces.
- PATCH contacto existente: staff conserva edición manual y siempre elimina marca verificada. Socio puede quitar contacto (null); asignar correo no nulo por PATCH se rechaza 409, debe verificarlo. Cambio deliberado para cumplir PRD, no simple corrección de expectativas. Pruebas históricas de edición directa se ajustan a este contrato nuevo, sin editar spec 002 cerrada; prueba de identidad estable usa cambio manual autorizado y nueva suite demuestra cambio verificado.
- Migración 0012 aditiva: members.contact_verified_at nullable; contact_verifications con FK, hash único, timestamps, índices org/member. Contactos existentes quedan sin verificar. Sin copias de identidad. Reversión conserva datos, no operar autogestión con versión antigua que omita verificación. Limpieza de pruebas repetible sobre BD ficticia; retención operativa pendiente antes de correo real.
- UI: recuperar accesible sin sesión; enlaces con token en fragmento, se elimina del historial tras capturarlo en memoria, sin localStorage ni query/referrer. Contacto exige sesión propia y confirmación explícita con POST. Estado correo deshabilitado visible, sin éxito ficticio. Portal no cambia dirección hasta verificar, permite eliminación. Log de request omite query y redacta segmento nativo de reset; no registra cuerpos/cookies. JSON inválido se rechaza con 400 sin reflejar el texto del parseo; errores internos en rutas de identidad se registran solo por categoría, sin objeto que pueda contener secretos.

## 3. Criterios verificables

- CA-1: capacidad false por defecto; reset conocido/desconocido mismo rechazo, contacto 503 y cero desafíos/cambios/envíos. UI y E2E muestran indisponibilidad real.
- CA-2: con buzón ficticio reset conocido/desconocido misma respuesta, token no plano en BD, caducidad/uso único/concurrencia probados; contraseña vieja falla, nueva funciona y sesiones previas inválidas.
- CA-3: desafío de contacto no muta hasta prueba; confirmación cambia contacto/marca, conserva identidad y audita; replay, expiración, reenvío y cambio manual intermedio rechazados sin efecto indebido.
- CA-4: permisos/tenant/miembro/cuenta desde servidor, adversarios 401/403/404 según alcance; PATCH no permite saltar verificación y staff/reset de marca conservados.
- CA-5: UI recuperación/confirmación accesible y honesta, token fuera de URL tras captura, sin envíos reales; E2E móvil/sesión/reservas anteriores preservados con expectativa de nuevo contrato. Serialización log no filtra tokens/query/cookies.
- CA-6: rojo antes de implementación; suites pertinentes/gate raíz sin omitidos, integración real y E2E; evidencia por CA, aprendizaje/checkpoint, diff contra e9ee19d, commit local; revisión humana y proveedor explícitamente pendientes.

## 4. Archivos autorizados

- .github/workflows/verify.yml
- PRD.md
- PROMPT-MAESTRO.md
- STATE.md
- apps/api/src/account-recovery.integration.test.ts
- apps/api/src/app.ts
- apps/api/src/auth-flow.integration.test.ts
- apps/api/src/auth.ts
- apps/api/src/email-delivery.ts
- apps/api/src/errors.ts
- apps/api/src/financial-adjustments.integration.test.ts
- apps/api/src/members.integration.test.ts
- apps/api/src/operations.integration.test.ts
- apps/api/src/safe-request.test.ts
- apps/api/src/safe-request.ts
- apps/api/src/services/cash.ts
- apps/api/src/services/contact-verification.ts
- apps/api/src/services/financial-adjustments.ts
- apps/api/src/services/members.ts
- apps/api/src/services/offline.ts
- apps/api/src/services/operations.ts
- apps/api/src/services/payments.ts
- apps/api/src/transbank.integration.test.ts
- apps/api/vitest.config.ts
- apps/web/src/App.tsx
- apps/web/src/account-recovery.test.tsx
- apps/web/src/api.ts
- apps/web/src/components/PaymentAdjustmentDialog.tsx
- apps/web/src/components/QuickPay.tsx
- apps/web/src/financial-adjustments.test.tsx
- apps/web/src/lib/payment-method.ts
- apps/web/src/pages/AccountRecovery.tsx
- apps/web/src/pages/Cash.tsx
- apps/web/src/pages/Login.tsx
- apps/web/src/pages/MemberDetail.tsx
- apps/web/src/pages/Offline.tsx
- apps/web/src/pages/Payments.tsx
- apps/web/src/pages/Portal.tsx
- apps/web/src/pages/Reports.tsx
- apps/web/src/pages/VerifyContact.tsx
- apps/web/src/transbank.test.tsx
- docs/adr/0008-ajustes-devoluciones.md
- docs/api/README.md
- docs/learning.md
- docs/operations/runbook.md
- docs/product/aceptacion-mvp.md
- packages/contracts/src/contracts.test.ts
- packages/contracts/src/index.ts
- packages/db/drizzle/0010_payment_comment.sql
- packages/db/drizzle/0011_financial_adjustments.sql
- packages/db/drizzle/0012_contact_verification.sql
- packages/db/drizzle/meta/_journal.json
- packages/db/src/index.ts
- packages/db/src/schema.ts
- scripts/coverage.mjs
- specs/012-transbank-manual.md
- specs/013-ci-integracion-e2e.md
- specs/014-ajustes-devoluciones.md
- specs/015-recuperacion-contacto.md
- tests/e2e/account.spec.ts
- tests/e2e/adjustments.spec.ts
- tests/e2e/operation.spec.ts
- tests/e2e/transbank.spec.ts

## 5. Verificación y checkpoint

Rutas heredadas de 012/013/014 solo para scope-lock contra origin/main=eac204f, sin ampliar delta propio contra e9ee19d. No cambiar reglas de gate ni ADR históricos. Implementación mediante Better Auth/PostgreSQL ya aprobados, sin elección de proveedor/stack nueva. AGENTS §9 y revisión humana de cierre aplican.

Inicial: 014 implementada en e9ee19d, revisión humana pendiente. Preparar tests rojos reales con buzón exclusivamente en fixture, migración/servicios/UI, ejecutar gate/E2E/integración, registrar evidencia y commit. Falta de progreso 0.


Ampliación autorizada de rutas 2026-10-15: incluir auth-flow.integration.test.ts; gate reprodujo expectativa antigua de PATCH sin prueba (200 esperado/409 real). El requisito de contacto verificado de PRD y contrato 015 reemplazan esa expectativa: conservar aislamiento/sesión, exigir 409 sin cambio y comprobar eliminación propia permitida. No editar spec histórica ni reducir la prueba de confirmación completa en buzón ficticio. Hipótesis descartada: fallo de aislamiento; causa exacta, contrato anterior. Contador 0 (progreso reproducible).


## 6. Evidencia de implementación

- Rojo inicial: `TEST_DATABASE_URL=… pnpm --filter @gym/api exec vitest run src/account-recovery.integration.test.ts` → 7/7 fallos por capacidades/rutas/callback ausentes (/tmp/gym-015-red.log). UI antes de implementar: recuperación/confirmación públicas no existen (/tmp/gym-015-ui-red.log).
- CA-1: suite account-recovery contra PostgreSQL → capacidades falsas, reset uniforme 400, contacto 503; cero desafíos/envíos/cambios por ausencia de transporte. UI 4/4 incluye formulario deshabilitado.
- CA-2: suite account-recovery → reset genérico, hash, TTL 15 minutos, contraseña corta no consume enlace, expiración, un único éxito concurrente entre dos instancias independientes, contraseña anterior rechazada/nueva admitida y cookie/sesiones previas revocadas.
- CA-3: suite account-recovery → contacto anterior conservado hasta confirmar; una confirmación/una auditoría bajo concurrencia; identidad intacta; reenvío/expiración/edición manual/eliminación invalidan pendientes; edición manual elimina marca verificada; fallo de entrega cancela desafío sin cambio.
- CA-4: suite account-recovery + auth-flow/members/operations → permisos, IDOR/tenant y PATCH sin prueba rechazados; eliminación propia permitida; cambio de contacto no concede identidad ni cambia cuenta.
- CA-5: `pnpm --filter @gym/web exec vitest run src/account-recovery.test.tsx` → 4/4 (/tmp/gym-015-ui-green-final.log): captura/limpieza de fragmento, confirmación explícita, ausencia de consumo sin sesión; safe-request 1/1 y JSON malformado sin reflejo. `pnpm test:e2e` → 10/10 sobre preview de producción/BD ficticia (/tmp/gym-015-e2e.log); captura móvil /tmp/gym-015-recovery-mobile.png inspeccionada sin overflow, correo pendiente y botón deshabilitado. Incluye regresión de reservas, pagos/compensaciones, CSV y dos dispositivos offline.
- CA-6: `TEST_DATABASE_URL=… VITEST_MAX_FORKS=1 VITEST_MIN_FORKS=1 VITEST_MAX_THREADS=1 VITEST_MIN_THREADS=1 ./scripts/verify.sh` → salida 0, 181/181 (132 API, 34 web, 10 contracts, 5 db), sin omitidos; lint/build/typecheck/scope verdes (/tmp/gym-015-gate-final.log). Segundo gate necesario tras corregir expectativa histórica de auth-flow; no omitir suite ni reducir controles.

Limitación confirmada al contrastar código instalado Better Auth 1.7.7 y documentación oficial: reset nativo consume token/actualiza contraseña/revoca sesiones en pasos separados, sin transacción global ante error de BD. Unidad prepara y verifica camino de éxito/rechazos, mantiene correo apagado; revisar esa atomicidad y controles operativos antes de activar entrega real. https://better-auth.com/docs/authentication/email-password; no se actualiza dependencia ni se promete comportamiento de main.


`pnpm test:coverage` → salida 0, 51/51; 96.71% statements/lines, 97.87% funciones y 75.12% ramas informativas, umbral financiero conservado (/tmp/gym-015-coverage.log). Prueba específica de configuración sin TEST_DATABASE_URL → suite nueva se colecta y omite sus 8 casos sin conectar, igual al contrato existente de suites; no sustituye gate obligatorio con BD ni se contabiliza como prueba funcional. Fixture tiene fallback ficticio explícito, sin depender de .env local (/tmp/gym-015-no-env.log).


Cierre técnico: `pnpm test:integration` → salida 0, 13 suites sobre BDs ficticias separadas, ninguna omitida (/tmp/gym-015-integration.log). Diff propio contra e9ee19d: 33 rutas, ninguna fuera de lista; `git diff --check`, `bash scripts/verify-scope.sh` (63 rutas del lote vs origin/main) y `bash scripts/verify-structure.sh` → 0. Revisión propia realizada; no es independiente. Aprendizaje y matriz actualizados.

Checkpoint final: commit local de unidad 015 por ID tras verificar staged, sin push. Remoto main comprobado por `git ls-remote origin refs/heads/main` = eac204f87afc1056c295c125ac2f16b3f893523f; 012/013/014 y esta unidad permanecen locales. Revisión humana Tier 1 requerida por PROMPT-MAESTRO/AGENTS, aún pendiente. Correo real permanece deshabilitado por decisión C; no se declara REQ-7 ni MVP completos. Próximo paso: revisión de las unidades implementadas; siguiente brecha funcional de la matriz, créditos/períodos y revalidación, requiere contrastar reglas confirmadas antes de su spec. Meta abierta, sin fallo técnico activo; contador 0.
