-- Reemplaza idx_cdrs_contacto (simple) por dos índices más eficientes:
-- 1. idx_cdrs_ts: soporta filtros por rango de fecha sin unión con usuario_id
-- 2. idx_cdrs_contacto_id_desc: soporta DISTINCT ON (contacto_id) ORDER BY id DESC
--    (última tipificación por contacto sin seq scan)
DROP INDEX IF EXISTS idx_cdrs_contacto;
CREATE INDEX IF NOT EXISTS idx_cdrs_ts                ON cdrs (timestamp_inicio);
CREATE INDEX IF NOT EXISTS idx_cdrs_contacto_id_desc  ON cdrs (contacto_id, id DESC);
