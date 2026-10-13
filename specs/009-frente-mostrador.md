# Spec: Frente — Mostrador de recepción (spec 009)

> Estado: **En curso** — backend del feed implementado y verificado (2026-10-13); UI del mostrador implementada y compilada; sellado pendiente de familiaridad del usuario con el uso real.
> Nivel: Tier 2 — Estándar; justificación: el mostrador no introduce invariantes de negocio nuevas (reusa check-in/cobertura de spec 007); el aporte es una superficie de acción sobre endpoints existentes + un endpoint de solo lectura (feed).
> Requisitos: REQ-7 (portal/QR), REQ-8 (operación concurrente), PRD §recepción.
> ADR aplicables: docs/adr/0003-sistema-de-diseno.md (Tailwind+Radix+shadcn), docs/adr/0002-arquitectura-base.md (backend autoridad).
> Aceptación: pendiente. El usuario pidió "un primer acercamiento real" e irá indicando qué agregar/quitar a medida que se familiarice con la interfaz.

## 1. Objetivo y alcance

- **Resultado observable:** el recepcionista valida el ingreso de un socio escaneando su QR (o escribiendo el token) y ve al instante si puede pasar (verde) o por qué no (rojo, con motivo y oferta de renovación); a la derecha, un feed en vivo de los ingresos del día. Una sola acción dominante, sin navegación de dashboard.
- **Surface (claude-design): Operate.** No es un Monitor ni un Decide/Learn — el recepcionista está de pie, apurado, con un socio enfrente; necesita acción en <15 s, no explorar secciones.
- **Incluye:**
  - `GET /api/v1/checkins/recent` (nuevo, solo lectura, tenant-scoped): proyección del `audit_log` (checkin.ok/denied) unido al nombre del socio. Verificado con 3 tests de integración.
  - `apps/web/src/pages/Mostrador.tsx`: escaneo (input de token, listo para lectora física que emita Enter), modal de resultado permitido/denegado/desconocido, feed con polling cada 8 s.
  - Ruta `/` del staff apuntando a Mostrador; entrada "Mostrador" primera en el sidebar.
  - Cliente `api.checkin`, `api.myQr`, `api.recentCheckins` + tipos `CheckinResult`/`CheckinFeedEntry`.
- **Excluye (por ahora, a pedido del usuario):** escáner con cámara (la lectora física emite el token como input + Enter, que el form ya captura), rediseño del resto del frente (Socios/Pagos/Caja/Clases), portal del socio avanzado. Se agregarán por indicación del usuario tras familiarizarse con el mostrador.

## 2. Contratos e invariantes

- **Backend es autoridad (ADR-0002 §3):** la UI NUNCA autoriza. `allowed:false` es decisión de negocio (cobertura), se muestra como 200 con motivo, no como error. Cross-tenant/token desconocido → 404 real (el mostrador muestra "QR no reconocido" neutral, sin leak de existencia).
- **Feed tenant-scoped:** otro org nunca aparece; un socio no puede consultarlo (403). Heredado de spec 007 + verificado.
- **Color reservado para estado:** verde = ingresó, rojo = denegado; un solo azul para lo accionable. Sin gradientes ni decoración (anti-slop).
- **Polling, no websocket:** el feed refresca cada 8 s con `fetch` nativo; cero dependencias nuevas. Un deployment real puede cambiarlo por SSE/WS sin tocar el contrato.

## 3. Comportamientos BDD

```gherkin
Escenario: recepcionista escanea un QR con cobertura activa
  Dado un socio con membresía vigente
  Cuando se escanea su QR en el mostrador
  Entonces aparece "✓ <nombre>, puede ingresar" con la fecha de vencimiento
  Y el feed de ingresos muestra la entrada como "Ingresó"

Escenario: recepcionista escanea un QR sin cobertura
  Dado un socio con membresía vencida
  Cuando se escanea su QR
  Entonces aparece "✕ Ingreso denegado — <motivo>" y se ofrece la renovación
  Y el feed muestra la entrada como "Denegado"

Escenario: token desconocido o de otro tenant
  Cuando se escanea un QR no reconocido
  Entonces aparece "QR no reconocido" (404 real, sin leak de existencia)
```

## 4. Diseño de datos

- Sin tablas nuevas. `recentCheckins` lee `audit_log` (organizationId, action ∈ {checkin.ok, checkin.denied}, entityId = memberId) con join a `members.fullName`, ordenado por `createdAt` desc, limit configurable (1..200). Cast `members.id::text = audit_log.entity_id` (uuid vs text).

## 5. Plan de implementación y verificación

- Backend: `CheckinService.recentCheckins` + ruta `GET /checkins/recent`. Tests: 11/11 en `checkin.integration.test.ts` (3 nuevos del feed). ✅
- Frontend: `Mostrador.tsx` + rutas + cliente api. Typecheck/lint/build verdes; gate del proyecto verde. ✅
- Verificación end-to-end por HTTP real: PENDIENTE — el arranque `pnpm start` no carga `.env` (AUTH_SECRET/DATABASE_URL) y el sign-in dev da 500 por desajuste de credenciales del container; la verificación real quedó cubierta por los tests de integración contra Postgres. A resolver junto con el runbook de despliegue.

## 6. Criterios de aceptación

- CA-1: escaneo con cobertura → permitido, feed lo refleja. (test + UI)
- CA-2: escaneo sin cobertura → denegado con motivo, feed "Denegado". (test + UI)
- CA-3: token desconocido/otro tenant → "QR no reconocido", sin leak. (test + UI)
- CA-4: feed tenant-scoped, socio no puede consultarlo (403). (test)
- CA-5: la UI no autoriza por sí sola; allowed:false no es error de transporte. (diseño)
- CA-6: cero dependencias nuevas; color reservado para estado. (diseño)
