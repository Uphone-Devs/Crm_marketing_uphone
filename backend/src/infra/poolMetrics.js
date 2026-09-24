/**
 * poolMetrics.js — Lectura de los contadores del pool de conexiones.
 *
 * Existe para discriminar las dos causas del error `Unable to start a
 * transaction in the given time`, que dan el mismo mensaje:
 *
 *   (a) el pool llegó a su techo y no hay conexión que entregar;
 *   (b) el event loop estuvo bloqueado más que el `maxWait` de Prisma
 *       (2000 ms por defecto) y el temporizador venció con conexiones libres.
 *
 * `pg_stat_activity` no las separa: sus conexiones `idle` pueden estar tomadas
 * por el pool o simplemente abiertas. `waitingCount > 0` sí lo zanja — hay
 * requests encoladas esperando conexión, que es exactamente (a).
 *
 * Puro: recibe el pool como argumento, no importa `pg` ni Prisma.
 */

/**
 * Caso especial para cuando no hay pool que leer (arranque temprano, adapter
 * distinto, o el objeto no expone contadores). Se devuelve este objeto en vez
 * de null para que quien lo consuma no tenga que defenderse, y con
 * `medible: false` para no confundir "cero conexiones" con "no sé".
 */
const SIN_DATOS = Object.freeze({
  total: 0, libres: 0, esperando: 0, max: 0, saturado: false, medible: false,
});

const esNumero = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {{ totalCount?: number, idleCount?: number, waitingCount?: number,
 *           options?: { max?: number } }} [pool] pool de `pg`
 * @returns {{ total: number, libres: number, esperando: number, max: number,
 *             saturado: boolean, medible: boolean }} nunca null
 */
function snapshotPool(pool) {
  if (!pool) return SIN_DATOS;
  const { totalCount, idleCount, waitingCount } = pool;
  if (!esNumero(totalCount) || !esNumero(idleCount) || !esNumero(waitingCount)) return SIN_DATOS;

  const max = esNumero(pool.options?.max) ? pool.options.max : 0;

  return {
    total: totalCount,
    libres: idleCount,
    esperando: waitingCount,
    max,
    saturado: waitingCount > 0 || (max > 0 && totalCount >= max),
    medible: true,
  };
}

/**
 * Cuál de las dos causas fue, leído del snapshot tomado al intentar.
 *
 * `POOL_EN_COLA` — había requests esperando conexión: el pool es el límite.
 * `EVENT_LOOP`   — quedaban conexiones libres y aun así no arrancó: el loop
 *                  estuvo bloqueado más que el `maxWait`.
 * `INDETERMINADO`— no se pudo leer el pool; no afirmar nada.
 *
 * @param {ReturnType<typeof snapshotPool>} snap
 * @returns {'POOL_EN_COLA'|'EVENT_LOOP'|'INDETERMINADO'}
 */
function veredicto(snap) {
  if (!snap.medible) return 'INDETERMINADO';
  return snap.esperando > 0 ? 'POOL_EN_COLA' : 'EVENT_LOOP';
}

/**
 * Prisma devuelve P2028 para los fallos de la API de transacciones, tanto el
 * `maxWait` (no arrancó) como el `timeout` (arrancó y expiró). El mensaje
 * distingue el primero, que es el que el asesor ve como 500 intermitente.
 *
 * @param {{ code?: string, message?: string }} [err]
 * @returns {boolean}
 */
function esMaxWaitVencido(err) {
  if (!err) return false;
  return err.code === 'P2028' || /unable to start a transaction/i.test(err.message || '');
}

/**
 * Una línea por snapshot, pensada para leerse en `pm2 logs` sin herramientas.
 * @param {ReturnType<typeof snapshotPool>} snap
 * @returns {string}
 */
function formatearSnapshot(snap) {
  if (!snap.medible) return 'pool sin datos';
  return `pool ${snap.total}/${snap.max} libres=${snap.libres} esperando=${snap.esperando}`;
}

module.exports = { snapshotPool, formatearSnapshot, veredicto, esMaxWaitVencido, SIN_DATOS };
