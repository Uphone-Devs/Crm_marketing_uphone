import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell,
  RadialBarChart, RadialBar, PieChart, Pie
} from 'recharts';

/* ═══════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════ */
const MEDAL = ['🥇', '🥈', '🥉'];

const SEGMENTS = [
  { id: '0',      label: 'Seg 0',  color: '#3b82f6' },
  { id: '1',      label: 'Seg 1',  color: '#8b5cf6' },
  { id: '2',      label: 'Seg 2',  color: '#06b6d4' },
  { id: 'global', label: 'Global', color: '#10b981' },
];

const CANALES = [
  { id: 'whatsapp', label: 'WhatsApp', icon: 'chat' },
  { id: 'rcs',      label: 'RCS',      icon: 'sms' },
  { id: 'gmail',    label: 'Correos',  icon: 'mail' },
  { id: 'llamada',  label: 'Llamadas', icon: 'call' },
];

/* ═══════════════════════════════════════════════
   STYLE TOKENS
═══════════════════════════════════════════════ */
const S = {
  card: {
    background: 'rgba(255,255,255,0.035)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: 16,
    backdropFilter: 'blur(4px)',
  },
  kpiCard: {
    background: 'rgba(255,255,255,0.035)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: '14px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    opacity: 0.45,
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 26,
    fontWeight: 800,
    lineHeight: 1.1,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    opacity: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  },
};

