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

// Convierte el where de Prisma a fragmento SQL raw para contactos
function buildContactoRawWhere(cWhere) {
  if (cWhere.id?.in?.length) {
    return Prisma.sql`AND id IN (${Prisma.join(cWhere.id.in.map(id => Prisma.sql`${id}`))})`;
  }
  if (cWhere.campanaId) return Prisma.sql`AND campana_id = ${cWhere.campanaId}`;
  return Prisma.sql``;
}
function buildCdrContactoRawWhere(cWhere) {
  if (cWhere.id?.in?.length) {
    return Prisma.sql`AND c.id IN (${Prisma.join(cWhere.id.in.map(id => Prisma.sql`${id}`))})`;
  }
  if (cWhere.campanaId) return Prisma.sql`AND c.campana_id = ${cWhere.campanaId}`;
  return Prisma.sql``;
}

const DIAS_SEG_EXPR = `COALESCE(NULLIF(metadata->>'DIAS IMPAGO',''),NULLIF(metadata->>'DIAS EN MORA',''),NULLIF(metadata->>'DIAS MORA',''))`;

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
    const campanaId = req.query.campanaId ? parseInt(req.query.campanaId) : null;

    // Mensajería: filtrar por campaña si está seleccionada, si no por asignación
    const msgWhere = campanaId ? { campanaId } : { asignadoA: targetId };

    // Turnos (S0/S1/S2) por segmento de días mora desde metadata JSONB
    const segRows = await db.$queryRaw`
      SELECT
        COUNT(CASE WHEN COALESCE(
          CASE WHEN c.metadata->>'DIAS IMPAGO' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
          CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
          CASE WHEN c.metadata->>'DIAS MORA'   ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int   END
        ) = 0 THEN 1 END)::int AS s0,
        COUNT(CASE WHEN COALESCE(
          CASE WHEN c.metadata->>'DIAS IMPAGO' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
          CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
          CASE WHEN c.metadata->>'DIAS MORA'   ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int   END
        ) = 1 THEN 1 END)::int AS s1,
        COUNT(CASE WHEN COALESCE(
          CASE WHEN c.metadata->>'DIAS IMPAGO' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
          CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
          CASE WHEN c.metadata->>'DIAS MORA'   ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int   END
        ) >= 2 THEN 1 END)::int AS s2
      FROM cdrs cr
      JOIN contactos c ON c.id = cr.contacto_id
      WHERE cr.usuario_id = ${targetId}
        AND cr.timestamp_inicio >= ${inicio}
        AND cr.timestamp_inicio <= ${fin}
    `.catch(() => [{ s0: 0, s1: 0, s2: 0 }]);

    const cdrS0 = Number(segRows[0]?.s0) || 0;
    const cdrS1 = Number(segRows[0]?.s1) || 0;
    const cdrS2 = Number(segRows[0]?.s2) || 0;

    // Segmentos de mensajería: enviados (S0) y activos/pendientes (S1)
    const codigosCompromiso = ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP'];

    const [
      cdrsHoy, agendados, gestionados,
      wspEnv, rcsEnv, correoEnv,
      wspActivo, rcsActivo, correoActivo,
      compCumpl, compReag, compIncump,
    ] = await Promise.all([
      db.cdr.count({ where: { usuarioId: targetId, timestampInicio: { gte: inicio, lte: fin } } }).catch(() => 0),
      db.agendamiento.count({ where: { asesorId: targetId, creadoEn: { gte: inicio, lte: fin } } }).catch(() => 0),
      db.contacto.count({ where: { asignadoA: targetId, estadoMarcacion: { in: ['GESTIONADO', 'YA_PAGO'] } } }).catch(() => 0),
      db.contacto.count({ where: { ...msgWhere, whatsappStatus: 'ENVIADO' } }).catch(() => 0),
      db.contacto.count({ where: { ...msgWhere, rcsStatus:       'ENVIADO' } }).catch(() => 0),
      db.contacto.count({ where: { ...msgWhere, correoStatus:    'ENVIADO' } }).catch(() => 0),
      db.contacto.count({ where: { ...msgWhere, whatsappStatus: 'ACTIVO'  } }).catch(() => 0),
      db.contacto.count({ where: { ...msgWhere, rcsStatus:       'ACTIVO'  } }).catch(() => 0),
      db.contacto.count({ where: { ...msgWhere, correoStatus:    'ACTIVO'  } }).catch(() => 0),
      db.cdr.count({ where: { usuarioId: targetId, timestampInicio: { gte: inicio, lte: fin }, resultado: 'PAGO_REAL' } }).catch(() => 0),
      db.cdr.count({ where: { usuarioId: targetId, timestampInicio: { gte: inicio, lte: fin }, resultado: 'REAG'      } }).catch(() => 0),
      db.cdr.count({ where: { usuarioId: targetId, timestampInicio: { gte: inicio, lte: fin }, resultado: 'INCUMP'    } }).catch(() => 0),
    ]);

    const [cdrsConTipif, tiemposEstado] = await Promise.all([
      db.cdr.count({
        where: {
          usuarioId: targetId,
          timestampInicio: { gte: inicio, lte: fin },
          tipificacion: { codigo: { in: codigosCompromiso } },
        },
      }).catch(() => 0),
      db.evento.groupBy({
        by: ['estadoId'],
        where: {
          usuarioId: targetId,
          tipo: 'ESTADO',
          timestamp: { gte: inicio, lte: fin },
          duracionSeg: { not: null },
        },
        _sum: { duracionSeg: true },
      }).catch(err => { console.error('[EVENTO_GROUPBY]', err); return []; }),
    ]);

    const tiempoAlAire = Number(tiemposEstado.find(e => e.estadoId === 1)?._sum?.duracionSeg || 0);
    const tiempoMuerto = tiemposEstado
      .filter(e => e.estadoId !== 1)
      .reduce((acc, e) => acc + Number(e._sum?.duracionSeg || 0), 0);

    res.json({
      usuario_id: targetId,
      fecha: inicio.toISOString().slice(0, 10),
      marcaciones: cdrsHoy,
      total_marcaciones: cdrsHoy,
      cdrs_total: cdrsHoy,
      agendados,
      gestionados,
      conectado: false,
      tiempo_al_aire: tiempoAlAire,
      tiempo_muerto:  tiempoMuerto,
      wsp_enviados:     wspEnv,
      sms_enviados:     rcsEnv,
      correos_enviados: correoEnv,
      wsp_detalle:      [wspEnv,    wspActivo,    0],
      sms_detalle:      [rcsEnv,    rcsActivo,    0],
      email_detalle:    [correoEnv, correoActivo, 0],
      total_compromisos:       cdrsConTipif,
      compromisos_cumplidos:   compCumpl,
      compromisos_reagendados: compReag,
      compromisos_incumplidos: compIncump,
      marcaciones_detalle: [cdrS0, cdrS1, cdrS2],
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
// Devuelve array PLANO con asesor_nombre por fila (mismo formato que local SQLite).
router.get('/cartera-equipo', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const rows = await db.$queryRaw`
      SELECT
        ct.id,
        ct.cedula,
        ct.nombre_deudor,
        ct.telefono,
        CAST(ct.monto_deuda AS DOUBLE PRECISION) AS monto_deuda,
        ct.producto,
        ct.metadata::text        AS metadata,
        ct.estado_marcacion,
        ct.intentos_realizados,
        ct.ya_pago,
        ct.campana_id,
        ct.asignado_a,
        ct.whatsapp_status,
        ct.rcs_status,
        ct.correo_status,
        ct.validado_pago,
        ct.orden_marcacion,
        ct.fecha_asignacion,
        u.nombre                 AS asesor_nombre,
        cmp.nombre               AS campana_nombre,
        cmp.fecha_inicio         AS campana_fecha,
        COUNT(cdr.id)::int       AS gestiones_count,
        (SELECT t.descripcion
         FROM cdrs c2
         LEFT JOIN tipificaciones t ON c2.tipificacion_id = t.id
         WHERE c2.contacto_id = ct.id
         ORDER BY c2.id DESC LIMIT 1) AS ultima_tipificacion
      FROM contactos ct
      LEFT JOIN usuarios u   ON ct.asignado_a = u.id
      LEFT JOIN campanas cmp ON ct.campana_id  = cmp.id
      LEFT JOIN cdrs cdr     ON cdr.contacto_id = ct.id
      WHERE ct.asignado_a IS NOT NULL
      GROUP BY ct.id, u.nombre, cmp.nombre, cmp.fecha_inicio
      ORDER BY
        u.nombre ASC NULLS LAST,
        CASE WHEN ct.orden_marcacion IS NULL THEN 1 ELSE 0 END,
        ct.orden_marcacion ASC NULLS LAST,
        CASE ct.estado_marcacion
          WHEN 'EN_INTENTOS' THEN 0
          WHEN 'PENDIENTE'   THEN 1
          WHEN 'AGENDADO'    THEN 2
          WHEN 'GESTIONADO'  THEN 3
          WHEN 'YA_PAGO'     THEN 4
          ELSE 5
        END,
        ct.id ASC
    `;

    res.json(rows.map(r => ({
      ...r,
      gestiones_count: Number(r.gestiones_count ?? 0),
      monto_deuda: r.monto_deuda != null ? Number(r.monto_deuda) : null,
      ya_pago: r.ya_pago === true || r.ya_pago === 1,
      validado_pago: r.validado_pago === true || r.validado_pago === 1 ? 1 : 0,
    })));
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

    pagosData.filter(p => !p.cedula).forEach(p => no_encontrados.push(p));
    const lookups = await Promise.all(
      pagosData
        .filter(p => p.cedula)
        .map(pago => db.contacto.findFirst({
          where: { cedula: String(pago.cedula) },
          select: { id: true, nombreDeudor: true, cedula: true, montoDeuda: true, asignadoA: true },
        }).then(contacto => ({ pago, contacto })))
    );
    for (const { pago, contacto } of lookups) {
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

// ── GET /api/compromisos-equipo — CDRs de compromisos del equipo ──────────────
router.get('/compromisos-equipo', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const fechaStr = req.query.fecha || new Date().toISOString().slice(0, 10);
    const asesorIdParam = req.query.asesor_id ? parseInt(req.query.asesor_id) : null;

    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;
    const equipoAsesores = await db.usuario.findMany({ where: whereU, select: { id: true } });
    const equipoIds = equipoAsesores.map(a => a.id);

    const asesorFilter = asesorIdParam && equipoIds.includes(asesorIdParam)
      ? asesorIdParam
      : { in: equipoIds };

    const fechaInicio = new Date(fechaStr + 'T00:00:00');
    const fechaFin    = new Date(fechaStr + 'T23:59:59.999');

    const CODIGOS = ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP', 'REAG', 'INCUMP'];

    const cdrs = await db.cdr.findMany({
      where: {
        usuarioId: asesorFilter,
        tipificacion: { codigo: { in: CODIGOS } },
        OR: [
          { timestampInicio: { gte: fechaInicio, lte: fechaFin } },
          {
            contacto: {
              agendamientos: {
                some: {
                  fechaHora: { gte: fechaInicio, lte: fechaFin },
                  estado: { not: 'cancelado' },
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        timestampInicio: true,
        duracionSeg: true,
        montoAcordado: true,
        notas: true,
        resultado: true,
        snapshotNombre: true,
        snapshotCedula: true,
        snapshotTelefono: true,
        snapshotEmpresa: true,
        tipificacion: { select: { codigo: true, descripcion: true } },
        usuario: { select: { nombre: true } },
        contacto: {
          select: {
            nombreDeudor: true,
            cedula: true,
            telefono: true,
            metadata: true,
            agendamientos: {
              where: { estado: { not: 'cancelado' } },
              select: { fechaHora: true },
              orderBy: { id: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { timestampInicio: 'desc' },
    });

    const result = cdrs.map(c => {
      const meta = (c.contacto?.metadata && typeof c.contacto.metadata === 'object') ? c.contacto.metadata : {};
      const empresa   = meta['EMPRESA']      || meta['empresa']       || c.snapshotEmpresa  || null;
      const contrato  = meta['Nº CONTRATO']  || meta['CONTRATO']      || meta['contrato']   || null;
      const moraRaw   = meta['VALOR EN MORA']|| meta['VALOR_EN_MORA'] || null;
      let valorMora = null;
      if (moraRaw != null) {
        const p = parseFloat(String(moraRaw).replace(/[^0-9.-]/g, ''));
        if (!isNaN(p)) valorMora = p;
      }
      return {
        cdr_id:              c.id,
        hora_gestion:        c.timestampInicio?.toISOString()     || null,
        duracion_seg:        c.duracionSeg                         || null,
        monto_acordado:      c.montoAcordado != null ? Number(c.montoAcordado) : null,
        notas:               c.notas                               || null,
        resultado:           c.resultado                           || null,
        tipificacion_codigo: c.tipificacion?.codigo               || null,
        tipificacion_desc:   c.tipificacion?.descripcion          || null,
        asesor_nombre:       c.usuario?.nombre                    || null,
        nombre_deudor:       c.contacto?.nombreDeudor || c.snapshotNombre    || null,
        cedula:              c.contacto?.cedula        || c.snapshotCedula    || null,
        telefono:            c.contacto?.telefono      || c.snapshotTelefono  || null,
        empresa,
        contrato,
        valor_mora:          valorMora,
        fecha_promesa:       c.contacto?.agendamientos?.[0]?.fechaHora?.toISOString() || null,
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

// ── DELETE /api/compromisos/:id — Eliminar CDR compromiso ────────────────────
router.delete('/compromisos/:id', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const cdrId = parseInt(req.params.id);
    if (!cdrId) return res.status(400).json({ error: 'ID inválido' });
    const cdr = await db.cdr.findUnique({ where: { id: cdrId }, select: { contactoId: true } });
    if (!cdr) return res.status(404).json({ error: 'CDR no encontrado' });
    await db.cdr.update({
      where: { id: cdrId },
      data: { tipificacionId: null, resultado: null, montoAcordado: null, notas: null },
    });
    // Revertir contacto a PENDIENTE si no tiene otros CDRs tipificados
    const otrosTipif = await db.cdr.count({ where: { contactoId: cdr.contactoId, tipificacionId: { not: null }, id: { not: cdrId } } });
    if (otrosTipif === 0) {
      await db.contacto.update({ where: { id: cdr.contactoId }, data: { estadoMarcacion: 'PENDIENTE' } });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/jefe/meta-diaria-campanas ───────────────────────────────────────
router.get('/jefe/meta-diaria-campanas', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const hoy = new Date();
    const inicioDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const finDia    = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59, 999);

    const campanas = await db.campana.findMany({
      where: { estado: 'activa' },
      select: { id: true, nombre: true, metaDiaria: true },
      orderBy: { id: 'desc' },
    });

    const cobradosPorCampana = await db.$queryRaw`
      SELECT ct.campana_id, COALESCE(SUM(CAST(cdr.monto_acordado AS DOUBLE PRECISION)), 0) AS cobrado_hoy
      FROM cdrs cdr
      JOIN contactos ct ON cdr.contacto_id = ct.id
      WHERE cdr.timestamp_inicio >= ${inicioDia}
        AND cdr.timestamp_inicio <= ${finDia}
        AND cdr.monto_acordado IS NOT NULL
      GROUP BY ct.campana_id
    `;

    const cobradoMap = {};
    cobradosPorCampana.forEach(r => { cobradoMap[Number(r.campana_id)] = Number(r.cobrado_hoy); });

    res.json(campanas.map(c => {
      const cobrado_hoy = cobradoMap[c.id] ?? 0;
      return {
        id: c.id,
        nombre: c.nombre,
        meta_diaria: c.metaDiaria ?? 0,
        cobrado_hoy,
        pct_cumplimiento: (c.metaDiaria ?? 0) > 0
          ? Math.round((cobrado_hoy / c.metaDiaria) * 10000) / 100
          : 0,
      };
    }));
  } catch (err) { next(err); }
});

// ── POST /api/jefe/meta-diaria-campana ───────────────────────────────────────
router.post('/jefe/meta-diaria-campana', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { campanaId, valor } = req.body;
    const id  = parseInt(campanaId);
    const val = parseFloat(valor);
    if (!id || isNaN(val) || val < 0) return res.status(400).json({ error: 'campanaId y valor requeridos' });
    await db.campana.update({ where: { id }, data: { metaDiaria: val } });
    res.json({ ok: true });
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

    const rawWhere = buildContactoRawWhere(where);
    const cdrWhere = buildCdrContactoRawWhere(where);

    const [contactSegs, pmpSegs] = await Promise.all([
      db.$queryRaw(Prisma.sql`
        SELECT
          CAST(${Prisma.raw(DIAS_SEG_EXPR)} AS INTEGER) AS segmento,
          SUM(CASE WHEN NOT ya_pago THEN COALESCE(monto_deuda,0) ELSE 0 END)::float AS valor_vencido,
          SUM(CASE WHEN ya_pago     THEN COALESCE(monto_deuda,0) ELSE 0 END)::float AS valor_cobrado,
          COUNT(CASE WHEN NOT ya_pago THEN 1 END)::int AS unidades_vencidas,
          COUNT(CASE WHEN ya_pago     THEN 1 END)::int AS unidades_cobradas
        FROM contactos
        WHERE ${Prisma.raw(DIAS_SEG_EXPR)} ~ '^[0-2]$'
        ${rawWhere}
        GROUP BY segmento ORDER BY segmento
      `),
      db.$queryRaw(Prisma.sql`
        SELECT
          CAST(${Prisma.raw('COALESCE(NULLIF(c.metadata->>\'DIAS IMPAGO\',\'\'),NULLIF(c.metadata->>\'DIAS EN MORA\',\'\'),NULLIF(c.metadata->>\'DIAS MORA\',\'\'))')} AS INTEGER) AS segmento,
          COUNT(*)::int AS promesas
        FROM cdrs cd
        JOIN contactos c ON cd.contacto_id = c.id
        JOIN tipificaciones t ON cd.tipificacion_id = t.id
        WHERE t.codigo = 'PMP'
        AND ${Prisma.raw('COALESCE(NULLIF(c.metadata->>\'DIAS IMPAGO\',\'\'),NULLIF(c.metadata->>\'DIAS EN MORA\',\'\'),NULLIF(c.metadata->>\'DIAS MORA\',\'\'))')} ~ '^[0-2]$'
        ${cdrWhere}
        GROUP BY segmento
      `),
    ]);

    const pmpMap = {};
    for (const r of pmpSegs) pmpMap[String(r.segmento)] = Number(r.promesas);

    const porSegmento = contactSegs.map(r => {
      const s = Number(r.segmento);
      const vv = Number(r.valor_vencido);
      const vc = Number(r.valor_cobrado);
      const uv = Number(r.unidades_vencidas);
      const uc = Number(r.unidades_cobradas);
      const total_val = vv + vc;
      const total_und = uv + uc;
      return {
        segmento: s,
        valor_vencido: vv, valor_cobrado: vc,
        diferencia_monetaria: vv - vc,
        pct_recuperacion: total_val > 0 ? (vc / total_val) * 100 : 0,
        unidades_vencidas: uv, unidades_cobradas: uc,
        diferencia_unidades: uv - uc,
        pct_recuperacion_und: total_und > 0 ? (uc / total_und) * 100 : 0,
        promesas: pmpMap[String(s)] || 0,
      };
    });

    res.json({
      global: { valor_vencido, valor_cobrado, unidades_vencidas, unidades_cobradas,
                diferencia_monetaria, diferencia_unidades, pct_recuperacion, pct_recuperacion_und },
      porSegmento,
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

    const cdrRawWhere = buildCdrContactoRawWhere(cWhere);
    const C_DIAS = `COALESCE(NULLIF(c.metadata->>'DIAS IMPAGO',''),NULLIF(c.metadata->>'DIAS EN MORA',''),NULLIF(c.metadata->>'DIAS MORA',''))`;

    const result = await Promise.all(asesores.map(async (a) => {
      const [total_gestiones, segRows] = await Promise.all([
        db.cdr.count({ where: { usuarioId: a.id, ...cdrContacto } }),
        db.$queryRaw(Prisma.sql`
          SELECT
            CAST(${Prisma.raw(C_DIAS)} AS INTEGER) AS segmento,
            COUNT(*)::int AS gestiones,
            COUNT(CASE WHEN t.codigo = 'PMP'    THEN 1 END)::int AS promesas,
            COUNT(CASE WHEN cd.resultado = 'CUMPL'   THEN 1 END)::int AS cumplidas,
            COUNT(CASE WHEN cd.resultado = 'INCUMP'  THEN 1 END)::int AS vencidas
          FROM cdrs cd
          JOIN contactos c ON cd.contacto_id = c.id
          LEFT JOIN tipificaciones t ON cd.tipificacion_id = t.id
          WHERE cd.usuario_id = ${a.id}
          AND ${Prisma.raw(C_DIAS)} ~ '^[0-2]$'
          ${cdrRawWhere}
          GROUP BY segmento ORDER BY segmento
        `),
      ]);

      const segmentos = {
        '0': { gestiones: 0, promesas: 0, cumplidas: 0, vencidas: 0 },
        '1': { gestiones: 0, promesas: 0, cumplidas: 0, vencidas: 0 },
        '2': { gestiones: 0, promesas: 0, cumplidas: 0, vencidas: 0 },
      };
      for (const r of segRows) {
        const s = String(r.segmento);
        if (segmentos[s]) {
          segmentos[s].gestiones = Number(r.gestiones);
          segmentos[s].promesas  = Number(r.promesas);
          segmentos[s].cumplidas = Number(r.cumplidas);
          segmentos[s].vencidas  = Number(r.vencidas);
        }
      }
      return { asesor: a.nombre, total_gestiones, segmentos };
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

// ── Mensajes Broadcast ───────────────────────────────────────────
router.get('/mensajes-broadcast', requireRole('supervisor', 'jefe_area', 'admin', 'asesor'), async (req, res, next) => {
  try {
    const rows = await db.mensajeBroadcast.findMany({
      orderBy: { creadoEn: 'desc' },
      include: { supervisor: { select: { nombre: true } } },
    });
    res.json(rows.map(m => ({
      id:               m.id,
      mensaje:          m.mensaje,
      segmento_destino: m.segmentoDestino,
      activo:           m.activo ? 1 : 0,
      supervisor_nombre: m.supervisor?.nombre ?? null,
      creado_en:        m.creadoEn,
      pagos_posteriores: 0,
    })));
  } catch (err) { next(err); }
});

router.post('/mensajes-broadcast', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { mensaje, segmento_destino = 'TODOS' } = req.body;
    if (!mensaje?.trim()) return res.status(400).json({ error: 'Mensaje requerido' });
    const m = await db.mensajeBroadcast.create({
      data: { supervisorId: req.user.id, mensaje: mensaje.trim(), segmentoDestino: segmento_destino },
      include: { supervisor: { select: { nombre: true } } },
    });
    res.status(201).json({
      id:               m.id,
      mensaje:          m.mensaje,
      segmento_destino: m.segmentoDestino,
      activo:           1,
      supervisor_nombre: m.supervisor?.nombre ?? null,
      creado_en:        m.creadoEn,
      pagos_posteriores: 0,
    });
  } catch (err) { next(err); }
});

router.delete('/mensajes-broadcast/:id', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await db.mensajeBroadcast.update({ where: { id }, data: { activo: false } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Segmentos / Tramos dinámicos ──────────────────────────────────────────
router.get('/segmentos', requireRole('supervisor', 'jefe_area', 'asesor', 'admin'), async (req, res) => {
  try {
    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS segmentos_config (
        id SERIAL PRIMARY KEY,
        clave VARCHAR(100) UNIQUE NOT NULL,
        etiqueta VARCHAR(255) NOT NULL,
        color VARCHAR(50),
        icono VARCHAR(100)
      )
    `;
    const rows = await db.$queryRaw`
      SELECT clave AS key, etiqueta AS label, color, icono AS icon, 'transparent' AS gradient
      FROM segmentos_config ORDER BY id ASC
    `;
    res.json(rows);
  } catch (err) {
    res.json([]);
  }
});

router.post('/segmentos', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { clave, etiqueta, color } = req.body;
    if (!clave || !etiqueta) return res.status(400).json({ error: 'clave y etiqueta son requeridos' });
    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS segmentos_config (
        id SERIAL PRIMARY KEY,
        clave VARCHAR(100) UNIQUE NOT NULL,
        etiqueta VARCHAR(255) NOT NULL,
        color VARCHAR(50),
        icono VARCHAR(100)
      )
    `;
    await db.$executeRaw`
      INSERT INTO segmentos_config (clave, etiqueta, color)
      VALUES (${clave}, ${etiqueta}, ${color || '#9c27b0'})
      ON CONFLICT (clave) DO NOTHING
    `;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── PATCH /api/contactos/:id/toggle-mensajeria ────────────────────────────────
router.patch('/contactos/:id/toggle-mensajeria', async (req, res, next) => {
  try {
    const contactoId = parseInt(req.params.id);
    const { tipo, estado } = req.body;
    const fieldMap = { whatsapp: 'whatsappStatus', rcs: 'rcsStatus', correo: 'correoStatus' };
    const fechaMap = { whatsapp: 'wspEnviadoFecha', rcs: 'rcsEnviadoFecha', correo: 'correoEnviadoFecha' };
    const field = fieldMap[tipo];
    if (!field) return res.status(400).json({ error: 'Tipo no válido: ' + tipo });

    const data = { [field]: estado };
    if (estado === 'ENVIADO') data[fechaMap[tipo]] = new Date().toISOString().slice(0, 10);

    await db.contacto.update({ where: { id: contactoId }, data });

    if (estado === 'ENVIADO') {
      const canalMap = { whatsapp: 'WSP', rcs: 'SMS', correo: 'EMAIL' };
      await db.evento.create({
        data: {
          usuarioId: req.user.id,
          tipo: 'ACCION_RAPIDA',
          metadata: { canal: canalMap[tipo], contacto_id: contactoId },
        },
      }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/marcar-lote-enviado ─────────────────────────────────────────────
router.post('/marcar-lote-enviado', async (req, res, next) => {
  try {
    const { tipo, contactoIds } = req.body;
    if (!Array.isArray(contactoIds) || !contactoIds.length)
      return res.status(400).json({ error: 'contactoIds requerido' });

    const fieldMap = { whatsapp: 'whatsappStatus', rcs: 'rcsStatus', correo: 'correoStatus' };
    const fechaMap = { whatsapp: 'wspEnviadoFecha', rcs: 'rcsEnviadoFecha', correo: 'correoEnviadoFecha' };
    const canalMap = { whatsapp: 'WSP', rcs: 'SMS', correo: 'EMAIL' };
    const field = fieldMap[tipo];
    if (!field) return res.status(400).json({ error: 'Tipo no válido: ' + tipo });

    const today = new Date().toISOString().slice(0, 10);
    const ids = contactoIds.map(Number);

    await db.contacto.updateMany({
      where: { id: { in: ids } },
      data: { [field]: 'ENVIADO', [fechaMap[tipo]]: today },
    });

    await db.evento.createMany({
      data: ids.map(cid => ({
        usuarioId: req.user.id,
        tipo: 'ACCION_RAPIDA',
        metadata: { canal: canalMap[tipo], contacto_id: cid },
      })),
      skipDuplicates: true,
    }).catch(() => {});

    res.json({ ok: true, updated: ids.length });
  } catch (err) { next(err); }
});

// ── GET /api/cartera?campanaId=X ─────────────────────────────────────────────
router.get('/cartera', async (req, res, next) => {
  try {
    const asesorId  = req.user.id;
    const campanaId = req.query.campanaId ? parseInt(req.query.campanaId) : null;

    const where = { asignadoA: asesorId };
    if (campanaId) where.campanaId = campanaId;

    const contactos = await db.contacto.findMany({
      where,
      include: { campana: { select: { nombre: true } } },
      orderBy: [
        { ordenMarcacion: { sort: 'asc', nulls: 'last' } },
        { id: 'asc' },
      ],
    });

    // Última tipificación por contacto (CDR más reciente con tipificacion_id)
    const contactoIds = contactos.map(c => c.id);
    const latestTipCdrs = contactoIds.length > 0 ? await db.cdr.findMany({
      where: { contactoId: { in: contactoIds }, tipificacionId: { not: null } },
      select: { contactoId: true, tipificacion: { select: { codigo: true, descripcion: true } } },
      orderBy: { id: 'desc' },
    }) : [];
    const tipMap = new Map();
    for (const cdr of latestTipCdrs) {
      if (!tipMap.has(cdr.contactoId)) tipMap.set(cdr.contactoId, cdr.tipificacion);
    }

    const today = new Date().toISOString().slice(0, 10);

    res.json(contactos.map(ct => {
      // Status mensajería: solo cuenta como ENVIADO si fue enviado hoy
      const wspStatus = ct.whatsappStatus === 'ENVIADO'
        ? (ct.wspEnviadoFecha === today ? 'ENVIADO' : 'INACTIVO')
        : ct.whatsappStatus;
      const rcsStatus = ct.rcsStatus === 'ENVIADO'
        ? (ct.rcsEnviadoFecha === today ? 'ENVIADO' : 'ACTIVO')
        : ct.rcsStatus;
      const correoStatus = ct.correoStatus === 'ENVIADO'
        ? (ct.correoEnviadoFecha === today ? 'ENVIADO' : 'INACTIVO')
        : ct.correoStatus;
      const tip = tipMap.get(ct.id) || null;

      return {
        id: ct.id,
        cedula: ct.cedula,
        nombre_deudor: ct.nombreDeudor,
        telefono: ct.telefono,
        monto_deuda: ct.montoDeuda !== null ? Number(ct.montoDeuda) : null,
        producto: ct.producto,
        metadata: ct.metadata,
        estado_marcacion: ct.estadoMarcacion,
        intentos_realizados: ct.intentosRealizados,
        ya_pago: ct.yaPago,
        campana_id: ct.campanaId,
        campana_nombre: ct.campana?.nombre || null,
        whatsapp_status: wspStatus,
        rcs_status: rcsStatus,
        correo_status: correoStatus,
        validado_pago: ct.validadoPago,
        orden_marcacion: ct.ordenMarcacion,
        fecha_asignacion: ct.fechaAsignacion,
        ultima_tip_codigo: tip?.codigo || null,
        ultima_tipificacion: tip?.descripcion || null,
      };
    }));
  } catch (err) { next(err); }
});

// ── GET /api/bitacora?limite=N ────────────────────────────────────────────────
router.get('/bitacora', async (req, res, next) => {
  try {
    const asesorId = req.user.id;
    const limite   = parseInt(req.query.limite) || 500;

    const cdrs = await db.cdr.findMany({
      where: { usuarioId: asesorId, tipificacionId: { not: null } },
      include: {
        tipificacion: { select: { codigo: true, descripcion: true } },
        contacto:     { select: { nombreDeudor: true, telefono: true, metadata: true } },
      },
      orderBy: [{ timestampInicio: 'desc' }, { id: 'desc' }],
      take: limite,
    });

    res.json(cdrs.map(c => {
      const horaGestion = c.timestampInicio || c.creadoEn;
      const duracionSeg = c.duracionSeg != null
        ? c.duracionSeg
        : (c.timestampFin && c.timestampInicio
          ? Math.round((new Date(c.timestampFin) - new Date(c.timestampInicio)) / 1000)
          : null);

      return {
        id: c.id,
        contacto_id: c.contactoId,
        usuario_id: c.usuarioId,
        tipificacion_id: c.tipificacionId,
        timestamp_inicio: c.timestampInicio,
        timestamp_fin: c.timestampFin,
        creado_en: c.creadoEn,
        resultado: c.resultado,
        notas: c.notas,
        url_grabacion: c.urlGrabacion,
        monto_acordado: c.montoAcordado !== null ? Number(c.montoAcordado) : null,
        tipificacion_codigo: c.tipificacion?.codigo || null,
        tipificacion_desc: c.tipificacion?.descripcion || null,
        nombre_deudor: c.snapshotNombre || c.contacto?.nombreDeudor || null,
        telefono: c.snapshotTelefono || c.contacto?.telefono || null,
        hora_gestion: horaGestion,
        duracion_seg: duracionSeg,
        fecha_gestion: horaGestion ? new Date(horaGestion).toISOString().slice(0, 10) : null,
        metadata: c.contacto?.metadata || null,
      };
    }));
  } catch (err) { next(err); }
});

// ── GET /api/bitacora/refs?limite=N ──────────────────────────────────────────
router.get('/bitacora/refs', async (req, res, next) => {
  try {
    const asesorId = req.user.id;
    const limite   = parseInt(req.query.limite) || 1000;

    // sub_gestiones no está en schema Prisma — tabla opcional, devolver [] si no existe
    const rows = await db.$queryRaw`
      SELECT
        sg.id, sg.telefono, sg.notas, sg.creado_en AS timestamp,
        sg.contacto_id,
        ct.nombre_deudor, ct.telefono AS telefono_principal,
        DATE(sg.creado_en) AS fecha_gestion,
        sg.cdr_id, sg.nombre_ref, sg.parentesco
      FROM sub_gestiones sg
      LEFT JOIN contactos ct ON sg.contacto_id = ct.id
      WHERE sg.asesor_id = ${asesorId}
      ORDER BY sg.creado_en DESC
      LIMIT ${limite}
    `.catch(() => []);

    res.json(rows);
  } catch (err) { res.json([]); }
});

// ── GET /api/ranking-general?fecha=YYYY-MM-DD ─────────────────────────────────
router.get('/ranking-general', async (req, res, next) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);

    const asesores = await db.$queryRaw`
      SELECT id, nombre FROM usuarios
      WHERE rol = 'asesor' AND estado = 'activo'
      ORDER BY nombre ASC
    `;

    const ranking = asesores.map(a => ({
      id: Number(a.id),
      nombre: a.nombre,
      canales: {
        whatsapp: { global: 0, '0': 0, '1': 0, '2': 0 },
        rcs:      { global: 0, '0': 0, '1': 0, '2': 0 },
        gmail:    { global: 0, '0': 0, '1': 0, '2': 0 },
        llamada:  { global: 0, '0': 0, '1': 0, '2': 0 },
      },
    }));
    const map = Object.fromEntries(ranking.map(r => [r.id, r]));

    const getSegmento = (metadata) => {
      try {
        if (!metadata) return '0';
        const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
        const val = m['DIAS IMPAGO'] || m['DIAS EN INPAGO'] || m['DIAS MORA'] || m['DIAS EN MORA'] || m['dias impago'] || m['dias mora'] || m['dias en mora'] || 0;
        const d = parseInt(val, 10);
        if (isNaN(d) || d <= 0) return '0';
        if (d === 1) return '1';
        return '2';
      } catch { return '0'; }
    };

    // CDRs del día
    const cdrs = await db.$queryRaw`
      SELECT c.usuario_id, ct.metadata
      FROM cdrs c
      LEFT JOIN contactos ct ON c.contacto_id = ct.id
      WHERE DATE(c.timestamp_inicio) = ${fecha}::date OR DATE(c.creado_en) = ${fecha}::date
    `;
    for (const cdr of cdrs) {
      const uid = Number(cdr.usuario_id);
      if (map[uid]) {
        const seg = getSegmento(cdr.metadata);
        map[uid].canales.llamada.global += 1;
        if (['0','1','2'].includes(seg)) map[uid].canales.llamada[seg] += 1;
      }
    }

    // Eventos ACCION_RAPIDA del día
    const eventos = await db.$queryRaw`
      SELECT e.usuario_id, e.metadata, ct.metadata AS contacto_metadata
      FROM eventos e
      LEFT JOIN contactos ct
        ON ct.id = CAST(NULLIF(CAST(e.metadata->>'contacto_id' AS text), '') AS INTEGER)
      WHERE e.tipo = 'ACCION_RAPIDA' AND DATE(e.timestamp) = ${fecha}::date
    `;
    for (const ev of eventos) {
      const uid = Number(ev.usuario_id);
      if (!map[uid]) continue;
      try {
        const meta = typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : (ev.metadata || {});
        const canalStr = meta.canal || '';
        let tab = null;
        if (canalStr === 'WSP') tab = 'whatsapp';
        else if (canalStr === 'SMS') tab = 'rcs';
        else if (canalStr === 'EMAIL') tab = 'gmail';
        if (tab) {
          const seg = getSegmento(ev.contacto_metadata);
          map[uid].canales[tab].global += 1;
          if (['0','1','2'].includes(seg)) map[uid].canales[tab][seg] += 1;
        }
      } catch {}
    }

    res.json(ranking);
  } catch (err) { next(err); }
});

// ── GET /api/proyeccion-mensual ───────────────────────────────────────────────
router.get('/proyeccion-mensual', async (req, res, next) => {
  try {
    const metaRow = await db.$queryRaw`
      SELECT valor FROM config WHERE clave = 'meta_mensual_usd' LIMIT 1
    `;
    const metaMensual = metaRow[0] ? parseFloat(metaRow[0].valor) || 0 : 0;

    const cobradoRow = await db.$queryRaw`
      SELECT
        COALESCE(SUM(co.monto_deuda), 0)   AS cobrado_mes,
        COUNT(DISTINCT co.id)::int          AS pagos_mes
      FROM cdrs cd
      JOIN contactos co ON co.id = cd.contacto_id
      WHERE co.ya_pago = true
        AND TO_CHAR(cd.creado_en AT TIME ZONE 'UTC', 'YYYY-MM') = TO_CHAR(NOW(), 'YYYY-MM')
    `;
    const cobradoMes = Number(cobradoRow[0]?.cobrado_mes ?? 0);
    const pagosMes   = Number(cobradoRow[0]?.pagos_mes   ?? 0);

    res.json({
      meta_mensual:     metaMensual,
      cobrado_mes:      cobradoMes,
      pagos_mes:        pagosMes,
      diferencia:       metaMensual - cobradoMes,
      pct_cumplimiento: metaMensual > 0
        ? Math.round((cobradoMes / metaMensual) * 10000) / 100 : 0,
    });
  } catch (err) { next(err); }
});

// ── GET /api/indicadores-cobranza ─────────────────────────────────────────────
router.get('/indicadores-cobranza', async (req, res, next) => {
  try {
    const global = await db.$queryRaw`
      SELECT
        COALESCE(SUM(monto_deuda), 0)::float                                          AS valor_vencido,
        COALESCE(SUM(CASE WHEN ya_pago = true THEN monto_deuda ELSE 0 END), 0)::float AS valor_cobrado,
        COUNT(*)::int                                                                  AS unidades_vencidas,
        SUM(CASE WHEN ya_pago = true THEN 1 ELSE 0 END)::int                          AS unidades_cobradas
      FROM contactos
    `;
    const g = global[0] || {};
    const gVen = Number(g.valor_vencido || 0);
    const gCob = Number(g.valor_cobrado || 0);
    const gUVen = Number(g.unidades_vencidas || 0);
    const gUCob = Number(g.unidades_cobradas || 0);

    const segRows = await db.$queryRaw`
      SELECT
        CASE
          WHEN (
            CASE WHEN (COALESCE(
              NULLIF(metadata->>'DIAS IMPAGO',''),
              NULLIF(metadata->>'DIAS EN INPAGO',''),
              NULLIF(metadata->>'DIAS MORA',''),
              NULLIF(metadata->>'DIAS EN MORA',''),
              NULLIF(metadata->>'dias impago',''),
              NULLIF(metadata->>'dias en mora',''),
              '0'
            ) ~ '^[0-9]+$')
            THEN CAST(COALESCE(
              NULLIF(metadata->>'DIAS IMPAGO',''),
              NULLIF(metadata->>'DIAS EN INPAGO',''),
              NULLIF(metadata->>'DIAS MORA',''),
              NULLIF(metadata->>'dias impago',''),
              '0'
            ) AS INTEGER)
            ELSE 0 END
          ) <= 0 THEN '0'
          WHEN (
            CASE WHEN (COALESCE(
              NULLIF(metadata->>'DIAS IMPAGO',''),
              NULLIF(metadata->>'DIAS EN INPAGO',''),
              NULLIF(metadata->>'DIAS MORA',''),
              NULLIF(metadata->>'DIAS EN MORA',''),
              NULLIF(metadata->>'dias impago',''),
              NULLIF(metadata->>'dias en mora',''),
              '0'
            ) ~ '^[0-9]+$')
            THEN CAST(COALESCE(
              NULLIF(metadata->>'DIAS IMPAGO',''),
              NULLIF(metadata->>'DIAS EN INPAGO',''),
              NULLIF(metadata->>'DIAS MORA',''),
              NULLIF(metadata->>'dias impago',''),
              '0'
            ) AS INTEGER)
            ELSE 0 END
          ) = 1 THEN '1'
          ELSE '2'
        END AS segmento,
        COALESCE(SUM(monto_deuda), 0)::float                                          AS valor_vencido,
        COALESCE(SUM(CASE WHEN ya_pago = true THEN monto_deuda ELSE 0 END), 0)::float AS valor_cobrado,
        COUNT(*)::int                                                                  AS unidades_vencidas,
        SUM(CASE WHEN ya_pago = true THEN 1 ELSE 0 END)::int                          AS unidades_cobradas
      FROM contactos
      GROUP BY 1
    `;

    const segmentos = {};
    for (const row of segRows) {
      const ven = Number(row.valor_vencido || 0);
      const cob = Number(row.valor_cobrado || 0);
      const uVen = Number(row.unidades_vencidas || 0);
      const uCob = Number(row.unidades_cobradas || 0);
      segmentos[row.segmento] = {
        valor_vencido: ven,
        valor_cobrado: cob,
        diferencia_monetaria: ven - cob,
        pct_recuperacion: ven > 0 ? Math.round((cob / ven) * 10000) / 100 : 0,
        unidades_vencidas: uVen,
        unidades_cobradas: uCob,
        diferencia_unidades: uVen - uCob,
        pct_recuperacion_und: uVen > 0 ? Math.round((uCob / uVen) * 10000) / 100 : 0,
      };
    }

    res.json({
      global: {
        valor_vencido: gVen,
        valor_cobrado: gCob,
        diferencia_monetaria: gVen - gCob,
        pct_recuperacion: gVen > 0 ? Math.round((gCob / gVen) * 10000) / 100 : 0,
        unidades_vencidas: gUVen,
        unidades_cobradas: gUCob,
        diferencia_unidades: gUVen - gUCob,
        pct_recuperacion_und: gUVen > 0 ? Math.round((gUCob / gUVen) * 10000) / 100 : 0,
      },
      segmentos,
    });
  } catch (err) { next(err); }
});

// ── GET /api/tipificaciones ───────────────────────────────────────────────────
router.get('/tipificaciones', async (req, res, next) => {
  try {
    const tips = await db.tipificacion.findMany({ orderBy: { id: 'asc' } });
    // Normalizar a snake_case para compatibilidad con frontend (usa requiere_agd)
    res.json(tips.map(t => ({
      ...t,
      requiere_agd: t.requiereAgd,
    })));
  } catch (err) { next(err); }
});

// ── POST /api/eventos ─────────────────────────────────────────────────────────
router.post('/eventos', async (req, res, next) => {
  try {
    const body = req.body;
    const usuarioId = parseInt(body.usuario_id || body.usuarioId || req.user.id);
    const tipo = body.tipo;
    const TIPOS_VALIDOS = ['ESTADO', 'LLAMADA', 'CONEXION', 'DESCONEXION', 'ACCION_RAPIDA'];
    if (!TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({ error: `tipo inválido. Válidos: ${TIPOS_VALIDOS.join(', ')}` });
    }

    const evento = await db.evento.create({
      data: {
        usuarioId,
        tipo,
        estadoId:   body.estado_id   != null ? parseInt(body.estado_id)   : null,
        duracionSeg: body.duracion_seg != null ? parseInt(body.duracion_seg) : null,
        metadata:   body.metadata    || null,
      },
    });
    res.json({ id: evento.id });
  } catch (err) { next(err); }
});

// ── POST /api/agendamientos ───────────────────────────────────────────────────
router.post('/agendamientos', async (req, res, next) => {
  try {
    const body = req.body;
    const contactoId = parseInt(body.contacto_id || body.contactoId);
    const asesorId   = parseInt(body.asesor_id   || body.asesorId   || req.user.id);
    const tipo       = body.tipo; // PMP | VOL_CALL
    const fechaHora  = body.fecha_hora || body.fechaHora;
    if (!contactoId || !tipo || !fechaHora)
      return res.status(400).json({ error: 'contactoId, tipo y fechaHora requeridos' });
    if (!['PMP', 'VOL_CALL'].includes(tipo))
      return res.status(400).json({ error: 'tipo debe ser PMP o VOL_CALL' });

    const ag = await db.agendamiento.create({
      data: {
        contactoId,
        asesorId,
        tipo,
        fechaHora: new Date(fechaHora),
        notas:  body.notas || null,
        estado: 'pendiente',
      },
    });

    await db.contacto.update({
      where: { id: contactoId },
      data:  { estadoMarcacion: 'AGENDADO' },
    });

    res.json({ id: ag.id });
  } catch (err) { next(err); }
});

// ── GET /api/sub-gestiones ────────────────────────────────────────────────────
router.get('/sub-gestiones', async (req, res, next) => {
  try {
    const asesorId = req.user.id;
    const fecha    = req.query.fecha || '';
    const limit    = parseInt(req.query.limite) || 500;

    let rows;
    if (fecha) {
      rows = await db.$queryRaw`
        SELECT sg.*, co.nombre_deudor, co.telefono AS tel_principal
        FROM   sub_gestiones sg
        LEFT JOIN contactos co ON co.id = sg.contacto_id
        WHERE  sg.asesor_id = ${asesorId} AND DATE(sg.creado_en) = ${fecha}::date
        ORDER  BY sg.id DESC LIMIT ${limit}
      `.catch(() => []);
    } else {
      rows = await db.$queryRaw`
        SELECT sg.*, co.nombre_deudor, co.telefono AS tel_principal
        FROM   sub_gestiones sg
        LEFT JOIN contactos co ON co.id = sg.contacto_id
        WHERE  sg.asesor_id = ${asesorId}
        ORDER  BY sg.id DESC LIMIT ${limit}
      `.catch(() => []);
    }

    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/sub-gestiones ───────────────────────────────────────────────────
router.post('/sub-gestiones', async (req, res, next) => {
  try {
    const body      = req.body;
    const asesorId  = body.asesorId || body.asesor_id || req.user.id;
    const contactoId = body.contactoId || body.contacto_id;

    await db.$executeRaw`
      INSERT INTO sub_gestiones (contacto_id, asesor_id, cdr_id, telefono, notas, nombre_ref, parentesco)
      VALUES (
        ${contactoId ? parseInt(contactoId) : null},
        ${parseInt(asesorId)},
        ${body.cdrId || body.cdr_id ? parseInt(body.cdrId || body.cdr_id) : null},
        ${body.telefono   || null},
        ${body.notas      || null},
        ${body.nombreRef  || body.nombre_ref  || null},
        ${body.parentesco || null}
      )
    `.catch(() => null);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/mis-compromisos — Compromisos del asesor autenticado ────────────
router.get('/mis-compromisos', async (req, res, next) => {
  try {
    const asesorId = req.user.id;
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
    const incluirVolCall = req.query.incluirVolCall === '1';

    const codigos = ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP', 'REAG', 'INCUMP'];
    if (incluirVolCall) codigos.push('VOL_CALL');

    const cdrs = await db.$queryRaw`
      SELECT
        c.id              AS cdr_id,
        c.contacto_id,
        c.usuario_id,
        c.timestamp_inicio AS hora_gestion,
        c.duracion_seg,
        c.monto_acordado,
        c.notas,
        c.resultado,
        t.codigo          AS tipificacion_codigo,
        t.descripcion     AS tipificacion_desc,
        co.nombre_deudor,
        co.cedula,
        co.telefono,
        co.metadata,
        COALESCE(
          c.scheduled_datetime,
          (
            SELECT ag.fecha_hora FROM agendamientos ag
            WHERE ag.contacto_id = c.contacto_id AND ag.asesor_id = c.usuario_id
              AND ag.estado != 'cancelado'
            ORDER BY ag.id DESC LIMIT 1
          )
        ) AS fecha_promesa
      FROM cdrs c
      JOIN tipificaciones t ON c.tipificacion_id = t.id
      LEFT JOIN contactos co ON co.id = c.contacto_id
      WHERE c.usuario_id = ${asesorId}
        AND t.codigo = ANY(${codigos})
        AND (
          DATE(c.timestamp_inicio AT TIME ZONE 'UTC') = ${fecha}::date
          OR EXISTS (
            SELECT 1 FROM agendamientos ag
            WHERE ag.contacto_id = c.contacto_id AND ag.asesor_id = c.usuario_id
              AND ag.estado != 'cancelado'
              AND DATE(ag.fecha_hora) = ${fecha}::date
          )
        )
      ORDER BY c.timestamp_inicio DESC
    `;

    const result = cdrs.map(r => {
      let empresa = null, contrato = null, valor_mora = null, dias_mora = null;
      if (r.metadata) {
        const m = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
        empresa = m['EMPRESA'] || null;
        contrato = m['Nº CONTRATO'] || m['CONTRATO'] || null;
        const rawMora = m['VALOR EN MORA'];
        if (rawMora != null) {
          const p = parseFloat(String(rawMora).replace(/[^0-9.-]/g, ''));
          valor_mora = isNaN(p) ? null : p;
        }
        const rawDias = m['DIAS IMPAGO'] || m['DIAS EN MORA'] || m['DIAS EN INPAGO'] || m['DIAS MORA'];
        if (rawDias != null) {
          const d = parseInt(String(rawDias));
          dias_mora = isNaN(d) ? null : d;
        }
      }
      return {
        cdr_id: Number(r.cdr_id),
        contacto_id: r.contacto_id ? Number(r.contacto_id) : null,
        usuario_id: Number(r.usuario_id),
        hora_gestion: r.hora_gestion,
        duracion_seg: r.duracion_seg ? Number(r.duracion_seg) : null,
        monto_acordado: r.monto_acordado != null ? Number(r.monto_acordado) : null,
        notas: r.notas,
        resultado: r.resultado,
        tipificacion_codigo: r.tipificacion_codigo,
        tipificacion_desc: r.tipificacion_desc,
        nombre_deudor: r.nombre_deudor,
        cedula: r.cedula,
        telefono: r.telefono,
        empresa,
        contrato,
        valor_mora,
        dias_mora,
        fecha_promesa: r.fecha_promesa || null,
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/confirmar-pago-compromiso ────────────────────────────────────
router.post('/confirmar-pago-compromiso', async (req, res, next) => {
  try {
    const { cdrId, montoPagado, comprobante, formaPago } = req.body;
    if (!cdrId) return res.status(400).json({ error: 'cdrId requerido' });

    const tipPagoReal = await db.tipificacion.findUnique({ where: { codigo: 'PAGO_REAL' } });
    if (!tipPagoReal) return res.status(500).json({ error: 'Tipificación PAGO_REAL no encontrada' });

    await db.cdr.update({
      where: { id: Number(cdrId) },
      data: {
        tipificacionId: tipPagoReal.id,
        resultado: 'COMP_CUM',
        ...(montoPagado != null ? { montoAcordado: Number(montoPagado) } : {}),
      },
    });

    const cdr = await db.cdr.findUnique({ where: { id: Number(cdrId) }, select: { contactoId: true } });
    if (cdr?.contactoId) {
      await db.contacto.update({
        where: { id: cdr.contactoId },
        data: { yaPago: true, estadoMarcacion: 'YA_PAGO' },
      });
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/reagendar-compromiso ─────────────────────────────────────────
router.post('/reagendar-compromiso', async (req, res, next) => {
  try {
    const { cdrId, nuevaFecha, nuevaHora, nuevoMonto } = req.body;
    if (!cdrId) return res.status(400).json({ error: 'cdrId requerido' });
    if (!nuevaFecha || !nuevaHora) return res.status(400).json({ error: 'nuevaFecha y nuevaHora requeridos' });

    const cdr = await db.cdr.findUnique({ where: { id: Number(cdrId) }, select: { contactoId: true, usuarioId: true } });
    if (!cdr) return res.status(404).json({ error: 'CDR no encontrado' });

    if (nuevoMonto != null) {
      await db.cdr.update({ where: { id: Number(cdrId) }, data: { montoAcordado: Number(nuevoMonto) } });
    }

    await db.cdr.update({ where: { id: Number(cdrId) }, data: { resultado: 'REAG' } });

    if (cdr.contactoId) {
      await db.agendamiento.updateMany({
        where: {
          contactoId: cdr.contactoId,
          asesorId: cdr.usuarioId,
          estado: { notIn: ['ejecutado', 'cancelado'] },
        },
        data: { estado: 'cancelado' },
      });

      await db.agendamiento.create({
        data: {
          contactoId: cdr.contactoId,
          asesorId: cdr.usuarioId,
          tipo: 'PMP',
          fechaHora: new Date(`${nuevaFecha}T${nuevaHora}:00`),
          estado: 'pendiente',
        },
      });
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/marcar-compromiso-incumplido ────────────────────────────────
router.post('/marcar-compromiso-incumplido', async (req, res, next) => {
  try {
    const { cdrId } = req.body;
    if (!cdrId) return res.status(400).json({ error: 'cdrId requerido' });

    let tipIncump = await db.tipificacion.findUnique({ where: { codigo: 'INCUMP' } });
    if (!tipIncump) {
      tipIncump = await db.tipificacion.create({
        data: { codigo: 'INCUMP', descripcion: 'Compromiso Incumplido', categoria: 'CONTACTO_NEUTRO', finalizaGestion: true },
      });
    }

    const cdr = await db.cdr.findUnique({ where: { id: Number(cdrId) }, select: { contactoId: true, usuarioId: true } });
    if (!cdr) return res.status(404).json({ error: 'CDR no encontrado' });

    await db.cdr.update({ where: { id: Number(cdrId) }, data: { tipificacionId: tipIncump.id, resultado: 'INCUMP' } });

    if (cdr.contactoId) {
      await db.contacto.update({
        where: { id: cdr.contactoId },
        data: { yaPago: false, estadoMarcacion: 'PENDIENTE' },
      });
      await db.agendamiento.updateMany({
        where: {
          contactoId: cdr.contactoId,
          asesorId: cdr.usuarioId,
          estado: { notIn: ['ejecutado', 'cancelado'] },
        },
        data: { estado: 'cancelado' },
      });
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
