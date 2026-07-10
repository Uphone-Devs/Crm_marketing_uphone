import React, { useEffect, useState, useMemo } from 'react';
import { todayLocalISO } from '../shared/timeUtils';

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  if (!ws || ws === '127.0.0.1' || ws === 'localhost') return null;
  return (ws.startsWith('http') ? ws.replace(/\/$/, '') : `http://${ws}:3001`) + '/api';
}
async function vmReportDownload(apiBase, token, tipo, params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') qs.set(k, String(v)); });
  const res = await fetch(`${apiBase}/reports/${tipo}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const match = (res.headers.get('content-disposition') || '').match(/filename="?([^";\n]+)"?/);
  const filename = match ? match[1] : `reporte_${tipo}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const _EMPTY_ARR = [];

const VOLUMEN_COLORS = ['#00E5FF', '#2979FF', '#651FFF', '#FF6E40', '#1DE9B6', '#FFD740', '#F50057', '#7C4DFF', '#69F0AE', '#FFAB40', '#40C4FF', '#B388FF'];

const fmtHora = (ts) => {
  if (!ts || typeof ts !== 'string') return 'â€"';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return 'â€"';
    return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return 'â€"'; }
};
const fmtDuracion = (seg) => {
  if (!seg || seg <= 0) return 'â€"';
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/**
 * VolumenModal â€" Detalle de Volumen de Marcación por Hora.
 * Reutiliza el endpoint db:getDetalleContactabilidad (mismo dataset que
 * ContactabilidadModal) pero presenta el desglose por asesor + hora.
 */
export default function VolumenModal({ fechaDesde, fechaHasta, campanaId, asesores = _EMPTY_ARR, campanas = _EMPTY_ARR, onFiltersChange, onClose }) {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroAsesor, setFiltroAsesor] = useState('');
  const [filtroHora, setFiltroHora] = useState('');
  const [filtroFecha,    setFiltroFecha]    = useState(fechaDesde || '');
  const [filtroFechaFin, setFiltroFechaFin] = useState(fechaHasta || fechaDesde || '');
  const [filtroCampana, setFiltroCampana] = useState(campanaId ? String(campanaId) : '');

  useEffect(() => {
    let cancelled = false;
    setCargando(true);
    const camp = filtroCampana ? Number(filtroCampana) : null;
    const apiBase = buildApiBase();
    const authToken = localStorage.getItem('auth_token');
    let promise;
    if (apiBase) {
      const qs = new URLSearchParams();
      if (filtroFecha) qs.set('fecha', filtroFecha);
      if (filtroFechaFin) qs.set('fecha_fin', filtroFechaFin);
      if (camp) qs.set('campana_id', String(camp));
      promise = fetch(`${apiBase}/cartera/detalle-contactabilidad?${qs}`, { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.json());
    } else {
      promise = window.api.invoke('db:getDetalleContactabilidad', filtroFecha || null, null, camp, filtroFechaFin || null);
    }
    promise
      .then(d => { if (!cancelled) setRegistros(Array.isArray(d) ? d : []); })
      .catch(err => { console.error('[VOLUMEN_MODAL]', err); if (!cancelled) setRegistros([]); })
      .finally(() => { if (!cancelled) setCargando(false); });
    if (typeof onFiltersChange === 'function') {
      onFiltersChange(filtroFecha || null, filtroFechaFin || filtroFecha || null, filtroCampana ? Number(filtroCampana) : null);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroFecha, filtroFechaFin, filtroCampana]);

  const filtrados = useMemo(() => {
    const txt = busqueda.trim().toLowerCase();
    return registros.filter(r => {
      if (filtroAsesor && String(r.usuario_id) !== String(filtroAsesor)) return false;
      if (filtroHora !== '' && String(r.hora_bucket) !== filtroHora) return false;
      if (!txt) return true;
      const hay = [
        r.asesor_nombre, r.nombre_deudor, r.cedula, r.telefono,
        r.contrato, r.empresa, r.tipificacion_desc, r.notas,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(txt);
    });
  }, [registros, busqueda, filtroAsesor, filtroHora]);

  // Pipeline volumen: agrupa por hora + asesor
  const volumenInfo = useMemo(() => {
    const aMap = new Map();
    for (const r of filtrados) {
      if (r.usuario_id == null) continue;
      if (!aMap.has(r.usuario_id)) aMap.set(r.usuario_id, r.asesor_nombre || `Asesor ${r.usuario_id}`);
    }
    const asesorIds = Array.from(aMap.keys());
    const keyOf = (aid) => `a${aid}`;
    const labelOf = (aid) => (aMap.get(aid) || '').split(' ')[0] || `A${aid}`;

    const buckets = new Array(24).fill(0).map((_, h) => {
      const obj = { hora: `${String(h).padStart(2, '0')}:00`, h, total: 0 };
      asesorIds.forEach(aid => { obj[keyOf(aid)] = 0; });
      return obj;
    });
    for (const r of filtrados) {
      const h = r.hora_bucket;
      if (h == null || h < 0 || h > 23 || r.usuario_id == null) continue;
      buckets[h].total++;
      const k = keyOf(r.usuario_id);
      buckets[h][k] = (buckets[h][k] || 0) + 1;
    }
    const firstActive = buckets.findIndex(b => b.total > 0);
    const lastActive = buckets.length - 1 - [...buckets].reverse().findIndex(b => b.total > 0);
    const data = firstActive === -1
      ? buckets.slice(8, 19)
      : buckets.slice(Math.max(0, firstActive - 1), Math.min(24, lastActive + 2));

    return {
      data,
      asesores: asesorIds.map(aid => ({
        id: aid, key: keyOf(aid), label: labelOf(aid), nombre: aMap.get(aid),
      })),
    };
  }, [filtrados]);

  // Resumen por asesor (totales + hora pico individual)
  const resumenAsesores = useMemo(() => {
    return volumenInfo.asesores
      .map((a, i) => {
        let total = 0;
        let peakH = 'â€"', peakV = 0;
        volumenInfo.data.forEach(b => {
          const v = b[a.key] || 0;
          total += v;
          if (v > peakV) { peakV = v; peakH = b.hora; }
        });
        return { ...a, total, peakH, peakV, color: VOLUMEN_COLORS[i % VOLUMEN_COLORS.length] };
      })
      .sort((x, y) => y.total - x.total);
  }, [volumenInfo]);

  const horaPico = useMemo(() => {
    if (volumenInfo.data.length === 0) return null;
    return volumenInfo.data.reduce((max, b) => b.total > max.total ? b : max, volumenInfo.data[0]);
  }, [volumenInfo]);

  // Distribución por hora (chips)
  const distribHora = useMemo(() => {
    const map = new Map();
    for (const r of filtrados) {
      if (r.hora_bucket == null) continue;
      map.set(r.hora_bucket, (map.get(r.hora_bucket) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [filtrados]);

  const exportarXls = async () => {
    if (filtrados.length === 0) return;
    try {
      const apiBase = buildApiBase();
      const authToken = localStorage.getItem('auth_token');
      if (apiBase) {
        await vmReportDownload(apiBase, authToken, 'volumen_hora', {
          fecha: filtroFecha || '', asesor_id: filtroAsesor || '', campana_id: filtroCampana || '', formato: 'xlsx',
        });
      } else {
        const res = await window.api.invoke('reports:generate', 'volumen_hora', {
          fecha: filtroFecha || null, asesor_id: filtroAsesor ? Number(filtroAsesor) : null,
          campana_id: filtroCampana ? Number(filtroCampana) : null, formato: 'xlsx',
        });
        if (res?.success && res.archivo) await window.api.invoke('shell:openPath', res.archivo);
        else alert('Error: ' + (res?.error || 'desconocido'));
      }
    } catch (err) {
      alert('Error: ' + (err.message || err));
    }
  };

  const exportarCsv = () => {
    if (filtrados.length === 0) return;
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const headers = ['Hora Inicio', 'Hora Fin', 'Duración (s)', 'Hora bucket', 'Asesor', 'Cliente', 'Cédula', 'Teléfono', 'Empresa', 'Contrato', 'Tipificación', 'Categoría', 'Notas'];
    const rows = filtrados.map(r => [
      r.hora_inicio || '', r.hora_fin || '', r.duracion_seg || '',
      r.hora_bucket != null ? `${String(r.hora_bucket).padStart(2, '0')}:00` : '',
      r.asesor_nombre || '', r.nombre_deudor || '', r.cedula || '', r.telefono || '',
      r.empresa || '', r.contrato || '',
      r.tipificacion_desc || '', r.tipificacion_categoria || '', r.notas || '',
    ].map(esc).join(','));
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `volumen_marcacion_${filtroFecha || 'todas'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#121212', color: 'inherit', borderRadius: 12,
        maxWidth: 1500, width: '100%', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <span style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, letterSpacing: 0.5 }}>JEFE DE AREA · DETALLE</span>
            <h3 style={{ margin: '4px 0 0', fontSize: 16 }}>Volumen de Marcación por Hora</h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.5 }}>
              Marcaciones agrupadas por hora con stack por asesor â€" correlaciona volumen vs efectividad
              {filtroFecha && filtroFechaFin && filtroFecha !== filtroFechaFin
                ? ` â€" ${filtroFecha} â†' ${filtroFechaFin}`
                : filtroFecha ? ` â€" ${filtroFecha}` : ' â€" todas las fechas'}
              {filtroCampana && campanas.find(c => String(c.id) === filtroCampana)
                ? ` · campaña: ${campanas.find(c => String(c.id) === filtroCampana).nombre}`
                : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'inherit',
            cursor: 'pointer', display: 'flex', padding: 4,
          }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Filtros temporales (Día + Campaña) */}
        <div style={{
          padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          background: 'rgba(255,255,255,0.02)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.55, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 3 }}>filter_alt</span>
            Filtrar
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>Desde</span>
            <input aria-label="Desde"
              type="date"
              value={filtroFecha}
              onChange={(e) => {
                const val = e.target.value;
                setFiltroFecha(val);
                if (!filtroFechaFin || filtroFechaFin < val) setFiltroFechaFin(val);
              }}
              style={{
                padding: '5px 8px', fontSize: 12, colorScheme: 'dark',
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>Hasta</span>
            <input aria-label="Hasta"
              type="date"
              value={filtroFechaFin}
              min={filtroFecha || undefined}
              onChange={e => setFiltroFechaFin(e.target.value)}
              style={{
                padding: '5px 8px', fontSize: 12, colorScheme: 'dark',
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit',
              }}
            />
          </div>
          <button type="button"
            onClick={() => { setFiltroFecha(todayLocalISO()); setFiltroFechaFin(todayLocalISO()); }}
            style={{
              padding: '4px 8px', fontSize: 12, fontWeight: 700,
              background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)',
              color: 'var(--color-primary)', borderRadius: 6, cursor: 'pointer',
            }}
          >HOY</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>Campaña</span>
            <select
              value={filtroCampana}
              onChange={e => setFiltroCampana(e.target.value)}
              style={{
                padding: '5px 8px', fontSize: 12, minWidth: 140,
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit',
              }}
            >
              <option value="">Todas</option>
              {campanas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          {(filtroFecha || filtroCampana) && (
            <button type="button"
              onClick={() => { setFiltroFecha(''); setFiltroFechaFin(''); setFiltroCampana(''); }}
              style={{
                padding: '5px 10px', fontSize: 12,
                background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.25)',
                color: '#ff8080', borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>filter_alt_off</span>
              Limpiar
            </button>
          )}
        </div>

        {/* Toolbar: búsqueda + asesor + hora + KPIs + export */}
        <div style={{
          padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1 1 200px', position: 'relative', minWidth: 180 }}>
            <span className="material-symbols-outlined" style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              fontSize: 14, opacity: 0.4, pointerEvents: 'none',
            }}>search</span>
            <input aria-label="Campo"
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar asesor, cliente, cédula, contrato, notas..."
              style={{
                width: '100%', padding: '5px 10px 5px 28px', fontSize: 12,
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit',
              }}
            />
          </div>
          <select value={filtroAsesor} onChange={e => setFiltroAsesor(e.target.value)} style={inputStyle}>
            <option value="">Todos asesores</option>
            {asesores.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
          <select value={filtroHora} onChange={e => setFiltroHora(e.target.value)} style={inputStyle}>
            <option value="">Toda hora</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00 â€" {String(h).padStart(2, '0')}:59</option>
            ))}
          </select>
          <Kpi label="Marcaciones" value={filtrados.length} color="var(--color-primary)" />
          <Kpi label="Asesores" value={volumenInfo.asesores.length} color="#00E5FF" />
          <Kpi label="Pico" value={horaPico ? `${horaPico.hora} (${horaPico.total})` : 'â€"'} color="#FFD740" />


        </div>

        {/* Área scrolleable */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

          {/* Gráfico ampliado: volumen por hora apilado por asesor */}
          {!cargando && filtrados.length > 0 && (
            <div style={{
              padding: '12px 18px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)',
              background: 'rgba(255,255,255,0.015)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.55, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    Distribución por Hora · Stack por Asesor
                  </span>
                  <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.4 }}>
                    Click en el gráfico para filtrar por esa hora
                  </p>
                </div>
                {horaPico && horaPico.total > 0 && (
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase' }}>Pico</span>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-primary)' }}>
                      {horaPico.hora} · {horaPico.total} marcaciones
                    </div>
                  </div>
                )}
              </div>
              <div style={{ height: 320 }}>
                <ResponsiveContainer minWidth={1} minHeight={1} width="100%" height="100%">
                  <AreaChart
                    data={volumenInfo.data}
                    margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                    onClick={(e) => {
                      if (e?.activePayload?.[0]?.payload) {
                        const h = e.activePayload[0].payload.h;
                        setFiltroHora(filtroHora === String(h) ? '' : String(h));
                      }
                    }}
                  >
                    <defs>
                      {volumenInfo.asesores.map((a, i) => (
                        <linearGradient key={`g-${a.key}`} id={`grad-${a.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={VOLUMEN_COLORS[i % VOLUMEN_COLORS.length]} stopOpacity={0.7} />
                          <stop offset="95%" stopColor={VOLUMEN_COLORS[i % VOLUMEN_COLORS.length]} stopOpacity={0.05} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="hora" tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.55)' }} interval={0} />
                    <YAxis tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.55)' }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: '#0f0f0f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                      cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }}
                      formatter={(v, name) => {
                        const a = volumenInfo.asesores.find(x => x.label === name);
                        return [v, a?.nombre || name];
                      }}
                      labelFormatter={(label, payload) => {
                        const total = payload?.reduce((s, p) => s + (p.value || 0), 0) || 0;
                        return `${label} · Total: ${total}`;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                    {volumenInfo.asesores.map((a, i) => (
                      <Area
                        key={a.key}
                        type="monotone"
                        dataKey={a.key}
                        name={a.label}
                        stackId="vol"
                        stroke={VOLUMEN_COLORS[i % VOLUMEN_COLORS.length]}
                        strokeWidth={1.5}
                        fill={`url(#grad-${a.key})`}
                        cursor="pointer"
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Chips horario (click rápido) */}
          {distribHora.length > 0 && (
            <div style={{
              padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, opacity: 0.5, fontWeight: 700 }}>HORAS:</span>
              {distribHora.map(([h, n]) => {
                const activo = filtroHora === String(h);
                return (
                  <button type="button" key={h}
                    onClick={() => setFiltroHora(activo ? '' : String(h))}
                    style={{
                      padding: '2px 8px', fontSize: 12, fontWeight: 600,
                      background: activo ? 'rgba(0,230,118,0.2)' : 'rgba(255,255,255,0.05)',
                      border: '1px solid ' + (activo ? 'rgba(0,230,118,0.4)' : 'rgba(255,255,255,0.08)'),
                      color: activo ? 'var(--color-primary)' : 'inherit',
                      borderRadius: 99, cursor: 'pointer',
                    }}>
                    {String(h).padStart(2, '0')}:00 · {n}
                  </button>
                );
              })}
            </div>
          )}

          {/* Desglose por Asesor â€" totales + hora pico individual */}
          {resumenAsesores.length > 0 && (
            <div style={{
              padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)',
              background: 'rgba(255,255,255,0.015)',
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.55, letterSpacing: 0.5, textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                Desglose por Asesor
              </span>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)', textAlign: 'left' }}>
                    <th style={th}>Asesor</th>
                    <th style={{ ...th, textAlign: 'right' }}>Marcaciones</th>
                    <th style={{ ...th, textAlign: 'right' }}>% del Total</th>
                    <th style={{ ...th, textAlign: 'center' }}>Hora Pico</th>
                    <th style={{ ...th, textAlign: 'center' }}>Pico (n)</th>
                    <th style={{ ...th, textAlign: 'left' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {resumenAsesores.map(a => (
                    <tr key={a.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: a.color, display: 'inline-block' }} />
                          <span style={{ fontWeight: 600 }}>{a.nombre}</span>
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: 'var(--color-primary)' }}>{a.total}</td>
                      <td style={{ ...td, textAlign: 'right', opacity: 0.8 }}>
                        {filtrados.length > 0 ? `${Math.round((a.total / filtrados.length) * 100)}%` : '0%'}
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}><span className="text-mono">{a.peakH}</span></td>
                      <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{a.peakV}</td>
                      <td style={td}>
                        <button type="button"
                          onClick={() => setFiltroAsesor(filtroAsesor === String(a.id) ? '' : String(a.id))}
                          style={{
                            padding: '2px 8px', fontSize: 12, fontWeight: 700,
                            background: filtroAsesor === String(a.id) ? 'rgba(0,230,118,0.2)' : 'rgba(255,255,255,0.05)',
                            border: '1px solid ' + (filtroAsesor === String(a.id) ? 'rgba(0,230,118,0.4)' : 'rgba(255,255,255,0.08)'),
                            color: filtroAsesor === String(a.id) ? 'var(--color-primary)' : 'inherit',
                            borderRadius: 4, cursor: 'pointer',
                          }}
                        >
                          {filtroAsesor === String(a.id) ? 'Quitar filtro' : 'Filtrar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tabla de CDRs detallada */}
          <div style={{ padding: '8px 12px' }}>
            {cargando ? (
              <div style={{ padding: 60, textAlign: 'center', opacity: 0.5 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 32 }}>sync</span>
                <p style={{ marginTop: 8, fontSize: 12 }}>Cargando...</p>
              </div>
            ) : filtrados.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center', opacity: 0.4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 36 }}>folder_off</span>
                <p style={{ marginTop: 8, fontSize: 12 }}>Sin marcaciones para los filtros aplicados</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)', textAlign: 'left', position: 'sticky', top: 0 }}>
                    <th style={th}>Hora Inicio</th>
                    <th style={th}>Hora Fin</th>
                    <th style={th}>Duración</th>
                    <th style={th}>Asesor</th>
                    <th style={th}>Cliente</th>
                    <th style={th}>Teléfono</th>
                    <th style={th}>Contrato</th>
                    <th style={th}>Tipificación</th>
                    <th style={th}>Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map(r => (
                    <tr key={`v-${r.cdr_id}`} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={td}><span className="text-mono" style={{ fontSize: 12 }}>{fmtHora(r.hora_inicio)}</span></td>
                      <td style={td}><span className="text-mono" style={{ fontSize: 12 }}>{fmtHora(r.hora_fin)}</span></td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtDuracion(r.duracion_seg)}</td>
                      <td style={td}>{r.asesor_nombre || 'â€"'}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{r.nombre_deudor || 'â€"'}</td>
                      <td style={td}><span className="text-mono">{r.telefono || 'â€"'}</span></td>
                      <td style={td}><span className="text-mono" style={{ fontSize: 12 }}>{r.contrato || 'â€"'}</span></td>
                      <td style={td}>{r.tipificacion_desc || <span style={{ opacity: 0.3 }}>â€"</span>}</td>
                      <td style={{ ...td, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75 }} title={r.notas || ''}>
                        {r.notas || <span style={{ opacity: 0.3 }}>â€"</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const th = { padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 };
const td = { padding: '7px 10px', verticalAlign: 'middle' };
const inputStyle = {
  padding: '5px 8px', fontSize: 12,
  background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6, color: 'inherit',
};

function Kpi({ label, value, color }) {
  return (
    <div style={{
      padding: '6px 10px', borderRadius: 6, minWidth: 70,
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: color || 'inherit' }}>{value}</div>
    </div>
  );
}
