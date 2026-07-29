-- cdrs no tenia ningun indice (ni siquiera en las FK contacto_id/usuario_id).
-- Postgres no indexa FKs automaticamente -> cada lookup por contacto_id
-- (join/subquery de GET /api/cartera-equipo) hacia un scan completo de la
-- tabla (90k+ filas), multiplicado por cada contacto -> incidente 2026-07-29
-- (queries de 1h+, CPU 100% en la VM, gestiones sin poder guardarse).
--
-- CONCURRENTLY: no toma lock de escritura mientras se construye sobre la
-- tabla en produccion. NO puede correr dentro de una transaccion, por eso
-- este archivo se aplica manualmente via psql, no via `prisma migrate deploy`
-- (que envuelve las migraciones en una transaccion). Ejecutar y luego:
--   npx prisma migrate resolve --applied 20260729000001_add_cdrs_indexes

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cdrs_contacto_id
  ON cdrs (contacto_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cdrs_usuario_timestamp
  ON cdrs (usuario_id, timestamp_inicio);
