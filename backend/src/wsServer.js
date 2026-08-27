const { WebSocketServer } = require('ws');
const authService = require('./services/auth.service');
const db = require('./config/db');

/**
 * Gestiona la lógica de monitoreo en tiempo real vía WebSockets Nativos.
 * Diseñado para ser integrado en el servidor HTTP principal.
 */

// Memoria volátil para estados y métricas en vivo
const estadosAsesores = {}; // asesorId -> { data, socket, supervisorId }
const metricasAsesores = {}; // id -> { metrics }
// Map supervisorUserId → { ws, rol } para enrutar eventos solo al área correcta
const supervisores = new Map(); // supervisorUserId -> { ws, rol }

let dialingMode = 'MANUAL';

function setupWsServer(httpServer) {
    const wss = new WebSocketServer({ noServer: true });

    // Heartbeat: evita que el túnel/proxy cierre conexiones inactivas por timeout.
    // El flag isAlive detecta zombies: si no responde al ping anterior, se termina.
    const heartbeat = setInterval(() => {
        wss.clients.forEach(ws => {
            if (!ws.isAlive) { ws.terminate(); return; }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30_000);
    wss.on('close', () => clearInterval(heartbeat));

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        // Pre-extraer token desde URL query string (clientes lo envían como ?token=...)
        // para que IDENTIFICAR no necesite reenviarlo en el body.
        if (req) {
            try {
                const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
                ws._urlToken = url.searchParams.get('token') || null;
            } catch { ws._urlToken = null; }
        }

        let clientInfo = { rol: null, rolJwt: null, id: null, nombre: null, autenticado: false };

        ws.on('message', async (message) => {
            try {
                const msg = JSON.parse(message);

                // Todo mensaje (excepto PING) requiere autenticación previa
                if (msg.tipo !== 'IDENTIFICAR' && msg.tipo !== 'PING' && !clientInfo.autenticado) {
                    ws.send(JSON.stringify({ tipo: 'ERROR', mensaje: 'No autenticado' }));
                    return;
                }

                switch (msg.tipo) {
                    case 'IDENTIFICAR': {
                        // Token: body del mensaje tiene prioridad; fallback a URL query string
                        const token = msg.token || ws._urlToken;
                        let decoded;
                        try {
                            decoded = authService.verificarToken(token);
                        } catch {
                            ws.send(JSON.stringify({ tipo: 'ERROR', mensaje: 'Token inválido' }));
                            ws.close(1008, 'Token inválido');
                            return;
                        }

                        // Rol viene del JWT (BD), no del cliente
                        const rolJwt = decoded.rol; // 'asesor' | 'jefe_area' | 'admin'
                        const rolWs  = rolJwt === 'asesor' ? 'ASESOR' : 'SUPERVISOR';
                        clientInfo.autenticado = true;
                        clientInfo.id          = decoded.id;
                        clientInfo.nombre      = decoded.nombre;
                        clientInfo.rol         = rolWs;
                        clientInfo.rolJwt      = rolJwt;

                        if (rolWs === 'ASESOR') {
                            // Obtener supervisorId del asesor desde DB (best-effort, no bloquea)
                            let asesorSupervisorId = null;
                            try {
                                const u = await db.usuario.findUnique({
                                    where: { id: clientInfo.id },
                                    select: { supervisorId: true }
                                });
                                asesorSupervisorId = u?.supervisorId ?? null;
                            } catch (e) {
                                console.warn('[WS] No se pudo obtener supervisorId:', e.message);
                            }

                            estadosAsesores[clientInfo.id] = {
                                socket: ws,
                                asesor_id: clientInfo.id,
                                nombre: clientInfo.nombre,
                                supervisorId: asesorSupervisorId,
                                estado_id: msg.estado_id || 1,
                                timestamp: new Date().toISOString()
                            };

                            console.log(`[WS] Asesor conectado: ${clientInfo.nombre} (${clientInfo.id})`);

                            // Notificar solo al jefe del asesor (o a admins)
                            broadcastToJefeOf(clientInfo.id, {
                                tipo: 'ESTADO_ASESOR',
                                ...estadosAsesores[clientInfo.id]
                            });

                        } else { // SUPERVISOR (jefe_area o admin)
                            supervisores.set(clientInfo.id, { ws, rol: rolJwt });
                            console.log(`[WS] Jefe de Área conectado: ${clientInfo.nombre}`);

                            const isAdmin = rolJwt === 'admin';
                            const jefeId  = clientInfo.id;
                            const estadosFiltrados = Object.keys(estadosAsesores).reduce((acc, id) => {
                                const { socket, ...data } = estadosAsesores[id];
                                if (isAdmin || data.supervisorId === jefeId) acc[id] = data;
                                return acc;
                            }, {});
                            const metricasFiltradas = isAdmin
                                ? metricasAsesores
                                : Object.fromEntries(
                                    Object.entries(metricasAsesores).filter(
                                        ([id]) => estadosAsesores[id]?.supervisorId === jefeId
                                    )
                                );
                            ws.send(JSON.stringify({
                                tipo: 'SNAPSHOT_ESTADOS',
                                estados: estadosFiltrados,
                                metricas: metricasFiltradas,
                                dialing_mode: dialingMode
                            }));
                        }
                        break;
                    }

                    case 'ESTADO_ASESOR':
                        if (clientInfo.rol === 'ASESOR' && clientInfo.id) {
                            // Si la entrada fue borrada (reconexión/carrera), re-adjuntar
                            // SIEMPRE el socket actual: una entrada sin socket crashea
                            // broadcastToAll ('readyState' of undefined) y tumba con 500
                            // cualquier endpoint que notifique (ej. validacion/confirmar).
                            estadosAsesores[clientInfo.id] = {
                                ...estadosAsesores[clientInfo.id],
                                socket: estadosAsesores[clientInfo.id]?.socket || ws,
                                asesor_id: clientInfo.id,
                                nombre: clientInfo.nombre,
                                estado_id: msg.estado_id,
                                nombre_estado: msg.nombre_estado,
                                timestamp: new Date().toISOString()
                            };
                            broadcastToJefeOf(clientInfo.id, msg);
                        }
                        break;

                    case 'METRICAS_ASESOR':
                        if (clientInfo.rol === 'ASESOR' && clientInfo.id) {
                            metricasAsesores[clientInfo.id] = msg;
                            broadcastToJefeOf(clientInfo.id, msg);
                        }
                        break;

                    case 'TIPIFICACION_REALIZADA':
                        if (clientInfo.rol === 'ASESOR' && clientInfo.id) {
                            broadcastToJefeOf(clientInfo.id, { ...msg, asesor_id: clientInfo.id });
                        }
                        break;

                    case 'RITMO_BAJO':
                    case 'RITMO_OK':
                        if (clientInfo.rol === 'ASESOR') {
                            broadcastToJefeOf(clientInfo.id, {
                                ...msg,
                                asesor_id: clientInfo.id,
                                nombre: clientInfo.nombre,
                                timestamp: new Date().toISOString(),
                            });
                        }
                        break;

                    case 'AUDIO_CHUNK': {
                        // Solo enviar al supervisor asignado a este asesor
                        const asesorEntry = estadosAsesores[clientInfo.id];
                        if (asesorEntry?.supervisorId) {
                            const supEntry = supervisores.get(asesorEntry.supervisorId);
                            if (supEntry) safeSend(supEntry.ws, JSON.stringify({ ...msg, asesor_id: clientInfo.id }));
                        }
                        break;
                    }

                    case 'SET_DIALING_MODE':
                        if (clientInfo.rol === 'SUPERVISOR') {
                            dialingMode = msg.modo;
                            broadcastToAll(msg);
                        }
                        break;

                    case 'MARCAR_CLIENTE':
                    case 'REMOTE_DIAL':
                        // Comandos del supervisor al asesor — solo al propio equipo
                        if (clientInfo.rol === 'SUPERVISOR' && msg.asesor_id) {
                            const target = estadosAsesores[msg.asesor_id];
                            if (target && target.supervisorId === clientInfo.id && target.socket && target.socket.readyState === ws.OPEN) {
                                target.socket.send(JSON.stringify(msg));
                            }
                        }
                        break;

                    case 'PING':
                        ws.send(JSON.stringify({ tipo: 'PONG' }));
                        break;
                }
            } catch (err) {
                console.error('[WS Error] Processing message:', err);
            }
        });

        ws.on('close', () => {
            if (clientInfo.rol === 'SUPERVISOR') {
                // Solo eliminar si este socket sigue siendo el registrado (evita race condition en reconexión)
                if (supervisores.get(clientInfo.id)?.ws === ws) {
                    supervisores.delete(clientInfo.id);
                    console.log(`[WS] Jefe de Área desconectado: ${clientInfo.nombre}`);
                }
            } else if (clientInfo.rol === 'ASESOR' && clientInfo.id) {
                const asesorEntry = estadosAsesores[clientInfo.id];
                const savedSupId  = asesorEntry?.supervisorId; // guardar antes de borrar
                if (asesorEntry?.socket === ws) {
                    delete estadosAsesores[clientInfo.id];
                    console.log(`[WS] Asesor desconectado: ${clientInfo.nombre}`);
                }
                // Notificar solo al jefe del asesor (y admins)
                const disconnectPayload = JSON.stringify({
                    tipo: 'ASESOR_DESCONECTADO',
                    asesor_id: clientInfo.id,
                    nombre: clientInfo.nombre
                });
                supervisores.forEach(({ ws: supWs, rol }, supervisorId) => {
                    if (rol === 'admin' || supervisorId === savedSupId) safeSend(supWs, disconnectPayload);
                });
            }
        });

        ws.on('error', (err) => console.error('[WS Error] Socket error:', err));
    });

    return wss;
}

// Los broadcasts son "best effort": jamás deben propagar una excepción al
// caller (rutas HTTP como /validacion/confirmar hacen commit de datos y luego
// notifican — un socket corrupto no puede convertir eso en un 500).
function safeSend(socket, payload) {
    try {
        if (socket && socket.readyState === 1) socket.send(payload); // 1 = OPEN
    } catch (err) {
        console.warn('[WS] safeSend fallo (ignorado):', err.message);
    }
}

function broadcastToSupervisors(data) {
    const payload = JSON.stringify(data);
    supervisores.forEach(({ ws }) => safeSend(ws, payload));
}

// Envía solo al jefe asignado al asesor (+ admins conectados)
function broadcastToJefeOf(asesorId, data) {
    const supId  = estadosAsesores[asesorId]?.supervisorId;
    const payload = JSON.stringify(data);
    supervisores.forEach(({ ws, rol }, supervisorId) => {
        if (rol === 'admin' || supervisorId === supId) safeSend(ws, payload);
    });
}

// Envía al jefe y a todos sus asesores conectados
function broadcastToJefeTeam(jefeId, data) {
    const payload = JSON.stringify(data);
    const supEntry = supervisores.get(jefeId);
    if (supEntry) safeSend(supEntry.ws, payload);
    Object.values(estadosAsesores).forEach(a => {
        if (a.supervisorId === jefeId) safeSend(a.socket, payload);
    });
}

function broadcastToAll(data) {
    const payload = JSON.stringify(data);
    supervisores.forEach(({ ws }) => safeSend(ws, payload));
    Object.values(estadosAsesores).forEach(a => safeSend(a.socket, payload));
}

function getConnectedStats() {
    const asesores = Object.values(estadosAsesores).map(({ socket, ...data }) => ({
        ...data,
        metricas: metricasAsesores[data.asesor_id] || null
    }));
    return {
        asesores,
        supervisores: supervisores.size,
        total: asesores.length + supervisores.size
    };
}

module.exports = setupWsServer;
module.exports.getConnectedStats   = getConnectedStats;
module.exports.broadcastToAll      = broadcastToAll;
module.exports.broadcastToJefeTeam = broadcastToJefeTeam;
