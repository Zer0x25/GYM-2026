# ADR 0009 — Créditos separados por modalidad y período

- Estado: Aceptado por el usuario, 2026-10-15.
- Autoridad: respuesta explícita a la pregunta de continuación: «Sí, configurar cantidades por modalidad y período, sin acumulación».
- Relación: PRD REQ-2/4/5/7; ADR 0002; sustituye para planes limitados la simplificación de beneficio booleano de spec 004, que se conserva histórica.

Los planes limitados configuran cantidades separadas de grupales, personalizadas fijas y citas por período confirmado de membresía. No acumular sobrantes ni prestar saldo de otra modalidad/período. Cupo, reserva y compromiso de un crédito se confirman atómicamente, una vez. No volver a descontar al asistir ni por ausencia.

Cancelación temprana o por gimnasio restituye al período original una vez; tardía y ausencia retienen. Si el período venció, conservar reclamo para revisión administrativa (AC-215), sin traslado, prórroga ni compensación comercial automática. Cantidades reales configuradas expresamente por gimnasio; ningún valor ficticio de prueba se convierte en política comercial.

Snapshots por período, ledger append-only y locks PostgreSQL son implementación dentro del stack aprobado. Períodos limitados históricos sin cuotas no adquieren saldos inventados; nueva reserva limitada exige configuración y pago validado. Mantener pagos inmutables, roles/validación y membresías sin efecto automático por compensación conforme ADR 0008. Revisión humana Tier 1 de implementación pendiente.
