/**
 * scheduler.js — Revisa agendamientos pendientes cada 60 segundos.
 *
 * Canal de entrega (doble vía):
 *   1. Electron IPC  → webContents.send (local, 100% confiable)
 *   2. WebSocket      → broadcastToAsesor (remoto LAN, best-effort)
 *
 * Eventos emitidos:
 *   - 'agendamiento:aviso'   → 5 minutos antes
 *   - 'agendamiento:ejecutar' → cuando la hora llega
 */

const { BrowserWindow } = require('electron');
const { getAgendamientosPendientes, marcarAgendamientoEjecutado } = require('./database/queries');
const { broadcastToAsesor } = require('./wsServer');
const { getAsesorWindow } = require('./windowManager');

const AVISO_MS  = 5 * 60 * 1000;
const INTERVALO = 60 * 1000;
const avisosEnviados = new Set();

let schedulerInterval = null;

function initScheduler() {
  setTimeout(tick, 5000);
  schedulerInterval = setInterval(tick, INTERVALO);
  console.log('[Scheduler] Iniciado — tick cada 60s, primer tick en 5s');
}

function tick() {
  try {
    const ahora = new Date();
    const ahoraMs = ahora.getTime();
    const pendientes = getAgendamientosPendientes();

    for (const agend of pendientes) {
      const fechaStr = (agend.fecha_hora || '').replace('T', ' ');
      const agendMs = new Date(fechaStr).getTime();

      if (isNaN(agendMs)) continue;

      const diffMs = agendMs - ahoraMs;
      const ejecutaKey = `exec_${agend.id}`;
      const avisoKey   = `aviso_${agend.id}`;

      if (diffMs > 0 && diffMs <= AVISO_MS && !avisosEnviados.has(avisoKey)) {
        avisosEnviados.add(avisoKey);
        emitir('agendamiento:aviso', agend);
      }

      if (agendMs <= ahoraMs && !avisosEnviados.has(ejecutaKey)) {
        avisosEnviados.add(ejecutaKey);
        emitir('agendamiento:ejecutar', agend);
        marcarAgendamientoEjecutado(agend.id);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error en tick:', err.message);
  }
}

function emitir(canal, agend) {
  const { tipo: tipoAgend, ...rest } = agend;
  const payload = { ...rest, tipo_agendamiento: tipoAgend };

  // Vía 1: Electron IPC (local)
  try {
    const asesorWin = getAsesorWindow();
    if (asesorWin && !asesorWin.isDestroyed()) {
      asesorWin.webContents.send(canal, payload);
    } else {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(canal, payload);
      }
    }
  } catch (err) {
    console.error(`[Scheduler] IPC error:`, err.message);
  }

  // Vía 2: WebSocket (LAN)
  try {
    broadcastToAsesor(agend.asesor_id, { ...payload, tipo: canal });
  } catch (err) {
    console.error(`[Scheduler] WS error:`, err.message);
  }
}

function stopScheduler() {
  if (schedulerInterval) clearInterval(schedulerInterval);
  avisosEnviados.clear();
  console.log('[Scheduler] Detenido');
}

module.exports = { initScheduler, stopScheduler };
