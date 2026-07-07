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
      const avisoPmpKey = `aviso_pmp_${agend.id}`;

      // Alerta de 3 minutos para compromisos de pago
      if ((agend.tipo === 'PMP' || agend.tipo_agendamiento === 'PMP') && diffMs > 0 && diffMs <= 3 * 60 * 1000 && !avisosEnviados.has(avisoPmpKey)) {
        avisosEnviados.add(avisoPmpKey);
        emitir('agendamiento:aviso_pmp', agend);
        
        // Broadcast al supervisor
        try {
          const queries = require('./database/queries');
          const asesor = queries.findUserById(agend.asesor_id);
          const nombreAsesor = asesor ? asesor.nombre : `Asesor #${agend.asesor_id}`;
          const { BrowserWindow } = require('electron');
          const payload = { ...agend, nombreAsesor };
          // Local
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send('promesa:aviso_supervisor', payload);
          }
          // Si hubiera un ws para supervisor también se podría enviar
        } catch(e) {
          console.error('Error al notificar al supervisor:', e);
        }
      }

      if (diffMs > 0 && diffMs <= AVISO_MS && !avisosEnviados.has(avisoKey)) {
        avisosEnviados.add(avisoKey);
        emitir('agendamiento:aviso', agend);
      }

      if (agendMs <= ahoraMs && !avisosEnviados.has(ejecutaKey)) {
        avisosEnviados.add(ejecutaKey);
        emitir('agendamiento:ejecutar', agend);
        // Notificar supervisor cuando la promesa vence (aunque haya perdido el aviso de 3 min)
        if ((agend.tipo === 'PMP' || agend.tipo_agendamiento === 'PMP') && !avisosEnviados.has(avisoPmpKey)) {
          avisosEnviados.add(avisoPmpKey);
          try {
            const queries = require('./database/queries');
            const asesor = queries.findUserById(agend.asesor_id);
            const nombreAsesor = asesor ? asesor.nombre : `Asesor #${agend.asesor_id}`;
            const payload = { ...agend, nombreAsesor };
            for (const win of BrowserWindow.getAllWindows()) {
              if (!win.isDestroyed()) win.webContents.send('promesa:aviso_supervisor', payload);
            }
          } catch(e) {
            console.error('Error al notificar al supervisor:', e);
          }
        }
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

  // Vía 1: Electron IPC — solo si el asesor tiene ventana local en este PC
  let ipcDelivered = false;
  try {
    const asesorWin = getAsesorWindow();
    if (asesorWin && !asesorWin.isDestroyed()) {
      asesorWin.webContents.send(canal, payload);
      ipcDelivered = true;
    }
  } catch (err) {
    console.error(`[Scheduler] IPC error:`, err.message);
  }

  // Vía 2: WebSocket (LAN) — cuando el asesor es remoto (ipcDelivered = false)
  if (!ipcDelivered) {
    try {
      broadcastToAsesor(agend.asesor_id, { ...payload, tipo: canal });
    } catch (err) {
      console.error(`[Scheduler] WS error:`, err.message);
    }
  }
}

function stopScheduler() {
  if (schedulerInterval) clearInterval(schedulerInterval);
  avisosEnviados.clear();
  console.log('[Scheduler] Detenido');
}

module.exports = { initScheduler, stopScheduler };
