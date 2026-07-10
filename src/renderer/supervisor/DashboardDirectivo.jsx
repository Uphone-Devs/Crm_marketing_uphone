import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import './DashboardDirectivo.css';

// ── Gauge semi-circular (media dona) ──────────────────────────────────────────
function GaugeMeta({ pct, cobrado, meta }) {
  const safe = Math.min(Math.max(pct || 0, 0), 100);
  const color = safe >= 100 ? '#00ff7f' : safe >= 60 ? '#ffc107' : '#ff5252';
  const data = [{ value: safe }, { value: 100 - safe }];
  return (
    <div className="dd-gauge-wrapper">
      <PieChart width={230} height={140}>
        <Pie
          data={data}
          cx={115}
          cy={118}
          startAngle={180}
          endAngle={0}
          innerRadius={68}
          outerRadius={100}
          dataKey="value"
          stroke="none"
          paddingAngle={0}
        >
          <Cell fill={color} />
          <Cell fill="#1a2a1a" />
        </Pie>
      </PieChart>
      <div className="dd-gauge-center">
        <span className="dd-gauge-pct" style={{ color }}>{safe.toFixed(1)}%</span>
        <span className="dd-gauge-label">CUMPLIMIENTO</span>
      </div>
      <div className="dd-gauge-meta-row">
        <span className="dd-gauge-cobrado">
          <b>${(cobrado || 0).toLocaleString('es', { maximumFractionDigits: 2 })}</b> cobrado
        </span>
        <span className="dd-gauge-meta-target">
          meta: ${(meta || 0).toLocaleString('es', { maximumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  );
}

// ── PieChart cobertura ────────────────────────────────────────────────────────
const COBERTURA_COLORS = ['#00ff7f', '#1e3a2a'];
function CoberturaPie({ contactados, total, pct }) {
  const sinContactar = Math.max(0, (total || 0) - (contactados || 0));
  const data = [
    { name: 'Contactados', value: contactados || 0 },
    { name: 'Sin contactar', value: sinContactar },
  ];
  return (
    <div className="dd-pie-wrapper">
      <PieChart width={190} height={190}>
        <Pie
          data={data}
          cx={95}
          cy={85}
          innerRadius={48}
          outerRadius={78}
          dataKey="value"
          stroke="none"
        >
          {data.map((_, i) => <Cell key={i} fill={COBERTURA_COLORS[i]} />)}
        </Pie>
        <RechartsTooltip
          contentStyle={{ background: '#151515', border: '1px solid #2b2b2b', fontSize: 12 }}
          formatter={(v) => v.toLocaleString()}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: '#9ad4a5' }}
          iconType="circle"
          iconSize={8}
        />
      </PieChart>
      <div className="dd-pie-center-label">{(pct || 0).toFixed(1)}%</div>
    </div>
  );
}

// ── Barra avance de cartera ───────────────────────────────────────────────────
function AvanceCartera({ avance, gestiones, total }) {
  const safe = Math.min(Math.max(avance || 0, 0), 999);
  const fill = safe >= 100 ? '#00ff7f' : safe >= 50 ? '#ffc107' : '#00bcd4';
  return (
    <div className="dd-avance-wrapper">
      <div className="dd-avance-label-row">
        <span className="dd-avance-title">AVANCE CARTERA</span>
        <span className="dd-avance-pct" style={{ color: fill }}>{safe.toFixed(1)}%</span>
      </div>
      <div className="dd-avance-track">
        <div className="dd-avance-fill" style={{ width: `${Math.min(safe, 100)}%`, background: fill }} />
      </div>
      <div className="dd-avance-footer">
        <span>{(gestiones || 0).toLocaleString()} gestiones</span>
        <span>de {(total || 0).toLocaleString()} contactos</span>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function DashboardDirectivo({ apiBase, token }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const initialLoadDone = React.useRef(false);

  const [indicadores,     setIndicadores]     = useState(null);
  const [productividad,   setProductividad]   = useState(null);
  const [topAsesores,     setTopAsesores]     = useState([]);
  const [morosidad,       setMorosidad]       = useState([]);
  const [tendencia,       setTendencia]       = useState([]);

  // Metas diarias por campaña
  const [metaDiariaCampanas, setMetaDiariaCampanas] = useState([]);
  const [editsMeta,          setEditsMeta]          = useState({}); // campanaId → string
  const [metasSegs,          setMetasSegs]          = useState({}); // campanaId → { segmentos: [...] }
  const [editsSegs,          setEditsSegs]          = useState({}); // campanaId → { '0':{monto,und}, '1':..., '2':..., global:{...} }
  const [expandedCamp,       setExpandedCamp]       = useState(null);

  // Filtros
  const todayISO = new Date().toISOString().slice(0, 10);
  const [campanaId,    setCampanaId]    = useState('');
  const [grupo,        setGrupo]        = useState('');
  const [distribuidor, setDistribuidor] = useState('');
  const [numeroCuota,  setNumeroCuota]  = useState('');
  const [fechaDesde,   setFechaDesde]   = useState(todayISO);
  const [fechaHasta,   setFechaHasta]   = useState(todayISO);

  const hdr = { Authorization: `Bearer ${token}` };
  const json = { ...hdr, 'Content-Type': 'application/json' };

  const fetchData = useCallback(async (showSpinner = true) => {
    if (!apiBase) return;
    if (showSpinner && !initialLoadDone.current) setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (campanaId)   q.append('campanaId',   campanaId);
      if (grupo)       q.append('grupo',       grupo);
      if (distribuidor) q.append('distribuidor', distribuidor);
      if (numeroCuota) q.append('numeroCuota', numeroCuota);
      if (fechaDesde)  q.append('fechaDesde',  fechaDesde);
      if (fechaHasta)  q.append('fechaHasta',  fechaHasta);
      const qs = q.toString() ? `?${q}` : '';

      const [rInd, rProd, rTop, rMor, rTend] = await Promise.all([
        fetch(`${apiBase}/jefe/indicadores${qs}`,          { headers: hdr }),
        fetch(`${apiBase}/jefe/productividad${qs}`,        { headers: hdr }),
        fetch(`${apiBase}/jefe/top-asesores?limit=20${qs ? '&' + q : ''}`, { headers: hdr }),
        fetch(`${apiBase}/jefe/morosidad${qs}`,            { headers: hdr }),
        fetch(`${apiBase}/jefe/tendencia-semanal${qs}`,    { headers: hdr }),
      ]);

      if (!rInd.ok) throw new Error(`Error API: ${rInd.status}`);

      setIndicadores(await rInd.json());
      setProductividad(await rProd.json());
      setTopAsesores(await rTop.json());
      setMorosidad(await rMor.json());
      setTendencia(await rTend.json());
      initialLoadDone.current = true;
    } catch (err) {
      if (!initialLoadDone.current) setError(err.message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, token, campanaId, grupo, distribuidor, numeroCuota, fechaDesde, fechaHasta]);

  useEffect(() => {
    initialLoadDone.current = false;
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Carga metas diarias por campaña (independiente del filtro)
  const fetchMetasDiarias = useCallback(async () => {
    if (!apiBase) return;
    try {
      const r = await fetch(`${apiBase}/jefe/meta-diaria-campanas`, { headers: hdr });
      if (r.ok) {
        const data = await r.json();
        setMetaDiariaCampanas(Array.isArray(data) ? data : []);
        const initEdits = {};
        data.forEach(c => { initEdits[c.id] = String(c.meta_diaria ?? 0); });
        setEditsMeta(prev => {
          // Solo inicializar campos que el usuario no está editando actualmente
          const next = { ...initEdits };
          Object.keys(prev).forEach(k => { if (prev[k] !== initEdits[k]) next[k] = prev[k]; });
          return next;
        });
      }
    } catch (_) {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, token]);

  useEffect(() => {
    fetchMetasDiarias();
    const iv = setInterval(fetchMetasDiarias, 30000);
    return () => clearInterval(iv);
  }, [fetchMetasDiarias]);

  const handleGuardarMetaCampana = async (campanaId) => {
    const val = parseFloat(editsMeta[campanaId]);
    if (isNaN(val) || val < 0) return;
    try {
      await fetch(`${apiBase}/jefe/meta-diaria-campana`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ campanaId, valor: val }),
      });
      await fetchMetasDiarias();
    } catch (e) {
      alert(e.message);
    }
  };

  const fetchMetasSegsForCampana = async (cid) => {
    try {
      const r = await fetch(`${apiBase}/campana/metas-segmentos?campana_id=${cid}`, { headers: hdr });
      if (r.ok) {
        const data = await r.json();
        setMetasSegs(prev => ({ ...prev, [cid]: data }));
        // Inicializar edits si no existen
        setEditsSegs(prev => {
          if (prev[cid]) return prev;
          const init = {};
          (data.segmentos || []).forEach(s => {
            init[s.seg] = { monto: String(s.meta_monto || ''), und: String(s.meta_unidades || '') };
          });
          return { ...prev, [cid]: init };
        });
      }
    } catch (_) {}
  };

  const handleGuardarMetasSegs = async (cid) => {
    const edits = editsSegs[cid] || {};
    const metas = {};
    ['0','1','2','global'].forEach(seg => {
      metas[seg] = {
        monto:    parseFloat(edits[seg]?.monto) || 0,
        unidades: parseFloat(edits[seg]?.und)   || 0,
      };
    });
    try {
      await fetch(`${apiBase}/jefe/metas-segmentos`, {
        method: 'POST', headers: json,
        body: JSON.stringify({ campanaId: cid, metas }),
      });
      await fetchMetasSegsForCampana(cid);
    } catch (e) { alert(e.message); }
  };

  // Atajos para datos
  const g   = indicadores?.global ?? {};
  const seg = indicadores?.porSegmento ?? [];
  const prod = productividad ?? {};

  return (
    <div className="dashboard-directivo-container">

      {/* ── CABECERA ──────────────────────────────────────────────────────── */}
      <div className="dd-header-panel">
        <div className="dd-title">
          <h2>Panel Jefe de Área</h2>
          <p>Métricas de recuperación, productividad y cumplimiento</p>
        </div>

        <div className="dd-meta-config" style={{ fontSize: 12, opacity: 0.6 }}>
          Meta diaria por campaña ↓
        </div>

        <div className="dd-filters">
          <input aria-label="ID Campaña" type="text" placeholder="ID Campaña" value={campanaId} onChange={e => setCampanaId(e.target.value)} />
          <input type="text" placeholder="Distribuidor" value={distribuidor} onChange={e => setDistribuidor(e.target.value)} />
          <input type="text" placeholder="Grupo"        value={grupo}        onChange={e => setGrupo(e.target.value)} />
          <input type="text" placeholder="N° Cuota"     value={numeroCuota}  onChange={e => setNumeroCuota(e.target.value)} />
          <input aria-label="Fecha desde" type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
            style={{ background: 'transparent', border: '1px solid rgba(0,230,118,0.25)', borderRadius: 8, padding: '6px 10px', color: '#fff', fontSize: 13, colorScheme: 'dark' }} />
          <input aria-label="Fecha hasta" type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
            style={{ background: 'transparent', border: '1px solid rgba(0,230,118,0.25)', borderRadius: 8, padding: '6px 10px', color: '#fff', fontSize: 13, colorScheme: 'dark' }} />
          <button type="button" className="btn-secondary" onClick={fetchData}>Filtrar</button>
        </div>
      </div>

      {loading && <div className="dd-loading">Cargando métricas…</div>}
      {error   && <div className="dd-error">Error: {error}</div>}

      {!loading && !error && indicadores && (
        <div className="dd-content">

          {/* ── SECCIÓN 1: KPIs Monetarios ───────────────────────────────── */}
          <div className="dd-section-monetary">
            <div className="kpi-card">
              <h4>Cartera Vencida</h4>
              <div className="kpi-value text-danger">${(g.valor_vencido ?? 0).toLocaleString('es', { maximumFractionDigits: 2 })}</div>
              <p>{(g.unidades_vencidas ?? 0).toLocaleString()} unidades</p>
            </div>
            <div className="kpi-card">
              <h4>Cartera Cobrada</h4>
              <div className="kpi-value text-success">${(g.valor_cobrado ?? 0).toLocaleString('es', { maximumFractionDigits: 2 })}</div>
              <p>{(g.unidades_cobradas ?? 0).toLocaleString()} unidades cobradas</p>
            </div>
            <div className="kpi-card">
              <h4>Diferencia</h4>
              <div className="kpi-value text-danger">${(g.diferencia_monetaria ?? 0).toLocaleString('es', { maximumFractionDigits: 2 })}</div>
              <p>{(g.diferencia_unidades ?? 0).toLocaleString()} unidades pendientes</p>
            </div>
            <div className="kpi-card">
              <h4>% Recuperación</h4>
              <div className="kpi-value text-info">{(g.pct_recuperacion ?? 0).toFixed(2)}%</div>
              <p>{(g.pct_recuperacion_und ?? 0).toFixed(2)}% en unidades</p>
            </div>
          </div>

          {/* ── SECCIÓN META DIARIA POR CAMPAÑA (con segmentos) ─────────── */}
          {metaDiariaCampanas.length > 0 && (() => {
            const SEG_COLORS = { '0': '#3b82f6', '1': '#8b5cf6', '2': '#06b6d4', global: '#10b981' };
            const SEG_LABELS = { '0': 'S0', '1': 'S1', '2': 'S2', global: 'Global' };
            const fmtUSD = v => `$${Number(v || 0).toLocaleString('es', { maximumFractionDigits: 0 })}`;
            return (
              <div className="chart-container" style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 700, opacity: 0.85 }}>
                  Metas Diarias por Cartera
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {metaDiariaCampanas.map(c => {
                    const pctGlobal = c.pct_cumplimiento ?? 0;
                    const colorG = pctGlobal >= 100 ? '#00ff7f' : pctGlobal >= 60 ? '#ffc107' : '#ff5252';
                    const isExp  = expandedCamp === c.id;
                    const segsData = metasSegs[c.id]?.segmentos || [];
                    const segsMap  = Object.fromEntries(segsData.map(s => [s.seg, s]));

                    return (
                      <div key={c.id} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'hidden' }}>
                        {/* Fila principal campaña */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', flexWrap: 'wrap' }}>
                          <button type="button" onClick={() => {
                            const next = isExp ? null : c.id;
                            setExpandedCamp(next);
                            if (next) fetchMetasSegsForCampana(c.id);
                          }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgba(255,255,255,0.5)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{isExp ? 'expand_less' : 'expand_more'}</span>
                          </button>
                          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 130, opacity: 0.9, flexShrink: 0 }}>{c.nombre}</span>
                          <div style={{ flex: 1, minWidth: 80, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(pctGlobal, 100)}%`, height: '100%', background: colorG, borderRadius: 3, transition: 'width .4s' }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 800, color: colorG, minWidth: 40 }}>{pctGlobal.toFixed(1)}%</span>
                          <span style={{ fontSize: 11, opacity: 0.45, minWidth: 100 }}>
                            {fmtUSD(c.cobrado_hoy)} / {fmtUSD(c.meta_diaria)}
                          </span>
                          <input aria-label="Meta global USD" type="number" min="0" step="1"
                            value={editsMeta[c.id] ?? ''}
                            onChange={e => setEditsMeta(prev => ({ ...prev, [c.id]: e.target.value }))}
                            onKeyDown={e => e.key === 'Enter' && handleGuardarMetaCampana(c.id)}
                            placeholder="Meta global $"
                            style={{ width: 100, padding: '3px 6px', fontSize: 11, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, color: 'inherit' }}
                          />
                          <button type="button" onClick={() => handleGuardarMetaCampana(c.id)}
                            style={{ padding: '3px 9px', fontSize: 11, fontWeight: 700, background: 'rgba(0,230,118,0.12)', border: '1px solid rgba(0,230,118,0.3)', color: '#00e676', borderRadius: 5, cursor: 'pointer' }}>
                            Fijar
                          </button>
                        </div>

                        {/* Panel expandido: metas por segmento */}
                        {isExp && (
                          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.45, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Metas por segmento</div>

                            {/* Grid segmentos: S0 S1 S2 Global */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                              {['0','1','2','global'].map(seg => {
                                const color   = SEG_COLORS[seg];
                                const label   = SEG_LABELS[seg];
                                const apiSeg  = segsMap[seg] || {};
                                const editSeg = editsSegs[c.id]?.[seg] || { monto: '', und: '' };
                                const pctM    = apiSeg.pct_monto    ?? null;
                                const pctU    = apiSeg.pct_unidades ?? null;
                                return (
                                  <div key={seg} style={{ background: `${color}0d`, border: `1px solid ${color}28`, borderRadius: 9, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                                    <div style={{ fontSize: 12, fontWeight: 800, color }}>{label}</div>

                                    {/* Avance monto */}
                                    {apiSeg.meta_monto > 0 && (
                                      <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                                          <span style={{ opacity: 0.5 }}>Cobrado</span>
                                          <span style={{ fontWeight: 700, color }}>{fmtUSD(apiSeg.cobrado_hoy)}/{fmtUSD(apiSeg.meta_monto)}</span>
                                        </div>
                                        <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 99 }}>
                                          <div style={{ width: `${Math.min(pctM ?? 0, 100)}%`, height: '100%', background: (pctM ?? 0) >= 100 ? '#00e676' : color, borderRadius: 99, transition: 'width .4s' }} />
                                        </div>
                                        <div style={{ fontSize: 10, color, fontWeight: 700, marginTop: 1 }}>{pctM ?? 0}%</div>
                                      </div>
                                    )}

                                    {/* Avance unidades */}
                                    {apiSeg.meta_unidades > 0 && (
                                      <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                                          <span style={{ opacity: 0.5 }}>Pagados</span>
                                          <span style={{ fontWeight: 700, color }}>{apiSeg.unidades_hoy}/{apiSeg.meta_unidades}</span>
                                        </div>
                                        <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 99 }}>
                                          <div style={{ width: `${Math.min(pctU ?? 0, 100)}%`, height: '100%', background: (pctU ?? 0) >= 100 ? '#00e676' : color, borderRadius: 99, transition: 'width .4s' }} />
                                        </div>
                                        <div style={{ fontSize: 10, color, fontWeight: 700, marginTop: 1 }}>{pctU ?? 0}%</div>
                                      </div>
                                    )}

                                    {/* Inputs configuración */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 3 }}>
                                      <input aria-label={`Meta monto ${label}`} type="number" min="0" placeholder="Meta $ cobrado"
                                        value={editSeg.monto}
                                        onChange={e => setEditsSegs(prev => ({ ...prev, [c.id]: { ...(prev[c.id]||{}), [seg]: { ...(prev[c.id]?.[seg]||{}), monto: e.target.value } } }))}
                                        style={{ width: '100%', padding: '3px 6px', fontSize: 10, background: 'rgba(0,0,0,0.25)', border: `1px solid ${color}40`, borderRadius: 5, color: 'inherit', boxSizing: 'border-box' }}
                                      />
                                      <input aria-label={`Meta unidades ${label}`} type="number" min="0" placeholder="Meta # pagados"
                                        value={editSeg.und}
                                        onChange={e => setEditsSegs(prev => ({ ...prev, [c.id]: { ...(prev[c.id]||{}), [seg]: { ...(prev[c.id]?.[seg]||{}), und: e.target.value } } }))}
                                        style={{ width: '100%', padding: '3px 6px', fontSize: 10, background: 'rgba(0,0,0,0.25)', border: `1px solid ${color}40`, borderRadius: 5, color: 'inherit', boxSizing: 'border-box' }}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            <button type="button" onClick={() => handleGuardarMetasSegs(c.id)}
                              style={{ alignSelf: 'flex-end', padding: '5px 16px', fontSize: 12, fontWeight: 700, background: 'rgba(0,230,118,0.15)', border: '1px solid rgba(0,230,118,0.35)', color: '#00e676', borderRadius: 7, cursor: 'pointer' }}>
                              Guardar metas por segmento
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── SECCIÓN 2: Avance + Cobertura ──────────────────────────── */}
          <div className="dd-section-charts3">
            {/* Avance cartera */}
            <div className="chart-container dd-chart-avance">
              <h3>Avance de Cartera</h3>
              <AvanceCartera
                avance={prod.avance_cartera}
                gestiones={prod.gestiones_totales}
                total={prod.cartera_total}
              />
              <div className="dd-avance-canales">
                {['llamada', 'whatsapp', 'rcs', 'gmail'].map(c => (
                  <div key={c} className="dd-canal-pill">
                    <span className="dd-canal-name">{c === 'gmail' ? 'EMAIL' : c.toUpperCase()}</span>
                    <span className="dd-canal-val">{(prod.canales?.[c] ?? 0).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cobertura Pie */}
            <div className="chart-container dd-chart-cobertura">
              <h3>% Cobertura de Cartera</h3>
              <CoberturaPie
                contactados={prod.contactados_unicos}
                total={prod.cartera_total}
                pct={prod.cobertura}
              />
            </div>
          </div>

          {/* ── SECCIÓN 3: Tendencia + Morosidad ────────────────────────── */}
          <div className="dd-row-2">
            <div className="chart-container tendence-chart">
              <h3>Tendencia de Recaudación (7 días)</h3>
              {tendencia.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={tendencia}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.08} stroke="#fff" />
                    <XAxis dataKey="fecha" stroke="#89c294" tick={{ fill: '#e3e3e3', fontSize: 12 }} />
                    <YAxis stroke="#89c294" tick={{ fill: '#e3e3e3', fontSize: 12 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <RechartsTooltip
                      formatter={v => [`$${v.toLocaleString('es', { maximumFractionDigits: 2 })}`, 'Cobrado']}
                      contentStyle={{ background: '#151515', border: '1px solid #2b2b2b', color: '#e3e3e3', fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey="valor_cobrado" stroke="#00ff7f" strokeWidth={2.5} dot={{ fill: '#00ff7f', r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="dd-empty">Sin datos de tendencia</div>
              )}
            </div>

            <div className="chart-container morosidad-chart">
              <h3>Morosidad por Distribuidor</h3>
              {morosidad.length > 0 ? (
                <div style={{ overflowY: 'auto', maxHeight: 340 }}>
                  <ResponsiveContainer width="100%" height={Math.max(300, morosidad.length * 34)}>
                    <BarChart
                      data={morosidad}
                      layout="vertical"
                      margin={{ left: 8, right: 52, top: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.06} stroke="#fff" horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        stroke="#89c294"
                        tick={{ fill: '#a0a0a0', fontSize: 12 }}
                        tickFormatter={v => `${v}%`}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        dataKey="distribuidor"
                        type="category"
                        width={140}
                        stroke="none"
                        tick={({ x, y, payload }) => {
                          const label = payload.value.length > 18
                            ? payload.value.slice(0, 17) + '…'
                            : payload.value;
                          return (
                            <text x={x} y={y} dy={4} textAnchor="end" fill="#c8c8c8" fontSize={10}>
                              {label}
                            </text>
                          );
                        }}
                      />
                      <RechartsTooltip
                        formatter={v => [`${v}%`, 'Morosidad']}
                        labelFormatter={l => l}
                        contentStyle={{ background: '#1a1a2e', border: '1px solid #2b2b2b', color: '#e3e3e3', fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="pct_morosidad" radius={[0, 4, 4, 0]} minPointSize={2} label={{ position: 'right', fill: '#a0a0a0', fontSize: 12, formatter: v => `${v}%` }}>
                        {morosidad.map((entry, index) => {
                          const pct = entry.pct_morosidad || 0;
                          const color = pct >= 70 ? '#ff5252' : pct >= 40 ? '#ffa726' : '#00c853';
                          return <Cell key={index} fill={color} fillOpacity={0.8} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="dd-empty">Sin datos de morosidad</div>
              )}
            </div>
          </div>

          {/* ── SECCIÓN 4: Top 5 Asesores ────────────────────────────────── */}
          <div className="dd-row-3">
            <div className="top-asesores-panel">
              <h3>Top 5 Asesores — Productividad por Segmento</h3>
              {topAsesores.length > 0 ? (
                <table className="dd-table dd-table-segmentos">
                  <thead>
                    <tr>
                      <th rowSpan={2} style={{ verticalAlign: 'middle', minWidth: 130 }}>Asesor</th>
                      <th rowSpan={2} style={{ verticalAlign: 'middle', textAlign: 'center', minWidth: 140 }}>Total Gestiones</th>
                      {['0','1','2'].map(s => (
                        <th key={s} colSpan={4} style={{ textAlign: 'center', background: s==='0' ? '#1a2a1a' : s==='1' ? '#1a1e2a' : '#2a1a1a' }}>
                          Segmento {s}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {['0','1','2'].map(s => (
                        <React.Fragment key={s}>
                          <th style={{ fontSize: 12, background: s==='0' ? '#111a11' : s==='1' ? '#11111a' : '#1a1111' }}>Gest.</th>
                          <th style={{ fontSize: 12, background: s==='0' ? '#111a11' : s==='1' ? '#11111a' : '#1a1111' }}>PMP</th>
                          <th style={{ fontSize: 12, color: '#00ff7f', background: s==='0' ? '#111a11' : s==='1' ? '#11111a' : '#1a1111' }}>Cumpl.</th>
                          <th style={{ fontSize: 12, color: '#ffb4ab', background: s==='0' ? '#111a11' : s==='1' ? '#11111a' : '#1a1111' }}>Venc.</th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topAsesores.map((a) => {
                      const maxG = Math.max(...topAsesores.map(x => x.total_gestiones || 1), 1);
                      const w = Math.round(((a.total_gestiones || 0) / maxG) * 100);
                      return (
                        <tr key={a.asesor}>
                          <td style={{ fontWeight: 700, color: '#fff' }}>{a.asesor}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px' }}>
                              <span style={{ minWidth: 30, textAlign: 'right', fontSize: 13, color: '#ccc' }}>{a.total_gestiones || 0}</span>
                              <div style={{ flex: 1, height: 8, background: '#1e1e1e', borderRadius: 4, overflow: 'hidden', border: '1px solid #2a2a2a' }}>
                                <div style={{ width: `${w}%`, height: '100%', background: 'linear-gradient(90deg,#2a6a2a,#9ad4a5)', borderRadius: 4 }} />
                              </div>
                              <span style={{ minWidth: 28, fontSize: 12, color: '#888' }}>{w}%</span>
                            </div>
                          </td>
                          {['0','1','2'].map(s => {
                            const sg = a.segmentos?.[s] || {};
                            return (
                              <React.Fragment key={s}>
                                <td style={{ textAlign: 'center', fontSize: 13 }}>{sg.gestiones || 0}</td>
                                <td style={{ textAlign: 'center', fontSize: 13 }}>{sg.promesas || 0}</td>
                                <td style={{ textAlign: 'center', fontSize: 13, color: sg.cumplidas > 0 ? '#00ff7f' : '#555', fontWeight: sg.cumplidas > 0 ? 700 : 400 }}>{sg.cumplidas || 0}</td>
                                <td style={{ textAlign: 'center', fontSize: 13, color: sg.vencidas  > 0 ? '#ffb4ab' : '#555' }}>{sg.vencidas  || 0}</td>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="dd-empty">Sin gestiones registradas</div>
              )}
            </div>
          </div>

          {/* ── SECCIÓN 5: Métricas por Segmento ────────────────────────── */}
          <div className="dd-row-3" style={{ marginTop: 24 }}>
            <div className="top-asesores-panel">
              <h3>Indicadores por Segmento (S0 / S1 / S2)</h3>
              {seg.length > 0 ? (
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>Segmento</th>
                      <th>Vencido (USD)</th>
                      <th>Cobrado (USD)</th>
                      <th>Diferencia</th>
                      <th>% Recuperación</th>
                      <th>Unds. Vencidas</th>
                      <th>Unds. Cobradas</th>
                      <th>% Rec. Unds.</th>
                      <th>Promesas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seg.map((s) => (
                      <tr key={`seg-${s.segmento ?? 'n'}`}>
                        <td style={{ fontWeight: 700, color: '#fff' }}>S{s.segmento ?? 'N/A'}</td>
                        <td className="text-danger">${(s.valor_vencido ?? 0).toLocaleString('es', { maximumFractionDigits: 2 })}</td>
                        <td className="text-success">${(s.valor_cobrado ?? 0).toLocaleString('es', { maximumFractionDigits: 2 })}</td>
                        <td className="text-danger">${(s.diferencia_monetaria ?? 0).toLocaleString('es', { maximumFractionDigits: 2 })}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ minWidth: 42, color: '#5bc0de' }}>{(s.pct_recuperacion ?? 0).toFixed(1)}%</span>
                            <div className="progress-bar-container" style={{ flex: 1, margin: 0 }}>
                              <div className="progress-bar-fill" style={{ width: `${s.pct_recuperacion ?? 0}%` }} />
                            </div>
                          </div>
                        </td>
                        <td>{(s.unidades_vencidas  ?? 0).toLocaleString()}</td>
                        <td className="text-success">{(s.unidades_cobradas ?? 0).toLocaleString()}</td>
                        <td className="text-info">{(s.pct_recuperacion_und ?? 0).toFixed(1)}%</td>
                        <td style={{ color: (s.promesas ?? 0) > 0 ? '#00ff7f' : 'inherit' }}>{(s.promesas ?? 0).toLocaleString()}</td>
                      </tr>
                    ))}
                    {seg.length === 0 && (
                      <tr><td colSpan={9} className="dd-empty">Sin datos de segmento</td></tr>
                    )}
                  </tbody>
                </table>
              ) : (
                <div className="dd-empty">Sin segmentos disponibles</div>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
