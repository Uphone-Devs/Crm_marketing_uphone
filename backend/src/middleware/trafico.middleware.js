/**
 * trafico.middleware.js — Reporta qué rutas mueven los bytes salientes.
 *
 * Se agrega porque el backend empuja ~28 MB/s sostenidos por el túnel y no hay
 * un solo registro de peticiones con el que atribuirlos. Emite UNA línea por
 * minuto con las rutas que más bytes produjeron, no una por request: con este
 * volumen, lo segundo inundaría el log y sumaría carga al problema medido.
 *
 * El conteo sale de `Content-Length`. Una respuesta en streaming sin ese header
 * cuenta 0 bytes — se prefiere subestimar antes que envolver `res.write`, que
 * en la ruta caliente cuesta más que el diagnóstico que aporta.
 */

const { crearAcumulador } = require('../infra/traficoRutas');

const INTERVALO_MS = 60_000;
const CUANTAS_RUTAS = 6;
const MB = 1024 * 1024;

/**
 * @param {{ intervaloMs?: number }} [opciones]
 * @returns {(req: any, res: any, next: Function) => void}
 */
function traficoMiddleware({ intervaloMs = INTERVALO_MS } = {}) {
  const acc = crearAcumulador();

  const reloj = setInterval(() => {
    const top = acc.top(CUANTAS_RUTAS);
    acc.vaciar();
    if (!top.length) return;

    const total = top.reduce((s, f) => s + f.bytes, 0);
    const detalle = top
      .map(f => `${f.clave} ${(f.bytes / MB).toFixed(1)}MB/${f.peticiones}req`)
      .join(' | ');
    console.log(`[TRAFICO] ${(total / MB).toFixed(1)}MB/min → ${detalle}`);
  }, intervaloMs);

  // No sostener el proceso vivo solo por el reporte.
  if (typeof reloj.unref === 'function') reloj.unref();

  return function medirTrafico(req, res, next) {
    res.on('finish', () => {
      const largo = Number(res.getHeader('content-length'));
      acc.registrar(req.method, req.originalUrl || req.url, largo);
    });
    next();
  };
}

module.exports = { traficoMiddleware };
