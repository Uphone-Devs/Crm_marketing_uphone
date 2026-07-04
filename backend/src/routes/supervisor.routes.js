/**
 * supervisor.routes.js — Endpoints requeridos por JefePanel y componentes
 * del supervisor en modo VM (PostgreSQL). Equivalentes a los definidos en
 * src/main/apiServer.js para el modo local SQLite.
 */

const { Router } = require('express');
const { Prisma } = require('@prisma/client');
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');

const router = Router();
router.use(authMiddleware);

function isSupervisor(rol) {
  return rol === 'supervisor' || rol === 'jefe_area' || rol === 'jefe' || rol === 'admin';
}

// ── Helper: Resolve contacto WHERE with JSON metadata filters ─────────────────
// Returns Prisma-compatible where clause. Uses raw SQL when metadata filters present.
async function resolveContactoWhere(q) {
  const { campanaId, distribuidor, grupo, numeroCuota } = q || {};

  if (!distribuidor && !grupo && !numeroCuota) {
    return campanaId ? { campanaId: parseInt(campanaId) } : {};
  }

  const parts = [];
  if (campanaId) parts.push(Prisma.sql`AND campana_id = ${parseInt(campanaId)}`);
  if (distribuidor) {
    const d = `%${distribuidor}%`;
    parts.push(Prisma.sql`AND (
      COALESCE(metadata->>'DISTRIBUIDOR','') ILIKE ${d}
      OR COALESCE(metadata->>'Distribuidor','') ILIKE ${d}
      OR COALESCE(metadata->>'DISTRIBUIDORA','') ILIKE ${d}
    )`);
  }
  if (grupo) {
    parts.push(Prisma.sql`AND COALESCE(metadata->>'GRUPO','') ILIKE ${'%' + grupo + '%'}`);
  }
  if (numeroCuota) {
    const n = `%${numeroCuota}%`;
    parts.push(Prisma.sql`AND (
      COALESCE(metadata->>'CUOTA','') ILIKE ${n}
      OR COALESCE(metadata->>'NRO CUOTA','') ILIKE ${n}
      OR COALESCE(metadata->>'NUMERO CUOTA','') ILIKE ${n}
      OR COALESCE(metadata->>'N° CUOTA','') ILIKE ${n}
    )`);
  }

  const extraWhere = Prisma.join(parts, ' ');
  const rows = await db.$queryRaw(Prisma.sql`SELECT id FROM contactos WHERE 1=1 ${extraWhere}`);
  const ids = rows.map(r => Number(r.id));
  return { id: { in: ids.length ? ids : [-1] } };
}

async function getAsesorIdsDelEquipo(user) {
  if (user.rol === 'admin') return null; // null = todos
  const asesores = await db.usuario.findMany({
    where: { supervisorId: user.id, rol: 'asesor' },
    select: { id: true },
  });
  return asesores.map(a => a.id);
}

// ── GET /api/asesores — Listar asesores activos ──────────────────────────────
router.get('/asesores', async (req, res, next) => {
  try {
    const where = { estado: 'activo', rol: 'asesor' };
    if (isSupervisor(req.user.rol) && req.user.rol !== 'admin') {
      where.supervisorId = req.user.id;
    }
    const asesores = await db.usuario.findMany({
      where,
      select: { id: true, nombre: true, email: true, rol: true, supervisorId: true },
      orderBy: { nombre: 'asc' },
    });
    res.json(asesores.map(a => ({ ...a, conectado: false })));
  } catch (err) { next(err); }
});

// ── GET /api/metricas/:usuario_id — Métricas diarias de un asesor ────────────
router.get('/metricas/:usuario_id', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.usuario_id);
    if (req.user.rol === 'asesor' && req.user.id !== targetId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    const fecha = req.query.fecha ? new Date(req.query.fecha) : new Date();
    const inicio = new Date(fecha); inicio.setHours(0, 0, 0, 0);
    const fin = new Date(fecha); fin.setHours(23, 59, 59, 999);

    const [cdrs, agendados, gestionados] = await Promise.all([
      db.cdr.count({ where: { usuarioId: targetId, timestampInicio: { gte: inicio, lte: fin } } }),
      db.agendamiento.count({ where: { asesorId: targetId, creadoEn: { gte: inicio, lte: fin } } }),
      db.contacto.count({ where: { asignadoA: targetId, estadoMarcacion: { in: ['GESTIONADO', 'YA_PAGO'] } } }),
    ]);

    res.json({
      usuario_id: targetId,
      fecha: inicio.toISOString().slice(0, 10),
      marcaciones: cdrs,
      agendados,
      gestionados,
      conectado: false,
    });
  } catch (err) { next(err); }
});

