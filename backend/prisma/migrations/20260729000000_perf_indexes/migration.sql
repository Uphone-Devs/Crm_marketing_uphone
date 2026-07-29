-- Índices de performance: columnas consultadas constantemente por métricas,
-- búsquedas y dashboards. Sin ellos, counts sobre cdrs/contactos hacen seq scan.
CREATE INDEX IF NOT EXISTS idx_cdrs_usuario_ts     ON cdrs (usuario_id, timestamp_inicio);
CREATE INDEX IF NOT EXISTS idx_cdrs_contacto       ON cdrs (contacto_id);
CREATE INDEX IF NOT EXISTS idx_cdrs_tipif          ON cdrs (tipificacion_id);
CREATE INDEX IF NOT EXISTS idx_cdrs_resultado      ON cdrs (resultado);
CREATE INDEX IF NOT EXISTS idx_ct_telefono         ON contactos (telefono);
CREATE INDEX IF NOT EXISTS idx_ct_cedula           ON contactos (cedula);
CREATE INDEX IF NOT EXISTS idx_ct_asignado_estado  ON contactos (asignado_a, estado_marcacion);
CREATE INDEX IF NOT EXISTS idx_ct_wsp_fecha        ON contactos (wsp_enviado_fecha);
CREATE INDEX IF NOT EXISTS idx_ct_rcs_fecha        ON contactos (rcs_enviado_fecha);
CREATE INDEX IF NOT EXISTS idx_ct_correo_fecha     ON contactos (correo_enviado_fecha);
CREATE INDEX IF NOT EXISTS idx_ev_usuario_tipo_ts  ON eventos (usuario_id, tipo, timestamp);
CREATE INDEX IF NOT EXISTS idx_vp_validado_en      ON validacion_pagos (validado_en);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol_estado ON usuarios (rol, estado);
