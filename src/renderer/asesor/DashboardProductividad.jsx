import React, { useState, useEffect, useMemo } from 'react';

// Cache de módulo: persiste entre desmontajes al cambiar de tab
const _cache = { metricas: null, rankingGeneral: [], metasCampanas: [], indicadoresGlob: null, metasSegmentos: null };
// Circuit breaker: endpoints que devolvieron 404 se desactivan hasta recargar página
const _disabled = { metaDiaria: false, metasSegmentos: false };

const getSegmentoContacto = (c) => {
  try {
    const m = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {});
    const d = parseInt(m['DIAS IMPAGO'] || m['DIAS EN INPAGO'] || m['DIAS MORA'] || m['DIAS EN MORA'] || m['dias impago'] || m['dias mora'] || '0', 10);
    if (isNaN(d) || d <= 0) return '0';
    if (d === 1) return '1';
    return '2';
  } catch { return '0'; }
};

const MEDAL = ['🥇', '🥈', '🥉'];

const CANALES = [
  { id: 'whatsapp', label: 'WhatsApp', icon: 'chat' },
  { id: 'rcs',      label: 'RCS',      icon: 'sms' },
  { id: 'gmail',    label: 'Correos',  icon: 'mail' },
  { id: 'llamada',  label: 'Llamadas', icon: 'call' },
];

const SEGMENTS = [
  { id: '0',      label: 'S0', color: '#3b82f6' },
  { id: '1',      label: 'S1', color: '#8b5cf6' },
  { id: '2',      label: 'S2', color: '#06b6d4' },
  { id: 'global', label: 'Global', color: '#10b981' },
];

const fmt$ = (n, compact = false) => {
  if (!n && n !== 0) return '$0';
  const num = Number(n);
  if (compact && num >= 1000) return `$${(num / 1000).toFixed(1)}k`;
  return '$' + num.toLocaleString('es-EC', { maximumFractionDigits: 0 });
};

