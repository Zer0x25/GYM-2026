# ADR 0007 — Cliente offline cifrado y permiso temporal

Fecha: 2026-10-14
Estado: Aceptado por el usuario en esta sesión (2026-10-14), respuesta «Aceptar el mecanismo propuesto».
Relacionado: ADR 0002 §2.5; spec 010; REQ-9. Conserva ADR históricos.

## Decisión propuesta

- Permiso online emitido por el servidor y firmado (HMAC con AUTH_SECRET), máximo 72 horas confirmado por el usuario; vinculado a organización, dispositivo, operador y captura. Solo admin prehabilita dispositivo y organización. Permiso/snapshot solo se renueva online tras verificar sesión, rol, dispositivo y política. Eventos tras revocación se conservan y rechazan; no activan derechos ni generan dinero confirmado.
- Snapshot mínimo y outbox persistidos en IndexedDB, cifrados con AES-GCM Web Crypto; clave derivada de frase local del operador (mínimo 12 caracteres) con PBKDF2 SHA-256, salt aleatorio e IV aleatorio por escritura. La frase y la clave solo viven en memoria; bloqueo al salir/cambiar operador. No se guarda contraseña de login ni datos legales. IndexedDB nunca autoridad central.
- Estructura local separada por organización/operador/dispositivo; un bloqueo Web Locks serializa escrituras y sincronización entre pestañas (si no está disponible, modo offline no habilitado). Folio externo obligatorio, event_id UUID estable al reintentar; reconocimiento por evento con conservación de rechazos/duplicados para revisión humana. Se conserva copia externa del folio, ya que pérdida del perfil/clave puede hacer irrecuperable el outbox.
- Recepción puede cobrar provisionalmente e identificar ingreso con snapshot vigente ≤72h; no permite reservas firmes ni valida pagos. Rechaza reloj retrocedido detectado y fechas posteriores al fin de permiso; dispositivo revocado se conoce al reconectar, nunca se promete revocación instantánea sin red. Red conectada exige revalidar antes de operar; no confunde 403/401 con falta de internet.
- Backup central no incluye la outbox local. Cierre/salida advierte si hay eventos pendientes; no elimina datos pendientes silenciosamente. Solo borra snapshot/outbox por acción explícita tras reconocimiento/reconstrucción o exportación cifrada.

## Riesgos y controles

Una frase olvidada puede perder los datos locales; folio físico/externo y exportación cifrada permiten reconstrucción. El cifrado protege almacenamiento en reposo, no un navegador comprometido/XSS ni reloj del equipo manipulado fuera de detección local. Uso solo en equipos controlados; validación real de menores/soporte y piloto G2 siguen pendientes. Pruebas adversarias: clave incorrecta, ciphertext alterado, expiración, actor/tenant/dispositivo ajeno, revocación, reenvío concurrente, pérdida de reconocimiento y recuperación tras recarga.

## Reversibilidad y aceptación

Sin nuevas tablas salvo campos de permiso si se justifican en spec; snapshot y outbox se descartan solo por acción explícita tras reconciliar. Se puede deshabilitar por organización sin borrar auditoría. La duración 72h está confirmada; el mecanismo de cifrado/clave fue aceptado expresamente por el usuario antes de implementación. Revisión humana Tier 1 al cierre según PROMPT-MAESTRO.
