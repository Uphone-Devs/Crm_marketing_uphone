/**
 * wsServer.js — WebSocket Server para comunicación en tiempo real.
 *
 * Se monta sobre el http.Server de Express (compartiendo puerto 3001).
 * Protocolo:
 *   1. Cliente envía IDENTIFICAR → se registra como SUPERVISOR o ASESOR
 *   2. Asesor envía CAMBIO_ESTADO → se retransmite a todos los supervisores
 *   3. Supervisor puede solicitar audio streaming de un asesor
 *
 * Heartbeat: Ping cada 10s para detectar conexiones zombi.
 */

const { WebSocketServer, WebSocket } = require('ws');

const { getConfig, setConfig, getMetricasDia, getSupervisorIdDeAsesor } = require('./database/queries');
const { shouldDeliverToSupervisor } = require('./wsGroupFilter');

let wss = null;
const clients = new Map();            // ws → { tipo, asesor_id, nombre, supervisorId, esAdmin }
const asesorSupervisor = new Map();   // asesor_id (string) → supervisor_id (Bug 4: grupo)
const estadosAsesores = new Map();    // asesor_id → estado_info
const metricasAsesores = new Map();   // asesor_id → { marcaciones, tiempos, gestiones, ... }
let dialingMode = 'MANUAL';           // Cache del modo actual

/**
 * Inicializa el WebSocket server montándolo sobre un http.Server existente.
 * Esto permite compartir el puerto con Express.
 */
