const express = require('express');
const os = require('os');
const bcrypt = require('bcryptjs');
const router = express.Router();
const prisma = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { getConnectedStats } = require('../wsServer');

function getCpuUsage() {
    return new Promise((resolve) => {
        const cpus1 = os.cpus();
        setTimeout(() => {
            const cpus2 = os.cpus();
            let totalIdle = 0, totalTick = 0;
            cpus1.forEach((cpu, i) => {
                const cpu2 = cpus2[i];
                for (const type in cpu2.times) {
                    totalTick += cpu2.times[type] - cpu.times[type];
                }
                totalIdle += cpu2.times.idle - cpu.times.idle;
            });
            const usage = Math.round((1 - totalIdle / totalTick) * 100);
            resolve(Math.max(0, Math.min(100, usage)));
        }, 200);
    });
}

router.get('/sysinfo', authMiddleware, requireRole('admin', 'jefe_area'), async (req, res) => {
    try {
        const cpuUsage = await getCpuUsage();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        res.json({
            cpu: {
                usage: cpuUsage,
                cores: os.cpus().length,
                model: os.cpus()[0]?.model?.trim() || 'N/A'
            },
            memory: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
                usedPercent: Math.round((usedMem / totalMem) * 100)
            },
            uptime: os.uptime(),
            platform: os.platform(),
            hostname: os.hostname()
        });
    } catch (err) {
        res.status(500).json({ error: 'Error obteniendo info del sistema' });
    }
});

router.get('/connected', authMiddleware, requireRole('admin', 'jefe_area'), (req, res) => {
    res.json(getConnectedStats());
});

// ── User CRUD ─────────────────────────────────────────────────────────────────

