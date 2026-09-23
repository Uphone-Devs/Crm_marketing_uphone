-- corregir-categorias-tipificaciones.sql
--
-- La columna tipificaciones.categoria quedo mal cargada: 24 de 26 codigos
-- decian 'NO_CONTACTADO', incluidos PAGO_REAL, PMP y CON_PAGO, y NINGUNO
-- tenia categoria de contacto efectivo. Como las metricas clasifican por esa
-- columna, "contactos efectivos" daba estructuralmente 0 y "no contactados"
-- se llevaba casi todo.
--
-- El mapeo de abajo lo confirmo la operacion el 2026-09-23. Toma como base el
-- de backend/prisma/seed-catalogo.js con cinco correcciones pedidas:
--   NC, BUZON, NO_DISP y NO_WSP  ->  NO CONTACTADO  (el seed los tenia NEUTRO;
--                                     si nadie atendio, no hubo contacto)
--   NEGOCIACION                  ->  CONTACTO NEUTRO (el seed lo tenia EXITOSO)
--
-- NEG queda NEUTRO y VOL_CALL queda EXITOSO, tal como el seed.
--
-- Se actualiza SOLO categoria. Las descripciones de la base estan mas
-- refinadas que las del seed (ej. CUE es "Llamada colgada" en la base y
-- "Cuenta inexistente" en el seed, REF es "Referencia" contra "Refutacion")
-- y no se tocan. Por eso no sirve correr npm run seed:catalogo: pisaria esas
-- descripciones.
--
-- Las variantes con espacio son las que ya usa el seed; el codigo acepta
-- tanto 'CONTACTO EXITOSO' como 'CONTACTO_EFECTIVO', asi que no hay que tocar
-- nada del backend.
--
-- Idempotente: reaplicarlo deja los mismos valores.
--
-- Afecta reportes hacia adelante Y hacia atras (las metricas se recalculan
-- por JOIN contra esta tabla), salvo metricas_diarias_asesor, que es un
-- agregado incremental ya escrito. Ver nota al final.

BEGIN;

-- ── Antes: como esta hoy ───────────────────────────────────────────────────
SELECT categoria, COUNT(*) AS codigos
FROM tipificaciones GROUP BY categoria ORDER BY 2 DESC;

-- ── Correccion ─────────────────────────────────────────────────────────────
UPDATE tipificaciones SET categoria = 'CONTACTO EXITOSO'
WHERE codigo IN ('PMP', 'CON_PAGO', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP', 'VOL_CALL');

UPDATE tipificaciones SET categoria = 'CONTACTO NEUTRO'
WHERE codigo IN ('CON_SIN', 'TER', 'REF', 'NOTIFICADO', 'INCUMP', 'NEG', 'NEGOCIACION');

UPDATE tipificaciones SET categoria = 'NO CONTACTADO'
WHERE codigo IN ('NC', 'BUZON', 'NO_DISP', 'NO_WSP', 'NO_CON', 'NO_CON_OCU',
                 'COLGADO', 'CUE', 'APAGADO', 'INCORRECTO', 'EQ', 'SUS', 'REF_ELIM');

-- ── Despues: debe dar 6 exitosos, 7 neutros, 13 no contactados ────────────
SELECT categoria, COUNT(*) AS codigos
FROM tipificaciones GROUP BY categoria ORDER BY 2 DESC;

-- ── Ningun codigo debe quedar sin clasificar ───────────────────────────────
-- Esperado: 0 filas.
SELECT codigo, descripcion, categoria
FROM tipificaciones
WHERE categoria NOT IN ('CONTACTO EXITOSO', 'CONTACTO NEUTRO', 'NO CONTACTADO');

-- ── Impacto: como quedan las gestiones de hoy con el mapeo nuevo ───────────
SELECT t.categoria, COUNT(*) AS gestiones_hoy
FROM cdrs c JOIN tipificaciones t ON t.id = c.tipificacion_id
WHERE c.timestamp_inicio >= CURRENT_DATE
GROUP BY t.categoria ORDER BY 2 DESC;

-- ══════════════════════════════════════════════════════════════════════════
-- Si el conteo da 6 / 7 / 13 y no quedan codigos sin clasificar, cambiar esta
-- linea por COMMIT. Si no, dejar ROLLBACK y no se guarda nada.
--
-- PENDIENTE APARTE: metricas_diarias_asesor guarda efectivos/neutros/no_contact
-- ya sumados con la clasificacion vieja. Esas filas historicas no se corrigen
-- con este script; hay que recalcularlas con backend/scripts/
-- backfill-metricas-diarias.js si se quiere el historico coherente.
-- ══════════════════════════════════════════════════════════════════════════
ROLLBACK;
-- COMMIT;