function KpiCard({ icon, label, value, sub, color = '#00e676', pct, warn }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${warn ? 'rgba(255,82,82,0.2)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 10, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.5, marginBottom: 2 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 13, color }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
      {pct !== undefined && (
        <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 99, marginTop: 3 }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .4s' }} />
        </div>
      )}
      {sub && <div style={{ fontSize: 11, opacity: 0.4, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

export default function DashboardProductividad({ usuario, callApi, tiempoProductivoSeg, tiempoImproductivoSeg, refreshTrigger, totalClientesCampana, campana, cartera = [] }) {
  const todayLabel = useMemo(() => new Date().toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }), []);
  // Inicializar desde cache para no perder datos al cambiar de tab
  const [metricas,        setMetricas]       = useState(_cache.metricas);
  const [rankingGeneral,  setRankingGeneral]  = useState(_cache.rankingGeneral);
  const [metasCampanas,   setMetasCampanas]   = useState(_cache.metasCampanas);
  const [indicadoresGlob, setIndicadoresGlob] = useState(_cache.indicadoresGlob);
  const [metasSegmentos,  setMetasSegmentos]  = useState(_cache.metasSegmentos);
  const [activeTab,       setActiveTab]       = useState('llamada');
  const [activeSeg,       setActiveSeg]       = useState('global');
  const [loading,         setLoading]         = useState(!_cache.metricas);

  const setAndCache = (key, setter) => (val) => { _cache[key] = val; setter(val); };

  const fetchAll = async () => {
    setLoading(true);
    const campanaId = campana?.id || null;
    await Promise.allSettled([
      callApi('db:getMetricasDia', usuario.id, null).then(m => m && setAndCache('metricas', setMetricas)(m)),
      callApi('db:getRankingGeneralAsesores', new Date().toISOString().slice(0, 10)).then(rg => rg && setAndCache('rankingGeneral', setRankingGeneral)(rg)),
      _disabled.metaDiaria ? Promise.resolve() : callApi('db:getMetaDiariaCampanas', campanaId).then(metas => metas && setAndCache('metasCampanas', setMetasCampanas)(Array.isArray(metas) ? metas : [metas])).catch(err => { if (String(err).includes('404')) _disabled.metaDiaria = true; }),
      callApi('db:getIndicadoresCobranza', campanaId ? { campana_id: campanaId } : {}).then(ind => ind && setAndCache('indicadoresGlob', setIndicadoresGlob)(ind)).catch(() => {}),
      (!_disabled.metasSegmentos && campanaId)
        ? callApi('db:getMetasSegmentos', campanaId).then(ms => ms && setAndCache('metasSegmentos', setMetasSegmentos)(ms)).catch(err => { if (String(err).includes('404')) _disabled.metasSegmentos = true; })
        : Promise.resolve(),
    ]);
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 60000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.id, campana?.id]);

  useEffect(() => { if (refreshTrigger > 0) fetchAll(); }, [refreshTrigger]);

  /* ── KPIs derivados ── */
  const tiempoAire   = tiempoProductivoSeg   !== undefined ? Math.floor(tiempoProductivoSeg / 60)   : Math.floor((metricas?.tiempo_al_aire || 0) / 60);
  const tiempoMuerto = tiempoImproductivoSeg !== undefined ? Math.floor(tiempoImproductivoSeg / 60) : Math.floor((metricas?.tiempo_muerto || 0) / 60);
  const totalMin     = tiempoAire + tiempoMuerto || 1;
  const pctProductivo = Math.round((tiempoAire / totalMin) * 100);
  const efectividad   = metricas?.total_marcaciones > 0
    ? Math.round(((metricas?.contactos_efectivos || 0) / metricas.total_marcaciones) * 100) : 0;
  const monto = metricas?.monto_comprometido || 0;

  /* ── Meta diaria campaña ── */
  const metaCampana   = useMemo(() => {
    if (!campana?.id || !metasCampanas.length) return null;
    return metasCampanas.find(m => m.id === campana.id) || null;
  }, [campana?.id, metasCampanas]);
  const metaDiaria    = metaCampana?.meta_diaria   || 0;
  const cobradoHoy    = metaCampana?.cobrado_hoy   || 0;
  const pctMeta       = metaDiaria > 0 ? Math.min(Math.round((cobradoHoy / metaDiaria) * 100), 100) : 0;

  /* ── Recuperación y vencimientos cartera (reactivos al array cartera) ── */
  const esPagadoC       = (c) => c.validado_pago === 1 || c.ya_pago === 1;
  const totalCarteraVal = useMemo(() => cartera.reduce((s, c) => s + (Number(c.monto_deuda) || 0), 0), [cartera]);
  const recuperadoVal   = useMemo(() => cartera.filter(c => c.validado_pago === 1).reduce((s, c) => s + (Number(c.monto_deuda) || 0), 0), [cartera]);
  const pctRecup        = totalCarteraVal > 0 ? Math.round((recuperadoVal / totalCarteraVal) * 100) : 0;
  const vencimientosVal = useMemo(() => cartera.filter(c => !esPagadoC(c)).reduce((s, c) => s + (Number(c.monto_deuda) || 0), 0), [cartera]);
  const vencimientosUnd = useMemo(() => cartera.filter(c => !esPagadoC(c)).length, [cartera]);

  /* ── Progreso asesor por segmento (reactivo al cartera array) ── */
  const segProgress = useMemo(() => {
    const acc = { '0': { monto: 0, und: 0, total: 0 }, '1': { monto: 0, und: 0, total: 0 }, '2': { monto: 0, und: 0, total: 0 }, global: { monto: 0, und: 0, total: 0 } };
    cartera.forEach(c => {
      const seg = getSegmentoContacto(c);
      const pagado = esPagadoC(c);
      const m = Number(c.monto_deuda) || 0;
      acc[seg].total++;
      acc.global.total++;
      if (pagado) { acc[seg].monto += m; acc[seg].und++; acc.global.monto += m; acc.global.und++; }
    });
    return acc;
  }, [cartera]);

  /* ── Ranking ── */
  const buildRankList = () => {
    const list = [...rankingGeneral].map(r => ({
      id: r.id, name: r.nombre,
      score: activeSeg === 'global' ? (r.canales?.[activeTab]?.global || 0) : (r.canales?.[activeTab]?.[activeSeg] || 0),
      isMe: r.id === usuario.id,
    })).sort((a, b) => b.score - a.score);
    const top5 = list.slice(0, 5);
    const me   = list.find(d => d.isMe);
    if (me && !top5.find(d => d.isMe)) top5.push(me);
    return { top5, full: list };
  };
  const { top5, full } = buildRankList();
  const myEntry  = full.find(d => d.isMe);
  const myRank   = myEntry ? full.indexOf(myEntry) + 1 : null;
  const myScore  = myEntry?.score || 0;
  const topScore = full[0]?.score || 1;
  const avgScore = full.length ? full.reduce((s, d) => s + d.score, 0) / full.length : 0;
  const gap      = Math.max(0, topScore - myScore);
  const segColor = SEGMENTS.find(s => s.id === activeSeg)?.color || '#10b981';

  const gestHoy       = metricas?.total_marcaciones || 0;
  const totalClientes = totalClientesCampana || 0;
  const pctAvance     = totalClientes > 0 ? Math.min(100, (gestHoy / totalClientes) * 100) : 0;
  const colorAvance   = pctAvance >= 80 ? '#00e676' : pctAvance >= 40 ? '#ffb74d' : '#3b82f6';

  if (loading && !metricas) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', gap: 10, opacity: 0.4 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 20 }}>sync</span>
      <span style={{ fontSize: 13 }}>Cargando…</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 8px 16px', overflowY: 'auto', height: '100%', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-primary)' }}>Panel de Productividad</div>
          <div style={{ fontSize: 11, opacity: 0.4, marginTop: 1 }}>{todayLabel}{campana ? ` · ${campana.nombre}` : ''}</div>
        </div>
        <button type="button" onClick={fetchAll} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 600 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>refresh</span>
          Actualizar
        </button>
      </div>

      {/* ── KPI ROW 1: Efectividad · Comprometido · Meta · Recuperación ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <KpiCard
          icon="track_changes" label="Efectividad" color={efectividad >= 60 ? '#00e676' : efectividad >= 40 ? '#ffb74d' : '#ff5252'}
          value={`${efectividad}%`} pct={efectividad}
          sub={`${metricas?.contactos_efectivos || 0} / ${metricas?.total_marcaciones || 0} contactos`}
        />
        <KpiCard
          icon="payments" label="Comprometido hoy" color="#00e676"
          value={fmt$(monto, true)}
          sub={`${metricas?.total_compromisos || 0} compromisos`}
        />
        <KpiCard
          icon="flag" label={`Meta diaria${campana ? '' : ' (sin campaña)'}`}
          color={pctMeta >= 100 ? '#00e676' : '#29b6f6'}
          value={metaDiaria > 0 ? fmt$(cobradoHoy, true) : '—'}
          pct={metaDiaria > 0 ? pctMeta : undefined}
          sub={metaDiaria > 0 ? `${pctMeta}% de ${fmt$(metaDiaria, true)}` : 'Sin meta configurada'}
        />
        <KpiCard
          icon="account_balance" label="Recuperación" color="#ce93d8"
          value={fmt$(recuperadoVal, true)}
          pct={pctRecup}
          sub={`${pctRecup}% de ${fmt$(totalCarteraVal, true)} cartera`}
        />
      </div>

      {/* ── KPI ROW 2: Tiempo · Vencimientos · Promesas · Avance campaña ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <KpiCard
          icon="timer" label="Tiempo productivo" color="#10b981"
          value={`${pctProductivo}%`} pct={pctProductivo}
          sub={`${tiempoAire}m productivo · ${tiempoMuerto}m muerto`}
        />
        <KpiCard
          icon="warning" label="Unidades vencidas" color="#ef5350" warn
          value={vencimientosUnd}
          sub={`de ${cartera.length} en cartera`}
        />
        <KpiCard
          icon="handshake" label="Promesas de pago" color="#8b5cf6"
          value={metricas?.promesas_pago ?? metricas?.total_compromisos ?? 0}
          sub={`${metricas?.total_compromisos || 0} compromisos totales`}
        />
        {totalClientes > 0 ? (
          <KpiCard
            icon="rocket_launch" label="Avance campaña" color={colorAvance}
            value={`${pctAvance.toFixed(0)}%`} pct={pctAvance}
            sub={`${gestHoy} / ${totalClientes.toLocaleString()} gestionados`}
          />
        ) : campana ? (
          <KpiCard icon="hourglass_empty" label="Avance campaña" color="rgba(255,255,255,0.25)" value="—" sub={`${campana.nombre} · cargando`} />
        ) : (
          <KpiCard icon="campaign" label="Avance campaña" color="rgba(255,255,255,0.15)" value="—" sub="Sin campaña asignada" />
        )}
      </div>

      {/* ── METAS POR SEGMENTO ── */}
      {campana && (() => {
        const SEG_COLORS = { '0': '#3b82f6', '1': '#8b5cf6', '2': '#06b6d4', global: '#10b981' };
        const SEG_LABELS = { '0': 'S0 · Días 0', '1': 'S1 · Día 1', '2': 'S2 · Día 2+', global: 'Global' };
        const segs = ['0', '1', '2', 'global'];
        const apiSegs = metasSegmentos?.segmentos || [];
        const apiMap = Object.fromEntries(apiSegs.map(s => [s.seg, s]));
        const hasMetas = apiSegs.some(s => s.meta_monto > 0 || s.meta_unidades > 0);
        return (
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#10b981' }}>flag</span>
              <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', opacity: 0.55 }}>Metas por segmento</span>
              {!hasMetas && <span style={{ fontSize: 10, opacity: 0.3, marginLeft: 4 }}>— sin metas configuradas</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {segs.map(seg => {
                const color = SEG_COLORS[seg];
                const label = SEG_LABELS[seg];
                const prog  = segProgress[seg];
                const api   = apiMap[seg] || {};
                const metaMonto = api.meta_monto || 0;
                const metaUnd   = api.meta_unidades || 0;
                const pctM = metaMonto   > 0 ? Math.min(100, Math.round(prog.monto / metaMonto   * 100)) : null;
                const pctU = metaUnd     > 0 ? Math.min(100, Math.round(prog.und   / metaUnd     * 100)) : null;
                return (
                  <div key={seg} style={{ background: `${color}0d`, border: `1px solid ${color}30`, borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                    <div style={{ fontSize: 10, opacity: 0.45 }}>{prog.total} contactos</div>

                    {/* Monto cobrado */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
                        <span style={{ opacity: 0.55 }}>Cobrado</span>
                        <span style={{ fontWeight: 700, color }}>{fmt$(prog.monto, true)}{metaMonto > 0 ? ` / ${fmt$(metaMonto, true)}` : ''}</span>
                      </div>
                      <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 99 }}>
                        <div style={{ width: `${pctM ?? (prog.monto > 0 ? 100 : 0)}%`, height: '100%', background: pctM !== null ? (pctM >= 100 ? '#00e676' : color) : `${color}55`, borderRadius: 99, transition: 'width .5s' }} />
                      </div>
                      {pctM !== null && <div style={{ fontSize: 10, color: pctM >= 100 ? '#00e676' : color, fontWeight: 700, marginTop: 2 }}>{pctM}%</div>}
                    </div>

                    {/* Unidades */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
                        <span style={{ opacity: 0.55 }}>Pagados</span>
                        <span style={{ fontWeight: 700, color }}>{prog.und}{metaUnd > 0 ? ` / ${metaUnd}` : ''}</span>
                      </div>
                      <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 99 }}>
                        <div style={{ width: `${pctU ?? (prog.und > 0 ? 100 : 0)}%`, height: '100%', background: pctU !== null ? (pctU >= 100 ? '#00e676' : color) : `${color}55`, borderRadius: 99, transition: 'width .5s' }} />
                      </div>
                      {pctU !== null && <div style={{ fontSize: 10, color: pctU >= 100 ? '#00e676' : color, fontWeight: 700, marginTop: 2 }}>{pctU}%</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── GESTIONES + RANKING ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10 }}>

        {/* Gestiones mini bars */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.45, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Gestiones del día</div>
          {[
            { label: 'Gestiones',    v: metricas?.total_marcaciones   || 0, c: '#10b981' },
            { label: 'Contactos',    v: metricas?.contactos_efectivos || 0, c: '#3b82f6' },
            { label: 'Promesas',     v: metricas?.promesas_pago       || 0, c: '#8b5cf6' },
            { label: 'Compromisos',  v: metricas?.total_compromisos   || 0, c: '#f59e0b' },
          ].map(item => {
            const max = Math.max(metricas?.total_marcaciones || 1, 1);
            const pct = Math.min(Math.round((item.v / max) * 100), 100);
            return (
              <div key={item.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                  <span style={{ opacity: 0.6 }}>{item.label}</span>
                  <span style={{ fontWeight: 700, color: item.c }}>{item.v}</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 99 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: item.c, borderRadius: 99, transition: 'width .5s' }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Ranking */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Filtros compactos */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.45, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Ranking</span>
            <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
              {CANALES.map(c => (
                <button type="button" key={c.id} onClick={() => setActiveTab(c.id)}
                  style={{ padding: '3px 8px', borderRadius: 6, border: `1px solid ${activeTab === c.id ? 'rgba(0,230,118,0.4)' : 'rgba(255,255,255,0.08)'}`, background: activeTab === c.id ? 'rgba(0,230,118,0.1)' : 'transparent', color: activeTab === c.id ? '#00e676' : 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  {c.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
              {SEGMENTS.map(s => (
                <button type="button" key={s.id} onClick={() => setActiveSeg(s.id)}
                  style={{ padding: '3px 8px', borderRadius: 6, border: `1px solid ${activeSeg === s.id ? s.color + '60' : 'rgba(255,255,255,0.08)'}`, background: activeSeg === s.id ? s.color + '18' : 'transparent', color: activeSeg === s.id ? s.color : 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lista top5 compacta */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {top5.length > 0 && top5.some(d => d.score > 0) ? top5.map(entry => {
              const rank  = full.indexOf(entry) + 1;
              const isMe  = entry.isMe;
              const pct   = topScore > 0 ? Math.round((entry.score / topScore) * 100) : 0;
              return (
                <div key={entry.id} style={{
                  display: 'grid', gridTemplateColumns: '24px 1fr 40px', alignItems: 'center', gap: 8,
                  background: isMe ? 'rgba(0,230,118,0.07)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${isMe ? 'rgba(0,230,118,0.2)' : 'rgba(255,255,255,0.04)'}`,
                  borderRadius: 8, padding: '7px 10px',
                }}>
                  <div style={{ fontSize: rank <= 3 ? 14 : 11, fontWeight: 800, textAlign: 'center', color: isMe ? '#00e676' : 'rgba(255,255,255,0.3)' }}>
                    {rank <= 3 ? MEDAL[rank - 1] : `#${rank}`}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: isMe ? 800 : 600, color: isMe ? '#00e676' : '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                      {entry.name}{isMe ? ' (Tú)' : ''}
                    </div>
                    <div style={{ height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 99 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: isMe ? '#00e676' : segColor, borderRadius: 99 }} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 14, fontWeight: 800, color: isMe ? '#00e676' : '#fff' }}>{entry.score}</div>
                </div>
              );
            }) : (
              <div style={{ textAlign: 'center', opacity: 0.3, fontSize: 12, padding: '12px 0' }}>Sin datos para hoy</div>
            )}
          </div>

          {/* Insight gap */}
          {myScore > 0 && gap > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>
              📍 Posición <strong style={{ color: '#fbbf24' }}>#{myRank}</strong> · Faltan <strong style={{ color: '#f87171' }}>{gap}</strong> gestión{gap !== 1 ? 'es' : ''} para liderar · Promedio equipo: <strong style={{ color: '#fbbf24' }}>{avgScore.toFixed(0)}</strong>
            </div>
          )}
        </div>
      </div>

      {/* ── TABLA RANKING COMPLETA (colapsada por defecto) ── */}
      <details style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0' }}>
        <summary style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.07em', cursor: 'pointer', userSelect: 'none', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 13 }}>list_alt</span>
          Ranking completo del equipo
        </summary>
        <div style={{ padding: '0 14px 12px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                {['#', 'Asesor', 'S0', 'S1', 'S2', 'Global'].map((h, i) => (
                  <th key={h} style={{ padding: '6px 8px', textAlign: i < 2 ? 'left' : 'center', opacity: 0.4, fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rankingGeneral].sort((a, b) => (b.canales?.[activeTab]?.global || 0) - (a.canales?.[activeTab]?.global || 0)).map((r, i) => {
                const isMe = r.id === usuario.id;
                const stats = r.canales?.[activeTab] || {};
                return (
                  <tr key={r.id} style={{ background: isMe ? 'rgba(0,230,118,0.05)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 700, color: isMe ? '#00e676' : 'rgba(255,255,255,0.4)', fontSize: 12 }}>{i < 3 ? MEDAL[i] : i + 1}</td>
                    <td style={{ padding: '6px 8px', fontWeight: isMe ? 800 : 500, color: isMe ? '#00e676' : '#e2e8f0' }}>{r.nombre}{isMe ? ' ✓' : ''}</td>
                    {['0', '1', '2', 'global'].map(seg => (
                      <td key={seg} style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: activeSeg === seg ? SEGMENTS.find(s => s.id === seg)?.color : 'rgba(255,255,255,0.55)' }}>
                        {seg === 'global' ? (stats.global || 0) : (stats[seg] || 0)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!rankingGeneral.length && <tr><td colSpan={6} style={{ padding: 14, textAlign: 'center', opacity: 0.3, fontSize: 11 }}>Sin datos hoy</td></tr>}
            </tbody>
          </table>
        </div>
      </details>

    </div>
  );
}
