# Aprendizaje — App GYM (GYM-2026)

> Formato mínimo: fecha, ID de unidad, hallazgo, evidencia, aplicación futura.

## 2026-10-19 — Unidad 019 — Abonos parciales con activación al 100% y conciliación de turnos

- **Hallazgo (Ciclo de abonos y concurrencia):** Un abono parcial debe ingresar inmediatamente al flujo de caja abierta (`cash_movements`), pero bajo ninguna circunstancia emitir período de membresía, extender vigencia ni habilitar créditos antes del 100% del valor del plan. Para evitar sobrepagos bajo concurrencia (múltiples terminales validando abonos simultáneamente), la validación debe serializarse adquiriendo un lock pesimista `FOR UPDATE` sobre la membresía y verificando la suma de pagos validados del ciclo antes de autorizar el movimiento.
- **Hallazgo (Diferenciación entre abono parcial tardío y renovación anticipada):** Al emitir un período, los pagos del ciclo quedan vinculados (`payments.periodId = period.id`). Si un pago provisional menor al precio del plan llega cuando el ciclo ya fue cerrado por un período posterior (`membershipPeriods.createdAt >= payment.createdAt`), el abono no puede sobrepagar el período ya cerrado y debe rechazarse con `409 AMOUNT_EXCEEDS_CYCLE_BALANCE`. En cambio, si el pago cubre el 100% del precio del plan, se trata de una renovación legítima y emite un período futuro consecutivo sin colisión.
- **Evidencia:** `apps/api/src/partial-payments.integration.test.ts` (5/5 pruebas de concurrencia y roles en Postgres real), `apps/web/src/partial-payments.test.tsx` (4/4 pruebas de interfaz), y `node scripts/coverage.mjs` (73 tests, 96.96% cobertura en módulos financieros).
- **Aplicación futura:** Para cualquier entidad que acumule pagos en cuotas o abonos, congelar el monto objetivo en la entidad (`cycleTargetCents`), vincular los pagos al completar el ciclo con una clave foránea (`periodId`), y serializar siempre con `FOR UPDATE` sobre el padre.

## 2026-10-19 — Unidad 018 — Reprogramación de agenda con advisory locks y revalidación de cobertura

- **Advisory lock en reprogramación (TX-02):** Un `FOR UPDATE` sobre la fila de la sesión a reprogramar protege la fila misma, pero no previene que una creación concurrente inserte otra sesión en el mismo horario del instructor. Usar `pg_advisory_xact_lock` sobre `(organizationId, instructorId)` tanto en creación como en reprogramación serializa completamente la agenda del instructor ante colisiones concurrentes (200 vs 409 `SESSION_OVERLAP`). Evidencia: `sessions-reschedule.integration.test.ts`.
- **Revalidación atómica de cobertura (REVAL-01):** Reprogramar sesiones con inscritos requiere validar que ningún socio pierda vigencia de período, caiga en una pausa de membresía activa (spec 017) o tenga solape con otra reserva confirmada en la nueva fecha. Si algún inscrito queda descubierto, abortar atómicamente con 409 (`RESCHEDULE_MEMBER_UNCOVERED`) preserva la integridad del horario sin desbalancear el ledger de créditos (`credit_movements`). Evidencia: `sessions-reschedule.integration.test.ts`.
- **Aislamiento en pruebas E2E con cambios de usuario:** Al verificar en una misma prueba de extremo a extremo el flujo de staff y la proyección en el portal del socio, usar un contexto de navegador nuevo (`browser.newContext()`) aísla cookies y storage, previniendo timeouts por persistencia de la sesión previa en rutas protegidas. Evidencia: `operation.spec.ts` (14/14).

## 2026-10-19 — Unidad 021 — Menores de edad, entrega segura de correo y sincronización de contratos

