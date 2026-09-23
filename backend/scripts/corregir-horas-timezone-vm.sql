-- corregir-horas-timezone-vm.sql
--
-- Corrige registros historicos escritos mientras la VM corria con la zona
-- horaria cambiada (ver memoria del incidente 2026-09-22/23): el backend
-- interpretaba las horas "naive" que manda el cliente (nowLocalISO(), sin
-- Z/offset) usando la zona horaria del proceso en vez de tratarlas siempre
-- como UTC -- eso sumaba +5h a cdrs.timestamp_inicio, cdrs.timestamp_fin,
-- cdrs.scheduled_datetime y agendamientos.fecha_hora durante la ventana
-- afectada. El fix de codigo (backend/src/utils/fechas.js) ya corta esto
-- hacia adelante; este script es SOLO para lo que ya quedo mal guardado.
--
-- OBLIGATORIO antes de correr esto: completar la ventana de fechas abajo
-- con el dato confirmado (cuando se cambio la zona horaria de la VM y,
-- si ya se revirtio o el fix ya esta desplegado, cuando termina la
-- ventana). NO correr con los placeholders tal cual estan.
--
-- Uso seguro: todo corre dentro de una transaccion que arranca en modo
-- solo-vista (ROLLBACK al final). Revisar el preview y los IDs impresos
-- ANTES de cambiar el ROLLBACK final por COMMIT.
--
-- Es un backfill de UNA sola vez: si se corre dos veces sobre el mismo
-- rango después de haber hecho COMMIT, vuelve a restar 5h y arruina los
-- datos que ya estaban corregidos. Guardar los IDs que imprime este
-- script (o el rango de fechas exacto ya corregido) para no repetirlo.

\set ventana_desde '''2026-09-XXTXX:XX:00'''  -- COMPLETAR: inicio de la ventana afectada
\set ventana_hasta '''2026-09-XXTXX:XX:00'''  -- COMPLETAR: fin de la ventana afectada (o NOW() si sigue corriendo mal)

BEGIN;

-- ── Preview: cuántas filas se van a tocar en cada tabla/columna ──────────
SELECT 'cdrs.timestamp_inicio' AS columna, COUNT(*) AS filas_afectadas
FROM cdrs WHERE timestamp_inicio BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp
UNION ALL
SELECT 'cdrs.timestamp_fin', COUNT(*)
FROM cdrs WHERE timestamp_fin BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp
UNION ALL
SELECT 'cdrs.scheduled_datetime', COUNT(*)
FROM cdrs WHERE scheduled_datetime BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp
UNION ALL
SELECT 'agendamientos.fecha_hora', COUNT(*)
FROM agendamientos WHERE fecha_hora BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp;

-- ── IDs exactos que se van a tocar (guardar esta lista) ──────────────────
SELECT 'cdrs' AS tabla, id, timestamp_inicio, timestamp_fin, scheduled_datetime
FROM cdrs
WHERE timestamp_inicio BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp
   OR timestamp_fin      BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp
   OR scheduled_datetime BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp
ORDER BY id;

SELECT 'agendamientos' AS tabla, id, fecha_hora
FROM agendamientos
WHERE fecha_hora BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp
ORDER BY id;

-- ── Corrección: restar exactamente 5 horas a cada columna afectada ───────
UPDATE cdrs
SET timestamp_inicio = timestamp_inicio - INTERVAL '5 hours'
WHERE timestamp_inicio BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp;

UPDATE cdrs
SET timestamp_fin = timestamp_fin - INTERVAL '5 hours'
WHERE timestamp_fin BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp;

UPDATE cdrs
SET scheduled_datetime = scheduled_datetime - INTERVAL '5 hours'
WHERE scheduled_datetime BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp;

UPDATE agendamientos
SET fecha_hora = fecha_hora - INTERVAL '5 hours'
WHERE fecha_hora BETWEEN :ventana_desde::timestamp AND :ventana_hasta::timestamp;

-- ── Verificación post-update: mismos IDs, horas ya corregidas ────────────
SELECT 'cdrs' AS tabla, id, timestamp_inicio, timestamp_fin, scheduled_datetime
FROM cdrs
WHERE timestamp_inicio BETWEEN (:ventana_desde::timestamp - INTERVAL '5 hours')
                            AND (:ventana_hasta::timestamp - INTERVAL '5 hours')
ORDER BY id;

-- ══════════════════════════════════════════════════════════════════════
-- Revisar TODO lo de arriba con calma. Si el preview y la verificación
-- final se ven correctos (las horas ya coinciden con la realidad),
-- cambiar la siguiente línea de ROLLBACK a COMMIT y correr solo esa línea.
-- Si algo no cuadra, dejar el ROLLBACK tal cual — no se guarda nada.
-- ══════════════════════════════════════════════════════════════════════
ROLLBACK;
-- COMMIT;
