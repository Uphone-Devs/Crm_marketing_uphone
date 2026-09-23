/**
 * tipificacionEstado.js — Lógica pura de estado tras tipificar una gestión.
 *
 * Sin dependencias de Prisma/Express a propósito: la usa el endpoint
 * transaccional PATCH /api/cdrs/:id/tipificar (backend) y es la fuente
 * única de verdad de qué estado_marcacion/intentos corresponde a un
 * código de tipificación — antes vivía duplicada e inconsistente entre
 * incrementarIntentoContacto() y marcarContactoGestionado() en el cliente.
 */

/**
 * Regla de negocio: si el asesor llamó y eligió CUALQUIER tipificación
 * (buzón, no contesta, compromiso, lo que sea), la gestión está hecha y el
 * contacto queda GESTIONADO. El estado persiste; no vuelve a pendiente ni
 * queda "en intento" esperando algo.
 *
 * Esto es lo que hacía el flujo anterior (incrementarIntentoContacto seguido
 * de marcarContactoGestionado, que forzaba GESTIONADO siempre). Un intento
 * de "mejora" del 2026-09-22 dejó NC y BUZON en EN_INTENTOS leyendo mal un
 * comentario del código viejo; en producción eso dejó gestiones reales sin
 * contabilizar. No volver a cambiarlo sin confirmarlo con la operación.
 *
 * El reintento automático de NC/BUZON lo decide el cliente (dialingMode
 * AUTOMATICA + intentosConfig en AsesorPanel), no el estado del contacto.
 *
 * @param {object} args
 * @param {number} [args.intentosActuales=0]
 * @returns {{ estadoMarcacion: 'GESTIONADO', intentosRealizados: number }}
 */
function decidirEstadoTrasTipificacion({ intentosActuales = 0 } = {}) {
  return {
    estadoMarcacion: 'GESTIONADO',
    intentosRealizados: intentosActuales + 1,
  };
}

module.exports = { decidirEstadoTrasTipificacion };
