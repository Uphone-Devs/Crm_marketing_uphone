import React from 'react';
import './MetricsOverview.css';

const fmt$ = (n) => {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

function formatTiempo(totalSeg) {
  if (!totalSeg) return '0h 0m';
  const h = Math.floor(totalSeg / 3600);
  const m = Math.floor((totalSeg % 3600) / 60);
  return `${h}h ${m}m`;
}

function MetricsOverview({ metricas, validacion, onCardClick, onNavigate }) {
  if (!metricas) return null;

  const cards = [
    {
      icon: 'group',
      label: 'Asesores Activos',
      value: metricas.totalConectados ?? 0,
      color: 'primary',
    },
    {
      icon: 'phone_in_talk',
      label: 'Marcaciones',
      value: (metricas.marcacionesTotales ?? 0).toLocaleString(),
      color: 'primary',
    },
    {
      icon: 'schedule',
      label: 'Tiempo al Aire',
      value: formatTiempo(metricas.tiempoAlAireSeg),
      color: 'secondary',
    },
    {
      icon: 'handshake',
      label: 'Suma Comprometida',
      value: fmt$(metricas.montoPrometidoTotal ?? 0),
      sub: (metricas.promesasPagoTotal ?? 0) > 0
        ? `${metricas.promesasPagoTotal} compromisos activos`
        : null,
      color: 'secondary',
      highlight: true,
      navKey: 'compromisos',
    },
    {
      icon: 'payments',
      label: 'Ya Recaudado',
      value: fmt$(metricas.montoRecaudadoTotal ?? 0),
      sub: metricas.tasaRecuperacion > 0
        ? `${metricas.tasaRecuperacion}% vs mora base`
        : (metricas.pagosRecaudadosTotal ?? 0) > 0
          ? `${metricas.pagosRecaudadosTotal} pagos confirmados`
          : null,
      color: 'danger',
      highlight: true,
      detalleKey: 'RECAUDADO',
    },
  ];

  const validacionCards = validacion ? [
    {
      icon: 'verified',
      label: 'Contratos Saldados',
      value: (validacion.contratosSaldados ?? 0).toLocaleString(),
      sub: validacion.montoValidado > 0
        ? `${fmt$(validacion.montoValidado)} validado`
        : 'Sin pagos confirmados aún',
      color: 'primary',
      highlight: true,
    },
    {
      icon: 'account_balance',
      label: 'Tasa Recuperación',
      value: `${validacion.tasaRecuperacion ?? 0}%`,
      sub: validacion.moraBase > 0
        ? `${fmt$(validacion.montoValidado)} de ${fmt$(validacion.moraBase)}`
        : null,
      color: 'tertiary',
      highlight: false,
    },
    ...(validacion.excedentesCount > 0 ? [{
      icon: 'warning',
      label: 'Excedentes Detectados',
      value: (validacion.excedentesCount).toLocaleString(),
      sub: `${fmt$(validacion.montoExcedente)} excedente · revisar`,
      color: 'warning',
      highlight: false,
    }] : []),
  ] : [];

  return (
    <>
      <div className="metrics-overview">
        {cards.map((card) => {
          const clickable = !!(card.detalleKey && onCardClick) || !!(card.navKey && onNavigate);
          const handleClick = clickable
            ? () => card.navKey ? onNavigate(card.navKey) : onCardClick(card.detalleKey)
            : undefined;
          const navIcon = card.navKey ? 'arrow_forward' : 'open_in_new';
          return (
            <div
              key={card.label}
              className={`mo-card mo-card--${card.color}${card.highlight ? ' mo-card--highlight' : ''}`}
              onClick={handleClick}
              style={clickable ? { cursor: 'pointer', position: 'relative' } : undefined}
              title={clickable ? 'Click para ver detalle' : undefined}
            >
              <div className="mo-card__header">
                <span className={`material-symbols-outlined mo-card__icon mo-card__icon--${card.color}`}>
                  {card.icon}
                </span>
                <span className="mo-card__label">{card.label}</span>
                {clickable && (
                  <span className="material-symbols-outlined" style={{
                    position: 'absolute', top: 8, right: 8, fontSize: 14, opacity: 0.35,
                  }}>{navIcon}</span>
                )}
              </div>
              <div className="mo-card__value">{card.value}</div>
              {card.sub && <div className="mo-card__sub">{card.sub}</div>}
            </div>
          );
        })}
      </div>

      {validacionCards.length > 0 && (
        <>
          <div style={{ margin: '16px 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--color-primary)', opacity: 0.7 }}>verified</span>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', opacity: 0.5 }}>Recuperación de Cartera (Validado)</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
          </div>
          <div className="metrics-overview">
            {validacionCards.map((card) => (
              <div key={card.label} className={`mo-card mo-card--${card.color}${card.highlight ? ' mo-card--highlight' : ''}`}>
                <div className="mo-card__header">
                  <span className={`material-symbols-outlined mo-card__icon mo-card__icon--${card.color}`}>
                    {card.icon}
                  </span>
                  <span className="mo-card__label">{card.label}</span>
                </div>
                <div className="mo-card__value">{card.value}</div>
                {card.sub && <div className="mo-card__sub">{card.sub}</div>}
              </div>
            ))}
            {validacion?.porEmpresa?.length > 0 && (
              <div className="mo-card mo-card--secondary" style={{ gridColumn: 'span 2' }}>
                <div className="mo-card__header">
                  <span className="material-symbols-outlined mo-card__icon mo-card__icon--secondary">corporate_fare</span>
                  <span className="mo-card__label">Por Empresa</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {validacion.porEmpresa.map((e, i) => {
                    const pct = validacion.montoValidado > 0 ? Math.round((e.monto / validacion.montoValidado) * 100) : 0;
                    return (
                      <div key={e.empresa || i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, minWidth: 90, opacity: 0.85 }}>
                          {e.empresa || 'Sin empresa'}
                        </span>
                        <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 2 }} />
                        </div>
                        <span className="text-mono" style={{ fontSize: 12, fontWeight: 700, opacity: 0.85, minWidth: 110, textAlign: 'right', color: 'var(--color-primary)' }}>
                          ${Number(e.monto || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span style={{ fontSize: 12, opacity: 0.4, minWidth: 28 }}>{e.total}ct</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default React.memo(MetricsOverview);
