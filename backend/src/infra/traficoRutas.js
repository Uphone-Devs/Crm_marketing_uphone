/**
 * traficoRutas.js — Atribución de bytes salientes por ruta.
 *
 * El backend empuja ~28 MB/s sostenidos por el túnel (medido el 2026-09-24 con
 * el Monitor de recursos) y no hay forma de saber qué ruta los produce: no
 * existe logging de peticiones. Esto acumula bytes por ruta y deja que el
 * middleware saque un top cada minuto.
 *
 * Se acumula en vez de loguear por request a propósito: con este volumen, una
 * línea por petición inundaría el log y agregaría carga al problema que se está
 * midiendo.
 *
 * Puro: no conoce Express.
 */

/** Techo de claves distintas. Evita que una ruta con ids sin normalizar, o un
 *  escaneo de URLs, hagan crecer el mapa sin límite. */
const MAX_RUTAS = 200;

const SEGMENTO_NUMERICO = /\/\d+(?=\/|$)/g;

/**
 * Agrupa por forma de ruta, no por URL concreta: sin esto cada id sería una
 * clave nueva y el top no mostraría nada útil.
 *
 * @param {string} [ruta]
 * @returns {string} nunca vacío
 */
function normalizarRuta(ruta) {
  if (!ruta) return '/';
  const sinQuery = String(ruta).split('?')[0];
  if (!sinQuery) return '/';
  return sinQuery.replace(SEGMENTO_NUMERICO, '/:id');
}

/**
 * @returns {{ registrar: (metodo: string, ruta: string, bytes: number) => void,
 *             top: (n: number) => Array<{clave: string, peticiones: number, bytes: number}>,
 *             vaciar: () => void, tamano: () => number }}
 */
function crearAcumulador() {
  const porRuta = new Map();

  return {
    registrar(metodo, ruta, bytes) {
      const clave = `${metodo} ${normalizarRuta(ruta)}`;
      const actual = porRuta.get(clave);

      // Lleno y clave nueva: se descarta. Las ya conocidas siguen sumando, que
      // son las que interesan — el top talker ya está adentro.
      if (!actual && porRuta.size >= MAX_RUTAS) return;

      const suma = Number.isFinite(bytes) ? bytes : 0;
      if (actual) {
        actual.peticiones += 1;
        actual.bytes += suma;
        return;
      }
      porRuta.set(clave, { peticiones: 1, bytes: suma });
    },

    top(n) {
      return [...porRuta.entries()]
        .map(([clave, { peticiones, bytes }]) => ({ clave, peticiones, bytes }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, n);
    },

    vaciar() { porRuta.clear(); },

    tamano() { return porRuta.size; },
  };
}

module.exports = { normalizarRuta, crearAcumulador, MAX_RUTAS };
