/**
 * supervisor.routes.js — Endpoints requeridos por JefePanel y componentes
 * del supervisor en modo VM (PostgreSQL). Equivalentes a los definidos en
 * src/main/apiServer.js para el modo local SQLite.
 */

const { Router } = require('express');
const { Prisma } = require('@prisma/client');
const ExcelJS = require('exceljs');
const db = require('../config/db');
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { broadcastToAll, broadcastToJefeTeam, getConnectedStats } = require('../wsServer');
const cache = require('../utils/cache');

const router = Router();
router.use(authMiddleware);

function isSupervisor(rol) {
  return rol === 'jefe_area' || rol === 'jefe' || rol === 'admin';
}

// IDs de usuarios backoff/apoyo — excluidos de gestiones y reportes
// Configurar en backend/.env: APOYO_USER_IDS=5,12
const _APOYO_IDS = (process.env.APOYO_USER_IDS || '')
  .split(',')
  .map(s => parseInt(s.trim(), 10))
  .filter(n => !isNaN(n));

// ── Helper: límites de día Guayaquil ─────────────────────────────────────────
// CRÍTICO: cdrs.timestamp_inicio es `timestamp WITHOUT time zone`, guarda el
// wall-clock local de Guayaquil como naive (Prisma lo lee tal cual, tag UTC).
// Por eso los límites de "día" deben ser la fecha calendario Guayaquil etiquetada
// como UTC — NO `new Date().setHours(0)` (que aplica el offset del server GMT-5 y
// desfasa 5h → excluye gestiones de 00:00–10:00 y rompe justo tras medianoche).
// fechaStr opcional 'YYYY-MM-DD' (Guayaquil). Sin arg → hoy Guayaquil.
function _gyeDayBounds(fechaStr) {
  const ymd = fechaStr || new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Guayaquil' });
  return {
    ymd,
    inicio: new Date(`${ymd}T00:00:00.000Z`),
    fin:    new Date(`${ymd}T23:59:59.999Z`),
  };
}

// Parsea strings datetime sin zona como hora Ecuador (UTC-5 fijo, sin DST).
// Evita que el servidor US interprete la hora del usuario como US local.
const parseGYE = (s) => {
  if (!s) return null;
  if (/Z|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s + '-05:00');
};

// Convierte un Date (UTC) a ISO local Guayaquil sin Z: "YYYY-MM-DDTHH:MM:SS"
const toGYELocalISO = (d) =>
  new Date(d).toLocaleString('sv-SE', { timeZone: 'America/Guayaquil' }).replace(' ', 'T');

// ── Helper: Resolve contacto WHERE with JSON metadata filters ─────────────────
// Returns Prisma-compatible where clause. Uses raw SQL when metadata filters present.
async function resolveContactoWhere(q) {
  const { campanaId, distribuidor, grupo, numeroCuota } = q || {};
  const VALID_EMPRESA = ['TEC_SAS', 'SCC', 'CREDI_TV', 'UPHONE'];
  const empresa = q?.empresa && VALID_EMPRESA.includes(q.empresa) ? q.empresa : null;

  if (!distribuidor && !grupo && !numeroCuota) {
    const w = {};
    if (campanaId) w.campanaId = parseInt(campanaId);
    if (empresa === 'UPHONE') w.empresa = { in: ['TEC_SAS', 'SCC'] };
    else if (empresa) w.empresa = empresa;
    return w;
  }

  const parts = [];
  if (campanaId) parts.push(Prisma.sql`AND campana_id = ${parseInt(campanaId)}`);
  if (empresa === 'UPHONE') parts.push(Prisma.sql`AND empresa IN ('TEC_SAS','SCC')`);
  else if (empresa) parts.push(Prisma.sql`AND empresa = ${empresa}`);
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
  const parts = [];
  if (cWhere.id?.in?.length) {
    parts.push(Prisma.sql`AND id IN (${Prisma.join(cWhere.id.in.map(id => Prisma.sql`${id}`))})`);
  } else if (cWhere.campanaId) {
    parts.push(Prisma.sql`AND campana_id = ${cWhere.campanaId}`);
  }
  if (cWhere.empresa?.in) {
    parts.push(Prisma.sql`AND empresa IN (${Prisma.join(cWhere.empresa.in.map(e => Prisma.sql`${e}`))})`);
  } else if (cWhere.empresa) {
    parts.push(Prisma.sql`AND empresa = ${cWhere.empresa}`);
  }
  return parts.length ? Prisma.join(parts, ' ') : Prisma.sql``;
}
function buildCdrContactoRawWhere(cWhere, alias = 'c') {
  const parts = [];
  if (cWhere.id?.in?.length) {
    parts.push(Prisma.sql`AND ${Prisma.raw(alias)}.id IN (${Prisma.join(cWhere.id.in.map(id => Prisma.sql`${id}`))})`);
  } else if (cWhere.campanaId) {
    parts.push(Prisma.sql`AND ${Prisma.raw(alias)}.campana_id = ${cWhere.campanaId}`);
  }
  if (cWhere.empresa?.in) {
    parts.push(Prisma.sql`AND ${Prisma.raw(alias)}.empresa IN (${Prisma.join(cWhere.empresa.in.map(e => Prisma.sql`${e}`))})`);
  } else if (cWhere.empresa) {
    parts.push(Prisma.sql`AND ${Prisma.raw(alias)}.empresa = ${cWhere.empresa}`);
  }
  return parts.length ? Prisma.join(parts, ' ') : Prisma.sql``;
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

// ── GET /api/actividad-tipificacion — Matriz gestores × tipificación (día) ───
// Panel "Actividad Gestores": conteo + tiempo al aire por categoría y por
// código de tipificación, para todos los asesores activos del equipo
// (incluidos los que tienen 0 gestiones ese día).
router.get('/actividad-tipificacion', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // Límites de día Guayaquil (naive-UTC) — ver _gyeDayBounds
    if (req.query.fecha && isNaN(new Date(req.query.fecha).getTime())) {
      return res.status(400).json({ error: 'Fecha inválida' });
    }
    const { inicio, fin } = _gyeDayBounds(req.query.fecha);
    const campanaId = req.query.campanaId ? parseInt(req.query.campanaId) : null;

    const asesorIds = await getAsesorIdsDelEquipo(req.user); // null = admin (todos)
    const usuarioWhere = { estado: 'activo', rol: 'asesor' };
    if (asesorIds) usuarioWhere.id = { in: asesorIds };
    const asesores = await db.usuario.findMany({
      where: usuarioWhere,
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });

    const asesorIdList = asesores.map(a => a.id);
    // Una sola query para avance + segmentos por asesor (reemplaza N×2 queries + segRows)
    const fechaYmd = _gyeDayBounds(req.query.fecha).ymd; // 'YYYY-MM-DD'
    const [grupos, tipifs, detalleRows, canalRows, segActualRows, msgRows, primeraGestionRows] = await Promise.all([
      db.cdr.groupBy({
        by: ['usuarioId', 'tipificacionId'],
        where: {
          usuarioId: { in: asesorIdList },
          timestampInicio: { gte: inicio, lte: fin },
        },
        _count: { _all: true },
        _sum: { duracionSeg: true },
      }),
      db.tipificacion.findMany({
        select: { id: true, codigo: true, descripcion: true, categoria: true },
      }),
      // detalleRows: avance por asesor+segmento de la apertura de hoy
      // Deduplicado por clave_gestion (contrato único). Gestionados = tiene CDR hoy (no estadoMarcacion global).
      asesorIdList.length === 0 ? Promise.resolve([]) : (() => {
        const _emp     = ['TEC_SAS','SCC','CREDI_TV','UPHONE'].includes(req.query.empresa) ? req.query.empresa : '';
        const campSql  = campanaId ? Prisma.sql`AND co.campana_id = ${campanaId}` : Prisma.empty;
        const empSql   = _emp === 'UPHONE' ? Prisma.sql`AND co.empresa IN ('TEC_SAS','SCC')`
          : _emp ? Prisma.sql`AND co.empresa = ${_emp}` : Prisma.empty;
        const apoyoSql = _APOYO_IDS.length
          ? Prisma.sql`AND cr2.usuario_id NOT IN (${Prisma.join(_APOYO_IDS)})` : Prisma.empty;
        const fechaSql = campanaId ? Prisma.empty
          : Prisma.sql`AND DATE(co.fecha_asignacion AT TIME ZONE 'America/Guayaquil') = ${fechaYmd}::date`;
        const segExpr  = Prisma.raw(`CASE
          WHEN COALESCE(
            CASE WHEN co.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (co.metadata->>'DIAS IMPAGO')::int  END,
            CASE WHEN co.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (co.metadata->>'DIAS EN MORA')::int END,
            CASE WHEN co.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (co.metadata->>'DIAS MORA')::int    END
          ) >= 2 THEN '2'
          WHEN COALESCE(
            CASE WHEN co.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (co.metadata->>'DIAS IMPAGO')::int  END,
            CASE WHEN co.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (co.metadata->>'DIAS EN MORA')::int END,
            CASE WHEN co.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (co.metadata->>'DIAS MORA')::int    END
          ) = 1 THEN '1'
          WHEN COALESCE(
            CASE WHEN co.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (co.metadata->>'DIAS IMPAGO')::int  END,
            CASE WHEN co.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (co.metadata->>'DIAS EN MORA')::int END,
            CASE WHEN co.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (co.metadata->>'DIAS MORA')::int    END
          ) = 0 THEN '0'
          ELSE 'sin_seg' END`);
        return db.$queryRaw`
          SELECT co.asignado_a, seg,
            COUNT(DISTINCT COALESCE(co.clave_gestion, co.id::text))::int AS total,
            COUNT(DISTINCT CASE WHEN has_cdr = 1 THEN COALESCE(co.clave_gestion, co.id::text) END)::int AS gestionados
          FROM (
            SELECT co.id, co.asignado_a, co.clave_gestion, ${segExpr} AS seg,
              CASE WHEN cr2.hit IS NOT NULL THEN 1 ELSE 0 END AS has_cdr
            FROM contactos co
            LEFT JOIN LATERAL (
              SELECT 1 AS hit FROM cdrs cr2
              WHERE cr2.contacto_id = co.id
                AND cr2.timestamp_inicio >= ${inicio}
                AND cr2.timestamp_inicio <= ${fin}
                ${apoyoSql}
              LIMIT 1
            ) cr2 ON true
            WHERE co.asignado_a IN (${Prisma.join(asesorIdList)})
              ${campSql}
              ${empSql}
              ${fechaSql}
          ) co
          GROUP BY co.asignado_a, seg
        `;
      })(),
      // canalRows: WSP/RCS/CORREO de la apertura de hoy por asesor+segmento
      asesorIdList.length === 0 ? Promise.resolve([]) : (() => {
        const campSql  = campanaId ? Prisma.sql`AND co.campana_id = ${campanaId}` : Prisma.empty;
        const fechaSql = campanaId ? Prisma.empty
          : Prisma.sql`AND DATE(co.fecha_asignacion AT TIME ZONE 'America/Guayaquil') = ${fechaYmd}::date`;
        const segCo = Prisma.raw(`CASE
          WHEN COALESCE(
            CASE WHEN co.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (co.metadata->>'DIAS IMPAGO')::int  END,
            CASE WHEN co.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (co.metadata->>'DIAS EN MORA')::int END,
            CASE WHEN co.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (co.metadata->>'DIAS MORA')::int    END
          ) >= 2 THEN '2'
          WHEN COALESCE(
            CASE WHEN co.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (co.metadata->>'DIAS IMPAGO')::int  END,
            CASE WHEN co.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (co.metadata->>'DIAS EN MORA')::int END,
            CASE WHEN co.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (co.metadata->>'DIAS MORA')::int    END
          ) = 1 THEN '1'
          WHEN COALESCE(
            CASE WHEN co.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (co.metadata->>'DIAS IMPAGO')::int  END,
            CASE WHEN co.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (co.metadata->>'DIAS EN MORA')::int END,
            CASE WHEN co.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (co.metadata->>'DIAS MORA')::int    END
          ) = 0 THEN '0'
          ELSE 'sin_seg' END`);
        return db.$queryRaw`
          SELECT usuario_id, canal, seg, COUNT(*)::int AS total
          FROM (
            SELECT cr.usuario_id, cr.canal, ${segCo} AS seg
            FROM cdrs cr
            JOIN contactos co ON co.id = cr.contacto_id
            WHERE cr.usuario_id IN (${Prisma.join(asesorIdList)})
              AND cr.timestamp_inicio >= ${inicio} AND cr.timestamp_inicio <= ${fin}
              AND cr.canal IN ('whatsapp', 'rcs', 'gmail')
              ${campSql}
              ${fechaSql}
          ) sub
          GROUP BY usuario_id, canal, seg
        `;
      })(),
      // segActualRows: segmento del CDR más reciente hoy por asesor
      asesorIdList.length === 0 ? Promise.resolve([]) : (() => {
        const segCo = Prisma.raw(`CASE
          WHEN COALESCE(
            CASE WHEN co.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (co.metadata->>'DIAS IMPAGO')::int  END,
            CASE WHEN co.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (co.metadata->>'DIAS EN MORA')::int END,
            CASE WHEN co.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (co.metadata->>'DIAS MORA')::int    END
          ) >= 2 THEN '2'
          WHEN COALESCE(
            CASE WHEN co.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (co.metadata->>'DIAS IMPAGO')::int  END,
            CASE WHEN co.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (co.metadata->>'DIAS EN MORA')::int END,
            CASE WHEN co.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (co.metadata->>'DIAS MORA')::int    END
          ) = 1 THEN '1'
          WHEN COALESCE(
            CASE WHEN co.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (co.metadata->>'DIAS IMPAGO')::int  END,
            CASE WHEN co.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (co.metadata->>'DIAS EN MORA')::int END,
            CASE WHEN co.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (co.metadata->>'DIAS MORA')::int    END
          ) = 0 THEN '0'
          ELSE NULL END`);
        return db.$queryRaw`
          SELECT DISTINCT ON (cr.usuario_id)
            cr.usuario_id,
            ${segCo} AS segmento_actual
          FROM cdrs cr
          JOIN contactos co ON co.id = cr.contacto_id
          WHERE cr.usuario_id IN (${Prisma.join(asesorIdList)})
            AND cr.timestamp_inicio >= ${inicio} AND cr.timestamp_inicio <= ${fin}
          ORDER BY cr.usuario_id, cr.timestamp_inicio DESC
        `;
      })(),
      // msgRows: WSP/RCS/CORREO enviados por asesor (desde contactos, no CDRs)
      asesorIdList.length === 0 ? Promise.resolve([]) : (() => {
        const campSql = campanaId ? Prisma.sql`AND campana_id = ${campanaId}` : Prisma.empty;
        return db.$queryRaw`
          SELECT asignado_a,
            COUNT(CASE WHEN whatsapp_status = 'ENVIADO' THEN 1 END)::int AS wsp,
            COUNT(CASE WHEN rcs_status      = 'ENVIADO' THEN 1 END)::int AS rcs,
            COUNT(CASE WHEN correo_status   = 'ENVIADO' THEN 1 END)::int AS correo
          FROM contactos
          WHERE asignado_a IN (${Prisma.join(asesorIdList)})
            ${campSql}
          GROUP BY asignado_a
        `;
      })(),
      // primeraGestionRows: MIN timestamp_inicio del día por asesor (para calcular gest/hr en frontend)
      asesorIdList.length === 0 ? Promise.resolve([]) : db.cdr.groupBy({
        by: ['usuarioId'],
        where: { usuarioId: { in: asesorIdList }, timestampInicio: { gte: inicio, lte: fin } },
        _min: { timestampInicio: true },
      }).catch(() => []),
    ]);

    // Construir mapa (asesorId → { asignados, gestionados, segmentos })
    const avanceMap = new Map();
    for (const row of detalleRows) {
      const aid  = Number(row.asignado_a);
      const seg  = String(row.seg ?? '').trim();
      const tot  = Number(row.total);
      const gest = Number(row.gestionados);
      if (!avanceMap.has(aid)) avanceMap.set(aid, { asignados: 0, gestionados: 0, segmentos: {} });
      const entry = avanceMap.get(aid);
      entry.asignados   += tot;
      entry.gestionados += gest;
      if (['0', '1', '2'].includes(seg)) {
        entry.segmentos[seg] = { total: tot, gestionados: gest, pct: tot > 0 ? Math.min(100, Math.round((gest / tot) * 10000) / 100) : 0 };
      }
    }

    // canalMap[asesorId][canal][seg] = count
    const canalMap = new Map();
    for (const row of canalRows) {
      const aid   = Number(row.usuario_id);
      const canal = String(row.canal);       // 'whatsapp' | 'rcs' | 'gmail'
      const seg   = String(row.seg ?? 'sin_seg').trim();
      const tot   = Number(row.total);
      if (!canalMap.has(aid)) canalMap.set(aid, {});
      const cm = canalMap.get(aid);
      if (!cm[canal]) cm[canal] = {};
      cm[canal][seg] = (cm[canal][seg] || 0) + tot;
    }

    // segActualMap[asesorId] = segmento_actual (del CDR más reciente hoy)
    const segActualMap = new Map();
    for (const row of segActualRows) {
      segActualMap.set(Number(row.usuario_id), row.segmento_actual ?? null);
    }

    // msgMap[asesorId] = { wsp, rcs, correo } enviados desde contactos
    const msgMap = new Map();
    for (const row of msgRows) {
      msgMap.set(Number(row.asignado_a), {
        wsp:    Number(row.wsp    || 0),
        rcs:    Number(row.rcs    || 0),
        correo: Number(row.correo || 0),
      });
    }

    // Mapa asesorId → ISO string de la primera gestión del día (naive-UTC Guayaquil)
    const primeraGestionMap = new Map(
      (primeraGestionRows || []).map(r => [
        r.usuarioId,
        r._min?.timestampInicio ? r._min.timestampInicio.toISOString() : null,
      ])
    );

    const tipMap = new Map(tipifs.map(t => [t.id, t]));
    const CAT_CANON = {
      'CONTACTO_EFECTIVO': 'CONTACTO EXITOSO',
      'CONTACTO EXITOSO':  'CONTACTO EXITOSO',
      'CONTACTO_NEUTRO':   'CONTACTO NEUTRO',
      'CONTACTO NEUTRO':   'CONTACTO NEUTRO',
      'NO_CONTACTADO':     'NO CONTACTADO',
      'NO CONTACTADO':     'NO CONTACTADO',
    };
    const categoriasVacias = () => ({
      'CONTACTO EXITOSO': { count: 0, tiempo_seg: 0 },
      'CONTACTO NEUTRO':  { count: 0, tiempo_seg: 0 },
      'NO CONTACTADO':    { count: 0, tiempo_seg: 0 },
    });

    const porAsesor = new Map(asesores.map(a => [a.id, {
      asesor_id: a.id,
      nombre: a.nombre,
      categorias: categoriasVacias(),
      detalle: [],
      total_count: 0,
      total_tiempo_seg: 0,
      total_asignados:          avanceMap.get(a.id)?.asignados   || 0,
      gestionados:              avanceMap.get(a.id)?.gestionados || 0,
      segmentos:                avanceMap.get(a.id)?.segmentos   || {},
      canales_apertura:         canalMap.get(a.id)    || {},
      segmento_actual_apertura: segActualMap.get(a.id) ?? null,
      msg_wsp:    msgMap.get(a.id)?.wsp    ?? 0,
      msg_rcs:    msgMap.get(a.id)?.rcs    ?? 0,
      msg_correo: msgMap.get(a.id)?.correo ?? 0,
      primera_gestion_ts: primeraGestionMap.get(a.id) || null,
    }]));

    for (const g of grupos) {
      const entry = porAsesor.get(g.usuarioId);
      if (!entry) continue;
      const count  = g._count._all;
      const tiempo = Number(g._sum.duracionSeg || 0);
      entry.total_count      += count;
      entry.total_tiempo_seg += tiempo;
      const tip = g.tipificacionId != null ? tipMap.get(g.tipificacionId) : null;
      if (!tip) continue;
      const cat = CAT_CANON[tip.categoria] || 'NO CONTACTADO';
      entry.categorias[cat].count      += count;
      entry.categorias[cat].tiempo_seg += tiempo;
      entry.detalle.push({
        codigo: tip.codigo,
        descripcion: tip.descripcion,
        categoria: cat,
        count,
        tiempo_seg: tiempo,
      });
    }

    const salida = [...porAsesor.values()];
    salida.forEach(a => a.detalle.sort((x, y) => y.count - x.count));

    // Totales globales derivados de avanceMap (ya calculados por la query única)
    const avanceArr   = [...avanceMap.values()];
    const globalTotal = avanceArr.reduce((s, x) => s + x.asignados,   0);
    const globalGest  = avanceArr.reduce((s, x) => s + x.gestionados, 0);
    // Agregar segmentos globales sumando sobre todos los asesores
    const segmentos = {};
    for (const entry of avanceArr) {
      for (const [seg, s] of Object.entries(entry.segmentos)) {
        if (!segmentos[seg]) segmentos[seg] = { total: 0, gestionados: 0, pct: 0 };
        segmentos[seg].total      += s.total;
        segmentos[seg].gestionados += s.gestionados;
      }
    }
    for (const s of Object.values(segmentos)) {
      s.pct = s.total > 0 ? Math.min(100, Math.round((s.gestionados / s.total) * 10000) / 100) : 0;
    }
    const avance_global = {
      total: globalTotal,
      gestionados: globalGest,
      pct: globalTotal > 0 ? Math.min(100, Math.round((globalGest / globalTotal) * 10000) / 100) : 0,
      segmentos,
    };

    res.json({ fecha: _gyeDayBounds(req.query.fecha).ymd, asesores: salida, avance_global });
  } catch (err) { next(err); }
});