function initWebSocket(httpServer, verifyToken) {
  wss = new WebSocketServer({ server: httpServer });

  // Cargar modo inicial desde DB
  dialingMode = getConfig('modo_marcacion') || 'MANUAL';

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;

    // Validar JWT si se provee verifyToken (requerido en modo remoto/Azure)
    if (verifyToken) {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        if (!token) {
          ws.close(1008, 'Token requerido');
          console.warn(`[WS] Conexión rechazada sin token desde: ${ip}`);
          return;
        }
        ws._user = verifyToken(token);
      } catch {
        ws.close(1008, 'Token inválido o expirado');
        console.warn(`[WS] Conexión rechazada — token inválido desde: ${ip}`);
        return;
      }
    }

    console.log(`[WS] Nueva conexión desde: ${ip}${ws._user ? ` (${ws._user.email})` : ''}`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, msg);
      } catch (e) {
        console.error('[WS] Error parseando mensaje:', e.message);
      }
    });

    ws.on('close', () => {
      const info = clients.get(ws);
      if (info) {
        console.log(`[WS] Desconectado: ${info.nombre} (${info.tipo})`);
        if (info.tipo === 'ASESOR') {
          estadosAsesores.delete(info.asesor_id);
          // No eliminamos metricasAsesores.delete(info.asesor_id) para que persistan en reconexiones
          broadcastToSupervisors({
            tipo: 'ASESOR_DESCONECTADO',
            asesor_id: info.asesor_id,
            nombre: info.nombre,
          });
        }
      }
      clients.delete(ws);
    });

    ws.on('error', err => console.error('[WS] Error:', err.message));

    // Keepalive
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  // Heartbeat cada 30s — balance entre detección zombi y overhead con 100+ conexiones
  const interval = setInterval(() => {
    if (!wss) return clearInterval(interval);
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  console.log('[WS] WebSocket server montado (comparte puerto con Express)');
  return wss;
}

function handleMessage(ws, msg) {
  switch (msg.tipo) {
    case 'IDENTIFICAR': {
      // Bug 4: capturar el grupo para filtrar broadcasts por equipo.
      const info = { tipo: msg.rol, asesor_id: msg.asesor_id, nombre: msg.nombre };
      if (msg.rol === 'ASESOR') {
        info.supervisorId = getSupervisorIdDeAsesor(msg.asesor_id);
        asesorSupervisor.set(String(msg.asesor_id), info.supervisorId);
      } else if (msg.rol === 'SUPERVISOR') {
        info.supervisorId = msg.supervisor_id != null ? msg.supervisor_id : null;
        info.esAdmin = !!msg.es_admin;
      }
      clients.set(ws, info);
      console.log(`[WS] IDENTIFICAR: ${msg.nombre} (${msg.rol})`);

      if (msg.rol === 'SUPERVISOR') {
        // M-003: Fusionar estado en memoria con métricas reales de la DB
        // para evitar que la efectividad se resetee tras reconexión por reposo
        const snapshot = {};
        estadosAsesores.forEach((estado, id) => {
          const metricasDb = getMetricasDia(id);
          snapshot[id] = {
            ...estado,
            marcaciones:         metricasDb.total_marcaciones    ?? estado.marcaciones         ?? 0,
            productivos:         metricasDb.tiempo_al_aire       ?? estado.productivos         ?? 0,
            ratio_productividad: metricasDb.ratio_productividad  ?? estado.eficiencia          ?? 0,
            tiempo_productivo:   metricasDb.tiempo_al_aire       ?? estado.tiempo_productivo   ?? 0,
            tiempo_improductivo: metricasDb.tiempo_muerto        ?? estado.tiempo_improductivo ?? 0,
            total_gestiones:     estado.total_gestiones          ?? 0,
            total_compromisos:   metricasDb.total_compromisos    ?? estado.total_compromisos   ?? 0,
          };
        });
        const metricasSnapshot = {};
        metricasAsesores.forEach((m, id) => { metricasSnapshot[id] = m; });
        send(ws, { tipo: 'SNAPSHOT_ESTADOS', estados: snapshot, metricas: metricasSnapshot, dialing_mode: dialingMode });
      } else if (msg.rol === 'ASESOR') {
        const initialStatus = {
          estado_id: msg.estado_id || 1, // En Gestión por defecto
          nombre_estado: msg.nombre_estado || 'Conectado',
          timestamp: new Date().toISOString(),
          nombre: msg.nombre
        };
        estadosAsesores.set(msg.asesor_id, initialStatus);
        
        // Notificar a supervisores inmediatamente
        broadcastToSupervisors({
          tipo: 'ESTADO_ASESOR',
          asesor_id: msg.asesor_id,
          ...initialStatus
        });

        // Al conectar, enviar config:
        // - Si modo global = PERSONALIZADO → individual del asesor (fallback MANUAL/1)
        // - Si modo global ≠ PERSONALIZADO → modo global directo
        try {
          let modoEfectivo, intentosEfectivos;
          if (dialingMode === 'PERSONALIZADO') {
            const modoInd = getConfig(`modo_marcacion_asesor_${msg.asesor_id}`);
            const intInd = getConfig(`intentos_marcacion_asesor_${msg.asesor_id}`);
            modoEfectivo = (modoInd && modoInd.trim()) ? modoInd : 'MANUAL';
            intentosEfectivos = (intInd && intInd.trim()) ? (parseInt(intInd) || 1) : 1;
          } else {
            modoEfectivo = dialingMode;
            const intGlobal = getConfig('intentos_marcacion');
            intentosEfectivos = intGlobal ? (parseInt(intGlobal) || 1) : 1;
          }
          send(ws, { tipo: 'SET_DIALING_MODE', modo: modoEfectivo, intentos: intentosEfectivos });
        } catch (_) {
          send(ws, { tipo: 'SET_DIALING_MODE', modo: dialingMode });
        }
      }
      break;
    }

    case 'ping':
      send(ws, { tipo: 'pong' });
      break;

    case 'SET_DIALING_MODE':
      // Solo supervisores pueden cambiar el modo
      if (clients.get(ws)?.tipo === 'SUPERVISOR') {
        const intentos = msg.intentos || 1;
        // Cambio INDIVIDUAL targeted (solo válido si modo global = PERSONALIZADO)
        if (msg.asesor_id) {
          setConfig(`modo_marcacion_asesor_${msg.asesor_id}`, msg.modo);
          setConfig(`intentos_marcacion_asesor_${msg.asesor_id}`, intentos.toString());
          console.log(`[WS] Modo Marcación INDIVIDUAL asesor ${msg.asesor_id}: ${msg.modo}, Intentos: ${intentos}`);
          // Solo enviar al asesor si el global es PERSONALIZADO (sino el cambio queda persistido
          // pero NO toma efecto en runtime hasta que el supervisor cambie a PERSONALIZADO)
          if (dialingMode === 'PERSONALIZADO') {
            broadcastToAsesor(msg.asesor_id, { tipo: 'SET_DIALING_MODE', modo: msg.modo, intentos });
          }
        } else {
          // Cambio GLOBAL
          dialingMode = msg.modo;
          setConfig('modo_marcacion', dialingMode);
          setConfig('intentos_marcacion', intentos.toString());
          console.log(`[WS] Modo Marcación GLOBAL: ${dialingMode}, Intentos: ${intentos}`);
          // Notificar supervisores siempre
          broadcastToSupervisors({ tipo: 'SET_DIALING_MODE', modo: dialingMode, intentos });
          // Notificar asesores según el nuevo modo
          if (dialingMode === 'PERSONALIZADO') {
            // Cada asesor recibe SU config individual (fallback MANUAL/1)
            clients.forEach((info, asesorWs) => {
              if (info.tipo === 'ASESOR' && asesorWs.readyState === WebSocket.OPEN) {
                const modoInd = getConfig(`modo_marcacion_asesor_${info.asesor_id}`);
                const intInd = getConfig(`intentos_marcacion_asesor_${info.asesor_id}`);
                const modoEf = (modoInd && modoInd.trim()) ? modoInd : 'MANUAL';
                const intEf = (intInd && intInd.trim()) ? (parseInt(intInd) || 1) : 1;
                send(asesorWs, { tipo: 'SET_DIALING_MODE', modo: modoEf, intentos: intEf });
              }
            });
          } else {
            // Modo MANUAL o AUTOMATICA → todos los asesores reciben el mismo
            clients.forEach((info, asesorWs) => {
              if (info.tipo === 'ASESOR' && asesorWs.readyState === WebSocket.OPEN) {
                send(asesorWs, { tipo: 'SET_DIALING_MODE', modo: dialingMode, intentos });
              }
            });
          }
        }
      }
      break;

    case 'CAMBIO_ESTADO':
    case 'ESTADO_ASESOR':
      if (clients.get(ws)?.tipo === 'ASESOR') {
        const asesorId = clients.get(ws).asesor_id;
        const estadoInfo = {
          estado_id: msg.estado_id,
          nombre_estado: msg.nombre_estado || '',
          timestamp: new Date().toISOString(),
          asesor_nombre: clients.get(ws).nombre,
        };
        estadosAsesores.set(asesorId, estadoInfo);
        broadcastToSupervisors({
          tipo: 'ESTADO_ASESOR',
          asesor_id: asesorId,
          estado_id: msg.estado_id,
          nombre_estado: msg.nombre_estado || '',
          nombre: clients.get(ws).nombre,
          timestamp: estadoInfo.timestamp,
        });
      }
      break;

    case 'METRICAS_ASESOR':
      if (clients.get(ws)?.tipo === 'ASESOR') {
        const metAsesorId = clients.get(ws).asesor_id;
        const metricasPayload = {
          marcaciones: msg.marcaciones || 0,
          tiempos_acumulados: msg.tiempos_acumulados || {},
          total_gestiones: msg.total_gestiones || 0,
          total_compromisos: msg.total_compromisos || 0,
          eficiencia: msg.eficiencia || 0,
          tiempo_productivo: msg.tiempo_productivo || 0,
          tiempo_improductivo: msg.tiempo_improductivo || 0,
          estado_actual_id: msg.estado_actual_id || null,
          timestamp: new Date().toISOString(),
        };
        metricasAsesores.set(metAsesorId, metricasPayload);
        broadcastToSupervisors({
          tipo: 'METRICAS_ASESOR',
          asesor_id: metAsesorId,
          nombre: clients.get(ws).nombre,
          ...metricasPayload,
        });
      }
      break;

    case 'AUDIO_CHUNK':
      clients.forEach((info, client) => {
        if (info.tipo === 'SUPERVISOR' && client.readyState === WebSocket.OPEN) {
          send(client, { tipo: 'AUDIO_CHUNK', data: msg.data, asesor_id: msg.asesor_id });
        }
      });
      break;

    case 'TIPIFICACION_REALIZADA':
      // Relay hacia supervisores para el ActivityLog
      broadcastToAll({
        tipo: 'TIPIFICACION_REALIZADA',
        asesor_id: msg.asesor_id,
        nombre: msg.nombre,
        tipificacion: msg.tipificacion,
        notas: msg.notas,
        timestamp: new Date().toISOString()
      });
      break;

    case 'RITMO_BAJO':
    case 'RITMO_OK':
      if (clients.get(ws)?.tipo === 'ASESOR') {
        broadcastToSupervisors({
          tipo: msg.tipo,
          asesor_id: clients.get(ws).asesor_id,
          nombre: clients.get(ws).nombre,
          gestiones: msg.gestiones,
          meta: msg.meta,
          deficit: msg.deficit,
          ventana_min: msg.ventana_min,
          timestamp: new Date().toISOString(),
        });
      }
      break;

    case 'FORCE_OFFLINE':
      // Solo supervisores pueden forzar desconexión
      if (clients.get(ws)?.tipo === 'SUPERVISOR') {
        const targetId = String(msg.asesor_id);
        let found = false;
        // Terminar el WS real del asesor si aún existe → dispara ws.on('close') normalmente
        clients.forEach((info, clientWs) => {
          if (info.tipo === 'ASESOR' && String(info.asesor_id) === targetId) {
            clientWs.terminate();
            found = true;
          }
        });
        // Si la conexión ya no existe pero el estado sigue en memoria, limpiar manualmente
        if (!found) {
          const nombre = estadosAsesores.get(targetId)?.nombre_estado || 'Asesor';
          estadosAsesores.delete(targetId);
          broadcastToSupervisors({ tipo: 'ASESOR_DESCONECTADO', asesor_id: msg.asesor_id, nombre });
        }
        console.log(`[WS] Supervisor forzó desconexión del asesor ${targetId}`);
      }
      break;

    case 'PING':
      send(ws, { tipo: 'PONG' });
      break;
  }
}

function broadcastToSupervisors(data) {
  // Bug 4: si el evento es de un asesor concreto, solo llega al supervisor de su grupo
  // (admin recibe todo). Eventos sin asesor_id (globales) van a todos los supervisores.
  let asesorSup;
  if (data && data.asesor_id != null) {
    const key = String(data.asesor_id);
    asesorSup = asesorSupervisor.has(key) ? asesorSupervisor.get(key) : getSupervisorIdDeAsesor(data.asesor_id);
  }
  clients.forEach((info, ws) => {
    if (info.tipo !== 'SUPERVISOR' || ws.readyState !== WebSocket.OPEN) return;
    if (data && data.asesor_id != null && !shouldDeliverToSupervisor(asesorSup, info)) return;
    send(ws, data);
  });
}

function broadcastToAll(data) {
  if (!wss) return;
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      send(ws, data);
    }
  });
}

