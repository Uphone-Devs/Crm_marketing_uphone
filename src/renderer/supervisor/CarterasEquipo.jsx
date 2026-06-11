import React, { useState, useEffect, useMemo } from 'react';
import { todayLocalISO } from '../shared/timeUtils';

const ESTADO_STYLE = {
  PENDIENTE:   { bg: 'rgba(255,152,0,0.15)',  fg: '#ffb74d', label: 'Pendiente'   },
  EN_INTENTOS: { bg: 'rgba(251,192,45,0.15)', fg: '#fbc02d', label: 'En intentos' },
  AGENDADO:    { bg: 'rgba(33,150,243,0.15)', fg: '#64b5f6', label: 'Agendado'    },
  GESTIONADO:  { bg: 'rgba(0,230,118,0.18)',  fg: 'var(--color-primary)', label: 'Gestionado' },
  YA_PAGO:     { bg: 'rgba(156,39,176,0.15)', fg: '#ce93d8', label: 'Ya pagó'     },
};

// YA_PAGO no validado (declarado por asesor) — visualmente distinto y recallable
const ESTADO_STYLE_YA_PAGO_DECL = {
  bg: 'rgba(255,193,7,0.15)', fg: '#ffd54f', label: 'Ya pagó (s/validar)',
};

// Cola de marcación: PENDIENTE/EN_INTENTOS por defecto. Cualquier otro estado
// (GESTIONADO, AGENDADO, YA_PAGO declarado) entra si el supervisor le asignó
// orden_marcacion explícito. Solo YA_PAGO validado bancariamente queda blindado.
function estaEnCola(r) {
  if (r.validado_pago === 1) return false;
  if (r.estado_marcacion === 'EN_INTENTOS' || r.estado_marcacion === 'PENDIENTE') return true;
  if (r.orden_marcacion != null) return true;
  return false;
}

const fmtFecha = (raw) => {
  if (!raw) return '—';
  try {
    const d = new Date(String(raw).replace(' ', 'T'));
    if (isNaN(d.getTime())) return raw;
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  } catch { return raw; }
};

