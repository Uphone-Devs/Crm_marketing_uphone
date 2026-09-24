/**
 * imagenDataUri.js — Parte pura del migrador de imágenes de mensajes_broadcast.
 *
 * Las imágenes viven como data URI base64 dentro de la columna `imagen_url`:
 * 185 MB contra 276 kB de texto, y el endpoint las devolvía enteras a cada
 * asesor diez veces por minuto. Salen a archivo bajo public/uploads/, que ya se
 * sirve con Cache-Control inmutable de un año y lo cachea Cloudflare en el edge.
 *
 * Decidir y escribir van separados a propósito: acá no hay I/O, así que la
 * decisión se prueba sin tocar disco ni base.
 */

const crypto = require('crypto');

/** Mismo criterio que upload.routes.js: solo imágenes, nada ejecutable. */
const EXTENSION_POR_MIME = Object.freeze({
  'image/png':  '.png',
  'image/jpeg': '.jpg',
  'image/jpg':  '.jpg',
  'image/gif':  '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
});

const ENCABEZADO = /^data:([a-z0-9.+/-]+);base64,/i;

/**
 * @param {string} [valor]
 * @returns {boolean}
 */
function esDataUri(valor) {
  if (!valor) return false;
  return ENCABEZADO.test(String(valor));
}

/**
 * @param {string} valor
 * @returns {{ mime: string, extension: string, bytes: Buffer }}
 * @throws si no es data URI o el mime no es una imagen permitida
 */
function parsearDataUri(valor) {
  const m = ENCABEZADO.exec(String(valor || ''));
  if (!m) throw new Error('No es un data URI base64');

  const mime = m[1].toLowerCase();
  const extension = EXTENSION_POR_MIME[mime];
  if (!extension) throw new Error(`Tipo de imagen no permitido: ${mime}`);

  return { mime, extension, bytes: Buffer.from(valor.slice(m[0].length), 'base64') };
}

/**
 * Determinista sobre (id, contenido): reejecutar el migrador no duplica
 * archivos, y si la imagen cambia el nombre cambia — necesario porque
 * public/uploads se sirve como inmutable y una URL reusada quedaría cacheada
 * con la imagen vieja durante un año.
 *
 * @param {number|string} id
 * @param {string} dataUri
 * @returns {string}
 */
function nombreArchivo(id, dataUri) {
  const { extension } = parsearDataUri(dataUri);
  const huella = crypto.createHash('sha256').update(String(dataUri)).digest('hex').slice(0, 8);
  return `mensaje-${id}-${huella}${extension}`;
}

/**
 * Absoluta a propósito: el renderer de Electron no resuelve rutas relativas
 * contra la API, así que una URL relativa dejaría la imagen rota.
 *
 * @param {string} base p.ej. https://crm.ejemplo.com (PUBLIC_URL)
 * @param {string} archivo
 * @returns {string}
 */
function urlPublica(base, archivo) {
  if (!base) throw new Error('Falta la base pública (PUBLIC_URL): una URL relativa no resuelve en Electron');
  return `${String(base).replace(/\/+$/, '')}/public/uploads/${archivo}`;
}

module.exports = { esDataUri, parsearDataUri, nombreArchivo, urlPublica, EXTENSION_POR_MIME };
