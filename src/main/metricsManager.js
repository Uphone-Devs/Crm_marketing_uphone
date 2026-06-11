/**
 * metricsManager.js — Motor de cálculo de KPIs avanzado.
 * 
 * Este módulo procesa los datos crudos de la base de datos para generar
 * métricas de valor de negocio y salud técnica.
 */
const { getDb } = require('./database/db');

function calculateMPH(usuarioId = null) {
  try {
    const db = getDb();
    const query = `
      SELECT COUNT(*) as total 
      FROM cdrs 
      WHERE creado_en > datetime('now', '-1 hour')
      ${usuarioId ? 'AND usuario_id = ?' : ''}
    `;
    const result = usuarioId ? db.prepare(query).get(usuarioId) : db.prepare(query).get();
    return result ? result.total : 0;
  } catch (err) {
    console.error('[METRICS] Error calculando MPH:', err);
    return 0;
  }
}

function calculateAverageRingTime(usuarioId = null) {
  try {
    const db = getDb();
    const query = `
      SELECT AVG(
        (strftime('%s', timestamp_answered) - strftime('%s', timestamp_ringing))
      ) as avg_ring
      FROM cdrs 
      WHERE timestamp_answered IS NOT NULL AND timestamp_ringing IS NOT NULL
      ${usuarioId ? 'AND usuario_id = ?' : ''}
    `;
    const result = usuarioId ? db.prepare(query).get(usuarioId) : db.prepare(query).get();
    return Math.round(result?.avg_ring || 0);
  } catch (err) {
    return 0;
  }
}

function calculateROI() {
  try {
    const COSTO_HORA = 5.0;
    const AHORRO_SEGUNDOS_POR_DIAL = 4;

    const db = getDb();
    const totalCalls = db.prepare("SELECT COUNT(*) as c FROM cdrs").get().c;
    
    const segundosAhorrados = totalCalls * AHORRO_SEGUNDOS_POR_DIAL;
    const horasAhorradas = segundosAhorrados / 3600;
    const dineroAhorrado = horasAhorradas * COSTO_HORA;

    return {
      horasAhorradas: horasAhorradas.toFixed(2),
      dineroAhorrado: dineroAhorrado.toFixed(2),
      totalCDRs: totalCalls
    };
  } catch (err) {
    return { horasAhorradas: 0, dineroAhorrado: 0, totalCDRs: 0 };
  }
}

module.exports = {
  calculateMPH,
  calculateAverageRingTime,
  calculateROI
};