export default function CarterasEquipo({ callApi }) {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [filtroAsesor, setFiltroAsesor] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('TODOS');
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [agrupar, setAgrupar] = useState(true);
  const [colapsados, setColapsados] = useState(new Set());

  const cargar = async () => {
    setCargando(true);
    try {
      const data = await callApi('db:getCarteraEquipo');
      setRegistros(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[CARTERAS_EQ]', err);
      setRegistros([]);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, []);

  const asesores = useMemo(() => {
    const set = new Map();
    registros.forEach(r => {
      if (r.asesor_nombre && !set.has(r.asignado_a)) set.set(r.asignado_a, r.asesor_nombre);
    });
    return Array.from(set.entries()).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [registros]);

  const filtrados = useMemo(() => {
    const txt = filtroTexto.trim().toLowerCase();
    const extraerFechaIso = (raw) => {
      if (!raw || typeof raw !== 'string') return '';
      // Acepta 'YYYY-MM-DD' o 'YYYY-MM-DD HH:MM:SS' — slice los primeros 10 chars
      return raw.length >= 10 ? raw.slice(0, 10) : '';
    };
    return registros.filter(r => {
      if (filtroAsesor && String(r.asignado_a) !== String(filtroAsesor)) return false;
      if (filtroEstado !== 'TODOS' && r.estado_marcacion !== filtroEstado) return false;
      if (filtroDesde || filtroHasta) {
        const f = extraerFechaIso(r.fecha_asignacion);
        if (filtroDesde && (!f || f < filtroDesde)) return false;
        if (filtroHasta && (!f || f > filtroHasta)) return false;
      }
      if (!txt) return true;
      let meta = {};
      try { meta = JSON.parse(r.metadata || '{}'); } catch (_) {}
      const hay = [
        r.nombre_deudor, r.cedula, r.telefono, r.producto,
        r.asesor_nombre, r.campana_nombre,
        meta['Nº CONTRATO'], meta['CONTRATO'], meta['EMPRESA'],
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(txt);
    });
  }, [registros, filtroAsesor, filtroEstado, filtroTexto, filtroDesde, filtroHasta]);

  // KPIs globales sobre filtrados
  const cnt = (e) => filtrados.filter(r => r.estado_marcacion === e).length;
  const totalAsesores = new Set(filtrados.map(r => r.asignado_a)).size;

  // Agrupado por asesor
  const grupos = useMemo(() => {
    if (!agrupar) return null;
    const map = new Map();
    for (const r of filtrados) {
      const key = r.asignado_a;
      if (!map.has(key)) map.set(key, { id: key, nombre: r.asesor_nombre || 'Sin asignar', items: [] });
      map.get(key).items.push(r);
    }
    return Array.from(map.values()).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }, [filtrados, agrupar]);

  // Reorden manual: persiste el orden de marcación del asesor en BD.
  // Solo permitido en modo agrupado (1 asesor a la vez).
  const reordenarAsesor = async (asesorId, contactoIdsEnOrden) => {
    try {
      const res = await callApi('cartera:reordenar', asesorId, contactoIdsEnOrden);
      if (res && res.error) throw new Error(res.error);
      // Refresca para reflejar el nuevo orden_marcacion desde BD
      await cargar();
      return true;
    } catch (err) {
      console.error('[CARTERAS_EQ] Reorden:', err.message || err);
      alert('Error al reordenar: ' + (err.message || err));
      return false;
    }
  };

  const toggleColapso = (id) => {
    setColapsados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exportarCsv = () => {
    if (filtrados.length === 0) return;
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n;]/.test(s) ? `"${s}"` : s;
    };
    const headers = ['Asesor', 'Estado', 'Cliente', 'Cédula', 'Teléfono', 'Empresa', 'Contrato', 'Campaña', 'Gestiones', 'Última tipif.', 'Asignado', 'Mora', 'Días Mora'];
    const rows = filtrados.map(r => {
      let meta = {};
      try { meta = JSON.parse(r.metadata || '{}'); } catch (_) {}
      const mora = meta['VALOR EN MORA'] || r.monto_deuda || '';
      const diasMora = meta['DIAS IMPAGO'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || '';
      return [
        r.asesor_nombre || '—',
        ESTADO_STYLE[r.estado_marcacion]?.label || r.estado_marcacion || '',
        r.nombre_deudor || '', r.cedula || '', r.telefono || '',
        meta['EMPRESA'] || '', meta['Nº CONTRATO'] || meta['CONTRATO'] || '',
        r.campana_nombre || '', r.gestiones_count || 0,
        r.ultima_tipificacion || '', fmtFecha(r.fecha_asignacion),
        mora ? Number(mora).toFixed(2) : '',
        diasMora || '',
      ].map(esc).join(',');
    });
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carteras_equipo_${todayLocalISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportarXls = async () => {
    if (filtrados.length === 0) return;
    try {
      const contactoIds = filtrados.map(r => r.id);
      const res = await callApi('reports:generate', 'cartera_equipo', { contactoIds, formato: 'xlsx' });
      if (res?.success && res.archivo) {
        // Abrir carpeta del archivo generado
        await callApi('shell:openPath', res.archivo);
      } else {
        console.error('[CARTERAS_EQ] XLS error:', res?.error);
        alert('Error al generar XLS: ' + (res?.error || 'desconocido'));
      }
    } catch (err) {
      console.error('[CARTERAS_EQ] XLS exception:', err);
      alert('Error al descargar XLS: ' + (err.message || err));
    }
  };

  return (
    <div className="widget-card" style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div className="widget-header" style={{ marginBottom: 12 }}>
        <div>
          <span className="text-label" style={{ opacity: 0.5 }}>SUPERVISOR · CARTERAS</span>
          <h3 className="widget-title" style={{ marginTop: 4 }}>Carteras del Equipo</h3>
          <p className="text-body-sm" style={{ opacity: 0.4, marginTop: 2, fontSize: 11 }}>
            Clientes asignados a cada asesor con estado de gestión consolidado.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setAgrupar(v => !v)}
            className="btn btn-outline btn-sm"
            style={{ padding: '4px 10px', fontSize: 11, height: 'auto' }}
            title={agrupar ? 'Mostrar tabla plana' : 'Agrupar por asesor'}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              {agrupar ? 'view_list' : 'group_work'}
            </span>
            {agrupar ? 'Plana' : 'Agrupar'}
          </button>
          <button onClick={cargar} className="btn btn-outline btn-sm" style={{ padding: '4px 10px', fontSize: 11, height: 'auto' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
            Recargar
          </button>
          <button onClick={exportarXls} className="btn btn-outline btn-sm" disabled={filtrados.length === 0} title="Descargar como Excel" style={{ padding: '4px 10px', fontSize: 11, height: 'auto' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>table_view</span>
            XLS
          </button>
          <button onClick={exportarCsv} className="btn btn-outline btn-sm" disabled={filtrados.length === 0} title="Descargar como CSV" style={{ padding: '4px 10px', fontSize: 11, height: 'auto' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>download</span>
            CSV
          </button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Kpi label="Asesores" value={totalAsesores} color="#64b5f6" />
        <Kpi label="Total" value={filtrados.length} color="var(--color-primary)" />
        <Kpi label="Pendientes" value={cnt('PENDIENTE')} color="#ffb74d" />
        <Kpi label="En intentos" value={cnt('EN_INTENTOS')} color="#fbc02d" />
        <Kpi label="Agendados" value={cnt('AGENDADO')} color="#64b5f6" />
        <Kpi label="Gestionados" value={cnt('GESTIONADO')} color="var(--color-primary)" />
        <Kpi label="Ya pagó" value={cnt('YA_PAGO')} color="#ce93d8" />
      </div>

      {/* ── Filtros ── */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        padding: '10px 12px', marginBottom: 12, borderRadius: 8,
        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ flex: '1 1 200px', position: 'relative' }}>
          <span className="material-symbols-outlined" style={{
            position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
            fontSize: 14, opacity: 0.4, pointerEvents: 'none',
          }}>search</span>
          <input
            type="text"
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar cliente, cédula, teléfono, contrato, campaña..."
            style={{
              width: '100%', padding: '6px 10px 6px 28px', fontSize: 12,
              background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, color: 'inherit', outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>Asesor</span>
          <select
            value={filtroAsesor}
            onChange={(e) => setFiltroAsesor(e.target.value)}
            style={{
              padding: '5px 8px', fontSize: 11,
              background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, color: 'inherit', outline: 'none',
            }}
          >
            <option value="">Todos</option>
            {asesores.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>Estado</span>
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            style={{
              padding: '5px 8px', fontSize: 11,
              background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, color: 'inherit', outline: 'none',
            }}
          >
            <option value="TODOS">Todos</option>
            <option value="PENDIENTE">Pendientes</option>
            <option value="EN_INTENTOS">En intentos</option>
            <option value="AGENDADO">Agendados</option>
            <option value="GESTIONADO">Gestionados</option>
            <option value="YA_PAGO">Ya pagó</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>Desde</span>
          <input
            type="date"
            value={filtroDesde}
            onChange={(e) => setFiltroDesde(e.target.value)}
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
            value={filtroHasta}
            onChange={(e) => setFiltroHasta(e.target.value)}
            style={{
              padding: '5px 8px', fontSize: 11, colorScheme: 'dark',
              background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6, color: 'inherit', outline: 'none',
            }}
          />
        </div>
        {(filtroTexto || filtroAsesor || filtroEstado !== 'TODOS' || filtroDesde || filtroHasta) && (
          <button
            onClick={() => { setFiltroTexto(''); setFiltroAsesor(''); setFiltroEstado('TODOS'); setFiltroDesde(''); setFiltroHasta(''); }}
            style={{
              padding: '5px 10px', fontSize: 10, background: 'rgba(255,80,80,0.1)',
              border: '1px solid rgba(255,80,80,0.25)', color: '#ff8080',
              borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>filter_alt_off</span>
            Limpiar
          </button>
        )}
      </div>

      {/* ── Contenido ── */}
      {cargando ? (
        <div style={{ padding: '40px 0', textAlign: 'center', opacity: 0.5 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 32 }}>sync</span>
          <p className="text-body-sm" style={{ marginTop: 8 }}>Cargando...</p>
        </div>
      ) : filtrados.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', opacity: 0.4 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 36 }}>folder_off</span>
          <p className="text-body-sm" style={{ marginTop: 8 }}>
            {registros.length === 0 ? 'Sin carteras asignadas' : 'Sin clientes para los filtros aplicados'}
          </p>
        </div>
      ) : agrupar ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {grupos.map(g => {
            const isCol = colapsados.has(g.id);
            const cntEst = (e) => g.items.filter(r => r.estado_marcacion === e).length;
            return (
              <div key={`gr-${g.id}`} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div
                  onClick={() => toggleColapso(g.id)}
                  style={{
                    padding: '10px 14px', cursor: 'pointer',
                    background: 'rgba(0,230,118,0.04)',
                    borderLeft: '3px solid var(--color-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, transition: 'transform 0.2s', transform: isCol ? 'none' : 'rotate(90deg)' }}>chevron_right</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, opacity: 0.6 }}>person</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{g.nombre}</span>
                    <span style={{ fontSize: 10, opacity: 0.5 }}>{g.items.length} clientes</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, fontSize: 9 }}>
                    {cntEst('PENDIENTE') > 0 && <Chip n={cntEst('PENDIENTE')} c="#ffb74d" l="P" t="Pendientes" />}
                    {cntEst('EN_INTENTOS') > 0 && <Chip n={cntEst('EN_INTENTOS')} c="#fbc02d" l="I" t="En intentos" />}
                    {cntEst('AGENDADO') > 0 && <Chip n={cntEst('AGENDADO')} c="#64b5f6" l="A" t="Agendados" />}
                    {cntEst('GESTIONADO') > 0 && <Chip n={cntEst('GESTIONADO')} c="var(--color-primary)" l="G" t="Gestionados" />}
                    {cntEst('YA_PAGO') > 0 && <Chip n={cntEst('YA_PAGO')} c="#ce93d8" l="$" t="Ya pagó" />}
                  </div>
                </div>
                {!isCol && (
                  <TablaItems
                    items={g.items}
                    onReorder={(ids) => reordenarAsesor(g.id, ids)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <TablaItems items={filtrados} mostrarAsesor />
      )}
    </div>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div style={{
      flex: '1 1 120px', minWidth: 100, padding: '8px 12px', borderRadius: 8,
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ fontSize: 9, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2, color: color || 'inherit' }}>{value}</div>
    </div>
  );
}

function Chip({ n, c, l, t }) {
  return (
    <span title={t} style={{
      padding: '2px 7px', borderRadius: 99, fontWeight: 700,
      background: `${c}22`, color: c, fontSize: 9,
    }}>
      {l}: {n}
    </span>
  );
}

const parseDias = (v) => {
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : Math.max(0, n);
};
const parseMontoNum = (v) => {
  if (v == null) return 0;
  const s = String(v).replace(/[^\d.,-]/g, '').trim();
  if (!s) return 0;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  const norm = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(norm);
  return isNaN(n) ? 0 : n;
};

function TablaItems({ items, mostrarAsesor = false, onReorder = null }) {
  // Modelo PREVIEW + COMMIT:
  // - sortKey / sortDir → resort visual (no persiste)
  // - dragOrder → array de IDs con orden post-drag (no persiste)
  // - "Asignar Orden" → callApi para persistir el orden visible actual
  const [sortKey, setSortKey] = React.useState(null);
  const [sortDir, setSortDir] = React.useState('asc');
  const [dragOrder, setDragOrder] = React.useState(null); // null = sigue items prop
  const [dragId, setDragId] = React.useState(null);
  const [overId, setOverId] = React.useState(null);
  const [aplicando, setAplicando] = React.useState(false);
  // Promoción Excel-style por valores únicos de Días Mora. Set vacío = sin promoción.
  const [diasFiltro, setDiasFiltro] = React.useState(() => new Set());
  const [diasPopOpen, setDiasPopOpen] = React.useState(false);
  const [diasPopPos, setDiasPopPos] = React.useState({ top: 0, left: 0 });
  const diasBtnRef = React.useRef(null);

  // Calcular posición del popover desde el bounding rect del botón
  const openDiasPop = () => {
    if (diasBtnRef.current) {
      const rect = diasBtnRef.current.getBoundingClientRect();
      setDiasPopPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 240) });
    }
    setDiasPopOpen(true);
  };

  // Cuando el parent recarga (items cambia) → resetear estado local
  React.useEffect(() => {
    setSortKey(null);
    setSortDir('asc');
    setDragOrder(null);
    setDiasFiltro(new Set());
    setDiasPopOpen(false);
  }, [items]);

  // (sin listener global — backdrop overlay maneja el outside-click)

  const sortable = true;

  const handleHeaderClick = (key) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    // Al cambiar sort, el dragOrder previo deja de tener sentido
    setDragOrder(null);
  };

  // Enriquece cada fila con metadata parseada + campos derivados para sort
  const enriquecidos = React.useMemo(() => items.map(r => {
    let meta = {};
    try { meta = JSON.parse(r.metadata || '{}'); } catch (_) {}
    const moraNum = parseMontoNum(meta['VALOR EN MORA'] || r.monto_deuda);
    const diasMora = parseDias(meta['DIAS IMPAGO'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA']);
    return { ...r, _meta: meta, _moraNum: moraNum, _diasMora: diasMora };
  }), [items]);

  // Valores únicos de Días Mora para popover (sorted ASC)
  const diasUnicos = React.useMemo(() => {
    const s = new Set();
    enriquecidos.forEach(r => s.add(r._diasMora));
    return Array.from(s).sort((a, b) => a - b);
  }, [enriquecidos]);

  // Promoción Excel-style: días seleccionados primero, demás abajo en su orden natural.
  // NO filtra — todas las filas siguen visibles, solo reordenadas.
  const enriquecidosFiltrados = React.useMemo(() => {
    if (diasFiltro.size === 0) return enriquecidos;
    const promoted = [];
    const rest = [];
    enriquecidos.forEach(r => {
      if (diasFiltro.has(r._diasMora)) promoted.push(r);
      else rest.push(r);
    });
    return [...promoted, ...rest];
  }, [enriquecidos, diasFiltro]);

  // Turno basado en orden natural backend (queue). Incluye YA_PAGO declarado
  // si supervisor le asignó orden_marcacion (recallable).
  const turnoMap = React.useMemo(() => {
    const map = new Map();
    let t = 0;
    enriquecidos.forEach(r => {
      if (estaEnCola(r)) map.set(r.id, ++t);
    });
    return map;
  }, [enriquecidos]);

  // Pipeline: items → filtro días → sort → drag override → filasOrdenadas
  const filasOrdenadas = React.useMemo(() => {
    let arr;
    if (dragOrder) {
      // Drag override: reordenar enriquecidosFiltrados según dragOrder, conservando filas no presentes al final
      const byId = new Map(enriquecidosFiltrados.map(r => [r.id, r]));
      arr = dragOrder.map(id => byId.get(id)).filter(Boolean);
      enriquecidosFiltrados.forEach(r => { if (!dragOrder.includes(r.id)) arr.push(r); });
      return arr;
    }
    if (!sortKey) return enriquecidosFiltrados;
    const dirMul = sortDir === 'asc' ? 1 : -1;
    arr = [...enriquecidosFiltrados];
    // Tier semántico de llamada: callables primero (EN_INTENTOS, PENDIENTE),
    // luego programados/cerrados. Sort Estado asc → callables arriba.
    const ESTADO_TIER = {
      EN_INTENTOS: 0,
      PENDIENTE:   1,
      AGENDADO:    2,
      GESTIONADO:  3,
      YA_PAGO:     4,
    };
    arr.sort((a, b) => {
      // MANTENER LA PROMOCIÓN INCLUSO CON ORDENAMIENTO DE COLUMNAS
      if (diasFiltro.size > 0) {
        const aPromoted = diasFiltro.has(a._diasMora) ? 1 : 0;
        const bPromoted = diasFiltro.has(b._diasMora) ? 1 : 0;
        if (aPromoted !== bPromoted) return bPromoted - aPromoted;
      }

      let va, vb;
      switch (sortKey) {
        case 'estado':       va = ESTADO_TIER[a.estado_marcacion] ?? 99; vb = ESTADO_TIER[b.estado_marcacion] ?? 99; break;
        case 'asesor':       va = a.asesor_nombre || '';     vb = b.asesor_nombre || '';   break;
        case 'cliente':      va = a.nombre_deudor || '';     vb = b.nombre_deudor || '';   break;
        case 'cedula':       va = a.cedula || '';            vb = b.cedula || '';          break;
        case 'telefono':     va = a.telefono || '';          vb = b.telefono || '';        break;
        case 'mora':         va = a._moraNum;                 vb = b._moraNum;              break;
        case 'dias_mora':    va = a._diasMora;                vb = b._diasMora;             break;
        case 'gestiones':    va = a.gestiones_count || 0;     vb = b.gestiones_count || 0;  break;
        case 'ultima_tip':   va = a.ultima_tipificacion || ''; vb = b.ultima_tipificacion || ''; break;
        case 'asignado':     va = a.fecha_asignacion || '';   vb = b.fecha_asignacion || ''; break;
        case 'campana':      va = a.campana_nombre || '';     vb = b.campana_nombre || '';  break;
        default: return 0;
      }
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dirMul;
      return String(va).localeCompare(String(vb)) * dirMul;
    });
    return arr;
  }, [enriquecidosFiltrados, diasFiltro, sortKey, sortDir, dragOrder]);

  // Drag siempre habilitado cuando onReorder existe (agrupado). Ya no se bloquea por sort.
  const dragEnabled = !!onReorder;

  // "Asignar Orden" tiene sentido si el supervisor cambió la vista (sort/drag)
  // O si filtró por tramo de días (asignar orden solo al subset visible).
  const ordenSucio = !!(sortKey || dragOrder || diasFiltro.size > 0);

  const handleDrop = (targetId) => {
    if (!dragEnabled || dragId == null || targetId == null || dragId === targetId) {
      setDragId(null); setOverId(null);
      return;
    }
    const baseIds = filasOrdenadas.map(r => r.id);
    const fromIdx = baseIds.indexOf(dragId);
    const toIdx = baseIds.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) { setDragId(null); setOverId(null); return; }
    const nuevo = [...baseIds];
    const [m] = nuevo.splice(fromIdx, 1);
    nuevo.splice(toIdx, 0, m);
    setDragOrder(nuevo); // solo preview local
    // Al hacer drag, fijamos el orden y soltamos el sort (sino el sort lo "deshacería" al re-render)
    setSortKey(null);
    setDragId(null); setOverId(null);
  };

  const aplicarOrden = async () => {
    if (!onReorder) return;
    setAplicando(true);
    const ids = filasOrdenadas.map(r => r.id);
    await onReorder(ids);
    // El parent recarga → useEffect resetea sort/drag al recibir nuevos items
    setAplicando(false);
  };

  const restablecer = () => {
    setSortKey(null);
    setSortDir('asc');
    setDragOrder(null);
    setDiasFiltro(new Set());
  };

  const toggleDiaFiltro = (d) => {
    setDiasFiltro(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
    setDragOrder(null); // filtro invalida drag previo
  };
  const limpiarFiltroDias = () => { setDiasFiltro(new Set()); setDragOrder(null); };
  const todosDiasFiltro = () => { setDiasFiltro(new Set(diasUnicos)); setDragOrder(null); };

  const SortHeader = ({ k, label, align = 'left' }) => {
    const active = sortKey === k;
    return (
      <th
        style={{ ...th, textAlign: align, cursor: sortable ? 'pointer' : 'default', userSelect: 'none' }}
        onClick={sortable ? () => handleHeaderClick(k) : undefined}
        title={sortable ? `Ordenar por ${label}` : ''}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {label}
          {sortable && (
            <span className="material-symbols-outlined" style={{
              fontSize: 13,
              opacity: active ? 0.95 : 0.25,
              color: active ? 'var(--color-primary)' : 'inherit',
            }}>
              {active ? (sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
            </span>
          )}
        </span>
      </th>
    );
  };

  return (
    <div style={{ overflow: 'hidden' }}>
      {onReorder && (
        <div style={{
          padding: '8px 12px', fontSize: 10, display: 'flex',
          alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: ordenSucio ? 'rgba(255,193,7,0.08)' : 'rgba(0,230,118,0.04)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
          position: 'relative',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, opacity: 0.75 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
              {ordenSucio ? 'pending' : 'drag_indicator'}
            </span>
            {ordenSucio
              ? <span>Vista <b>modificada</b> · arrastra filas o usa headers para reordenar (preview)</span>
              : <span>Arrastra una fila o haz click en un header (Excel-style). Los cambios son <b>solo vista</b> hasta aplicar.</span>}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {ordenSucio && (
              <button
                onClick={restablecer}
                disabled={aplicando}
                style={{
                  padding: '3px 9px', fontSize: 10, fontWeight: 700,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                  color: 'inherit', borderRadius: 5, cursor: aplicando ? 'wait' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>refresh</span>
                Restablecer vista
              </button>
            )}
            <button
              onClick={aplicarOrden}
              disabled={!ordenSucio || aplicando || filasOrdenadas.length === 0}
              title={ordenSucio
                ? 'Persiste el orden visible como cola de marcación de este asesor'
                : 'Reordena por header o arrastrando filas para habilitar este botón'}
              style={{
                padding: '3px 11px', fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
                background: ordenSucio ? 'rgba(0,230,118,0.18)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${ordenSucio ? 'rgba(0,230,118,0.45)' : 'rgba(255,255,255,0.10)'}`,
                color: ordenSucio ? 'var(--color-primary)' : 'rgba(255,255,255,0.35)',
                borderRadius: 5, cursor: (!ordenSucio || aplicando) ? 'not-allowed' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4, textTransform: 'uppercase',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>
                {aplicando ? 'sync' : 'assignment_turned_in'}
              </span>
              {aplicando ? 'Aplicando…' : 'Asignar Orden'}
            </button>
          </div>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.03)', textAlign: 'left' }}>
            {onReorder && <th style={{ ...th, textAlign: 'center', width: 60 }} title="Turno de marcación">Turno</th>}
            <SortHeader k="estado" label="Estado" />
            {mostrarAsesor && <SortHeader k="asesor" label="Asesor" />}
            <SortHeader k="cliente" label="Cliente" />
            <SortHeader k="cedula" label="Cédula" />
            <SortHeader k="telefono" label="Teléfono" />
            <SortHeader k="mora" label="Mora" align="right" />
            <th style={{ ...th, textAlign: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span
                  onClick={sortable ? () => handleHeaderClick('dias_mora') : undefined}
                  title={sortable ? 'Ordenar por Días Mora' : ''}
                  style={{ cursor: sortable ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 3, userSelect: 'none' }}
                >
                  Días Mora
                  {sortable && (
                    <span className="material-symbols-outlined" style={{
                      fontSize: 13,
                      opacity: sortKey === 'dias_mora' ? 0.95 : 0.25,
                      color: sortKey === 'dias_mora' ? 'var(--color-primary)' : 'inherit',
                    }}>
                      {sortKey === 'dias_mora' ? (sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                    </span>
                  )}
                </span>
                <button
                  ref={diasBtnRef}
                  type="button"
                  onClick={() => diasPopOpen ? setDiasPopOpen(false) : openDiasPop()}
                  title="Promover tramo de días al inicio"
                  style={{
                    background: diasFiltro.size > 0 ? 'rgba(0,230,118,0.18)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${diasFiltro.size > 0 ? 'rgba(0,230,118,0.45)' : 'rgba(255,255,255,0.10)'}`,
                    color: diasFiltro.size > 0 ? 'var(--color-primary)' : 'rgba(255,255,255,0.55)',
                    padding: '2px 5px', borderRadius: 4, cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 700,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 12 }}>filter_alt</span>
                  {diasFiltro.size > 0 && <span>{diasFiltro.size}</span>}
                </button>
              </span>
            </th>
            <SortHeader k="gestiones" label="Gestiones" align="center" />
            <SortHeader k="ultima_tip" label="Última tipif." />
            <SortHeader k="asignado" label="Asignado" />
            <SortHeader k="campana" label="Campaña" />
          </tr>
        </thead>
        <tbody>
          {filasOrdenadas.map(r => {
            const esYaPagoDeclarado = r.estado_marcacion === 'YA_PAGO' && r.validado_pago !== 1;
            const est = esYaPagoDeclarado
              ? ESTADO_STYLE_YA_PAGO_DECL
              : (ESTADO_STYLE[r.estado_marcacion] || { bg: 'rgba(255,255,255,0.08)', fg: '#ccc', label: r.estado_marcacion || '—' });
            const yaGestionado = (r.estado_marcacion === 'GESTIONADO') || (r.estado_marcacion === 'YA_PAGO' && r.validado_pago === 1);
            const turno = turnoMap.get(r.id);
            const esSiguiente = turno === 1;
            const isDragging = dragId === r.id;
            const isOver = overId === r.id && dragId !== r.id;
            const rowBg = isDragging ? 'rgba(0,230,118,0.10)'
                        : isOver     ? 'rgba(33,150,243,0.12)'
                        : esSiguiente ? 'rgba(0,230,118,0.05)'
                        : undefined;
            return (
              <tr
                key={`it-${r.id}`}
                draggable={dragEnabled}
                onDragStart={() => dragEnabled && setDragId(r.id)}
                onDragOver={(e) => { if (dragEnabled && dragId != null) { e.preventDefault(); setOverId(r.id); } }}
                onDragLeave={() => { if (overId === r.id) setOverId(null); }}
                onDrop={(e) => { e.preventDefault(); handleDrop(r.id); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                style={{
                  borderTop: '1px solid rgba(255,255,255,0.04)',
                  background: rowBg,
                  opacity: isDragging ? 0.5 : 1,
                  cursor: dragEnabled ? 'grab' : 'default',
                  transition: 'background 0.15s',
                }}
              >
                {onReorder && (
                  <td style={{ ...td, textAlign: 'center' }}>
                    {turno ? (
                      <span style={{
                        fontSize: esSiguiente ? 11 : 10, fontWeight: 800,
                        padding: esSiguiente ? '2px 8px' : '1px 6px', borderRadius: 99,
                        background: esSiguiente ? 'rgba(0,230,118,0.22)' : 'rgba(255,255,255,0.06)',
                        color: esSiguiente ? 'var(--color-primary)' : 'rgba(255,255,255,0.7)',
                        border: esSiguiente ? '1px solid rgba(0,230,118,0.45)' : '1px solid rgba(255,255,255,0.08)',
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }} title={esSiguiente ? 'Próximo cliente a marcar' : `Turno #${turno}`}>
                        {dragEnabled && <span className="material-symbols-outlined" style={{ fontSize: 11, opacity: 0.6 }}>drag_indicator</span>}
                        {turno}
                      </span>
                    ) : (
                      <span style={{ opacity: 0.3, fontSize: 11 }}>—</span>
                    )}
                  </td>
                )}
                <td style={td}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                    background: est.bg, color: est.fg, whiteSpace: 'nowrap',
                    display: 'inline-flex', alignItems: 'center', gap: 2,
                  }}>
                    {yaGestionado && <span className="material-symbols-outlined" style={{ fontSize: 10 }}>check_circle</span>}
                    {est.label}
                  </span>
                </td>
                {mostrarAsesor && <td style={td}>{r.asesor_nombre || '—'}</td>}
                <td style={{ ...td, fontWeight: 600 }}>{r.nombre_deudor || '—'}</td>
                <td style={td}><span className="text-mono">{r.cedula || '—'}</span></td>
                <td style={td}><span className="text-mono">{r.telefono || '—'}</span></td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--color-danger)' }}>
                  {r._moraNum > 0 ? `$${r._moraNum.toFixed(2)}` : '—'}
                </td>
                <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: r._diasMora > 0 ? '#ff9800' : 'rgba(255,255,255,0.35)' }}>
                  {r._diasMora > 0 ? r._diasMora : '—'}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                    background: r.gestiones_count > 0 ? 'rgba(0,230,118,0.15)' : 'rgba(255,255,255,0.05)',
                    color: r.gestiones_count > 0 ? 'var(--color-primary)' : 'rgba(255,255,255,0.4)',
                  }}>
                    {r.gestiones_count || 0}
                  </span>
                </td>
                <td style={{ ...td, fontSize: 10, opacity: 0.75 }}>
                  {r.ultima_tipificacion || <span style={{ opacity: 0.3, fontStyle: 'italic' }}>sin gestiones</span>}
                </td>
                <td style={{ ...td, fontSize: 10 }}><span className="text-mono">{fmtFecha(r.fecha_asignacion)}</span></td>
                <td style={{ ...td, fontSize: 10, opacity: 0.6 }}>{r.campana_nombre || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {diasPopOpen && (
        <>
          {/* Backdrop: click fuera cierra el popover */}
          <div
            onClick={() => setDiasPopOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'transparent' }}
          />
          {/* Popover */}
          <div
            style={{
              position: 'fixed',
              top: diasPopPos.top, left: diasPopPos.left,
              zIndex: 9999, width: 240, maxHeight: 360, overflow: 'hidden',
              background: '#0d1117', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              display: 'flex', flexDirection: 'column',
              textAlign: 'left',
            }}
          >
            <div style={{
              padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.85 }}>
                Promover tramo · {diasUnicos.length} valores
              </span>
              <div style={{ display: 'flex', gap: 3 }}>
                <button
                  type="button"
                  onClick={todosDiasFiltro}
                  style={{
                    fontSize: 9, padding: '2px 6px', fontWeight: 700,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                    color: 'inherit', borderRadius: 4, cursor: 'pointer',
                  }}
                >Todos</button>
                <button
                  type="button"
                  onClick={limpiarFiltroDias}
                  disabled={diasFiltro.size === 0}
                  style={{
                    fontSize: 9, padding: '2px 6px', fontWeight: 700,
                    background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.2)',
                    color: '#ff8080', borderRadius: 4,
                    cursor: diasFiltro.size === 0 ? 'not-allowed' : 'pointer',
                    opacity: diasFiltro.size === 0 ? 0.4 : 1,
                  }}
                >Limpiar</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
              {diasUnicos.length === 0 ? (
                <div style={{ padding: '14px 12px', fontSize: 10, opacity: 0.5, textAlign: 'center' }}>
                  Sin datos
                </div>
              ) : (
                diasUnicos.map(d => {
                  const checked = diasFiltro.has(d);
                  const cnt = enriquecidos.filter(r => r._diasMora === d).length;
                  return (
                    <button
                      key={`d-${d}`}
                      type="button"
                      onClick={() => toggleDiaFiltro(d)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 10px', cursor: 'pointer', fontSize: 11,
                        background: checked ? 'rgba(0,230,118,0.08)' : 'transparent',
                        border: 'none', width: '100%', textAlign: 'left',
                        color: 'inherit', fontFamily: 'inherit',
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: 3,
                        border: `1px solid ${checked ? 'var(--color-primary)' : 'rgba(255,255,255,0.3)'}`,
                        background: checked ? 'var(--color-primary)' : 'transparent',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        {checked && <span className="material-symbols-outlined" style={{ fontSize: 11, color: '#000' }}>check</span>}
                      </span>
                      <span style={{
                        flex: 1, fontWeight: d > 0 ? 700 : 500,
                        color: d > 0 ? '#ff9800' : 'rgba(255,255,255,0.6)',
                      }}>
                        {d > 0 ? `${d} ${d === 1 ? 'día' : 'días'}` : 'Sin mora'}
                      </span>
                      <span style={{ fontSize: 9, opacity: 0.5 }}>{cnt}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const th = { padding: '8px 10px', fontSize: 10, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 };
const td = { padding: '8px 10px', verticalAlign: 'middle' };
