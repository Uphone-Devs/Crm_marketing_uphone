/**
 * cache.js — Cache en memoria del proceso, con TTL, para agregados de dashboard.
 *
 * Por que existe: los paneles hacen polling cada 30s (ActividadGestores.jsx:147,
 * CarterasEquipo.jsx:64, DashboardDirectivo.jsx:201 y :228, AsesorCompromisos.jsx:149,
 * mas los intervalos de SupervisorPanel y JefePanel). Con varios supervisores mirando
 * el mismo panel, el backend recalculaba el MISMO agregado sobre 151k contactos una vez
 * por cliente. Los intervalos son todos multiplos de 30s, asi que ademas se sincronizan
 * y llegan en rafaga: es el patron que se veia como 8 procesos postgres simultaneos.
 *
 * Guarda la PROMESA, no el resultado: si N requests llegan con el cache frio, los N
 * esperan la misma query en vez de disparar N queries identicas. Esa es la mitad de la
 * ganancia — la otra mitad es no recalcular durante el TTL.
 *
 * Limitaciones asumidas a proposito:
 * - Vive en memoria del proceso. No sobrevive a un reinicio ni se comparte entre
 *   instancias. Hoy corre una sola instancia (ver "Estado del WebSocket en memoria"
 *   en deploy/RUNBOOK.md); si se agrega una segunda, cada una tendra su propio cache.
 * - No hay invalidacion por escritura: el TTL corto es la unica garantia de frescura.
 *   Por eso los TTL van por debajo del intervalo de polling del cliente.
 */

const _store = new Map();

/**
 * Ejecuta fn() y memoriza su promesa bajo `clave` durante `ttlMs`.
 * Un rechazo no se cachea: se borra la entrada para que el proximo intento reintente.
 */
function cacheado(clave, ttlMs, fn) {
  const hit = _store.get(clave);
  if (hit && Date.now() - hit.t < ttlMs) return hit.p;

  const p = Promise.resolve()
    .then(fn)
    .catch((err) => {
      _store.delete(clave);
      throw err;
    });

  _store.set(clave, { t: Date.now(), p });
  return p;
}

/** Borra entradas cuya clave empiece con el prefijo. Para invalidar tras una escritura. */
function invalidar(prefijo) {
  for (const k of _store.keys()) {
    if (k.startsWith(prefijo)) _store.delete(k);
  }
}

/**
 * Purga entradas vencidas. Sin esto el Map crece con claves que ya nadie pide.
 * `>=` y no `>`: asi purgar(0) vacia todo, incluidas las entradas creadas en el mismo
 * milisegundo. Con el maxEdad real de 5 min la distincion no cambia nada.
 */
function purgar(maxEdadMs = 300_000) {
  const ahora = Date.now();
  for (const [k, v] of _store) {
    if (ahora - v.t >= maxEdadMs) _store.delete(k);
  }
}

// El polling es continuo, asi que las claves rotan (fecha, campana, usuario) y las viejas
// quedarian residentes para siempre. unref() para no mantener vivo el proceso al salir.
const _purga = setInterval(() => purgar(), 300_000);
if (typeof _purga.unref === 'function') _purga.unref();

module.exports = { cacheado, invalidar, purgar };
