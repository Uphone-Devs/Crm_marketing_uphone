-- Agregado diario por asesor (llave asesor_id + fecha 'YYYY-MM-DD' Guayaquil).
-- Escritura incremental al tipificar; lectura para dashboards históricos.
CREATE TABLE IF NOT EXISTS metricas_diarias_asesor (
    asesor_id       INTEGER          NOT NULL,
    fecha           TEXT             NOT NULL,
    gestiones       INTEGER          NOT NULL DEFAULT 0,
    efectivos       INTEGER          NOT NULL DEFAULT 0,
    neutros         INTEGER          NOT NULL DEFAULT 0,
    no_contact      INTEGER          NOT NULL DEFAULT 0,
    compromisos     INTEGER          NOT NULL DEFAULT 0,
    monto_acordado  DOUBLE PRECISION NOT NULL DEFAULT 0,
    monto_recaudado DOUBLE PRECISION NOT NULL DEFAULT 0,
    tiempo_aire_seg INTEGER          NOT NULL DEFAULT 0,
    actualizado_en  TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
    CONSTRAINT metricas_diarias_asesor_pkey PRIMARY KEY (asesor_id, fecha)
);
CREATE INDEX IF NOT EXISTS idx_mda_fecha ON metricas_diarias_asesor (fecha);
