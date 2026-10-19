# ADR 0011 — Arranque de Fase G2: empaquetado de producción, bootstrap limpio y controles de piloto

- **Fecha:** 2026-10-19
- **Estado:** Aceptado por el usuario (`A1..A4` en la transición de G1 a G2).
- **Relacionado:** [PRD.md](../../PRD.md) (`REQ-1`, `REQ-2`, `REQ-7`, `REQ-9`, `REQ-11`), [ADR 0002](./0002-arquitectura-base.md), [ADR 0007](./0007-parametros-offline-cifrado.md), [ADR 0010](./0010-ciclo-comercial-agenda-exportaciones.md) y [Spec 022](../../specs/022-aceptacion-ci-staging.md).

## 1. Decisiones confirmadas para el arranque de G2

1. **Artefactos ejecutables de producción e inicialización limpia (`A1`):**
   - Materializar en la raíz del repositorio el empaquetado de producción para el VPS Linux: `Dockerfile` multi-stage (Node 22 Alpine, compila `@gym/contracts`, `@gym/db`, `@gym/api` y `@gym/web`), `compose.prod.yaml` (servicios `postgres`, `api` y `caddy` con healthchecks y volúmenes persistentes), `Caddyfile` (terminación TLS, proxy inverso de `/api/*` y `/health` hacia `api:3000`, y servidor de estáticos SPA/PWA), y scripts ejecutables `scripts/backup-db.sh` y `scripts/restore-db.sh`.
   - Proveer el comando `pnpm bootstrap:org` (`apps/api/src/bootstrap-org.ts`) que crea de forma idempotente únicamente la organización real (`organizations`) y su cuenta inicial `admin` (`user`, `account`, `identity_accounts`, `staff_assignments`), **sin sembrar socios ficticios, planes demo ni turnos de caja** (a diferencia de `seed:dev`, que queda restringido exclusivamente a desarrollo local).

2. **Destino de despliegue (`A2`):**
   - Despliegue autogestionado con Docker Compose sobre VPS Linux propio del equipo, inyectando secretos reales fuera del repositorio (`.env.prod` con permisos `0600`).

3. **Política de menores (`D-05`) en el arranque del piloto (`A3`):**
   - El backend incorpora el control configurable por entorno `ALLOW_MINOR_MEMBERS` (`false` en `.env.example` de producción y en `compose.prod.yaml`).
   - Cuando `ALLOW_MINOR_MEMBERS=false`, cualquier intento de dar de alta o convertir a un socio en menor (`isMinor: true` o `adultResponsibleId` no nulo) es rechazado en el servidor con `409 MINOR_REGISTRATION_DISABLED`. Cuando se habilite (`ALLOW_MINOR_MEMBERS=true`) tras cierre jurídico o con acta física firmada por el adulto responsable, rige íntegramente la validación `adultResponsibleId` de la Unidad `021`.

4. **Canal de correo en el arranque del piloto (`A4`):**
   - El piloto inicia con `EMAIL_DELIVERY_MODE=disabled` por defecto, operando altas y cambios de contacto de forma asistida en mostrador por `admin`/`recepcion` con auditoría completa, pudiendo conmutar a `EMAIL_DELIVERY_MODE=http` o `webhook` en cualquier momento mediante variables de entorno sin modificar código.
