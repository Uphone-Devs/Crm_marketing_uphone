-- ============================================================
-- M-002: Alinear PostgreSQL con migraciones SQLite M-011..M-041
-- Fecha: 2026-07-03
-- NOTA: Ejecutar manualmente si prisma migrate falla por enums
--       psql -U postgres -d crm_marketing -f migration.sql
-- ============================================================

-- ── 1. Nuevos valores en EstadoMarcacion ─────────────────────
--   (PG 12+ permite ALTER TYPE ADD VALUE dentro de transacción)
ALTER TYPE "EstadoMarcacion" ADD VALUE IF NOT EXISTS 'EN_INTENTOS';
ALTER TYPE "EstadoMarcacion" ADD VALUE IF NOT EXISTS 'AGENDADO';
ALTER TYPE "EstadoMarcacion" ADD VALUE IF NOT EXISTS 'YA_PAGO';

-- ── 2. usuarios: supervisor_id (M-038) ───────────────────────
ALTER TABLE "usuarios"
  ADD COLUMN IF NOT EXISTS "supervisor_id" INTEGER REFERENCES "usuarios"("id");

CREATE INDEX IF NOT EXISTS "idx_usuarios_supervisor_id"
  ON "usuarios"("supervisor_id");

-- ── 3. contactos: columnas faltantes (M-011, M-019, M-026, M-027, M-041) ──
ALTER TABLE "contactos"
  ADD COLUMN IF NOT EXISTS "correo_status"        TEXT    NOT NULL DEFAULT 'INACTIVO',
  ADD COLUMN IF NOT EXISTS "ya_pago"              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "validado_pago"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fecha_asignacion"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "orden_marcacion"      INTEGER,
  ADD COLUMN IF NOT EXISTS "wsp_enviado_fecha"    TEXT,
  ADD COLUMN IF NOT EXISTS "rcs_enviado_fecha"    TEXT,
  ADD COLUMN IF NOT EXISTS "correo_enviado_fecha" TEXT;

CREATE INDEX IF NOT EXISTS "idx_ct_campana_fecha"
  ON "contactos"("campana_id", "fecha_asignacion");

CREATE INDEX IF NOT EXISTS "idx_contactos_ya_pago"
  ON "contactos"("ya_pago");

CREATE INDEX IF NOT EXISTS "idx_contactos_orden_marcacion"
  ON "contactos"("asignado_a", "orden_marcacion");

-- ── 4. cdrs: monto_acordado + snapshots ──────────────────────
ALTER TABLE "cdrs"
  ADD COLUMN IF NOT EXISTS "monto_acordado"    DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "snapshot_nombre"   TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_cedula"   TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_telefono" TEXT,
  ADD COLUMN IF NOT EXISTS "snapshot_empresa"  TEXT;

-- ── 5. mensajes_broadcast: activo (M-040) ────────────────────
ALTER TABLE "mensajes_broadcast"
  ADD COLUMN IF NOT EXISTS "activo" BOOLEAN NOT NULL DEFAULT true;
