/**
 * cdrs.routes.js — Consulta de Call Detail Records (reportería)
 */

const { Router } = require('express');
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

const router = Router();
router.use(authMiddleware);

// GET /api/cdrs — Listar CDRs con filtros
router.get('/', async (req, res, next) => {
  try {
    const { usuarioId, contactoId, desde, hasta, limit = 50, offset = 0 } = req.query;

    const where = {};
    if (usuarioId) where.usuarioId = parseInt(usuarioId);
    if (contactoId) where.contactoId = parseInt(contactoId);
    if (desde || hasta) {
      where.timestampInicio = {};
      if (desde) where.timestampInicio.gte = new Date(desde);
      if (hasta) where.timestampInicio.lte = new Date(hasta);
    }

    const [cdrs, total] = await Promise.all([
      db.cdr.findMany({
        where,
        include: {
          contacto: { select: { nombreDeudor: true, telefono: true } },
          usuario: { select: { nombre: true } },
          tipificacion: { select: { codigo: true, descripcion: true } },
        },
        orderBy: { timestampInicio: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      db.cdr.count({ where }),
    ]);

    res.json({ cdrs, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (err) { next(err); }
});

// GET /api/cdrs/metricas — Métricas agregadas del equipo (solo supervisor)
router.get('/metricas', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const cdrsHoy = await db.cdr.findMany({
      where: { timestampInicio: { gte: hoy } },
      select: { duracionSeg: true, usuarioId: true, resultado: true },
    });

    const totalLlamadas = cdrsHoy.length;
    const tiempoTotalSeg = cdrsHoy.reduce((sum, c) => sum + c.duracionSeg, 0);
    const promedioSeg = totalLlamadas > 0 ? Math.round(tiempoTotalSeg / totalLlamadas) : 0;
    const asesoresActivos = new Set(cdrsHoy.map(c => c.usuarioId)).size;

    res.json({
      totalLlamadas,
      tiempoTotalSeg,
      promedioSegundos: promedioSeg,
      asesoresActivos,
    });
  } catch (err) { next(err); }
});

module.exports = router;
