# Estado del Proyecto: Semilla Hito 0

- Fase: `seed`; molde maestro, sin stack ni producto seleccionado.
- Base revisada: `46c519b` (Seed 007).
- Historia conservada: [Seeds 001–007](docs/history/seed-001-007.md). Sus permisos de publicación no se reutilizan para esta unidad.

## Última unidad — Seed 010 (V5)

- Meta: arranque de Hito 1 con contexto de Notion — dos modos (enriquecido/desde cero), trazabilidad mecánica, fail-safe.
- Unidad: [Seed 010](specs/seed-010-notion-bootstrap.md), Tier 1; autoridad del usuario «aprobado», 2026-10-10.
- Decisión de diseño: Notion = contexto (por qué + decisiones de negocio), nunca fuente de verdad ejecutable; el gate NO depende de Notion. Trazabilidad `SPEC:<id>` con fail-safe (advierte, no bloquea). Sin ADR de proyecto nuevo (espacio 0007+ libre). ADR anteriores intactos.
- Hallazgo de plataforma: las tools MCP de Notion solo se invocan en sesión del agente, no desde shell; `notion-context.sh` es contrato reproducible + fail-safe, la lectura real la hace el agente vía MCP.
- Estado: cerrada; CA-1–CA-7 verificados con fixtures deterministas del contrato. Cambios locales sin commit (sin política de commits autorizada).
- Evidencia: `./scripts/verify.sh` salida 0; contrato 90/90 (84 previos + 6 nuevos, incluido gate de capacidad CA-8); piloto completo; `git diff --check` 0; ADR 0000–0006 intactos.
- Gate de capacidad añadido tras revisión del usuario: entornos sin tools de Notion (VS Code Copilot, Antigravity, Codex, OpenCode) sugieren conexión según harness y ofrecen pegar a mano o Modo B, sin bloquear.
- Commit: pendiente de autorización del usuario.
- Siguiente paso: definir política de commits y decidir entrega V5 (commit/tag/release) o dejarla en local. Sin features adicionales planificadas; Linear descartado por decisión del usuario (no aporta gobernanza en la versión actual, duplica STATE). Sin unidad activa.
- Falta de progreso: contador 0, sin bloqueo.

## Cobertura y límites

La inicialización real de un proyecto de usuario sigue pendiente. El piloto temporal usa decisiones simuladas, no certifica entrevista ni stacks alternativos. El perfil offline-first continúa propuesto y sin implementación. Una aplicación completa requiere PRD y evidencia propios.