- **Menores y adulto responsable:** Un socio menor en el gimnasio requiere obligatoriamente un tutor adulto del mismo tenant; la autogestión de contacto debe denegarse al menor autenticado (`403 MINOR_CONTACT_MANAGED_BY_GUARDIAN`) y recaer exclusivamente en staff/adulto con registro en `audit_log`. Evidencia: `members.integration.test.ts` y `account-recovery.integration.test.ts`.
- **Adaptador de correo seguro:** El adaptador debe permanecer deshabilitado por defecto en dev/CI (`capabilities: { passwordReset: false, contactVerification: false }`) y, al activarse con transporte HTTP/webhook, aplicar `AbortSignal.timeout(5000)` y redactar URLs/tokens en respuestas de error 503 para evitar fugas de datos sensibles. Evidencia: `account-recovery.integration.test.ts`.
- **Sincronización documental mecánica:** Verificar mecánicamente que cada ruta `/api/v1/*` de `app.ts` esté documentada con su verbo HTTP y ruta en `docs/api/README.md` (`api-docs-sync.test.ts`) previene desfasajes silenciosos entre el código del servidor y los contratos publicados.

## 2026-10-19 — Unidad 017 — Comparaciones de fecha en Drizzle y aislamiento en E2E

- **Hallazgo (Drizzle & postgres-js):** pasar instancias `Date` de JavaScript en fragmentos directos ``sql`... <= ${date}`` provoca errores de serialización (`could not determine data type of parameter`). Usar los operadores tipados de Drizzle (`lte`, `gt`, `gte`, `lt`) garantiza la coerción segura de fechas ISO en PostgreSQL.
- **Hallazgo (Aislamiento E2E):** en pruebas Playwright que prueban portales de socios y administración en secuencia, hacer logout explícito (`Salir`) al terminar previene fugas de sesión en ejecuciones de un solo worker. Asimismo, `scripts/e2e.mjs` no admite ejecuciones concurrentes porque reinicia `gym_e2e`.
- **Evidencia:** 15 suites de integración (`memberships-lifecycle.integration.test.ts`), 12 tests E2E (`credits.spec.ts`), cobertura financiera en 97.09%.
- **Aplicación futura:** preferir siempre operadores de columna de Drizzle (`gte`, `lte`) para ventanas de validez temporal y cerrar sesión al finalizar pruebas E2E multi-rol.

## 2026-10-19 — Unidad 020 — Exportaciones operativas CSV con neutralización de fórmulas

- **Hallazgo:** La generación de archivos CSV de padrones y registros operativos debe aislar estrictamente el tenant (`organizationId`) en base de datos, omitir tokens secretos (`qrToken`), y neutralizar ataques de inyección de fórmulas en hojas de cálculo (CSV formula injection / DDE). Prefijar celdas que comiencen con `=`, `+`, `-`, `@`, `\t` o `\r` con `'` y escapar según RFC 4180 protege contra ejecución arbitraria al abrir los reportes en Excel o LibreOffice Calc.
- **Evidencia:** `apps/api/src/services/operations.ts` (`escapeCsvCell`), `contracts.test.ts` (12/12), `operations.integration.test.ts` (19/19), `reports-export.test.tsx` (3/3), `tests/e2e/operation.spec.ts` (12/12) y Quality Gate `./scripts/verify.sh` en verde.
- **Aplicación futura:** Aplicar siempre sanitización anti-fórmulas al generar proyecciones CSV de texto libre y validar que las fechas de sesión de los fixtures de integración estén cubiertas por las ventanas de vigencia de las membresías para evitar cancelaciones imprevistas por falta de cobertura durante `markAttendance`.

## 2026-10-19 — Unidades 017–022 — Validación de base comercial y alcance acumulado de specs

Separar una sesión de validación de reglas de negocio (`A1..A5` en `ADR 0010`) antes de codificar evita inventar políticas en pausas, reprogramaciones, abonos parciales, exportaciones y menores. Como `scripts/verify-scope.sh` compara el árbol de trabajo contra `origin/main` usando la sección `## 4. Archivos autorizados` de la `Unidad activa` en `STATE.md`, declarar en la unidad activa (`017`) y en las specs sucesivas (`018`–`022`) las rutas documentales del lote permite dejar todas las especificaciones creadas y verificadas con el gate en verde antes de escribir código.

## 2026-10-15 — Unidad 016 — Saldo por período y locks entre operaciones

