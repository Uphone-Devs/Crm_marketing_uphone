-- Bug encontrado en auditoria 2026-07-29: 097ccf0 (perf(backend): consolidate
-- N+1 queries...) agrega campanas.routes.js referenciando Campana.empresa
-- (db.campana.create/findUnique/SQL crudo "SELECT c.empresa FROM campanas"),
-- pero nunca agrego la columna. Sin esta migracion, POST /api/campanas,
-- POST /api/campanas/:id/contactos y GET /api/campanas/dashboard fallan con
-- "Unknown argument/field 'empresa'" o "column c.empresa does not exist" en
-- CUALQUIER campana, no solo CREDI_TV.
ALTER TABLE "campanas" ADD COLUMN IF NOT EXISTS "empresa" TEXT;
CREATE INDEX IF NOT EXISTS "idx_campanas_empresa" ON "campanas"("empresa");