// ── GET /api/metricas/:usuario_id — Métricas diarias de un asesor ────────────
// Helper extraído para reusar en /metricas-asesores-bulk sin duplicar lógica.
async function _calcMetricasAsesor(targetId, fechaStr, campanaIdInput) {
  const { inicio, fin, ymd } = _gyeDayBounds(fechaStr);
  const campanaId = campanaIdInput ? parseInt(campanaIdInput) : null;

  const segCase = Prisma.raw(`COALESCE(
    CASE WHEN c.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
    CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
    CASE WHEN c.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int END,
    0
  )`);

  const campFilter = campanaId
    ? Prisma.sql`AND c.campana_id = ${campanaId}`
    : Prisma.empty;

  const _segExpr = Prisma.raw(`CASE
    WHEN COALESCE(
      CASE WHEN c.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
      CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
      CASE WHEN c.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int END, 0
    ) >= 2 THEN 2
    WHEN COALESCE(
      CASE WHEN c.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
      CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
      CASE WHEN c.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int END, 0
    ) = 1 THEN 1 ELSE 0 END`);

  const [
    cdrAggRows,
    ctRows,
    agendados,
    tiemposEstado,
    aggRecaudadoRaw,
    msgDiaRows,
  ] = await Promise.all([
    // Query A: cdrs del día — LEFT JOIN reemplaza NOT EXISTS correlacionado
    db.$queryRaw`
      SELECT
        COUNT(*)::int AS cdrs_hoy,
        COUNT(*) FILTER (WHERE cd.tipificacion_id IS NOT NULL)::int AS con_tipif,
        COUNT(*) FILTER (WHERE ${segCase} = 0)::int AS s0,
        COUNT(*) FILTER (WHERE ${segCase} = 1)::int AS s1,
        COUNT(*) FILTER (WHERE ${segCase} >= 2)::int AS s2,
        COUNT(*) FILTER (WHERE cd.resultado = 'COMP_CUM')::int AS comp_cumpl,
        COUNT(*) FILTER (WHERE cd.resultado = 'REAG')::int   AS comp_reag,
        COUNT(*) FILTER (WHERE cd.resultado = 'INCUMP')::int AS comp_incump,
        COUNT(*) FILTER (WHERE t.categoria IN ('CONTACTO_EFECTIVO','CONTACTO EXITOSO'))::int AS efectivos,
        COUNT(*) FILTER (WHERE t.categoria IN ('CONTACTO_NEUTRO','CONTACTO NEUTRO'))::int   AS neutros,
        COUNT(*) FILTER (WHERE t.categoria IN ('NO_CONTACTADO','NO CONTACTADO'))::int       AS no_contact,
        COUNT(*) FILTER (WHERE t.codigo = 'PMP')::int AS pmp,
        COUNT(*) FILTER (WHERE t.codigo IN ('PMP','PAGO_REAL','AB_PARC','PEND_COMP') AND vp_hoy.contacto_id IS NULL)::int AS compromisos,
        COALESCE(SUM(cd.monto_acordado), 0)::float AS monto_comprometido
      FROM cdrs cd
      JOIN contactos c ON c.id = cd.contacto_id
      LEFT JOIN tipificaciones t ON t.id = cd.tipificacion_id
      LEFT JOIN (
        SELECT DISTINCT contacto_id FROM validacion_pagos
        WHERE validado_en >= ${inicio} AND validado_en <= ${fin}
      ) vp_hoy ON vp_hoy.contacto_id = cd.contacto_id
      WHERE cd.usuario_id = ${targetId}
        AND cd.timestamp_inicio >= ${inicio}
        AND cd.timestamp_inicio <= ${fin}
    `.catch(err => { console.error('[METRICAS_CDR_AGG]', err); return [{}]; }),

    // Query B: contactos — cartera + mensajería
    db.$queryRaw`
      SELECT
        COUNT(*) FILTER (WHERE c.estado_marcacion IN ('GESTIONADO','YA_PAGO'))::int AS gestionados,
        COUNT(*)::int AS total_asignados,
        COALESCE(SUM(c.monto_deuda), 0)::float AS mora_base,
        COUNT(*) FILTER (WHERE c.whatsapp_status = 'ENVIADO')::int AS wsp_env,
        COUNT(*) FILTER (WHERE c.rcs_status      = 'ENVIADO')::int AS rcs_env,
        COUNT(*) FILTER (WHERE c.correo_status   = 'ENVIADO')::int AS correo_env,
        COUNT(*) FILTER (WHERE c.whatsapp_status = 'ACTIVO')::int  AS wsp_act,
        COUNT(*) FILTER (WHERE c.rcs_status      = 'ACTIVO')::int  AS rcs_act,
        COUNT(*) FILTER (WHERE c.correo_status   = 'ACTIVO')::int  AS correo_act
      FROM contactos c
      WHERE c.asignado_a = ${targetId} ${campFilter}
    `.catch(err => { console.error('[METRICAS_CT_AGG]', err); return [{}]; }),

    // agendamiento
    db.agendamiento.count({ where: { asesorId: targetId, creadoEn: { gte: inicio, lte: fin } } }).catch(() => 0),

    // eventos de estado
    db.evento.groupBy({
      by: ['estadoId'],
      where: { usuarioId: targetId, tipo: 'ESTADO', timestamp: { gte: inicio, lte: fin }, duracionSeg: { not: null } },
      _sum: { duracionSeg: true },
    }).catch(err => { console.error('[EVENTO_GROUPBY]', err); return []; }),

    // monto recaudado
    db.$queryRaw`
      SELECT COALESCE(SUM(vp.monto_pagado), 0) AS total
      FROM validacion_pagos vp
      JOIN contactos c ON c.id = vp.contacto_id
      WHERE c.asignado_a = ${targetId}
    `.catch(() => [{ total: 0 }]),

    // mensajes enviados hoy por canal y segmento
    db.$queryRaw`
      SELECT canal, seg, COUNT(*)::int AS n FROM (
        SELECT 'wsp' AS canal, ${_segExpr} AS seg FROM contactos c WHERE c.asignado_a = ${targetId} ${campFilter} AND c.wsp_enviado_fecha = ${ymd}
        UNION ALL
        SELECT 'rcs', ${_segExpr} FROM contactos c WHERE c.asignado_a = ${targetId} ${campFilter} AND c.rcs_enviado_fecha = ${ymd}
        UNION ALL
        SELECT 'correo', ${_segExpr} FROM contactos c WHERE c.asignado_a = ${targetId} ${campFilter} AND c.correo_enviado_fecha = ${ymd}
      ) x GROUP BY canal, seg
    `.catch(() => []),
  ]);

  const A = cdrAggRows[0] || {};
  const cdrsHoy            = Number(A.cdrs_hoy)          || 0;
  const cdrsConTipifAsesor = Number(A.con_tipif)         || 0;
  const cdrS0 = Number(A.s0) || 0;
  const cdrS1 = Number(A.s1) || 0;
  const cdrS2 = Number(A.s2) || 0;
  const compCumpl  = Number(A.comp_cumpl)  || 0;
  const compReag   = Number(A.comp_reag)   || 0;
  const compIncump = Number(A.comp_incump) || 0;
  const cdrsEfectivos     = Number(A.efectivos)         || 0;
  const cdrsNeutros       = Number(A.neutros)           || 0;
  const cdrsNoContactados = Number(A.no_contact)        || 0;
  const pmpHoy            = Number(A.pmp)               || 0;
  const cdrsConTipif      = Number(A.compromisos)       || 0;
  const montoComprometido = Number(A.monto_comprometido) || 0;

  const B = ctRows[0] || {};
  const gestionados    = Number(B.gestionados)     || 0;
  const totalAsignados = Number(B.total_asignados) || 0;
  const moraTotalBase  = Number(B.mora_base)       || 0;
  const wspEnv       = Number(B.wsp_env)    || 0;
  const rcsEnv       = Number(B.rcs_env)    || 0;
  const correoEnv    = Number(B.correo_env) || 0;
  const wspActivo    = Number(B.wsp_act)    || 0;
  const rcsActivo    = Number(B.rcs_act)    || 0;
  const correoActivo = Number(B.correo_act) || 0;

  const tiempoAlAire = Number(tiemposEstado.find(e => e.estadoId === 1)?._sum?.duracionSeg || 0);
  const tiempoMuerto = tiemposEstado
    .filter(e => e.estadoId !== 1)
    .reduce((acc, e) => acc + Number(e._sum?.duracionSeg || 0), 0);
  const montoRecaudado = Number(aggRecaudadoRaw[0]?.total || 0);

  const msgDia = { wsp: { total: 0, 0: 0, 1: 0, 2: 0 }, rcs: { total: 0, 0: 0, 1: 0, 2: 0 }, correo: { total: 0, 0: 0, 1: 0, 2: 0 } };
  for (const r of msgDiaRows) {
    const canal = r.canal, seg = Number(r.seg), n = Number(r.n);
    if (msgDia[canal] && (seg === 0 || seg === 1 || seg === 2)) { msgDia[canal][seg] += n; msgDia[canal].total += n; }
  }

  return {
    usuario_id: targetId,
    fecha: inicio.toISOString().slice(0, 10),
    marcaciones: cdrsHoy,
    total_marcaciones: cdrsHoy,
    cdrs_total: cdrsConTipifAsesor,
    agendados,
    gestionados,
    total_asignados:   totalAsignados,
    gestionados_base:  gestionados,
    monto_comprometido: montoComprometido,
    monto_recaudado:    montoRecaudado,
    mora_total_base:    moraTotalBase,
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
    promesas_pago:           pmpHoy,
    compromisos_cumplidos:   compCumpl,
    compromisos_reagendados: compReag,
    compromisos_incumplidos: compIncump,
    marcaciones_detalle: [cdrS0, cdrS1, cdrS2],
    contactos_efectivos:  cdrsEfectivos,
    cdrs_neutros:         cdrsNeutros,
    cdrs_no_contactados:  cdrsNoContactados,
    cdrs_sin_tipificar:   cdrsHoy - cdrsConTipifAsesor,
    msg_dia: msgDia,
  };
}

router.get('/metricas/:usuario_id', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.usuario_id);
    if (req.user.rol === 'asesor' && req.user.id !== targetId) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }
    const ck = `metricas:${targetId}:${req.query.fecha || 'hoy'}:${req.query.campanaId || ''}`;
    const hit = cache.get(ck);
    if (hit) return res.json(hit);
    const data = await _calcMetricasAsesor(targetId, req.query.fecha, req.query.campanaId);
    cache.set(ck, data, 30_000);
    res.json(data);
  } catch (err) { next(err); }
});

// ── GET /api/metricas-asesores-bulk — Métricas del día de todos los asesores ──
// Camino rápido: 6 queries agrupadas (GROUP BY usuario_id) para TODO el equipo,
// en vez de ~6 × N por asesor. Con ?campanaId cae al cálculo por asesor (el filtro
// de mensajería por campaña no es agrupable con el mismo shape).
router.get('/metricas-asesores-bulk', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;
    const asesores = await db.usuario.findMany({
      where: whereU,
      select: { id: true, nombre: true, email: true, rol: true, supervisorId: true },
      orderBy: { nombre: 'asc' },
    });
    const salidaAsesores = asesores.map(a => ({ ...a, conectado: false }));
    if (asesores.length === 0) return res.json({ asesores: salidaAsesores, metricas: {} });

    if (req.query.campanaId) {
      const metricasArr = await Promise.all(
        asesores.map(a => _calcMetricasAsesor(a.id, req.query.fecha, req.query.campanaId))
      );
      const metricas = Object.fromEntries(metricasArr.map(m => [m.usuario_id, m]));
      return res.json({ asesores: salidaAsesores, metricas });
    }

    const ids = asesores.map(a => a.id);
    const { inicio, fin, ymd } = _gyeDayBounds(req.query.fecha);
    const fechaOut = inicio.toISOString().slice(0, 10);

    const segCase = Prisma.raw(`COALESCE(
      CASE WHEN c.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
      CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
      CASE WHEN c.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int END,
      0
    )`);
    const segMsg = Prisma.raw(`CASE
      WHEN COALESCE(
        CASE WHEN c.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
        CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
        CASE WHEN c.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int END, 0
      ) >= 2 THEN 2
      WHEN COALESCE(
        CASE WHEN c.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
        CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
        CASE WHEN c.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int END, 0
      ) = 1 THEN 1 ELSE 0 END`);

    const [cdrRows, ctRows, agdRows, evRows, recRows, msgDiaRows] = await Promise.all([
      db.$queryRaw`
        SELECT cd.usuario_id,
          COUNT(*)::int AS cdrs_hoy,
          COUNT(*) FILTER (WHERE cd.tipificacion_id IS NOT NULL)::int AS con_tipif,
          COUNT(*) FILTER (WHERE ${segCase} = 0)::int AS s0,
          COUNT(*) FILTER (WHERE ${segCase} = 1)::int AS s1,
          COUNT(*) FILTER (WHERE ${segCase} >= 2)::int AS s2,
          COUNT(*) FILTER (WHERE cd.resultado = 'COMP_CUM')::int AS comp_cumpl,
          COUNT(*) FILTER (WHERE cd.resultado = 'REAG')::int   AS comp_reag,
          COUNT(*) FILTER (WHERE cd.resultado = 'INCUMP')::int AS comp_incump,
          COUNT(*) FILTER (WHERE t.categoria IN ('CONTACTO_EFECTIVO','CONTACTO EXITOSO'))::int AS efectivos,
          COUNT(*) FILTER (WHERE t.categoria IN ('CONTACTO_NEUTRO','CONTACTO NEUTRO'))::int   AS neutros,
          COUNT(*) FILTER (WHERE t.categoria IN ('NO_CONTACTADO','NO CONTACTADO'))::int       AS no_contact,
          COUNT(*) FILTER (WHERE t.codigo = 'PMP')::int AS pmp,
          COUNT(*) FILTER (WHERE t.codigo IN ('PMP','PAGO_REAL','AB_PARC','PEND_COMP')
            AND NOT EXISTS (
              SELECT 1 FROM validacion_pagos vp
              WHERE vp.contacto_id = cd.contacto_id
                AND vp.validado_en >= ${inicio} AND vp.validado_en <= ${fin}
            ))::int AS compromisos,
          COALESCE(SUM(cd.monto_acordado), 0)::float AS monto_comprometido
        FROM cdrs cd
        JOIN contactos c ON c.id = cd.contacto_id
        LEFT JOIN tipificaciones t ON t.id = cd.tipificacion_id
        WHERE cd.usuario_id = ANY(${ids})
          AND cd.timestamp_inicio >= ${inicio}
          AND cd.timestamp_inicio <= ${fin}
        GROUP BY cd.usuario_id
      `.catch(err => { console.error('[BULK_CDR_AGG]', err); return []; }),
      db.$queryRaw`
        SELECT c.asignado_a,
          COUNT(*) FILTER (WHERE c.estado_marcacion IN ('GESTIONADO','YA_PAGO'))::int AS gestionados,
          COUNT(*)::int AS total_asignados,
          COALESCE(SUM(c.monto_deuda), 0)::float AS mora_base,
          COUNT(*) FILTER (WHERE c.whatsapp_status = 'ENVIADO')::int AS wsp_env,
          COUNT(*) FILTER (WHERE c.rcs_status      = 'ENVIADO')::int AS rcs_env,
          COUNT(*) FILTER (WHERE c.correo_status   = 'ENVIADO')::int AS correo_env,
          COUNT(*) FILTER (WHERE c.whatsapp_status = 'ACTIVO')::int  AS wsp_act,
          COUNT(*) FILTER (WHERE c.rcs_status      = 'ACTIVO')::int  AS rcs_act,
          COUNT(*) FILTER (WHERE c.correo_status   = 'ACTIVO')::int  AS correo_act
        FROM contactos c
        WHERE c.asignado_a = ANY(${ids})
        GROUP BY c.asignado_a
      `.catch(err => { console.error('[BULK_CT_AGG]', err); return []; }),
      db.agendamiento.groupBy({
        by: ['asesorId'],
        where: { asesorId: { in: ids }, creadoEn: { gte: inicio, lte: fin } },
        _count: { _all: true },
      }).catch(() => []),
      db.evento.groupBy({
        by: ['usuarioId', 'estadoId'],
        where: { usuarioId: { in: ids }, tipo: 'ESTADO', timestamp: { gte: inicio, lte: fin }, duracionSeg: { not: null } },
        _sum: { duracionSeg: true },
      }).catch(err => { console.error('[BULK_EVENTO_GROUPBY]', err); return []; }),
      db.$queryRaw`
        SELECT c.asignado_a, COALESCE(SUM(vp.monto_pagado), 0)::float AS total
        FROM validacion_pagos vp
        JOIN contactos c ON c.id = vp.contacto_id
        WHERE c.asignado_a = ANY(${ids})
        GROUP BY c.asignado_a
      `.catch(() => []),
      db.$queryRaw`
        SELECT asignado_a, canal, seg, COUNT(*)::int AS n FROM (
          SELECT c.asignado_a, 'wsp' AS canal, ${segMsg} AS seg FROM contactos c WHERE c.asignado_a = ANY(${ids}) AND c.wsp_enviado_fecha = ${ymd}
          UNION ALL
          SELECT c.asignado_a, 'rcs', ${segMsg} FROM contactos c WHERE c.asignado_a = ANY(${ids}) AND c.rcs_enviado_fecha = ${ymd}
          UNION ALL
          SELECT c.asignado_a, 'correo', ${segMsg} FROM contactos c WHERE c.asignado_a = ANY(${ids}) AND c.correo_enviado_fecha = ${ymd}
        ) x GROUP BY asignado_a, canal, seg
      `.catch(() => []),
    ]);

    const cdrBy = Object.fromEntries(cdrRows.map(r => [Number(r.usuario_id), r]));
    const ctBy  = Object.fromEntries(ctRows.map(r => [Number(r.asignado_a), r]));
    const agdBy = Object.fromEntries(agdRows.map(r => [r.asesorId, r._count._all]));
    const recBy = Object.fromEntries(recRows.map(r => [Number(r.asignado_a), Number(r.total) || 0]));
    const evBy = {};
    for (const e of evRows) {
      const uid = e.usuarioId;
      if (!evBy[uid]) evBy[uid] = { aire: 0, muerto: 0 };
      const seg = Number(e._sum?.duracionSeg || 0);
      if (e.estadoId === 1) evBy[uid].aire += seg; else evBy[uid].muerto += seg;
    }
    const msgBy = {};
    for (const r of msgDiaRows) {
      const uid = Number(r.asignado_a);
      if (!msgBy[uid]) msgBy[uid] = { wsp: { total: 0, 0: 0, 1: 0, 2: 0 }, rcs: { total: 0, 0: 0, 1: 0, 2: 0 }, correo: { total: 0, 0: 0, 1: 0, 2: 0 } };
      const canal = r.canal, seg = Number(r.seg), n = Number(r.n);
      if (msgBy[uid][canal] && (seg === 0 || seg === 1 || seg === 2)) { msgBy[uid][canal][seg] += n; msgBy[uid][canal].total += n; }
    }

    const metricas = {};
    for (const a of asesores) {
      const A = cdrBy[a.id] || {};
      const B = ctBy[a.id] || {};
      const ev = evBy[a.id] || { aire: 0, muerto: 0 };
      const cdrsHoy = Number(A.cdrs_hoy) || 0;
      const conTipif = Number(A.con_tipif) || 0;
      const wspEnv = Number(B.wsp_env) || 0, rcsEnv = Number(B.rcs_env) || 0, correoEnv = Number(B.correo_env) || 0;
      metricas[a.id] = {
        usuario_id: a.id,
        fecha: fechaOut,
        marcaciones: cdrsHoy,
        total_marcaciones: cdrsHoy,
        cdrs_total: conTipif,
        agendados: agdBy[a.id] || 0,
        gestionados: Number(B.gestionados) || 0,
        total_asignados:   Number(B.total_asignados) || 0,
        gestionados_base:  Number(B.gestionados) || 0,
        monto_comprometido: Number(A.monto_comprometido) || 0,
        monto_recaudado:    recBy[a.id] || 0,
        mora_total_base:    Number(B.mora_base) || 0,
        conectado: false,
        tiempo_al_aire: ev.aire,
        tiempo_muerto:  ev.muerto,
        wsp_enviados:     wspEnv,
        sms_enviados:     rcsEnv,
        correos_enviados: correoEnv,
        wsp_detalle:      [wspEnv,    Number(B.wsp_act) || 0,    0],
        sms_detalle:      [rcsEnv,    Number(B.rcs_act) || 0,    0],
        email_detalle:    [correoEnv, Number(B.correo_act) || 0, 0],
        total_compromisos:       Number(A.compromisos) || 0,
        promesas_pago:           Number(A.pmp) || 0,
        compromisos_cumplidos:   Number(A.comp_cumpl) || 0,
        compromisos_reagendados: Number(A.comp_reag) || 0,
        compromisos_incumplidos: Number(A.comp_incump) || 0,
        marcaciones_detalle: [Number(A.s0) || 0, Number(A.s1) || 0, Number(A.s2) || 0],
        contactos_efectivos:  Number(A.efectivos) || 0,
        cdrs_neutros:         Number(A.neutros) || 0,
        cdrs_no_contactados:  Number(A.no_contact) || 0,
        cdrs_sin_tipificar:   cdrsHoy - conTipif,
        msg_dia: msgBy[a.id] || { wsp: { total: 0, 0: 0, 1: 0, 2: 0 }, rcs: { total: 0, 0: 0, 1: 0, 2: 0 }, correo: { total: 0, 0: 0, 1: 0, 2: 0 } },
      };
    }
    res.json({ asesores: salidaAsesores, metricas });
  } catch (err) { next(err); }
});

