import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * ActividadGestores – Supervisión en tiempo real de gestores por tipificación.
 * Matriz: fila por gestor, columnas por categoría (Exitoso/Neutro/No Contactado)
 * con conteo + tiempo al aire. Clic en fila → desglose por código.
 *
 * Live solo cuando fecha = hoy: el padre incrementa refreshSignal al recibir
 * TIPIFICACION_REALIZADA por WS y aquí se refetchea con debounce de 2s.
 * Fuente de verdad = DB (endpoint agregado); nunca se acumula en cliente.
 *
 * Estilos: tokens de theme.css (.card, .data-table, .badge, .dot, .avatar).
 */

const CATEGORIAS = ['NO CONTACTADO'];
const CAT_META = {
  'CONTACTO EXITOSO': { label: 'Contacto Exitoso', color: 'var(--color-primary)',  bg: 'rgba(0, 255, 127, 0.08)',  icon: 'task_alt' },
  'CONTACTO NEUTRO':  { label: 'Contacto Neutro',  color: 'var(--color-tertiary)', bg: 'rgba(255, 192, 172, 0.08)', icon: 'contact_support' },
  'NO CONTACTADO':    { label: 'No Contactado',    color: 'var(--color-outline)',  bg: 'rgba(134, 148, 134, 0.08)', icon: 'phone_missed' },
};

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTiempo(seg) {
  if (!seg) return '0s';
  if (seg < 60) return `${seg}s`;
  const m = Math.floor(seg / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function iniciales(nombre) {
  return (nombre || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('');
}

const CANAL_META = {
  wsp:    { label: 'WSP',    color: '#00e676', icon: 'chat' },
  sms:    { label: 'RCS',    color: '#64b5f6', icon: 'sms' },
  correo: { label: 'CORREO', color: '#ce93d8', icon: 'mail' },
};
const CANAL_KEYS = ['wsp', 'sms', 'correo'];
const CANAL_DETALLE = {
  wsp:    'wsp_detalle',
  sms:    'sms_detalle',
  correo: 'email_detalle',
};
// Clave en canales_apertura (del backend, filtrado por apertura del día)
const CANAL_APERTURA_KEY = {
  wsp:    'whatsapp',
  sms:    'rcs',
  correo: 'gmail',
};

// ── Helpers GEST/HORA ────────────────────────────────────────────────────────
// CRÍTICO: timestamp_inicio es naive-UTC (wall-clock Guayaquil, sin zona).
// Comparar contra Date.now() (UTC real) introduce error de 5h.
// getNaiveNowForGYE() retorna la hora actual de GYE expresada como naive-UTC,
// manteniendo coherencia con los timestamps del backend.
function getNaiveNowForGYE() {
  const now = new Date();
  const gyeStr = now.toLocaleString('sv-SE', { timeZone: 'America/Guayaquil' });
  return new Date(gyeStr.replace(' ', 'T') + 'Z');
}

function calcGph(totalCount, primeraGestionTs) {
  if (!primeraGestionTs || !totalCount) return null;
  const naiveNow = getNaiveNowForGYE();
  const elapsed = (naiveNow.getTime() - new Date(primeraGestionTs).getTime()) / 3600000;
  if (elapsed < 0.1) return null; // < 6 min: insuficiente, evita 500/hr artificiales
  return totalCount / elapsed;
}

function getProyeccion(totalCount, gph) {
  if (gph == null) return null;
  const naiveNow = getNaiveNowForGYE();
  const ymd = naiveNow.toISOString().slice(0, 10);
  const naiveMidnight = new Date(`${ymd}T23:59:59.999Z`);
  const horasRestantes = (naiveMidnight.getTime() - naiveNow.getTime()) / 3600000;
  if (horasRestantes < 0.1) return null;
  return Math.round(totalCount + gph * horasRestantes);
}

export default function ActividadGestores({ apiBase, authToken, refreshSignal, estadosWS, metricasCanales, campanas = [] }) {
  const [fecha, setFecha] = useState(hoyStr());
  const [campanaId, setCampanaId] = useState('');
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [detalleAsesor, setDetalleAsesor] = useState(null); // asesor seleccionado para modal
  const fechaRef = useRef(fecha);
  const campanaIdRef = useRef(campanaId);
  fechaRef.current = fecha;
  campanaIdRef.current = campanaId;

  const esHoy = fecha === hoyStr();

  const cargar = useCallback(async (f, cid) => {
    if (!apiBase) return;
    setCargando(true);
    try {
      const qs = new URLSearchParams({ fecha: f });
      if (cid) qs.set('campanaId', cid);
      const res = await fetch(`${apiBase}/actividad-tipificacion?${qs}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (fechaRef.current === f && campanaIdRef.current === cid) {
        setData(json);
        setError(null);
      }
    } catch (err) {
      console.error('[ActividadGestores] Error cargando:', err);
      setError('Sin conexión — mostrando últimos datos');
    } finally {
      setCargando(false);
    }
  }, [apiBase, authToken]);

  // Carga inicial y al cambiar fecha o campaña
  useEffect(() => { cargar(fecha, campanaId); }, [fecha, campanaId, cargar]);

  // Refetch live con debounce 2s — solo si la fecha visible es hoy
  useEffect(() => {
    if (!refreshSignal || !esHoy) return;
    const t = setTimeout(() => cargar(fechaRef.current, campanaIdRef.current), 2000);
    return () => clearTimeout(t);
  }, [refreshSignal, esHoy, cargar]);

  // Polling cada 30s como fallback (CDRs se crean antes de tipificar)
  useEffect(() => {
    if (!esHoy) return;
    const iv = setInterval(() => cargar(fechaRef.current, campanaIdRef.current), 30_000);
    return () => clearInterval(iv);
  }, [esHoy, cargar]);

  if (!apiBase) {
    return (
      <div className="card" style={{ margin: 'var(--space-lg)', opacity: 0.6 }}>
        Panel disponible solo en modo remoto (servidor VM).
      </div>
    );
  }

  // Cuando hay campaña seleccionada, ocultar asesores sin contactos en esa apertura (no pertenecen)
  const asesores = [...(data?.asesores || [])]
    .filter(a => !campanaId || (a.total_asignados ?? 0) > 0)
    .sort((a, b) => b.total_count - a.total_count);
  const hayDatos = asesores.some(a => a.total_count > 0);
  const maxTotal = Math.max(1, ...asesores.map(a => a.total_count));
  const maxGph = Math.max(1, ...asesores.map(a => calcGph(a.total_count, a.primera_gestion_ts) ?? 0));
  const conectadosCount = asesores.filter(a => estadosWS && estadosWS[a.asesor_id]).length;

  // Totales del equipo para las cards de resumen
  const equipo = asesores.reduce((acc, a) => {
    acc.total_count += a.total_count;
    acc.total_tiempo += a.total_tiempo_seg;
    for (const cat of CATEGORIAS) {
      const c = a.categorias[cat] || { count: 0, tiempo_seg: 0 };
      acc.cats[cat].count += c.count;
      acc.cats[cat].tiempo += c.tiempo_seg;
    }
    return acc;
  }, {
    total_count: 0, total_tiempo: 0,
    cats: {
      'CONTACTO EXITOSO': { count: 0, tiempo: 0 },
      'CONTACTO NEUTRO':  { count: 0, tiempo: 0 },
      'NO CONTACTADO':    { count: 0, tiempo: 0 },
    },
  });

  const celdaCategoria = (a, cat) => {
    const c = a.categorias[cat] || { count: 0, tiempo_seg: 0 };
    const meta = CAT_META[cat];
    const pct = a.total_count > 0 ? Math.round((c.count / a.total_count) * 100) : 0;
    return (
      <td key={cat} style={{ padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="text-mono" style={{
            fontSize: 16, fontWeight: 700,
            color: c.count > 0 ? meta.color : 'rgba(229,226,225,0.25)',
          }}>
            {c.count}
          </span>
          <span style={{ fontSize: 11, color: 'var(--color-on-surface-variant)', opacity: 0.7 }}>
            {fmtTiempo(c.tiempo_seg)}
          </span>
        </div>
        <div className="progress" style={{ marginTop: 6, height: 3, maxWidth: 90 }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: meta.color, borderRadius: 'var(--radius-full)',
            transition: 'width var(--transition-slow)',
            opacity: 0.8,
          }} />
        </div>
      </td>
    );
  };

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)', flexWrap: 'wrap' }}>
        <div>
          <h2 className="text-headline-md" style={{ margin: 0 }}>Actividad Gestores</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-on-surface-variant)', opacity: 0.7 }}>
            Gestiones y tiempo al aire por tipificación
          </p>
        </div>
        {esHoy && (
          <span className="badge badge-success" style={{ gap: 6 }}>
            <span className="dot dot-primary dot-pulse" style={{ width: 6, height: 6 }} />
            EN VIVO
          </span>
        )}
        {cargando && <span className="spinner" />}
        {error && (
          <span className="badge badge-warning">{error}</span>
        )}
        <select
          className="input"
          value={campanaId}
          onChange={e => setCampanaId(e.target.value)}
          style={{ marginLeft: 'auto', width: 'auto', padding: '10px 14px', fontSize: 13 }}
        >
          <option value="">Todas las campañas</option>
          {[...campanas]
            .sort((a, b) => new Date(b.fechaInicio || b.createdAt || 0) - new Date(a.fechaInicio || a.createdAt || 0))
            .map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)
          }
        </select>
        <input
          type="date"
          className="input"
          value={fecha}
          max={hoyStr()}
          onChange={e => { if (e.target.value) setFecha(e.target.value); }}
          style={{ width: 'auto', padding: '10px 14px', fontSize: 13 }}
        />
      </div>

      {/* ── Cards resumen del equipo ── */}
      {(() => {
        const totalAsignados  = asesores.reduce((s, a) => s + (a.total_asignados || 0), 0);
        const totalGestionados = asesores.reduce((s, a) => s + (a.gestionados     || 0), 0);
        const pctAvanceEquipo = totalAsignados > 0 ? Math.min(100, Math.round((totalGestionados / totalAsignados) * 100)) : 0;
        const noContact = equipo.cats['NO CONTACTADO'];
        const pctNoContact = equipo.total_count > 0 ? Math.round((noContact.count / equipo.total_count) * 100) : 0;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 'var(--space-lg)' }}>
            {/* Card 1 — Llamadas */}
            {(() => {
              const C = '#00E5FF';
              const R = 28; const circ = 2 * Math.PI * R;
              return (
                <div style={{ background: `rgba(0,229,255,0.05)`, border: `1px solid rgba(0,229,255,0.18)`, borderRadius: 14, padding: '18px 22px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: C, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 16 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>call</span>
                    LLAMADAS TIPIFICADAS HOY
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
                      <svg viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)', width: 64, height: 64 }}>
                        <circle cx="32" cy="32" r={R} fill="none" stroke={`rgba(0,229,255,0.12)`} strokeWidth="5" />
                        <circle cx="32" cy="32" r={R} fill="none" stroke={C} strokeWidth="5"
                          strokeDasharray={circ} strokeDashoffset={0} strokeLinecap="round" />
                      </svg>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: C }}>{conectadosCount}/{asesores.length}</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 38, fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '-1px' }}>{equipo.total_count.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 5 }}>{fmtTiempo(equipo.total_tiempo)} al aire</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>{conectadosCount}/{asesores.length} gestores activos</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Card 2 — Avance Cartera */}
            {(() => {
              const C = '#00e676';
              const R = 28; const circ = 2 * Math.PI * R;
              const pct  = data?.avance_global?.pct ?? pctAvanceEquipo;
              const gest = data?.avance_global?.gestionados ?? totalGestionados;
              const tot  = data?.avance_global?.total ?? totalAsignados;
              const segs = data?.avance_global?.segmentos || {};
              const SEG_COLORS = { '0': '#00E5FF', '1': '#FFD740', '2': '#F50057' };
              const offset = circ - (Math.min(pct, 100) / 100) * circ;
              return (
                <div style={{ background: 'rgba(0,230,118,0.05)', border: '1px solid rgba(0,230,118,0.18)', borderRadius: 14, padding: '18px 22px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: C, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 16 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>trending_up</span>
                    AVANCE CARTERA {campanaId ? '' : '(GLOBAL)'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
                    <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
                      <svg viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)', width: 64, height: 64 }}>
                        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(0,230,118,0.12)" strokeWidth="5" />
                        <circle cx="32" cy="32" r={R} fill="none" stroke={C} strokeWidth="5"
                          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
                          style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
                      </svg>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: C }}>{pct}%</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 38, fontWeight: 900, color: C, lineHeight: 1, letterSpacing: '-1px' }}>{gest.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 5 }}>de {tot.toLocaleString()} contactos</div>
                    </div>
                  </div>
                  {['0','1','2'].some(s => segs[s]?.total > 0) && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {['0','1','2'].map(seg => {
                        const s = segs[seg];
                        if (!s || s.total === 0) return null;
                        return (
                          <div key={seg} style={{ flex: 1, textAlign: 'center', padding: '7px 4px', background: `rgba(${seg==='0'?'0,229,255':seg==='1'?'255,215,64':'245,0,87'},0.08)`, borderRadius: 9, border: `1px solid rgba(${seg==='0'?'0,229,255':seg==='1'?'255,215,64':'245,0,87'},0.2)` }}>
                            <div style={{ fontSize: 14, fontWeight: 900, color: SEG_COLORS[seg] }}>{s.pct}%</div>
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '1px', marginTop: 2 }}>S{seg}</div>
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginTop: 1 }}>{s.gestionados}/{s.total}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Card 3 — No Contactados */}
            {(() => {
              const C = CAT_META['NO CONTACTADO'].color;
              const R = 28; const circ = 2 * Math.PI * R;
              const offset = circ - (Math.min(pctNoContact, 100) / 100) * circ;
              return (
                <div style={{ background: 'rgba(245,0,87,0.05)', border: '1px solid rgba(245,0,87,0.18)', borderRadius: 14, padding: '18px 22px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: C, display: 'flex', alignItems: 'center', gap: 5, marginBottom: 16 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>person_off</span>
                    NO CONTACTADOS
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
                      <svg viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)', width: 64, height: 64 }}>
                        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(245,0,87,0.12)" strokeWidth="5" />
                        <circle cx="32" cy="32" r={R} fill="none" stroke={C} strokeWidth="5"
                          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
                          style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
                      </svg>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: C }}>{pctNoContact}%</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 38, fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '-1px' }}>{noContact.count.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 5 }}>{fmtTiempo(noContact.tiempo)} al aire</div>
                    </div>
                  </div>
                </div>
              );
            })()}</div>
        );
      })()}

      {/* ── Matriz gestores ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ padding: '14px 20px' }}>Gestor</th>
              <th style={{ padding: '14px 20px', color: '#00e676' }}>Avance Cartera</th>
              <th style={{ padding: '14px 20px', color: '#ffd54f', fontSize: 11, letterSpacing: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>speed</span>
                  GEST/HORA
                </div>
              </th>
              <th style={{ padding: '14px 20px' }}>Total Llamadas</th>
              <th style={{ padding: '14px 16px', color: '#ffd54f', fontSize: 11, letterSpacing: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>my_location</span>
                  SEG. ACTUAL
                </div>
              </th>
              {CANAL_KEYS.map(k => (
                <th key={k} style={{ padding: '14px 16px', color: CANAL_META[k].color, fontSize: 11, letterSpacing: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{CANAL_META[k].icon}</span>
                    {CANAL_META[k].label}
                  </div>
                </th>
              ))}
              <th style={{ padding: '14px 20px', width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {asesores.map(a => {
              const conectado = !!(estadosWS && estadosWS[a.asesor_id]);
              const pctEquipo = Math.round((a.total_count / maxTotal) * 100);
              return (
                <tr
                  key={a.asesor_id}
                  onClick={() => setDetalleAsesor(a)}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ padding: '12px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div className="avatar avatar-sm avatar-round" style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700,
                          fontFamily: 'var(--font-headline)',
                          color: conectado ? 'var(--color-primary)' : 'var(--color-on-surface-variant)',
                          background: conectado ? 'rgba(0,255,127,0.1)' : 'var(--color-surface-container-high)',
                        }}>
                          {iniciales(a.nombre)}
                        </div>
                        <span style={{
                          position: 'absolute', bottom: -1, right: -1,
                          width: 9, height: 9, borderRadius: '50%',
                          background: conectado ? 'var(--color-primary)' : 'var(--color-outline-variant)',
                          border: '2px solid var(--color-surface-container-low)',
                        }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
                          {a.nombre}
                        </div>
                        <div style={{ fontSize: 11, color: conectado ? 'var(--color-primary)' : 'var(--color-on-surface-variant)', opacity: conectado ? 0.9 : 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {conectado ? 'Conectado' : 'Desconectado'}
                          {(() => {
                            // apertura = CDR más reciente hoy; fallback WS histórico
                            const seg = a.segmento_actual_apertura ?? metricasCanales?.[a.asesor_id]?.segmento_actual;
                            if (seg == null || !conectado) return null;
                            const SCOLS = ['#ffd54f', '#ff8a65', '#ef9a9a'];
                            return (
                              <span style={{
                                fontSize: 10, fontWeight: 900, padding: '1px 6px',
                                borderRadius: 4, background: `${SCOLS[seg]}22`,
                                color: SCOLS[seg], border: `1px solid ${SCOLS[seg]}66`,
                                letterSpacing: 0.5,
                              }}>
                                EN S{seg}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </td>
                  {/* ── AVANCE CARTERA ── */}
                  {(() => {
                    const asignados   = a.total_asignados || 0;
                    const gestionados = a.gestionados || 0;
                    const pctAvance   = asignados > 0 ? Math.min(100, Math.round((gestionados / asignados) * 100)) : 0;
                    const SEG_COLORS  = { '0': '#00E5FF', '1': '#FFD740', '2': '#F50057' };
                    return (
                      <td style={{ padding: '14px 20px', minWidth: 180 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                          <span className="text-mono" style={{ fontSize: 16, fontWeight: 800, color: '#00e676' }}>
                            {gestionados.toLocaleString()}
                          </span>
                          <span style={{ fontSize: 12, opacity: 0.5 }}>/</span>
                          <span style={{ fontSize: 13, opacity: 0.7 }}>{asignados.toLocaleString()}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#00e676', marginLeft: 4 }}>
                            {pctAvance}%
                          </span>
                        </div>
                        <div className="progress" style={{ marginTop: 4, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', width: `${pctAvance}%`,
                            background: pctAvance >= 70 ? '#00e676' : pctAvance >= 40 ? '#ffc107' : '#ff5252',
                            borderRadius: 99, transition: 'width 0.4s',
                          }} />
                        </div>
                        {a.segmentos && ['0', '1', '2'].map(seg => {
                          const s = a.segmentos[seg];
                          if (!s || s.total === 0) return null;
                          return (
                            <div key={seg} style={{ marginTop: 4 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2, opacity: 0.7 }}>
                                <span>S{seg} {s.gestionados}/{s.total}</span>
                                <span style={{ color: SEG_COLORS[seg] }}>{s.pct}%</span>
                              </div>
                              <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${Math.min(s.pct, 100)}%`, background: SEG_COLORS[seg], borderRadius: 99 }} />
                              </div>
                            </div>
                          );
                        })}
                      </td>
                    );
                  })()}
                  {(() => {
                    const horas = (a.total_tiempo_seg || 0) / 3600;
                    const gph = horas > 0 ? a.total_count / horas : null;
                    const pctMax = gph != null ? Math.round((gph / maxGph) * 100) : 0;
                    const color = gph == null ? 'rgba(229,226,225,0.2)'
                      : gph >= 18 ? '#00e676'
                      : gph >= 12 ? '#ffd54f'
                      : '#ff5252';
                    return (
                      <td style={{ padding: '12px 20px', minWidth: 120 }}>
                        {gph != null ? (
                          <>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                              <span className="text-mono" style={{ fontSize: 18, fontWeight: 800, color }}>
                                {gph.toFixed(1)}
                              </span>
                              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
                                /hr
                              </span>
                            </div>
                            <div style={{ margin: '5px 0 3px', height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden', maxWidth: 90 }}>
                              <div style={{
                                height: '100%', width: `${pctMax}%`,
                                background: color, borderRadius: 99,
                                transition: 'width 0.4s',
                              }} />
                            </div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
                              {pctMax}% del máx equipo
                            </div>
                          </>
                        ) : (
                          <span style={{ fontSize: 13, color: 'rgba(229,226,225,0.2)' }}>—</span>
                        )}
                      </td>
                    );
                  })()}
                  <td style={{ padding: '14px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span className="text-mono" style={{ fontSize: 16, fontWeight: 800 }}>{a.total_count}</span>
                      <span style={{ fontSize: 11, color: 'var(--color-on-surface-variant)', opacity: 0.7 }}>
                        {fmtTiempo(a.total_tiempo_seg)}
                      </span>
                    </div>
                    <div className="progress" style={{ marginTop: 6, height: 3, maxWidth: 90 }}>
                      <div className="progress-fill" style={{ width: `${pctEquipo}%` }} />
                    </div>
                  </td>
                  {(() => {
                    // apertura = CDR más reciente hoy; fallback WS histórico
                    const seg = a.segmento_actual_apertura ?? metricasCanales?.[a.asesor_id]?.segmento_actual;
                    const SCOLS = ['#ffd54f', '#ff8a65', '#ef9a9a'];
                    const SLABELS = ['Mora 0d', 'Mora 1d', 'Mora ≥2d'];
                    return (
                      <td style={{ padding: '10px 16px' }} onClick={e => e.stopPropagation()}>
                        {seg != null ? (
                          <div style={{
                            display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                            padding: '6px 12px', borderRadius: 8,
                            background: `${SCOLS[seg]}15`,
                            border: `1px solid ${SCOLS[seg]}44`,
                          }}>
                            <span style={{ fontSize: 18, fontWeight: 900, color: SCOLS[seg], lineHeight: 1 }}>
                              S{seg}
                            </span>
                            <span style={{ fontSize: 10, opacity: 0.6, color: SCOLS[seg] }}>
                              {SLABELS[seg]}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, opacity: 0.2 }}>—</span>
                        )}
                      </td>
                    );
                  })()}
                  {CANAL_KEYS.map(k => {
                    // Fuente primaria: msg_wsp/msg_rcs/msg_correo del endpoint (polling 30s)
                    const MSG_KEY = { wsp: 'msg_wsp', sms: 'msg_rcs', correo: 'msg_correo' };
                    const total = a[MSG_KEY[k]] ?? 0;
                    const meta = CANAL_META[k];
                    return (
                      <td key={k} style={{ padding: '10px 16px' }} onClick={e => e.stopPropagation()}>
                        <span className="text-mono" style={{
                          fontSize: 15, fontWeight: 700,
                          color: total > 0 ? meta.color : 'rgba(229,226,225,0.2)',
                        }}>
                          {total}
                        </span>
                      </td>
                    );
                  })}
                  <td style={{ padding: '14px 12px', textAlign: 'right' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18, opacity: 0.35 }}>
                      chevron_right
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && !hayDatos && (
          <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--color-on-surface-variant)', opacity: 0.6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32, display: 'block', marginBottom: 8, opacity: 0.5 }}>
              inbox
            </span>
            Sin gestiones tipificadas el {data.fecha}.
          </div>
        )}
      </div>

      {/* ── Modal desglose por código ── */}
      {detalleAsesor && (
        <div
          onClick={() => setDetalleAsesor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
            backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            className="card-elevated"
            onClick={e => e.stopPropagation()}
            style={{ minWidth: 520, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', padding: 0 }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: 'var(--space-md) var(--space-lg)',
              borderBottom: '1px solid rgba(61, 74, 62, 0.15)',
            }}>
              <div>
                <h3 className="text-headline-sm" style={{ margin: 0 }}>{detalleAsesor.nombre}</h3>
                <span style={{ fontSize: 12, color: 'var(--color-on-surface-variant)', opacity: 0.7 }}>
                  Desglose por tipificación — {detalleAsesor.total_count} gestiones · {fmtTiempo(detalleAsesor.total_tiempo_seg)}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDetalleAsesor(null)}
                style={{ padding: '6px 10px' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ padding: '12px 20px' }}>Código</th>
                  <th style={{ padding: '12px 20px' }}>Descripción</th>
                  <th style={{ padding: '12px 20px' }}>Categoría</th>
                  <th style={{ padding: '12px 20px' }}>Gestiones</th>
                  <th style={{ padding: '12px 20px' }}>Tiempo</th>
                </tr>
              </thead>
              <tbody>
                {detalleAsesor.detalle.map(d => {
                  const meta = CAT_META[d.categoria] || CAT_META['NO CONTACTADO'];
                  return (
                    <tr key={d.codigo}>
                      <td style={{ padding: '10px 20px' }}>
                        <span className="text-mono" style={{ fontWeight: 700, fontSize: 12 }}>{d.codigo}</span>
                      </td>
                      <td style={{ padding: '10px 20px', fontSize: 13 }}>{d.descripcion}</td>
                      <td style={{ padding: '10px 20px' }}>
                        <span className="badge" style={{ background: meta.bg, color: meta.color }}>
                          {meta.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 20px' }}>
                        <span className="text-mono" style={{ fontWeight: 700 }}>{d.count}</span>
                      </td>
                      <td style={{ padding: '10px 20px', fontSize: 12, color: 'var(--color-on-surface-variant)' }}>
                        {fmtTiempo(d.tiempo_seg)}
                      </td>
                    </tr>
                  );
                })}
                {detalleAsesor.detalle.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 'var(--space-lg)', textAlign: 'center', opacity: 0.5 }}>
                      Sin gestiones tipificadas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
