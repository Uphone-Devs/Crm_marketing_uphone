import React, { useState, useEffect, useCallback } from 'react';
import ExcelJS from 'exceljs';
import { showToast } from '../shared/Toast';
const _EMPTY_ARR = [];
const _EMPTY_OBJ = {};

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  return (ws.startsWith('http') ? ws.replace(/\/$/, '') : `http://${ws}:3001`) + '/api';
}
async function vmFetch(apiBase, token, path, options = _EMPTY_OBJ) {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const PARENTESCOS = [
  'Cónyuge', 'Padre', 'Madre', 'Hijo/a', 'Hermano/a',
  'Cuñado/a materno', 'Cuñado/a paterno',
  'Tío/a materno', 'Tío/a paterno',
  'Primo/a materno', 'Primo/a paterno',
  'Amigo/a', 'Trabajo', 'Vecino/a', 'Otro',
];

const fmtFechaHora = (ts) => {
  if (!ts) return '—';
  try {
    const d = new Date(ts.replace(' ', 'T'));
    return d.toLocaleString('es-EC', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ts; }
};

const todayISO = () => {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
};

export default function Referencias({ asesores = _EMPTY_ARR }) {
  const apiBase   = buildApiBase();
  const isRemote  = !!apiBase;
  const authToken = localStorage.getItem('auth_token');
  // ── Filtros tabla general ──
  const [filtroAsesor,     setFiltroAsesor]     = useState('');
  const [filtroParentesco, setFiltroParentesco] = useState('');
  const [filtroFecha,      setFiltroFecha]      = useState(() => todayISO());
  const [filtroBusqueda,   setFiltroBusqueda]   = useState('');

  const [refs,     setRefs]     = useState([]);
  const [cargando, setCargando] = useState(false);
  const [descargando, setDescargando] = useState(false);

  // ── Búsqueda por CI ──
  const [refCedula,     setRefCedula]     = useState('');
  const [refContacto,   setRefContacto]   = useState(null);
  const [refResultados, setRefResultados] = useState([]);
  const [refCargando,   setRefCargando]   = useState(false);
  const [refError,      setRefError]      = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      let data;
      if (isRemote) {
        const params = new URLSearchParams({ limite: 2000 });
        if (filtroAsesor)     params.set('asesor_id',  filtroAsesor);
        if (filtroFecha)      params.set('fecha',      filtroFecha);
        if (filtroParentesco) params.set('parentesco', filtroParentesco);
        data = await vmFetch(apiBase, authToken, `/referencias?${params}`);
      } else {
        data = await window.api.invoke('db:getAllReferencias', {
          asesorId: filtroAsesor ? Number(filtroAsesor) : null,
          fecha: filtroFecha || null, parentesco: filtroParentesco || null, limite: 2000,
        });
      }
      setRefs(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast('Error al cargar referencias: ' + err.message, 'error');
    } finally {
      setCargando(false);
    }
  }, [filtroAsesor, filtroFecha, filtroParentesco]);

  useEffect(() => { cargar(); }, [cargar]);

  // Filtro de texto en frontend
  const txt = filtroBusqueda.trim().toLowerCase();
  const refsFiltradas = txt
    ? refs.filter(r => [r.nombre_deudor, r.cedula, r.telefono, r.nombre_ref, r.parentesco, r.notas, r.asesor_nombre]
        .filter(Boolean).join(' ').toLowerCase().includes(txt))
    : refs;

  // ── Descarga Excel ──
  const handleDescargar = async () => {
    if (refsFiltradas.length === 0) return;
    setDescargando(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Referencias');
      const COLS = ['Fecha/Hora', 'Asesor', 'Cliente', 'CI', 'Tel. Principal', 'Tel. Referencia', 'Nombre Ref.', 'Parentesco', 'Observación'];
      ws.addRow(COLS).font = { bold: true };
      for (const r of refsFiltradas) {
        ws.addRow([
          fmtFechaHora(r.creado_en),
          r.asesor_nombre || '',
          r.nombre_deudor || '',
          r.cedula || '',
          r.telefono_principal || '',
          r.telefono || '',
          r.nombre_ref || '',
          r.parentesco || '',
          r.notas || '',
        ]);
      }
      ws.columns.forEach((col, i) => { col.width = [18, 16, 22, 12, 14, 14, 18, 16, 30][i] || 14; });
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `referencias_${filtroFecha || 'historico'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`${refsFiltradas.length} referencias exportadas`, 'success');
    } catch (err) {
      showToast('Error al generar Excel: ' + err.message, 'error');
    } finally {
      setDescargando(false);
    }
  };

  // ── Búsqueda por CI ──
  const handleBuscarRefs = async () => {
    if (!refCedula.trim()) return;
    setRefCargando(true);
    setRefError(null);
    setRefContacto(null);
    setRefResultados([]);
    try {
      const contacto = isRemote
        ? await vmFetch(apiBase, authToken, `/contactos/search?cedula=${encodeURIComponent(refCedula.trim())}`).catch(() => null)
        : await window.api.invoke('db:buscarContactoPorCedula', refCedula.trim());
      if (!contacto) { setRefError('No se encontró ningún cliente con esa cédula.'); return; }
      setRefContacto(contacto);
      const data = isRemote
        ? await vmFetch(apiBase, authToken, `/contactos/${contacto.id}/referencias`)
        : await window.api.invoke('db:getSubGestionesByContacto', contacto.id);
      setRefResultados(data || []);
    } catch (err) {
      setRefError(err.message);
    } finally {
      setRefCargando(false);
    }
  };

  // ── Resumen rápido ──
  const totalConRef    = refs.filter(r => r.nombre_ref).length;
  const pctConRef      = refs.length > 0 ? Math.round((totalConRef / refs.length) * 100) : 0;
  const parentescoFreq = refs.reduce((acc, r) => {
    if (r.parentesco) acc[r.parentesco] = (acc[r.parentesco] || 0) + 1;
    return acc;
  }, {});
  const topParentesco  = Object.entries(parentescoFreq).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const bdr = '1px solid rgba(255,255,255,0.06)';

  return (
    <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── KPI chips ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {[
          { icon: 'contacts',   label: 'Total referencias', value: refs.length.toLocaleString() },
          { icon: 'badge',      label: 'Con nombre',        value: `${totalConRef} (${pctConRef}%)` },
          ...topParentesco.map(([p, n]) => ({ icon: 'family_restroom', label: p, value: n })),
        ].map((k) => (
          <div key={k.label} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, border: bdr, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, opacity: 0.5 }}>{k.icon}</span>
            <span style={{ fontSize: 12, opacity: 0.55 }}>{k.label}</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-primary)' }}>{k.value}</span>
          </div>
        ))}
      </div>

      {/* ── Tabla general ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: bdr, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: 20 }}>contacts</span>
          <div>
            <h3 className="widget-title" style={{ margin: 0 }}>Todas las Referencias</h3>
            <p className="text-body-sm" style={{ margin: 0, opacity: 0.5 }}>Subgestiones capturadas por todos los asesores</p>
          </div>

          {/* Filtros */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input aria-label="Campo"
              type="date"
              className="input"
              value={filtroFecha}
              onChange={e => setFiltroFecha(e.target.value)}
              style={{ padding: '4px 8px', fontSize: 12, height: 'auto', width: 140 }}
            />
            <select
              className="input"
              value={filtroAsesor}
              onChange={e => setFiltroAsesor(e.target.value)}
              style={{ padding: '4px 8px', fontSize: 12, height: 'auto' }}
            >
              <option value="">Todos los asesores</option>
              {asesores.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            <select
              className="input"
              value={filtroParentesco}
              onChange={e => setFiltroParentesco(e.target.value)}
              style={{ padding: '4px 8px', fontSize: 12, height: 'auto' }}
            >
              <option value="">Todos los parentescos</option>
              {PARENTESCOS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <input aria-label="Todos los parentescos"
              type="text"
              className="input"
              value={filtroBusqueda}
              onChange={e => setFiltroBusqueda(e.target.value)}
              placeholder="Buscar..."
              style={{ padding: '4px 8px', fontSize: 12, height: 'auto', width: 130 }}
            />
            <button type="button"
              className="btn btn-sm btn-outline"
              onClick={cargar}
              disabled={cargando}
              title="Actualizar"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, animation: cargando ? 'spin 1s linear infinite' : 'none' }}>refresh</span>
            </button>
            <button type="button"
              className="btn btn-sm btn-primary"
              onClick={handleDescargar}
              disabled={descargando || refsFiltradas.length === 0}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
              Excel
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          {cargando ? (
            <div style={{ padding: '40px 0', textAlign: 'center', opacity: 0.4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 32, animation: 'spin 1s linear infinite', display: 'block', marginBottom: 8 }}>sync</span>
              Cargando referencias...
            </div>
          ) : refsFiltradas.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', opacity: 0.4 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 36, display: 'block', marginBottom: 8 }}>contacts</span>
              Sin referencias para los filtros seleccionados.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)', position: 'sticky', top: 0 }}>
                  {['Fecha/Hora', 'Asesor', 'Cliente', 'CI', 'Tel. Ref.', 'Nombre Ref.', 'Parentesco', 'Observación'].map(h => (
                    <th key={h} style={{ padding: '9px 12px', textAlign: 'left', opacity: 0.55, fontWeight: 600, whiteSpace: 'nowrap', borderBottom: bdr }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {refsFiltradas.map((r, i) => (
                  <tr key={r.id} style={{ borderTop: bdr, background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)' }}>
                    <td style={{ padding: '8px 12px', opacity: 0.65, whiteSpace: 'nowrap' }}>{fmtFechaHora(r.creado_en)}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-primary)', fontWeight: 600 }}>{r.asesor_nombre || '—'}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.nombre_deudor || '—'}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', opacity: 0.7 }}>{r.cedula || '—'}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#ffb74d' }}>{r.telefono}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.nombre_ref || <span style={{ opacity: 0.3 }}>—</span>}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {r.parentesco
                        ? <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'rgba(100,181,246,0.15)', color: '#64b5f6', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.parentesco}</span>
                        : <span style={{ opacity: 0.3 }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 12px', opacity: 0.65, maxWidth: 200 }}>{r.notas || <span style={{ opacity: 0.3 }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {refsFiltradas.length > 0 && (
          <div style={{ padding: '8px 20px', borderTop: bdr, fontSize: 12, opacity: 0.45 }}>
            {refsFiltradas.length} referencia{refsFiltradas.length !== 1 ? 's' : ''} mostrada{refsFiltradas.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* ── Búsqueda por CI ── */}
      <div className="card">
        <div className="widget-header">
          <div>
            <h3 className="widget-title">Referencias por Cliente</h3>
            <p className="text-body-sm" style={{ opacity: 0.6 }}>
              Consulta el historial completo de referencias de un cliente específico (todos los asesores).
            </p>
          </div>
          <span className="material-symbols-outlined">person_search</span>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <input aria-label="Campo"
            type="text"
            className="input"
            value={refCedula}
            onChange={e => setRefCedula(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleBuscarRefs()}
            placeholder="Número de cédula / CI del cliente"
            style={{ flex: 1 }}
          />
          <button type="button" className="btn btn-primary" onClick={handleBuscarRefs} disabled={refCargando || !refCedula.trim()}>
            {refCargando
              ? <span className="material-symbols-outlined" style={{ fontSize: 18, animation: 'spin 1s linear infinite' }}>sync</span>
              : <span className="material-symbols-outlined" style={{ fontSize: 18 }}>search</span>}
            Buscar
          </button>
        </div>

        {refError && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(244,67,54,0.08)', borderRadius: 8, color: 'var(--color-danger)', fontSize: 13 }}>
            {refError}
          </div>
        )}

        {refContacto && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: 20 }}>person</span>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{refContacto.nombre_deudor}</span>
              <span style={{ opacity: 0.5, fontSize: 12 }}>CI: {refContacto.cedula}</span>
              <span style={{
                marginLeft: 'auto', fontSize: 12, padding: '2px 8px', borderRadius: 20,
                background: refResultados.length > 0 ? 'rgba(0,255,170,0.12)' : 'rgba(255,255,255,0.06)',
                color: refResultados.length > 0 ? 'var(--color-primary)' : 'rgba(255,255,255,0.4)',
                fontWeight: 700,
              }}>
                {refResultados.length} referencia{refResultados.length !== 1 ? 's' : ''}
              </span>
            </div>

            {refResultados.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', opacity: 0.4, fontSize: 13 }}>
                Sin referencias capturadas para este cliente.
              </div>
            ) : (
              <div style={{ border: bdr, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                      {['Fecha', 'Asesor', 'Teléfono', 'Nombre Ref.', 'Parentesco', 'Observación'].map(h => (
                        <th key={h} style={{ padding: '9px 12px', textAlign: 'left', opacity: 0.55, fontWeight: 600, fontSize: 12 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {refResultados.map((r, i) => (
                      <tr key={r.id} style={{ borderTop: bdr, background: r.nombre_ref ? 'rgba(0,255,170,0.02)' : 'transparent' }}>
                        <td style={{ padding: '9px 12px', opacity: 0.7, whiteSpace: 'nowrap' }}>{fmtFechaHora(r.creado_en)}</td>
                        <td style={{ padding: '9px 12px', color: 'var(--color-primary)', fontWeight: 600 }}>{r.asesor_nombre || '—'}</td>
                        <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#ffb74d' }}>{r.telefono}</td>
                        <td style={{ padding: '9px 12px', fontWeight: 600 }}>{r.nombre_ref || <span style={{ opacity: 0.3 }}>—</span>}</td>
                        <td style={{ padding: '9px 12px' }}>
                          {r.parentesco
                            ? <span style={{ fontSize: 12, padding: '2px 7px', borderRadius: 10, background: 'rgba(100,181,246,0.15)', color: '#64b5f6', fontWeight: 600 }}>{r.parentesco}</span>
                            : <span style={{ opacity: 0.3 }}>—</span>}
                        </td>
                        <td style={{ padding: '9px 12px', opacity: 0.65 }}>{r.notas || <span style={{ opacity: 0.3 }}>—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
