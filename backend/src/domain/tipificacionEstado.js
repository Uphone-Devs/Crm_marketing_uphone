/**
 * tipificacionEstado.js — Lógica pura de estado tras tipificar una gestión.
 *
 * Sin dependencias de Prisma/Express a propósito: la usa el endpoint
 * transaccional PATCH /api/cdrs/:id/tipificar (backend) y es la fuente
 * única de verdad de qué estado_marcacion/intentos corresponde a un
 * código de tipificación — antes vivía duplicada e inconsistente entre
 * incrementarIntentoContacto() y marcarContactoGestionado() en el cliente.
 */

// Códigos que indican que NO hubo contacto humano genuino (no contestó,
// sonó buzón) — el contacto sigue vivo para reintento. Cualquier otro
// código (efectivo, decisivo, número malo, fallecido, etc.) cierra la
// gestión de una.
const CODIGOS_REINTENTABLES = ['NC', 'BUZON'];

/**
 * @param {object} args
 * @param {string} args.codigoTipificacion
 * @param {number} [args.intentosActuales=0]
 * @param {number} [args.maxIntentos] — indefinido/0 = sin tope, nunca fuerza GESTIONADO por intentos
 * @returns {{ estadoMarcacion: 'GESTIONADO'|'EN_INTENTOS', intentosRealizados: number }}
 */
function decidirEstadoTrasTipificacion({ codigoTipificacion, intentosActuales = 0, maxIntentos }) {
  // El intento se hizo, haya contestado o no — se cuenta siempre, igual que
  // hacía el PATCH /contactos/:id/intentar del flujo anterior. Lo que cambia
  // según el código es el ESTADO, no el conteo.
  const intentosRealizados = intentosActuales + 1;
  const esReintentable = CODIGOS_REINTENTABLES.includes(codigoTipificacion);

  if (!esReintentable) {
    return { estadoMarcacion: 'GESTIONADO', intentosRealizados };
  }

  const alcanzoMaximo = Number.isInteger(maxIntentos) && maxIntentos > 0 && intentosRealizados >= maxIntentos;

  return {
    estadoMarcacion: alcanzoMaximo ? 'GESTIONADO' : 'EN_INTENTOS',
    intentosRealizados,
  };
}

module.exports = { decidirEstadoTrasTipificacion, CODIGOS_REINTENTABLES };
