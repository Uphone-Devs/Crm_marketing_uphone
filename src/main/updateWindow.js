/**
 * updateWindow.js — Lógica pura de la ventana horaria de auto-update.
 * Sin dependencias de Electron ni red → testeable con Vitest en node.
 * La hora se evalúa en América/Guayaquil (UTC-5, sin DST).
 */

const DAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Devuelve { day: 0-6, minutes: 0-1439 } en hora local de Guayaquil. */
function partesGuayaquil(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guayaquil',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // algunos runtimes devuelven '24' a medianoche
  const minutes = hour * 60 + parseInt(parts.minute, 10);
  return { day: DAY_MAP[parts.weekday], minutes };
}

function aMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * ¿La fecha `now` cae dentro de la ventana de update definida por `policy`?
 * @param {Date} now
 * @param {{enabled:boolean,startTime:string,endTime:string,days:number[]}} policy
 */
function isDentroDeVentana(now, policy) {
  if (!policy || !policy.enabled) return false;
  if (!HHMM_RE.test(policy.startTime) || !HHMM_RE.test(policy.endTime)) return false;

  const { day, minutes } = partesGuayaquil(now);
  if (Array.isArray(policy.days) && policy.days.length && !policy.days.includes(day)) return false;

  const start = aMinutos(policy.startTime);
  const end = aMinutos(policy.endTime);
  if (start === end) return false; // ventana nula

  if (start < end) return minutes >= start && minutes < end; // mismo día
  return minutes >= start || minutes < end; // cruza medianoche
}

/** Valida el payload que llega al PUT de la política. */
function validatePolicyInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'payload requerido' };
  if (typeof body.enabled !== 'boolean') return { ok: false, error: 'enabled debe ser boolean' };
  if (!HHMM_RE.test(body.startTime)) return { ok: false, error: 'startTime formato HH:MM' };
  if (!HHMM_RE.test(body.endTime)) return { ok: false, error: 'endTime formato HH:MM' };
  if (!Array.isArray(body.days) || body.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { ok: false, error: 'days debe ser array de enteros 0-6' };
  }
  if (!Number.isInteger(body.checkIntervalMin) || body.checkIntervalMin <= 0) {
    return { ok: false, error: 'checkIntervalMin debe ser entero > 0' };
  }
  return { ok: true };
}

module.exports = { isDentroDeVentana, validatePolicyInput };
