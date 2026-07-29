const express = require('express');
const os = require('os');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const router = express.Router();
const prisma = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { getConnectedStats } = require('../wsServer');

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function validarPolicy(b) {
    if (!b || typeof b !== 'object') return 'payload requerido';
    if (typeof b.enabled !== 'boolean') return 'enabled debe ser boolean';
    if (!HHMM_RE.test(b.startTime)) return 'startTime formato HH:MM';
    if (!HHMM_RE.test(b.endTime)) return 'endTime formato HH:MM';
    if (!Array.isArray(b.days) || b.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
        return 'days debe ser array de enteros 0-6';
    if (!Number.isInteger(b.checkIntervalMin) || b.checkIntervalMin <= 0)
        return 'checkIntervalMin debe ser entero > 0';
    return null;
}

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

// GET /api/admin/backup.dump — descarga pg_dump en custom-format (solo admin)
router.get('/backup.dump', authMiddleware, requireRole('admin'), (req, res) => {
  const dbUrl = process.env.DATABASE_URL;
  let url;
  try {
    url = new URL(dbUrl);
  } catch {
    return res.status(500).json({ error: 'DATABASE_URL inválida' });
  }

  const dbName = url.pathname.slice(1);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `crm_backup_${timestamp}.dump`;

  const args = [
    '-h', url.hostname,
    '-p', url.port || '5432',
    '-U', url.username,
    '-d', dbName,
    '-F', 'c',
  ];

  const pgDump = spawn('pg_dump', args, {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  });

  let started = false;

  pgDump.stdout.once('data', () => {
    started = true;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    pgDump.stdout.pipe(res);
  });

  pgDump.on('error', (err) => {
    if (!started && !res.headersSent) {
      res.status(500).json({ error: 'pg_dump no disponible: ' + err.message });
    }
  });

  pgDump.stderr.on('data', (d) => console.error('[pg_dump]', d.toString().trim()));

  pgDump.on('close', (code) => {
    if (code !== 0 && !res.headersSent) {
      res.status(500).json({ error: `pg_dump terminó con código ${code}` });
    }
  });
});

// ── Auto-update: política de ventana horaria ───────────────────────────────
// GET público: el main process de cada cliente lo lee sin token (schedule no es secreto).
router.get('/update-policy', async (req, res) => {
    try {
        const policy = await prisma.updatePolicy.upsert({
            where: { id: 1 },
            update: {},
            create: { id: 1 },
        });
        res.json(policy);
    } catch (err) {
        console.error('[UPDATE-POLICY] Error:', err?.message || err);
        res.status(500).json({ error: 'Error obteniendo política de update' });
    }
});

// PUT admin-only: editar la ventana.
router.put('/update-policy', authMiddleware, requireRole('admin'), async (req, res) => {
    const errorMsg = validarPolicy(req.body);
    if (errorMsg) return res.status(400).json({ error: errorMsg });
    try {
        const { enabled, startTime, endTime, days, checkIntervalMin } = req.body;
        const policy = await prisma.updatePolicy.upsert({
            where: { id: 1 },
            update: { enabled, startTime, endTime, days, checkIntervalMin },
            create: { id: 1, enabled, startTime, endTime, days, checkIntervalMin },
        });
        res.json(policy);
    } catch (err) {
        res.status(500).json({ error: 'Error guardando política de update' });
    }
});

// ── POST /api/admin/run-migrations — TEMPORAL: aplica indexes + metricas_diarias_asesor
// Remover después de ejecutar una vez en producción.
router.post('/run-migrations', authMiddleware, requireRole('admin'), async (req, res) => {
    const log = [];
    try {
        // Índices de performance
        const indexes = [
            `CREATE INDEX IF NOT EXISTS idx_cdrs_usuario_ts     ON cdrs (usuario_id, timestamp_inicio)`,
            `CREATE INDEX IF NOT EXISTS idx_cdrs_contacto       ON cdrs (contacto_id)`,
            `CREATE INDEX IF NOT EXISTS idx_cdrs_tipif          ON cdrs (tipificacion_id)`,
            `CREATE INDEX IF NOT EXISTS idx_cdrs_resultado      ON cdrs (resultado)`,
            `CREATE INDEX IF NOT EXISTS idx_ct_telefono         ON contactos (telefono)`,
            `CREATE INDEX IF NOT EXISTS idx_ct_cedula           ON contactos (cedula)`,
            `CREATE INDEX IF NOT EXISTS idx_ct_asignado_estado  ON contactos (asignado_a, estado_marcacion)`,
            `CREATE INDEX IF NOT EXISTS idx_ct_wsp_fecha        ON contactos (wsp_enviado_fecha)`,
            `CREATE INDEX IF NOT EXISTS idx_ct_rcs_fecha        ON contactos (rcs_enviado_fecha)`,
            `CREATE INDEX IF NOT EXISTS idx_ct_correo_fecha     ON contactos (correo_enviado_fecha)`,
            `CREATE INDEX IF NOT EXISTS idx_ev_usuario_tipo_ts  ON eventos (usuario_id, tipo, timestamp)`,
            `CREATE INDEX IF NOT EXISTS idx_vp_validado_en      ON validacion_pagos (validado_en)`,
            `CREATE INDEX IF NOT EXISTS idx_usuarios_rol_estado ON usuarios (rol, estado)`,
        ];
        for (const sql of indexes) {
            await prisma.$executeRawUnsafe(sql);
            log.push(`OK: ${sql.match(/idx_\w+/)?.[0] || sql.slice(0, 40)}`);
        }

        // Tabla metricas_diarias_asesor
        await prisma.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS metricas_diarias_asesor (
                asesor_id       INTEGER          NOT NULL,
                fecha           TEXT             NOT NULL,
                gestiones       INTEGER          NOT NULL DEFAULT 0,
                efectivos       INTEGER          NOT NULL DEFAULT 0,
                neutros         INTEGER          NOT NULL DEFAULT 0,
                no_contact      INTEGER          NOT NULL DEFAULT 0,
                compromisos     INTEGER          NOT NULL DEFAULT 0,
                monto_acordado  DOUBLE PRECISION NOT NULL DEFAULT 0,
                monto_recaudado DOUBLE PRECISION NOT NULL DEFAULT 0,
                tiempo_aire_seg INTEGER          NOT NULL DEFAULT 0,
                actualizado_en  TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
                CONSTRAINT metricas_diarias_asesor_pkey PRIMARY KEY (asesor_id, fecha)
            )
        `);
        log.push('OK: tabla metricas_diarias_asesor');

        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_mda_fecha ON metricas_diarias_asesor (fecha)`);
        log.push('OK: idx_mda_fecha');

        // Backfill histórico desde cdrs
        const inserted = await prisma.$executeRawUnsafe(`
            INSERT INTO metricas_diarias_asesor
              (asesor_id, fecha, gestiones, efectivos, neutros, no_contact, compromisos, monto_acordado, tiempo_aire_seg, actualizado_en)
            SELECT
              cd.usuario_id,
              (cd.timestamp_inicio)::date::text AS fecha,
              COUNT(*) FILTER (WHERE cd.tipificacion_id IS NOT NULL)::int,
              COUNT(*) FILTER (WHERE t.categoria IN ('CONTACTO_EFECTIVO','CONTACTO EXITOSO'))::int,
              COUNT(*) FILTER (WHERE t.categoria IN ('CONTACTO_NEUTRO','CONTACTO NEUTRO'))::int,
              COUNT(*) FILTER (WHERE t.categoria IN ('NO_CONTACTADO','NO CONTACTADO'))::int,
              COUNT(*) FILTER (WHERE t.codigo IN ('PMP','PAGO_REAL','AB_PARC','PEND_COMP'))::int,
              COALESCE(SUM(cd.monto_acordado), 0)::float,
              COALESCE(SUM(cd.duracion_seg) FILTER (WHERE cd.tipificacion_id IS NOT NULL), 0)::int,
              NOW()
            FROM cdrs cd
            LEFT JOIN tipificaciones t ON t.id = cd.tipificacion_id
            GROUP BY cd.usuario_id, (cd.timestamp_inicio)::date
            ON CONFLICT (asesor_id, fecha) DO NOTHING
        `);
        log.push(`OK: backfill ${inserted} filas insertadas`);

        res.json({ ok: true, log });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message, log });
    }
});

module.exports = router;
