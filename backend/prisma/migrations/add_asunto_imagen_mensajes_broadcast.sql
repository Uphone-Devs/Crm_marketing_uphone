-- Campos extra para canal CORREO
ALTER TABLE mensajes_broadcast ADD COLUMN IF NOT EXISTS asunto     VARCHAR(255);
ALTER TABLE mensajes_broadcast ADD COLUMN IF NOT EXISTS imagen_url TEXT;