router.get('/users', authMiddleware, requireRole('admin', 'jefe_area'), async (req, res) => {
    try {
        const raw = await prisma.usuario.findMany({
            orderBy: { nombre: 'asc' },
            select: {
                id: true, nombre: true, email: true, rol: true,
                estado: true, supervisorId: true,
                supervisor: { select: { id: true, nombre: true } },
            },
        });
        const users = raw.map(u => ({ ...u, supervisor_id: u.supervisorId }));
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Roles que cada caller puede asignar — jefe_area solo puede crear asesores
const ROLES_ASIGNABLES = {
    admin:     ['admin', 'jefe_area', 'asesor'],
    jefe_area: ['asesor'],
};
function rolPermitido(callerRol, rolSolicitado) {
    return (ROLES_ASIGNABLES[callerRol] || []).includes(rolSolicitado);
}

/**
 * ROLES_ASIGNABLES cubre el rol que se quiere asignar, no el de la cuenta que se
 * está tocando. Sin esta comprobación un jefe_area podía hacer PUT sobre una
 * cuenta admin pidiendo rol 'asesor' — asignación permitida para él — y degradarla,
 * o desactivarla con toggle. Una cuenta admin solo la modifica otro admin.
 *
 * @returns {Promise<string|null>} mensaje de error, o null si puede continuar.
 */
async function verificarObjetivo(id, caller) {
    const objetivo = await prisma.usuario.findUnique({ where: { id }, select: { rol: true } });
    if (!objetivo) return 'Usuario no encontrado';
    if (objetivo.rol === 'admin' && caller.rol !== 'admin') {
        return 'Solo un administrador puede modificar una cuenta admin.';
    }
    return null;
}

router.post('/users', authMiddleware, requireRole('admin', 'jefe_area'), async (req, res) => {
    try {
        const { nombre, email, password, rol, supervisor_id } = req.body;
        if (!nombre || !email || !password || !rol) {
            return res.status(400).json({ error: 'Campos requeridos: nombre, email, password, rol' });
        }
        if (!rolPermitido(req.user.rol, rol)) {
            return res.status(403).json({ error: `No puedes asignar el rol '${rol}'` });
        }
        const existing = await prisma.usuario.findUnique({ where: { email } });
        if (existing) return res.status(409).json({ error: 'Email ya registrado' });

        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.usuario.create({
            data: { nombre, email, passwordHash, rol, supervisorId: supervisor_id ?? null },
        });
        res.status(201).json({ success: true, id: user.id });
    } catch (err) {
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

router.put('/users/:id', authMiddleware, requireRole('admin', 'jefe_area'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { nombre, email, rol, estado, supervisor_id } = req.body;
        if (!nombre || !email || !rol) {
            return res.status(400).json({ error: 'Campos requeridos: nombre, email, rol' });
        }
        if (!rolPermitido(req.user.rol, rol)) {
            return res.status(403).json({ error: `No puedes asignar el rol '${rol}'` });
        }
        const errorObjetivo = await verificarObjetivo(id, req.user);
        if (errorObjetivo) {
            const status = errorObjetivo === 'Usuario no encontrado' ? 404 : 403;
            return res.status(status).json({ error: errorObjetivo });
        }
        const data = { nombre, email, rol, supervisorId: supervisor_id ?? null };
        if (estado) data.estado = estado;
        const user = await prisma.usuario.update({ where: { id }, data });
        res.json({ success: true, id: user.id });
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ error: 'Usuario no encontrado' });
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

router.post('/users/:id/toggle', authMiddleware, requireRole('admin', 'jefe_area'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const errorObjetivo = await verificarObjetivo(id, req.user);
        if (errorObjetivo) {
            const status = errorObjetivo === 'Usuario no encontrado' ? 404 : 403;
            return res.status(status).json({ error: errorObjetivo });
        }
        const current = await prisma.usuario.findUnique({ where: { id }, select: { estado: true } });
        if (!current) return res.status(404).json({ error: 'Usuario no encontrado' });

        const nuevoEstado = current.estado === 'activo' ? 'inactivo' : 'activo';
        const user = await prisma.usuario.update({
            where: { id },
            data: { estado: nuevoEstado },
        });
        res.json({ success: true, estado: user.estado });
    } catch (err) {
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

router.post('/users/:id/password', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { password } = req.body;
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Contraseña mínima 6 caracteres' });
        }
        const passwordHash = await bcrypt.hash(password, 10);
        await prisma.usuario.update({ where: { id }, data: { passwordHash } });
        res.json({ success: true });
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ error: 'Usuario no encontrado' });
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// DELETE /api/admin/users/:id — Soft-delete con redistribución de cartera al supervisor
router.delete('/users/:id', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);

        if (req.user.id === id) {
            return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
        }

        const usuario = await prisma.usuario.findUnique({
            where: { id },
            select: { id: true, rol: true, supervisorId: true, estado: true },
        });
        if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

        if (usuario.estado === 'inactivo') {
            return res.status(400).json({ error: 'El usuario ya está desactivado.' });
        }

        if (usuario.rol === 'admin') {
            const otrosAdmins = await prisma.usuario.count({
                where: { rol: 'admin', estado: 'activo', id: { not: id } },
            });
            if (otrosAdmins === 0) {
                return res.status(400).json({ error: 'No puedes eliminar el último administrador activo.' });
            }
        }

        const supervisorId = usuario.supervisorId ?? null;
        const ESTADOS_CERRADOS = ['YA_PAGO', 'GESTIONADO'];

        await prisma.$transaction(async (tx) => {
            // Contactos activos (no cerrados) → al supervisor del asesor
            await tx.contacto.updateMany({
                where: {
                    asignadoA: id,
                    yaPago: false,
                    estadoMarcacion: { notIn: ESTADOS_CERRADOS },
                },
                data: { asignadoA: supervisorId },
            });

            // Contactos cerrados → sin asignar (archivo histórico)
            await tx.contacto.updateMany({
                where: {
                    asignadoA: id,
                    OR: [
                        { yaPago: true },
                        { estadoMarcacion: { in: ESTADOS_CERRADOS } },
                    ],
                },
                data: { asignadoA: null },
            });

            // Cancelar agendamientos pendientes del asesor
            await tx.agendamiento.updateMany({
                where: { asesorId: id, estado: 'pendiente' },
                data: { estado: 'cancelado' },
            });

            // Soft delete — preserva FK de CDRs, Sesiones y Eventos
            await tx.usuario.update({
                where: { id },
                data: { estado: 'inactivo' },
            });
        });

        res.json({
            success: true,
            message: supervisorId
                ? 'Usuario desactivado. Contactos activos reasignados al supervisor.'
                : 'Usuario desactivado. Contactos activos liberados (sin supervisor asignado).',
        });
    } catch (err) {
        if (err.code === 'P2025') return res.status(404).json({ error: 'Usuario no encontrado.' });
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
