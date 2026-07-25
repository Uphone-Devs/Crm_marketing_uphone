-- Elimina el valor 'supervisor' del enum Rol (rol suprimido; se conserva jefe_area con sus poderes).
-- Data-safe: previamente todos los usuarios supervisor fueron migrados a jefe_area.
-- Postgres no soporta DROP VALUE en enums → se recrea el tipo.

ALTER TABLE "usuarios" ALTER COLUMN "rol" DROP DEFAULT;
ALTER TYPE "Rol" RENAME TO "Rol_old";
CREATE TYPE "Rol" AS ENUM ('jefe_area', 'asesor', 'admin');
ALTER TABLE "usuarios" ALTER COLUMN "rol" TYPE "Rol" USING ("rol"::text::"Rol");
ALTER TABLE "usuarios" ALTER COLUMN "rol" SET DEFAULT 'asesor';
DROP TYPE "Rol_old";