/* ═══════════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════════ */
export default function DashboardProductividad({ usuario, callApi, tiempoProductivoSeg, tiempoImproductivoSeg }) {
  const [metricas,       setMetricas]       = useState(null);
  const [rankingGeneral, setRankingGeneral]  = useState([]);
  const [metaMensual,    setMetaMensual]     = useState(null);
  const [indicadoresGlob, setIndicadoresGlob] = useState(null);
  const [activeTab,      setActiveTab]      = useState('whatsapp');
  const [activeSeg,      setActiveSeg]      = useState('global');
  const [loading,        setLoading]        = useState(true);

  /* ─── fetch ─── */
  const fetchAll = async () => {
    setLoading(true);
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const m   = await callApi('db:getMetricasDia', usuario.id, hoy);
      setMetricas(m);
      const rg  = await callApi('db:getRankingGeneralAsesores', hoy);
      if (rg) setRankingGeneral(rg);
      const meta = await callApi('db:getProyeccionMensual');
      if (meta) setMetaMensual(meta);
      const ind = await callApi('db:getIndicadoresCobranza', {});
      if (ind) setIndicadoresGlob(ind);
    } catch (e) {
      console.error('Dashboard error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 60000);
    return () => clearInterval(iv);
  }, [usuario.id]);

  /* ─── derived KPIs ───
   * Si el AsesorPanel pasa los tiempos en tiempo real (tiempoProductivoSeg /
   * tiempoImproductivoSeg), los usamos directamente en segundos → minutos.
   * Esto evita la discrepancia con el header PRODUCTIVO / IMPRODUCTIVO que
   * ya muestra esos mismos valores en vivo. Si no se pasan (compatibilidad
   * legacy), se sigue leyendo desde la DB como antes.
   */
  const tiempoAire   = tiempoProductivoSeg   !== undefined
    ? Math.floor(tiempoProductivoSeg   / 60)
    : Math.floor((metricas?.tiempo_al_aire || 0) / 60);
  const tiempoMuerto = tiempoImproductivoSeg !== undefined
    ? Math.floor(tiempoImproductivoSeg / 60)
    : Math.floor((metricas?.tiempo_muerto  || 0) / 60);
  const totalMin    = tiempoAire + tiempoMuerto || 1;
  const pctProductivo = Math.round((tiempoAire / totalMin) * 100);
  const efectividad = metricas?.total_marcaciones > 0
    ? Math.round(((metricas?.contactos_efectivos || 0) / metricas.total_marcaciones) * 100)
    : 0;
  const monto = metricas?.monto_comprometido || 0;

  const barData = [
    { name: 'Contactos',   v: metricas?.contactos_efectivos || 0, color: '#3b82f6' },
    { name: 'Promesas',    v: metricas?.promesas_pago       || 0, color: '#8b5cf6' },
    { name: 'Gestiones',   v: metricas?.total_marcaciones   || 0, color: '#10b981' },
    { name: 'Compromisos', v: metricas?.total_compromisos   || 0, color: '#f59e0b' },
  ];

  /* ─── ranking helpers ─── */
  const buildRankList = () => {
    const list = [...rankingGeneral]
      .map(r => ({
        id:    r.id,
        name:  r.nombre,
        score: activeSeg === 'global'
          ? (r.canales?.[activeTab]?.global || 0)
          : (r.canales?.[activeTab]?.[activeSeg]  || 0),
        isMe: r.id === usuario.id,
      }))
      .sort((a, b) => b.score - a.score);

    const top5    = list.slice(0, 5);
    const meEntry = list.find(d => d.isMe);
    if (meEntry && !top5.find(d => d.isMe)) top5.push(meEntry);

    return { top5, full: list };
  };

  const { top5, full } = buildRankList();
  const myEntry  = full.find(d => d.isMe);
  const myRank   = myEntry ? full.indexOf(myEntry) + 1 : null;
  const myScore  = myEntry?.score || 0;
  const topScore = full[0]?.score || 1;
  const avgScore = full.length ? full.reduce((s, d) => s + d.score, 0) / full.length : 0;
  const gap      = Math.max(0, topScore - myScore);
  const gapPct   = Math.round((gap / topScore) * 100);
  const segColor = SEGMENTS.find(s => s.id === activeSeg)?.color || '#10b981';

  /* ─── loading state ─── */
  if (loading && !metricas) {
    return (
      <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100%', gap:10, opacity:0.5 }}>
        <span className="material-symbols-outlined" style={{ animation:'spin 1s linear infinite', fontSize:24 }}>sync</span>
        <span style={{ fontSize:13 }}>Cargando panel…</span>
      </div>
    );
  }

  /* ════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════ */
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'0 10px 18px', overflowY:'auto', height:'100%', fontFamily:'Inter, system-ui, sans-serif' }}>

      {/* ══ TOP BAR ══ */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid rgba(255,255,255,0.07)', paddingBottom:12 }}>
        <div>
          <div style={{ fontSize:16, fontWeight:800, color:'var(--color-primary)', letterSpacing:'-0.01em' }}>
            Panel de Productividad
          </div>
          <div style={{ fontSize:11, opacity:0.45, marginTop:1 }}>Rendimiento y Ranking — {new Date().toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long' })}</div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={fetchAll} style={{ display:'flex', alignItems:'center', gap:5 }}>
          <span className="material-symbols-outlined" style={{ fontSize:13 }}>refresh</span>
          Actualizar
        </button>
      </div>

      {/* ══ ROW 1 — KPI CARDS ══ */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10 }}>
        {/* Efectividad */}
        <div style={S.kpiCard}>
          <div style={S.label}>🎯 Efectividad</div>
          <div style={{ ...S.value, color: efectividad >= 60 ? '#69f0ae' : efectividad >= 40 ? '#ffb74d' : '#ff5252' }}>{efectividad}%</div>
          <div style={{ height:4, background:'rgba(255,255,255,0.07)', borderRadius:4, marginTop:4 }}>
            <div style={{ width:`${efectividad}%`, height:'100%', background: efectividad >= 60 ? '#69f0ae' : '#ffb74d', borderRadius:4, transition:'width .4s' }} />
          </div>
          <div style={{ fontSize:10, opacity:0.4, marginTop:2 }}>{metricas?.contactos_efectivos || 0} de {metricas?.total_marcaciones || 0} contactos</div>
        </div>

        {/* Monto Comprometido */}
        <div style={S.kpiCard}>
          <div style={S.label}>💰 Monto Comprometido</div>
          <div style={{ ...S.value, color:'#00e676' }}>${monto.toLocaleString('es-MX')}</div>
          <div style={{ fontSize:10, opacity:0.4, marginTop:6 }}>{metricas?.total_compromisos || 0} compromisos de pago</div>
        </div>

        {/* Meta Mensual */}
        <div style={S.kpiCard}>
          <div style={S.label}>🎯 Meta (Global)</div>
          <div style={{ ...S.value, color:'#29b6f6' }}>${metaMensual?.meta_mensual?.toLocaleString('es-MX') || 0}</div>
          <div style={{ height:4, background:'rgba(255,255,255,0.07)', borderRadius:4, marginTop:4 }}>
            <div style={{ width:`${Math.min(metaMensual?.pct_cumplimiento || 0, 100)}%`, height:'100%', background: '#29b6f6', borderRadius:4, transition:'width .4s' }} />
          </div>
          <div style={{ fontSize:10, opacity:0.4, marginTop:2 }}>{metaMensual?.pct_cumplimiento || 0}% de avance</div>
        </div>

        {/* Cartera Vencida Total */}
        <div style={S.kpiCard}>
          <div style={S.label}>📊 Vencimientos</div>
          <div style={{ ...S.value, color:'#ef5350' }}>${indicadoresGlob?.global?.valor_vencido?.toLocaleString('es-MX') || 0}</div>
          <div style={{ fontSize:10, opacity:0.4, marginTop:6 }}>{indicadoresGlob?.global?.unidades_vencidas || 0} contratos vencidos</div>
        </div>
      </div>

      {/* ══ ROW 2 — CHART + RANKING ══ */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1.8fr', gap:12 }}>

        {/* Gestiones Chart — Premium Horizontal Bars */}
        <div style={{ ...S.card, display:'flex', flexDirection:'column', gap:12 }}>
          <div style={S.sectionTitle}>
            <span className="material-symbols-outlined" style={{ fontSize:14 }}>bar_chart</span>
            Gestiones del Día
          </div>

          {/* Summary total */}
          <div style={{ display:'flex', alignItems:'baseline', gap:6, marginBottom:2 }}>
            <span style={{ fontSize:32, fontWeight:900, color:'var(--color-primary)', lineHeight:1 }}>
              {metricas?.total_marcaciones || 0}
            </span>
            <span style={{ fontSize:11, opacity:0.45, fontWeight:600 }}>gestiones totales</span>
          </div>

          {/* Horizontal metric bars */}
          {[
            {
              label: 'Gestiones',
              icon: 'phone_in_talk',
              value: metricas?.total_marcaciones || 0,
              max: Math.max(metricas?.total_marcaciones || 1, 1),
              gradient: 'linear-gradient(90deg, #10b981, #34d399)',
              glow: 'rgba(16,185,129,0.4)',
            },
            {
              label: 'Contactos Efectivos',
              icon: 'person_check',
              value: metricas?.contactos_efectivos || 0,
              max: Math.max(metricas?.total_marcaciones || 1, 1),
              gradient: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              glow: 'rgba(59,130,246,0.4)',
            },
            {
              label: 'Promesas de Pago',
              icon: 'handshake',
              value: metricas?.promesas_pago || 0,
              max: Math.max(metricas?.total_marcaciones || 1, 1),
              gradient: 'linear-gradient(90deg, #8b5cf6, #a78bfa)',
              glow: 'rgba(139,92,246,0.4)',
            },
            {
              label: 'Compromisos',
              icon: 'verified',
              value: metricas?.total_compromisos || 0,
              max: Math.max(metricas?.total_marcaciones || 1, 1),
              gradient: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
              glow: 'rgba(245,158,11,0.4)',
            },
          ].map((item, i) => {
            const pct = Math.min(Math.round((item.value / item.max) * 100), 100);
            return (
              <div key={i} style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <span className="material-symbols-outlined" style={{ fontSize:13, opacity:0.7 }}>{item.icon}</span>
                    <span style={{ fontSize:11, fontWeight:600, opacity:0.75 }}>{item.label}</span>
                  </div>
                  <span style={{ fontSize:13, fontWeight:800, letterSpacing:'-0.02em' }}>{item.value}</span>
                </div>
                <div style={{ height:6, background:'rgba(255,255,255,0.06)', borderRadius:99, overflow:'hidden' }}>
                  <div style={{
                    width: `${pct}%`,
                    height:'100%',
                    background: item.gradient,
                    borderRadius: 99,
                    boxShadow: pct > 0 ? `0 0 8px ${item.glow}` : 'none',
                    transition: 'width 0.6s cubic-bezier(0.34,1.56,0.64,1)',
                  }} />
                </div>
              </div>
            );
          })}
        </div>


        {/* Ranking */}
        <div style={{ ...S.card, display:'flex', flexDirection:'column', gap:16, border: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Ranking header + filters */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
            <div style={{ ...S.sectionTitle, color: 'var(--color-primary)', marginBottom: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize:18, opacity: 0.8 }}>social_leaderboard</span>
              Competencia — Top 5
            </div>

            {/* Canal tabs (Segmented Control style) */}
            <div style={{ display:'flex', background:'rgba(255,255,255,0.03)', padding:4, borderRadius:12, border: '1px solid rgba(255,255,255,0.05)', flex: 1, minWidth: 280, maxWidth: '100%' }}>
              {CANALES.map(c => (
                <button
                  key={c.id}
                  onClick={() => setActiveTab(c.id)}
                  style={{
                    flex: 1,
                    display:'flex', alignItems:'center', justifyContent: 'center', gap:6,
                    background: activeTab === c.id ? 'rgba(0,230,118,0.1)' : 'transparent',
                    color:      activeTab === c.id ? '#00e676' : 'rgba(255,255,255,0.4)',
                    border:     activeTab === c.id ? '1px solid rgba(0,230,118,0.2)' : '1px solid transparent',
                    borderRadius:8, padding:'6px 8px',
                    fontSize:11, fontWeight:700, cursor:'pointer', transition:'all .2s ease',
                  }}
                  onMouseEnter={e => { if (activeTab !== c.id) e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
                  onMouseLeave={e => { if (activeTab !== c.id) e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize:15 }}>{c.icon}</span>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Segment pills */}
          <div style={{ display:'flex', gap:8 }}>
            {SEGMENTS.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSeg(s.id)}
                style={{
                  flex:1,
                  background: activeSeg === s.id ? `linear-gradient(135deg, ${s.color}25 0%, ${s.color}08 100%)` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${activeSeg === s.id ? `${s.color}50` : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 10, padding: '8px 0',
                  fontSize:11, fontWeight:700, letterSpacing: 0.5,
                  color: activeSeg === s.id ? s.color : 'rgba(255,255,255,0.4)',
                  cursor:'pointer', transition:'all .2s ease',
                  boxShadow: activeSeg === s.id ? `0 4px 12px ${s.color}15` : 'none',
                }}
                onMouseEnter={e => { if (activeSeg !== s.id) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={e => { if (activeSeg !== s.id) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
              >{s.label}</button>
            ))}
          </div>

          {/* Top-5 list */}
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {top5.length > 0 && top5.some(d => d.score > 0) ? top5.map((entry, listIdx) => {
              const rank     = full.indexOf(entry) + 1;
              const isMe     = entry.isMe;
              const pct      = topScore > 0 ? Math.round((entry.score / topScore) * 100) : 0;
              const isLeader = rank === 1;

              return (
                <div
                  key={entry.id}
                  style={{
                    display:'grid',
                    gridTemplateColumns:'36px 1fr 60px',
                    alignItems:'center',
                    gap:12,
                    background: isMe ? 'linear-gradient(90deg, rgba(0,230,118,0.08) 0%, rgba(0,230,118,0.02) 100%)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isMe ? 'rgba(0,230,118,0.25)' : 'rgba(255,255,255,0.04)'}`,
                    borderRadius: 12, padding:'12px 14px',
                    transition:'background .2s',
                  }}
                >
                  {/* Badge */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: rank <= 3 ? 'rgba(255,255,255,0.05)' : 'transparent', fontSize: rank <= 3 ? 18 : 12, fontWeight:800, color: isMe ? '#00e676' : 'rgba(255,255,255,0.3)' }}>
                    {rank <= 3 ? MEDAL[rank - 1] : `#${rank}`}
                  </div>

                  {/* Name + bar */}
                  <div>
                    <div style={{ fontSize:13, fontWeight: isMe ? 800 : 600, color: isMe ? '#00e676' : isLeader ? '#ffca28' : '#e2e8f0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:6 }}>
                      {entry.name}{isMe ? ' (Tú)' : ''}
                    </div>
                    <div style={{ height:4, background:'rgba(255,255,255,0.06)', borderRadius:6, overflow:'hidden' }}>
                      <div style={{ width:`${pct}%`, height:'100%', background: isMe ? 'var(--color-primary)' : segColor, borderRadius:6, transition:'width .8s cubic-bezier(0.34,1.56,0.64,1)', boxShadow: isMe ? '0 0 8px rgba(0,230,118,0.5)' : 'none' }} />
                    </div>
                    <div style={{ fontSize:10, opacity:0.4, marginTop:4, letterSpacing: 0.3 }}>{pct}% del líder</div>
                  </div>

                  {/* Score */}
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:17, fontWeight:800, color: isMe ? '#00e676' : isLeader ? '#ffca28' : '#fff', lineHeight:1 }}>{entry.score}</div>
                    <div style={{ fontSize:9, opacity:0.35, marginTop:2 }}>gest.</div>
                  </div>
                </div>
              );
            }) : (
              <div style={{ padding:20, textAlign:'center', opacity:0.3, fontSize:11 }}>Sin datos para hoy en este segmento</div>
            )}
          </div>

          {/* ── INSIGHT banner ── */}
          {myScore > 0 && (myScore < topScore || myScore < avgScore) && (
            <div style={{
              background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)',
              borderRadius:10, padding:'10px 12px', display:'flex', flexDirection:'column', gap:6, marginTop:2,
            }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#fbbf24', display:'flex', alignItems:'center', gap:5 }}>
                <span className="material-symbols-outlined" style={{ fontSize:14 }}>insights</span>
                ¿Por qué estás más abajo?
              </div>

              {myScore < topScore && (
                <div style={{ fontSize:11, color:'rgba(255,255,255,0.7)', lineHeight:1.6 }}>
                  📍 Posición <strong style={{ color:'#fbbf24' }}>#{myRank}</strong> · Al líder le faltan{' '}
                  <strong style={{ color:'#f87171' }}>−{gap} gestión{gap !== 1 ? 'es' : ''}</strong> ({gapPct}% menos).{' '}
                  Con <strong style={{ color:'#69f0ae' }}>{gap} más</strong> lo alcanzas.
                </div>
              )}

              {myScore < avgScore && (
                <div style={{ fontSize:11, color:'rgba(255,255,255,0.55)', lineHeight:1.6 }}>
                  📊 Promedio del equipo: <strong style={{ color:'#fbbf24' }}>{avgScore.toFixed(1)}</strong> · Tu puntaje: <strong style={{ color:'#f87171' }}>{myScore}</strong>.{' '}
                  Necesitas <strong style={{ color:'#69f0ae' }}>{Math.ceil(avgScore - myScore)} más</strong> para nivelarte.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══ ROW 3 — FULL RANKING TABLE ══ */}
      <div style={S.card}>
        <div style={S.sectionTitle}>
          <span className="material-symbols-outlined" style={{ fontSize:14 }}>list_alt</span>
          Ranking Completo del Equipo
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
            <thead>
              <tr>
                {['#', 'Asesor', 'Seg 0', 'Seg 1', 'Seg 2', 'Global'].map((h, i) => (
                  <th key={h} style={{ padding:'7px 10px', textAlign: i < 2 ? 'left' : 'center', opacity:0.4, fontWeight:700, borderBottom:'1px solid rgba(255,255,255,0.07)', whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rankingGeneral]
                .sort((a, b) => (b.canales?.[activeTab]?.global || 0) - (a.canales?.[activeTab]?.global || 0))
                .map((r, i) => {
                  const isMe  = r.id === usuario.id;
                  const stats = r.canales?.[activeTab] || {};
                  return (
                    <tr key={r.id} style={{
                      background: isMe ? 'rgba(0,230,118,0.06)' : 'transparent',
                      borderBottom:'1px solid rgba(255,255,255,0.04)',
                    }}>
                      <td style={{ padding:'8px 10px', fontWeight:700, color: isMe ? '#00e676' : 'rgba(255,255,255,0.5)' }}>
                        {i < 3 ? MEDAL[i] : `${i+1}`}
                      </td>
                      <td style={{ padding:'8px 10px', fontWeight: isMe ? 800 : 500, color: isMe ? '#00e676' : '#e2e8f0' }}>
                        {r.nombre}{isMe ? ' (Tú)' : ''}
                      </td>
                      {['0','1','2','global'].map(seg => (
                        <td key={seg} style={{ padding:'8px 10px', textAlign:'center', fontWeight:600,
                          color: activeSeg === seg ? SEGMENTS.find(s=>s.id===seg)?.color : 'rgba(255,255,255,0.65)' }}>
                          {seg === 'global' ? (stats.global || 0) : (stats[seg] || 0)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              {rankingGeneral.length === 0 && (
                <tr><td colSpan={6} style={{ padding:18, textAlign:'center', opacity:0.35, fontSize:11 }}>No hay datos de ranking para hoy</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
