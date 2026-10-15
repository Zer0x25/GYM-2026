# Matriz de aceptación MVP v1.0

Actualizada por unidades 012–016. Fuente ejecutable: PRD.md, ADR aceptados y specs. Contexto de negocio: [MVP aprobado](https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3). No certifica G2 ni sustituye aceptación humana. El CI publicado en eac204f omitía integración/E2E. La configuración local 013 añade BD migrada/TEST_DATABASE_URL y E2E obligatorios; ejecución remota pendiente de push autorizado, no se confunde prueba local con Actions.

## Requisitos y evidencia

| Requisito | Evidencia disponible | Estado y brecha restante |
|---|---|---|
| REQ-1 / MVP-AC-01: aislamiento | auth-flow, members, revocación, operaciones y Transbank: integración con PostgreSQL real; E2E roles de 010 | Verificado para rutas probadas; cada ruta nueva exige regresión. Soporte privado no habilitado por defecto. |
| REQ-2 / MVP-AC-02: socio → pago → derechos → ingreso | payments/checkin/operations.integration.test.ts, operation.spec.ts; transbank.integration.test.ts y transbank.spec.ts (012) | Núcleo implementado. Transbank manual en 012; snapshot de condiciones por período confirmado en 016; abonos parciales, edición/versionado de catálogo y pausas requieren unidades adicionales. |
| REQ-3 / MVP-AC-03: caja, conciliación, ajustes | cash/payments/concurrency y financial-adjustments.integration.test.ts; E2E de operación/compensación | Política aprobada ADR 0008 e implementada en 014: salidas inmutables, idempotentes y limitadas al cobro, sin alterar pago/membresía; caja y reporte con neto. Revisión humana pendiente. |
| REQ-4 / MVP-AC-04: cupos y beneficio | bookings/concurrency.integration.test.ts: última plaza y compromiso booleano | Unidad 016: cantidades expresas separadas por modalidad/período, compromiso transaccional, último crédito/última plaza y ausencia sin doble descuento. Revisión humana pendiente. |
| REQ-5 / MVP-AC-04: cancelación y cobertura | bookings.integration.test.ts: cancelación única y creditReturned; rechazo por cobertura al reservar | Unidad 016 prueba saldo, devolución/retención real y AC-215 para revisión sin traslado. Revalida al asistir y por comando staff; futuras pausas/cambios deben integrar cancelación al confirmar pérdida. No existe job de revalidación ni resolución comercial de reclamos. |
| REQ-6 / MVP-AC-05: personalizadas/agenda | sessions/bookings/operations.integration.test.ts y cita E2E: ambas modalidades en esquema, solape serializado | Publicación y reserva cubiertas por escenarios existentes; reprogramación visible y beneficios por modalidad requieren completar contrato/evidencia. |
| REQ-7 / MVP-AC-06: portal propio | guards/permissions/operations UI y API, operation.spec.ts móvil | Datos propios, QR/reservas probados. Unidad 015 prepara recuperación y prueba de contacto (caducidad, uso único, permisos, identidad estable) con buzón ficticio; correo real deshabilitado según 1:C, entrega y revisión humana pendientes. No se declara flujo externo completo. |
| REQ-8 / MVP-AC-07: concurrencia | concurrency.integration.test.ts: 2 administradores + 3 recepcionistas, TX-01/TX-05 y movimiento único | Evidencia de spec 008, conservada y regresión en suite completa. No promete capacidad de carga comercial superior. |
| REQ-9 / MVP-AC-08: offline | offline/operations.integration.test.ts; dos contextos reales de navegador con recarga/replay en operation.spec.ts; cifrado Web Crypto | Implementado para escenarios probados; permiso 72h/cifrado aceptados en ADR 0007. Compatibilidad, almacenamiento/custodia/folios y reconstrucción operativa deben validarse con equipos del piloto antes de G2. |
| REQ-10 / MVP-AC-10: exclusión sauna | Revisión de rutas/esquema/migraciones y evidencia de 001–010 | Excluido de v1.0; menciones documentales de exclusión no son funcionalidad. No implementar contratos/tablas anticipados. |
| REQ-11 / MVP-AC-09: backup, sesiones, privacidad | session-revocation.integration.test.ts; dump/restore local en BD limpia, runbook y 010 | Restore local demostrado; falta prueba en staging, privacidad de menores y procedimiento de soporte. |
| CAL-1: gate local/remoto | ./scripts/verify.sh (016): 197/197 reales, lint/build/typecheck; E2E 11/11. Unidad 013 prueba preparación/gate del workflow en BD nueva | Configuración CI fortalecida localmente; publicar/verificar Actions con autorización. Preparación rechaza URL ausente/migración fallida. Revisión humana de 013 pendiente. |
| CAL-2: cobertura financiera | pnpm test:coverage, unidad 016: 64 tests reales, 97.23% statements/lines | Umbral ≥80% conservado, suites Transbank, compensaciones y créditos incluidas. Ramas 75% informativas según decisión registrada. |
| CAL-3: contratos | packages/contracts y docs/api/README.md; nuevos contratos 012 | Revisar correspondencia completa rutas/errores/request/response e idempotencia al cierre; un índice de endpoints por sí solo no acredita todos sus contratos. |

