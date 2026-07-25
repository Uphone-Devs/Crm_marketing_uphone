-- Tablas para historial de validación de pagos
-- Ejecutar: psql $DATABASE_URL -f backend/prisma/migrations/add_validacion_tables.sql

CREATE TABLE IF NOT EXISTS validacion_sesiones (
  id            SERIAL PRIMARY KEY,
  supervisor_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en     TIMESTAMP DEFAULT NOW(),
  n_pagado      INTEGER DEFAULT 0,
  n_excedente   INTEGER DEFAULT 0,
  n_abono       INTEGER DEFAULT 0,
  monto_real    DECIMAL(12,2) DEFAULT 0,
  monto_abono   DECIMAL(12,2) DEFAULT 0,
  registros     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS validacion_pagos (
  id             SERIAL PRIMARY KEY,
  sesion_id      INTEGER REFERENCES validacion_sesiones(id) ON DELETE CASCADE,
  contacto_id    INTEGER REFERENCES contactos(id) ON DELETE CASCADE,
  nombre_deudor  TEXT,
  cedula         TEXT,
  contrato       TEXT,
  empresa        TEXT,
  campana_nombre TEXT,
  asesor_nombre  TEXT,
  estado_pago    TEXT,
  valor_en_mora  DECIMAL(12,2),
  monto_pagado   DECIMAL(12,2),
  validado_por   INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  validado_en    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vp_sesion    ON validacion_pagos(sesion_id);
CREATE INDEX IF NOT EXISTS idx_vp_contacto  ON validacion_pagos(contacto_id);
CREATE INDEX IF NOT EXISTS idx_vs_creado_en ON validacion_sesiones(creado_en DESC);
