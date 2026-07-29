/**
 * cdrs.routes.js — Consulta de Call Detail Records (reportería)
 */

const { Router } = require('express');
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

const router = Router();
router.use(authMiddleware);

// POST /api/cdrs — Crear CDR (al iniciar gestión)
router.post('/', async (req, res, next) => {
  try {
    const body = req.body;
    const contactoId = body.contactoId || body.contacto_id;
    const usuarioId  = body.usuarioId  || body.usuario_id || req.user.id;
    const tsInicio   = body.timestampInicio || body.timestamp_inicio || new Date().toISOString();

    const cdr = await db.cdr.create({
      data: {
        contactoId:     parseInt(contactoId),
        usuarioId:      parseInt(usuarioId),
        timestampInicio: new Date(tsInicio),
        canal:          'llamada',
      },
    });
    res.json({ id: cdr.id, ...cdr });
  } catch (err) { next(err); }
});

// PATCH /api/cdrs/:id — Actualizar CDR con tipificación y resultado
router.patch('/:id', async (req, res, next) => {
  try {
    const body = req.body;
    const data = {};
    if (body.tipificacionId != null) data.tipificacionId = parseInt(body.tipificacionId);
    if (body.notas         != null) data.notas          = body.notas;
    if (body.resultado     != null) data.resultado      = body.resultado;
    if (body.urlGrabacion  != null) data.urlGrabacion   = body.urlGrabacion;
    if (body.montoAcordado != null) data.montoAcordado  = Number(body.montoAcordado);
    if (body.timestampFin  || body.timestamp_fin)
      data.timestampFin = new Date(body.timestampFin || body.timestamp_fin);
    if (body.duracionSeg   != null) data.duracionSeg    = parseInt(body.duracionSeg);
    if (body.snapshotNombre != null) data.snapshotNombre = body.snapshotNombre;
    if (body.snapshotCedula != null) data.snapshotCedula = body.snapshotCedula;
    if (body.snapshotTelefono != null) data.snapshotTelefono = body.snapshotTelefono;
    if (body.snapshotEmpresa != null) data.snapshotEmpresa = body.snapshotEmpresa;
    if (body.scheduledDatetime || body.scheduled_datetime) {
      const sd = body.scheduledDatetime || body.scheduled_datetime;
      data.scheduledDatetime = new Date(sd);
    }

    // El cliente asesor cierra el CDR con timestampFin pero sin duracionSeg,
    // y el default 0 del schema dejaba todos los tiempos al aire en cero.
    // Derivarla del rango inicio→fin al cerrar (mismo criterio que el
    // fallback de /cartera en supervisor.routes.js).
    if (data.duracionSeg == null && data.timestampFin) {
      const prev = await db.cdr.findUnique({
        where: { id: parseInt(req.params.id) },
        select: { timestampInicio: true },
      });
      if (prev?.timestampInicio) {
        const seg = Math.round((data.timestampFin - prev.timestampInicio) / 1000);
        if (seg >= 0) data.duracionSeg = seg;
      }
    }

    const updated = await db.cdr.update({ where: { id: parseInt(req.params.id) }, data });
    res.json(updated);

    // ── Agregado diario incremental (fire-and-forget, nunca rompe la tipificación) ──
    // Solo cuando este PATCH registró la tipificación (evita doble conteo en
    // PATCHes posteriores del mismo cdr, p.ej. cierre con timestampFin).
    if (data.tipificacionId != null && updated?.timestampInicio) {
      (async () => {
        try {
          const t = await db.tipificacion.findUnique({
            where: { id: data.tipificacionId },
            select: { categoria: true, codigo: true },
          });
          const cat = t?.categoria || '';
          const esEf   = ['CONTACTO_EFECTIVO', 'CONTACTO EXITOSO'].includes(cat) ? 1 : 0;
          const esNe   = ['CONTACTO_NEUTRO', 'CONTACTO NEUTRO'].includes(cat) ? 1 : 0;
          const esNc   = ['NO_CONTACTADO', 'NO CONTACTADO'].includes(cat) ? 1 : 0;
          const esComp = ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP'].includes(t?.codigo) ? 1 : 0;
          const monto  = Number(updated.montoAcordado || 0);
          const segAire = Number(updated.duracionSeg || 0);
          // timestamp_inicio es naive-UTC con wall-clock Guayaquil → slice da la fecha GYE
          const ymd = updated.timestampInicio.toISOString().slice(0, 10);
          await db.$executeRaw`
            INSERT INTO metricas_diarias_asesor
              (asesor_id, fecha, gestiones, efectivos, neutros, no_contact, compromisos, monto_acordado, tiempo_aire_seg, actualizado_en)
            VALUES (${updated.usuarioId}, ${ymd}, 1, ${esEf}, ${esNe}, ${esNc}, ${esComp}, ${monto}, ${segAire}, NOW())
            ON CONFLICT (asesor_id, fecha) DO UPDATE SET
              gestiones       = metricas_diarias_asesor.gestiones + 1,
              efectivos       = metricas_diarias_asesor.efectivos + ${esEf},
              neutros         = metricas_diarias_asesor.neutros + ${esNe},
              no_contact      = metricas_diarias_asesor.no_contact + ${esNc},
              compromisos     = metricas_diarias_asesor.compromisos + ${esComp},
              monto_acordado  = metricas_diarias_asesor.monto_acordado + ${monto},
              tiempo_aire_seg = metricas_diarias_asesor.tiempo_aire_seg + ${segAire},
              actualizado_en  = NOW()
          `;
        } catch (e) { console.error('[MDA_UPSERT]', e?.message || e); }
      })();
    }
  } catch (err) { next(err); }
});

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
router.get('/metricas', requireRole('jefe_area', 'admin'), async (req, res, next) => {
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
