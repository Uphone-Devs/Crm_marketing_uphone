/**
 * fechas.js — Parseo de timestamps "naive" enviados por el cliente.
 *
 * El cliente Electron manda horas sin 'Z'/offset cuyos dígitos ya
 * representan la hora de reloj de Guayaquil (nowLocalISO() en
 * src/renderer/shared/timeUtils.js, y los pickers de fecha/hora de
 * agendamiento: `${fecha}T${hora}:00`). Esos dígitos deben guardarse
 * tal cual — nunca dejar que `new Date(str)` los reinterprete con la
 * zona horaria del proceso, porque el resultado pasaría a depender de
 * cómo esté configurado el reloj del servidor.
 */

const CON_OFFSET = /(?:[Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * @param {string|Date|null|undefined} valor
 * @returns {Date|null}
 */
function parseNaiveComoUtc(valor) {
  if (valor == null) return null;
  if (valor instanceof Date) return valor;

  const str = String(valor).trim();
  if (CON_OFFSET.test(str)) {
    // Ya trae Z u offset explícito — respetarlo, no reinterpretar.
    return new Date(str);
  }

  const normalizado = str.replace(' ', 'T');
  return new Date(`${normalizado}Z`);
}

module.exports = { parseNaiveComoUtc };
