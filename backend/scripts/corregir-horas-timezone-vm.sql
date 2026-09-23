-- corregir-horas-timezone-vm.sql
--
-- Corrige los registros escritos entre el 2026-09-12 ~11:31 (hora Guayaquil)
-- y el despliegue del fix, mientras la VM corria con la zona horaria cambiada.
-- El backend interpretaba las horas "naive" del cliente (nowLocalISO(), sin
-- Z/offset) con la zona horaria del proceso en vez de tratarlas siempre como
-- UTC, y les sumaba +5h. El fix de codigo (backend/src/utils/fechas.js) ya
-- corta esto hacia adelante; esto es solo para lo que quedo mal guardado.
--
-- ── Como se identifican las filas afectadas ────────────────────────────────
--
-- cdrs: firma + rango de id.
--   Postgres tiene la sesion fijada a UTC (?options=-c timezone=UTC), asi que
--   creado_en siempre guarda digitos UTC reales. timestamp_inicio deberia
--   guardar digitos de Guayaquil -> la diferencia sana es ~5h. Durante la
--   ventana rota timestamp_inicio tambien quedo en UTC -> diferencia 0.
--
--   El filtro usa AMBAS condiciones y las dos son necesarias:
--     - id >= 432611  : corte exacto verificado (432610 = ultima sana,
--                       11:30:08; 432611 = primera corrupta, 16:31:16).
--                       Imprescindible porque existen 84.574 filas VIEJAS
--                       (ids 2-422056) que tambien tienen diferencia 0 por
--                       otra causa historica, ajena a este bug. NO tocarlas.
--     - diferencia < 4h : hace el script idempotente. Al corregir una fila su
--                       diferencia pasa a 5h y deja de matchear, asi que una
--                       segunda corrida no hace nada. Tambien excluye sola
--                       cualquier fila nueva escrita ya con el fix.
--
-- agendamientos: rango de id.
--   fecha_hora es una fecha futura (el asesor agenda para despues), asi que
--   no hay diferencia contra creado_en que sirva de firma. Se acota por id:
--   22356 es el ultimo agendamiento creado antes del corte, 26370 el ultimo
--   existente al momento de relevar los datos.
--
--   SUPUESTO A VALIDAR EN EL PREVIEW: que todos los agendamientos del rango
--   se hayan creado por POST /agendamientos o POST /reagendar-compromiso
--   (unicos caminos que pasan por el bug). Si alguno se cargo por otra via
--   con la hora ya correcta, restarle 5h lo romperia. Revisar el listado.
--
-- ── Uso ────────────────────────────────────────────────────────────────────
--
-- Respaldo verificado ANTES (paso 1 del RUNBOOK). Son ~81.000 filas en cdrs:
-- correr fuera de horario de gestion.
--
-- Todo corre dentro de una transaccion que termina en ROLLBACK. Revisar el
-- preview y la verificacion final, y recien ahi cambiar ROLLBACK por COMMIT.

BEGIN;

-- ── Preview: cuantas filas toca ────────────────────────────────────────────
SELECT 'cdrs (3 columnas)' AS objetivo, COUNT(*) AS filas
FROM cdrs
WHERE id >= 432611
  AND EXTRACT(EPOCH FROM (creado_en - timestamp_inicio)) / 3600.0 < 4
UNION ALL
SELECT 'agendamientos.fecha_hora', COUNT(*)
FROM agendamientos
WHERE id BETWEEN 22357 AND 26370;

-- ── Preview: bordes de cdrs (deben ser 432611 y el maximo actual) ──────────
SELECT MIN(id) AS primera, MAX(id) AS ultima
FROM cdrs
WHERE id >= 432611
  AND EXTRACT(EPOCH FROM (creado_en - timestamp_inicio)) / 3600.0 < 4;

-- ── Preview: agendamientos a tocar, los mas nuevos primero ─────────────────
-- Confirmar que ninguno sea posterior al despliegue del fix.
SELECT id, creado_en, fecha_hora, estado
FROM agendamientos
WHERE id BETWEEN 22357 AND 26370
ORDER BY id DESC
LIMIT 15;

-- ── Correccion ─────────────────────────────────────────────────────────────
UPDATE cdrs
SET timestamp_inicio   = timestamp_inicio   - INTERVAL '5 hours',
    timestamp_fin      = timestamp_fin      - INTERVAL '5 hours',
    scheduled_datetime = scheduled_datetime - INTERVAL '5 hours'
WHERE id >= 432611
  AND EXTRACT(EPOCH FROM (creado_en - timestamp_inicio)) / 3600.0 < 4;

UPDATE agendamientos
SET fecha_hora = fecha_hora - INTERVAL '5 hours'
WHERE id BETWEEN 22357 AND 26370;

-- ── Verificacion: ya no debe quedar ninguna fila con la firma rota ─────────
-- Esperado: 0 filas.
SELECT COUNT(*) AS cdrs_aun_rotos
FROM cdrs
WHERE id >= 432611
  AND EXTRACT(EPOCH FROM (creado_en - timestamp_inicio)) / 3600.0 < 4;

-- ── Verificacion: la distribucion del rango corregido debe dar toda en 5h ──
SELECT ROUND(EXTRACT(EPOCH FROM (creado_en - timestamp_inicio)) / 3600.0, 0) AS diferencia_h,
       COUNT(*)
FROM cdrs
WHERE id >= 432611
GROUP BY 1
ORDER BY 1;

-- ── Verificacion: muestra concreta, las horas deben verse de jornada real ──
SELECT id, timestamp_inicio, timestamp_fin, creado_en
FROM cdrs
WHERE id >= 432611
ORDER BY id DESC
LIMIT 10;

-- ══════════════════════════════════════════════════════════════════════════
-- Si el conteo de "cdrs_aun_rotos" da 0, la distribucion da todo en 5h y las
-- horas de la muestra coinciden con horario de jornada real: cambiar la linea
-- de abajo a COMMIT. Si algo no cuadra, dejar ROLLBACK y no se guarda nada.
-- ══════════════════════════════════════════════════════════════════════════
ROLLBACK;
-- COMMIT;