/**
 * Enviar un mensaje a un asesor específico por su ID (vía WebSocket).
 * Usado por el scheduler para notificaciones de agendamientos.
 */
function broadcastToAsesor(asesorId, data) {
  let found = false;
  clients.forEach((info, ws) => {
    if (info.tipo === 'ASESOR' && String(info.asesor_id) === String(asesorId) && ws.readyState === WebSocket.OPEN) {
      send(ws, data);
      found = true;
    }
  });

  // Fallback: si no se encontró al destinatario directo, enviar a todos
  if (!found && (data.tipo === 'agendamiento:ejecutar' || data.tipo === 'agendamiento:aviso')) {
    broadcastToAll(data);
  }
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function getConnectedAsesores() {
  const asesores = [];
  clients.forEach((info, ws) => {
    if (info.tipo === 'ASESOR' && ws.readyState === WebSocket.OPEN) {
      asesores.push({
        asesor_id: info.asesor_id,
        nombre: info.nombre,
        estado: estadosAsesores.get(info.asesor_id) || null,
      });
    }
  });
  return asesores;
}

function getConnectedClients() {
  const result = [];
  clients.forEach((info, ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      result.push({
        tipo: info.tipo,
        id: info.asesor_id,
        nombre: info.nombre,
        estado: info.tipo === 'ASESOR' ? (estadosAsesores.get(info.asesor_id) || null) : null,
        metricas: info.tipo === 'ASESOR' ? (metricasAsesores.get(info.asesor_id) || null) : null,
      });
    }
  });
  return result;
}

function stopWebSocketServer() {
  if (wss) {
    wss.close();
    wss = null;
  }
}

module.exports = {
  initWebSocket,
  broadcastToSupervisors,
  broadcastToAll,
  broadcastToAsesor,
  getConnectedAsesores,
  getConnectedClients,
  stopWebSocketServer,
};
