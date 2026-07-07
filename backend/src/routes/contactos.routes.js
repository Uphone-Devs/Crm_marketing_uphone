/**
 * contactos.routes.js — Gestión de contactos y asignación a asesores.
 */

const { Router } = require('express');
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

const router = Router();
router.use(authMiddleware);

// GET /api/contactos/asesores/lista — Asesores activos disponibles para asignación
router.get('/asesores/lista', requireRole('admin', 'supervisor', 'jefe_area'), async (req, res, next) => {
  try {
    const asesores = await db.usuario.findMany({
      where: { rol: 'asesor', estado: 'activo' },
      select: {
        id: true, nombre: true, email: true,
        _count: { select: { contactosAsignados: true } },
      },
      orderBy: { nombre: 'asc' },
    });
    res.json(asesores);
  } catch (err) { next(err); }
});

// GET /api/contactos/asesor/:id — Cartera de un asesor
router.get('/asesor/:id', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id);
    if (req.user.rol === 'asesor' && req.user.id !== targetId) {
      return res.status(403).json({ error: 'Solo puedes ver tu propia cartera.' });
    }

    const { fecha, estado } = req.query;
    const where = { asignadoA: targetId };
    if (estado) where.estadoMarcacion = estado;
    if (fecha) {
      const d = new Date(fecha);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.fechaAsignacion = { gte: d, lt: next };
    }

    const contactos = await db.contacto.findMany({
      where,
      orderBy: [{ ordenMarcacion: 'asc' }, { id: 'asc' }],
      include: { campana: { select: { id: true, nombre: true } } },
    });

    res.json(contactos);
  } catch (err) { next(err); }
});

// POST /api/contactos/asignar — Asignar lote de contactos a un asesor
router.post('/asignar', requireRole('admin', 'supervisor', 'jefe_area'), async (req, res, next) => {
  try {
    const { contacto_ids, asesor_id } = req.body;
    if (!Array.isArray(contacto_ids) || !contacto_ids.length) {
      return res.status(400).json({ error: 'contacto_ids debe ser array no vacío.' });
    }
    if (!asesor_id) return res.status(400).json({ error: 'asesor_id requerido.' });

    const result = await db.contacto.updateMany({
      where: { id: { in: contacto_ids.map(Number) } },
      data: { asignadoA: parseInt(asesor_id), fechaAsignacion: new Date() },
    });

    res.json({ asignados: result.count });
  } catch (err) { next(err); }
});

