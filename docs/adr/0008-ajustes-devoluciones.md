# ADR 0008 — Política de ajustes y devoluciones compensatorias

Fecha: 2026-10-15
Estado: Aceptado por el usuario, respuesta «2:aprobado» a la política presentada en esta sesión.
Relacionado: ADR 0002, PRD REQ-3, spec 003 (política pendiente) y spec 014 (implementación nueva). Conserva documentos históricos.

## Decisión confirmada

- Solo administración, online, puede realizar ajustes/devoluciones.
- Motivo obligatorio y movimiento compensatorio auditable e inmutable; pago original intacto.
- La suma de devoluciones nunca supera el importe validado.
- Reintentar una operación no duplica la devolución.
- Una devolución no modifica automáticamente vigencia ni derechos de membresía; su corrección se gestiona por separado.

## Aplicación técnica y límites

La spec 014 deriva ledger separado, claves de idempotencia y bloqueos transaccionales para preservar pago/movimiento original y cierre de caja. Ajustes de salida conservadores comparten límite del importe cobrado; un cobro adicional usa el flujo vigente de pago provisional y validación separada. Estas son restricciones de implementación, no autorización para ejecutar transferencias ni una política comercial nueva de compensación de derechos. No se integran bancos/pasarelas ni se habilita modo offline financiero definitivo.

## Riesgos, revisión y reversión

Concurrencia, reutilización de claves, aislamiento y cierre simultáneo se verifican con PostgreSQL real. Revisión humana Tier 1 al cierre según PROMPT-MAESTRO. Revertir no borra salidas ni altera pagos históricos: la operación financiera requiere versión que conozca el ledger. La decisión no concede push, despliegue ni G2.
