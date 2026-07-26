-- Backfill empresa='CREDI_TV' for Credi TV contacts (previously defaulted to 'SCC')
UPDATE contactos
SET empresa = 'CREDI_TV'
WHERE UPPER(TRIM(COALESCE(metadata->>'EMPRESA', ''))) IN ('CREDI TV', 'CREDI_TV', 'CREDITV');

-- Refresh clave_gestion for affected rows
UPDATE contactos
SET clave_gestion = CONCAT(
  COALESCE(empresa, 'SCC'), '|',
  COALESCE(nro_contrato, id::text), '|',
  campana_id::text
)
WHERE empresa = 'CREDI_TV';
