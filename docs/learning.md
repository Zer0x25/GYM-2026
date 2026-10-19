# Aprendizaje — App GYM (GYM-2026)

> Formato mínimo: fecha, ID de unidad, hallazgo, evidencia, aplicación futura.

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
