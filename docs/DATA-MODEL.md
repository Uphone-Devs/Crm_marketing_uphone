# Modelo de Datos — CRM Marketing Uphone

> SQLite (better-sqlite3). DDL en `src/main/database/schema.sql`; migraciones idempotentes
> versionadas (M-001…M-038) en `src/main/database/db.js`, ejecutadas al iniciar. Versión 3.0.

---

## Tablas núcleo

| Tabla | Propósito | Columnas clave |
|-------|-----------|----------------|
| `usuarios` | Cuentas y roles | `id, nombre, email, password_hash, rol(admin/supervisor/asesor), estado, supervisor_id` |
| `campanas` | Campañas de cobro | `id, nombre, supervisor_id, estado, fecha_inicio` |
| `contactos` | Cartera/deudores | `id, campana_id, telefono, nombre_deudor, cedula, asignado_a, estado_marcacion, intentos_realizados, orden_marcacion, ya_pago, validado_pago, fecha_asignacion, metadata(JSON)` |
| `cdrs` | Registros de gestión/llamada | `id, contacto_id(nullable), usuario_id, tipificacion_id, timestamp_inicio, duracion_seg, resultado, monto_acordado, comprobante, forma_pago, monto_pagado, snapshot_*` |
| `tipificaciones` | Catálogo de resultados | `id, codigo, descripcion, categoria, requiere_agd, finaliza_gestion, solo_sistema` |
| `sub_gestiones` | Llamadas a referencias | `id, contacto_id, asesor_id, cdr_id, telefono, nombre_ref, parentesco, notas` |
| `agendamientos` | Compromisos/llamadas futuras | `id, contacto_id, asesor_id, tipo(PMP/VOL_CALL/REAGENDADO), fecha_hora, estado` |
| `validaciones_pago` | Pagos validados | `id, contacto_id, campana_id, contrato, cedula, empresa, monto_pagado, estado_pago, valor_en_mora, sesion_id, validado_por` |
| `sesiones_validacion` | Agrupación de validaciones | `id, creado_en, supervisor_id, total_registros, monto_total` |
| `metas_asesores` | Metas por período | `id, asesor_id, periodo, meta_diaria/semanal/mensual, valor_recaudado` |
| `eventos` | Comunicación omnicanal / actividad | `id, usuario_id, tipo(ESTADO/LLAMADA/CONEXION/DESCONEXION/ACCION_RAPIDA), estado_id, duracion_seg, metadata(JSON: canal WSP/SMS/correo)` |
| `config` | Configuración clave-valor | `clave, valor` (modo_marcacion, intentos, flags de migración, etc.) |

## Metadatos del contacto (`contactos.metadata`, JSON)
Claves usadas por las queries vía `json_extract`: `"DIAS IMPAGO"`, `"VALOR EN MORA"`, `"Nº CONTRATO"`, `"EMPRESA"`, `"CONTRATO REFINANCIADO"`. (El conjunto real depende de la carga; ver `getMetadataKeys`.)

## Índices relevantes
`idx_cdrs_contacto`, `idx_cdrs_usuario`, `idx_contactos_ya_pago`, `idx_contactos_orden_marcacion`, `idx_usuarios_supervisor_id`, `idx_ct_dias_impago` (expresión, M-037), `idx_ct_campana_fecha`.

## Migraciones (selección)
- **M-008** catálogo de tipificaciones (incluye `solo_sistema`).
- **M-011/012/014** validación de pagos + sesiones.
- **M-019/021** `fecha_asignacion`.
- **M-022** `cdrs.contacto_id` nullable + ON DELETE SET NULL (preserva historial).
- **M-024/025** fix metadata de eventos + `ACCION_RAPIDA`.
- **M-027** `validado_pago`.
- **M-036** rol `admin`.
- **M-037** índices de cartera/métricas.
- **M-038** `usuarios.supervisor_id` (aislamiento de equipos).

> Las migraciones verifican existencia de columna/tabla antes de alterar → seguras de re-ejecutar.
