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

const CATEGORIAS = ['CONTACTO EXITOSO', 'CONTACTO NEUTRO', 'NO CONTACTADO'];
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

export default function ActividadGestores({ apiBase, authToken, refreshSignal, estadosWS }) {
  const [fecha, setFecha] = useState(hoyStr());
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [detalleAsesor, setDetalleAsesor] = useState(null); // asesor seleccionado para modal
  const fechaRef = useRef(fecha);
  fechaRef.current = fecha;

  const esHoy = fecha === hoyStr();

  const cargar = useCallback(async (f) => {
    if (!apiBase) return;
    setCargando(true);
    try {
      const res = await fetch(`${apiBase}/actividad-tipificacion?fecha=${f}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Evitar pisar datos si el usuario cambió de fecha mientras cargaba
      if (fechaRef.current === f) {
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

  // Carga inicial y al cambiar fecha
  useEffect(() => { cargar(fecha); }, [fecha, cargar]);

  // Refetch live con debounce 2s — solo si la fecha visible es hoy
  useEffect(() => {
    if (!refreshSignal || !esHoy) return;
    const t = setTimeout(() => cargar(fechaRef.current), 2000);
    return () => clearTimeout(t);
  }, [refreshSignal, esHoy, cargar]);

  if (!apiBase) {
    return (
      <div className="card" style={{ margin: 'var(--space-lg)', opacity: 0.6 }}>
        Panel disponible solo en modo remoto (servidor VM).
      </div>
    );
  }

  const asesores = [...(data?.asesores || [])].sort((a, b) => b.total_count - a.total_count);
  const hayDatos = asesores.some(a => a.total_count > 0);
  const maxTotal = Math.max(1, ...asesores.map(a => a.total_count));
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
        <input
          type="date"
          className="input"
          value={fecha}
          max={hoyStr()}
          onChange={e => { if (e.target.value) setFecha(e.target.value); }}
          style={{ marginLeft: 'auto', width: 'auto', padding: '10px 14px', fontSize: 13 }}
        />
      </div>

      {/* ── Cards resumen del equipo ── */}
      <div className="bento-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 'var(--space-lg)' }}>
        <div className="card" style={{ padding: 'var(--space-md) var(--space-lg)' }}>
          <div className="text-label" style={{ color: 'var(--color-on-surface-variant)', opacity: 0.7 }}>
            Gestiones del día
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
            <span className="text-mono" style={{ fontSize: 26, fontWeight: 800 }}>{equipo.total_count}</span>
            <span style={{ fontSize: 12, color: 'var(--color-on-surface-variant)', opacity: 0.7 }}>
              {fmtTiempo(equipo.total_tiempo)} al aire
            </span>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-on-surface-variant)', opacity: 0.6 }}>
            {conectadosCount}/{asesores.length} gestores conectados
          </div>
        </div>
        {CATEGORIAS.map(cat => {
          const meta = CAT_META[cat];
          const c = equipo.cats[cat];
          const pct = equipo.total_count > 0 ? Math.round((c.count / equipo.total_count) * 100) : 0;
          return (
            <div key={cat} className="card" style={{ padding: 'var(--space-md) var(--space-lg)', borderLeft: `3px solid ${meta.color}` }}>
              <div className="text-label" style={{ color: meta.color, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{meta.icon}</span>
                {meta.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
                <span className="text-mono" style={{ fontSize: 26, fontWeight: 800, color: meta.color }}>{c.count}</span>
                <span style={{ fontSize: 12, color: 'var(--color-on-surface-variant)', opacity: 0.7 }}>{pct}%</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-on-surface-variant)', opacity: 0.6 }}>
                {fmtTiempo(c.tiempo)} al aire
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Matriz gestores ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ padding: '14px 20px' }}>Gestor</th>
              {CATEGORIAS.map(cat => (
                <th key={cat} style={{ padding: '14px 20px', color: CAT_META[cat].color }}>
                  {CAT_META[cat].label}
                </th>
              ))}
              <th style={{ padding: '14px 20px' }}>Total</th>
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
                        <div style={{ fontSize: 11, color: conectado ? 'var(--color-primary)' : 'var(--color-on-surface-variant)', opacity: conectado ? 0.9 : 0.5 }}>
                          {conectado ? 'Conectado' : 'Desconectado'}
                        </div>
                      </div>
                    </div>
                  </td>
                  {CATEGORIAS.map(cat => celdaCategoria(a, cat))}
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
