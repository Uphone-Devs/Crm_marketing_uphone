/**
 * campanas.routes.js — CRUD Campañas + Contactos
 */

const { Router } = require('express');
const db = require('../config/db');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = Router();
router.use(authMiddleware);

// GET /api/campanas — Listar campañas
router.get('/', async (req, res, next) => {
  try {
    const campanas = await db.campana.findMany({
      orderBy: { id: 'desc' },
      include: { _count: { select: { contactos: true } } },
    });
    res.json(campanas);
  } catch (err) { next(err); }
});

// GET /api/campanas/dashboard — Resumen de campañas activas con métricas
// DEBE ir antes de /:id para evitar que 'dashboard' sea tratado como id
router.get('/dashboard', async (req, res, next) => {
  try {
    const campanas = await db.campana.findMany({
      where: { estado: 'activa' },
      orderBy: { id: 'desc' },
      include: {
        _count: { select: { contactos: true } },
        supervisor: { select: { id: true, nombre: true } },
      },
    });

    const dashboard = await Promise.all(campanas.map(async (c) => {
      const [total, gestionados, pagados] = await Promise.all([
        db.contacto.count({ where: { campanaId: c.id } }),
        db.contacto.count({ where: { campanaId: c.id, estadoMarcacion: { in: ['GESTIONADO', 'YA_PAGO', 'AGENDADO'] } } }),
        db.contacto.count({ where: { campanaId: c.id, yaPago: true } }),
      ]);
      return { ...c, total_contactos: total, gestionados, pagados };
    }));

    res.json(dashboard);
  } catch (err) { next(err); }
});

// GET /api/campanas/:id — Detalle de campaña con contactos
router.get('/:id', async (req, res, next) => {
  try {
    const campana = await db.campana.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        contactos: {
          orderBy: { id: 'asc' },
          take: 100,
        },
      },
    });
    if (!campana) return res.status(404).json({ error: 'Campaña no encontrada.' });
    res.json(campana);
  } catch (err) { next(err); }
});

// GET /api/campanas/:id/siguiente — Obtener siguiente contacto pendiente para un asesor
router.get('/:id/siguiente', async (req, res, next) => {
  try {
    const { asesorId } = req.query;
    if (!asesorId) return res.status(400).json({ error: 'asesorId requerido como query param.' });

    const contacto = await db.contacto.findFirst({
      where: {
        campanaId: parseInt(req.params.id),
        asignadoA: parseInt(asesorId),
        estadoMarcacion: 'PENDIENTE',
      },
      orderBy: { id: 'asc' },
    });

    if (!contacto) return res.json({ agotado: true, message: 'No quedan contactos pendientes.' });
    res.json(contacto);
  } catch (err) { next(err); }
});

// GET /api/campanas/:id/progreso — Obtener progreso (total vs gestionados)
router.get('/:id/progreso', async (req, res, next) => {
  try {
    const campanaId = parseInt(req.params.id);
    const total = await db.contacto.count({ where: { campanaId } });
    const gestionados = await db.contacto.count({ 
      where: { campanaId, estadoMarcacion: 'GESTIONADO' } 
    });
    res.json({ total, gestionados });
  } catch (err) { next(err); }
});

module.exports = router;