Una marca booleana de reserva no acredita saldo cuantitativo. Cuotas capturadas al validar, ledger append-only y locks de membresía/período permiten último crédito entre sesiones distintas y no prestan sobrantes de renovación. Mantener inicio agregado vigente al renovar evita perder ingreso/cobertura actual al crear período futuro. Rechazar duplicado bajo lock de sesión antes de tomar saldo evita invertir locks con cancelación; cancelación de clase bloquea membresías en orden estable antes de devolver múltiples créditos. Pruebas PostgreSQL verifican carreras, restitución única, snapshots y reclamo AC-215 sin traslado. Fuente histórica 004 conservada; política cuantitativa explícitamente confirmada en ADR 0009. Evidencia por CA en spec 016.

## 2026-10-15 — Unidad 015 — Probar posesión sin sustituir identidad

Contacto e identidad deben permanecer separados: el desafío liga hash/org/miembro/cuenta y solo una confirmación consume y cambia contacto en transacción; la edición manual cancela desafíos y elimina marca verificada. Pruebas con PostgreSQL/buzón ficticio comprobaron caducidad, reenvío, tenant, concurrencia y conservación de cuenta. Better Auth necesita `revokeSessionsOnPasswordReset` explícito; se comprobó rechazo de cookie anterior con lectura autoritativa, no solo respuesta del reset. La versión instalada 1.7.7 no hace transacción global del reset; documentar esa limitación antes de correo real, sin asumir comportamiento de documentación de main. Con transporte ausente capacidades falsas y cero efectos son el contrato correcto, no un mensaje de envío exitoso. Evidencia por criterio en spec 015.

## 2026-10-15 — Unidad 014 — Compensación financiera concurrente

Conservar el pago y su ingreso único exige ledger de salidas separado. Serializar clave de intención y saldo del pago, y compartir lock del turno con el cierre, evita duplicados, exceso acumulado y egresos sobre turnos cerrados. Siete pruebas PostgreSQL comprobaron las carreras, replay posterior al cierre, roles/tenant y conservación exacta de pago/movimiento/membresía. UI conserva clave y cuerpo tras fallo de transporte. Reportes mantienen bruto y añaden salidas/neto, sin reinterpretar campos históricos. Evidencia en spec 014; no inferir que devolver dinero revoca derechos.

## Unidad 013 — Integración de CI requiere variable y migración

Tener PostgreSQL de servicio y DATABASE_URL no ejecutaba integración: las suites requieren TEST_DATABASE_URL y quedaban omitidas. El workflow ahora prepara/migra esa BD y mantiene el gate raíz, instala Chromium y ejecuta E2E como pasos obligatorios. Ensayos del literal shell bloquearon URL ausente antes de instalar y propagaron salida 31 al fallar migración; preparación/gate reales en gym_test_ci013 dieron 157/157 sin omitidos. Son pruebas locales; Actions requiere publicación autorizada. Runner ubuntu-24.04 fijado para no seguir cambios de imagen implícitos. Evitar interpretar verde como cobertura de pasos que no se ejecutaron.

## 2026-10-14 — Unidad 012 — Métodos financieros, fixtures y aceptación

Añadir un método manual exige extender los totales/proyecciones y etiquetas, no solo permitir un enum: antes el reporte sumaba únicamente cash+transfer. Contratos/API/UI fallaron por ausencia de Transbank antes de implementar; la nueva suite comprueba pago provisional, evidencia, roles/tenant, movimiento único y folio offline independiente. Conservar operación del terminal y folio de contingencia como evidencias distintas.

El runner de integración reutiliza bases ficticias; members.integration.test.ts dejaba usuarios y fallaba por user_pkey en la siguiente corrida. Truncar también la identidad del fixture preserva aislamiento sin borrar la BD ni cambiar aserciones; dos corridas consecutivas de 8/8 lo comprobaron, luego pasó el runner completo de 11 suites. La matriz de aceptación separa créditos/pausas/ajustes pendientes del núcleo ya probado: un booleano de compromiso no acredita un ledger de saldo. La captura móvil detectó crecimiento del grid por ancho intrínseco de tabla; minmax(0,1fr) conserva scroll interno sin ensanchar la página.

## 2026-10-14 — Unidad 011 — Sincronización del test de Caja