// ── GET /api/metricas-campana/:campanaId — Métricas ACUMULADAS de una apertura ──
// Total de gestiones/compromisos/mensajería de una campaña (apertura), SIN límite
// de fecha: suma histórica sobre los contactos de esa campaña. Estable — no cambia
// al pasar los días. Por defecto scoped al asesor autenticado; supervisor puede
// pasar ?usuario_id=. Sirve para revisar cualquier apertura cuando sea, sin perder
// nada. Ver requerimiento: "nada se debe mover de esas aperturas".
router.get('/metricas-campana/:campanaId', async (req, res, next) => {
  try {
    const campanaId = parseInt(req.params.campanaId);
    if (!campanaId || isNaN(campanaId)) return res.status(400).json({ error: 'campanaId inválido' });
    const ck = `metricas-campana:${campanaId}:${req.user.id}:${req.query.usuario_id || ''}`;
    const hit = cache.get(ck);
    if (hit) return res.json(hit);
    // asesor → solo su propia data; supervisor → puede especificar usuario_id (o todos)
    let targetId = req.user.id;
    if (req.user.rol !== 'asesor') {
      targetId = req.query.usuario_id ? parseInt(req.query.usuario_id) : null; // null = todos
    }
    const scopeAsesor = targetId != null;

    // Agregados de CDR (gestiones/compromisos/resultados) — acumulado, sin fecha.
    const userFilterCdr = scopeAsesor ? Prisma.sql`AND cd.usuario_id = ${targetId}` : Prisma.empty;
    const cdrAgg = await db.$queryRaw`
      SELECT
        COUNT(*)::int AS marcaciones,
        COUNT(*) FILTER (WHERE cd.tipificacion_id IS NOT NULL)::int AS gestiones,
        COUNT(*) FILTER (WHERE t.codigo IN ('PMP','PAGO_REAL','AB_PARC','PEND_COMP'))::int AS compromisos,
        COUNT(*) FILTER (WHERE cd.resultado = 'COMP_CUM')::int AS cumplidos,
        COUNT(*) FILTER (WHERE cd.resultado = 'REAG')::int    AS reagendados,
        COUNT(*) FILTER (WHERE cd.resultado = 'INCUMP')::int  AS incumplidos
      FROM cdrs cd
      JOIN contactos c ON c.id = cd.contacto_id
      LEFT JOIN tipificaciones t ON t.id = cd.tipificacion_id
      WHERE c.campana_id = ${campanaId} ${userFilterCdr}
    `.catch(() => [{}]);
    const agg = cdrAgg[0] || {};

    // Mensajería acumulada (contactos con *_enviado_fecha no nulo), bucketeada S0/S1/S2.
    const _segExpr = Prisma.raw(`CASE
      WHEN COALESCE(
        CASE WHEN c.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
        CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
        CASE WHEN c.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int END, 0
      ) >= 2 THEN 2
      WHEN COALESCE(
        CASE WHEN c.metadata->>'DIAS IMPAGO'  ~ '^[0-9]+$' THEN (c.metadata->>'DIAS IMPAGO')::int END,
        CASE WHEN c.metadata->>'DIAS EN MORA' ~ '^[0-9]+$' THEN (c.metadata->>'DIAS EN MORA')::int END,
        CASE WHEN c.metadata->>'DIAS MORA'    ~ '^[0-9]+$' THEN (c.metadata->>'DIAS MORA')::int END, 0
      ) = 1 THEN 1 ELSE 0 END`);
    const userFilterMsg = scopeAsesor ? Prisma.sql`AND c.asignado_a = ${targetId}` : Prisma.empty;
    const msgRows = await db.$queryRaw`
      SELECT canal, seg, COUNT(*)::int AS n FROM (
        SELECT 'wsp' AS canal, ${_segExpr} AS seg FROM contactos c WHERE c.campana_id = ${campanaId} ${userFilterMsg} AND c.wsp_enviado_fecha IS NOT NULL
        UNION ALL
        SELECT 'rcs', ${_segExpr} FROM contactos c WHERE c.campana_id = ${campanaId} ${userFilterMsg} AND c.rcs_enviado_fecha IS NOT NULL
        UNION ALL
        SELECT 'correo', ${_segExpr} FROM contactos c WHERE c.campana_id = ${campanaId} ${userFilterMsg} AND c.correo_enviado_fecha IS NOT NULL
      ) x GROUP BY canal, seg
    `.catch(() => []);
    const msg = { wsp: { total: 0, 0: 0, 1: 0, 2: 0 }, rcs: { total: 0, 0: 0, 1: 0, 2: 0 }, correo: { total: 0, 0: 0, 1: 0, 2: 0 } };
    for (const r of msgRows) {
      const canal = r.canal, seg = Number(r.seg), n = Number(r.n);
      if (msg[canal] && (seg === 0 || seg === 1 || seg === 2)) { msg[canal][seg] += n; msg[canal].total += n; }
    }

    // Registros de la apertura + fecha de asignación
    const userFilterInfo = scopeAsesor ? Prisma.sql`AND c.asignado_a = ${targetId}` : Prisma.empty;
    const info = await db.$queryRaw`
      SELECT COUNT(*)::int AS registros, MIN(fecha_asignacion) AS asignada
      FROM contactos c WHERE c.campana_id = ${campanaId} ${userFilterInfo}
    `.catch(() => [{}]);
    const camp = await db.campana.findUnique({ where: { id: campanaId }, select: { nombre: true } }).catch(() => null);

    // Monto real recaudado: suma de validacion_pagos.monto_pagado filtrado por campaña (y asesor si aplica)
    const userFilterVp = scopeAsesor ? Prisma.sql`AND c.asignado_a = ${targetId}` : Prisma.empty;
    const vpRows = await db.$queryRaw`
      SELECT COALESCE(SUM(vp.monto_pagado), 0)::float AS total
      FROM validacion_pagos vp
      JOIN contactos c ON c.id = vp.contacto_id
      WHERE c.campana_id = ${campanaId} ${userFilterVp}
    `.catch(() => [{ total: 0 }]);
    const montoRecaudado = Number(vpRows[0]?.total || 0);

    const result = {
      campana_id: campanaId,
      campana_nombre: camp?.nombre || null,
      usuario_id: targetId,
      registros: Number(info[0]?.registros || 0),
      fecha_asignacion: info[0]?.asignada ? new Date(info[0].asignada).toISOString().slice(0, 10) : null,
      marcaciones:       Number(agg.marcaciones || 0),
      cdrs_total:        Number(agg.gestiones || 0),
      total_compromisos: Number(agg.compromisos || 0),
      compromisos_cumplidos:   Number(agg.cumplidos || 0),
      compromisos_reagendados: Number(agg.reagendados || 0),
      compromisos_incumplidos: Number(agg.incumplidos || 0),
      msg_acumulado: msg,
      monto_recaudado: montoRecaudado,
    };
    cache.set(ck, result, 30_000);
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/metricas-equipo — Métricas agregadas del equipo ─────────────────
router.get('/metricas-equipo', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });

    const { inicio, fin } = _gyeDayBounds(req.query.fecha);

    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;

    const asesores = await db.usuario.findMany({ where: whereU, select: { id: true, nombre: true } });
    const asesorIds = asesores.map(a => a.id);

    // 10 queries paralelas + 1 groupBy → 2 queries SQL con agregación condicional
    const [[cdrAgg], [ctAgg]] = await Promise.all([
      asesorIds.length > 0 ? db.$queryRaw`
        SELECT
          COUNT(*)::int                                                              AS total,
          COUNT(cd.tipificacion_id)::int                                             AS con_tipif,
          COUNT(*) FILTER (WHERE t.categoria IN ('CONTACTO_EFECTIVO','CONTACTO EXITOSO'))::int AS efectivos,
          COUNT(*) FILTER (WHERE t.categoria IN ('CONTACTO_NEUTRO','CONTACTO NEUTRO'))::int    AS neutros,
          COUNT(*) FILTER (WHERE t.categoria IN ('NO_CONTACTADO','NO CONTACTADO'))::int        AS no_contact,
          COUNT(*) FILTER (WHERE cd.resultado IN ('PAGO_REAL','COMP_CUM'))::int                AS pagos_resultado,
          COALESCE(SUM(cd.monto_acordado) FILTER (WHERE cd.resultado IN ('PAGO_REAL','COMP_CUM')), 0)::float AS monto_recaudado,
          COUNT(*) FILTER (WHERE t.codigo IN ('PMP','PAGO_REAL','AB_PARC','PEND_COMP'))::int   AS compromisos
        FROM cdrs cd
        LEFT JOIN tipificaciones t ON t.id = cd.tipificacion_id
        WHERE cd.usuario_id = ANY(${asesorIds}::int[])
          AND cd.timestamp_inicio >= ${inicio}
          AND cd.timestamp_inicio <= ${fin}
      ` : [{ total:0, con_tipif:0, efectivos:0, neutros:0, no_contact:0, pagos_resultado:0, monto_recaudado:0, compromisos:0 }],
      asesorIds.length > 0 ? db.$queryRaw`
        SELECT
          COUNT(*) FILTER (WHERE estado_marcacion = 'GESTIONADO')::int AS gestionados,
          COUNT(*) FILTER (WHERE ya_pago = true)::int                  AS pagados,
          COALESCE(SUM(monto_deuda), 0)::float                         AS mora_base
        FROM contactos
        WHERE asignado_a = ANY(${asesorIds}::int[])
      ` : [{ gestionados:0, pagados:0, mora_base:0 }],
    ]);

    // marcaciones por asesor (para la tabla del panel)
    const cdrsByAsesor = asesorIds.length > 0 ? await db.$queryRaw`
      SELECT usuario_id, COUNT(*)::int AS total
      FROM cdrs
      WHERE usuario_id = ANY(${asesorIds}::int[])
        AND timestamp_inicio >= ${inicio}
        AND timestamp_inicio <= ${fin}
      GROUP BY usuario_id
    ` : [];
    const marcByU = Object.fromEntries(cdrsByAsesor.map(r => [Number(r.usuario_id), Number(r.total)]));
    const porAsesor = asesores.map(a => ({ asesor_id: a.id, nombre: a.nombre, marcaciones: marcByU[a.id] || 0 }));

    const cdrs        = Number(cdrAgg.total);
    const cdrsConTipif = Number(cdrAgg.con_tipif);
    const efectivos   = Number(cdrAgg.efectivos);
    const neutros     = Number(cdrAgg.neutros);
    const noContact   = Number(cdrAgg.no_contact);
    const compromisos = Number(cdrAgg.compromisos);
    const gestionados = Number(ctAgg.gestionados);
    const pagados     = Number(ctAgg.pagados);

    const connStats = getConnectedStats();
    // Filtrar solo asesores bajo este supervisor si no es admin
    const asesorIdSet = new Set(asesorIds);
    const connAsesores = req.user.rol !== 'admin'
      ? connStats.asesores.filter(a => asesorIdSet.has(a.asesor_id))
      : connStats.asesores;

    res.json({
      total_marcaciones: cdrs, gestionados, pagados, asesores: porAsesor,
      marcacionesTotales:      cdrs,
      cdrsTotalEquipo:         cdrsConTipif,
      contactosEfectivosTotal: efectivos,
      cdrsNeutrosTotal:        neutros,
      cdrsNoContactadosTotal:  noContact,
      montoRecaudadoTotal:     Number(cdrAgg.monto_recaudado || 0),
      totalCompromisosEquipo:  compromisos,
      moraBaseTotal:           Number(ctAgg.mora_base || 0),
      totalConectados:         connAsesores.length,
    });
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
router.post('/config', requireRole('jefe_area', 'admin'), async (req, res, next) => {
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
router.get('/cartera-equipo', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    // Scoped a los asesores del equipo del supervisor
    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;
    const asesorRows = await db.usuario.findMany({ where: whereU, select: { id: true } });
    const asesorIds = asesorRows.map(a => a.id);
    if (!asesorIds.length) return res.json([]);

    // CTE con DISTINCT ON reemplaza la subquery correlated por contacto (128K→1 query)
    const rows = await db.$queryRaw`
      WITH ultima_gestion AS (
        SELECT DISTINCT ON (c.contacto_id)
          c.contacto_id,
          t.descripcion AS ultima_tipificacion
        FROM cdrs c
        LEFT JOIN tipificaciones t ON t.id = c.tipificacion_id
        WHERE c.usuario_id = ANY(${asesorIds})
        ORDER BY c.contacto_id, c.id DESC
      ),
      gestiones_hoy AS (
        SELECT c.contacto_id, COUNT(*)::int AS gcount
        FROM cdrs c
        WHERE c.usuario_id = ANY(${asesorIds})
          AND c.timestamp_inicio::date = CURRENT_DATE
        GROUP BY c.contacto_id
      )
      SELECT
        ct.id,
        ct.cedula,
        ct.nombre_deudor,
        ct.telefono,
        CAST(ct.monto_deuda AS DOUBLE PRECISION) AS monto_deuda,
        ct.producto,
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
        COALESCE(gh.gcount, 0)::int AS gestiones_count,
        ug.ultima_tipificacion
      FROM contactos ct
      LEFT JOIN usuarios u        ON ct.asignado_a = u.id
      LEFT JOIN campanas cmp      ON ct.campana_id  = cmp.id
      LEFT JOIN ultima_gestion ug ON ug.contacto_id = ct.id
      LEFT JOIN gestiones_hoy gh  ON gh.contacto_id = ct.id
      WHERE ct.asignado_a = ANY(${asesorIds})
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
router.post('/cartera/reordenar', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { asesorId, contactoIdsEnOrden } = req.body;
    if (!asesorId || !Array.isArray(contactoIdsEnOrden)) {
      return res.status(400).json({ error: 'asesorId y contactoIdsEnOrden[] requeridos' });
    }
    const ids     = contactoIdsEnOrden.map(id => Number(id));
    const ordenes = contactoIdsEnOrden.map((_, i) => i + 1);
    const affected = await db.$executeRaw`
      UPDATE contactos AS co
      SET orden_marcacion = v.orden
      FROM (
        SELECT UNNEST(${ids}::int[]) AS id,
               UNNEST(${ordenes}::int[]) AS orden
      ) v
      WHERE co.id = v.id
        AND co.asignado_a = ${parseInt(asesorId)}
    `;
    res.json({ ok: true, updated: Number(affected) });
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

// ── GET /api/validacion/historial — Historial real desde validacion_pagos ─────
router.get('/validacion/historial', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    let teamFilter = Prisma.empty;
    if (req.user.rol !== 'admin') {
      const ids = await getAsesorIdsDelEquipo(req.user);
      if (ids && ids.length) teamFilter = Prisma.sql`AND ct.asignado_a IN (${Prisma.join(ids)})`;
    }
    const rows = await db.$queryRaw(Prisma.sql`
      SELECT vp.id, vp.sesion_id, vp.contacto_id, vp.nombre_deudor, vp.cedula, vp.contrato,
             vp.empresa, vp.campana_nombre, vp.asesor_nombre, vp.estado_pago,
             vp.valor_en_mora, vp.monto_pagado, vp.validado_en,
             u.nombre AS validado_por_nombre
      FROM validacion_pagos vp
      LEFT JOIN usuarios u ON vp.validado_por = u.id
      LEFT JOIN contactos ct ON vp.contacto_id = ct.id
      WHERE 1=1 ${teamFilter}
      ORDER BY vp.validado_en DESC
      LIMIT 500
    `);
    res.json(rows.map(r => ({
      ...r,
      valor_en_mora: r.valor_en_mora != null ? Number(r.valor_en_mora) : 0,
      monto_pagado:  r.monto_pagado  != null ? Number(r.monto_pagado)  : 0,
    })));
  } catch (err) { next(err); }
});

// ── GET /api/validacion/sesiones ──────────────────────────────────────────────
router.get('/validacion/sesiones', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const rows = await db.$queryRaw`
      SELECT vs.id, vs.creado_en, vs.n_pagado, vs.n_excedente, vs.n_abono,
             vs.monto_real, vs.monto_abono, vs.registros, u.nombre AS supervisor_nombre
      FROM validacion_sesiones vs
      LEFT JOIN usuarios u ON vs.supervisor_id = u.id
      ORDER BY vs.creado_en DESC
      LIMIT 50
    `;
    res.json(rows.map(r => ({
      ...r,
      monto_real:  Number(r.monto_real  || 0),
      monto_abono: Number(r.monto_abono || 0),
    })));
  } catch (err) { next(err); }
});

// ── GET /api/validacion/metricas — Métricas de recuperación de cartera ────────
router.get('/validacion/metricas', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const contactoWhere = {};
    const sesionWhere = {};
    if (req.user.rol !== 'admin') {
      const ids = await getAsesorIdsDelEquipo(req.user);
      if (ids) contactoWhere.asignadoA = { in: ids };
      sesionWhere.supervisor_id = req.user.id;
    }

    const [contratosSaldados, moraAgg, sesionesAgg, porEmpresaRows] = await Promise.all([
      db.contacto.count({ where: { ...contactoWhere, yaPago: true } }),
      db.contacto.aggregate({ _sum: { montoDeuda: true }, where: contactoWhere }),
      db.validacion_sesiones.aggregate({
        _sum: { monto_real: true, n_excedente: true },
        where: sesionWhere,
      }),
      db.validacion_pagos.groupBy({
        by: ['empresa'],
        _sum: { monto_pagado: true },
        where: { empresa: { not: null }, ...(req.user.rol !== 'admin' ? { validado_por: req.user.id } : {}) },
      }),
    ]);

    const montoValidado      = Number(sesionesAgg._sum.monto_real   || 0);
    const moraBase           = Number(moraAgg._sum.montoDeuda        || 0);
    const excedentesCount    = Number(sesionesAgg._sum.n_excedente   || 0);
    const tasaRecuperacion   = moraBase > 0
      ? Math.round((montoValidado / moraBase) * 10000) / 100 : 0;

    res.json({
      contratosSaldados,
      montoValidado,
      tasaRecuperacion,
      moraBase,
      excedentesCount,
      montoExcedente: 0,
      porEmpresa: porEmpresaRows
        .filter(r => r.empresa)
        .map(r => ({ empresa: r.empresa, monto: Number(r._sum.monto_pagado || 0) }))
        .sort((a, b) => b.monto - a.monto),
    });
  } catch (err) { next(err); }
});

// ── POST /api/validacion/correlacionar — Cruce por Nº CONTRATO ────────────────
// Agrupa los pagos del reporte de cuotas por contrato y los cruza contra el
// metadata."Nº CONTRATO" de los contactos. Devuelve la shape rica que espera
// ValidacionPagos.jsx: { matches[], totalContratos, totalMatches }.
router.post('/validacion/correlacionar', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { pagosData = [], opts = {} } = req.body;
    const { asesorId = null, fecha = null, campanaId = null } = opts;

    const norm = (s) => String(s ?? '').replace(/\D/g, '').trim();
    const porContrato = new Map();
    for (const p of pagosData) {
      const key = norm(p.contrato);
      if (!key) continue;
      if (!porContrato.has(key)) {
        porContrato.set(key, {
          contrato: key, cedula: p.cedula, nombreCliente: p.nombreCliente,
          empresa: p.empresa, montoPagadoTotal: 0, ultimaFecha: p.fechaPago, cuotas: 0,
        });
      }
      const e = porContrato.get(key);
      e.montoPagadoTotal += parseFloat(p.montoPagado) || 0;
      e.cuotas++;
      if ((p.fechaPago || '') > (e.ultimaFecha || '')) e.ultimaFecha = p.fechaPago;
    }

    const contratos = [...porContrato.keys()];
    if (!contratos.length) return res.json({ matches: [], totalContratos: 0, totalMatches: 0 });

    const extra = [];
    if (asesorId)  extra.push(Prisma.sql`AND ct.asignado_a = ${Number(asesorId)}`);
    if (campanaId) extra.push(Prisma.sql`AND ct.campana_id = ${Number(campanaId)}`);
    if (fecha)     extra.push(Prisma.sql`AND DATE(ct.fecha_asignacion) = ${fecha}::date`);
    if (req.user.rol !== 'admin') {
      const teamIds = await getAsesorIdsDelEquipo(req.user);
      if (teamIds && teamIds.length) extra.push(Prisma.sql`AND ct.asignado_a IN (${Prisma.join(teamIds)})`);
    }
    const extraWhere = extra.length ? Prisma.join(extra, ' ') : Prisma.empty;
    const contractList = Prisma.join(contratos.map(c => Prisma.sql`${c}`));

    // Se normaliza a solo-dígitos en SQL para tolerar formatos ('123.0', espacios, etc.).
    const rows = await db.$queryRaw(Prisma.sql`
      SELECT ct.id, ct.nombre_deudor, ct.cedula, ct.ya_pago, ct.campana_id, ct.asignado_a,
             ct.metadata, ct.monto_deuda,
             c.nombre AS campana_nombre, u.nombre AS asesor_nombre,
             regexp_replace(COALESCE(ct.metadata->>'Nº CONTRATO',''), '\\D', '', 'g') AS contrato_norm
      FROM contactos ct
      JOIN campanas c ON ct.campana_id = c.id
      LEFT JOIN usuarios u ON ct.asignado_a = u.id
      WHERE regexp_replace(COALESCE(ct.metadata->>'Nº CONTRATO',''), '\\D', '', 'g') IN (${contractList})
      ${extraWhere}
    `);

    const matches = [];
    for (const row of rows) {
      const pago = porContrato.get(String(row.contrato_norm));
      if (!pago) continue;
      const meta = row.metadata || {};
      const moraRaw = meta['VALOR EN MORA'] ?? meta['MONTO POR COBRAR'] ?? '';
      const moraMeta = parseFloat(String(moraRaw).replace(/[^0-9.-]/g, ''));
      const montoDeuda = row.monto_deuda != null ? Number(row.monto_deuda) : 0;
      const valorEnMora = (!isNaN(moraMeta) && moraMeta > 0) ? moraMeta : (montoDeuda > 0 ? montoDeuda : 0);
      const diff = pago.montoPagadoTotal - valorEnMora;
      const estadoPago = valorEnMora <= 0
        ? 'SIN_MORA'
        : diff >= -0.01 ? (diff > 0.01 ? 'PAGO_EXCEDENTE' : 'PAGADO_COMPLETO') : 'ABONO_PARCIAL';

      matches.push({
        contactoId: Number(row.id),
        nombreDeudor: row.nombre_deudor,
        cedula: row.cedula,
        campanaId: Number(row.campana_id),
        campanaNombre: row.campana_nombre,
        asesorNombre: row.asesor_nombre || 'Sin asignar',
        contrato: String(row.contrato_norm),
        empresa: meta['EMPRESA'] || pago.empresa || '',
        montoPagado: pago.montoPagadoTotal,
        valorEnMora,
        diferencia: diff,
        estadoPago,
        ultimaFecha: pago.ultimaFecha,
        cuotas: pago.cuotas,
        yaPago: row.ya_pago === true,
      });
    }
    res.json({ matches, totalContratos: contratos.length, totalMatches: matches.length });
  } catch (err) { next(err); }
});

// ── POST /api/validacion/confirmar — Excluir del marcador los pagos validados ──
router.post('/validacion/confirmar', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { contactoIds = [], matches = [] } = req.body;
    if (!contactoIds.length) return res.json({ success: true, updated: 0 });
    const ids = contactoIds.map(Number);
    const byId = new Map(matches.map(m => [m.contactoId, m]));
    const idsSet = new Set(ids);
    const matchesSel = matches.filter(m => idsSet.has(m.contactoId));

    const excluir = ids.filter(id => byId.get(id)?.estadoPago !== 'ABONO_PARCIAL');
    const abonos  = ids.filter(id => byId.get(id)?.estadoPago === 'ABONO_PARCIAL');

    // Crear sesión de validación
    const nPagado   = matchesSel.filter(m => m.estadoPago === 'PAGADO_COMPLETO').length;
    const nExced    = matchesSel.filter(m => m.estadoPago === 'PAGO_EXCEDENTE').length;
    const montoReal = matchesSel.filter(m => m.estadoPago !== 'ABONO_PARCIAL').reduce((s, m) => s + (Number(m.montoPagado) || 0), 0);
    const montoAb   = matchesSel.filter(m => m.estadoPago === 'ABONO_PARCIAL').reduce((s, m) => s + (Number(m.montoPagado) || 0), 0);

    const [sesion] = await db.$queryRaw`
      INSERT INTO validacion_sesiones (supervisor_id, n_pagado, n_excedente, n_abono, monto_real, monto_abono, registros)
      VALUES (${req.user.id}, ${nPagado}, ${nExced}, ${abonos.length}, ${montoReal}, ${montoAb}, ${ids.length})
      RETURNING id
    `;

    // Guardar cada registro en validacion_pagos (paralelo: filas independientes)
    await Promise.all(matchesSel.map(m => db.$executeRaw`
      INSERT INTO validacion_pagos
        (sesion_id, contacto_id, nombre_deudor, cedula, contrato, empresa, campana_nombre,
         asesor_nombre, estado_pago, valor_en_mora, monto_pagado, validado_por)
      VALUES (
        ${sesion.id}, ${m.contactoId}, ${m.nombreDeudor ?? ''}, ${m.cedula ?? ''},
        ${m.contrato ?? ''}, ${m.empresa ?? ''}, ${m.campanaNombre ?? ''},
        ${m.asesorNombre ?? ''}, ${m.estadoPago}, ${Number(m.valorEnMora) || 0},
        ${Number(m.montoPagado) || 0}, ${req.user.id}
      )
    `));

    // Excluir pagados del marcador
    if (excluir.length) {
      await db.contacto.updateMany({
        where: { id: { in: excluir } },
        data: { yaPago: true, validadoPago: true, estadoMarcacion: 'YA_PAGO', ordenMarcacion: null },
      });

      // Marcar CDRs de HOY como COMP_CUM para que el compromiso del asesor
      // refleje el pago validado sin depender del campo permanente ya_pago.
      const hoyGye = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Guayaquil' });
      await db.$executeRaw`
        UPDATE cdrs SET resultado = 'COMP_CUM'
        WHERE contacto_id = ANY(${excluir}::int[])
          AND resultado IS DISTINCT FROM 'COMP_CUM'
          AND DATE(timestamp_inicio AT TIME ZONE 'America/Guayaquil') = ${hoyGye}::date
          AND tipificacion_id IN (
            SELECT id FROM tipificaciones WHERE codigo IN ('PMP','AB_PARC','PEND_COMP')
          )
      `;
    }

    // Abonos parciales: reducir monto_deuda al saldo restante (valor_en_mora - monto_pagado)
    if (abonos.length) {
      await Promise.all(
        matchesSel
          .filter(m => m.estadoPago === 'ABONO_PARCIAL')
          .map(m => {
            const saldo = Math.max(0, parseFloat(m.valorEnMora || 0) - parseFloat(m.montoPagado || 0));
            return db.contacto.update({
              where: { id: m.contactoId },
              data: { montoDeuda: parseFloat(saldo.toFixed(2)) },
            });
          })
      );
    }

    // Notificar asesores en tiempo real
    const abonoSaldos = matchesSel
      .filter(m => m.estadoPago === 'ABONO_PARCIAL')
      .map(m => ({
        id: m.contactoId,
        saldo: parseFloat(Math.max(0, parseFloat(m.valorEnMora || 0) - parseFloat(m.montoPagado || 0)).toFixed(2)),
      }));
    broadcastToAll({ tipo: 'PAGO_VALIDADO', contactoIds: excluir, abonoIds: abonos, abonoSaldos });
    cache.invalidate('ranking-apertura:');
    cache.invalidate('metricas-campana:');
    cache.invalidate('indicadores-cobranza:');

    res.json({ success: true, updated: excluir.length });
  } catch (err) { next(err); }
});

// ── POST /api/validacion/revertir/:id — Devolver contacto validado a la cola ───
router.post('/validacion/revertir/:id', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    await db.contacto.update({
      where: { id: parseInt(req.params.id) },
      data: { validadoPago: false, yaPago: false, estadoMarcacion: 'GESTIONADO' },
    });
    res.json({ success: true });
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

// ── GET /api/cartera/rotacion — Avance por asesor (total vs gestionado) ────────
// Devuelve [{ asesor:{id,nombre}, metricas:{total_asignados, gestionados_base} }]
// que consume AdvancedMetricsCharts (card "Rotación de Cartera").
router.get('/cartera/rotacion', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
    const campanaId = req.query.campana_id ? parseInt(req.query.campana_id) : null;
    const fechaInicio = req.query.fechaInicio ? new Date(req.query.fechaInicio + 'T00:00:00') : null;
    const fechaFin    = req.query.fechaFin    ? new Date(req.query.fechaFin    + 'T23:59:59') : fechaInicio ? new Date(req.query.fechaInicio + 'T23:59:59') : null;

    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;
    const asesores = await db.usuario.findMany({ where: whereU, select: { id: true, nombre: true } });

    const ids = asesores.map(a => a.id);
    if (!ids.length) return res.json([]);

    // Totales asignados por asesor — 1 groupBy (antes: 1 count por asesor)
    const totRows = await db.contacto.groupBy({
      by: ['asignadoA'],
      where: { asignadoA: { in: ids }, ...(campanaId ? { campanaId } : {}) },
      _count: { _all: true },
    }).catch(() => []);
    const totBy = Object.fromEntries(totRows.map(r => [r.asignadoA, r._count._all]));

    // Gestionados por asesor — 1 query (antes: findMany distinct POR asesor, sin límite)
    let gestBy = {};
    if (fechaInicio || campanaId) {
      // Contactos únicos con al menos un CDR (cualquier llamada = gestionado)
      const fechaCond = fechaInicio
        ? Prisma.sql`AND cd.timestamp_inicio >= ${fechaInicio} AND cd.timestamp_inicio <= ${fechaFin}`
        : Prisma.empty;
      const rows = campanaId
        ? await db.$queryRaw`
            SELECT cd.usuario_id, COUNT(DISTINCT cd.contacto_id)::int AS n
            FROM cdrs cd JOIN contactos c ON c.id = cd.contacto_id
            WHERE cd.usuario_id = ANY(${ids}) AND c.campana_id = ${campanaId} ${fechaCond}
            GROUP BY cd.usuario_id
          `.catch(() => [])
        : await db.$queryRaw`
            SELECT cd.usuario_id, COUNT(DISTINCT cd.contacto_id)::int AS n
            FROM cdrs cd
            WHERE cd.usuario_id = ANY(${ids}) ${fechaCond}
            GROUP BY cd.usuario_id
          `.catch(() => []);
      gestBy = Object.fromEntries(rows.map(r => [Number(r.usuario_id), Number(r.n) || 0]));
    } else {
      const gRows = await db.contacto.groupBy({
        by: ['asignadoA'],
        where: { asignadoA: { in: ids }, estadoMarcacion: { in: ['GESTIONADO', 'YA_PAGO'] } },
        _count: { _all: true },
      }).catch(() => []);
      gestBy = Object.fromEntries(gRows.map(r => [r.asignadoA, r._count._all]));
    }

    const detalle = asesores.map(a => ({
      asesor: { id: a.id, nombre: a.nombre },
      metricas: { total_asignados: totBy[a.id] || 0, gestionados_base: gestBy[a.id] || 0 },
    }));
    res.json(detalle);
  } catch (err) { next(err); }
});

// ── GET /api/cartera/gestiones-asesores — Gestiones por asesor ───────────────
router.get('/cartera/gestiones-asesores', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
    const whereU = { rol: 'asesor', estado: 'activo' };
    if (req.user.rol !== 'admin') whereU.supervisorId = req.user.id;
    const asesores = await db.usuario.findMany({ where: whereU, select: { id: true, nombre: true } });

    // 1 sola pasada con FILTER (antes: 3 counts por asesor = 3N queries)
    const ids = asesores.map(a => a.id);
    const rows = ids.length ? await db.$queryRaw`
      SELECT asignado_a,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE estado_marcacion IN ('GESTIONADO','YA_PAGO'))::int AS gestionados,
        COUNT(*) FILTER (WHERE ya_pago)::int AS pagados
      FROM contactos
      WHERE asignado_a = ANY(${ids})
      GROUP BY asignado_a
    `.catch(() => []) : [];
    const by = Object.fromEntries(rows.map(r => [Number(r.asignado_a), r]));
    const gestiones = asesores.map(a => ({
      asesor_id: a.id,
      nombre: a.nombre,
      total: Number(by[a.id]?.total) || 0,
      gestionados: Number(by[a.id]?.gestionados) || 0,
      pagados: Number(by[a.id]?.pagados) || 0,
    }));
    res.json(gestiones);
  } catch (err) { next(err); }
});

// ── GET /api/cartera/detalle-contactabilidad — CDRs por hora del equipo ───────
// Devuelve una fila por CDR: { hora_bucket, usuario_id, categoria } para la card
// "Contactabilidad por Hora".
router.get('/cartera/detalle-contactabilidad', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
    const campanaId = req.query.campana_id ? parseInt(req.query.campana_id) : null;
    const { inicio, ymd } = _gyeDayBounds(req.query.fecha);
    const { fin }         = _gyeDayBounds(req.query.fecha_fin || req.query.fecha);

    const asesorIds = await getAsesorIdsDelEquipo(req.user);

    const conds = [Prisma.sql`cr.timestamp_inicio >= ${inicio} AND cr.timestamp_inicio <= ${fin}`];
    if (asesorIds && asesorIds.length) conds.push(Prisma.sql`AND cr.usuario_id IN (${Prisma.join(asesorIds)})`);
    if (campanaId) conds.push(Prisma.sql`AND ct.campana_id = ${campanaId}`);
    // Filtrar por apertura de hoy: solo contactos cuya fecha_asignacion es la fecha solicitada
    conds.push(Prisma.sql`AND DATE(ct.fecha_asignacion AT TIME ZONE 'America/Guayaquil') = ${ymd}::date`);
    const whereSql = Prisma.join(conds, ' ');

    const rows = await db.$queryRaw(Prisma.sql`
      SELECT EXTRACT(HOUR FROM cr.timestamp_inicio)::int AS hora_bucket,
             cr.usuario_id AS usuario_id,
             u.nombre AS asesor_nombre,
             COALESCE(t.categoria, 'NO_CONTACTADO') AS tipificacion_categoria,
             t.codigo AS tipificacion_codigo,
             t.descripcion AS tipificacion_desc
      FROM cdrs cr
      JOIN contactos ct ON ct.id = cr.contacto_id
      LEFT JOIN tipificaciones t ON cr.tipificacion_id = t.id
      LEFT JOIN usuarios u ON u.id = cr.usuario_id
      WHERE ${whereSql}
    `);
    res.json(rows.map(r => ({
      hora_bucket:            Number(r.hora_bucket),
      usuario_id:             Number(r.usuario_id),
      asesor_nombre:          r.asesor_nombre || null,
      tipificacion_categoria: r.tipificacion_categoria,
      tipificacion_codigo:    r.tipificacion_codigo,
      tipificacion_desc:      r.tipificacion_desc,
    })));
  } catch (err) { next(err); }
});

// ── GET /api/pagos-verificados — Contactos con pago validado del equipo ───────
router.get('/pagos-verificados', requireRole('jefe_area', 'admin'), async (req, res, next) => {
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
router.get('/compromisos-equipo', requireRole('jefe_area', 'admin'), async (req, res, next) => {
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
                  estado: { notIn: ['cancelado', 'ejecutado'] },
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
            yaPago: true,
            agendamientos: {
              where: { estado: { notIn: ['cancelado', 'ejecutado'] } },
              select: { fechaHora: true },
              orderBy: { id: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { timestampInicio: 'desc' },
      take: 500,
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
        ya_pago:             c.contacto?.yaPago ?? false,
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

// ── DELETE /api/compromisos/:id — Eliminar CDR compromiso ────────────────────
router.delete('/compromisos/:id', requireRole('jefe_area', 'admin'), async (req, res, next) => {
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
router.get('/jefe/meta-diaria-campanas', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const hoy = new Date();
    const inicioDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const finDia    = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59, 999);

    const campanas = await db.campana.findMany({
      where: { estado: 'activa' },
      select: { id: true, nombre: true, metaDiaria: true },
      orderBy: { id: 'desc' },
    });

    // cobrado_hoy = pagos validados bancariamente hoy
    const cobradosPorCampana = await db.$queryRaw`
      SELECT ct.campana_id, COALESCE(SUM(vp.monto_pagado::DOUBLE PRECISION), 0) AS cobrado_hoy
      FROM validacion_pagos vp
      JOIN contactos ct ON vp.contacto_id = ct.id
      WHERE vp.validado_en >= ${inicioDia} AND vp.validado_en <= ${finDia}
        AND vp.estado_pago != 'ABONO_PARCIAL'
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

// ── GET /api/campana/meta-diaria — accesible por asesor, filtra por campana_id ─
router.get('/campana/meta-diaria', requireRole('jefe_area', 'admin', 'asesor'), async (req, res, next) => {
  try {
    const campanaId = req.query.campana_id ? parseInt(req.query.campana_id) : null;
    const hoy = new Date();
    const inicioDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const finDia    = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59, 999);

    const where = { estado: 'activa' };
    if (campanaId) where.id = campanaId;

    const campanas = await db.campana.findMany({
      where,
      select: { id: true, nombre: true, metaDiaria: true },
      orderBy: { id: 'desc' },
    });

    // cobrado_hoy = pagos validados bancariamente hoy (validacion_pagos.monto_pagado)
    const cobradosPorCampana = campanaId
      ? await db.$queryRaw`
          SELECT ct.campana_id, COALESCE(SUM(vp.monto_pagado::DOUBLE PRECISION), 0) AS cobrado_hoy
          FROM validacion_pagos vp
          JOIN contactos ct ON vp.contacto_id = ct.id
          WHERE vp.validado_en >= ${inicioDia} AND vp.validado_en <= ${finDia}
            AND vp.estado_pago != 'ABONO_PARCIAL'
            AND ct.campana_id = ${campanaId}
          GROUP BY ct.campana_id`
      : await db.$queryRaw`
          SELECT ct.campana_id, COALESCE(SUM(vp.monto_pagado::DOUBLE PRECISION), 0) AS cobrado_hoy
          FROM validacion_pagos vp
          JOIN contactos ct ON vp.contacto_id = ct.id
          WHERE vp.validado_en >= ${inicioDia} AND vp.validado_en <= ${finDia}
            AND vp.estado_pago != 'ABONO_PARCIAL'
          GROUP BY ct.campana_id`;

    const cobradoMap = {};
    cobradosPorCampana.forEach(r => { cobradoMap[Number(r.campana_id)] = Number(r.cobrado_hoy); });

    const resultado = campanas.map(c => {
      const cobrado_hoy = cobradoMap[c.id] ?? 0;
      return {
        id: c.id,
        nombre: c.nombre,
        meta_diaria: c.metaDiaria ?? 0,
        cobrado_hoy,
        pct_cumplimiento: (c.metaDiaria ?? 0) > 0
          ? Math.round((cobrado_hoy / c.metaDiaria) * 10000) / 100 : 0,
      };
    });

    res.json(campanaId ? resultado[0] || null : resultado);
  } catch (err) { next(err); }
});

// ── POST /api/jefe/meta-diaria-campana ───────────────────────────────────────
router.post('/jefe/meta-diaria-campana', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { campanaId, valor } = req.body;
    const id  = parseInt(campanaId);
    const val = parseFloat(valor);
    if (!id || isNaN(val) || val < 0) return res.status(400).json({ error: 'campanaId y valor requeridos' });
    await db.campana.update({ where: { id }, data: { metaDiaria: val } });
    broadcastToAll({ tipo: 'META_ACTUALIZADA', campanaId: id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/campana/metas-segmentos?campana_id=X ────────────────────────────
// Devuelve metas configuradas (monto y unidades por S0/S1/S2/global)
// + avance real del día (pagos validados hoy, segmentados)
router.get('/campana/metas-segmentos', requireRole('jefe_area', 'admin', 'asesor'), async (req, res, next) => {
  try {
    const campanaId = req.query.campana_id ? parseInt(req.query.campana_id) : null;
    if (!campanaId) return res.status(400).json({ error: 'campana_id requerido' });

    // Leer metas del config
    const segs = ['0','1','2','global'];
    const claves = segs.flatMap(s => [
      `meta_monto_s${s}_c${campanaId}`,
      `meta_unidades_s${s}_c${campanaId}`,
    ]);
    const cfgRows = await db.config.findMany({ where: { clave: { in: claves } } });
    const cfgMap  = Object.fromEntries(cfgRows.map(r => [r.clave, parseFloat(r.valor) || 0]));

    const getMeta = (seg, tipo) => cfgMap[`meta_${tipo}_s${seg}_c${campanaId}`] || 0;

    // Avance: pagos validados hoy segmentados (contamos días impago del metadata del contacto)
    const hoy = new Date();
    const inicioDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const finDia    = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59, 999);

    const pagoRows = await db.$queryRaw`
      SELECT ct.metadata, vp.monto_pagado, vp.estado_pago
      FROM validacion_pagos vp
      JOIN contactos ct ON vp.contacto_id = ct.id
      WHERE vp.validado_en >= ${inicioDia} AND vp.validado_en <= ${finDia}
        AND vp.estado_pago != 'ABONO_PARCIAL'
        AND ct.campana_id = ${campanaId}
    `;

    const avance = { '0': { monto: 0, unidades: 0 }, '1': { monto: 0, unidades: 0 }, '2': { monto: 0, unidades: 0 }, global: { monto: 0, unidades: 0 } };
    for (const row of pagoRows) {
      let meta = {};
      try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}); } catch (_) {}
      const d = parseInt(meta['DIAS IMPAGO'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || meta['DIAS EN MORA'] || meta['dias impago'] || meta['dias mora'] || '0', 10);
      const seg = isNaN(d) || d <= 0 ? '0' : d === 1 ? '1' : '2';
      const m = Number(row.monto_pagado || 0);
      avance[seg].monto    += m;
      avance[seg].unidades += 1;
      avance.global.monto    += m;
      avance.global.unidades += 1;
    }

    res.json({
      campana_id: campanaId,
      segmentos: segs.map(s => ({
        seg: s,
        meta_monto:    getMeta(s, 'monto'),
        meta_unidades: getMeta(s, 'unidades'),
        cobrado_hoy:   avance[s].monto,
        unidades_hoy:  avance[s].unidades,
        pct_monto:     getMeta(s, 'monto') > 0 ? Math.min(100, Math.round(avance[s].monto / getMeta(s, 'monto') * 100)) : null,
        pct_unidades:  getMeta(s, 'unidades') > 0 ? Math.min(100, Math.round(avance[s].unidades / getMeta(s, 'unidades') * 100)) : null,
      })),
    });
  } catch (err) { next(err); }
});

// ── POST /api/jefe/metas-segmentos ───────────────────────────────────────────
// Guarda metas de monto y unidades por segmento para una campaña
router.post('/jefe/metas-segmentos', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { campanaId, metas } = req.body;
    // metas: { s0: { monto, unidades }, s1: {...}, s2: {...}, global: {...} }
    const id = parseInt(campanaId);
    if (!id || !metas) return res.status(400).json({ error: 'campanaId y metas requeridos' });

    const ops = [];
    for (const [seg, vals] of Object.entries(metas)) {
      if (vals.monto    != null) ops.push(db.config.upsert({ where: { clave: `meta_monto_s${seg}_c${id}` },    create: { clave: `meta_monto_s${seg}_c${id}`,    valor: String(parseFloat(vals.monto)    || 0) }, update: { valor: String(parseFloat(vals.monto)    || 0) } }));
      if (vals.unidades != null) ops.push(db.config.upsert({ where: { clave: `meta_unidades_s${seg}_c${id}` }, create: { clave: `meta_unidades_s${seg}_c${id}`, valor: String(parseFloat(vals.unidades) || 0) }, update: { valor: String(parseFloat(vals.unidades) || 0) } }));
    }
    // Si viene meta global de monto, también actualizar campana.meta_diaria
    if (metas.global?.monto != null) {
      ops.push(db.campana.update({ where: { id }, data: { metaDiaria: parseFloat(metas.global.monto) || 0 } }));
    }
    await db.$transaction(ops);
    broadcastToAll({ tipo: 'META_ACTUALIZADA', campanaId: id });
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
router.post('/indicadores/config', requireRole('jefe_area', 'admin'), async (req, res, next) => {
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
router.post('/jefe/meta-mensual', requireRole('jefe_area', 'admin'), async (req, res, next) => {
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
    // Filtro de fecha para CDRs (PMP subquery)
    const hoyInd = new Date(); hoyInd.setHours(0,0,0,0);
    const mañanaInd = new Date(hoyInd); mañanaInd.setDate(mañanaInd.getDate() + 1);
    const fDesdeInd = req.query.fechaDesde ? new Date(req.query.fechaDesde + 'T00:00:00') : hoyInd;
    const fHastaInd = req.query.fechaHasta ? new Date(req.query.fechaHasta + 'T23:59:59') : mañanaInd;
    const pmpFechaRaw = req.query.fechaDesde || !req.query.sinFecha
      ? Prisma.sql`AND cd.timestamp_inicio >= ${fDesdeInd} AND cd.timestamp_inicio < ${fHastaInd}`
      : Prisma.sql``;

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
        ${pmpFechaRaw}
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
// Cobertura = contratos únicos con CDR / contratos únicos en apertura — NUNCA > 100%
// Ancla AMBOS (denominador y numerador) al mismo rango de fecha_asignacion.
// Deduplica por nro_contrato (no cédula — un cliente puede tener múltiples contratos).
router.get('/jefe/productividad', async (req, res, next) => {
  if (!isSupervisor(req.user.rol)) return res.status(403).json({ error: 'Acceso denegado' });
  try {
    const cWhere = await resolveContactoWhere(req.query); // empresa incluida si viene en query

    // Rango de apertura (fecha_asignacion)
    let fechaDesde, fechaHasta;
    if (req.query.fechaDesde) {
      fechaDesde = new Date(req.query.fechaDesde + 'T00:00:00.000Z');
      fechaHasta = req.query.fechaHasta
        ? new Date(req.query.fechaHasta + 'T23:59:59.999Z')
        : new Date(req.query.fechaDesde + 'T23:59:59.999Z');
    } else {
      const b = _gyeDayBounds(req.query.fecha);
      fechaDesde = b.inicio; fechaHasta = b.fin;
    }

    const contactoFrag = buildContactoRawWhere(cWhere);           // incluye empresa si viene en cWhere
    const cdrCtFrag    = buildCdrContactoRawWhere(cWhere, 'co');  // idem, alias co
    const apoyoFrag    = _APOYO_IDS.length
      ? Prisma.sql`AND cr.usuario_id NOT IN (${Prisma.join(_APOYO_IDS)})`
      : Prisma.empty;

    const [denomRows, numRows, canalRows] = await Promise.all([
      // Denominador: contratos únicos en la apertura (por fecha_asignacion)
      db.$queryRaw`
        SELECT
          COUNT(DISTINCT COALESCE(nro_contrato, id::text))::int AS total,
          COUNT(DISTINCT CASE WHEN empresa IN ('TEC_SAS','SCC') THEN COALESCE(nro_contrato, id::text) END)::int AS total_uphone,
          COUNT(DISTINCT CASE WHEN empresa = 'CREDI_TV'         THEN COALESCE(nro_contrato, id::text) END)::int AS total_credi
        FROM contactos
        WHERE fecha_asignacion >= ${fechaDesde}
          AND fecha_asignacion <= ${fechaHasta}
          ${contactoFrag}
      `,
      // Numerador: contratos únicos con al menos 1 CDR en el mismo rango (excluye apoyo)
      db.$queryRaw`
        SELECT
          COUNT(DISTINCT COALESCE(co.nro_contrato, co.id::text))::int AS gestionados,
          COUNT(DISTINCT CASE WHEN co.empresa IN ('TEC_SAS','SCC') THEN COALESCE(co.nro_contrato, co.id::text) END)::int AS gest_uphone,
          COUNT(DISTINCT CASE WHEN co.empresa = 'CREDI_TV'         THEN COALESCE(co.nro_contrato, co.id::text) END)::int AS gest_credi
        FROM cdrs cr
        JOIN contactos co ON co.id = cr.contacto_id
        WHERE co.fecha_asignacion >= ${fechaDesde}
          AND co.fecha_asignacion <= ${fechaHasta}
          AND cr.timestamp_inicio  >= ${fechaDesde}
          AND cr.timestamp_inicio  <= ${fechaHasta}
          ${apoyoFrag}
          ${cdrCtFrag}
      `,
      // CDRs por canal en el rango (intentos totales — puede superar contratos únicos)
      db.$queryRaw`
        SELECT cr.canal, COUNT(*)::int AS total
        FROM cdrs cr
        JOIN contactos co ON co.id = cr.contacto_id
        WHERE cr.timestamp_inicio >= ${fechaDesde}
          AND cr.timestamp_inicio <= ${fechaHasta}
          ${apoyoFrag}
          ${cdrCtFrag}
        GROUP BY cr.canal
      `,
    ]);

    const cartera_total     = Number(denomRows[0]?.total     || 0);
    const gestionados       = Number(numRows[0]?.gestionados  || 0);
    const gestiones_totales = canalRows.reduce((s, r) => s + Number(r.total), 0);
    const cobertura = cartera_total > 0
      ? Math.min(100, Math.round((gestionados / cartera_total) * 100))
      : 0;

    const canalesMap = { llamada: 0, whatsapp: 0, rcs: 0, gmail: 0 };
    for (const r of canalRows) {
      if (r.canal in canalesMap) canalesMap[r.canal] = Number(r.total);
    }

    res.json({
      avance_cartera: cobertura,
      cobertura,
      gestiones_totales,
      cartera_total,
      contactados_unicos: gestionados,
      canales: canalesMap,
      por_empresa: {
        UPHONE: {
          total:       Number(denomRows[0]?.total_uphone || 0),
          gestionados: Number(numRows[0]?.gest_uphone    || 0),
        },
        CREDI_TV: {
          total:       Number(denomRows[0]?.total_credi || 0),
          gestionados: Number(numRows[0]?.gest_credi    || 0),
        },
      },
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

    // Filtro de fecha para CDRs
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);
    const fechaDesde = req.query.fechaDesde ? new Date(req.query.fechaDesde + 'T00:00:00') : hoy;
    const fechaHasta = req.query.fechaHasta ? new Date(req.query.fechaHasta + 'T23:59:59') : manana;
    const cdrFechaWhere = req.query.fechaDesde || !req.query.sinFecha
      ? { timestampInicio: { gte: fechaDesde, lt: fechaHasta } } : {};

    const asesores = await db.usuario.findMany({ where: whereU, select: { id: true, nombre: true } });

    const cdrRawWhere = buildCdrContactoRawWhere(cWhere);
    const fechaRaw = req.query.fechaDesde || !req.query.sinFecha
      ? Prisma.sql`AND cd.timestamp_inicio >= ${fechaDesde} AND cd.timestamp_inicio < ${fechaHasta}`
      : Prisma.sql``;
    const C_DIAS = `COALESCE(NULLIF(c.metadata->>'DIAS IMPAGO',''),NULLIF(c.metadata->>'DIAS EN MORA',''),NULLIF(c.metadata->>'DIAS MORA',''))`;

    // 1 CTE query sustituye N×2 queries paralelas (N = asesores count)
    const asesorIds = asesores.map(a => a.id);
    const cteRows = asesorIds.length > 0 ? await db.$queryRaw(Prisma.sql`
      WITH
        total_gest AS (
          SELECT cd.usuario_id, COUNT(*)::int AS total
          FROM cdrs cd
          JOIN contactos c ON c.id = cd.contacto_id
          WHERE cd.usuario_id = ANY(${asesorIds}::int[])
            ${fechaRaw}
            ${cdrRawWhere}
          GROUP BY cd.usuario_id
        ),
        seg_counts AS (
          SELECT
            cd.usuario_id,
            CAST(${Prisma.raw(C_DIAS)} AS INTEGER) AS segmento,
            COUNT(*)::int AS gestiones,
            COUNT(*) FILTER (WHERE t.codigo = 'PMP')::int AS promesas,
            COUNT(*) FILTER (WHERE cd.resultado = 'CUMPL')::int AS cumplidas,
            COUNT(*) FILTER (WHERE cd.resultado = 'INCUMP')::int AS vencidas
          FROM cdrs cd
          JOIN contactos c ON cd.contacto_id = c.id
          LEFT JOIN tipificaciones t ON cd.tipificacion_id = t.id
          WHERE cd.usuario_id = ANY(${asesorIds}::int[])
            AND ${Prisma.raw(C_DIAS)} ~ '^[0-2]$'
            ${fechaRaw}
            ${cdrRawWhere}
          GROUP BY cd.usuario_id, segmento
        )
      SELECT
        sc.usuario_id,
        sc.segmento,
        sc.gestiones,
        sc.promesas,
        sc.cumplidas,
        sc.vencidas,
        COALESCE(tg.total, 0) AS total_gestiones
      FROM seg_counts sc
      LEFT JOIN total_gest tg ON tg.usuario_id = sc.usuario_id
    `) : [];

    // Pivot por asesor en JS
    const byAsesor = new Map(asesores.map(a => [a.id, {
      asesor: a.nombre,
      total_gestiones: 0,
      segmentos: {
        '0': { gestiones: 0, promesas: 0, cumplidas: 0, vencidas: 0 },
        '1': { gestiones: 0, promesas: 0, cumplidas: 0, vencidas: 0 },
        '2': { gestiones: 0, promesas: 0, cumplidas: 0, vencidas: 0 },
      },
    }]));
    for (const r of cteRows) {
      const entry = byAsesor.get(Number(r.usuario_id));
      if (!entry) continue;
      entry.total_gestiones = Number(r.total_gestiones);
      const s = String(r.segmento);
      if (entry.segmentos[s]) {
        entry.segmentos[s].gestiones = Number(r.gestiones);
        entry.segmentos[s].promesas  = Number(r.promesas);
        entry.segmentos[s].cumplidas = Number(r.cumplidas);
        entry.segmentos[s].vencidas  = Number(r.vencidas);
      }
    }
    const result = [...byAsesor.values()];

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
    const cWhere = await resolveContactoWhere(req.query);
    const hayFiltro = Object.keys(cWhere).length > 0;

    // Últimos 7 días calendario Guayaquil
    const hoyYmd = _gyeDayBounds().ymd;
    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${hoyYmd}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - i);
      dias.push(d.toISOString().slice(0, 10));
    }
    const byDay = Object.fromEntries(dias.map(f => [f, 0]));

    if (!hayFiltro) {
      // Camino rápido: días cerrados desde el agregado diario (1 fila por asesor/día);
      // solo HOY se calcula live desde cdrs. Antes: findMany de TODOS los cdrs de 7 días.
      const { inicio: iniHoy, fin: finHoy } = _gyeDayBounds();
      const [aggRows, hoyRows] = await Promise.all([
        db.$queryRaw`
          SELECT fecha, COALESCE(SUM(monto_acordado), 0)::float AS total
          FROM metricas_diarias_asesor
          WHERE fecha >= ${dias[0]} AND fecha < ${hoyYmd}
          GROUP BY fecha
        `.catch(() => []),
        db.$queryRaw`
          SELECT COALESCE(SUM(monto_acordado), 0)::float AS total
          FROM cdrs
          WHERE timestamp_inicio >= ${iniHoy} AND timestamp_inicio <= ${finHoy}
            AND monto_acordado IS NOT NULL
        `.catch(() => [{ total: 0 }]),
      ]);
      for (const r of aggRows) if (byDay[r.fecha] !== undefined) byDay[r.fecha] = Number(r.total) || 0;
      byDay[hoyYmd] = Number(hoyRows[0]?.total) || 0;
    } else {
      // Con filtros (empresa/campaña/etc.) — GROUP BY DATE en SQL, sin traer filas crudas
      const hace7 = new Date(`${dias[0]}T00:00:00.000Z`);
      const ctFrag = buildCdrContactoRawWhere(cWhere);
      const rows = await db.$queryRaw(Prisma.sql`
        SELECT
          DATE(cd.timestamp_inicio)::text AS fecha,
          COALESCE(SUM(cd.monto_acordado), 0)::float AS valor_cobrado
        FROM cdrs cd
        JOIN contactos c ON c.id = cd.contacto_id
        WHERE cd.timestamp_inicio >= ${hace7}
          AND cd.monto_acordado IS NOT NULL
          ${ctFrag}
        GROUP BY DATE(cd.timestamp_inicio)
      `);
      for (const r of rows) {
        if (byDay[r.fecha] !== undefined) byDay[r.fecha] = Number(r.valor_cobrado);
      }
    }

    res.json(dias.map(fecha => ({ fecha, valor_cobrado: byDay[fecha] })));
  } catch (err) { next(err); }
});

// ── Mensajes Broadcast ───────────────────────────────────────────
// Usa SQL crudo para no depender de la versión del Prisma client generado en la VM.
router.get('/mensajes-broadcast', requireRole('jefe_area', 'admin', 'asesor'), async (req, res, next) => {
  try {
    const ck = `mensajes:${req.user.id}`;
    const hit = cache.get(ck);
    if (hit) return res.json(hit);
    let rows;
    if (req.user.rol === 'asesor') {
      // Solo mensajes del jefe asignado al asesor
      rows = await db.$queryRaw`
        SELECT mb.id, mb.mensaje, mb.segmento_destino, mb.canal, mb.empresa, mb.asunto, mb.imagen_url,
               mb.activo, mb.creado_en, u.nombre AS supervisor_nombre
        FROM mensajes_broadcast mb
        LEFT JOIN usuarios u ON u.id = mb.supervisor_id
        WHERE mb.supervisor_id = (SELECT supervisor_id FROM usuarios WHERE id = ${req.user.id})
        ORDER BY mb.creado_en DESC
      `;
    } else if (req.user.rol === 'jefe_area') {
      // Solo los mensajes del propio jefe
      rows = await db.$queryRaw`
        SELECT mb.id, mb.mensaje, mb.segmento_destino, mb.canal, mb.empresa, mb.asunto, mb.imagen_url,
               mb.activo, mb.creado_en, u.nombre AS supervisor_nombre
        FROM mensajes_broadcast mb
        LEFT JOIN usuarios u ON u.id = mb.supervisor_id
        WHERE mb.supervisor_id = ${req.user.id}
        ORDER BY mb.creado_en DESC
      `;
    } else {
      // admin: ver todos
      rows = await db.$queryRaw`
        SELECT mb.id, mb.mensaje, mb.segmento_destino, mb.canal, mb.empresa, mb.asunto, mb.imagen_url,
               mb.activo, mb.creado_en, u.nombre AS supervisor_nombre
        FROM mensajes_broadcast mb
        LEFT JOIN usuarios u ON u.id = mb.supervisor_id
        ORDER BY mb.creado_en DESC
      `;
    }
    const result = rows.map(m => ({
      id:                Number(m.id),
      mensaje:           m.mensaje,
      segmento_destino:  m.segmento_destino,
      canal:             m.canal ?? null,
      empresa:           m.empresa ?? null,
      asunto:            m.asunto ?? null,
      imagen_url:        m.imagen_url ?? null,
      activo:            m.activo ? 1 : 0,
      supervisor_nombre: m.supervisor_nombre ?? null,
      creado_en:         m.creado_en,
      pagos_posteriores: 0,
    }));
    cache.set(ck, result, 120_000);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/mensajes-broadcast', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { mensaje, segmento_destino = 'TODOS', canal = 'TODOS', empresa = null, asunto, imagen_url } = req.body;
    if (!mensaje?.trim()) return res.status(400).json({ error: 'Mensaje requerido' });
    const canalesValidos = ['TODOS', 'WSP', 'RCS', 'CORREO', 'COMPROMISOS'];
    if (!canalesValidos.includes(canal)) return res.status(400).json({ error: 'Canal inválido' });
    const empresasValidas = [null, 'UPHONE', 'CREDI_TV'];
    if (!empresasValidas.includes(empresa)) return res.status(400).json({ error: 'Empresa inválida' });
    const supervisorNombre = await db.$queryRaw`SELECT nombre FROM usuarios WHERE id = ${req.user.id}`;
    const empVal = empresa || null;
    const rows = await db.$queryRaw`
      INSERT INTO mensajes_broadcast (supervisor_id, mensaje, segmento_destino, canal, empresa, asunto, imagen_url)
      VALUES (${req.user.id}, ${mensaje.trim()}, ${segmento_destino}, ${canal},
              ${empVal}, ${asunto?.trim() || null}, ${imagen_url?.trim() || null})
      RETURNING id, mensaje, segmento_destino, canal, empresa, asunto, imagen_url, activo, creado_en
    `;
    const m = rows[0];
    const payload = {
      id:                Number(m.id),
      mensaje:           m.mensaje,
      segmento_destino:  m.segmento_destino,
      canal:             m.canal ?? null,
      empresa:           m.empresa ?? null,
      asunto:            m.asunto ?? null,
      imagen_url:        m.imagen_url ?? null,
      activo:            1,
      supervisor_nombre: supervisorNombre[0]?.nombre ?? null,
      creado_en:         m.creado_en,
      pagos_posteriores: 0,
    };
    cache.invalidate('mensajes:');
    broadcastToJefeTeam(req.user.id, { tipo: 'NUEVO_MENSAJE_BROADCAST', mensaje: payload });
    res.status(201).json(payload);
  } catch (err) { next(err); }
});

router.delete('/mensajes-broadcast/:id', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    await db.mensajeBroadcast.update({ where: { id }, data: { activo: false } });
    cache.invalidate('mensajes:');
    if (req.user.rol === 'admin') {
      broadcastToAll({ tipo: 'MENSAJE_BROADCAST_DESACTIVADO', id });
    } else {
      broadcastToJefeTeam(req.user.id, { tipo: 'MENSAJE_BROADCAST_DESACTIVADO', id });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Segmentos / Tramos dinámicos ──────────────────────────────────────────
router.get('/segmentos', requireRole('jefe_area', 'asesor', 'admin'), async (req, res) => {
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

router.post('/segmentos', requireRole('jefe_area', 'admin'), async (req, res, next) => {
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
    if (estado === 'ENVIADO') data[fechaMap[tipo]] = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Guayaquil' });

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

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Guayaquil' });
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

// ── GET /api/cartera?campanaId=X&take=N&skip=N ───────────────────────────────
const CARTERA_MAX_TAKE = 500;
router.get('/cartera', async (req, res, next) => {
  try {
    const asesorId  = req.user.id;
    const campanaId = req.query.campanaId ? parseInt(req.query.campanaId) : null;
    const take      = Math.min(Math.max(1, parseInt(req.query.take) || CARTERA_MAX_TAKE), CARTERA_MAX_TAKE);
    const skip      = Math.max(0, parseInt(req.query.skip) || 0);

    const where = { asignadoA: asesorId };
    if (campanaId) where.campanaId = campanaId;

    const [total, contactos] = await Promise.all([
      db.contacto.count({ where }),
      db.contacto.findMany({
        where,
        include: {
          campana: { select: { nombre: true } },
          agendamientos: {
            where: { estado: { notIn: ['cancelado', 'ejecutado'] } },
            select: { fechaHora: true, tipo: true },
            orderBy: { id: 'desc' },
            take: 1,
          },
        },
        orderBy: [
          { ordenMarcacion: { sort: 'asc', nulls: 'last' } },
          { id: 'asc' },
        ],
        skip,
        take,
      }),
    ]);

    // Última tipificación por contacto — DISTINCT ON evita cargar todos los CDRs
    const contactoIds = contactos.map(c => c.id);
    const latestTipRows = contactoIds.length > 0 ? await db.$queryRaw`
      SELECT DISTINCT ON (cd.contacto_id)
        cd.contacto_id AS "contactoId",
        t.codigo,
        t.descripcion
      FROM cdrs cd
      JOIN tipificaciones t ON t.id = cd.tipificacion_id
      WHERE cd.contacto_id = ANY(${contactoIds}::int[])
        AND cd.tipificacion_id IS NOT NULL
      ORDER BY cd.contacto_id, cd.id DESC
    ` : [];
    const tipMap = new Map();
    for (const r of latestTipRows) {
      tipMap.set(Number(r.contactoId), { codigo: r.codigo, descripcion: r.descripcion });
    }

    // gestiones_count: cartera nueva (asignada hoy) → solo CDRs hoy; cartera anterior → histórico
    // gestiones_hoy: siempre solo CDRs de hoy — usado para tracking de vueltas
    const gestionesRaw = contactoIds.length > 0 ? await db.$queryRaw`
      SELECT
        ct.id,
        COUNT(cdr.id)::int AS gestiones_count,
        COUNT(CASE WHEN cdr.timestamp_inicio >= CURRENT_DATE::timestamp THEN 1 END)::int AS gestiones_hoy
      FROM contactos ct
      LEFT JOIN cdrs cdr ON cdr.contacto_id = ct.id
        AND (
          (ct.fecha_asignacion::date = CURRENT_DATE AND cdr.timestamp_inicio >= CURRENT_DATE::timestamp)
          OR
          (ct.fecha_asignacion IS NULL OR ct.fecha_asignacion::date < CURRENT_DATE)
        )
      WHERE ct.id = ANY(${contactoIds})
      GROUP BY ct.id
    ` : [];
    const gestionesMap    = new Map(gestionesRaw.map(r => [Number(r.id), Number(r.gestiones_count ?? 0)]));
    const gestionesHoyMap = new Map(gestionesRaw.map(r => [Number(r.id), Number(r.gestiones_hoy    ?? 0)]));

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Guayaquil' });

    res.set('X-Cartera-Total',   String(total));
    res.set('X-Cartera-HasMore', String(skip + contactos.length < total));
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
        ya_pago: ct.yaPago ? 1 : 0,
        campana_id: ct.campanaId,
        campana_nombre: ct.campana?.nombre || null,
        whatsapp_status: wspStatus,
        rcs_status: rcsStatus,
        correo_status: correoStatus,
        validado_pago: ct.validadoPago ? 1 : 0,
        orden_marcacion: ct.ordenMarcacion,
        fecha_asignacion: ct.fechaAsignacion,
        ultima_tip_codigo: tip?.codigo || null,
        ultima_tipificacion: tip?.descripcion || null,
        gestiones_count: gestionesMap.get(ct.id) ?? 0,
        gestiones_hoy: gestionesHoyMap.get(ct.id) ?? 0,
        agendamiento_hora: ct.agendamientos?.[0]?.fechaHora
          ? new Date(ct.agendamientos[0].fechaHora).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false })
          : null,
        // Datetime crudo del compromiso vigente → excluir de vueltas hasta que pase la hora
        agendamiento_fecha_hora: ct.agendamientos?.[0]?.fechaHora
          ? new Date(ct.agendamientos[0].fechaHora).toISOString()
          : null,
        agendamiento_tipo: ct.agendamientos?.[0]?.tipo || null,
      };
    }));
  } catch (err) { next(err); }
});

// ── GET /api/bitacora?limite=N ────────────────────────────────────────────────
router.get('/bitacora', async (req, res, next) => {
  try {
    const asesorId = req.user.id;
    const limite   = Math.min(parseInt(req.query.limite) || 200, 500);

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
    const ck = `ranking-general:${fecha}`;
    const hit = cache.get(ck);
    if (hit) return res.json(hit);

    // Solo asesores actualmente conectados por WS
    const { asesores: conectados } = getConnectedStats();
    const idsConectados = new Set(conectados.map(a => Number(a.asesor_id)));

    // Si no hay nadie conectado, devolver array vacío
    if (idsConectados.size === 0) return res.json([]);

    const asesores = await db.$queryRaw`
      SELECT id, nombre FROM usuarios
      WHERE rol = 'asesor' AND estado = 'activo'
      ORDER BY nombre ASC
    `;

    // Filtrar solo los que están conectados ahora mismo
    const asesoresFiltrados = asesores.filter(a => idsConectados.has(Number(a.id)));

    const ranking = asesoresFiltrados.map(a => ({
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

    // CDRs del día — competencia diaria, cuenta todas las llamadas del día
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

    // Eventos ACCION_RAPIDA del día — competencia diaria, cuenta todas las acciones del día
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

    cache.set(ck, ranking, 20_000);
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
    const campanaId = req.query.campana_id ? parseInt(req.query.campana_id) : null;
    const ck = `indicadores-cobranza:${campanaId || 'global'}`;
    const hit = cache.get(ck);
    if (hit) return res.json(hit);
    const campanaFilter = campanaId ? Prisma.sql`WHERE campana_id = ${campanaId}` : Prisma.empty;

    const global = await db.$queryRaw(Prisma.sql`
      SELECT
        COALESCE(SUM(monto_deuda), 0)::float                                          AS valor_vencido,
        COALESCE(SUM(CASE WHEN ya_pago = true THEN monto_deuda ELSE 0 END), 0)::float AS valor_cobrado,
        COUNT(*)::int                                                                  AS unidades_vencidas,
        SUM(CASE WHEN ya_pago = true THEN 1 ELSE 0 END)::int                          AS unidades_cobradas
      FROM contactos
      ${campanaFilter}
    `);
    const g = global[0] || {};
    const gVen = Number(g.valor_vencido || 0);
    const gCob = Number(g.valor_cobrado || 0);
    const gUVen = Number(g.unidades_vencidas || 0);
    const gUCob = Number(g.unidades_cobradas || 0);

    const segRows = await db.$queryRaw(Prisma.sql`
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
      ${campanaFilter}
      GROUP BY 1
    `);

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

    const result = {
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
    };
    cache.set(ck, result, 60_000);
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/tipificaciones ───────────────────────────────────────────────────
router.get('/tipificaciones', async (req, res, next) => {
  try {
    const ck = 'tipificaciones:all';
    const hit = cache.get(ck);
    if (hit) return res.json(hit);
    const tips = await db.tipificacion.findMany({ orderBy: { id: 'asc' } });
    const result = tips.map(t => ({ ...t, requiere_agd: t.requiereAgd }));
    cache.set(ck, result, 300_000); // 5 min — las tipificaciones casi nunca cambian
    res.json(result);
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
        co.ya_pago,
        EXISTS (
          SELECT 1 FROM validacion_pagos vp
          WHERE vp.contacto_id = co.id AND vp.estado_pago = 'ABONO_PARCIAL'
        ) AS tiene_abono,
        COALESCE(
          c.scheduled_datetime,
          (
            SELECT ag.fecha_hora FROM agendamientos ag
            WHERE ag.contacto_id = c.contacto_id AND ag.asesor_id = c.usuario_id
              AND ag.estado NOT IN ('cancelado', 'ejecutado')
            ORDER BY ag.id DESC LIMIT 1
          )
        ) AS fecha_promesa
      FROM cdrs c
      JOIN tipificaciones t ON c.tipificacion_id = t.id
      LEFT JOIN contactos co ON co.id = c.contacto_id
      WHERE c.usuario_id = ${asesorId}
        AND t.codigo = ANY(${codigos})
        AND (
          DATE(c.timestamp_inicio AT TIME ZONE 'America/Guayaquil') = ${fecha}::date
          OR EXISTS (
            SELECT 1 FROM agendamientos ag
            WHERE ag.contacto_id = c.contacto_id AND ag.asesor_id = c.usuario_id
              AND ag.estado NOT IN ('cancelado', 'ejecutado')
              AND DATE(ag.fecha_hora AT TIME ZONE 'America/Guayaquil') = ${fecha}::date
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
        ya_pago: r.ya_pago === true || r.ya_pago === 1,
        tiene_abono: r.tiene_abono === true || r.tiene_abono === 't',
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

    const cdrOwner = await db.cdr.findUnique({ where: { id: Number(cdrId) }, select: { usuarioId: true } });
    if (!cdrOwner) return res.status(404).json({ error: 'CDR no encontrado' });
    if (!isSupervisor(req.user.rol) && cdrOwner.usuarioId !== req.user.id) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

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

    const cdr = await db.cdr.findUnique({ where: { id: Number(cdrId) }, select: { contactoId: true, usuarioId: true } });
    if (cdr?.contactoId) {
      await db.contacto.update({
        where: { id: cdr.contactoId },
        data: { yaPago: true, estadoMarcacion: 'YA_PAGO' },
      });
      await db.agendamiento.updateMany({
        where: {
          contactoId: cdr.contactoId,
          estado: { notIn: ['cancelado', 'ejecutado'] },
        },
        data: { estado: 'ejecutado' },
      });
      broadcastToAll({ tipo: 'PAGO_VALIDADO', contactoIds: [cdr.contactoId], abonoIds: [] });
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
    if (!isSupervisor(req.user.rol) && cdr.usuarioId !== req.user.id) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

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
    if (!isSupervisor(req.user.rol) && cdr.usuarioId !== req.user.id) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

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

// ── GET /api/reports/gestiones_equipo  &  /api/reports/gestiones ─────────────
// Genera y descarga xlsx con CDRs del día (o rango) del equipo / asesor.
async function _buildGestionesXlsx(res, { asesorId, fechaInicio, fechaFin, titulo, empresa, campanaId }) {
  // naive-UTC: agregar .000Z para que Prisma compare contra timestamp WITHOUT TIME ZONE correcto
  const inicio = new Date(fechaInicio + 'T00:00:00.000Z');
  const fin    = new Date((fechaFin || fechaInicio) + 'T23:59:59.999Z');
  const _emp = ['TEC_SAS', 'SCC', 'CREDI_TV', 'UPHONE'].includes(empresa) ? empresa : null;
  const empresaPrisma = _emp === 'UPHONE' ? { in: ['TEC_SAS', 'SCC'] } : _emp || undefined;
  const campId = campanaId ? parseInt(campanaId) : null;

  const contactoWhere = {
    ...(empresaPrisma ? { empresa: empresaPrisma } : {}),
    ...(campId ? { campanaId: campId } : {}),
  };

  const cdrs = await db.cdr.findMany({
    where: {
      ...(asesorId ? { usuarioId: asesorId } : {}),
      timestampInicio: { gte: inicio, lte: fin },
      ...(Object.keys(contactoWhere).length ? { contacto: contactoWhere } : {}),
    },
    select: {
      id: true,
      timestampInicio: true,
      montoAcordado: true,
      notas: true,
      scheduledDatetime: true,
      usuario:      { select: { nombre: true } },
      tipificacion: { select: { codigo: true, descripcion: true } },
      contacto: {
        select: {
          nombreDeudor: true,
          cedula: true,
          telefono: true,
          metadata: true,
          agendamientos: {
            where: { estado: { notIn: ['cancelado', 'ejecutado'] } },
            select: { fechaHora: true },
            orderBy: { id: 'desc' },
            take: 1,
          },
        },
      },
    },
    orderBy: { timestampInicio: 'desc' },
  });

  const COLS = [
    'Fecha/Hora', 'Asesor', 'Cliente', 'CI/Cédula', 'Teléfono',
    'Empresa', 'Contrato', 'Tipificación',
    'Monto Acordado', 'Fecha Promesa', 'Mora Cliente', 'Días Mora', 'Observaciones',
    '# Gestiones',
  ];
  const COMPROMISO_CODES = new Set(['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP']);

  // Contar gestiones por contacto en el período (sin query adicional)
  const gestionesPorContacto = new Map();
  for (const c of cdrs) {
    if (c.contacto) {
      const cid = c.contacto.nombreDeudor + '|' + (c.contacto.cedula || '');
      gestionesPorContacto.set(cid, (gestionesPorContacto.get(cid) || 0) + 1);
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'UPHONE-CRM';
  const ws = wb.addWorksheet('Gestiones');

  ws.mergeCells(`A1:N1`);
  ws.getCell('A1').value = titulo;
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF58A6FF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
  ws.getCell('A1').alignment = { horizontal: 'center' };

  ws.addRow([]);
  const hRow = ws.addRow(COLS);
  hRow.font = { bold: true };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };

  for (const c of cdrs) {
    const meta = c.contacto?.metadata && typeof c.contacto.metadata === 'object'
      ? c.contacto.metadata : {};
    const empresa  = meta['EMPRESA'] || null;
    const contrato = meta['Nº CONTRATO'] || meta['CONTRATO'] || null;
    const moraRaw  = meta['VALOR EN MORA'];
    const mora     = moraRaw != null ? parseFloat(String(moraRaw).replace(/[^0-9.-]/g, '')) || null : null;
    const diasRaw  = meta['DIAS IMPAGO'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || meta['DIAS EN MORA'];
    const diasMora = diasRaw != null ? (parseInt(String(diasRaw), 10) || null) : null;
    const fechaPromesa = c.scheduledDatetime || c.contacto?.agendamientos?.[0]?.fechaHora || null;
    const cid = c.contacto ? c.contacto.nombreDeudor + '|' + (c.contacto.cedula || '') : '';
    const numGestiones = gestionesPorContacto.get(cid) || 1;

    const row = ws.addRow([
      c.timestampInicio ? new Date(c.timestampInicio).toLocaleString('es-EC') : '',
      c.usuario?.nombre || '',
      c.contacto?.nombreDeudor || '',
      c.contacto?.cedula || '',
      c.contacto?.telefono || '',
      empresa || '',
      contrato || '',
      c.tipificacion?.descripcion || c.tipificacion?.codigo || '',
      c.montoAcordado != null ? Number(c.montoAcordado) : '',
      fechaPromesa ? new Date(fechaPromesa).toLocaleString('es-EC') : '',
      mora != null ? mora : '',
      diasMora != null ? diasMora : '',
      c.notas || '',
      numGestiones,
    ]);

    if (COMPROMISO_CODES.has(c.tipificacion?.codigo)) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A2E' } };
      const cellMonto = row.getCell(9);
      if (c.montoAcordado != null) {
        cellMonto.numFmt = '#,##0.00';
        cellMonto.font = { bold: true, color: { argb: 'FF00E676' } };
      } else {
        cellMonto.value = 'SIN CAPTURAR';
        cellMonto.font = { italic: true, color: { argb: 'FFFFB74D' } };
      }
    }
    // Días Mora col 12: naranja si > 0
    if (diasMora != null && diasMora > 0) {
      row.getCell(12).font = { bold: true, color: { argb: 'FFFF9800' } };
    }
    // Resaltar en naranja clientes con > 1 gestión en el período (col 14)
    if (numGestiones > 1) {
      row.getCell(14).font = { bold: true, color: { argb: 'FFFFB74D' } };
    }
  }

  ws.columns.forEach((col, i) => {
    col.width = [20, 18, 22, 14, 14, 14, 14, 22, 14, 20, 14, 10, 40, 12][i] || 16;
  });

  const filename = encodeURIComponent(`${titulo.replace(/[^a-zA-Z0-9_\- ]/g, '_')}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

router.get('/reports/gestiones_equipo', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    let fechaInicio = req.query.fechaInicio || req.query.fecha || new Date().toISOString().slice(0, 10);
    let fechaFin    = req.query.fechaFin    || req.query.fecha_hasta || fechaInicio;
    if (fechaInicio > fechaFin) [fechaInicio, fechaFin] = [fechaFin, fechaInicio];
    const empresa     = req.query.empresa || '';
    const campanaId   = req.query.campana_id || req.query.campanaId || null;
    const equipoIds = (await db.usuario.findMany({
      where: { rol: 'asesor', estado: 'activo', ...(req.user.rol !== 'admin' ? { supervisorId: req.user.id } : {}) },
      select: { id: true },
    })).map(u => u.id);
    const campLabel = campanaId ? ` (apertura #${campanaId})` : '';
    await _buildGestionesXlsx(res, {
      asesorId: equipoIds.length ? { in: equipoIds } : undefined,
      fechaInicio, fechaFin, empresa, campanaId,
      titulo: `Gestiones Equipo${campLabel} — ${fechaInicio}${fechaFin !== fechaInicio ? ' al ' + fechaFin : ''}`,
    });
  } catch (err) { next(err); }
});

router.get('/reports/gestiones', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    let fechaInicio = req.query.fechaInicio || req.query.fecha || new Date().toISOString().slice(0, 10);
    let fechaFin    = req.query.fechaFin    || req.query.fecha_hasta || fechaInicio;
    if (fechaInicio > fechaFin) [fechaInicio, fechaFin] = [fechaFin, fechaInicio];
    const asesorId    = req.query.asesor_id ? parseInt(req.query.asesor_id) : null;
    const empresa     = req.query.empresa || '';
    const campanaId   = req.query.campana_id || req.query.campanaId || null;
    const asesor      = asesorId ? await db.usuario.findUnique({ where: { id: asesorId }, select: { nombre: true } }) : null;
    const campLabel   = campanaId ? ` (apertura #${campanaId})` : '';
    await _buildGestionesXlsx(res, {
      asesorId: asesorId || undefined,
      fechaInicio, fechaFin, empresa, campanaId,
      titulo: `Gestiones${asesor ? ' — ' + asesor.nombre : ''}${campLabel} — ${fechaInicio}${fechaFin !== fechaInicio ? ' al ' + fechaFin : ''}`,
    });
  } catch (err) { next(err); }
});

// ── GET /api/reports/equipo & /api/reports/diario — Informe Operativo ────────
async function _getMetricasAsesor(asesorId, inicio, fin, empresa = null, campanaId = null) {
  const empresaFiltro = ['TEC_SAS', 'SCC', 'CREDI_TV', 'UPHONE'].includes(empresa) ? empresa : null;
  const empresaPrisma = empresaFiltro === 'UPHONE' ? { in: ['TEC_SAS', 'SCC'] } : empresaFiltro;
  const campId = campanaId ? parseInt(campanaId) : null;
  const contactoFilter = {
    ...(empresaPrisma ? { empresa: empresaPrisma } : {}),
    ...(campId ? { campanaId: campId } : {}),
  };

  const cdrWhere = {
    usuarioId: asesorId,
    timestampInicio: { gte: inicio, lte: fin },
    ...(Object.keys(contactoFilter).length ? { contacto: contactoFilter } : {}),
  };

  const [
    totalMarcaciones,
    aggDuracion,
    cdrsConTipif,
    efectivos,
    neutros,
    noContactados,
    compromisos,
    aggComprometido,
    aggRecaudado,
  ] = await Promise.all([
    db.cdr.count({ where: cdrWhere }),
    db.cdr.aggregate({ _sum: { duracionSeg: true }, where: cdrWhere }),
    db.cdr.count({ where: { ...cdrWhere, tipificacionId: { not: null } } }),
    db.cdr.count({ where: { ...cdrWhere, tipificacion: { categoria: { in: ['CONTACTO_EFECTIVO', 'CONTACTO EXITOSO'] } } } }),
    db.cdr.count({ where: { ...cdrWhere, tipificacion: { categoria: { in: ['CONTACTO_NEUTRO', 'CONTACTO NEUTRO'] } } } }),
    db.cdr.count({ where: { ...cdrWhere, tipificacion: { categoria: { in: ['NO_CONTACTADO', 'NO CONTACTADO'] } } } }),
    db.cdr.count({ where: { ...cdrWhere, tipificacion: { codigo: { in: ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP'] } } } }),
    db.cdr.aggregate({ _sum: { montoAcordado: true }, where: { ...cdrWhere, tipificacion: { codigo: { in: ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP'] } } } }),
    db.cdr.aggregate({ _sum: { montoAcordado: true }, where: { ...cdrWhere, resultado: { in: ['PAGO_REAL', 'COMP_CUM'] } } }),
  ]);

  const fechaInicioStr = inicio.toISOString().slice(0, 10);
  const fechaFinStr    = fin.toISOString().slice(0, 10);
  const [wspEnviados, rcsEnviados, correosEnviados] = await Promise.all([
    db.contacto.count({ where: { asignadoA: asesorId, whatsappStatus: 'ENVIADO', wspEnviadoFecha: { gte: fechaInicioStr, lte: fechaFinStr }, ...contactoFilter } }),
    db.contacto.count({ where: { asignadoA: asesorId, rcsStatus: 'ENVIADO', rcsEnviadoFecha: { gte: fechaInicioStr, lte: fechaFinStr }, ...contactoFilter } }),
    db.contacto.count({ where: { asignadoA: asesorId, correoStatus: 'ENVIADO', correoEnviadoFecha: { gte: fechaInicioStr, lte: fechaFinStr }, ...contactoFilter } }),
  ]);

  // Cobertura: DISTINCT nro_contrato con CDR / DISTINCT nro_contrato de la apertura
  // Si hay campana_id, scoped a esa apertura. Si no, scoped a fecha_asignacion del rango.
  const empSqlCob = empresaFiltro === 'UPHONE' ? Prisma.sql`AND co.empresa IN ('TEC_SAS','SCC')`
    : empresaFiltro ? Prisma.sql`AND co.empresa = ${empresaFiltro}` : Prisma.empty;
  const campSqlCob = campId ? Prisma.sql`AND co.campana_id = ${campId}` : Prisma.empty;
  // Apertura scope: si hay campaña → por campaña; si no → por fecha_asignacion del rango
  const aperturaScope = campId
    ? Prisma.sql`AND co.campana_id = ${campId}`
    : Prisma.sql`AND DATE(co.fecha_asignacion) BETWEEN ${fechaInicioStr} AND ${fechaFinStr}`;
  const coberturaRows = await db.$queryRaw`
    SELECT
      COUNT(DISTINCT co.nro_contrato)                                          AS total_contratos,
      COUNT(DISTINCT CASE WHEN c.id IS NOT NULL THEN co.nro_contrato END)      AS gestionados
    FROM contactos co
    LEFT JOIN cdrs c ON c.contacto_id = co.id
      AND c.usuario_id = ${asesorId}
      AND c.timestamp_inicio >= ${inicio}
      AND c.timestamp_inicio <= ${fin}
    WHERE co.asignado_a = ${asesorId}
      ${aperturaScope}
      ${empSqlCob}
      AND co.nro_contrato IS NOT NULL
  `;

  const totalContratos = Number(coberturaRows[0]?.total_contratos || 0);
  const gestionados    = Number(coberturaRows[0]?.gestionados     || 0);
  const cobertura      = totalContratos > 0 ? Math.min(100, Math.round((gestionados / totalContratos) * 100)) : 0;

  const durSeg = aggDuracion._sum.duracionSeg || 0;
  const tiempoAlAire = `${String(Math.floor(durSeg / 3600)).padStart(2,'0')}:${String(Math.floor((durSeg % 3600) / 60)).padStart(2,'0')}:${String(durSeg % 60).padStart(2,'0')}`;

  return {
    empresa: empresaFiltro || 'TODAS',
    totalMarcaciones,
    tiempoAlAire,
    productividad: totalMarcaciones > 0 ? Math.round((cdrsConTipif / totalMarcaciones) * 100) : 0,
    eficacia: cdrsConTipif > 0 ? Math.round((efectivos / cdrsConTipif) * 100) : 0,
    cdrsTotal: cdrsConTipif,
    efectivos,
    neutros,
    noContactados,
    compromisos,
    montoComprometido: Number(aggComprometido._sum.montoAcordado || 0),
    montoRecaudado:    Number(aggRecaudado._sum.montoAcordado    || 0),
    wspEnviados,
    rcsEnviados,
    correosEnviados,
    totalContratos,
    gestionados,
    cobertura,
  };
}

function _addOperativoSheet(wb, dataEquipo, titulo, sheetName = 'Informe Operativo') {
  const COLS = [
    'Asesor','Empresa','Contratos','Gestionados','Cobertura%',
    'Marcaciones','T. Aire','Productividad%','Eficacia%',
    'CDRs','Efectivos','Neutros','No Contactados',
    'Compromisos','M. Comprometido','M. Recaudado',
    'WhatsApp','RCS/SMS','Correos','Total Digital',
  ];
  const ws = wb.addWorksheet(sheetName);

  ws.mergeCells(`A1:T1`);
  const ct = ws.getCell('A1');
  ct.value = titulo;
  ct.font  = { bold: true, size: 13, color: { argb: 'FF58A6FF' } };
  ct.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
  ct.alignment = { horizontal: 'center' };

  ws.addRow([]);
  const hRow = ws.addRow(COLS);
  hRow.font = { bold: true, color: { argb: 'FFF0F6FC' } };
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };

  for (const d of dataEquipo) {
    const td = d.wspEnviados + d.rcsEnviados + d.correosEnviados;
    const row = ws.addRow([
      d.nombre, d.empresa || 'TODAS', d.totalContratos, d.gestionados, d.cobertura,
      d.totalMarcaciones, d.tiempoAlAire, d.productividad, d.eficacia,
      d.cdrsTotal, d.efectivos, d.neutros, d.noContactados,
      d.compromisos, d.montoComprometido, d.montoRecaudado,
      d.wspEnviados, d.rcsEnviados, d.correosEnviados, td,
    ]);
    row.getCell(15).numFmt = '#,##0.00';
    row.getCell(16).numFmt = '#,##0.00';
    // Cobertura: verde si >=80, naranja si <50
    const covCell = row.getCell(5);
    covCell.numFmt = '0"%"';
    if (d.cobertura >= 80)      covCell.font = { bold: true, color: { argb: 'FF00E676' } };
    else if (d.cobertura < 50)  covCell.font = { bold: true, color: { argb: 'FFFF5252' } };
    if (d.efectivos > 0)   row.getCell(11).font = { bold: true, color: { argb: 'FF00E676' } };
    if (d.compromisos > 0) row.getCell(14).font = { bold: true, color: { argb: 'FFFFB74D' } };
  }

  ws.columns = [22,10,11,12,11,13,11,15,12,9,11,10,15,13,17,16,12,12,12,14].map(w => ({ width: w }));
  return ws;
}

function _buildOperativoWb(dataEquipo, titulo) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'UPHONE-CRM';

  // Hoja principal con todos los datos
  _addOperativoSheet(wb, dataEquipo, titulo);

  // Hojas resumen por empresa si hay datos mixtos
  const empresas = [...new Set(dataEquipo.map(d => d.empresa).filter(e => e && e !== 'TODAS'))];
  if (empresas.length > 1) {
    for (const emp of empresas) {
      const subset = dataEquipo.filter(d => d.empresa === emp);
      _addOperativoSheet(wb, subset, `${titulo} — ${emp}`, emp);
    }
  }

  return wb;
}

router.get('/reports/equipo', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    let fechaInicio = req.query.fechaInicio || req.query.fecha || new Date().toISOString().slice(0, 10);
    let fechaFin    = req.query.fechaFin    || req.query.fecha_hasta || fechaInicio;
    if (fechaInicio > fechaFin) [fechaInicio, fechaFin] = [fechaFin, fechaInicio];
    const empresa     = ['TEC_SAS', 'SCC', 'CREDI_TV', 'UPHONE'].includes(req.query.empresa) ? req.query.empresa : null;
    const campanaId   = req.query.campana_id || req.query.campanaId || null;
    const inicio = new Date(fechaInicio + 'T00:00:00.000Z');
    const fin    = new Date((fechaFin || fechaInicio) + 'T23:59:59.999Z');

    const asesores = await db.usuario.findMany({
      where: { rol: 'asesor', estado: 'activo', ...(req.user.rol !== 'admin' ? { supervisorId: req.user.id } : {}) },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });

    // Sin filtro de empresa: generar una fila por asesor×empresa para tener resumen por empresa
    let dataEquipo;
    if (empresa) {
      dataEquipo = await Promise.all(
        asesores.map(async a => ({ nombre: a.nombre, ...await _getMetricasAsesor(a.id, inicio, fin, empresa, campanaId) }))
      );
    } else {
      const rows = await Promise.all(asesores.flatMap(a =>
        ['UPHONE', 'CREDI_TV'].map(async emp => ({ nombre: a.nombre, ...await _getMetricasAsesor(a.id, inicio, fin, emp, campanaId) }))
      ));
      dataEquipo = rows;
    }

    const empLabel  = empresa ? ` — ${empresa}` : '';
    const campLabel = campanaId ? ` (apertura #${campanaId})` : '';
    const titulo    = `Informe Operativo Equipo${empLabel}${campLabel} — ${fechaInicio}${fechaFin !== fechaInicio ? ' al ' + fechaFin : ''}`;
    const filename = encodeURIComponent(`informe_operativo_equipo_${fechaInicio}.xlsx`);
    const wb = _buildOperativoWb(dataEquipo, titulo);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

router.get('/reports/diario', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    let fechaInicio = req.query.fechaInicio || req.query.fecha || new Date().toISOString().slice(0, 10);
    let fechaFin    = req.query.fechaFin    || req.query.fecha_hasta || fechaInicio;
    if (fechaInicio > fechaFin) [fechaInicio, fechaFin] = [fechaFin, fechaInicio];
    const asesorId    = req.query.asesor_id ? parseInt(req.query.asesor_id) : null;
    const empresa     = ['TEC_SAS', 'SCC', 'CREDI_TV', 'UPHONE'].includes(req.query.empresa) ? req.query.empresa : null;
    const campanaId   = req.query.campana_id || req.query.campanaId || null;
    const inicio = new Date(fechaInicio + 'T00:00:00.000Z');
    const fin    = new Date((fechaFin || fechaInicio) + 'T23:59:59.999Z');

    let asesores;
    if (asesorId) {
      const a = await db.usuario.findUnique({ where: { id: asesorId }, select: { id: true, nombre: true } });
      asesores = a ? [a] : [];
    } else {
      asesores = await db.usuario.findMany({
        where: { rol: 'asesor', estado: 'activo', ...(req.user.rol !== 'admin' ? { supervisorId: req.user.id } : {}) },
        select: { id: true, nombre: true },
        orderBy: { nombre: 'asc' },
      });
    }

    let dataEquipo;
    if (empresa) {
      dataEquipo = await Promise.all(
        asesores.map(async a => ({ nombre: a.nombre, ...await _getMetricasAsesor(a.id, inicio, fin, empresa, campanaId) }))
      );
    } else {
      const rows = await Promise.all(asesores.flatMap(a =>
        ['UPHONE', 'CREDI_TV'].map(async emp => ({ nombre: a.nombre, ...await _getMetricasAsesor(a.id, inicio, fin, emp, campanaId) }))
      ));
      dataEquipo = rows;
    }

    const nombreLabel = asesores.length === 1 ? asesores[0].nombre : 'Equipo';
    const empLabel    = empresa ? ` — ${empresa}` : '';
    const campLabel   = campanaId ? ` (apertura #${campanaId})` : '';
    const titulo   = `Informe Operativo — ${nombreLabel}${empLabel}${campLabel} — ${fechaInicio}${fechaFin !== fechaInicio ? ' al ' + fechaFin : ''}`;
    const filename = encodeURIComponent(`informe_operativo_${nombreLabel.replace(/\s+/g, '_')}_${fechaInicio}.xlsx`);
    const wb = _buildOperativoWb(dataEquipo, titulo);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// ── GET /api/reports/vencimientos_gestiones ────────────────────────────────
router.get('/reports/vencimientos_gestiones', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    let fechaInicio = req.query.fechaInicio || req.query.fecha || new Date().toISOString().slice(0, 10);
    let fechaFin    = req.query.fechaFin    || req.query.fecha_hasta || fechaInicio;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(fechaInicio) || !dateRe.test(fechaFin)) {
      return res.status(400).json({ error: 'Parámetro de fecha inválido' });
    }
    if (fechaInicio > fechaFin) [fechaInicio, fechaFin] = [fechaFin, fechaInicio];
    const startTs = new Date(`${fechaInicio}T00:00:00.000Z`);
    const endTs   = new Date(`${fechaFin}T23:59:59.999Z`);
    const _ve = ['TEC_SAS', 'SCC', 'CREDI_TV', 'UPHONE'].includes(req.query.empresa) ? req.query.empresa : '';
    const empC  = (a) => _ve === 'UPHONE' ? `AND ${a}.empresa IN ('TEC_SAS','SCC')` : _ve ? `AND ${a}.empresa = '${_ve}'` : '';

    const _diasExpr = (alias) => `CAST(COALESCE(
      NULLIF(${alias}.metadata->>'DIAS IMPAGO', ''),
      NULLIF(${alias}.metadata->>'DIAS EN INPAGO', ''),
      NULLIF(${alias}.metadata->>'DIAS MORA', ''),
      '-1'
    ) AS INTEGER)`;

    const DIAS_EXPR = _diasExpr('c');  // para contactos alias c
    const DIAS_CT   = _diasExpr('ct'); // para JOIN contactos ct

    // UNIDADES: apertura diaria (contactos asignados ese día via fecha_asignacion)
    const unidadesRows = await db.$queryRawUnsafe(`
      SELECT DATE(c.fecha_asignacion AT TIME ZONE 'America/Guayaquil') AS fecha,
        ${DIAS_EXPR} AS dias,
        COUNT(*) AS unidades,
        COALESCE(SUM(CAST(NULLIF(TRIM(c.metadata->>'VALOR EN MORA'), '') AS NUMERIC)), 0) AS dinero
      FROM contactos c
      WHERE DATE(c.fecha_asignacion AT TIME ZONE 'America/Guayaquil') BETWEEN $1 AND $2
        AND ${DIAS_EXPR} IN (0, 1, 2)
        AND c.fecha_asignacion IS NOT NULL
        ${empC('c')}
      GROUP BY fecha, dias
    `, fechaInicio, fechaFin);

    const unidadesMap = {};
    for (const r of unidadesRows) {
      const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : r.fecha.toISOString().slice(0, 10);
      if (!unidadesMap[f]) unidadesMap[f] = {};
      unidadesMap[f][Number(r.dias)] = { unidades: Number(r.unidades), dinero: Number(r.dinero) };
    }

    // Total por día (todos los segmentos)
    const totalDiaRows = await db.$queryRawUnsafe(`
      SELECT DATE(fecha_asignacion AT TIME ZONE 'America/Guayaquil') AS fecha,
        COUNT(*) AS u,
        COALESCE(SUM(CAST(NULLIF(TRIM(metadata->>'VALOR EN MORA'), '') AS NUMERIC)), 0) AS d
      FROM contactos
      WHERE DATE(fecha_asignacion AT TIME ZONE 'America/Guayaquil') BETWEEN $1 AND $2
        AND fecha_asignacion IS NOT NULL
        ${_ve === 'UPHONE' ? "AND empresa IN ('TEC_SAS','SCC')" : _ve ? `AND empresa = '${_ve}'` : ''}
      GROUP BY fecha
    `, fechaInicio, fechaFin);

    const totalDiaMap = {};
    for (const r of totalDiaRows) {
      const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : r.fecha.toISOString().slice(0, 10);
      totalDiaMap[f] = { u: Number(r.u), d: Number(r.d) };
    }

    // CDRs diarios por segmento — fecha en hora local Ecuador
    const cdrsRows = await db.$queryRawUnsafe(`
      SELECT DATE(c.timestamp_inicio AT TIME ZONE 'America/Guayaquil') AS fecha,
        ${DIAS_CT} AS dias,
        COUNT(*) AS gestiones,
        SUM(CASE WHEN c.canal = 'whatsapp' THEN 1 ELSE 0 END) AS whasp,
        SUM(CASE WHEN c.canal = 'llamada'  THEN 1 ELSE 0 END) AS llamadas
      FROM cdrs c
      JOIN contactos ct ON ct.id = c.contacto_id
      WHERE c.timestamp_inicio >= $1 AND c.timestamp_inicio <= $2
        AND ${DIAS_CT} IN (0, 1, 2)
        ${empC('ct')}
      GROUP BY fecha, dias
    `, startTs, endTs);

    const cdrsMap = {};
    for (const r of cdrsRows) {
      const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : r.fecha.toISOString().slice(0, 10);
      if (!cdrsMap[f]) cdrsMap[f] = {};
      cdrsMap[f][Number(r.dias)] = { gestiones: Number(r.gestiones), whasp: Number(r.whasp), llamadas: Number(r.llamadas) };
    }

    // Contactos únicos gestionados por día/segmento — solo de la apertura de ESE día.
    // Filtramos por fecha_asignacion = fecha del CDR/bulk para no inflar el pct con
    // contactos de aperturas anteriores gestionados en el mismo día.
    // Cobertura acumulada: agrupa por fecha de APERTURA (fecha_asignacion), no por fecha de CDR.
    // Un contacto de la apertura del 24 gestionado el 25, 26 o 27 SÍ cuenta en el 24.
    const unicosRows = await db.$queryRawUnsafe(`
      SELECT fecha, dias, COUNT(DISTINCT ct_id) AS gestionados_unicos
      FROM (
        SELECT DATE(ct.fecha_asignacion AT TIME ZONE 'America/Guayaquil') AS fecha,
          ${DIAS_CT} AS dias,
          c.contacto_id AS ct_id
        FROM cdrs c
        JOIN contactos ct ON ct.id = c.contacto_id
        WHERE c.timestamp_inicio >= $1 AND c.timestamp_inicio <= $2
          AND DATE(ct.fecha_asignacion AT TIME ZONE 'America/Guayaquil') BETWEEN $3 AND $4
          AND ${DIAS_CT} IN (0, 1, 2)
          ${empC('ct')}
        UNION
        SELECT DATE(c.fecha_asignacion AT TIME ZONE 'America/Guayaquil') AS fecha,
          ${_diasExpr('c')} AS dias,
          c.id AS ct_id
        FROM contactos c
        WHERE c.wsp_enviado_fecha BETWEEN '${fechaInicio}' AND '${fechaFin}'
          AND DATE(c.fecha_asignacion AT TIME ZONE 'America/Guayaquil') BETWEEN '${fechaInicio}'::date AND '${fechaFin}'::date
          AND ${_diasExpr('c')} IN (0, 1, 2)
          ${empC('c')}
        UNION
        SELECT DATE(c.fecha_asignacion AT TIME ZONE 'America/Guayaquil') AS fecha,
          ${_diasExpr('c')} AS dias,
          c.id AS ct_id
        FROM contactos c
        WHERE c.rcs_enviado_fecha BETWEEN '${fechaInicio}' AND '${fechaFin}'
          AND DATE(c.fecha_asignacion AT TIME ZONE 'America/Guayaquil') BETWEEN '${fechaInicio}'::date AND '${fechaFin}'::date
          AND ${_diasExpr('c')} IN (0, 1, 2)
          ${empC('c')}
        UNION
        SELECT DATE(c.fecha_asignacion AT TIME ZONE 'America/Guayaquil') AS fecha,
          ${_diasExpr('c')} AS dias,
          c.id AS ct_id
        FROM contactos c
        WHERE c.correo_enviado_fecha BETWEEN '${fechaInicio}' AND '${fechaFin}'
          AND DATE(c.fecha_asignacion AT TIME ZONE 'America/Guayaquil') BETWEEN '${fechaInicio}'::date AND '${fechaFin}'::date
          AND ${_diasExpr('c')} IN (0, 1, 2)
          ${empC('c')}
      ) sub
      GROUP BY fecha, dias
    `, startTs, endTs, fechaInicio, fechaFin);

    const unicosMap = {};
    for (const r of unicosRows) {
      const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : r.fecha.toISOString().slice(0, 10);
      if (!unicosMap[f]) unicosMap[f] = {};
      unicosMap[f][Number(r.dias)] = Number(r.gestionados_unicos);
    }

    // Compromisos diarios por segmento — fecha en hora local Ecuador
    const compRows = await db.$queryRawUnsafe(`
      SELECT DATE(c.timestamp_inicio AT TIME ZONE 'America/Guayaquil') AS fecha,
        ${DIAS_CT} AS dias,
        COUNT(*) AS compromisos
      FROM cdrs c
      JOIN contactos ct ON ct.id = c.contacto_id
      JOIN tipificaciones t ON t.id = c.tipificacion_id
      WHERE c.timestamp_inicio >= $1 AND c.timestamp_inicio <= $2
        AND t.codigo IN ('PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP')
        AND (c.resultado IS NULL OR c.resultado != 'INCUMP')
        AND ${DIAS_CT} IN (0, 1, 2)
        ${empC('ct')}
      GROUP BY fecha, dias
    `, startTs, endTs);

    const compMap = {};
    for (const r of compRows) {
      const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : r.fecha.toISOString().slice(0, 10);
      if (!compMap[f]) compMap[f] = {};
      compMap[f][Number(r.dias)] = Number(r.compromisos);
    }

    // Envíos masivos (WhatsApp/RCS/correo bulk) — registrados en contactos, no en cdrs
    const bulkWspRows = await db.$queryRawUnsafe(`
      SELECT c.wsp_enviado_fecha AS fecha,
        ${DIAS_EXPR} AS dias,
        COUNT(*) AS cnt
      FROM contactos c
      WHERE c.wsp_enviado_fecha BETWEEN '${fechaInicio}' AND '${fechaFin}'
        AND ${DIAS_EXPR} IN (0, 1, 2)
        ${empC('c')}
      GROUP BY fecha, dias
    `);

    const bulkRcsRows = await db.$queryRawUnsafe(`
      SELECT c.rcs_enviado_fecha AS fecha,
        ${DIAS_EXPR} AS dias,
        COUNT(*) AS cnt
      FROM contactos c
      WHERE c.rcs_enviado_fecha BETWEEN '${fechaInicio}' AND '${fechaFin}'
        AND ${DIAS_EXPR} IN (0, 1, 2)
        ${empC('c')}
      GROUP BY fecha, dias
    `);

    const bulkCorreoRows = await db.$queryRawUnsafe(`
      SELECT c.correo_enviado_fecha AS fecha,
        ${DIAS_EXPR} AS dias,
        COUNT(*) AS cnt
      FROM contactos c
      WHERE c.correo_enviado_fecha BETWEEN '${fechaInicio}' AND '${fechaFin}'
        AND ${DIAS_EXPR} IN (0, 1, 2)
        ${empC('c')}
      GROUP BY fecha, dias
    `);

    const bulkMap = {};
    const _addBulk = (rows, field) => {
      for (const r of rows) {
        const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : String(r.fecha);
        if (!bulkMap[f]) bulkMap[f] = {};
        if (!bulkMap[f][Number(r.dias)]) bulkMap[f][Number(r.dias)] = { whasp: 0, rcs: 0, correo: 0 };
        bulkMap[f][Number(r.dias)][field] += Number(r.cnt);
      }
    };
    _addBulk(bulkWspRows, 'whasp');
    _addBulk(bulkRcsRows, 'rcs');
    _addBulk(bulkCorreoRows, 'correo');

    // Generar filas por día
    const SEGS = [0, 1, 2];
    const DIAS_SEMANA = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
    const dataRows = [];
    const inicio = new Date(fechaInicio + 'T12:00:00');
    const fin    = new Date(fechaFin    + 'T12:00:00');
    for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
      const fecha   = d.toISOString().slice(0, 10);
      const totDia  = totalDiaMap[fecha] || { u: 0, d: 0 };
      const row     = { fecha, dia: DIAS_SEMANA[d.getDay()], total_unidades: totDia.u, total_dinero: totDia.d, segmentos: {} };
      for (const dias of SEGS) {
        const s = (unidadesMap[fecha] || {})[dias] || { unidades: 0, dinero: 0 };
        const c = (cdrsMap[fecha] || {})[dias] || { gestiones: 0, whasp: 0, llamadas: 0 };
        const b = (bulkMap[fecha] || {})[dias] || { whasp: 0, rcs: 0, correo: 0 };
        const compromisos    = (compMap[fecha] || {})[dias] || 0;
        const totalWhasp     = c.whasp + b.whasp;
        const totalGestiones = c.gestiones + b.whasp + b.rcs + b.correo;
        // Usar contactos únicos gestionados (CDR UNION bulk) para pct_cartera
        // evita que CDRs múltiples por contacto + bulk infle sobre el 100%.
        const gestionadosUnicos = (unicosMap[fecha] || {})[dias] || 0;
        row.segmentos[dias] = {
          unidades:    s.unidades,
          dinero:      s.dinero,
          gestiones:   totalGestiones,
          whasp:       totalWhasp,
          llamadas:    c.llamadas,
          compromisos,
          pct_cartera: s.unidades > 0 ? Math.min(1, gestionadosUnicos / s.unidades) : 0,
        };
      }
      dataRows.push(row);
    }

    // Construir Excel
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Vencimientos y Gestiones');

    const colLetter = n => { let s = ''; while (n > 0) { const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26); } return s; };
    const COL_W = [12,12,10,14,11,9,11,13,11,10,14,11,9,11,13,11,10,14,11,9,11,13,11,12,14];
    ws.columns = COL_W.map(w => ({ width: w }));
    const LAST = colLetter(COL_W.length);

    ws.mergeCells(`A1:${LAST}1`);
    const cT = ws.getCell('A1');
    cT.value = 'VENCIMIENTOS Y NUMERO DE GESTIONES';
    cT.font  = { bold: true, size: 14, color: { argb: 'FF00E5FF' } };
    cT.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
    cT.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    ws.addRow([]);
    ws.getRow(2).height = 20;
    const SEG_STARTS = [3, 10, 17];
    const SEG_LABELS = ['0 DÍAS', '1 DÍA', '2 DÍAS'];
    SEG_LABELS.forEach((label, i) => {
      const sc = colLetter(SEG_STARTS[i]);
      const ec = colLetter(SEG_STARTS[i] + 6);
      ws.mergeCells(`${sc}2:${ec}2`);
      const cell = ws.getCell(`${sc}2`);
      cell.value = label;
      cell.font  = { bold: true, size: 10, color: { argb: 'FFF0F6FC' } };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };
      cell.alignment = { horizontal: 'center' };
    });
    ws.mergeCells('X2:Y2');
    const cTot = ws.getCell('X2');
    cTot.value = 'TOTALES'; cTot.font = { bold: true, size: 10, color: { argb: 'FF8B949E' } };
    cTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
    cTot.alignment = { horizontal: 'center' };

    const SUB = ['UNIDADES','DINERO','GESTIONES','WHASP','LLAMADAS','COMPROMISOS','% CARTERA'];
    const hdr3 = ['FECHA','DIA'];
    SEG_LABELS.forEach(() => SUB.forEach(h => hdr3.push(h)));
    hdr3.push('UNIDADES','DINERO');
    const hRow = ws.addRow(hdr3);
    hRow.font  = { bold: true, size: 9 };
    hRow.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };
    ws.getRow(3).height = 20;
    hRow.eachCell(c => { c.alignment = { horizontal: 'center', wrapText: true }; });

    const fmtM   = v => Number(v || 0).toFixed(2);
    const fmtPct = v => `${(Number(v || 0) * 100).toFixed(2)}%`;

    for (const r of dataRows) {
      const cells = [r.fecha, r.dia];
      for (const dias of SEGS) {
        const s = r.segmentos[dias] || {};
        cells.push(s.unidades||0, fmtM(s.dinero), s.gestiones||0, s.whasp||0, s.llamadas||0, s.compromisos||0, fmtPct(s.pct_cartera));
      }
      cells.push(r.total_unidades, fmtM(r.total_dinero));
      const row = ws.addRow(cells);
      row.height = 18;
      row.getCell(1).font = { bold: true };
      [4,11,18].forEach(ci => { if ((row.getCell(ci).value||0)>0) row.getCell(ci).font={bold:true,color:{argb:'FF00E676'}}; });
      [3,10,17,25].forEach(ci => { row.getCell(ci).font={color:{argb:'FFFFB74D'}}; });
      [8,15,22].forEach(ci => { if ((row.getCell(ci).value||0)>0) row.getCell(ci).font={bold:true,color:{argb:'FF00E5FF'}}; });
    }
    ws.views = [{ state: 'frozen', ySplit: 3, xSplit: 2 }];

    const filename = encodeURIComponent(`vencimientos_gestiones_${fechaInicio}_${fechaFin}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// ── GET /api/reports/indicadores_compromisos ───────────────────────────────
router.get('/reports/indicadores_compromisos', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    let fechaInicio = req.query.fechaInicio || req.query.fecha || new Date().toISOString().slice(0, 10);
    let fechaFin    = req.query.fechaFin    || req.query.fecha_hasta || fechaInicio;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(fechaInicio) || !dateRe.test(fechaFin)) {
      return res.status(400).json({ error: 'Parámetro de fecha inválido' });
    }
    if (fechaInicio > fechaFin) [fechaInicio, fechaFin] = [fechaFin, fechaInicio];
    const startTs = new Date(`${fechaInicio}T00:00:00.000Z`);
    const endTs   = new Date(`${fechaFin}T23:59:59.999Z`);
    const _ic = ['TEC_SAS', 'SCC', 'CREDI_TV', 'UPHONE'].includes(req.query.empresa) ? req.query.empresa : '';
    const icEmpC = _ic === 'UPHONE' ? `AND ct.empresa IN ('TEC_SAS','SCC')` : _ic ? `AND ct.empresa = '${_ic}'` : '';

    const DIAS_CT = `CAST(COALESCE(
      NULLIF(ct.metadata->>'DIAS IMPAGO', ''),
      NULLIF(ct.metadata->>'DIAS EN INPAGO', ''),
      NULLIF(ct.metadata->>'DIAS MORA', ''),
      '-1'
    ) AS INTEGER)`;

    const compRows = await db.$queryRawUnsafe(`
      SELECT DATE(c.timestamp_inicio AT TIME ZONE 'America/Guayaquil') AS fecha,
        ${DIAS_CT} AS dias,
        COUNT(*) AS compromisos,
        SUM(CASE WHEN c.resultado = 'COMP_CUM' OR t.codigo = 'PAGO_REAL' THEN 1 ELSE 0 END) AS cumplidos
      FROM cdrs c
      JOIN contactos ct ON ct.id = c.contacto_id
      JOIN tipificaciones t ON t.id = c.tipificacion_id
      WHERE c.timestamp_inicio >= $1 AND c.timestamp_inicio <= $2
        AND t.codigo IN ('PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP')
        AND (c.resultado IS NULL OR c.resultado != 'INCUMP')
        AND ${DIAS_CT} IN (0, 1, 2)
        ${icEmpC}
      GROUP BY fecha, dias
    `, startTs, endTs);

    const compMap = {};
    for (const r of compRows) {
      const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : r.fecha.toISOString().slice(0, 10);
      if (!compMap[f]) compMap[f] = {};
      compMap[f][Number(r.dias)] = { compromisos: Number(r.compromisos), cumplidos: Number(r.cumplidos) };
    }

    const offsetMs   = 7 * 24 * 60 * 60 * 1000;
    const prevInicio = new Date(new Date(fechaInicio + 'T12:00:00').getTime() - offsetMs).toISOString().slice(0, 10);
    const prevFin    = new Date(new Date(fechaFin    + 'T12:00:00').getTime() - offsetMs).toISOString().slice(0, 10);
    const prevStartTs = new Date(`${prevInicio}T00:00:00.000Z`);
    const prevEndTs   = new Date(`${prevFin}T23:59:59.999Z`);

    const prevRows = await db.$queryRawUnsafe(`
      SELECT DATE(c.timestamp_inicio AT TIME ZONE 'America/Guayaquil') AS fecha,
        COUNT(*) AS compromisos,
        SUM(CASE WHEN c.resultado = 'COMP_CUM' OR t.codigo = 'PAGO_REAL' THEN 1 ELSE 0 END) AS cumplidos
      FROM cdrs c
      JOIN tipificaciones t ON t.id = c.tipificacion_id
      WHERE c.timestamp_inicio >= $1 AND c.timestamp_inicio <= $2
        AND t.codigo IN ('PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP')
        AND (c.resultado IS NULL OR c.resultado != 'INCUMP')
      GROUP BY fecha
    `, prevStartTs, prevEndTs);

    const prevByDate = {};
    for (const r of prevRows) {
      const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : r.fecha.toISOString().slice(0, 10);
      const comp = Number(r.compromisos);
      prevByDate[f] = comp > 0 ? Number(r.cumplidos) / comp : 0;
    }

    const prevDates = [];
    const pI = new Date(prevInicio + 'T12:00:00');
    const pF = new Date(prevFin    + 'T12:00:00');
    for (let d = new Date(pI); d <= pF; d.setDate(d.getDate() + 1))
      prevDates.push(d.toISOString().slice(0, 10));

    const DIAS_SEMANA = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
    const dataRows = [];
    const inicio = new Date(fechaInicio + 'T12:00:00');
    const fin    = new Date(fechaFin    + 'T12:00:00');
    let dayIdx   = 0;

    for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
      const fecha   = d.toISOString().slice(0, 10);
      const dayData = compMap[fecha] || {};
      let totalComp = 0, totalCum = 0;
      const segs = {};
      for (const dias of [0, 1, 2]) {
        const s = dayData[dias] || { compromisos: 0, cumplidos: 0 };
        segs[dias] = { compromisos: s.compromisos, cumplidos: s.cumplidos, pct: s.compromisos > 0 ? s.cumplidos / s.compromisos : null };
        totalComp += s.compromisos; totalCum += s.cumplidos;
      }
      const prevFecha = prevDates[dayIdx] || null;
      dataRows.push({ fecha, dia: DIAS_SEMANA[d.getDay()], segmentos: segs, total_compromisos: totalComp, total_cumplidos: totalCum, total_pct: totalComp > 0 ? totalCum / totalComp : null, semana_anterior: prevFecha ? (prevByDate[prevFecha] ?? null) : null });
      dayIdx++;
    }

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Indicadores Compromisos');
    ws.columns = [12,12,11,11,10,11,11,10,11,11,10,12,12,12,14].map(w => ({ width: w }));

    ws.mergeCells('A1:N1');
    const cT = ws.getCell('A1');
    cT.value = 'INDICADORES DE COMPROMISOS DE PAGO';
    cT.font  = { bold: true, size: 13, color: { argb: 'FF00E5FF' } };
    cT.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
    cT.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell('O1').value = 'Semana Anterior';
    ws.getCell('O1').font = { bold: true, size: 10, color: { argb: 'FF8B949E' } };
    ws.getCell('O1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
    ws.getCell('O1').alignment = { horizontal: 'center' };
    ws.getRow(1).height = 26;

    ws.addRow([]);
    ws.getRow(2).height = 18;
    const groups = [['C','E','0 DÍAS (CEROS)'],['F','H','1 DÍA (UNO)'],['I','K','2 DÍAS (DOS)'],['L','N','TOTAL']];
    for (const [sc, ec, label] of groups) {
      ws.mergeCells(`${sc}2:${ec}2`);
      const cell = ws.getCell(`${sc}2`);
      cell.value = label; cell.font = { bold: true, size: 9, color: { argb: 'FFF0F6FC' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };
      cell.alignment = { horizontal: 'center' };
    }

    const hRow = ws.addRow(['fecha','dia','CEROS','CUMPLIDOS','%','UNO','CUMPLIDOS','%','DOS','CUMPLIDOS','%','TOTAL','COMPROMISOS','PORCENTAJE','PORCENTAJE']);
    hRow.font = { bold: true, size: 9 }; hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };
    ws.getRow(3).height = 18;
    hRow.eachCell(c => { c.alignment = { horizontal: 'center', wrapText: true }; });

    const fmtPct = v => v != null ? `${(v*100).toFixed(2)}%` : '0.00%';
    for (const r of dataRows) {
      const s0=r.segmentos[0]||{}, s1=r.segmentos[1]||{}, s2=r.segmentos[2]||{};
      const cells = [r.fecha, r.dia, s0.compromisos||0, s0.cumplidos||0, fmtPct(s0.pct), s1.compromisos||0, s1.cumplidos||0, fmtPct(s1.pct), s2.compromisos||0, s2.cumplidos||0, fmtPct(s2.pct), r.total_compromisos||0, r.total_cumplidos||0, fmtPct(r.total_pct), fmtPct(r.semana_anterior)];
      const row = ws.addRow(cells);
      row.height = 18;
      row.getCell(1).font = { bold: true };
      for (const ci of [5,8,11,14]) {
        const vals = [s0.pct, s1.pct, s2.pct, r.total_pct];
        const raw = vals[[5,8,11,14].indexOf(ci)];
        row.getCell(ci).alignment = { horizontal: 'center' };
        if (raw != null) row.getCell(ci).font = { bold: true, color: { argb: raw>=0.6?'FF00E676':raw>=0.35?'FFFFB74D':'FFEF4444' } };
        else row.getCell(ci).font = { color: { argb: 'FF8B949E' } };
      }
      for (const ci of [3,6,9,12]) { if ((row.getCell(ci).value||0)>0) row.getCell(ci).font={bold:true,color:{argb:'FF00E5FF'}}; row.getCell(ci).alignment={horizontal:'center'}; }
      for (const ci of [4,7,10,13]) { if ((row.getCell(ci).value||0)>0) row.getCell(ci).font={bold:true,color:{argb:'FF00E676'}}; row.getCell(ci).alignment={horizontal:'center'}; }
      row.getCell(15).alignment = { horizontal: 'center' };
      if (r.semana_anterior != null) row.getCell(15).font = { italic: true, color: { argb: 'FF64B5F6' } };
    }
    ws.views = [{ state: 'frozen', ySplit: 3, xSplit: 2 }];

    const filename = encodeURIComponent(`indicadores_compromisos_${fechaInicio}_${fechaFin}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res); res.end();
  } catch (err) { next(err); }
});

// ── GET /api/reports/gestor_marketing ──────────────────────────────────────
router.get('/reports/gestor_marketing', requireRole('supervisor', 'jefe_area', 'admin'), async (req, res, next) => {
  try {
    let fechaInicio = req.query.fechaInicio || req.query.fecha || new Date().toISOString().slice(0, 10);
    let fechaFin    = req.query.fechaFin    || req.query.fecha_hasta || fechaInicio;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(fechaInicio) || !dateRe.test(fechaFin)) {
      return res.status(400).json({ error: 'Parámetro de fecha inválido' });
    }
    if (fechaInicio > fechaFin) [fechaInicio, fechaFin] = [fechaFin, fechaInicio];
    const startTs = new Date(`${fechaInicio}T00:00:00.000Z`);
    const endTs   = new Date(`${fechaFin}T23:59:59.999Z`);
    const _gm = ['TEC_SAS', 'SCC', 'CREDI_TV', 'UPHONE'].includes(req.query.empresa) ? req.query.empresa : '';
    const gmEmpJoin  = _gm ? `JOIN contactos ct ON ct.id = contacto_id` : '';
    const gmEmpWhere = _gm === 'UPHONE' ? `AND ct.empresa IN ('TEC_SAS','SCC')` : _gm ? `AND ct.empresa = '${_gm}'` : '';
    const gmCtEmp    = _gm === 'UPHONE' ? `AND empresa IN ('TEC_SAS','SCC')` : _gm ? `AND empresa = '${_gm}'` : '';

    const asesores = await db.usuario.findMany({
      where: { rol: 'asesor', estado: 'activo' },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });

    // CDRs por asesor por día — fecha hora local Ecuador
    const cdrRows = await db.$queryRawUnsafe(`
      SELECT DATE(timestamp_inicio AT TIME ZONE 'America/Guayaquil') AS fecha,
        usuario_id, COUNT(*) AS gestiones
      FROM cdrs
      ${gmEmpJoin}
      WHERE timestamp_inicio >= $1 AND timestamp_inicio <= $2
        ${gmEmpWhere}
      GROUP BY fecha, usuario_id
    `, startTs, endTs);

    const cdrMap = {};
    for (const r of cdrRows) {
      const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : r.fecha.toISOString().slice(0, 10);
      if (!cdrMap[f]) cdrMap[f] = {};
      cdrMap[f][Number(r.usuario_id)] = Number(r.gestiones);
    }

    // Envíos bulk (WhatsApp/RCS/correo) por asesor por día — atribuidos a asignado_a
    const bulkWspRows = await db.$queryRawUnsafe(`
      SELECT wsp_enviado_fecha AS fecha, asignado_a AS usuario_id, COUNT(*) AS cnt
      FROM contactos
      WHERE wsp_enviado_fecha BETWEEN $1 AND $2 AND asignado_a IS NOT NULL
        ${gmCtEmp}
      GROUP BY fecha, usuario_id
    `, fechaInicio, fechaFin);

    const bulkRcsRows = await db.$queryRawUnsafe(`
      SELECT rcs_enviado_fecha AS fecha, asignado_a AS usuario_id, COUNT(*) AS cnt
      FROM contactos
      WHERE rcs_enviado_fecha BETWEEN $1 AND $2 AND asignado_a IS NOT NULL
        ${gmCtEmp}
      GROUP BY fecha, usuario_id
    `, fechaInicio, fechaFin);

    const bulkCorreoRows = await db.$queryRawUnsafe(`
      SELECT correo_enviado_fecha AS fecha, asignado_a AS usuario_id, COUNT(*) AS cnt
      FROM contactos
      WHERE correo_enviado_fecha BETWEEN $1 AND $2 AND asignado_a IS NOT NULL
        ${gmCtEmp}
      GROUP BY fecha, usuario_id
    `, fechaInicio, fechaFin);

    for (const rows of [bulkWspRows, bulkRcsRows, bulkCorreoRows]) {
      for (const r of rows) {
        const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : String(r.fecha);
        const uid = Number(r.usuario_id);
        if (!cdrMap[f]) cdrMap[f] = {};
        cdrMap[f][uid] = (cdrMap[f][uid] || 0) + Number(r.cnt);
      }
    }

    const offsetMs   = 7 * 24 * 60 * 60 * 1000;
    const prevInicio = new Date(new Date(fechaInicio + 'T12:00:00').getTime() - offsetMs).toISOString().slice(0, 10);
    const prevFin    = new Date(new Date(fechaFin    + 'T12:00:00').getTime() - offsetMs).toISOString().slice(0, 10);
    const prevStartTs = new Date(`${prevInicio}T00:00:00.000Z`);
    const prevEndTs   = new Date(`${prevFin}T23:59:59.999Z`);

    const prevRows = await db.$queryRawUnsafe(`
      SELECT DATE(timestamp_inicio AT TIME ZONE 'America/Guayaquil') AS fecha,
        COUNT(*) AS gestiones
      FROM cdrs
      WHERE timestamp_inicio >= $1 AND timestamp_inicio <= $2
      GROUP BY fecha
    `, prevStartTs, prevEndTs);

    const prevByDate = {};
    for (const r of prevRows) {
      const f = typeof r.fecha === 'string' ? r.fecha.slice(0, 10) : r.fecha.toISOString().slice(0, 10);
      prevByDate[f] = Number(r.gestiones);
    }

    const prevDates = [];
    const pI = new Date(prevInicio + 'T12:00:00');
    const pF = new Date(prevFin    + 'T12:00:00');
    for (let d = new Date(pI); d <= pF; d.setDate(d.getDate() + 1))
      prevDates.push(d.toISOString().slice(0, 10));

    const DIAS_SEMANA = ['DOMINGO','LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO'];
    const dataRows = [];
    const inicio = new Date(fechaInicio + 'T12:00:00');
    const fin    = new Date(fechaFin    + 'T12:00:00');
    let dayIdx   = 0;

    for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
      const fecha   = d.toISOString().slice(0, 10);
      const dayData = cdrMap[fecha] || {};
      const valores = {};
      let suma = 0, count = 0;
      for (const a of asesores) {
        const v = dayData[a.id] || 0;
        valores[a.id] = v;
        if (v > 0) { suma += v; count++; }
      }
      const diasProm  = count > 0 ? +(suma / count).toFixed(2) : null;
      const prevFecha = prevDates[dayIdx] || null;
      const prevGest  = prevFecha ? (prevByDate[prevFecha] || 0) : 0;
      const prevProm  = prevGest > 0 ? +(prevGest / Math.max(1, asesores.length)).toFixed(2) : null;
      dataRows.push({ fecha, dia: DIAS_SEMANA[d.getDay()], valores, dias_prom: diasProm, anterior_semana: prevProm });
      dayIdx++;
    }

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Gestor de Marketing');
    const colLetter = n => { let s=''; while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s; };
    const totalCols = 2 + asesores.length + 2;
    const LAST = colLetter(totalCols);

    const colWidths = [12, 12, ...asesores.map(() => 12), 10, 16];
    ws.columns = colWidths.map(w => ({ width: w }));

    ws.mergeCells(`A1:${LAST}1`);
    const cT = ws.getCell('A1');
    cT.value = 'GESTOR DE MARKETING';
    cT.font  = { bold: true, size: 14, color: { argb: 'FF00E5FF' } };
    cT.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D1117' } };
    cT.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 28;

    const hdr2 = ['FECHA', 'DIA', ...asesores.map(a => a.nombre.toUpperCase()), 'DIAS', 'ANTERIOR SEMANA'];
    const hRow = ws.addRow(hdr2);
    hRow.font = { bold: true, size: 10 };
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161B22' } };
    ws.getRow(2).height = 22;
    hRow.eachCell(c => { c.alignment = { horizontal: 'center', wrapText: true }; });

    for (const r of dataRows) {
      const cells = [r.fecha, r.dia, ...asesores.map(a => r.valores[a.id] || 0), r.dias_prom ?? '', r.anterior_semana ?? ''];
      const row = ws.addRow(cells);
      row.height = 18;
      row.getCell(1).font = { bold: true };
      const prom = r.dias_prom || 0;
      for (let i = 0; i < asesores.length; i++) {
        const ci  = i + 3;
        const val = r.valores[asesores[i].id] || 0;
        const cell = row.getCell(ci);
        cell.alignment = { horizontal: 'center' };
        if (val === 0) cell.font = { color: { argb: 'FF8B949E' } };
        else if (val >= prom) cell.font = { bold: true, color: { argb: 'FF00E676' } };
        else cell.font = { color: { argb: 'FFFFB74D' } };
      }
      row.getCell(asesores.length + 3).font = { bold: true, color: { argb: 'FF00E5FF' } };
      row.getCell(asesores.length + 3).alignment = { horizontal: 'center' };
      row.getCell(asesores.length + 4).font = { color: { argb: 'FF64B5F6' } };
      row.getCell(asesores.length + 4).alignment = { horizontal: 'center' };
    }
    ws.views = [{ state: 'frozen', ySplit: 2, xSplit: 2 }];

    const filename = encodeURIComponent(`gestor_marketing_${fechaInicio}_${fechaFin}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// ── GET /api/ranking-apertura/:campanaId — Líder recaudado y unidades ──
router.get('/ranking-apertura/:campanaId', async (req, res, next) => {
  try {
    const campanaId = parseInt(req.params.campanaId, 10);
    if (!campanaId || isNaN(campanaId)) return res.status(400).json({ error: 'campanaId inválido' });
    const ck = `ranking-apertura:${campanaId}`;
    const hit = cache.get(ck);
    if (hit) return res.json(hit);

    const recaudadoRows = await db.$queryRaw`
      SELECT u.nombre, COALESCE(SUM(vp.monto_pagado), 0)::float AS monto
      FROM validacion_pagos vp
      JOIN contactos c ON c.id = vp.contacto_id
      JOIN usuarios u ON u.id = c.asignado_a
      WHERE c.campana_id = ${campanaId}
        AND u.rol = 'asesor'
        AND u.estado = 'activo'
      GROUP BY u.id, u.nombre
      ORDER BY monto DESC
      LIMIT 1
    `;

    const unidadesRows = await db.$queryRaw`
      SELECT u.nombre, COUNT(*)::int AS count
      FROM contactos c
      JOIN usuarios u ON u.id = c.asignado_a
      WHERE c.campana_id = ${campanaId}
        AND c.ya_pago = true
        AND u.rol = 'asesor'
        AND u.estado = 'activo'
      GROUP BY u.id, u.nombre
      ORDER BY count DESC
      LIMIT 1
    `;

    const result = {
      recaudado: recaudadoRows[0]
        ? { nombre: recaudadoRows[0].nombre, monto: Number(recaudadoRows[0].monto) }
        : null,
      unidades: unidadesRows[0]
        ? { nombre: unidadesRows[0].nombre, count: Number(unidadesRows[0].count) }
        : null,
    };
    cache.set(ck, result, 30_000);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
