import React, { useState, useEffect } from 'react';

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
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

const fmt$ = (n) => {
  if (!n && n !== 0) return '—';
  const v = Number(n);
  if (isNaN(v)) return '—';
  return `$${v.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const inputStyle = {
  padding: '5px 8px', fontSize: 12, colorScheme: 'dark',
  background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 6, color: 'inherit',
};

const th = { padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 };
const td = { padding: '8px 10px', verticalAlign: 'middle', fontSize: 12 };

function AccordionPanel({ title, icon, open, onToggle, children }) {
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4 }}>
      <button type="button"
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', background: 'none', border: 'none', color: 'inherit',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--color-primary)', opacity: 0.8 }}>
          {icon}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{title}</span>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 16, opacity: 0.4, transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none' }}
        >
          chevron_right
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function GestionTable({ data, loading, showPago = false }) {
  if (loading) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', opacity: 0.5 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 24 }}>sync</span>
      </div>
    );
  }
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', opacity: 0.4, fontSize: 12 }}>
        Sin datos para los filtros aplicados
      </div>
    );
  }
  const totalClientes = data.reduce((s, r) => s + (r.num_clientes || 0), 0);
  const totalCobrar   = data.reduce((s, r) => s + (r.valor_cobrar || 0), 0);
  const totalPago     = showPago ? data.reduce((s, r) => s + (r.suma_pago || 0), 0) : null;

  return (
    <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden', marginTop: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,0.04)', textAlign: 'left' }}>
            <th style={th}>Gestión</th>
            <th style={{ ...th, textAlign: 'right' }}>No. Clientes</th>
            <th style={{ ...th, textAlign: 'right' }}>Valor a Cobrar</th>
            {showPago && <th style={{ ...th, textAlign: 'right' }}>Suma Pago</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.gestion} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <td style={td}>
                <span style={{
                  fontSize: 12, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
                  background: r.gestion === 'REALIZADA' ? 'rgba(0,230,118,0.15)' : 'rgba(255,152,0,0.15)',
                  color: r.gestion === 'REALIZADA' ? 'var(--color-primary)' : '#ffcc02',
                }}>
                  {r.gestion}
                </span>
              </td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                {(r.num_clientes || 0).toLocaleString()}
              </td>
              <td style={{ ...td, textAlign: 'right', color: 'var(--color-primary)', fontWeight: 700 }}>
                {fmt$(r.valor_cobrar)}
              </td>
              {showPago && (
                <td style={{ ...td, textAlign: 'right', color: '#64b5f6', fontWeight: 700 }}>
                  {fmt$(r.suma_pago)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
            <td style={{ ...td, fontWeight: 800, fontSize: 12, opacity: 0.7 }}>TOTAL</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{totalClientes.toLocaleString()}</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: 'var(--color-primary)' }}>{fmt$(totalCobrar)}</td>
            {showPago && <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: '#64b5f6' }}>{fmt$(totalPago)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RefinanciadaPanel({ data, loading }) {
  if (loading) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', opacity: 0.5 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 24 }}>sync</span>
      </div>
    );
  }

  const resumen  = data?.resumen  || { total_clientes: 0, total_mora: 0, gestionados: 0, no_gestionados: 0 };
  const clientes = data?.clientes || [];

  if (clientes.length === 0) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', opacity: 0.4, fontSize: 12 }}>
        Sin clientes refinanciados para los filtros aplicados.
      </div>
    );
  }

  const kpis = [
    { label: 'Total Clientes',   value: resumen.total_clientes.toLocaleString(), icon: 'group',           color: 'rgba(255,255,255,0.8)' },
    { label: 'Monto Vencido',    value: fmt$(resumen.total_mora),                icon: 'payments',        color: '#ff9800' },
    { label: 'Gestionados',      value: resumen.gestionados.toLocaleString(),    icon: 'check_circle',    color: '#00E676' },
    { label: 'Sin Gestión',      value: resumen.no_gestionados.toLocaleString(), icon: 'phone_missed',    color: '#ff5252' },
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, margin: '10px 0' }}>
        {kpis.map((k) => (
          <div key={k.label} style={{
            background: 'rgba(255,255,255,0.03)', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px', textAlign: 'center',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: k.color, display: 'block', marginBottom: 4 }}>{k.icon}</span>
            <div style={{ fontSize: 16, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 12, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden', marginTop: 6 }}>
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: '#1a1a1a', textAlign: 'left' }}>
                <th style={th}>Nombre</th>
                <th style={th}>Cédula</th>
                <th style={th}>Empresa</th>
                <th style={th}>Asesor</th>
                <th style={{ ...th, textAlign: 'right' }}>Días Impago</th>
                <th style={{ ...th, textAlign: 'right' }}>Valor Mora</th>
                <th style={{ ...th, textAlign: 'center' }}>Gestión</th>
              </tr>
            </thead>
            <tbody>
              {clientes.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ ...td, fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.nombre_deudor || '—'}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{r.cedula || '—'}</td>
                  <td style={{ ...td, opacity: 0.7, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.empresa || '—'}
                  </td>
                  <td style={{ ...td, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.asesor || '—'}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: r.dias_impago > 60 ? '#ff5252' : r.dias_impago > 30 ? '#ff9800' : 'inherit' }}>
                    {r.dias_impago ?? 0}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>
                    {fmt$(r.valor_mora)}
                  </td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
                      background: r.gestionado ? 'rgba(0,230,118,0.15)' : 'rgba(255,152,0,0.15)',
                      color: r.gestionado ? '#00E676' : '#ffcc02',
                    }}>
                      {r.gestionado ? 'REALIZADA' : 'NO REALIZADA'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── Selector de campaña reutilizable ─────────────────────────────

function CampanaSelect({ campanaId, setCampanaId, campanas, reloadCampanas }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 14, opacity: 0.45 }}>campaign</span>
      <select
        value={campanaId}
        onChange={e => setCampanaId(e.target.value)}
        onFocus={reloadCampanas}
        style={{ ...inputStyle, minWidth: 160 }}
      >
        <option value="">Todas las campañas</option>
        {campanas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </select>
      <button type="button"
        onClick={reloadCampanas}
        title="Actualizar lista de campañas"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'inherit', opacity: 0.4 }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
      </button>
    </div>
  );
}

// ── Card 1: Análisis de Cartera ──────────────────────────────────

export function AnalisisCartera({ filtroFechaDesde, filtroFechaHasta }) {
  const [openPanels, setOpenPanels] = useState({ composicion: true, refinanciada: false });
  const [campanas,   setCampanas]   = useState([]);
  const [campanaId,  setCampanaId]  = useState('');

  const [p1Fecha, setP1Fecha] = useState('');
  const [p1Desde, setP1Desde] = useState(0);
  const [p1Hasta, setP1Hasta] = useState(30);
  const [p1Data,  setP1Data]  = useState([]);
  const [p1Load,  setP1Load]  = useState(false);

  const [p3Fecha, setP3Fecha] = useState('');
  const [p3Data,  setP3Data]  = useState(null);
  const [p3Load,  setP3Load]  = useState(false);

  const CAMPO_REF = 'CONTRATO REFINANCIADO';

  const _api   = buildApiBase();
  const _isRem = !!_api;
  const _tok   = localStorage.getItem('auth_token');

  const reloadCampanas = () => {
    (_isRem ? vmFetch(_api, _tok, '/campanas') : window.api.invoke('db:getCampanas'))
      .then(d => setCampanas(d || [])).catch(() => {});
  };

  useEffect(() => { reloadCampanas(); }, []);

  useEffect(() => {
    if (!openPanels.composicion) return;
    setP1Load(true);
    const p = _isRem
      ? vmFetch(_api, _tok, `/cartera/analisis?fechaAsig=${p1Fecha || ''}&desdeD=${p1Desde}&hastaD=${p1Hasta}${campanaId ? `&campana_id=${campanaId}` : ''}`)
      : window.api.invoke('db:getCarteraAnalisis', { fechaAsig: p1Fecha || null, desdeD: Number(p1Desde), hastaD: Number(p1Hasta), campanaId: campanaId ? Number(campanaId) : null });
    p.then(d => setP1Data(Array.isArray(d) ? d : [])).catch(() => setP1Data([])).finally(() => setP1Load(false));
  }, [openPanels.composicion, p1Fecha, p1Desde, p1Hasta, campanaId]);

  useEffect(() => {
    if (!openPanels.refinanciada) return;
    setP3Load(true);
    const p = _isRem
      ? vmFetch(_api, _tok, `/cartera/refinanciada?fechaAsig=${p3Fecha || ''}${campanaId ? `&campana_id=${campanaId}` : ''}&campoRef=${encodeURIComponent(CAMPO_REF)}`)
      : window.api.invoke('db:getCarteraRefinanciada', { fechaAsig: p3Fecha || null, campanaId: campanaId ? Number(campanaId) : null, campoRef: CAMPO_REF });
    p.then(d => setP3Data(d || null)).catch(() => setP3Data(null)).finally(() => setP3Load(false));
  }, [openPanels.refinanciada, p3Fecha, campanaId]);

  const toggle = (key) => setOpenPanels(p => ({ ...p, [key]: !p[key] }));

  const filterRow = (children) => (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '8px 0', marginBottom: 2 }}>
      {children}
    </div>
  );
  const filterLabel = (text) => <span style={{ fontSize: 12, opacity: 0.5 }}>{text}</span>;

  return (
    <div className="widget-card" style={{ marginBottom: 16 }}>
      <div className="widget-header" style={{ marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--color-primary)' }}>analytics</span>
          <div>
            <span className="text-label" style={{ opacity: 0.5 }}>JEFE DE ÁREA · ANÁLISIS</span>
            <h3 className="widget-title" style={{ marginTop: 2 }}>Análisis de Cartera</h3>
          </div>
        </div>
        <CampanaSelect campanaId={campanaId} setCampanaId={setCampanaId} campanas={campanas} reloadCampanas={reloadCampanas} />
      </div>

      {/* Panel 1: Composición de Cartera */}
      <AccordionPanel title="Composición de Cartera" icon="pie_chart" open={openPanels.composicion} onToggle={() => toggle('composicion')}>
        {filterRow(<>
          {filterLabel('Fecha apertura')}
          <input aria-label="Fecha" type="date" value={p1Fecha} onChange={e => setP1Fecha(e.target.value)} style={inputStyle} />
          {filterLabel('Días impago desde')}
          <input type="number" min="0" value={p1Desde} onChange={e => setP1Desde(Number(e.target.value))} style={{ ...inputStyle, width: 70 }} />
          {filterLabel('hasta')}
          <input type="number" min="0" value={p1Hasta} onChange={e => setP1Hasta(Number(e.target.value))} style={{ ...inputStyle, width: 70 }} />
        </>)}
        <GestionTable data={p1Data} loading={p1Load} showPago />
      </AccordionPanel>

      {/* Panel 2: Cartera Refinanciada */}
      <AccordionPanel title="Cartera Refinanciada" icon="autorenew" open={openPanels.refinanciada} onToggle={() => toggle('refinanciada')}>
        {filterRow(<>
          {filterLabel('Campaña')}
          <select value={campanaId} onChange={e => setCampanaId(e.target.value)} onFocus={reloadCampanas} style={{ ...inputStyle, minWidth: 140 }}>
            <option value="">Todas las campañas</option>
            {campanas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          {filterLabel('Fecha apertura')}
          <input aria-label="Fecha" type="date" value={p3Fecha} onChange={e => setP3Fecha(e.target.value)} style={inputStyle} />
        </>)}
        <RefinanciadaPanel data={p3Data} loading={p3Load} />
      </AccordionPanel>
    </div>
  );
}

// ── Card 2: Cumplimiento de Metas ────────────────────────────────

export function CumplimientoMetas({ filtroFechaDesde, filtroFechaHasta }) {
  const [campanas,    setCampanas]    = useState([]);
  const [campanaId,   setCampanaId]   = useState('');
  const [p2Data,      setP2Data]      = useState([]);
  const [p2Load,      setP2Load]      = useState(false);
  const [localEdits,  setLocalEdits]  = useState({});

  const _api2   = buildApiBase();
  const _isRem2 = !!_api2;
  const _tok2   = localStorage.getItem('auth_token');

  const reloadCampanas = () => {
    (_isRem2 ? vmFetch(_api2, _tok2, '/campanas') : window.api.invoke('db:getCampanas'))
      .then(d => setCampanas(d || [])).catch(() => {});
  };

  useEffect(() => { reloadCampanas(); }, []);

  useEffect(() => {
    setP2Load(true);
    setLocalEdits({});
    const p = _isRem2
      ? vmFetch(_api2, _tok2, `/cartera/gestiones-asesores?desde=${filtroFechaDesde || ''}&hasta=${filtroFechaHasta || ''}${campanaId ? `&campana_id=${campanaId}` : ''}`)
      : window.api.invoke('db:getGestionesAsesores', { desde: filtroFechaDesde || null, hasta: filtroFechaHasta || null, campanaId: campanaId ? Number(campanaId) : null });
    p.then(d => setP2Data(d || [])).catch(() => setP2Data([])).finally(() => setP2Load(false));
  }, [filtroFechaDesde, filtroFechaHasta, campanaId]);

  const getEditVal = (asesorId, campo, fallback) => {
    if (localEdits[asesorId]?.[campo] !== undefined) return localEdits[asesorId][campo];
    return fallback;
  };

  const handleMetaChange = (asesorId, campo, rawVal) => {
    setLocalEdits(prev => ({ ...prev, [asesorId]: { ...prev[asesorId], [campo]: rawVal } }));
  };

  const handleMetaBlur = (asesorId, periodo, campo, rawVal) => {
    const valor = parseFloat(rawVal) || 0;
    setLocalEdits(prev => ({ ...prev, [asesorId]: { ...prev[asesorId], [campo]: valor } }));
    setP2Data(prev => prev.map(r => r.asesor_id === asesorId ? { ...r, [campo]: valor } : r));
    (_isRem2
      ? vmFetch(_api2, _tok2, '/cartera/meta-asesor', { method: 'POST', body: JSON.stringify({ asesorId, periodo, campo, valor }) })
      : window.api.invoke('db:upsertMetaAsesor', { asesorId, periodo, campo, valor })
    ).catch(() => {});
  };

  const metaRows = p2Data.map(r => {
    const recaudado = parseFloat(getEditVal(r.asesor_id, 'valor_recaudado', r.valor_recaudado)) || 0;
    const diaria    = parseFloat(getEditVal(r.asesor_id, 'meta_diaria',     r.meta_diaria))     || 0;
    const semanal   = parseFloat(getEditVal(r.asesor_id, 'meta_semanal',    r.meta_semanal))    || 0;
    const mensual   = parseFloat(getEditVal(r.asesor_id, 'meta_mensual',    r.meta_mensual))    || 0;
    return {
      ...r,
      _recaudado:   recaudado,
      _restDiario:  diaria  - recaudado,
      _restSemanal: semanal - recaudado,
      _restMensual: mensual - recaudado,
    };
  });

  const totalRecaudado = metaRows.reduce((s, r) => s + r._recaudado, 0);
  const totalDiaria    = metaRows.reduce((s, r) => s + (parseFloat(getEditVal(r.asesor_id, 'meta_diaria',  r.meta_diaria))  || 0), 0);
  const totalSemanal   = metaRows.reduce((s, r) => s + (parseFloat(getEditVal(r.asesor_id, 'meta_semanal', r.meta_semanal)) || 0), 0);
  const totalMensual   = metaRows.reduce((s, r) => s + (parseFloat(getEditVal(r.asesor_id, 'meta_mensual', r.meta_mensual)) || 0), 0);

  return (
    <div className="widget-card" style={{ marginBottom: 16 }}>
      <div className="widget-header" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--color-primary)' }}>flag</span>
          <div>
            <span className="text-label" style={{ opacity: 0.5 }}>JEFE DE ÁREA · MÉTRICAS</span>
            <h3 className="widget-title" style={{ marginTop: 2 }}>Cumplimiento de Metas</h3>
          </div>
        </div>
        <CampanaSelect campanaId={campanaId} setCampanaId={setCampanaId} campanas={campanas} reloadCampanas={reloadCampanas} />
      </div>

      {p2Load ? (
        <div style={{ padding: '20px 0', textAlign: 'center', opacity: 0.5 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 24 }}>sync</span>
        </div>
      ) : metaRows.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', opacity: 0.4, fontSize: 12 }}>
          Sin asesores activos
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {metaRows.map(r => {
            const tipos = [
              { key: 'meta_diaria',  label: 'Diaria',  restante: r._restDiario  },
              { key: 'meta_semanal', label: 'Semanal', restante: r._restSemanal },
              { key: 'meta_mensual', label: 'Mensual', restante: r._restMensual },
            ];
            return (
              <div key={r.asesor_id} style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 12, flex: 1 }}>{r.nombre}</span>
                  <span style={{ fontSize: 12, opacity: 0.5 }}>{(r.gestiones || 0)} gestiones</span>
                  <span style={{ fontSize: 12, opacity: 0.5, marginLeft: 8 }}>Recaudado</span>
                  <input aria-label="Recaudado"
                    type="number" min="0" step="0.01"
                    value={getEditVal(r.asesor_id, 'valor_recaudado', r.valor_recaudado)}
                    onChange={e => handleMetaChange(r.asesor_id, 'valor_recaudado', e.target.value)}
                    onBlur={e => handleMetaBlur(r.asesor_id, r.periodo, 'valor_recaudado', e.target.value)}
                    style={{ ...inputStyle, width: 110, textAlign: 'right' }}
                  />
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {tipos.map(({ key, label, restante }) => {
                      const superada = restante <= 0;
                      return (
                        <tr key={key} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ ...td, width: 80, opacity: 0.55, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</td>
                          <td style={td}>
                            <input
                              type="number" min="0" step="0.01"
                              value={getEditVal(r.asesor_id, key, r[key])}
                              onChange={e => handleMetaChange(r.asesor_id, key, e.target.value)}
                              onBlur={e => handleMetaBlur(r.asesor_id, r.periodo, key, e.target.value)}
                              style={{ ...inputStyle, width: 110, textAlign: 'right' }}
                            />
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: superada ? '#00E676' : '#ff5252' }}>
                            {superada ? `+${fmt$(Math.abs(restante))}` : `-${fmt$(restante)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}

          <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', background: 'rgba(255,255,255,0.02)', marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 12, opacity: 0.6, flex: 1, letterSpacing: 0.5 }}>TOTAL EQUIPO</span>
              <span style={{ fontSize: 12, opacity: 0.5 }}>Recaudado</span>
              <span style={{ fontWeight: 800, color: 'var(--color-primary)', minWidth: 110, textAlign: 'right' }}>{fmt$(totalRecaudado)}</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  { label: 'Diaria',  total: totalDiaria,  restante: totalDiaria  - totalRecaudado },
                  { label: 'Semanal', total: totalSemanal, restante: totalSemanal - totalRecaudado },
                  { label: 'Mensual', total: totalMensual, restante: totalMensual - totalRecaudado },
                ].map(({ label, total, restante }) => (
                  <tr key={label} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ ...td, width: 80, opacity: 0.55, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{fmt$(total)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: restante <= 0 ? '#00E676' : '#ff5252' }}>
                      {restante <= 0 ? `+${fmt$(Math.abs(restante))}` : `-${fmt$(restante)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      )}
    </div>
  );
}

export default AnalisisCartera;
