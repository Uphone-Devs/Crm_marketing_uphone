-- Columnas de segmentación por canal y contenido de correo en mensajes_broadcast.
--
-- Estas columnas estaban declaradas en schema.prisma (canal, asunto, imagenUrl) pero
-- solo existían en dos archivos .sql sueltos dentro de migrations/, que `prisma migrate
-- deploy` no ejecuta porque no siguen el formato de directorio. En una base construida
-- solo con migraciones, las columnas faltaban y Prisma fallaba en cualquier consulta
-- sobre MensajeBroadcast: hace SELECT explícito de todas las columnas del modelo.
--
-- Idempotente: si ya se aplicaron a mano en producción, esta migración no hace nada.
-- Sustituye a add_canal_mensajes_broadcast.sql y add_asunto_imagen_mensajes_broadcast.sql.

-- Canal de destino. Valores válidos: 'TODOS' | 'WSP' | 'RCS' | 'CORREO'
ALTER TABLE "mensajes_broadcast"
  ADD COLUMN IF NOT EXISTS "canal" VARCHAR(20) NOT NULL DEFAULT 'TODOS';

-- Campos exclusivos del canal CORREO. Nulos para el resto de canales.
ALTER TABLE "mensajes_broadcast"
  ADD COLUMN IF NOT EXISTS "asunto" VARCHAR(255);

ALTER TABLE "mensajes_broadcast"
  ADD COLUMN IF NOT EXISTS "imagen_url" TEXT;
