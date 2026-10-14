# GYM — gestión diaria de gimnasios

App web responsive con recepción, administración, agenda de instructores y portal del socio. Vite/React PWA, Fastify, Better Auth, PostgreSQL y Drizzle; datos separados por organización.

## Abrir la app local

Requisitos: Node 22 o superior, pnpm 9 y Docker con Compose. No requiere cuentas ni servicios externos.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abre **http://localhost:5173**. El comando inicia PostgreSQL en `127.0.0.1:55432`, compila, aplica migraciones y prepara datos ficticios; después inicia API (`3000`) y web (`5173`). Genera `.env.local` ignorado por Git con secreto aleatorio si no existe; no sobrescribe configuración existente. Ctrl+C detiene web/API y conserva la base local. Repetir el arranque conserva los datos: el seed es idempotente. `pnpm dev:prepare` prepara la base sin dejar servidores abiertos.

Cuentas **solo de demostración**, contraseña común `SuperSecret123!`:

| Rol | Email |
|---|---|
| Administración | `admin@pilot.cl` |
| Segundo administrador | `admin2@pilot.cl` |
| Recepción | `recepcion@pilot.cl` |
| Instructor | `instructor@pilot.cl` |
| Socio | `socio@pilot.cl` |

## Capacidades

- Resumen de administración con socios activos, pagos pendientes, caja y próximas sesiones.
- Mostrador con QR de lectora, búsqueda por nombre/email, validación autoritativa y feed del día con estado de actualización.
- Socios: alta opcional con acceso al portal, plan inicial, ficha de membresías, contacto, historial y cobro.
- Planes configurables por precio, duración y cobertura.
- Cobros en efectivo/transferencia; confirmación o rechazo por **otro** administrador. Un pago provisional nunca habilita el ingreso ni genera un movimiento de caja.
- Caja: apertura, movimientos, cierre con confirmación y diferencia persistida; reporte diario en fecha de Santiago y exportación CSV.
- Agenda: clases grupales, personalizadas fijas, citas y bloqueos; cupos, reservas, cancelación y asistencia persistida.
- Portal móvil: QR propio revocable, membresía, reserva/cancelación y contacto editable sin cambiar la identidad de login.
- Equipo: provisión por rol y revocación de sesiones. Cierre de otras sesiones propias.
- Contingencia prehabilitada: permiso firmado por hasta 72 horas, snapshot y outbox cifrados con frase local, folios externos, revalidación, sincronización idempotente y resultados por evento. Nunca valida pagos ni permite reservas firmes sin red.

## Probar la jornada

1. En recepción, crea un socio con email/contraseña y plan inicial. Desde su ficha registra el cobro.
2. En administración, confirma ese pago desde Pagos. La membresía se activa y aparece un movimiento único en caja.
3. En recepción, busca al socio en Mostrador y valida ingreso.
4. En administración, configura una clase y publica una sesión con un instructor.
5. El socio entra a su portal, muestra el QR y reserva/cancela. El instructor consulta agenda y registra asistencia.
6. Recepción declara el cierre; administración revisa el reporte diario.

## Contingencia

Administración habilita la política y registra un dispositivo para un operador de recepción/admin. El operador inicia sesión, abre Contingencia, selecciona su dispositivo y prepara una frase local de al menos 12 caracteres. El snapshot se cifra en este navegador; conserva la frase y una copia cifrada exportada. Cada cobro/ingreso exige un folio anotado también fuera de la app.

Para **recargar la app sin red**, usa `pnpm start` y abre **http://localhost:4173**: sirve el build de producción con service worker y la API local. Detén `pnpm dev` antes de iniciarlo. Desbloquea la copia en `/contingencia`. Al reconectar, inicia sesión como el operador correspondiente y sincroniza; conserva y revisa rechazos/duplicados. Expirado el permiso, se bloquean nuevas capturas pero se conservan eventos anteriores para liquidación. Revocar un dispositivo solo se conoce sin red al reconectar; no se promete revocación instantánea desconectada.

## Verificación

```sh
./scripts/verify.sh           # gate raíz; integración requiere TEST_DATABASE_URL
pnpm test:integration         # todas las suites reales en BDs ficticias separadas
pnpm test:coverage            # CAL-2 ≥80%, dinero/reservas, PostgreSQL real
pnpm test:e2e                 # Chromium, build de producción y BD gym_e2e aislada
```

Primera vez para E2E: `pnpm exec playwright install chromium`. El runner E2E reinicializa **solo** `gym_e2e`, usa API `3100` y web `5174`, y detiene sus servidores al terminar. Integración/coverage usan `gym_test_*`; jamás ejecutar fixtures contra datos reales. Gate verde sin `TEST_DATABASE_URL` no acredita integración; el runner dedicado no omite suites.

## Estado y límites

La implementación y verificación de la entrega operativa están documentadas en `specs/010-app-operativa.md`; el checkpoint está en `STATE.md`. Revisión humana Tier 1 y piloto G2 pendientes. VPS/staging, validación jurídica de menores y soporte temporal requieren decisiones y autorización propias. No incluye pasarelas, sauna, multisede, rutinas/nutrición ni notificaciones externas.

El repo es fuente ejecutable; Notion conserva contexto. Contratos: `docs/api/README.md`. Operación/backup: `docs/operations/runbook.md`. Arquitectura y seguridad offline: ADR 0002 y 0007. No se ha realizado push ni despliegue remoto por esta entrega.
