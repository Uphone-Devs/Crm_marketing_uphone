const { WebSocketServer } = require('ws');

/**
 * Gestiona la lógica de monitoreo en tiempo real vía WebSockets Nativos.
 * Diseñado para ser integrado en el servidor HTTP principal.
 */

// Memoria volátil para estados y métricas en vivo
const estadosAsesores = {}; // id -> { data, socket }
const metricasAsesores = {}; // id -> { metrics }
const supervisores = new Set(); // Sockets de supervisores conectados

let dialingMode = 'MANUAL';

function setupWsServer(httpServer) {
    const wss = new WebSocketServer({ noServer: true });

    wss.on('connection', (ws) => {
        let clientInfo = { rol: null, id: null, nombre: null };

        ws.on('message', (message) => {
            try {
                const msg = JSON.parse(message);

                switch (msg.tipo) {
                    case 'IDENTIFICAR':
                        clientInfo.rol = msg.rol;
                        clientInfo.nombre = msg.nombre;

                        if (msg.rol === 'ASESOR') {
                            clientInfo.id = msg.asesor_id;
                            
                            // 1. Inicializar entrada de estado (Requerimiento del Plan)
                            estadosAsesores[clientInfo.id] = {
                                socket: ws,
                                asesor_id: clientInfo.id,
                                nombre: clientInfo.nombre,
                                estado_id: msg.estado_id || 1, // Por defecto En Gestión
                                timestamp: new Date().toISOString()
                            };

                            console.log(`[WS] Asesor conectado: ${clientInfo.nombre} (${clientInfo.id})`);
                            
                            // Notificar a supervisores de la nueva conexión
                            broadcastToSupervisors({
                                tipo: 'ESTADO_ASESOR',
                                ...estadosAsesores[clientInfo.id]
                            });

                        } else if (msg.rol === 'SUPERVISOR') {
                            supervisores.add(ws);
                            console.log(`[WS] Jefe de Área conectado: ${clientInfo.nombre}`);

                            // Enviar snapshot inicial al supervisor
                            ws.send(JSON.stringify({
                                tipo: 'SNAPSHOT_ESTADOS',
                                estados: Object.keys(estadosAsesores).reduce((acc, id) => {
                                    const { socket, ...data } = estadosAsesores[id];
                                    acc[id] = data;
                                    return acc;
                                }, {}),
                                metricas: metricasAsesores,
                                dialing_mode: dialingMode
                            }));
                        }
                        break;

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
                            broadcastToSupervisors(msg);
                        }
                        break;

                    case 'METRICAS_ASESOR':
                        if (clientInfo.rol === 'ASESOR' && clientInfo.id) {
                            metricasAsesores[clientInfo.id] = msg;
                            broadcastToSupervisors(msg);
                        }
                        break;

                    case 'TIPIFICACION_REALIZADA':
                        broadcastToSupervisors(msg);
                        break;

                    case 'RITMO_BAJO':
                    case 'RITMO_OK':
                        if (clientInfo.rol === 'ASESOR') {
                            broadcastToSupervisors({
                                ...msg,
                                asesor_id: clientInfo.id,
                                nombre: clientInfo.nombre,
                                timestamp: new Date().toISOString(),
                            });
                        }
                        break;

                    case 'AUDIO_CHUNK':
                        // Relay de audio: transmitir solo si hay un supervisor escuchando
                        // (La lógica de "quién escucha a quién" se maneja en el broadcast filtrado)
                        broadcastToSupervisors(msg); 
                        break;

                    case 'SET_DIALING_MODE':
                        if (clientInfo.rol === 'SUPERVISOR') {
                            dialingMode = msg.modo;
                            broadcastToAll(msg);
                        }
                        break;

                    case 'MARCAR_CLIENTE':
                    case 'REMOTE_DIAL':
                        // Comandos del supervisor al asesor
                        if (clientInfo.rol === 'SUPERVISOR' && msg.asesor_id) {
                            const target = estadosAsesores[msg.asesor_id];
                            if (target && target.socket && target.socket.readyState === ws.OPEN) {
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
                supervisores.delete(ws);
                console.log(`[WS] Jefe de Área desconectado: ${clientInfo.nombre}`);
            } else if (clientInfo.rol === 'ASESOR' && clientInfo.id) {
                delete estadosAsesores[clientInfo.id];
                console.log(`[WS] Asesor desconectado: ${clientInfo.nombre}`);
                broadcastToSupervisors({
                    tipo: 'ASESOR_DESCONECTADO',
                    asesor_id: clientInfo.id,
                    nombre: clientInfo.nombre
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
    supervisores.forEach(socket => safeSend(socket, payload));
}

function broadcastToAll(data) {
    const payload = JSON.stringify(data);
    // Notificar a supervisores
    supervisores.forEach(s => safeSend(s, payload));
    // Notificar a asesores (entradas sin socket no deben tumbar el broadcast)
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
module.exports.getConnectedStats = getConnectedStats;
module.exports.broadcastToAll = broadcastToAll;
