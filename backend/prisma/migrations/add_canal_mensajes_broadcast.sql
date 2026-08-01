-- Agregar campo canal a mensajes_broadcast
-- Ejecutar: psql $DATABASE_URL -f backend/prisma/migrations/add_canal_mensajes_broadcast.sql
-- Valores válidos: 'TODOS' | 'WSP' | 'RCS' | 'CORREO'

ALTER TABLE mensajes_broadcast
  ADD COLUMN IF NOT EXISTS canal VARCHAR(20) NOT NULL DEFAULT 'TODOS';