// ── GET /api/metricas-equipo — Métricas agregadas del equipo ─────────────────
router.get('/metricas-equipo', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });

    const fecha = req.query.fecha ? new Date(req.query.fecha) : new Date();
    const inicio = new Date(fecha); inicio.setHours(0, 0, 0, 0);
    const fin = new Date(fecha); fin.setHours(23, 59, 59, 999);

    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;

    const asesores = await db.usuario.findMany({ where: whereU, select: { id: true, nombre: true } });
    const asesorIds = asesores.map(a => a.id);

    const [cdrs, gestionados, pagados] = await Promise.all([
      db.cdr.count({ where: { usuarioId: { in: asesorIds }, timestampInicio: { gte: inicio, lte: fin } } }),
      db.contacto.count({ where: { asignadoA: { in: asesorIds }, estadoMarcacion: 'GESTIONADO' } }),
      db.contacto.count({ where: { asignadoA: { in: asesorIds }, yaPago: true } }),
    ]);

    const porAsesor = await Promise.all(asesores.map(async (a) => {
      const m = await db.cdr.count({ where: { usuarioId: a.id, timestampInicio: { gte: inicio, lte: fin } } });
      return { asesor_id: a.id, nombre: a.nombre, marcaciones: m };
    }));

    res.json({ total_marcaciones: cdrs, gestionados, pagados, asesores: porAsesor });
  } catch (err) { next(err); }
});

// ── GET /api/config — Configuración del sistema (tabla Config real) ───────────
router.get('/config', async (req, res, next) => {
  try {
    const rows = await db.config.findMany();
    const stored = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
    res.json({
      modo_marcacion: 'MANUAL',
      intentos_marcacion: '3',
      max_intentos_contacto: '3',
      ...stored,
    });
  } catch (err) { next(err); }
});

// ── POST /api/config — Guardar configuración ─────────────────────────────────
router.post('/config', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const entries = Object.entries(req.body);
    if (!entries.length) return res.json({ ok: true });
    await db.$transaction(
      entries.map(([clave, valor]) =>
        db.config.upsert({
          where: { clave },
          create: { clave, valor: String(valor) },
          update: { valor: String(valor) },
        })
      )
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/cartera-equipo — Cartera asignada del equipo completo ───────────
router.get('/cartera-equipo', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;

    const asesores = await db.usuario.findMany({ where: whereU, select: { id: true, nombre: true } });

    const cartera = await Promise.all(asesores.map(async (a) => {
      const contactos = await db.contacto.findMany({
        where: { asignadoA: a.id },
        select: {
          id: true, nombreDeudor: true, telefono: true, estadoMarcacion: true,
          montoDeuda: true, campanaId: true, ordenMarcacion: true,
        },
        orderBy: [{ ordenMarcacion: 'asc' }, { id: 'asc' }],
      });
      return { asesor_id: a.id, nombre: a.nombre, contactos };
    }));

    res.json(cartera);
  } catch (err) { next(err); }
});

// ── POST /api/cartera/reordenar — Reordenar cartera de un asesor ─────────────
router.post('/cartera/reordenar', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { asesorId, contactoIdsEnOrden } = req.body;
    if (!asesorId || !Array.isArray(contactoIdsEnOrden)) {
      return res.status(400).json({ error: 'asesorId y contactoIdsEnOrden[] requeridos' });
    }
    const updates = contactoIdsEnOrden.map((id, i) =>
      db.contacto.update({ where: { id: Number(id) }, data: { ordenMarcacion: i + 1 } })
    );
    await db.$transaction(updates);
    res.json({ ok: true, updated: updates.length });
  } catch (err) { next(err); }
});

