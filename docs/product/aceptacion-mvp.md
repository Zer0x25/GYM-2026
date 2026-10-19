# Matriz de aceptación MVP v1.0 — Cierre G1

Actualizada tras la integración de las unidades 010–022 (Ola 1, Ola 2 y Ola 3). Fuente ejecutable: `PRD.md`, ADRs aceptados (`0002`..`0010`) y specs ejecutables `001`..`022`. Contexto de negocio: [MVP aprobado en Notion](https://app.notion.com/p/3f529b8ebe2981d6a2e8dce35e0920c3). Certifica el 100% de los criterios de la puerta **G1** (verificación técnica, CI remota y preparación operativa con datos ficticios). La puerta **G2** (piloto en terreno con datos reales) permanece estrictamente separada y sujeta a autorización explícita previa validación jurídica (`D-05`, `D-06`).

## Requisitos y evidencia verificada (G1)

| Requisito PRD | Criterio MVP | Evidencia disponible | Estado G1 |
|---|---|---|---|
| REQ-1 / MVP-AC-01 | Aislamiento multi-tenant | Integración PostgreSQL real en `auth-flow`, `members`, `plans`, `memberships`, `sessions`, `cash`, `reports` y `session-revocation`. Intentos cross-tenant retornan `404 NOT_FOUND` anti-enumeración. | **Verificado G1** |
| REQ-2 / MVP-AC-02 | Socio → pago → derechos → ingreso | `payments.integration.test.ts`, `transbank.integration.test.ts` (012), `memberships-lifecycle.integration.test.ts` (017) y `partial-payments.integration.test.ts` (019). Cobro manual y Transbank; catálogo versionado inmutable; abonos parciales entran a caja pero activan derechos y emiten período solo al 100%. Check-in QR valida cobertura activa. | **Verificado G1** |
| REQ-3 / MVP-AC-03 | Caja, conciliación y ajustes | `cash.integration.test.ts`, `financial-adjustments.integration.test.ts` (014) y `partial-payments.integration.test.ts` (019). Turno único por org, movimientos vinculados a pagos validados, salidas compensatorias inmutables e idempotentes (`TX-06`), estados de conciliación (`abierta`, `cuadrada`, `con_diferencia`) y reporte diario consolidado por método. | **Verificado G1** |
| REQ-4 / MVP-AC-04 | Cupos y compromiso de créditos | `bookings.integration.test.ts`, `credits.integration.test.ts` (016) y `concurrency.integration.test.ts`. Cuotas cuantitativas separadas por modalidad/período sin acumulación espuria, compromiso transaccional en `bookings`, última plaza concurrente serializada (`TX-01`). | **Verificado G1** |
| REQ-5 / MVP-AC-04 | Cancelación, pausas y revalidación | `bookings.integration.test.ts`, `memberships-lifecycle.integration.test.ts` (017) y `credits.integration.test.ts`. Cancelación temprana devuelve crédito, tardía lo retiene; pausas administrativas extienden vigencia y cancelan reservas con restitución de créditos; revalidación atómica de reservas. | **Verificado G1** |
| REQ-6 / MVP-AC-05 | Clases y agenda unificada | `sessions.integration.test.ts`, `sessions-reschedule.integration.test.ts` (018) y `operation.spec.ts`. Plantillas grupales y citas personalizadas; reprogramación segura con `pg_advisory_xact_lock` (`TX-02`) y revalidación atómica de cobertura de socios inscritos (`REVAL-01`). | **Verificado G1** |
| REQ-7 / MVP-AC-06 | Portal del socio y menores | `guards.test.tsx`, `account-recovery.integration.test.ts` (015) y `members.integration.test.ts` (021). QR dinámico propio, reservas, cancelación y saldo de créditos; recuperación de cuenta con expiración y uso único; vínculo obligatorio de menor a adulto responsable (`D-05`) y bloqueo de autogestión de contacto por menores (`403`). Adaptador de correo configurable y seguro. | **Verificado G1** |
| REQ-8 / MVP-AC-07 | Concurrencia de la operación | `concurrency.integration.test.ts` (spec 008) y suites de integración de 014, 016, 018, 019: 2 admins + 3 recepcionistas concurrentes probados sobre PostgreSQL real (`TX-01..TX-07`). | **Verificado G1** |
| REQ-9 / MVP-AC-08 | Contingencia offline | `offline.test.ts`, `contingency-protocol.test.ts`, `offline-vault.test.ts` y prueba E2E Playwright `tests/e2e/operation.spec.ts:167` (dos dispositivos offline conservan cobros, generan folios locales con cifrado AES-GCM y sincronizan de forma idempotente al reconectar). | **Verificado G1** |
| REQ-10 / MVP-AC-10 | Exclusión estricta de sauna | Verificación de esquema Drizzle, migraciones `0000`..`0017`, rutas Fastify y componentes React: `grep -ri sauna apps/ packages/` arroja 0 rutas/tablas de producto. | **Verificado G1** |
| REQ-11 / MVP-AC-09 | Backup/restore y privacidad | `session-revocation.integration.test.ts` (revocación inmediata de sesiones); ciclo real de backup `pg_dump -Fc` y restore en BD limpia de verificación con paridad de conteos (`organizations 1, members 2, payments 3, sessions 1, users 5`) y query de humo validada; runbook reproducible en `docs/operations/runbook.md`. | **Verificado G1** |
| CAL-1 | Gate local y CI remota | `./scripts/verify.sh` superado con 100% de tests (109 unit/integration en API + 46 en web, lint, build, typecheck); GitHub Actions `.github/workflows/verify.yml` superado en verde sobre `main` (run ID `39323982842`, 14 tests Playwright E2E pasando). | **Verificado G1** |
| CAL-2 | Cobertura financiera | `pnpm test:coverage` (`node scripts/coverage.mjs`): 77 tests pasados, 96.96% statements/lines (supera holgadamente el umbral >= 80%). | **Verificado G1** |
| CAL-3 | Contratos y sincronización | Contratos `@gym/contracts` cerrados con esquemas Zod; `docs/api/README.md` sincronizado y auditado mecánicamente con `api-docs-sync.test.ts`. | **Verificado G1** |

## Estado del Cierre G1 y Frontera con G2

1. **G1 (Cierre técnico y pre-operativo):** COMPLETADO. Todas las unidades del MVP (`001` a `021`) y la verificación de aceptación/staging (`022`) se encuentran implementadas, integradas en `main` y validadas con suite local, cobertura, E2E y CI remota en GitHub Actions.
2. **G2 (Piloto con datos reales):** REQUIERE AUTORIZACIÓN SEPARADA.
   - Validación jurídica formal de representación de menores (`D-05`) y procedimiento de acceso de soporte (`D-06`).
   - Aprovisionamiento definitivo de VPS y secretos reales en el servidor (fuera del repositorio).
   - Habilitación de transporte de correo real para notificaciones/recuperación si aplica.
   - El inicio del piloto en terreno con socios reales solo procederá cuando el usuario lo autorice explícitamente tras revisar la matriz G1.
