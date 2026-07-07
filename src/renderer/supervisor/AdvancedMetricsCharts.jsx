import React, { useMemo, useRef, useEffect, useState } from 'react';

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  if (!ws || ws === '127.0.0.1' || ws === 'localhost') return null;
  return (ws.startsWith('http') ? ws.replace(/\/$/, '') : `http://${ws}:3001`) + '/api';
}
async function vmFetch(apiBase, token, path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area, LabelList,
  ComposedChart,
} from 'recharts';
import MetricDetailModal from './MetricDetailModal';
import AnalisisCartera, { CumplimientoMetas } from './EvolucionCartera';
import ContactabilidadDrillDown from './ContactabilidadDrillDown';
import { todayLocalISO } from '../shared/timeUtils';

const COLORS = ['#00E5FF', '#2979FF', '#651FFF', '#00B0FF', '#1DE9B6'];
const C_DANGER = '#ff5252';
const C_WARN   = '#ff9800';

const fmt$ = (n) => {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const chartTooltipStyle = { background: '#121212', border: '1px solid #333', borderRadius: 8 };
const cardStyle = { cursor: 'pointer', transition: 'transform 0.2s' };
const onEnter = (e) => { e.currentTarget.style.transform = 'translateY(-2px)'; };
const onLeave = (e) => { e.currentTarget.style.transform = 'translateY(0)'; };

const VOLUMEN_COLORS = ['#00E5FF', '#2979FF', '#651FFF', '#FF6E40', '#1DE9B6', '#FFD740', '#F50057', '#7C4DFF', '#69F0AE', '#FFAB40'];
const SECTION_HEADER_STYLE = { display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 10px' };
const SECTION_TAG_STYLE = { fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.55 };
const SECTION_RULE_STYLE = { flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' };

function AdvancedMetricsCharts({ metricas, metricasEquipo, asesores, estadosWS, onOpenContactabilidad, onOpenVolumen, filtroFechaDesde, filtroFechaHasta, filtroCampana }) {
  const _api   = buildApiBase();
  const _isRem = !!_api;
  const _tok   = localStorage.getItem('auth_token');
  const filtroDesde = filtroFechaDesde || null;
  const filtroHasta = filtroFechaHasta || filtroFechaDesde || null;
  const esRango = !!(filtroDesde && filtroHasta && filtroDesde !== filtroHasta);
  const labelFecha = esRango
    ? `del ${filtroDesde} al ${filtroHasta}`
    : filtroDesde ? `el ${filtroDesde}` : 'hoy';

  const detalleAsesores = metricasEquipo?.detalleAsesores || [];

  // â”€â”€ Filtros locales â€” RotaciÃ³n de Cartera â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [rotFechaInicio, setRotFechaInicio] = useState('');
  const [rotFechaFin,    setRotFechaFin]    = useState('');
  const [rotCampana,     setRotCampana]     = useState('');
  const [rotCampanas,    setRotCampanas]    = useState([]);
  const [rotDetalle,     setRotDetalle]     = useState(null); // null = usa detalleAsesores del prop

  // Cargar campaÃ±as disponibles una sola vez
  useEffect(() => {
    (_isRem ? vmFetch(_api, _tok, '/campanas') : window.api.invoke('db:getCampanas'))
      .then(c => setRotCampanas(Array.isArray(c) ? c : [])).catch(() => {});
  }, []);

  // Fetch cuando cambian los filtros locales de rotaciÃ³n
  useEffect(() => {
    const hayFiltroLocal = rotFechaInicio || rotFechaFin || rotCampana;
    if (!hayFiltroLocal) { setRotDetalle(null); return; }

    const opts = {};
    if (rotCampana)     opts.campanaId   = Number(rotCampana);
    if (rotFechaInicio) opts.fechaInicio = rotFechaInicio;
    if (rotFechaFin)    opts.fechaFin    = rotFechaFin;

    const qs = new URLSearchParams();
    if (opts.campanaId)   qs.set('campana_id',  String(opts.campanaId));
    if (opts.fechaInicio) qs.set('fechaInicio', opts.fechaInicio);
    if (opts.fechaFin)    qs.set('fechaFin',    opts.fechaFin);
    const p = _isRem
      ? vmFetch(_api, _tok, `/cartera/rotacion?${qs}`)
      : window.api.invoke('db:getRotacionCarteraPeriodo', opts);
    p.then(d => setRotDetalle(Array.isArray(d) ? d : null))
      .catch(err => { console.error('[ROT_CARTERA]', err); setRotDetalle(null); });
  }, [rotFechaInicio, rotFechaFin, rotCampana]);

  // Sincroniza la card RotaciÃ³n de Cartera con el rango global del panel
  // cuando no hay filtro local activo (filtro local tiene precedencia).
  useEffect(() => {
    const hayFiltroLocal = rotFechaInicio || rotFechaFin || rotCampana;
    if (hayFiltroLocal) return;
    if (!filtroDesde) { setRotDetalle(null); return; }
    const opts = {};
    opts.fechaInicio = filtroDesde;
    if (filtroHasta) opts.fechaFin = filtroHasta;
    const qs2 = new URLSearchParams();
    if (opts.fechaInicio) qs2.set('fechaInicio', opts.fechaInicio);
    if (opts.fechaFin)    qs2.set('fechaFin',    opts.fechaFin);
    const p = _isRem
      ? vmFetch(_api, _tok, `/cartera/rotacion?${qs2}`)
      : window.api.invoke('db:getRotacionCarteraPeriodo', opts);
    p.then(d => setRotDetalle(Array.isArray(d) ? d : null)).catch(() => setRotDetalle(null));
  }, [filtroDesde, filtroHasta, rotFechaInicio, rotFechaFin, rotCampana]);

  // Datos activos: filtro local > prop global
  const rotDetalleActivo = rotDetalle ?? detalleAsesores;

  // â”€â”€ 1. Gestiones por asesor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // (sin cambios â€” usa datos reales)

  // â”€â”€ 2. RotaciÃ³n de Cartera â€” DATOS REALES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const totalAsignados  = rotDetalleActivo.reduce((s, d) => s + (d?.metricas?.total_asignados  || 0), 0);
  const gestionadosBase = rotDetalleActivo.reduce((s, d) => s + (d?.metricas?.gestionados_base || 0), 0);
  const rotacionReal    = totalAsignados > 0
    ? Math.min((gestionadosBase / totalAsignados) * 100, 100).toFixed(1)
    : '0.0';
  const dataRotacion = [
    { name: 'Gestionados', value: Number(rotacionReal) },
    { name: 'Pendientes',  value: Math.max(0, 100 - Number(rotacionReal)) },
  ];
  // Ranking por asesor: % de cartera gestionada. Ordenado descendente.
  // Solo se muestran asesores con cartera asignada (total > 0).
  const dataRotacionAsesor = rotDetalleActivo
    .map(d => {
      const total = d?.metricas?.total_asignados  || 0;
      const gest  = d?.metricas?.gestionados_base || 0;
      const pct   = total > 0 ? Math.round((gest / total) * 100) : 0;
      return {
        name: d?.asesor?.nombre.split(' ')[0],
        fullName: d?.asesor?.nombre,
        pct,
        gestionados: gest,
        total,
      };
    })
    .filter(d => d.total > 0)
    .sort((a, b) => b.pct - a.pct);

  // â”€â”€ 4. Contactabilidad â€” DATOS REALES (4 categorÃ­as por CDR) â”€â”€â”€
  const totalMarcaciones    = metricasEquipo?.marcacionesTotales || 0; // se usa en otras cards (ROI/Tiempo)
  const cdrsTotal           = metricasEquipo?.cdrsTotalEquipo         ?? 0;
  const cdrsEfectivos       = metricasEquipo?.contactosEfectivosTotal ?? 0;
  const cdrsNeutros         = metricasEquipo?.cdrsNeutrosTotal        ?? 0;
  const cdrsNoContactados   = metricasEquipo?.cdrsNoContactadosTotal  ?? 0;
  const tasaContactabilidad = cdrsTotal > 0
    ? ((cdrsEfectivos / cdrsTotal) * 100).toFixed(1)
    : '0.0';
  const dataContactabilidad4 = [
    { name: 'Efectivos',      key: 'EFECTIVO',      value: cdrsEfectivos,     color: '#00E676' },
    { name: 'Neutros',        key: 'NEUTRO',        value: cdrsNeutros,       color: '#FBC02D' },
    { name: 'No Contactados', key: 'NO_CONTACTADO', value: cdrsNoContactados, color: '#9E9E9E' },
  ];

  // â”€â”€ 5. Proyecciones â€” extrapola rate actual al cierre de jornada â”€â”€
  // Aplicable solo cuando el dÃ­a filtrado es hoy (o no hay filtro). Para dÃ­as
  // pasados, jornada cerrada â†’ proyecciÃ³n = actual (sin extrapolar).
  const PROY_HORA_INICIO = 8;    // 08:00
  const PROY_HORA_FIN    = 17;   // 17:00 â†’ jornada de 9h
  const PROY_HORAS_TOTAL = PROY_HORA_FIN - PROY_HORA_INICIO;
  const proyHoyStr = todayLocalISO();
  const proyEsHoy = !esRango && (!filtroDesde || filtroDesde === proyHoyStr);
  const proyAhora = new Date();
  const proyHoraDecimal = proyAhora.getHours() + proyAhora.getMinutes() / 60;
  // Horas transcurridas dentro de la jornada (mÃ­nimo 0.5h para no dividir por casi cero)
  const proyHorasTrans = Math.max(0.5, Math.min(PROY_HORAS_TOTAL, proyHoraDecimal - PROY_HORA_INICIO));
  const proyHorasRest  = Math.max(0, PROY_HORAS_TOTAL - proyHorasTrans);
  // Factor: cuÃ¡nto se proyecta multiplicando al ritmo actual
  const proyFactor = proyEsHoy && proyHorasTrans > 0 ? PROY_HORAS_TOTAL / proyHorasTrans : 1;
  const proyectar = (actual) => proyEsHoy ? Math.round(actual * proyFactor) : actual;

  // Por asesor: actual + delta proyectado
  const dataProyeccion = detalleAsesores
    .map(d => {
      const marc    = d?.metricas?.total_marcaciones || 0;
      const compr   = d?.metricas?.total_compromisos || 0;
      const recaud  = d?.metricas?.monto_recaudado    || 0;
      const marcProy   = proyectar(marc);
      const comprProy  = proyectar(compr);
      const recaudProy = proyEsHoy ? Math.round(recaud * proyFactor * 100) / 100 : recaud;
      return {
        name: d?.asesor?.nombre.split(' ')[0],
        fullName: d?.asesor?.nombre,
        marcActual: marc,
        marcDelta:  Math.max(0, marcProy - marc),
        marcProy,
        comprActual: compr,
        comprProy,
        recaudActual: recaud,
        recaudProy,
      };
    })
    .filter(d => d.marcActual > 0 || d.comprActual > 0)
    .sort((a, b) => b.marcProy - a.marcProy);

  // Totales del equipo proyectados
  const marcacionesTotalesProy = proyectar(metricasEquipo?.marcacionesTotales || 0);
  const compromisosTotalProy   = proyectar(metricasEquipo?.totalCompromisosEquipo || 0);
  const montoRecaudadoTotalProy = proyEsHoy
    ? Math.round((metricasEquipo?.montoRecaudadoTotal || 0) * proyFactor * 100) / 100
    : (metricasEquipo?.montoRecaudadoTotal || 0);

  // â”€â”€ 6. Contactabilidad por Hora â€” fetch del detalle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [detalleContact, setDetalleContact] = useState([]);
  useEffect(() => {
    const camp = filtroCampana ? Number(filtroCampana) : null;
    const p = _isRem
      ? vmFetch(_api, _tok, `/cartera/detalle-contactabilidad?fecha=${filtroDesde || ''}&fecha_fin=${filtroHasta || ''}${camp ? `&campana_id=${camp}` : ''}`)
      : window.api.invoke('db:getDetalleContactabilidad', filtroDesde || null, null, camp, filtroHasta || null);
    p.then(d => setDetalleContact(Array.isArray(d) ? d : []))
      .catch(err => { console.error('[CONTACT_HORA]', err); setDetalleContact([]); });
  }, [filtroDesde, filtroHasta, filtroCampana]);

  // Agrupar por hora 0-23
  const dataContactHora = useMemo(() => {
    const buckets = new Array(24).fill(0).map((_, h) => ({
      hora: `${String(h).padStart(2, '0')}:00`,
      total: 0,
      efectivos: 0,
      neutros: 0,
      no_contactados: 0,
      pct_efectividad: null,
    }));
    for (const r of detalleContact) {
      const h = r.hora_bucket;
      if (h == null || h < 0 || h > 23) continue;
      buckets[h].total++;
      const cat = (r.tipificacion_categoria || '').toUpperCase().replace(' ', '_');
      if (cat.includes('EFECTIVO') || cat.includes('EXITOSO')) buckets[h].efectivos++;
      else if (cat.includes('NEUTRO')) buckets[h].neutros++;
      else if (cat.includes('NO_CONTACTADO')) buckets[h].no_contactados++;
    }
    // Calcular % efectividad por hora (null si sin datos â†’ lÃ­nea no dibuja ese punto)
    buckets.forEach(b => {
      b.pct_efectividad = b.total > 0 ? Math.round((b.efectivos / b.total) * 100) : null;
    });
    // Recortar horas vacÃ­as al inicio/final para limpieza
    const firstActive = buckets.findIndex(b => b.total > 0);
    const lastActive = buckets.length - 1 - [...buckets].reverse().findIndex(b => b.total > 0);
    if (firstActive === -1) return buckets.slice(8, 19); // default jornada laboral
    return buckets.slice(Math.max(0, firstActive - 1), Math.min(24, lastActive + 2));
  }, [detalleContact]);

  const totalEfectivosHora = detalleContact.filter(r => {
    const cat = (r.tipificacion_categoria || '').toUpperCase();
    return cat.includes('EFECTIVO') || cat.includes('EXITOSO');
  }).length;
  const tasaContactabilidadHora = detalleContact.length > 0
    ? Math.round((totalEfectivosHora / detalleContact.length) * 100)
    : 0;

  // â”€â”€ 6.5 Volumen de MarcaciÃ³n por Hora â€” stack por asesor â”€â”€â”€â”€â”€
  // Reutiliza detalleContact (mismo dataset que Contactabilidad por Hora) pero
  // agrupa por hora + asesor. Permite correlacionar volumen vs efectividad:
  // hora con muchas marcaciones pero pocos efectivos â†’ mala franja horaria.

  const volumenInfo = useMemo(() => {
    // Asesores presentes en el detalle (con al menos 1 CDR)
    const aMap = new Map();
    for (const r of detalleContact) {
      if (r.usuario_id == null) continue;
      if (!aMap.has(r.usuario_id)) {
        aMap.set(r.usuario_id, r.asesor_nombre || `Asesor ${r.usuario_id}`);
      }
    }
    const asesorIds = Array.from(aMap.keys());
    const keyOf = (aid) => `a${aid}`;
    const labelOf = (aid) => (aMap.get(aid) || '').split(' ')[0] || `A${aid}`;

    // Buckets 0..23 con un campo por cada asesor
    const buckets = new Array(24).fill(0).map((_, h) => {
      const obj = { hora: `${String(h).padStart(2, '0')}:00`, total: 0 };
      asesorIds.forEach(aid => { obj[keyOf(aid)] = 0; });
      return obj;
    });
    for (const r of detalleContact) {
      const h = r.hora_bucket;
      if (h == null || h < 0 || h > 23 || r.usuario_id == null) continue;
      buckets[h].total++;
      const k = keyOf(r.usuario_id);
      buckets[h][k] = (buckets[h][k] || 0) + 1;
    }
    // Trim a horas activas (igual que Contactabilidad por Hora)
    const firstActive = buckets.findIndex(b => b.total > 0);
    const lastActive = buckets.length - 1 - [...buckets].reverse().findIndex(b => b.total > 0);
    const data = firstActive === -1
      ? buckets.slice(8, 19)
      : buckets.slice(Math.max(0, firstActive - 1), Math.min(24, lastActive + 2));

    return { data, asesores: asesorIds.map(aid => ({ id: aid, key: keyOf(aid), label: labelOf(aid), nombre: aMap.get(aid) })) };
  }, [detalleContact]);
  const totalMarcacionesHora = metricasEquipo?.marcacionesTotales || detalleContact.length;
  const horaPico = volumenInfo.data.reduce((max, b) => b.total > max.total ? b : max, { hora: 'â€”', total: 0 });

  // â”€â”€ 7. Monto Comprometido por Asesor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const dataMontoComprometido = detalleAsesores
    .map(d => ({
      name:        d?.asesor?.nombre.split(' ')[0],
      monto:       Math.round(d?.metricas?.monto_comprometido || 0),
      mora:        Math.round(d?.metricas?.mora_total_base    || 0),
      cumplidos:   d?.metricas?.compromisos_cumplidos   || 0,
      incumplidos: d?.metricas?.compromisos_incumplidos  || 0,
      reagendados: d?.metricas?.compromisos_reagendados  || 0,
      fullName:    d?.asesor?.nombre,
    }))
    .filter(d => d.mora > 0 || d.monto > 0 || d.cumplidos > 0 || d.incumplidos > 0 || d.reagendados > 0)
    .sort((a, b) => b.monto - a.monto);
  const dataMontoFinal = dataMontoComprometido.length > 0
    ? dataMontoComprometido
    : asesores.slice(0, 5).map(a => ({ name: a.nombre.split(' ')[0], monto: 0, mora: 0, cumplidos: 0, incumplidos: 0, reagendados: 0, fullName: a.nombre }));
  const totalCumplidos   = dataMontoFinal.reduce((s, d) => s + d.cumplidos, 0);
  const totalIncumplidos = dataMontoFinal.reduce((s, d) => s + d.incumplidos, 0);
  const totalReagendados = dataMontoFinal.reduce((s, d) => s + d.reagendados, 0);

  // â”€â”€ Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [modalOpen,  setModalOpen]  = React.useState(false);
  // Drill-down de Contactabilidad: { asesorId, asesorNombre, categoria } | null
  const [drillContact, setDrillContact] = React.useState(null);
  const [modalType,  setModalType]  = React.useState('');
  const [modalTitle, setModalTitle] = React.useState('');
  const openModal = (type, title) => { setModalType(type); setModalTitle(title); setModalOpen(true); };



  return (
    <>
      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SECCIÃ“N PRIORITARIA â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      <div style={SECTION_HEADER_STYLE}>
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--color-primary)' }}>star</span>
        <span style={{ ...SECTION_TAG_STYLE, color: 'var(--color-primary)' }}>Vista Prioritaria</span>
        <div style={SECTION_RULE_STYLE} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 'var(--space-md)', alignItems: 'stretch' }}>

        {/* PRIORITARIA Â· 1. Gestiones Realizadas */}
        <div className="card" style={{ ...cardStyle, gridColumn: '1 / -1' }} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={() => openModal('gestiones', 'Gestiones por Asesor')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 className="widget-title">Gestiones Realizadas</h3>
              <p className="text-body-sm" style={{ opacity: 0.5, marginBottom: 4 }}>
                {detalleAsesores.reduce((s, d) => s + (d?.metricas?.total_marcaciones || 0), 0)} marcaciones Â· {detalleAsesores.reduce((s, d) => s + (d?.metricas?.total_compromisos || 0), 0)} compromisos Â· equipo de {detalleAsesores.length} asesores
              </p>
            </div>
            <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: 20 }}>task_alt</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Asesor', 'Marcaciones', 'Gestionados / Total', 'Compromisos', 'Tiempo Aire', '% Eficacia', '% Productividad'].map((h, i) => (
                    <th key={h} style={{ textAlign: i === 0 ? 'left' : 'center', padding: '6px 10px', opacity: 0.45, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detalleAsesores.length > 0 ? detalleAsesores.map((d, i) => {
                  const aireMin = Math.round((d?.metricas?.tiempo_al_aire || 0) / 60);
                  const eficacia = d?.metricas?.ratio_eficacia || 0;
                  const productividad = d?.metricas?.ratio_productividad || 0;
                  return (
                    <tr key={d?.asesor?.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '9px 10px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>{d?.asesor?.nombre}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: 'var(--color-primary)' }}>{d?.metricas?.total_marcaciones || 0}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 600 }}>
                        <span style={{ color: '#fff' }}>{d?.metricas?.gestionados_base || 0}</span>
                        <span style={{ fontSize: 12, opacity: 0.35 }}> / {d?.metricas?.total_asignados || 0}</span>
                      </td>
                      <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: '#1DE9B6' }}>{d?.metricas?.total_compromisos || 0}</td>
                      <td style={{ padding: '9px 10px', textAlign: 'center', opacity: 0.7 }}>{aireMin}m</td>
                      <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: eficacia >= 20 ? '#00E676' : eficacia >= 10 ? C_WARN : C_DANGER }}>{eficacia}%</td>
                      <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: productividad >= 70 ? '#00E676' : productividad >= 40 ? C_WARN : C_DANGER }}>{productividad}%</td>
                    </tr>
                  );
                }) : (
                  <tr><td colSpan={7} style={{ padding: '40px 8px', textAlign: 'center', opacity: 0.4, fontSize: 12 }}>Sin actividad hoy</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{
            marginTop: 12, padding: '12px 10px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12,
          }}>
            {[
              { label: 'Marcaciones',      val: detalleAsesores.reduce((s, d) => s + (d?.metricas?.total_marcaciones || 0), 0),  color: 'var(--color-primary)' },
              { label: 'Gestion. / Total', val: `${detalleAsesores.reduce((s, d) => s + (d?.metricas?.gestionados_base || 0), 0)} / ${detalleAsesores.reduce((s, d) => s + (d?.metricas?.total_asignados || 0), 0)}`, color: '#fff' },
              { label: 'Compromisos',      val: detalleAsesores.reduce((s, d) => s + (d?.metricas?.total_compromisos || 0), 0),  color: '#1DE9B6' },
              { label: 'Tiempo Aire',      val: `${Math.round(detalleAsesores.reduce((s, d) => s + (d?.metricas?.tiempo_al_aire || 0), 0) / 60)}m`, color: 'rgba(255,255,255,0.6)' },
            ].map((item) => (
              <div key={item.label} style={{ textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{item.label}</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: item.color }}>{typeof item.val === 'number' ? item.val.toLocaleString() : item.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* PRIORITARIA Â· 3. Contactabilidad por Hora â€” full-width, mÃ¡s grande + footer resumen */}
        {(() => {
          const totalGest = detalleContact.length;
          const efe = detalleContact.filter(r => {
            const c = (r.tipificacion_categoria || '').toUpperCase();
            return c.includes('EFECTIVO') || c.includes('EXITOSO');
          }).length;
          const neu = detalleContact.filter(r => (r.tipificacion_categoria || '').toUpperCase().includes('NEUTRO')).length;
          const noc = detalleContact.filter(r => {
            const c = (r.tipificacion_categoria || '').toUpperCase();
            return c.includes('NO_CONTACTADO') || c.includes('NO CONTACTADO');
          }).length;
          const sinTip = totalGest - efe - neu - noc;
          const horaPicoContact = dataContactHora.reduce((m, b) => b.total > m.total ? b : m, { hora: 'â€”', total: 0 });
          const pct = (n) => totalGest > 0 ? Math.round((n / totalGest) * 100) : 0;
          return (
            <div className="card" style={{ ...cardStyle, gridColumn: '1 / -1' }}
                 onMouseEnter={onEnter} onMouseLeave={onLeave}
                 onClick={() => onOpenContactabilidad && onOpenContactabilidad()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 className="widget-title">Contactabilidad por Hora</h3>
                  <p className="text-body-sm" style={{ opacity: 0.5, marginBottom: 4 }}>
                    {totalGest} gestiones Â· {efe} efectivas Â· {tasaContactabilidadHora}% tasa Â· pico {horaPicoContact.hora} ({horaPicoContact.total})
                  </p>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: 14, opacity: 0.35 }}>open_in_new</span>
              </div>
              <div style={{ height: 320, marginTop: 12 }}>
                <ResponsiveContainer minWidth={1} minHeight={1} width="100%" height="100%">
                  <ComposedChart data={dataContactHora} margin={{ top: 4, right: 48, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="hora" tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.5)' }} interval={0} />
                    <YAxis
                      yAxisId="vol"
                      tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.5)' }}
                      allowDecimals={false}
                    />
                    <YAxis
                      yAxisId="pct"
                      orientation="right"
                      domain={[0, 100]}
                      tickFormatter={v => `${v}%`}
                      tick={{ fontSize: 12, fill: 'rgba(255,193,7,0.7)' }}
                      allowDecimals={false}
                      width={40}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value, name) => {
                        if (name === '% Efectividad') return [`${value}%`, name];
                        return [value, name];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="vol" dataKey="efectivos" stackId="a" fill="#00E676" name="Efectivos" />
                    <Bar yAxisId="vol" dataKey="neutros" stackId="a" fill="#FBC02D" name="Neutros" />
                    <Bar yAxisId="vol" dataKey="no_contactados" stackId="a" fill="#9E9E9E" name="No contactados" radius={[3, 3, 0, 0]} />
                    <Line
                      yAxisId="pct"
                      type="monotone"
                      dataKey="pct_efectividad"
                      name="% Efectividad"
                      stroke="#FFD740"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#FFD740', strokeWidth: 0 }}
                      activeDot={{ r: 5, strokeWidth: 0 }}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {/* Footer resumen â€” distribuciÃ³n por categorÃ­a + KPIs */}
              <div style={{
                marginTop: 12, padding: '12px 10px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12,
              }}>
                {[
                  { label: 'Total Gestiones', val: totalGest, color: 'var(--color-primary)', suf: '' },
                  { label: 'Efectivos', val: efe, color: '#00E676', suf: ` (${pct(efe)}%)` },
                  { label: 'Neutros', val: neu, color: '#FBC02D', suf: ` (${pct(neu)}%)` },
                  { label: 'No Contactados', val: noc, color: '#9E9E9E', suf: ` (${pct(noc)}%)` },
                  ...(sinTip > 0 ? [{ label: 'Sin Tipificar', val: sinTip, color: '#ff8a65', suf: ` (${pct(sinTip)}%)` }] : []),
                  { label: 'Tasa Contactabilidad', val: `${tasaContactabilidadHora}%`, color: tasaContactabilidadHora >= 30 ? '#00E676' : tasaContactabilidadHora >= 15 ? '#FBC02D' : '#ff5252', suf: '' },
                ].map((item) => (
                  <div key={item.label} style={{ textAlign: 'center' }}>
                    <span style={{ display: 'block', fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{item.label}</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: item.color }}>
                      {typeof item.val === 'number' ? item.val.toLocaleString() : item.val}
                      <span style={{ fontSize: 12, opacity: 0.65, fontWeight: 600 }}>{item.suf}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* PRIORITARIA Â· 4. Volumen de MarcaciÃ³n por Hora â€” stack por asesor */}
        <div className="card" style={{ ...cardStyle, gridColumn: '1 / -1' }}
             onMouseEnter={onEnter} onMouseLeave={onLeave}
             onClick={() => onOpenVolumen && onOpenVolumen()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 className="widget-title">Volumen de MarcaciÃ³n por Hora</h3>
              <p className="text-body-sm" style={{ opacity: 0.5, marginBottom: 4 }}>
                {totalMarcacionesHora} marcaciones Â· {volumenInfo.asesores.length} asesores Â· pico {horaPico.hora} ({horaPico.total})
              </p>
            </div>
            <span className="material-symbols-outlined" style={{ fontSize: 14, opacity: 0.35 }}>open_in_new</span>
          </div>
          <div style={{ height: 240, marginTop: 8 }}>
            <ResponsiveContainer minWidth={1} minHeight={1} width="100%" height="100%">
              <AreaChart data={volumenInfo.data}>
                <defs>
                  {volumenInfo.asesores.map((a, i) => (
                    <linearGradient key={a.key} id={`grad_${a.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={VOLUMEN_COLORS[i % VOLUMEN_COLORS.length]} stopOpacity={0.6} />
                      <stop offset="95%" stopColor={VOLUMEN_COLORS[i % VOLUMEN_COLORS.length]} stopOpacity={0.05} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="hora" tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.5)' }} interval={0} />
                <YAxis tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.5)' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(v, name) => {
                    const a = volumenInfo.asesores.find(x => x.label === name);
                    return [v, a?.nombre || name];
                  }}
                  labelFormatter={(label, payload) => {
                    const total = payload?.reduce((s, p) => s + (p.value || 0), 0) || 0;
                    return `${label} Â· Total: ${total}`;
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {volumenInfo.asesores.map((a, i) => (
                  <Area
                    key={a.key}
                    type="monotone"
                    dataKey={a.key}
                    name={a.label}
                    stackId="vol"
                    stroke={VOLUMEN_COLORS[i % VOLUMEN_COLORS.length]}
                    fill={`url(#grad_${a.key})`}
                    strokeWidth={1.5}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {volumenInfo.asesores.length === 0 && (
            <div style={{ padding: '14px 8px', textAlign: 'center', opacity: 0.4, fontSize: 12 }}>
              Sin marcaciones registradas en el rango seleccionado
            </div>
          )}
          {/* Tabla resumen por asesor */}
          {volumenInfo.asesores.length > 0 && (
            <div style={{ marginTop: 10, maxHeight: 140, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px', fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Asesor</th>
                    <th style={{ padding: '6px 8px', fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' }}>Marcaciones</th>
                    <th style={{ padding: '6px 8px', fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'right' }}>% del total</th>
                    <th style={{ padding: '6px 8px', fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' }}>Hora pico</th>
                  </tr>
                </thead>
                <tbody>
                  {volumenInfo.asesores
                    .map((a, i) => {
                      let total = 0;
                      let peakH = 'â€”', peakV = 0;
                      volumenInfo.data.forEach(b => {
                        const v = b[a.key] || 0;
                        total += v;
                        if (v > peakV) { peakV = v; peakH = b.hora; }
                      });
                      return { ...a, total, peakH, peakV, color: VOLUMEN_COLORS[i % VOLUMEN_COLORS.length] };
                    })
                    .sort((x, y) => y.total - x.total)
                    .map(a => (
                      <tr key={a.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color, display: 'inline-block' }} />
                          <span>{a.nombre}</span>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{a.total}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', opacity: 0.75 }}>
                          {totalMarcacionesHora > 0 ? `${Math.round((a.total / totalMarcacionesHora) * 100)}%` : '0%'}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: 12 }}>
                          <span className="text-mono">{a.peakH}</span>
                          <span style={{ opacity: 0.5, marginLeft: 4 }}>({a.peakV})</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* PRIORITARIA Â· 5. ComunicaciÃ³n Omnicanal â€” WSP / SMS / Correos enviados por asesor */}
        <div className="card" style={{ ...cardStyle, gridColumn: '1 / -1' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
          <div className="widget-header">
            <div>
              <h3 className="widget-title">ComunicaciÃ³n Omnicanal</h3>
              <p className="text-body-sm" style={{ opacity: 0.5 }}>
                WhatsApps, SMS y Correos enviados por asesor desde las acciones rÃ¡pidas
              </p>
            </div>
            <span className="material-symbols-outlined" style={{ color: '#25D366' }}>send</span>
          </div>

          {/* Totales del equipo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 12, padding: '12px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            {[
              { label: 'WhatsApps', val: metricasEquipo?.wspEnviadosTotal     ?? 0, color: '#25D366', icon: 'chat' },
              { label: 'SMS',       val: metricasEquipo?.smsEnviadosTotal     ?? 0, color: '#64b5f6', icon: 'sms'  },
              { label: 'Correos',   val: metricasEquipo?.correosEnviadosTotal ?? 0, color: '#ff8a65', icon: 'mail' },
              { label: 'Total',     val: (metricasEquipo?.wspEnviadosTotal ?? 0) + (metricasEquipo?.smsEnviadosTotal ?? 0) + (metricasEquipo?.correosEnviadosTotal ?? 0), color: 'var(--color-primary)', icon: 'forum' },
            ].map((item, i) => (
              <div key={item.label} style={{ textAlign: 'center', borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: item.color, opacity: 0.85 }}>{item.icon}</span>
                <div style={{ fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{item.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: item.color, marginTop: 2 }}>{item.val.toLocaleString()}</div>
              </div>
            ))}
          </div>

          {/* Tabla por asesor */}
          <div style={{ marginTop: 14, overflowY: 'auto', maxHeight: 240 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left',  padding: '5px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Asesor</th>
                  <th style={{ textAlign: 'center', padding: '5px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#25D366' }}>WSP</th>
                  <th style={{ textAlign: 'center', padding: '5px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#64b5f6' }}>SMS</th>
                  <th style={{ textAlign: 'center', padding: '5px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#ff8a65' }}>Correos</th>
                  <th style={{ textAlign: 'center', padding: '5px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const filas = detalleAsesores
                    .map(d => {
                      const wsp = d?.metricas?.wsp_enviados     || 0;
                      const sms = d?.metricas?.sms_enviados     || 0;
                      const cor = d?.metricas?.correos_enviados || 0;
                      return { nombre: d?.asesor?.nombre, wsp, sms, cor, total: wsp + sms + cor };
                    })
                    .sort((a, b) => b.total - a.total);
                  if (filas.every(f => f.total === 0)) {
                    return (
                      <tr><td colSpan={5} style={{ padding: '20px 8px', textAlign: 'center', opacity: 0.4, fontSize: 12 }}>
                        Sin envÃ­os registrados {labelFecha}
                      </td></tr>
                    );
                  }
                  return filas.map((f, i) => (
                    <tr key={f.nombre + i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '7px 8px', color: 'var(--color-on-surface-variant)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>{f.nombre}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 700, color: f.wsp > 0 ? '#25D366' : 'rgba(255,255,255,0.3)' }}>{f.wsp}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 700, color: f.sms > 0 ? '#64b5f6' : 'rgba(255,255,255,0.3)' }}>{f.sms}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 700, color: f.cor > 0 ? '#ff8a65' : 'rgba(255,255,255,0.3)' }}>{f.cor}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 800, color: f.total > 0 ? 'var(--color-primary)' : 'rgba(255,255,255,0.3)' }}>{f.total}</td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>

        {/* PRIORITARIA Â· 5. RotaciÃ³n de Cartera â€” bar chart por asesor + pie chart global */}
        <div className="card" style={{ ...cardStyle, gridColumn: '1 / -1' }} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={() => openModal('rotacion', 'RotaciÃ³n de Cartera por Asesor')}>
          <div className="widget-header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <h3 className="widget-title">RotaciÃ³n de Cartera</h3>
              <p className="text-body-sm" style={{ opacity: 0.5 }}>
                {gestionadosBase.toLocaleString()} de {totalAsignados.toLocaleString()} contactos gestionados Â· <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{rotacionReal}% completado</span>
              </p>
            </div>

            {/* Filtros locales â€” detener propagaciÃ³n para no abrir el modal */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>

              {/* Rango de fechas */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, opacity: 0.45, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Desde</span>
                <input aria-label="Desde"
                  type="date"
                  value={rotFechaInicio}
                  onChange={e => setRotFechaInicio(e.target.value)}
                  max={rotFechaFin || undefined}
                  style={{
                    padding: '3px 7px',
                    fontSize: 12,
                    borderRadius: 6,
                    border: rotFechaInicio ? '1px solid var(--color-primary)' : '1px solid rgba(255,255,255,0.1)',
                    background: '#1a1a1a',
                    color: rotFechaInicio ? 'var(--color-primary)' : 'rgba(255,255,255,0.45)',
                    colorScheme: 'dark',
                  }}
                />
                <span style={{ fontSize: 12, opacity: 0.45, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Hasta</span>
                <input aria-label="Hasta"
                  type="date"
                  value={rotFechaFin}
                  onChange={e => setRotFechaFin(e.target.value)}
                  min={rotFechaInicio || undefined}
                  style={{
                    padding: '3px 7px',
                    fontSize: 12,
                    borderRadius: 6,
                    border: rotFechaFin ? '1px solid var(--color-primary)' : '1px solid rgba(255,255,255,0.1)',
                    background: '#1a1a1a',
                    color: rotFechaFin ? 'var(--color-primary)' : 'rgba(255,255,255,0.45)',
                    colorScheme: 'dark',
                  }}
                />
              </div>

              {/* Selector de campaÃ±a */}
              {rotCampanas.length > 0 && (
                <select
                  value={rotCampana}
                  onChange={e => setRotCampana(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    fontSize: 12,
                    borderRadius: 6,
                    border: rotCampana ? '1px solid var(--color-primary)' : '1px solid rgba(255,255,255,0.1)',
                    background: '#1a1a1a',
                    color: rotCampana ? 'var(--color-primary)' : 'rgba(255,255,255,0.45)',
                    cursor: 'pointer',
                    colorScheme: 'dark',
                  }}
                >
                  <option value="">Todas las campaÃ±as</option>
                  {rotCampanas.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              )}

              {/* BotÃ³n limpiar â€” solo cuando hay filtro activo */}
              {(rotFechaInicio || rotFechaFin || rotCampana) && (
                <button type="button"
                  onClick={() => { setRotFechaInicio(''); setRotFechaFin(''); setRotCampana(''); }}
                  title="Limpiar filtros"
                  style={{
                    padding: '4px 8px',
                    fontSize: 12,
                    borderRadius: 6,
                    border: '1px solid rgba(255,82,82,0.4)',
                    background: 'rgba(255,82,82,0.08)',
                    color: '#ff5252',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>filter_alt_off</span>
                  Limpiar
                </button>
              )}
            </div>

            <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)' }}>donut_large</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 'var(--space-md)', marginTop: 12, alignItems: 'stretch' }}>

            {/* IZQ â€” Lista de progress bars por asesor (live) */}
            <div style={{ minHeight: 260, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Avance por Asesor
                </span>
                <span style={{ fontSize: 12, opacity: 0.4 }}>
                  {dataRotacionAsesor.length} asesores con cartera
                </span>
              </div>
              {dataRotacionAsesor.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 12, minHeight: 220 }}>
                  Sin cartera asignada{rotCampana ? ` en campaÃ±a #${rotCampana}` : ''}{filtroDesde ? ` ${labelFecha}` : ''}
                </div>
              ) : (
                <div style={{ flex: 1, overflowY: 'auto', maxHeight: 360, paddingRight: 6 }}>
                  {dataRotacionAsesor.map((r, i) => {
                    // Color por desempeÃ±o
                    const color = r.pct >= 70 ? 'var(--color-primary)'
                                : r.pct >= 30 ? '#ffc107'
                                : '#ff5252';
                    const pendientes = Math.max(0, r.total - r.gestionados);
                    return (
                      <div key={r.fullName + i} style={{
                        padding: '10px 12px',
                        marginBottom: 8,
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: 8,
                        borderLeft: `3px solid ${color}`,
                      }}>
                        {/* Header: nombre + ratio */}
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-on-surface)' }}>
                            {r.fullName}
                          </span>
                          <span style={{ fontSize: 12, opacity: 0.75 }}>
                            <span style={{ fontWeight: 800, color }}>{r.gestionados}</span>
                            <span style={{ opacity: 0.5 }}> de </span>
                            <span style={{ fontWeight: 700 }}>{r.total}</span>
                            <span style={{ opacity: 0.5 }}> clientes Â· </span>
                            <span style={{ fontWeight: 800, color }}>{r.pct}%</span>
                          </span>
                        </div>
                        {/* Barra de progreso */}
                        <div style={{
                          position: 'relative',
                          height: 8,
                          background: 'rgba(255,255,255,0.06)',
                          borderRadius: 4,
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            position: 'absolute', top: 0, left: 0, bottom: 0,
                            width: `${Math.min(100, r.pct)}%`,
                            background: color,
                            borderRadius: 4,
                            transition: 'width 0.4s ease-out',
                          }} />
                        </div>
                        {/* Sub-stats */}
                        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12, opacity: 0.55 }}>
                          <span><span style={{ color }}>â—</span> Gestionados: <b>{r.gestionados}</b></span>
                          <span><span style={{ opacity: 0.4 }}>â—</span> Pendientes: <b>{pendientes}</b></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* DER â€” Pie chart global */}
            <div style={{ minHeight: 260, display: 'flex', flexDirection: 'column', borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: 'var(--space-md)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Vista Global
              </div>
              <div style={{ flex: 1, position: 'relative', minHeight: 200 }}>
                <ResponsiveContainer minWidth={1} minHeight={1} width="100%" height="100%">
                  <PieChart>
                    <Pie data={dataRotacion} innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value" stroke="none" startAngle={90} endAngle={-270}>
                      {dataRotacion.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? 'var(--color-primary)' : 'rgba(255,255,255,0.08)'} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => `${v}%`} contentStyle={chartTooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Centro del donut */}
                <div style={{
                  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                  textAlign: 'center', pointerEvents: 'none',
                }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-primary)', lineHeight: 1 }}>{rotacionReal}%</div>
                  <div style={{ fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Completado</div>
                </div>
              </div>
              {/* Leyenda */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Gestionados</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-primary)', marginTop: 2 }}>{gestionadosBase.toLocaleString()}</div>
                </div>
                <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pendientes</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{Math.max(0, totalAsignados - gestionadosBase).toLocaleString()}</div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* PRIORITARIA Â· 6. Contactabilidad Cruda â€” desglose por asesor + pie 4 segmentos */}
        <div className="card" style={{ ...cardStyle, gridColumn: '1 / -1' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
          <div className="widget-header">
            <div>
              <h3 className="widget-title">Contactabilidad Cruda</h3>
              <p className="text-body-sm" style={{ opacity: 0.5 }}>
                {cdrsTotal.toLocaleString()} CDRs Â· <span style={{ color: '#00E676', fontWeight: 700 }}>{tasaContactabilidad}% efectividad</span>
                <span style={{ opacity: 0.4, marginLeft: 6, fontSize: 12 }}>(click en celda para ver detalle)</span>
              </p>
            </div>
            <span className="material-symbols-outlined" style={{ color: '#00E676' }}>support_agent</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 'var(--space-md)', marginTop: 12, alignItems: 'stretch' }}>

            {/* IZQ â€” Tabla por asesor con celdas clickeables */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Desglose por Asesor
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 360 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left',  padding: '6px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Asesor</th>
                      <th style={{ textAlign: 'center', padding: '6px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#00E676' }}>Efectivos</th>
                      <th style={{ textAlign: 'center', padding: '6px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#FBC02D' }}>Neutros</th>
                      <th style={{ textAlign: 'center', padding: '6px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#9E9E9E' }}>No Cont.</th>
                      <th style={{ textAlign: 'center', padding: '6px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Total</th>
                      <th style={{ textAlign: 'center', padding: '6px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Tasa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const filas = detalleAsesores
                        .map(d => {
                          const total = d?.metricas?.cdrs_total          || 0;
                          const ef    = d?.metricas?.contactos_efectivos || 0;
                          const ne    = d?.metricas?.cdrs_neutros        || 0;
                          const nc    = d?.metricas?.cdrs_no_contactados || 0;
                          const tasa  = total > 0 ? Math.round((ef / total) * 100) : 0;
                          return { id: d?.asesor?.id, nombre: d?.asesor?.nombre, total, ef, ne, nc, tasa };
                        })
                        .filter(f => f.total > 0)
                        .sort((a, b) => b.total - a.total);
                      if (filas.length === 0) {
                        return (
                          <tr><td colSpan={6} style={{ padding: '20px 8px', textAlign: 'center', opacity: 0.4, fontSize: 12 }}>
                            Sin marcaciones registradas {labelFecha}
                          </td></tr>
                        );
                      }
                      const cellStyle = (val, color) => ({
                        padding: '6px 8px', textAlign: 'center', fontWeight: 700,
                        color: val > 0 ? color : 'rgba(255,255,255,0.25)',
                        cursor: val > 0 ? 'pointer' : 'default',
                        transition: 'background 0.15s',
                        borderRadius: 4,
                      });
                      return filas.map((f, i) => (
                        <tr key={f.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                          <td style={{ padding: '7px 8px', color: 'var(--color-on-surface-variant)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180, fontWeight: 600 }}>{f.nombre}</td>
                          <td style={cellStyle(f.ef, '#00E676')}
                              onClick={() => f.ef > 0 && setDrillContact({ asesorId: f.id, asesorNombre: f.nombre, categoria: 'EFECTIVO' })}
                              onMouseEnter={(e) => { if (f.ef > 0) e.currentTarget.style.background = 'rgba(0,230,118,0.08)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>{f.ef}</td>
                          <td style={cellStyle(f.ne, '#FBC02D')}
                              onClick={() => f.ne > 0 && setDrillContact({ asesorId: f.id, asesorNombre: f.nombre, categoria: 'NEUTRO' })}
                              onMouseEnter={(e) => { if (f.ne > 0) e.currentTarget.style.background = 'rgba(251,192,45,0.08)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>{f.ne}</td>
                          <td style={cellStyle(f.nc, '#9E9E9E')}
                              onClick={() => f.nc > 0 && setDrillContact({ asesorId: f.id, asesorNombre: f.nombre, categoria: 'NO_CONTACTADO' })}
                              onMouseEnter={(e) => { if (f.nc > 0) e.currentTarget.style.background = 'rgba(158,158,158,0.08)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>{f.nc}</td>
                          <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 800, color: 'var(--color-on-surface)' }}>{f.total}</td>
                          <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 800, color: f.tasa >= 50 ? '#00E676' : f.tasa >= 25 ? '#FBC02D' : '#ff5252' }}>{f.tasa}%</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {/* DER â€” Pie chart 4 segmentos global */}
            <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: 'var(--space-md)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Vista Global
              </div>
              <div style={{ flex: 1, minHeight: 200 }}>
                {cdrsTotal === 0 ? (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4, fontSize: 12 }}>
                    Sin datos
                  </div>
                ) : (
                  <ResponsiveContainer minWidth={1} minHeight={1} width="100%" height="100%">
                    <PieChart>
                      <Pie data={dataContactabilidad4} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2} dataKey="value" stroke="none">
                        {dataContactabilidad4.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(v, n) => [`${v} CDRs (${cdrsTotal > 0 ? Math.round((v / cdrsTotal) * 100) : 0}%)`, n]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              {/* Leyenda */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {dataContactabilidad4.map((seg) => {
                  const pct = cdrsTotal > 0 ? Math.round((seg.value / cdrsTotal) * 100) : 0;
                  return (
                    <div key={seg.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
                      <span style={{ opacity: 0.7 }}>{seg.name}</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 700, color: seg.color }}>{seg.value}</span>
                      <span style={{ opacity: 0.4, fontSize: 12 }}>({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {/* Monto Comprometido por Asesor */}
        <div className="card" style={{ ...cardStyle, gridColumn: '1 / -1' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
          <div className="widget-header">
            <div>
              <h3 className="widget-title">Monto Comprometido por Asesor</h3>
              <p className="text-body-sm" style={{ opacity: 0.5 }}>Valor gestionado hoy vs mora base asignada</p>
            </div>
            <span className="material-symbols-outlined" style={{ color: C_DANGER }}>payments</span>
          </div>
          <div style={{ height: 320, marginTop: 12 }}>
            <ResponsiveContainer minWidth={1} minHeight={1} width="100%" height="100%">
              <BarChart data={dataMontoFinal} layout="vertical" margin={{ left: 10, right: 90 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" stroke="rgba(255,255,255,0.3)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickFormatter={fmt$} />
                <YAxis dataKey="name" type="category" stroke="rgba(255,255,255,0.3)" tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} width={72} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                  contentStyle={chartTooltipStyle}
                  formatter={(v, name) => [fmt$(v), name === 'monto' ? 'Comprometido' : 'Total Mora']}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(v) => v === 'monto' ? 'Comprometido hoy' : 'Mora base'} />
                <Bar dataKey="mora"  fill="rgba(255,82,82,0.15)"  radius={[0, 2, 2, 0]} barSize={18} />
                <Bar dataKey="monto" fill={C_DANGER}               radius={[0, 4, 4, 0]} barSize={18}>
                  <LabelList dataKey="monto" position="right" formatter={fmt$} style={{ fontSize: 12, fill: 'rgba(255,255,255,0.55)' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{
            marginTop: 12, padding: '12px 10px',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.02)',
            borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12,
          }}>
            {[
              { label: 'Total Mora Base',    val: fmt$(metricasEquipo?.moraTotal),              color: 'rgba(255,255,255,0.5)' },
              { label: 'Total Comprometido', val: fmt$(metricasEquipo?.montoComprometidoTotal), color: C_DANGER },
              { label: 'Tasa RecuperaciÃ³n',  val: `${metricasEquipo?.tasaRecuperacion ?? 0}%`, color: C_WARN },
            ].map((item) => (
              <div key={item.label} style={{ textAlign: 'center' }}>
                <span style={{ display: 'block', fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{item.label}</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: item.color }}>{item.val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AnÃ¡lisis de Cartera */}
        <div style={{ gridColumn: '1 / -1' }}>
          <AnalisisCartera filtroFechaDesde={filtroDesde} filtroFechaHasta={filtroHasta} />
        </div>

        {/* Cumplimiento de Metas */}
        <div style={{ gridColumn: '1 / -1' }}>
          <CumplimientoMetas filtroFechaDesde={filtroDesde} filtroFechaHasta={filtroHasta} />
        </div>

        {/* PRIORITARIA Â· 7. Proyecciones â€” extrapola rate actual al cierre de jornada */}
        <div className="card" style={{ ...cardStyle, gridColumn: '1 / -1' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
          <div className="widget-header">
            <div>
              <h3 className="widget-title">Proyecciones</h3>
              <p className="text-body-sm" style={{ opacity: 0.5 }}>
                {esRango
                  ? <>PerÃ­odo {filtroDesde} â†’ {filtroHasta} Â· totales reales acumulados</>
                  : proyEsHoy
                    ? <>EstimaciÃ³n al cierre de jornada (17:00) Â· <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{proyHorasTrans.toFixed(1)}h transcurridas, {proyHorasRest.toFixed(1)}h restantes</span> Â· factor {proyFactor.toFixed(2)}Ã—</>
                    : <>DÃ­a cerrado Â· valores reales finales (sin proyecciÃ³n)</>}
              </p>
            </div>
            <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)' }}>insights</span>
          </div>

          {/* Totales del equipo proyectados */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12, padding: '12px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
            {[
              { label: 'Marcaciones',  icon: 'phone_in_talk', actual: metricasEquipo?.marcacionesTotales || 0,       proy: marcacionesTotalesProy,  color: 'var(--color-primary)', isMoney: false },
              { label: 'Compromisos',  icon: 'handshake',     actual: metricasEquipo?.totalCompromisosEquipo || 0,   proy: compromisosTotalProy,    color: '#1DE9B6',              isMoney: false },
              { label: 'Recaudo',      icon: 'payments',      actual: metricasEquipo?.montoRecaudadoTotal || 0,      proy: montoRecaudadoTotalProy, color: '#ffc107',              isMoney: true  },
            ].map((kpi, i) => (
              <div key={kpi.label} style={{ textAlign: 'center', borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none', padding: '0 8px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: kpi.color, opacity: 0.85 }}>{kpi.icon}</span>
                <div style={{ fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{kpi.label} Proyectado</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: kpi.color, marginTop: 2 }}>
                  {kpi.isMoney
                    ? '$' + Number(kpi.proy).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : kpi.proy.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>
                  Actual: <b style={{ color: 'rgba(255,255,255,0.75)' }}>
                    {kpi.isMoney
                      ? '$' + Number(kpi.actual).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : kpi.actual.toLocaleString()}
                  </b>
                  {proyEsHoy && kpi.actual > 0 && (
                    <span style={{ marginLeft: 6, color: '#1DE9B6', fontWeight: 700 }}>
                      +{kpi.proy - kpi.actual > 0 ? (kpi.isMoney ? '$' + Number(kpi.proy - kpi.actual).toFixed(2) : kpi.proy - kpi.actual) : 0}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Bar chart por asesor: stacked actual + delta */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Marcaciones Â· actual vs proyectado por asesor
              </span>
              {proyEsHoy && (
                <div style={{ display: 'flex', gap: 12, fontSize: 12, opacity: 0.6 }}>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--color-primary)', borderRadius: 2, verticalAlign: 'middle', marginRight: 4 }} />Realizado</span>
                  <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(0,230,118,0.25)', borderRadius: 2, border: '1px dashed rgba(0,230,118,0.6)', verticalAlign: 'middle', marginRight: 4 }} />ProyecciÃ³n</span>
                </div>
              )}
            </div>
            {dataProyeccion.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', opacity: 0.4, fontSize: 12 }}>
                Sin datos de gestiÃ³n para proyectar
              </div>
            ) : (
              <div style={{ height: Math.max(220, dataProyeccion.length * 36 + 40) }}>
                <ResponsiveContainer minWidth={1} minHeight={1} width="100%" height="100%">
                  <BarChart data={dataProyeccion} layout="vertical" margin={{ left: 10, right: 80, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis type="number" stroke="rgba(255,255,255,0.3)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                    <YAxis dataKey="name" type="category" stroke="rgba(255,255,255,0.3)" tick={{ fill: 'var(--color-on-surface-variant)', fontSize: 12 }} width={80} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.02)' }}
                      contentStyle={chartTooltipStyle}
                      formatter={(v, name, props) => {
                        if (name === 'marcActual') return [`${v} realizadas`, props.payload.fullName];
                        if (name === 'marcDelta')  return [`+${v} proyectadas â†’ ${props.payload.marcProy} total`, ''];
                        return [v, name];
                      }}
                    />
                    <Bar dataKey="marcActual" stackId="proy" fill="var(--color-primary)" radius={[0, 0, 0, 4]} barSize={20} />
                    <Bar dataKey="marcDelta"  stackId="proy" fill="rgba(0,230,118,0.25)" stroke="rgba(0,230,118,0.6)" strokeDasharray="3 3" radius={[0, 4, 4, 0]} barSize={20}>
                      <LabelList
                        dataKey="marcProy"
                        position="right"
                        style={{ fill: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 700 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Tabla detalle: proyecciones de los 3 KPIs por asesor */}
          {dataProyeccion.length > 0 && (
            <div style={{ marginTop: 16, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left',  padding: '6px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Asesor</th>
                    <th style={{ textAlign: 'center', padding: '6px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--color-primary)' }}>Marcaciones</th>
                    <th style={{ textAlign: 'center', padding: '6px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#1DE9B6' }}>Compromisos</th>
                    <th style={{ textAlign: 'right',  padding: '6px 8px', opacity: 0.5, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#ffc107' }}>Recaudo</th>
                  </tr>
                </thead>
                <tbody>
                  {dataProyeccion.map((r, i) => (
                    <tr key={r.fullName + i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '7px 8px', color: 'var(--color-on-surface-variant)', fontWeight: 600 }}>{r.fullName}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                        <span style={{ opacity: 0.6 }}>{r.marcActual}</span>
                        <span style={{ opacity: 0.3, margin: '0 4px' }}>â†’</span>
                        <span style={{ fontWeight: 800, color: 'var(--color-primary)' }}>{r.marcProy}</span>
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'center' }}>
                        <span style={{ opacity: 0.6 }}>{r.comprActual}</span>
                        <span style={{ opacity: 0.3, margin: '0 4px' }}>â†’</span>
                        <span style={{ fontWeight: 800, color: '#1DE9B6' }}>{r.comprProy}</span>
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'right' }}>
                        <span style={{ opacity: 0.6 }} className="text-mono">${Number(r.recaudActual).toFixed(2)}</span>
                        <span style={{ opacity: 0.3, margin: '0 4px' }}>â†’</span>
                        <span style={{ fontWeight: 800, color: '#ffc107' }} className="text-mono">${Number(r.recaudProy).toFixed(2)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>


      <MetricDetailModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        metricType={modalType}
        metricTitle={modalTitle}
        asesores={asesores}
        metricas={metricas}
        metricasEquipo={metricasEquipo}
        rotDetalle={modalType === 'rotacion' ? rotDetalleActivo : null}
      />

      <ContactabilidadDrillDown
        open={!!drillContact}
        onClose={() => setDrillContact(null)}
        asesorId={drillContact?.asesorId}
        asesorNombre={drillContact?.asesorNombre}
        categoria={drillContact?.categoria}
        fecha={filtroDesde}
        fechaFin={filtroHasta}
        campanaId={filtroCampana}
      />
    </>
  );
}

export default React.memo(AdvancedMetricsCharts);
