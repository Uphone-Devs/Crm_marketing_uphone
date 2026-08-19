-- Migración: bi_readonly_restricted_views
-- Restringe bi_readonly a vistas específicas (no acceso directo a tablas).
-- Solo expone columnas necesarias para Power BI DirectQuery.

-- ── 1. Revocar acceso directo a todas las tablas ──────────────
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM bi_readonly;

-- ── 2. Crear vistas restringidas ──────────────────────────────

CREATE OR REPLACE VIEW vista_cdrs AS
SELECT
    contacto_id,
    resultado
FROM cdrs;

CREATE OR REPLACE VIEW vista_contactos AS
SELECT
    id                  AS contacto_id,
    estado_marcacion,
    intentos_realizados,
    asignado_a,
    whatsapp_status,
    rcs_status,
    correo_status,
    fecha_asignacion,
    nro_contrato,
    CONCAT(nro_contrato, '-', DATE(fecha_asignacion)) AS key_pagos
FROM contactos;

CREATE OR REPLACE VIEW vista_usuarios AS
SELECT
    id      AS id_usuario,
    nombre,
    rol::text AS rol,
    estado
FROM usuarios;

CREATE OR REPLACE VIEW vista_agendamientos AS
SELECT
    contacto_id,
    fecha_hora  AS fecha_pago_comp,
    creado_en,
    estado
FROM agendamientos;

-- ── 3. Grants solo en vistas ──────────────────────────────────
GRANT SELECT ON vista_cdrs           TO bi_readonly;
GRANT SELECT ON vista_contactos      TO bi_readonly;
GRANT SELECT ON vista_usuarios       TO bi_readonly;
GRANT SELECT ON vista_agendamientos  TO bi_readonly;
GRANT SELECT ON v_bi_usuario_area    TO bi_readonly;
