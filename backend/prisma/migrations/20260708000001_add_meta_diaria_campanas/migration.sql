-- M-003: meta_diaria por campaña
-- Fecha: 2026-07-08
-- Ejecutar: psql -U postgres -d crm_marketing -f migration.sql

ALTER TABLE "campanas"
  ADD COLUMN IF NOT EXISTS "meta_diaria" DOUBLE PRECISION NOT NULL DEFAULT 0;
