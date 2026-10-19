# ADR 0010 — Ciclo comercial restante: catálogo editable, pausas, reprogramación, abonos, exportaciones y menores

- **Fecha:** 2026-10-19
- **Estado:** Aceptado por el usuario en sesión de validación de base (respuestas explícitas `A1..A5`).
- **Relacionado:** [PRD.md](../../PRD.md) (`REQ-1..REQ-11`, `CAL-1..CAL-3`), [ADR 0002](./0002-arquitectura-base.md), [ADR 0007](./0007-parametros-offline-cifrado.md), [ADR 0008](./0008-ajustes-devoluciones.md), [ADR 0009](./0009-creditos-por-modalidad-periodo.md). Conserva intactos los ADR históricos.

## 1. Decisiones confirmadas por unidad

1. **Unidad 017 — Catálogo editable, pausas autorizadas y cambio de plan (`A1`):**
   - **Catálogo (`plans`):** editar precio, duración, cobertura, cuotas (`grupalCredits`, `fijaCredits`, `citaCredits`) o estado `active` actualiza la oferta para nuevas contrataciones y futuras renovaciones; nunca altera los registros ya emitidos en `membership_periods` (snapshot inmutable de `016`).
   - **Pausas autorizadas:** solo `admin` registra o levanta una pausa con motivo obligatorio (`reason`) e `idempotencyKey`. La pausa congela la cobertura durante el intervalo `[startsAt, endsAt)`, extiende el fin del período activo (`membership_periods.endsAt` y `memberships.endAt`) por los días efectivos pausados y ejecuta dentro de la misma transacción la revalidación de reservas futuras que caigan dentro del intervalo pausado, cancelándolas como pérdida de cobertura y restituyendo el crédito comprometido al período original una sola vez.
   - **Cambio de plan al siguiente período:** `admin` y `recepcion` pueden programar `nextPlanId` sobre una membresía activa; el período en curso conserva sus condiciones y el nuevo plan se aplica al registrar/validar el próximo ciclo de renovación.

2. **Unidad 018 — Reprogramación de sesiones y citas personalizadas (`A2`, `REQ-6`):**
   - `admin` y `recepcion` (y el `instructor` titular para sus propias sesiones `cita` o `bloqueo`) pueden reprogramar el horario (`startsAt`, `endsAt`) de una sesión futura en estado `programada`.
   - Bajo bloqueo transaccional de agenda del instructor (`TX-02`) y de la sesión, se verifica que no exista solape con otra sesión `programada` del instructor y que todos los socios con reserva `confirmada` mantengan cobertura vigente en la nueva fecha (`REVAL-01`).
   - Si algún socio inscrito no tiene cobertura en la nueva fecha/hora, la reprogramación se rechaza con `409 CONFLICT` sin efectos parciales; si todos cubren, las reservas confirmadas se mantienen vinculadas a la sesión reprogramada conservando su mismo crédito comprometido (sin doble descuento ni nuevo asiento en `credit_movements`) y se registra auditoría con el horario previo y nuevo.

3. **Unidad 019 — Abonos parciales y estados de conciliación (`A3`, `REQ-2`, `REQ-3`):**
   - Se permiten cobros parciales (`0 < amountCents <= plan.priceCents`) asociados a una membresía/ciclo de cobro. Cada abono parcial validado por un `admin` distinto del registrador ingresa de inmediato a la sesión de caja abierta (`cash_movements`) y queda sujeto a la política de inmutabilidad y compensaciones de [ADR 0008](./0008-ajustes-devoluciones.md).
   - Ningún abono parcial incompleto concede derechos: el período confirmado (`membership_periods`), la ventana `[startAt, endAt)` y las cuotas de créditos ([ADR 0009](./0009-creditos-por-modalidad-periodo.md)) se crean y activan únicamente cuando la suma neta de abonos validados del ciclo alcanza el `100%` del precio objetivo del plan (`targetPriceCents`).
   - El cierre de turno (`cash_sessions`) y el consolidado diario exponen explícitamente el estado de conciliación derivado e inmutable: `cuadrada` (`discrepancyCents === 0`) o `con_diferencia` (`discrepancyCents !== 0`), junto con el saldo pendiente de ciclos en abono.

4. **Unidad 020 — Matriz de exportaciones CSV (`A4`):**
   - `admin` y `recepcion` pueden exportar en CSV acotado al tenant (`organizationId`) tres reportes operativos adicionales al financiero diario: (a) padrón de socios (incluyendo estado de contacto verificado y vínculo de adulto responsable), (b) vigencias/períodos y saldos de créditos por modalidad, y (c) reservas y asistencia por rango de fechas.
   - `instructor` y `socio` reciben `403 FORBIDDEN`. Ningún CSV expone `qrToken`, hashes de verificación ni secretos.

5. **Unidad 021 — Menores con adulto responsable (`D-05`), adaptador SMTP configurable y cierre de contratos (`CAL-3`) (`A5`):**
   - En alta y edición de socios (`members`), cuando se declara condición de menor (`isMinor = true` o `adultResponsibleId` presente), el backend exige que `adultResponsibleId` referencie a un socio adulto activo del mismo tenant (`organizationId`, distinto de sí mismo y no menor). Los socios menores no pueden iniciar autogestión de cambio de correo de contacto desde el portal (`403`/`409`).
   - El transporte de correo en `apps/api/src/email-delivery.ts` incorpora un adaptador configurable por entorno (`EMAIL_DELIVERY_MODE=disabled|smtp`, apagado por defecto en local y CI sin credenciales en repo) manteniendo el contrato de capacidades (`GET /api/v1/account/email-capabilities`) de la unidad `015`.
   - Se completa la auditoría documental de contratos HTTP en `docs/api/README.md` (`CAL-3`) para la totalidad de rutas `v1`.

## 2. Límites y gobernanza

- Ninguna de estas decisiones habilita por sí misma envío de correo a personas reales, carga de datos reales (`G2`), push automático ni despliegue en producción.
- Las unidades `017`, `018`, `019`, `021` y `022` se clasifican como `Tier 1` (afectan derechos, concurrencia de agenda, dinero, identidad/menores o controles de despliegue) y requieren revisión humana del usuario al cierre. La unidad `020` (proyecciones CSV de lectura con permisos por rol) se clasifica como `Tier 2` con spec completa.
