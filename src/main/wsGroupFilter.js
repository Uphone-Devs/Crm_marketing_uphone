/**
 * wsGroupFilter.js — Decisión de entrega de eventos WS por grupo (Bug 4 v3.0).
 *
 * Un supervisor solo debe recibir eventos (estado/métricas) de los asesores de SU
 * equipo (supervisor_id). El admin recibe todos. Función pura → testeable.
 */

/**
 * ¿Se debe entregar a este supervisor un evento de un asesor dado?
 * @param {number|string|null} asesorSupervisorId  supervisor_id del asesor del evento.
 * @param {{ supervisorId: number|null, esAdmin: boolean }|null} supervisorClient
 */
function shouldDeliverToSupervisor(asesorSupervisorId, supervisorClient) {
  if (!supervisorClient) return false;
  if (supervisorClient.esAdmin) return true;                 // admin ve todo
  if (supervisorClient.supervisorId == null) return true;    // cliente legacy sin grupo → fail-open
  if (asesorSupervisorId == null) return false;              // asesor sin grupo → no a supervisores
  return Number(asesorSupervisorId) === Number(supervisorClient.supervisorId);
}

module.exports = { shouldDeliverToSupervisor };
