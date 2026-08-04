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
  for (const k of _http.keys()) {
    if (k.startsWith(prefijo)) _http.delete(k);
  }
}

// ── Cache de respuestas HTTP ────────────────────────────────────────────────
const _http = new Map();

/**
 * Middleware para GET de dashboards: memoriza el JSON de una respuesta 2xx durante
 * `ttlMs` y lo sirve tal cual a los refrescos siguientes del MISMO usuario.
 *
 * La clave lleva `req.user.id` y la URL completa (que ya incluye fecha, campanaId y
 * demas query params). Es deliberadamente por usuario y no por equipo: dos supervisores
 * distintos nunca comparten entrada, asi que ninguno puede recibir el agregado del
 * equipo de otro. Se pierde algo de reuso a cambio de que el aislamiento no dependa de
 * construir bien la clave en cada endpoint.
 *
 * A diferencia de cacheado(), NO hace coalescencia de requests concurrentes: aca el
 * valor se conoce recien cuando el handler llama a res.json(), y dejar requests
 * esperando una promesa que el handler podria no resolver nunca (error, timeout,
 * conexion cerrada) los colgaria. El TTL por debajo del intervalo de polling ya cubre
 * el caso real, que es el refresco periodico y no la rafaga simultanea de un usuario.
 *
 * Solo cachea 2xx: un 4xx/5xx pasa de largo y no queda memorizado.
 */
function cacheGET(ttlMs) {
  return function cacheGETMiddleware(req, res, next) {
    if (req.method !== 'GET') return next();

    const clave = `http:${req.user?.id ?? 'anon'}:${req.originalUrl}`;
    const hit = _http.get(clave);
    if (hit && Date.now() - hit.t < ttlMs) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(hit.body);
    }

    res.setHeader('X-Cache', 'MISS');
    const jsonOriginal = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        _http.set(clave, { t: Date.now(), body });
      }
      return jsonOriginal(body);
    };
    return next();
  };
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
  for (const [k, v] of _http) {
    if (ahora - v.t >= maxEdadMs) _http.delete(k);
  }
}

// El polling es continuo, asi que las claves rotan (fecha, campana, usuario) y las viejas
// quedarian residentes para siempre. unref() para no mantener vivo el proceso al salir.
const _purga = setInterval(() => purgar(), 300_000);
if (typeof _purga.unref === 'function') _purga.unref();

module.exports = { cacheado, cacheGET, invalidar, purgar };