// ── GET /api/asesores/:id/progreso — Progreso de un asesor ───────────────────
router.get('/asesores/:id/progreso', async (req, res, next) => {
  try {
    const asesorId = parseInt(req.params.id);
    const where = { asignadoA: asesorId };
    if (req.query.campanaId) where.campanaId = parseInt(req.query.campanaId);

    const [total, gestionados] = await Promise.all([
      db.contacto.count({ where }),
      db.contacto.count({ where: { ...where, estadoMarcacion: { in: ['GESTIONADO', 'YA_PAGO', 'AGENDADO'] } } }),
    ]);

    res.json({ total, gestionados });
  } catch (err) { next(err); }
});

// ── GET /api/validacion/historial — Contactos con pago validado ───────────────
router.get('/validacion/historial', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const where = { validadoPago: true };
    if (req.user.rol !== 'admin') {
      const ids = await getAsesorIdsDelEquipo(req.user);
      if (ids) where.asignadoA = { in: ids };
    }
    const historial = await db.contacto.findMany({
      where,
      select: {
        id: true, nombreDeudor: true, cedula: true, montoDeuda: true, yaPago: true,
        asesor: { select: { id: true, nombre: true } },
        campana: { select: { nombre: true } },
      },
      orderBy: { id: 'desc' },
      take: 200,
    });
    res.json(historial);
  } catch (err) { next(err); }
});

// ── GET /api/validacion/sesiones ──────────────────────────────────────────────
router.get('/validacion/sesiones', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    res.json([]);
  } catch (err) { next(err); }
});

// ── GET /api/validacion/metricas — Contadores de validación de pagos ──────────
router.get('/validacion/metricas', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const where = {};
    if (req.user.rol !== 'admin') {
      const ids = await getAsesorIdsDelEquipo(req.user);
      if (ids) where.asignadoA = { in: ids };
    }
    const [total, validados, pagados] = await Promise.all([
      db.contacto.count({ where }),
      db.contacto.count({ where: { ...where, validadoPago: true } }),
      db.contacto.count({ where: { ...where, yaPago: true } }),
    ]);
    res.json({ total, validados, pagados, sesiones: 0 });
  } catch (err) { next(err); }
});

// ── POST /api/validacion/correlacionar — Cruzar pagos por cédula ──────────────
router.post('/validacion/correlacionar', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { pagosData = [] } = req.body;
    const matches = [];
    const no_encontrados = [];

    for (const pago of pagosData) {
      if (!pago.cedula) { no_encontrados.push(pago); continue; }
      const contacto = await db.contacto.findFirst({
        where: { cedula: String(pago.cedula) },
        select: { id: true, nombreDeudor: true, cedula: true, montoDeuda: true, asignadoA: true },
      });
      if (contacto) {
        matches.push({ ...pago, contacto_id: contacto.id, nombre: contacto.nombreDeudor });
      } else {
        no_encontrados.push(pago);
      }
    }
    res.json({ matches, no_encontrados });
  } catch (err) { next(err); }
});

// ── POST /api/validacion/confirmar — Marcar contactos como validadoPago ───────
router.post('/validacion/confirmar', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { contacto_ids = [] } = req.body;
    if (!contacto_ids.length) return res.json({ confirmados: 0 });
    const result = await db.contacto.updateMany({
      where: { id: { in: contacto_ids.map(Number) } },
      data: { validadoPago: true, yaPago: true },
    });
    res.json({ confirmados: result.count });
  } catch (err) { next(err); }
});

// ── GET /api/cartera/analisis — Análisis de cartera ──────────────────────────
router.get('/cartera/analisis', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
    const where = {};
    if (req.user.rol !== 'admin') {
      const ids = await getAsesorIdsDelEquipo(req.user);
      if (ids) where.asignadoA = { in: ids };
    }
    const [total, gestionados, pagados, pendientes] = await Promise.all([
      db.contacto.count({ where }),
      db.contacto.count({ where: { ...where, estadoMarcacion: 'GESTIONADO' } }),
      db.contacto.count({ where: { ...where, yaPago: true } }),
      db.contacto.count({ where: { ...where, estadoMarcacion: 'PENDIENTE' } }),
    ]);
    res.json({ total, gestionados, pagados, pendientes });
  } catch (err) { next(err); }
});

// ── GET /api/cartera/rotacion — Sin histórico de asignaciones en DB ───────────
router.get('/cartera/rotacion', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
    res.json([]);
  } catch (err) { next(err); }
});

