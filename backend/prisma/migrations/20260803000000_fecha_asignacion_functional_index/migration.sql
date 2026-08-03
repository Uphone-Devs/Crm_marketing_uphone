-- Índice funcional para acelerar filtros DATE(fecha_asignacion AT TIME ZONE 'America/Guayaquil')
-- usados en los reportes vencimientos_gestiones. Sin este índice esas queries
-- hacían seq scan completo en contactos.
CREATE INDEX IF NOT EXISTS idx_ct_fecha_asignacion_gye
  ON contactos ((DATE(fecha_asignacion AT TIME ZONE 'America/Guayaquil')));
