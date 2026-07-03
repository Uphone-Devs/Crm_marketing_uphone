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
          wrapperStyle={{ fontSize: 11, color: '#9ad4a5' }}
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

  const [metaMensualData, setMetaMensualData] = useState(null);
  const [indicadores,     setIndicadores]     = useState(null);
  const [productividad,   setProductividad]   = useState(null);
  const [topAsesores,     setTopAsesores]     = useState([]);
  const [morosidad,       setMorosidad]       = useState([]);
  const [tendencia,       setTendencia]       = useState([]);

  // Filtros
  const [campanaId,    setCampanaId]    = useState('');
  const [segmento,     setSegmento]     = useState('');
  const [distribuidor, setDistribuidor] = useState('');

  // Meta input
  const [inputMeta,   setInputMeta]   = useState('');
  const [savingMeta,  setSavingMeta]  = useState(false);

  const hdr = { Authorization: `Bearer ${token}` };
  const json = { ...hdr, 'Content-Type': 'application/json' };

  const fetchData = useCallback(async () => {
    if (!apiBase) return;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (campanaId)    q.append('campanaId',    campanaId);
      if (segmento)     q.append('segmento',     segmento);
      if (distribuidor) q.append('distribuidor', distribuidor);
      const qs = q.toString() ? `?${q}` : '';

      const [rMeta, rInd, rProd, rTop, rMor, rTend] = await Promise.all([
        fetch(`${apiBase}/jefe/meta-mensual`,          { headers: hdr }),
        fetch(`${apiBase}/jefe/indicadores${qs}`,      { headers: hdr }),
        fetch(`${apiBase}/jefe/productividad${qs}`,    { headers: hdr }),
        fetch(`${apiBase}/jefe/top-asesores?limit=5`,  { headers: hdr }),
        fetch(`${apiBase}/jefe/morosidad`,             { headers: hdr }),
        fetch(`${apiBase}/jefe/tendencia-semanal`,     { headers: hdr }),
      ]);

      if (!rInd.ok) throw new Error(`Error API: ${rInd.status}`);

      const meta = await rMeta.json();
      setMetaMensualData(meta);
      setInputMeta(meta?.meta_mensual ?? '');
      setIndicadores(await rInd.json());
      setProductividad(await rProd.json());
      setTopAsesores(await rTop.json());
      setMorosidad(await rMor.json());
      setTendencia(await rTend.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, token, campanaId, segmento, distribuidor]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleGuardarMeta = async () => {
    const val = parseFloat(inputMeta);
    if (!val || isNaN(val) || val < 0) return;
    setSavingMeta(true);
    try {
      const res = await fetch(`${apiBase}/jefe/meta-mensual`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ meta: val }),
      });
      if (res.ok) await fetchData();
      else alert('Error al guardar la meta');
    } catch (e) {
      alert(e.message);
    } finally {
      setSavingMeta(false);
    }
  };

  // Atajos para datos
  const g   = indicadores?.global ?? {};
  const seg = indicadores?.porSegmento ?? [];
  const prod = productividad ?? {};

  const pctCumpl  = metaMensualData?.pct_cumplimiento ?? 0;
  const cobradoM  = metaMensualData?.cobrado_mes      ?? 0;
  const metaM     = metaMensualData?.meta_mensual     ?? 0;

  return (
    <div className="dashboard-directivo-container">

      {/* ── CABECERA ──────────────────────────────────────────────────────── */}
      <div className="dd-header-panel">
        <div className="dd-title">
          <h2>Panel Jefe de Área</h2>
          <p>Métricas de recuperación, productividad y cumplimiento</p>
        </div>

        <div className="dd-meta-config">
          <label>Meta Mensual (USD):</label>
          <input
            type="number"
            className="input-meta"
            value={inputMeta}
            onChange={e => setInputMeta(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleGuardarMeta()}
            disabled={savingMeta}
            placeholder="0"
          />
          <button className="btn-primary" onClick={handleGuardarMeta} disabled={savingMeta}>
            {savingMeta ? 'Guardando…' : 'Fijar Meta'}
          </button>
        </div>

        <div className="dd-filters">
          <input type="text" placeholder="ID Campaña"   value={campanaId}    onChange={e => setCampanaId(e.target.value)} />
          <input type="text" placeholder="Segmento"     value={segmento}     onChange={e => setSegmento(e.target.value)} />
          <input type="text" placeholder="Distribuidor" value={distribuidor} onChange={e => setDistribuidor(e.target.value)} />
          <button className="btn-secondary" onClick={fetchData}>Filtrar</button>
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

          {/* ── SECCIÓN 2: Gauge + Avance + Cobertura ──────────────────── */}
          <div className="dd-section-charts3">
            {/* Gauge meta */}
            <div className="chart-container dd-chart-gauge">
              <h3>Cumplimiento de Meta Mensual</h3>
              <GaugeMeta pct={pctCumpl} cobrado={cobradoM} meta={metaM} />
            </div>

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
                    <XAxis dataKey="fecha" stroke="#89c294" tick={{ fill: '#e3e3e3', fontSize: 11 }} />
                    <YAxis stroke="#89c294" tick={{ fill: '#e3e3e3', fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
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
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={morosidad} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.08} stroke="#fff" />
                    <XAxis type="number" stroke="#89c294" tick={{ fill: '#e3e3e3', fontSize: 11 }} unit="%" />
                    <YAxis dataKey="distribuidor" type="category" width={90} stroke="#89c294" tick={{ fill: '#e3e3e3', fontSize: 10 }} />
                    <RechartsTooltip
                      formatter={v => [`${v}%`, 'Morosidad']}
                      contentStyle={{ background: '#151515', border: '1px solid #2b2b2b', color: '#e3e3e3', fontSize: 12 }}
                    />
                    <Bar dataKey="pct_morosidad" fill="#ffb4ab" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
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
                          <th style={{ fontSize: 11, background: s==='0' ? '#111a11' : s==='1' ? '#11111a' : '#1a1111' }}>Gest.</th>
                          <th style={{ fontSize: 11, background: s==='0' ? '#111a11' : s==='1' ? '#11111a' : '#1a1111' }}>PMP</th>
                          <th style={{ fontSize: 11, color: '#00ff7f', background: s==='0' ? '#111a11' : s==='1' ? '#11111a' : '#1a1111' }}>Cumpl.</th>
                          <th style={{ fontSize: 11, color: '#ffb4ab', background: s==='0' ? '#111a11' : s==='1' ? '#11111a' : '#1a1111' }}>Venc.</th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topAsesores.map((a, i) => {
                      const maxG = Math.max(...topAsesores.map(x => x.total_gestiones || 1), 1);
                      const w = Math.round(((a.total_gestiones || 0) / maxG) * 100);
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 700, color: '#fff' }}>{a.asesor}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px' }}>
                              <span style={{ minWidth: 30, textAlign: 'right', fontSize: 13, color: '#ccc' }}>{a.total_gestiones || 0}</span>
                              <div style={{ flex: 1, height: 8, background: '#1e1e1e', borderRadius: 4, overflow: 'hidden', border: '1px solid #2a2a2a' }}>
                                <div style={{ width: `${w}%`, height: '100%', background: 'linear-gradient(90deg,#2a6a2a,#9ad4a5)', borderRadius: 4 }} />
                              </div>
                              <span style={{ minWidth: 28, fontSize: 10, color: '#888' }}>{w}%</span>
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
                    {seg.map((s, i) => (
                      <tr key={i}>
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
