/**
 * campanas.routes.js — CRUD Campañas + Contactos
 */

const { Router } = require('express');
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

const router = Router();
router.use(authMiddleware);

// GET /api/campanas/dashboard — Desglose por campaña+asesor para Panel de Control de Bases
// DEBE ir antes de /:id para evitar que 'dashboard' sea tratado como id
router.get('/dashboard', async (req, res, next) => {
  try {
    const rows = await db.$queryRaw`
      SELECT
        c.id,
        c.nombre,
        c.fecha_inicio,
        u_sup.nombre AS supervisor_nombre,
        cont.asignado_a AS asesor_id,
        u_as.nombre AS asesor_nombre,
        COUNT(cont.id)::int AS total_contactos,
        COALESCE(SUM(cont.monto_deuda), 0)::float AS monto_mora
      FROM campanas c
      LEFT JOIN contactos cont ON cont.campana_id = c.id
      LEFT JOIN usuarios u_as ON u_as.id = cont.asignado_a
      LEFT JOIN usuarios u_sup ON u_sup.id = c.supervisor_id
      GROUP BY c.id, c.nombre, c.fecha_inicio, u_sup.nombre, cont.asignado_a, u_as.nombre
      ORDER BY c.id DESC, u_as.nombre ASC
    `;
    res.json(rows);
  } catch (err) { next(err); }
});

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

// POST /api/campanas — Crear campaña
router.post('/', requireRole('admin', 'supervisor', 'jefe_area'), async (req, res, next) => {
  try {
    const { nombre, descripcion } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido.' });
    const campana = await db.campana.create({
      data: {
        nombre: nombre.trim(),
        descripcion: descripcion || null,
        supervisorId: req.user.id,
        fechaInicio: new Date(),
      },
    });
    res.json({ success: true, id: campana.id, ...campana });
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

// GET /api/campanas/:id/summary — Resumen post-distribución
router.get('/:id/summary', async (req, res, next) => {
  try {
    const campanaId = parseInt(req.params.id);
    const [campana, total, gestionados] = await Promise.all([
      db.campana.findUnique({ where: { id: campanaId }, select: { id: true, nombre: true } }),
      db.contacto.count({ where: { campanaId } }),
      db.contacto.count({ where: { campanaId, estadoMarcacion: { in: ['GESTIONADO', 'YA_PAGO'] } } }),
    ]);
    res.json({ success: true, id: campanaId, nombre: campana?.nombre, total, gestionados });
  } catch (err) { next(err); }
});

// POST /api/campanas/:id/contactos — Insertar contactos en lote para un asesor
router.post('/:id/contactos', requireRole('admin', 'supervisor', 'jefe_area'), async (req, res, next) => {
  try {
    const campanaId = parseInt(req.params.id);
    const { asesorId, contactos } = req.body;
    if (!Array.isArray(contactos) || !contactos.length) {
      return res.status(400).json({ error: 'contactos debe ser array no vacío.' });
    }
    const now = new Date();
    const data = contactos.map(c => ({
      campanaId,
      asignadoA: asesorId ? parseInt(asesorId) : null,
      cedula: c.cedula || null,
      nombreDeudor: c.nombre || null,
      telefono: c.telefono || '',
      montoDeuda: c.monto && !isNaN(parseFloat(c.monto)) ? parseFloat(c.monto) : null,
      producto: c.producto || null,
      metadata: c.metadata || null,
      fechaAsignacion: now,
    }));
    const result = await db.contacto.createMany({ data });
    res.json({ success: true, count: result.count });
  } catch (err) { next(err); }
});

// DELETE /api/campanas/:id/asesores/:asesorId — Eliminar contactos de un asesor en la campaña
router.delete('/:id/asesores/:asesorId', requireRole('admin', 'supervisor', 'jefe_area'), async (req, res, next) => {
  try {
    const campanaId = parseInt(req.params.id);
    const asesorId = parseInt(req.params.asesorId);

    const contactosIds = (await db.contacto.findMany({
      where: { campanaId, asignadoA: asesorId },
      select: { id: true },
    })).map(c => c.id);

    if (!contactosIds.length) return res.json({ success: true, deleted: 0 });

    await db.$transaction([
      db.agendamiento.deleteMany({ where: { contactoId: { in: contactosIds } } }),
      db.cdr.deleteMany({ where: { contactoId: { in: contactosIds } } }),
      db.contacto.deleteMany({ where: { id: { in: contactosIds } } }),
    ]);

    res.json({ success: true, deleted: contactosIds.length });
  } catch (err) { next(err); }
});

module.exports = router;