// ── GET /api/cartera/gestiones-asesores — Gestiones por asesor ───────────────
router.get('/cartera/gestiones-asesores', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;
    const asesores = await db.usuario.findMany({ where: whereU, select: { id: true, nombre: true } });

    const gestiones = await Promise.all(asesores.map(async (a) => {
      const [total, gestionados, pagados] = await Promise.all([
        db.contacto.count({ where: { asignadoA: a.id } }),
        db.contacto.count({ where: { asignadoA: a.id, estadoMarcacion: { in: ['GESTIONADO', 'YA_PAGO'] } } }),
        db.contacto.count({ where: { asignadoA: a.id, yaPago: true } }),
      ]);
      return { asesor_id: a.id, nombre: a.nombre, total, gestionados, pagados };
    }));
    res.json(gestiones);
  } catch (err) { next(err); }
});

// ── POST /api/cartera/meta-asesor ────────────────────────────────────────────
router.post('/cartera/meta-asesor', async (req, res, next) => {
  try {
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/cartera/refinanciada ────────────────────────────────────────────
router.get('/cartera/refinanciada', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
    res.json([]);
  } catch (err) { next(err); }
});

// ── GET /api/cartera/detalle-contactabilidad ─────────────────────────────────
router.get('/cartera/detalle-contactabilidad', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
    res.json([]);
  } catch (err) { next(err); }
});

// ── GET /api/pagos-verificados — Contactos con pago validado del equipo ───────
router.get('/pagos-verificados', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const where = { validadoPago: true };
    if (req.user.rol !== 'admin') {
      const ids = await getAsesorIdsDelEquipo(req.user);
      if (ids) where.asignadoA = { in: ids };
    }
    const pagos = await db.contacto.findMany({
      where,
      select: {
        id: true, nombreDeudor: true, telefono: true, montoDeuda: true,
        validadoPago: true, yaPago: true,
        asesor: { select: { id: true, nombre: true } },
        campana: { select: { id: true, nombre: true } },
      },
      orderBy: { id: 'desc' },
      take: 200,
    });
    res.json(pagos);
  } catch (err) { next(err); }
});

// ── GET /api/compromisos-equipo — Agendamientos pendientes del equipo ─────────
router.get('/compromisos-equipo', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;
    const asesores = await db.usuario.findMany({ where: whereU, select: { id: true } });
    const asesorIds = asesores.map(a => a.id);

    const compromisos = await db.agendamiento.findMany({
      where: { asesorId: { in: asesorIds }, estado: 'pendiente' },
      include: {
        contacto: { select: { id: true, nombreDeudor: true, telefono: true, montoDeuda: true } },
        asesor: { select: { id: true, nombre: true } },
      },
      orderBy: { fechaHora: 'asc' },
    });
    res.json(compromisos);
  } catch (err) { next(err); }
});

// ── GET /api/indicadores/config ──────────────────────────────────────────────
router.get('/indicadores/config', async (req, res, next) => {
  try {
    res.json([]);
  } catch (err) { next(err); }
});

