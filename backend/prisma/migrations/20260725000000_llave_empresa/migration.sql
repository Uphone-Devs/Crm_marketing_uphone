-- Agregar columnas de llave compleja y dimensión empresa
ALTER TABLE contactos
  ADD COLUMN IF NOT EXISTS nro_contrato   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS empresa        VARCHAR(30),
  ADD COLUMN IF NOT EXISTS clave_gestion  VARCHAR(200);

-- Backfill nro_contrato desde metadata
UPDATE contactos
SET nro_contrato = TRIM(metadata->>'Nº CONTRATO')
WHERE metadata IS NOT NULL
  AND TRIM(metadata->>'Nº CONTRATO') <> '';

-- Backfill empresa desde metadata
UPDATE contactos
SET empresa = CASE
  WHEN UPPER(TRIM(metadata->>'EMPRESA')) IN ('TEC_SAS','TEC SAS','UPHONE TEC SAS') THEN 'TEC_SAS'
  WHEN UPPER(TRIM(metadata->>'EMPRESA')) IN ('SCC','S.C.C','UPHONE SCC','UPHONE S.C.C') THEN 'SCC'
  ELSE 'SCC'
END
WHERE metadata IS NOT NULL;

-- Backfill clave_gestion: empresa|nro_contrato|campana_id
-- Mismo contrato en misma campaña = misma unidad de gestión (sin importar segmento)
UPDATE contactos
SET clave_gestion = CONCAT(
  COALESCE(empresa, 'SCC'), '|',
  COALESCE(nro_contrato, id::text), '|',
  campana_id::text
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_ct_nro_contrato  ON contactos (nro_contrato);
CREATE INDEX IF NOT EXISTS idx_ct_empresa       ON contactos (empresa);
CREATE INDEX IF NOT EXISTS idx_ct_clave_gestion ON contactos (clave_gestion);
