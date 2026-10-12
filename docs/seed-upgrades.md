# Adoptar una actualización de Hito 0

La versión base se identifica por el commit de semilla registrado en STATE del derivado. La actualización se hace por unidad autorizada; no copiar AGENTS, PRD ni el prompt por encima de personalizaciones.

1. Registrar base instalada, revisión destino, Git limpio o cambios preexistentes y copia/worktree de evaluación. Si se desconoce la base, comparar archivos y declarar esa incertidumbre.
2. Comparar base/destino. Separar scripts comunes de decisiones de producto, permisos y comandos propios. Confirmar adopción, cambios de contrato y rutas; usar Tier 1 para cambios de controles. No ampliar delegaciones antiguas.
3. Incorporar nuevos ADR de semilla preservando los históricos. Si el número ya está ocupado por un ADR del producto, asignar otro libre y adaptar referencias, lista de integridad y fixtures en la misma unidad; no sobrescribirlo. Mantener una referencia entre el ADR original de semilla y el número local.
4. Integrar manualmente reglas vigentes en AGENTS y bootstrap, conservando PRD, arquitectura, DoD, permisos y comandos reales. La política conjunta de commits solo se activa con confirmación expresa; una autorización anterior limitada a specs sigue limitada.
5. Actualizar scripts comunes y CI conjuntamente. Conservar verify-project.sh y su cobertura; preparar runtime en CI antes del gate. Ejecutar ./scripts/verify.sh en la copia, comprobar una prueba de producto que falle y recuperar el verde. Nunca sustituir suites reales por stubs para migrar.
6. Revisar diff y aceptación; registrar evidencia y versión adoptada en STATE, con commit según permiso. Si falla, conservar checkpoint y revertir solo cambios de la migración o descartar la copia; no borrar trabajo del proyecto.

## Cambios de Seed 008

- Gate único: integridad, sintaxis, contrato y verificador de producto. El piloto temporal corre en semilla. `verify-structure.sh` es interno; no sustituye el cierre.
- Se requieren documentos no vacíos, incluidos AGENTS, STATE, ADR 0005/0006 y las referencias de capacidades/migración. No se valida automáticamente la verdad de la aceptación.
- En documentos aceptados PRD/prompt/ADR base se rechazan campos conocidos sin completar y el marcador `HITO0_PENDING`. Usar ese marcador en cualquier campo crítico que falte durante preparación; retirarlo solo al resolverlo. La plantilla reutilizable de specs puede conservar placeholders.
- `phase=initializing` identifica inicialización sin sellar. Para un proyecto ya terminado conservar `phase=project`. Para inicialización incompleta recuperar bootstrap desde la versión adoptada (o `.done`), conservar decisiones y fijar `initializing` hasta validar y sellar.
- La semilla requiere GitHub Actions; un derivado puede usar otra CI manteniendo el mismo gate y su preparación de runtime.

## Tamaño de STATE

Mantener meta, unidad activa, bloqueos, siguiente paso y cierres recientes. Al superar diez cierres, mover los más antiguos íntegros a `docs/history/` con enlace desde STATE. No archivar trabajo activo, autorizaciones aún necesarias ni contadores pendientes. IDs y evidencia siguen siendo consultables; Git no reemplaza el enlace al historial.
