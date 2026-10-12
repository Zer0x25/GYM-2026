# API contracts — App GYM (GYM-2026)

Contratos HTTP documentados. Los esquemas ejecutables viven en
`packages/contracts` (fuente única); este documento es la vista legible.
El backend es autoridad: la UI nunca autoriza por sí sola.

## Convenciones

- Base path: `/api/v1`.
- Formato: JSON. Respuestas OK envueltas en `{ data: ... }`.
- Errores: forma estable `{ error: { code, message, details? } }`.
- Códigos de error: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401),
  `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_ERROR` (500).
- Tenant: resuelto desde la sesión verificada; nunca desde el cliente (REQ-1).
- Idempotencia: operaciones de dinero y sync offline exigen
  `Idempotency-Key` (se documenta al implementar esas unidades).

## Health

### `GET /health`

Sin autenticación. `200` → `{ "status": "ok" }`.

## Organizations

### `POST /api/v1/organizations`

Crea una organización (tenant). Provisión inicial; el alta masiva queda fuera
del alcance del andamiaje.

Request (`CreateOrganizationRequest`):

```json
{ "name": "Gimnasio Piloto" }
```

Respuesta `201`:

```json
{ "data": { "id": "uuid", "name": "Gimnasio Piloto" } }
```

Errores: 400 `VALIDATION_ERROR` (nombre vacío).

## Auth (placeholder — Entrega 1)

### `GET /api/v1/auth/session`

Reserva del contrato. Devolverá `SessionResponse`:

```json
{
  "data": {
    "user": { "id": "uuid", "email": "admin@gym.cl", "name": "Admin" },
    "organization": { "id": "uuid", "name": "Gym A" },
    "role": "admin"
  }
}
```

Pendiente: proveedor e endpoints reales (Better Auth, ADR-0002 §2.2).

## Miembros y planes (placeholder — Entrega 1/2)

`CreateMemberRequest`, `CreatePlanRequest` y `PlanRef` ya tienen esquema en
`packages/contracts`; sus endpoints se documentan al implementar cada unidad.
Sin endpoints de sauna en v1.0 (MVP-SAUNA-01/B).
