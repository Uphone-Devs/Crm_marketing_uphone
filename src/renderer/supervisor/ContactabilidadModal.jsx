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
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const CAT_COLOR = {
  'CONTACTO_EFECTIVO': { bg: 'rgba(0,230,118,0.15)', fg: '#00E676', label: 'Efectivo' },
  'CONTACTO EXITOSO':  { bg: 'rgba(0,230,118,0.15)', fg: '#00E676', label: 'Efectivo' },
  'CONTACTO_NEUTRO':   { bg: 'rgba(251,192,45,0.15)', fg: '#FBC02D', label: 'Neutro' },
  'CONTACTO NEUTRO':   { bg: 'rgba(251,192,45,0.15)', fg: '#FBC02D', label: 'Neutro' },
  'NO_CONTACTADO':     { bg: 'rgba(158,158,158,0.15)', fg: '#9E9E9E', label: 'No contactado' },
  'NO CONTACTADO':     { bg: 'rgba(158,158,158,0.15)', fg: '#9E9E9E', label: 'No contactado' },
};

const fmtHora = (ts) => {
  if (!ts || typeof ts !== 'string') return 'â€”';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    if (isNaN(d.getTime())) return 'â€”';
    return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return 'â€”'; }
};
const fmtDuracion = (seg) => {
  if (!seg || seg <= 0) return 'â€”';
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function ContactabilidadModal({ fechaDesde, fechaHasta, campanaId, asesores = [], campanas = [], onFiltersChange, onClose }) {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroAsesor, setFiltroAsesor] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('TODOS');
  const [filtroHora, setFiltroHora] = useState(''); // '' = todas, '8'..'23' = esa hora
  // Filtros editables dentro del modal (heredan los del supervisor pero pueden cambiar)
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
      .catch(err => { console.error('[CONTACT_MODAL]', err); if (!cancelled) setRegistros([]); })
      .finally(() => { if (!cancelled) setCargando(false); });
    // Propagar cambios al padre para que la card pequeÃ±a refleje el mismo filtro
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
      if (filtroCategoria !== 'TODOS') {
        const cat = (r.tipificacion_categoria || '').toUpperCase();
        if (filtroCategoria === 'EFECTIVO' && !(cat.includes('EFECTIVO') || cat.includes('EXITOSO'))) return false;
        if (filtroCategoria === 'NEUTRO' && !cat.includes('NEUTRO')) return false;
        if (filtroCategoria === 'NO_CONTACT' && !cat.includes('NO_CONTACTADO') && !cat.includes('NO CONTACTADO')) return false;
      }
      if (!txt) return true;
      const hay = [
        r.asesor_nombre, r.nombre_deudor, r.cedula, r.telefono,
        r.contrato, r.empresa, r.tipificacion_desc, r.notas,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(txt);
    });
  }, [registros, busqueda, filtroAsesor, filtroCategoria, filtroHora]);

  // DistribuciÃ³n por hora (para chips)
  const distribHora = useMemo(() => {
    const map = new Map();
    for (const r of filtrados) {
      if (r.hora_bucket == null) continue;
      map.set(r.hora_bucket, (map.get(r.hora_bucket) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [filtrados]);

  // Buckets 0-23 desglosados por categorÃ­a (para grÃ¡fico apilado)
  const dataGrafico = useMemo(() => {
    const buckets = new Array(24).fill(0).map((_, h) => ({
      hora: `${String(h).padStart(2, '0')}:00`,
      h,
      total: 0,
      efectivos: 0,
      neutros: 0,
      no_contactados: 0,
    }));
    for (const r of filtrados) {
      const h = r.hora_bucket;
      if (h == null || h < 0 || h > 23) continue;
      buckets[h].total++;
      const cat = (r.tipificacion_categoria || '').toUpperCase();
      if (cat.includes('EFECTIVO') || cat.includes('EXITOSO')) buckets[h].efectivos++;
      else if (cat.includes('NEUTRO')) buckets[h].neutros++;
      else if (cat.includes('NO_CONTACTADO') || cat.includes('NO CONTACTADO')) buckets[h].no_contactados++;
    }
    // Recortar horas vacÃ­as extremas para foco
    const firstActive = buckets.findIndex(b => b.total > 0);
    if (firstActive === -1) return buckets.slice(8, 19);
    const lastActive = 23 - [...buckets].reverse().findIndex(b => b.total > 0);
    return buckets.slice(Math.max(0, firstActive - 1), Math.min(24, lastActive + 2));
  }, [filtrados]);

  const horaPico = useMemo(() => {
    if (dataGrafico.length === 0) return null;
    return dataGrafico.reduce((max, b) => b.total > max.total ? b : max, dataGrafico[0]);
  }, [dataGrafico]);

  const totales = useMemo(() => {
    let efe = 0, neu = 0, noc = 0, conDur = 0, sumDur = 0;
    for (const r of filtrados) {
      const cat = (r.tipificacion_categoria || '').toUpperCase();
      if (cat.includes('EFECTIVO') || cat.includes('EXITOSO')) efe++;
      else if (cat.includes('NEUTRO')) neu++;
      else if (cat.includes('NO_CONTACTADO') || cat.includes('NO CONTACTADO')) noc++;
      if (r.duracion_seg) { conDur++; sumDur += Number(r.duracion_seg) || 0; }
    }
    return { efe, neu, noc, totalDur: sumDur, dursAvg: conDur > 0 ? Math.round(sumDur / conDur) : 0 };
  }, [filtrados]);

  const exportarXls = async () => {
    if (filtrados.length === 0) return;
    try {
      const apiBase = buildApiBase();
      const authToken = localStorage.getItem('auth_token');
      if (apiBase) {
        await vmReportDownload(apiBase, authToken, 'contactabilidad_hora', {
          fecha: filtroFecha || '', asesor_id: filtroAsesor || '', campana_id: filtroCampana || '', formato: 'xlsx',
        });
      } else {
        const res = await window.api.invoke('reports:generate', 'contactabilidad_hora', {
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
    const headers = ['Hora Inicio', 'Hora Fin', 'DuraciÃ³n (s)', 'Asesor', 'Cliente', 'CÃ©dula', 'TelÃ©fono', 'Empresa', 'Contrato', 'TipificaciÃ³n', 'CategorÃ­a', 'Notas'];
    const rows = filtrados.map(r => [
      r.hora_inicio || '', r.hora_fin || '', r.duracion_seg || '',
      r.asesor_nombre || '', r.nombre_deudor || '', r.cedula || '', r.telefono || '',
      r.empresa || '', r.contrato || '',
      r.tipificacion_desc || '', r.tipificacion_categoria || '', r.notas || '',
    ].map(esc).join(','));
    const csv = 'ï»¿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contactabilidad_${filtroFecha || 'todas'}.csv`;
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
            <span style={{ fontSize: 10, opacity: 0.5, fontWeight: 700, letterSpacing: 0.5 }}>SUPERVISOR Â· DETALLE</span>
            <h3 style={{ margin: '4px 0 0', fontSize: 16 }}>Contactabilidad por Hora</h3>
            <p style={{ margin: '2px 0 0', fontSize: 11, opacity: 0.5 }}>
              Cada gestiÃ³n con asesor, hora inicio/fin, duraciÃ³n y tipificaciÃ³n
              {filtroFecha && filtroFechaFin && filtroFecha !== filtroFechaFin
                ? ` â€” ${filtroFecha} â†’ ${filtroFechaFin}`
                : filtroFecha ? ` â€” ${filtroFecha}` : ' â€” todas las fechas'}
              {filtroCampana && campanas.find(c => String(c.id) === filtroCampana)
                ? ` Â· campaÃ±a: ${campanas.find(c => String(c.id) === filtroCampana).nombre}`
                : ''}
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'inherit',
            cursor: 'pointer', display: 'flex', padding: 4,
          }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Barra filtros temporales (DÃ­a + CampaÃ±a) */}
        <div style={{
          padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          background: 'rgba(255,255,255,0.02)',
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.55, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 3 }}>filter_alt</span>
            Filtrar
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, opacity: 0.5 }}>Desde</span>
            <input
              type="date"
              value={filtroFecha}
              onChange={(e) => {
                const val = e.target.value;
                setFiltroFecha(val);
                if (!filtroFechaFin || filtroFechaFin < val) setFiltroFechaFin(val);
              }}
              style={{
                padding: '5px 8px', fontSize: 11, colorScheme: 'dark',
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit', outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, opacity: 0.5 }}>Hasta</span>
            <input
              type="date"
              value={filtroFechaFin}
              min={filtroFecha || undefined}
              onChange={e => setFiltroFechaFin(e.target.value)}
              style={{
                padding: '5px 8px', fontSize: 11, colorScheme: 'dark',
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit', outline: 'none',
              }}
            />
          </div>
          <button
            onClick={() => { setFiltroFecha(todayLocalISO()); setFiltroFechaFin(todayLocalISO()); }}
            style={{
              padding: '4px 8px', fontSize: 9, fontWeight: 700,
              background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)',
              color: 'var(--color-primary)', borderRadius: 6, cursor: 'pointer',
            }}
          >HOY</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, opacity: 0.5 }}>CampaÃ±a</span>
            <select
              value={filtroCampana}
              onChange={e => setFiltroCampana(e.target.value)}
              style={{
                padding: '5px 8px', fontSize: 11, minWidth: 140,
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit', outline: 'none',
              }}
            >
              <option value="">Todas</option>
              {campanas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          {(filtroFecha || filtroCampana) && (
            <button
              onClick={() => { setFiltroFecha(''); setFiltroFechaFin(''); setFiltroCampana(''); }}
              style={{
                padding: '5px 10px', fontSize: 10,
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

        {/* Toolbar (bÃºsqueda + asesor + categorÃ­a + hora + KPIs + export) */}
        <div style={{
          padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1 1 200px', position: 'relative', minWidth: 180 }}>
            <span className="material-symbols-outlined" style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              fontSize: 14, opacity: 0.4, pointerEvents: 'none',
            }}>search</span>
            <input
              type="text"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar asesor, cliente, cÃ©dula, contrato, notas..."
              style={{
                width: '100%', padding: '5px 10px 5px 28px', fontSize: 12,
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit', outline: 'none',
              }}
            />
          </div>
          <select value={filtroAsesor} onChange={e => setFiltroAsesor(e.target.value)} style={inputStyle}>
            <option value="">Todos asesores</option>
            {asesores.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value)} style={inputStyle}>
            <option value="TODOS">Todas categorÃ­as</option>
            <option value="EFECTIVO">Efectivos</option>
            <option value="NEUTRO">Neutros</option>
            <option value="NO_CONTACT">No contactados</option>
          </select>
          <select value={filtroHora} onChange={e => setFiltroHora(e.target.value)} style={inputStyle}>
            <option value="">Toda hora</option>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00 â€” {String(h).padStart(2, '0')}:59</option>
            ))}
          </select>
          <Kpi label="Total" value={filtrados.length} color="var(--color-primary)" />
          <Kpi label="Efectivos" value={totales.efe} color="#00E676" />
          <Kpi label="Neutros" value={totales.neu} color="#FBC02D" />
          <Kpi label="Sin contacto" value={totales.noc} color="#9E9E9E" />


        </div>

        {/* Ãrea scrolleable: grÃ¡fico + chips + tabla en un solo flujo vertical */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

        {/* GrÃ¡fico ampliado: gestiones por hora apiladas */}
        {!cargando && filtrados.length > 0 && (
          <div style={{
            padding: '12px 18px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)',
            background: 'rgba(255,255,255,0.015)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div>
                <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.55, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  DistribuciÃ³n por Hora
                </span>
                <p style={{ margin: '2px 0 0', fontSize: 10, opacity: 0.4 }}>
                  Click en una barra para filtrar por esa hora
                </p>
              </div>
              {horaPico && horaPico.total > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 9, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase' }}>Pico</span>
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-primary)' }}>
                    {horaPico.hora} Â· {horaPico.total} gestiones
                  </div>
                </div>
              )}
            </div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer minWidth={1} minHeight={1} width="100%" height="100%">
                <BarChart
                  data={dataGrafico}
                  margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
                  onClick={(e) => {
                    if (e?.activePayload?.[0]?.payload) {
                      const h = e.activePayload[0].payload.h;
                      setFiltroHora(filtroHora === String(h) ? '' : String(h));
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="hora" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.55)' }} interval={0} />
                  <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.55)' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#0f0f0f', border: '1px solid #333', borderRadius: 8, fontSize: 11 }}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconType="circle" />
                  <Bar dataKey="efectivos" stackId="a" fill="#00E676" name="Efectivos" radius={[3, 3, 0, 0]} cursor="pointer" />
                  <Bar dataKey="neutros" stackId="a" fill="#FBC02D" name="Neutros" cursor="pointer" />
                  <Bar dataKey="no_contactados" stackId="a" fill="#9E9E9E" name="No contactados" cursor="pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Chips horario (click rÃ¡pido) */}
        {distribHora.length > 0 && (
          <div style={{
            padding: '8px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <span style={{ fontSize: 9, opacity: 0.5, fontWeight: 700 }}>HORAS:</span>
            {distribHora.map(([h, n]) => {
              const activo = filtroHora === String(h);
              return (
                <button key={h}
                  onClick={() => setFiltroHora(activo ? '' : String(h))}
                  style={{
                    padding: '2px 8px', fontSize: 10, fontWeight: 600,
                    background: activo ? 'rgba(0,230,118,0.2)' : 'rgba(255,255,255,0.05)',
                    border: '1px solid ' + (activo ? 'rgba(0,230,118,0.4)' : 'rgba(255,255,255,0.08)'),
                    color: activo ? 'var(--color-primary)' : 'inherit',
                    borderRadius: 99, cursor: 'pointer',
                  }}>
                  {String(h).padStart(2, '0')}:00 Â· {n}
                </button>
              );
            })}
          </div>
        )}

        {/* Tabla */}
        <div style={{ padding: '8px 12px' }}>
          {cargando ? (
            <div style={{ padding: 60, textAlign: 'center', opacity: 0.5 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 32 }}>sync</span>
              <p style={{ marginTop: 8, fontSize: 12 }}>Cargando...</p>
            </div>
          ) : filtrados.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', opacity: 0.4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 36 }}>folder_off</span>
              <p style={{ marginTop: 8, fontSize: 12 }}>Sin gestiones para los filtros aplicados</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)', textAlign: 'left', position: 'sticky', top: 0 }}>
                  <th style={th}>Hora Inicio</th>
                  <th style={th}>Hora Fin</th>
                  <th style={th}>DuraciÃ³n</th>
                  <th style={th}>Asesor</th>
                  <th style={th}>Cliente</th>
                  <th style={th}>TelÃ©fono</th>
                  <th style={th}>Contrato</th>
                  <th style={th}>TipificaciÃ³n</th>
                  <th style={th}>CategorÃ­a</th>
                  <th style={th}>Notas</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((r, i) => {
                  const cat = (r.tipificacion_categoria || '').toUpperCase().replace(' ', '_');
                  const catStyle = CAT_COLOR[cat] || CAT_COLOR[r.tipificacion_categoria] || { bg: 'rgba(255,255,255,0.08)', fg: '#ccc', label: r.tipificacion_categoria || 'â€”' };
                  const rowKey = r.cdr_id != null ? `cdr-${r.cdr_id}` : `ext-${i}`;
                  return (
                    <tr key={rowKey} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={td}><span className="text-mono" style={{ fontSize: 10 }}>{fmtHora(r.hora_inicio)}</span></td>
                      <td style={td}><span className="text-mono" style={{ fontSize: 10 }}>{fmtHora(r.hora_fin)}</span></td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtDuracion(r.duracion_seg)}</td>
                      <td style={td}>{r.asesor_nombre || 'â€”'}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{r.nombre_deudor || 'â€”'}</td>
                      <td style={td}><span className="text-mono">{r.telefono || 'â€”'}</span></td>
                      <td style={td}><span className="text-mono" style={{ fontSize: 10 }}>{r.contrato || 'â€”'}</span></td>
                      <td style={td}>{r.tipificacion_desc || 'â€”'}</td>
                      <td style={td}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
                          background: catStyle.bg, color: catStyle.fg, whiteSpace: 'nowrap',
                        }}>
                          {catStyle.label}
                        </span>
                      </td>
                      <td style={{ ...td, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.75 }} title={r.notas || ''}>
                        {r.notas || <span style={{ opacity: 0.3 }}>â€”</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        </div>{/* fin Ã¡rea scrolleable */}
      </div>
    </div>
  );
}

const th = { padding: '8px 10px', fontSize: 10, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 };
const td = { padding: '7px 10px', verticalAlign: 'middle' };
const inputStyle = {
  padding: '5px 8px', fontSize: 11,
  background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6, color: 'inherit', outline: 'none',
};

function Kpi({ label, value, color }) {
  return (
    <div style={{
      padding: '6px 10px', borderRadius: 6, minWidth: 70,
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ fontSize: 8, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: color || 'inherit' }}>{value}</div>
    </div>
  );
}
