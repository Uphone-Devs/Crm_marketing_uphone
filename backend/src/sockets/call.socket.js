const callService = require('../services/call.service');

module.exports = function (io) {
    const callNamespaces = io.of('/calls');

    callNamespaces.on('connection', (socket) => {
        console.log(`[Socket] Nuevo cliente conectado a /calls: ${socket.id}`);

        socket.on('iniciar_llamada', async (data) => {
            try {
                // Delegation to Service (SoC) - no pure DB query here
                const result = await callService.iniciarLlamada(data);
                socket.emit('llamada_iniciada', result);
            } catch (error) {
                console.error(`[Socket Error] initiate_call:`, error.message);
                socket.emit('error', { type: 'iniciar_llamada', message: error.message });
            }
        });

        socket.on('finalizar_llamada', async (data) => {
            try {
                const result = await callService.finalizarLlamada(data);
                socket.emit('llamada_finalizada', result);
            } catch (error) {
                console.error(`[Socket Error] finalize_call:`, error.message);
                socket.emit('error', { type: 'finalizar_llamada', message: error.message });
            }
        });

        socket.on('disconnect', () => {
            console.log(`[Socket] Cliente desconectado de /calls: ${socket.id}`);
        });
    });
};