// ── POST /api/indicadores/config ─────────────────────────────────────────────
router.post('/indicadores/config', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ── RUTAS /jefe/* — Dashboard Directivo (DashboardDirectivo.jsx) ─────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /api/jefe/meta-mensual ────────────────────────────────────────────────
router.get('/jefe/meta-mensual', async (req, res, next) => {
  if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const configRow = await db.config.findUnique({ where: { clave: 'meta_mensual_usd' } });
    const meta_mensual = configRow ? parseFloat(configRow.valor) : 0;

    const now = new Date();
    const mesInicio = new Date(now.getFullYear(), now.getMonth(), 1);
    const mesFin    = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const agg = await db.cdr.aggregate({
      _sum: { montoAcordado: true },
      where: { timestampInicio: { gte: mesInicio, lte: mesFin }, montoAcordado: { not: null } },
    });
    const cobrado_mes = parseFloat(agg._sum.montoAcordado ?? 0);
    const pct_cumplimiento = meta_mensual > 0 ? (cobrado_mes / meta_mensual) * 100 : 0;

    res.json({ meta_mensual, cobrado_mes, pct_cumplimiento });
  } catch (err) { next(err); }
});

// ── POST /api/jefe/meta-mensual ───────────────────────────────────────────────
router.post('/jefe/meta-mensual', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const val = parseFloat(req.body.meta);
    if (!val || isNaN(val) || val < 0) return res.status(400).json({ error: 'Meta inválida' });
    await db.config.upsert({
      where:  { clave: 'meta_mensual_usd' },
      create: { clave: 'meta_mensual_usd', valor: String(val) },
      update: { valor: String(val) },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/jefe/indicadores ─────────────────────────────────────────────────
router.get('/jefe/indicadores', async (req, res, next) => {
  if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const where = await resolveContactoWhere(req.query);

    const [aggVencido, aggCobrado, unidades_vencidas, unidades_cobradas] = await Promise.all([
      db.contacto.aggregate({ _sum: { montoDeuda: true }, where: { ...where, yaPago: false } }),
      db.contacto.aggregate({ _sum: { montoDeuda: true }, where: { ...where, yaPago: true  } }),
      db.contacto.count({ where: { ...where, yaPago: false } }),
      db.contacto.count({ where: { ...where, yaPago: true  } }),
    ]);

    const valor_vencido  = parseFloat(aggVencido._sum.montoDeuda  ?? 0);
    const valor_cobrado  = parseFloat(aggCobrado._sum.montoDeuda  ?? 0);
    const diferencia_monetaria  = valor_vencido - valor_cobrado;
    const diferencia_unidades   = unidades_vencidas - unidades_cobradas;
    const total_valor = valor_vencido + valor_cobrado;
    const total_und   = unidades_vencidas + unidades_cobradas;
    const pct_recuperacion     = total_valor > 0 ? (valor_cobrado / total_valor) * 100 : 0;
    const pct_recuperacion_und = total_und   > 0 ? (unidades_cobradas / total_und) * 100 : 0;

    res.json({
      global: { valor_vencido, valor_cobrado, unidades_vencidas, unidades_cobradas,
                diferencia_monetaria, diferencia_unidades, pct_recuperacion, pct_recuperacion_und },
      porSegmento: [],
    });
  } catch (err) { next(err); }
});

// ── GET /api/jefe/productividad ───────────────────────────────────────────────
router.get('/jefe/productividad', async (req, res, next) => {
  if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const cWhere = await resolveContactoWhere(req.query);
    const cdrWhere = Object.keys(cWhere).length > 0 ? { contacto: cWhere } : {};

    const [cartera_total, gestionados, gestiones_totales,
           cdrs_llamada, cdrs_whatsapp, cdrs_rcs, cdrs_gmail, contactados_arr] = await Promise.all([
      db.contacto.count({ where: cWhere }),
      db.contacto.count({ where: { ...cWhere, estadoMarcacion: { not: 'PENDIENTE' } } }),
      db.cdr.count({ where: cdrWhere }),
      db.cdr.count({ where: { canal: 'llamada',   ...cdrWhere } }),
      db.cdr.count({ where: { canal: 'whatsapp',  ...cdrWhere } }),
      db.cdr.count({ where: { canal: 'rcs',       ...cdrWhere } }),
      db.cdr.count({ where: { canal: 'gmail',     ...cdrWhere } }),
      db.contacto.findMany({ where: { ...cWhere, estadoMarcacion: { not: 'PENDIENTE' } }, select: { id: true } }),
    ]);

    const contactados_unicos = contactados_arr.length;
    const avance_cartera = cartera_total > 0 ? (gestionados / cartera_total) * 100 : 0;
    const cobertura      = cartera_total > 0 ? (contactados_unicos / cartera_total) * 100 : 0;

    res.json({
      avance_cartera, gestiones_totales, cartera_total, contactados_unicos, cobertura,
      canales: { llamada: cdrs_llamada, whatsapp: cdrs_whatsapp, rcs: cdrs_rcs, gmail: cdrs_gmail },
    });
  } catch (err) { next(err); }
});

// ── GET /api/jefe/top-asesores ────────────────────────────────────────────────
router.get('/jefe/top-asesores', async (req, res, next) => {
  if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);
    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;

    const cWhere = await resolveContactoWhere(req.query);
    const cdrContacto = Object.keys(cWhere).length > 0 ? { contacto: cWhere } : {};

    const asesores = await db.usuario.findMany({ where: whereU, select: { id: true, nombre: true } });

    const result = await Promise.all(asesores.map(async (a) => {
      const total_gestiones = await db.cdr.count({ where: { usuarioId: a.id, ...cdrContacto } });
      return { asesor: a.nombre, total_gestiones, segmentos: {} };
    }));

    result.sort((a, b) => b.total_gestiones - a.total_gestiones);
    res.json(result.slice(0, limit));
  } catch (err) { next(err); }
});

// ── GET /api/jefe/morosidad ───────────────────────────────────────────────────
router.get('/jefe/morosidad', async (req, res, next) => {
  if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const { campanaId, distribuidor: distFilt, grupo, numeroCuota } = req.query;

    const parts = [];
    if (campanaId) parts.push(Prisma.sql`AND campana_id = ${parseInt(campanaId)}`);
    if (distFilt) {
      const d = `%${distFilt}%`;
      parts.push(Prisma.sql`AND (
        COALESCE(metadata->>'DISTRIBUIDOR','') ILIKE ${d}
        OR COALESCE(metadata->>'Distribuidor','') ILIKE ${d}
        OR COALESCE(metadata->>'DISTRIBUIDORA','') ILIKE ${d}
      )`);
    }
    if (grupo) {
      parts.push(Prisma.sql`AND COALESCE(metadata->>'GRUPO','') ILIKE ${'%' + grupo + '%'}`);
    }
    if (numeroCuota) {
      const n = `%${numeroCuota}%`;
      parts.push(Prisma.sql`AND (
        COALESCE(metadata->>'CUOTA','') ILIKE ${n}
        OR COALESCE(metadata->>'NRO CUOTA','') ILIKE ${n}
        OR COALESCE(metadata->>'NUMERO CUOTA','') ILIKE ${n}
      )`);
    }

    const extraWhere = parts.length > 0 ? Prisma.join(parts, ' ') : Prisma.sql``;

    const rows = await db.$queryRaw(Prisma.sql`
      SELECT
        COALESCE(
          NULLIF(metadata->>'DISTRIBUIDOR', ''),
          NULLIF(metadata->>'Distribuidor', ''),
          NULLIF(metadata->>'DISTRIBUIDORA', ''),
          producto,
          'Sin Distribuidor'
        ) AS distribuidor,
        COUNT(*)::int               AS total,
        SUM(CASE WHEN ya_pago = false THEN 1 ELSE 0 END)::int AS morosos
      FROM contactos
      WHERE 1=1 ${extraWhere}
      GROUP BY 1
      ORDER BY (SUM(CASE WHEN ya_pago = false THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) DESC NULLS LAST
      LIMIT 10
    `);

    res.json(rows.map(r => ({
      distribuidor: r.distribuidor,
      pct_morosidad: r.total > 0 ? Math.round((Number(r.morosos) / Number(r.total)) * 100) : 0,
    })));
  } catch (err) { next(err); }
});

// ── GET /api/jefe/tendencia-semanal ──────────────────────────────────────────
router.get('/jefe/tendencia-semanal', async (req, res, next) => {
  if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const ahora  = new Date();
    const hace7  = new Date(ahora);
    hace7.setDate(hace7.getDate() - 6);
    hace7.setHours(0, 0, 0, 0);

    const cWhere = await resolveContactoWhere(req.query);
    const cdrContacto = Object.keys(cWhere).length > 0 ? { contacto: cWhere } : {};

    const cdrs = await db.cdr.findMany({
      where: { timestampInicio: { gte: hace7 }, montoAcordado: { not: null }, ...cdrContacto },
      select: { timestampInicio: true, montoAcordado: true },
    });

    const byDay = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(hace7);
      d.setDate(d.getDate() + i);
      byDay[d.toISOString().slice(0, 10)] = 0;
    }
    for (const c of cdrs) {
      const key = c.timestampInicio.toISOString().slice(0, 10);
      if (byDay[key] !== undefined) byDay[key] += parseFloat(c.montoAcordado ?? 0);
    }

    res.json(Object.entries(byDay).map(([fecha, valor_cobrado]) => ({ fecha, valor_cobrado })));
  } catch (err) { next(err); }
});

module.exports = router;