El título de una página no acredita que hayan terminado sus peticiones. CI 38661089570 y el primer gate previo al push fallaron leyendo «Abierto» antes de cargar la caja; un reintento verde solo ocultó la carrera. Fixture con promesa diferida reproduce el mismo fallo sin sleeps; findByText conserva la expectativa y espera el estado observable. Suite web: 26/26 en /tmp/gym-011-web.log. Para futuras pruebas de datos asíncronos, esperar el resultado y controlar la resolución del fixture en lugar de usar el título como señal de carga completa.

## 2026-10-11 — Unidad: Hito 0 (bootstrap Modo A)

- **Hallazgo:** el arranque en Modo A (enriquecido desde Notion) permite trasladar 55 decisiones (44 Confirmada, 8 Pendiente, 2 Derivada, 1 Diferida) y el documento de alcance MVP v1.0 aprobado sin entrevista de descubrimiento; la entrevista se reduce a validación y a cerrar las 4 puertas G1 abiertas (auth, hosting, tests, offline).
- **Evidencia:** página contenedora `3f529b8ebe2981fab0c2fa583efcdf15` + database `88e343f849ce4e4eae888d205b7dcc7b` leídas vía MCP; documento «MVP v1.0 · Cierre final para aprobación» (`3f529b8ebe2981d6a2e8dce35e0920c3`).
- **Aplicación futura:** para proyectos derivados de esta plantilla con material previo en Notion, ofrecer Modo A como ruta por defecto; mapear estados `Confirmada → aceptada`, `Pendiente/Derivada → HITO0_PENDING`, `Diferida → futuro explícito en exclusiones`. No promover pendientes ni inventar contenido ausente.

- **Hallazgo (limitación del molde):** el gate `verify-structure.sh` exige que PRD/PROMPT-MAESTRO/ADR-0002 no contengan la cadena `HITO0_PENDING`, lo que impide registrar pendientes críticos en esos tres archivos durante `initializing`/`project`; la política del bootstrap dice usar `HITO0_PENDING` para campos críticos sin resolver.
- **Evidencia:** `scripts/verify-structure.sh` líneas 48-52; los pendientes de este proyecto se registran en STATE.md y PROMPT-MAESTRO.md redactados sin el marcador literal en los archivos gateados (PRD.md, ADR-0002), conservando el estado Pendiente en STATE.
- **Aplicación futura:** al inicializar proyectos con pendientes críticos reales, concentrar los `HITO0_PENDING` en STATE.md y en specs, no en los archivos que el gate escanea; o actualizar el gate del molde en una seed futura para permitir marcadores de pendiente en archivos aprobados.


## 010 — App operativa (2026-10-14)

- Un email de contacto editable no es un vínculo de identidad: migración 0009 y cuenta estable mantienen login y revocación tras editar contacto, sin dar acceso por coincidencia de email. Evidencia: operations.integration.test.ts + E2E móvil con recarga y autorización denegada.
- FOR UPDATE sobre agenda vacía no protege una publicación concurrente: fixture PostgreSQL con demora de INSERT reprodujo dos éxitos; bloqueo transaccional por tenant/instructor deja uno. Cadenas offline requieren bloquear el dispositivo antes de leer predecessor y clock_timestamp después del bloqueo. Evidencia: tests TX-02 y reconstrucción concurrente, rojos/verde documentados en spec 010.
- Probar PWA exige build con NODE_ENV=production, shell/JS precargados antes del corte y superficie estable al recuperar sesión. La outbox sobrevivió recarga offline en dos perfiles; al reconectar se recuperó sesión, se revalidó permiso y cada folio generó un solo pago provisional. Cache Storage nunca incluye API. Evidencia: pnpm test:e2e, 7/7 (preview, PostgreSQL aislado, es-CL/Santiago).
- Gate sin TEST_DATABASE_URL omitía integración. Ejecutarlo con BD ficticia exclusiva y un worker permite verificar las 148 pruebas reales, sin cambiar ni reducir gate. pnpm test:coverage: 96.24% statements/lines en dinero/reservas. Mantener los runners aislados para futura iteración y no construir sobre dist mientras otro runner sirve esos mismos assets.