## Detalles del alcance que siguen abiertos

- Identidad: núcleo de recuperación/verificación por enlace de un solo uso implementado en 015 y probado con transporte ficticio; falta canal de entrega elegido/habilitado, control de fallos de BD del reset en la versión instalada y prueba de entrega externa (runbook 015). Nunca devolver tokens al solicitante anónimo ni registrar enlaces en logs de producción.
- Menores: existe adultResponsibleId en el esquema, pero create/update no lo gestiona; no hay flujo validado de representación. No inventar requisitos jurídicos ni habilitar datos reales/portal delegado.
- Membresías: no hay comandos de pausa/cambio para siguiente período ni versión de condiciones contratadas. 016 añade cuotas/ledger por período y snapshot de condiciones. Edición/versionado del catálogo, pausa y cambio ordinario para siguiente período siguen pendientes.
- Dinero: abonos parciales y estados de conciliación siguen requiriendo contratos/evidencia. La política de compensaciones ya fue aprobada e implementada en 014/ADR 0008; no se reescribe spec 003 histórica. Validación de cobros sigue exigiendo admin distinto del registrador; compensaciones solo admin según nueva decisión, sin una segunda aprobación añadida.
- Reportes/exportaciones: existe CSV financiero diario; no demuestra aún exportaciones de vigencias, reservas/asistencia y socios con permisos/campos definidos.
- Cierre: revisión humana 010/012, staging/VPS/HTTPS/secretos, restore en destino, aceptación operativa y autorización G2 siguen pendientes.

## Orden de continuación

1. Unidad 012: Transbank manual y esta matriz; conservar evidencia roja/verde, migración, cobertura y E2E reales.
2. Identidad/contacto tras confirmar canal de correo; política financiera tras respuesta humana. Formularios y backend se revisan bajo Tier 1.
3. Períodos/créditos separados implementados en 016, revisión humana pendiente. Completar contratos restantes de membresías/beneficios/reprogramación y matriz de exportaciones en unidades acotadas; consultar reglas comerciales que no estén confirmadas.
4. Revisar/publicar la configuración CI 013 con autorización y verificar integración/E2E remotos; sincronizar evidencia de aceptación y realizar revisión humana.
5. Elegir y autorizar staging, desplegar con datos ficticios y verificar operación/restore; G2 solo tras su aceptación propia.

Las rutas de pruebas citadas viven en apps/api/src, apps/web/src y tests/e2e. Resultados nuevos de 012 se registran en su spec, no se presumen por este inventario. Falta de evidencia no se rellena con un gate verde ni con una decisión Derivada/Pendiente de Notion.
