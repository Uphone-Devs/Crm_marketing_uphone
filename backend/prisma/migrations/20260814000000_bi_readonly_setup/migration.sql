-- Migración: bi_readonly_setup
-- Crea usuario de solo lectura para Power BI DirectQuery.
-- El password NO se setea aquí (queda bloqueado hasta que el DBA
-- ejecute: ALTER USER bi_readonly PASSWORD 'tu_password_seguro';)

-- ── 1. Crear usuario si no existe ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_roles WHERE rolname = 'bi_readonly'
  ) THEN
    CREATE USER bi_readonly
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      LOGIN;
  END IF;
END
$$;

-- ── 2. Permisos de conexión y schema ──────────────────────────
GRANT CONNECT ON DATABASE crm_marketing TO bi_readonly;
GRANT USAGE ON SCHEMA public TO bi_readonly;

-- ── 3. SELECT en todas las tablas y secuencias existentes ─────
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bi_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO bi_readonly;

-- ── 4. SELECT automático en tablas futuras ────────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO bi_readonly;

-- ── 5. Revocar escritura explícitamente ───────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON ALL TABLES IN SCHEMA public FROM bi_readonly;

-- ── 6. Vista de mapeo email → supervisor (usada por RLS DAX) ──
CREATE OR REPLACE VIEW v_bi_usuario_area AS
SELECT
    u.id            AS usuario_id,
    u.email,
    u.nombre,
    u.rol::text     AS rol,
    u.supervisor_id,
    sup.email       AS supervisor_email
FROM usuarios u
LEFT JOIN usuarios sup ON sup.id = u.supervisor_id;

GRANT SELECT ON v_bi_usuario_area TO bi_readonly;

-- ── 7. Índices nuevos para queries analíticas ─────────────────

-- cdrs agrupados por usuario + fecha Guayaquil
-- (Power BI filtrará mucho por usuario_id + rango de fecha)
CREATE INDEX IF NOT EXISTS idx_cdrs_usuario_fecha
  ON cdrs (
    usuario_id,
    DATE(timestamp_inicio AT TIME ZONE 'America/Guayaquil')
  );

-- contactos por empresa + campaña
-- (filtro frecuente en reportes de cobranza por empresa)
CREATE INDEX IF NOT EXISTS idx_ct_empresa_campana
  ON contactos (empresa, campana_id);

-- validacion_pagos por fecha Guayaquil
-- (reportes de pagos validados por día)
CREATE INDEX IF NOT EXISTS idx_vp_fecha
  ON validacion_pagos (
    DATE(validado_en AT TIME ZONE 'America/Guayaquil')
  );
