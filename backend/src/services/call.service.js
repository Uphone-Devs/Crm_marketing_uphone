const db = require('../config/db');

/**
 * Call Service
 * Handles business logic and Prisma transactions, isolated from the network entry point (Socket/Express).
 */

class CallService {
    async iniciarLlamada(data) {
        const { contactoId, usuarioId } = data;

        if (!contactoId || !usuarioId) {
            throw new Error('contactoId y usuarioId son requeridos para iniciar una llamada.');
        }

        console.log(`[CallService] Iniciando llamada: Contacto ${contactoId}, Usuario ${usuarioId}`);

        // DB Interaction isolated from Socket event
        const cdr = await db.cdr.create({
            data: {
                contactoId,
                usuarioId,
                timestampInicio: new Date(),
                duracionSeg: 0,
            }
        });

        // Also update contact status if needed
        await db.contacto.update({
            where: { id: contactoId },
            data: { estadoMarcacion: 'DIALING' }
        });

        return cdr;
    }

    async finalizarLlamada(data) {
        const { cdrId, tipificacionId, duracionSeg, notas, urlGrabacion, estadoMarcacion } = data;

        if (!cdrId) {
            throw new Error('cdrId es requerido para finalizar una llamada.');
        }

        console.log(`[CallService] Finalizando CDR ${cdrId}`);

        // A single update to handle the end of the call, minimizing DB transactions
        const cdrFinalizado = await db.cdr.update({
            where: { id: cdrId },
            data: {
                timestampFin: new Date(),
                duracionSeg: duracionSeg || 0,
                ...(tipificacionId && { tipificacionId }),
                ...(notas && { notas }),
                ...(urlGrabacion && { urlGrabacion })
            },
            include: {
                contacto: true // To know which contact we need to update next
            }
        });

        // Update contact status if changed
        if (estadoMarcacion && cdrFinalizado.contacto) {
            await db.contacto.update({
                where: { id: cdrFinalizado.contactoId },
                data: { estadoMarcacion }
            });
        }

        return cdrFinalizado;
    }
}

module.exports = new CallService();
