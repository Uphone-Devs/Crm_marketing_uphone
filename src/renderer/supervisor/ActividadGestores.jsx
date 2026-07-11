import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * ActividadGestores – Supervisión en tiempo real de gestores por tipificación.
 * Matriz: fila por gestor, columnas por categoría (Exitoso/Neutro/No Contactado)
 * con conteo + tiempo al aire. Clic en fila → desglose por código.
 *
 * Live solo cuando fecha = hoy: el padre incrementa refreshSignal al recibir
 * TIPIFICACION_REALIZADA por WS y aquí se refetchea con debounce de 2s.
 * Fuente de verdad = DB (endpoint agregado); nunca se acumula en cliente.
 */

const CATEGORIAS = ['CONTACTO EXITOSO', 'CONTACTO NEUTRO', 'NO CONTACTADO'];
const CAT_LABELS = {
  'CONTACTO EXITOSO': 'Contacto Exitoso',
  'CONTACTO NEUTRO':  'Contacto Neutro',
  'NO CONTACTADO':    'No Contactado',
};
const CAT_COLORS = {
  'CONTACTO EXITOSO': '#22c55e',
  'CONTACTO NEUTRO':  '#eab308',
  'NO CONTACTADO':    '#94a3b8',
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
      <div style={{ padding: 24, opacity: 0.6 }}>
        Panel disponible solo en modo remoto (servidor VM).
      </div>
    );
  }

  const asesores = [...(data?.asesores || [])].sort((a, b) => b.total_count - a.total_count);
  const hayDatos = asesores.some(a => a.total_count > 0);

  const celda = (c) => (
    <span>
      <strong>{c.count}</strong>
      <span style={{ opacity: 0.55, fontSize: 12 }}> · {fmtTiempo(c.tiempo_seg)}</span>
    </span>
  );

  return (
    <div style={{ padding: '16px 8px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Actividad Gestores</h2>
        {esHoy && (
          <span style={{
            background: 'rgba(34,197,94,0.15)', color: '#22c55e',
            padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
            EN VIVO
          </span>
        )}
        <input
          type="date"
          value={fecha}
          max={hoyStr()}
          onChange={e => { if (e.target.value) setFecha(e.target.value); }}
          style={{ marginLeft: 'auto', padding: '4px 8px', borderRadius: 6 }}
        />
        {cargando && <span style={{ fontSize: 12, opacity: 0.5 }}>Actualizando…</span>}
        {error && <span style={{ fontSize: 12, color: '#f59e0b' }}>{error}</span>}
      </div>

      {/* Matriz */}
      <div className="stats-table">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 12, opacity: 0.7 }}>
              <th style={{ padding: '8px 12px' }}>Gestor</th>
              {CATEGORIAS.map(cat => (
                <th key={cat} style={{ padding: '8px 12px', color: CAT_COLORS[cat] }}>
                  {CAT_LABELS[cat]}
                </th>
              ))}
              <th style={{ padding: '8px 12px' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {asesores.map(a => {
              const conectado = !!(estadosWS && estadosWS[a.asesor_id]);
              return (
                <tr
                  key={a.asesor_id}
                  onClick={() => setDetalleAsesor(a)}
                  style={{ cursor: 'pointer', borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  title="Ver desglose por tipificación"
                >
                  <td style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: conectado ? '#22c55e' : '#64748b',
                      flexShrink: 0,
                    }} />
                    {a.nombre}
                  </td>
                  {CATEGORIAS.map(cat => (
                    <td key={cat} style={{ padding: '10px 12px' }}>
                      {celda(a.categorias[cat] || { count: 0, tiempo_seg: 0 })}
                    </td>
                  ))}
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                    {a.total_count}
                    <span style={{ opacity: 0.55, fontSize: 12, fontWeight: 400 }}> · {fmtTiempo(a.total_tiempo_seg)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && !hayDatos && (
          <div style={{ padding: 24, textAlign: 'center', opacity: 0.5 }}>
            Sin gestiones tipificadas el {data.fecha}.
          </div>
        )}
      </div>

      {/* Modal desglose por código */}
      {detalleAsesor && (
        <div
          onClick={() => setDetalleAsesor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface, #1e1e2e)', borderRadius: 12,
              padding: 20, minWidth: 480, maxHeight: '80vh', overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                {detalleAsesor.nombre} — desglose por tipificación
              </h3>
              <button
                type="button"
                onClick={() => setDetalleAsesor(null)}
                style={{ background: 'none', border: 'none', color: 'inherit', fontSize: 18, cursor: 'pointer' }}
              >✕</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', opacity: 0.7, fontSize: 12 }}>
                  <th style={{ padding: '6px 10px' }}>Código</th>
                  <th style={{ padding: '6px 10px' }}>Descripción</th>
                  <th style={{ padding: '6px 10px' }}>Categoría</th>
                  <th style={{ padding: '6px 10px' }}>Gestiones</th>
                  <th style={{ padding: '6px 10px' }}>Tiempo</th>
                </tr>
              </thead>
              <tbody>
                {detalleAsesor.detalle.map(d => (
                  <tr key={d.codigo} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{d.codigo}</td>
                    <td style={{ padding: '8px 10px' }}>{d.descripcion}</td>
                    <td style={{ padding: '8px 10px', color: CAT_COLORS[d.categoria] || 'inherit', fontSize: 12 }}>
                      {CAT_LABELS[d.categoria] || d.categoria}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{d.count}</td>
                    <td style={{ padding: '8px 10px' }}>{fmtTiempo(d.tiempo_seg)}</td>
                  </tr>
                ))}
                {detalleAsesor.detalle.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', opacity: 0.5 }}>
                    Sin gestiones tipificadas.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
