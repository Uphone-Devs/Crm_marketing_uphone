-- corregir-estado-en-intentos.sql
--
-- Cierra los contactos que quedaron colgados en EN_INTENTOS pese a haber
-- sido trabajados. Dos causas historicas, misma consecuencia:
--
--   1. Flujo viejo (clientes 3.0.4 y anteriores): la tipificacion hacia tres
--      escrituras HTTP sueltas. /intentar dejaba EN_INTENTOS y
--      /gestionar debia pisarlo con GESTIONADO; cuando esa segunda llamada
--      fallaba bajo carga, el contacto quedaba asi.
--   2. Entre el 2026-09-22 y el restart del 2026-09-23 ~11:30, el endpoint
--      transaccional dejaba NC y BUZON en EN_INTENTOS a proposito (decision
--      equivocada, ya revertida en backend/src/domain/tipificacionEstado.js).
--
-- Regla de negocio confirmada con la operacion: si el asesor llamo y
-- tipifico, la gestion cuenta y el contacto queda GESTIONADO.
--
-- ── Criterio ───────────────────────────────────────────────────────────────
--
-- Se corrigen los contactos en EN_INTENTOS que tengan al menos un CDR
-- tipificado. Eso es exactamente "fue trabajado": hubo llamada y hubo
-- eleccion de estado de gestion.
--
-- Los que estan en EN_INTENTOS SIN ningun CDR tipificado NO se tocan: son
-- marcaciones sin tipificar, no hay gestion que contabilizar.
--
-- Es idempotente: al pasar a GESTIONADO dejan de cumplir el filtro, asi que
-- una segunda corrida no hace nada.
--
-- ── Efecto operativo a tener en cuenta ─────────────────────────────────────
--
-- EN_INTENTOS tiene prioridad 0 en la cola de marcacion (sale antes que
-- PENDIENTE); GESTIONADO tiene prioridad 3. Al cerrarlos, esos contactos
-- dejan de aparecer primero. Es el comportamiento correcto segun la regla de
-- negocio, pero conviene avisar a la operacion antes de aplicarlo en plena
-- jornada.
--
-- Corre dentro de una transaccion que termina en ROLLBACK: revisar el preview
-- y la verificacion, y recien ahi cambiar la ultima linea por COMMIT.

BEGIN;

-- ── Preview: cuantos se corrigen y desde cuando vienen ─────────────────────
SELECT COUNT(*) AS contactos_a_corregir
FROM contactos co
WHERE co.estado_marcacion = 'EN_INTENTOS'
  AND EXISTS (SELECT 1 FROM cdrs c WHERE c.contacto_id = co.id AND c.tipificacion_id IS NOT NULL);

SELECT date_trunc('day', ultima.ts) AS dia, COUNT(*) AS contactos
FROM contactos co
CROSS JOIN LATERAL (
  SELECT MAX(c.timestamp_inicio) AS ts
  FROM cdrs c WHERE c.contacto_id = co.id AND c.tipificacion_id IS NOT NULL
) AS ultima
WHERE co.estado_marcacion = 'EN_INTENTOS' AND ultima.ts IS NOT NULL
GROUP BY 1 ORDER BY 1 DESC;

-- ── Los que NO se tocan, para dejar constancia de que quedan afuera ────────
SELECT COUNT(*) AS en_intentos_sin_tipificar_no_se_tocan
FROM contactos co
WHERE co.estado_marcacion = 'EN_INTENTOS'
  AND NOT EXISTS (SELECT 1 FROM cdrs c WHERE c.contacto_id = co.id AND c.tipificacion_id IS NOT NULL);

-- ── Correccion ─────────────────────────────────────────────────────────────
UPDATE contactos co
SET estado_marcacion = 'GESTIONADO'
WHERE co.estado_marcacion = 'EN_INTENTOS'
  AND EXISTS (SELECT 1 FROM cdrs c WHERE c.contacto_id = co.id AND c.tipificacion_id IS NOT NULL);

-- ── Verificacion: no debe quedar ninguno con gestion sin contabilizar ──────
-- Esperado: 0.
SELECT COUNT(*) AS aun_colgados
FROM contactos co
WHERE co.estado_marcacion = 'EN_INTENTOS'
  AND EXISTS (SELECT 1 FROM cdrs c WHERE c.contacto_id = co.id AND c.tipificacion_id IS NOT NULL);

-- ══════════════════════════════════════════════════════════════════════════
-- Si "aun_colgados" da 0 y el conteo del preview coincide con lo esperado,
-- cambiar esta linea por COMMIT. Si no, dejar ROLLBACK y no se guarda nada.
-- ══════════════════════════════════════════════════════════════════════════
ROLLBACK;
-- COMMIT;
