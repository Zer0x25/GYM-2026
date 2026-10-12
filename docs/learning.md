# Aprendizaje — App GYM (GYM-2026)

> Formato mínimo: fecha, ID de unidad, hallazgo, evidencia, aplicación futura.

## 2026-10-11 — Unidad: Hito 0 (bootstrap Modo A)

- **Hallazgo:** el arranque en Modo A (enriquecido desde Notion) permite trasladar 55 decisiones (44 Confirmada, 8 Pendiente, 2 Derivada, 1 Diferida) y el documento de alcance MVP v1.0 aprobado sin entrevista de descubrimiento; la entrevista se reduce a validación y a cerrar las 4 puertas G1 abiertas (auth, hosting, tests, offline).
- **Evidencia:** página contenedora `3f529b8ebe2981fab0c2fa583efcdf15` + database `88e343f849ce4e4eae888d205b7dcc7b` leídas vía MCP; documento «MVP v1.0 · Cierre final para aprobación» (`3f529b8ebe2981d6a2e8dce35e0920c3`).
- **Aplicación futura:** para proyectos derivados de esta plantilla con material previo en Notion, ofrecer Modo A como ruta por defecto; mapear estados `Confirmada → aceptada`, `Pendiente/Derivada → HITO0_PENDING`, `Diferida → futuro explícito en exclusiones`. No promover pendientes ni inventar contenido ausente.

- **Hallazgo (limitación del molde):** el gate `verify-structure.sh` exige que PRD/PROMPT-MAESTRO/ADR-0002 no contengan la cadena `HITO0_PENDING`, lo que impide registrar pendientes críticos en esos tres archivos durante `initializing`/`project`; la política del bootstrap dice usar `HITO0_PENDING` para campos críticos sin resolver.
- **Evidencia:** `scripts/verify-structure.sh` líneas 48-52; los pendientes de este proyecto se registran en STATE.md y PROMPT-MAESTRO.md redactados sin el marcador literal en los archivos gateados (PRD.md, ADR-0002), conservando el estado Pendiente en STATE.
- **Aplicación futura:** al inicializar proyectos con pendientes críticos reales, concentrar los `HITO0_PENDING` en STATE.md y en specs, no en los archivos que el gate escanea; o actualizar el gate del molde en una seed futura para permitir marcadores de pendiente en archivos aprobados.