// POST /api/contactos/asignar/campana — Distribución round-robin de toda una campaña
router.post('/asignar/campana', requireRole('admin', 'supervisor', 'jefe_area'), async (req, res, next) => {
  try {
    const { campana_id, asesor_ids } = req.body;
    if (!campana_id) return res.status(400).json({ error: 'campana_id requerido.' });
    if (!Array.isArray(asesor_ids) || !asesor_ids.length) {
      return res.status(400).json({ error: 'asesor_ids debe ser array no vacío.' });
    }

    const pendientes = await db.contacto.findMany({
      where: { campanaId: parseInt(campana_id), asignadoA: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (!pendientes.length) {
      return res.json({ asignados: 0, message: 'Todos los contactos ya están asignados.' });
    }

    const ids = asesor_ids.map(Number);
    const now = new Date();

    const updates = pendientes.map((c, i) =>
      db.contacto.update({
        where: { id: c.id },
        data: { asignadoA: ids[i % ids.length], fechaAsignacion: now },
      })
    );

    const resultados = await db.$transaction(updates);
    res.json({ asignados: resultados.length });
  } catch (err) { next(err); }
});

// GET /api/contactos — Listar contactos con filtros (admin/supervisor)
router.get('/', requireRole('admin', 'supervisor', 'jefe_area'), async (req, res, next) => {
  try {
    const { campana_id, asesor_id, estado, sin_asignar, page = 1, limit = 200 } = req.query;
    const where = {};
    if (campana_id) where.campanaId = parseInt(campana_id);
    if (asesor_id)  where.asignadoA = parseInt(asesor_id);
    if (estado)     where.estadoMarcacion = estado;
    if (sin_asignar === 'true') where.asignadoA = null;

    const [total, contactos] = await db.$transaction([
      db.contacto.count({ where }),
      db.contacto.findMany({
        where,
        orderBy: [{ ordenMarcacion: 'asc' }, { id: 'asc' }],
        take: Math.min(parseInt(limit), 500),
        skip: (parseInt(page) - 1) * Math.min(parseInt(limit), 500),
        include: {
          asesor:  { select: { id: true, nombre: true } },
          campana: { select: { id: true, nombre: true } },
        },
      }),
    ]);

    res.json({ total, page: parseInt(page), contactos });
  } catch (err) { next(err); }
});

// GET /api/contactos/:id — Detalle de un contacto
router.get('/:id', async (req, res, next) => {
  try {
    const contacto = await db.contacto.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { campana: { select: { id: true, nombre: true } } },
    });
    if (!contacto) return res.status(404).json({ error: 'Contacto no encontrado.' });
    res.json(contacto);
  } catch (err) { next(err); }
});

// GET /api/contactos/:id/cdrs — CDRs de un contacto
router.get('/:id/cdrs', async (req, res, next) => {
  try {
    const cdrs = await db.cdr.findMany({
      where: { contactoId: parseInt(req.params.id) },
      include: { tipificacion: { select: { codigo: true, descripcion: true } } },
      orderBy: { id: 'desc' },
      take: 100,
    });
    res.json(cdrs.map(c => ({
      ...c,
      monto_acordado: c.montoAcordado !== null ? Number(c.montoAcordado) : null,
      tipificacion_codigo: c.tipificacion?.codigo || null,
      tipificacion_desc: c.tipificacion?.descripcion || null,
    })));
  } catch (err) { next(err); }
});

// PATCH /api/contactos/:id/gestionar — Marcar contacto como gestionado
router.patch('/:id/gestionar', async (req, res, next) => {
  try {
    await db.contacto.update({
      where: { id: parseInt(req.params.id) },
      data: { estadoMarcacion: 'GESTIONADO' },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/contactos/:id/intentar — Incrementar intentos
router.patch('/:id/intentar', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { maxIntentos } = req.body;
    const contacto = await db.contacto.findUnique({ where: { id }, select: { intentosRealizados: true } });
    if (!contacto) return res.status(404).json({ error: 'Contacto no encontrado.' });

    const nuevoIntentos = (contacto.intentosRealizados || 0) + 1;
    const nuevoEstado = maxIntentos && nuevoIntentos >= maxIntentos ? 'GESTIONADO' : 'EN_INTENTOS';

    await db.contacto.update({
      where: { id },
      data: { intentosRealizados: nuevoIntentos, estadoMarcacion: nuevoEstado },
    });
    res.json({ ok: true, intentos: nuevoIntentos });
  } catch (err) { next(err); }
});

// PATCH /api/contactos/:id/resetear-intentos — Reset intentos a 0
router.patch('/:id/resetear-intentos', async (req, res, next) => {
  try {
    await db.contacto.update({
      where: { id: parseInt(req.params.id) },
      data: { intentosRealizados: 0, estadoMarcacion: 'PENDIENTE' },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PUT /api/contactos/:id/estado — Actualizar estado_marcacion
router.put('/:id/estado', async (req, res, next) => {
  try {
    const { estado } = req.body;
    const validos = ['PENDIENTE', 'CONTACTADO', 'NO_CONTACTADO', 'ENVIADO', 'GESTIONADO', 'EN_INTENTOS', 'AGENDADO', 'YA_PAGO'];
    if (!validos.includes(estado)) {
      return res.status(400).json({ error: `Estado inválido. Válidos: ${validos.join(', ')}` });
    }

    const updated = await db.contacto.update({
      where: { id: parseInt(req.params.id) },
      data: { estadoMarcacion: estado },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

module.exports = router;
