import React from 'react';
import Logo from './Logo';
import './TopAppBar.css';

function formatTimer(seg) {
  const h = Math.floor(seg / 3600).toString().padStart(2, '0');
  const m = Math.floor((seg % 3600) / 60).toString().padStart(2, '0');
  const s = (seg % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function StatBox({ icon, total, detalle, color }) {
  const d = detalle || [0, 0, 0];
  const s0 = Array.isArray(d) ? (d[0] || 0) : (d[0] || 0);
  const s1 = Array.isArray(d) ? (d[1] || 0) : (d[1] || 0);
  const s2 = Array.isArray(d) ? (d[2] || 0) : (d[2] || 0);
  return (
    <div className="asesor-stat-box">
      <div className="asesor-stat-box__total">
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: color || 'var(--color-primary)' }}>{icon}</span>
        <span className="asesor-stat-box__count" style={{ color: total > 0 ? (color || 'var(--color-primary)') : undefined }}>{total}</span>
      </div>
      <div className="asesor-stat-box__detail">
        <span>S0: <b>{s0}</b></span>
        <span className="asesor-stat-box__sep">|</span>
        <span>S1: <b>{s1}</b></span>
        <span className="asesor-stat-box__sep">|</span>
        <span>S2: <b>{s2}</b></span>
      </div>
    </div>
  );
}

export default function TopAppBar({
  userName,
  userRole,
  isConnected,
  tabs,
  activeTab,
  onTabChange,
  actions,
  onLogout,
  hideConnection,
  hideUserInfo,
  leftContent,
  asesorStats,
}) {
  if (asesorStats) {
    return (
      <header className="top-app-bar top-app-bar--asesor">
        <Logo width="100px" className="top-app-bar__logo" style={{ marginRight: 24 }} />

        {/* Timers */}
        <div className="asesor-timers">
          <div className="asesor-timer">
            <span className="asesor-timer__label">PRODUCTIVO</span>
            <span className="asesor-timer__value asesor-timer__value--prod">
              {formatTimer(asesorStats.tiempoProductivo || 0)}
            </span>
          </div>
          <div className="asesor-timer">
            <span className="asesor-timer__label">IMPRODUCTIVO</span>
            <span className="asesor-timer__value">
              {formatTimer(asesorStats.tiempoImproductivo || 0)}
            </span>
          </div>
        </div>

        {/* Channel Stats */}
        <div className="asesor-stats-channels">
          <StatBox icon="call" total={asesorStats.marcaciones || 0} detalle={asesorStats.marcacionesDetalle} color="#4caf50" />
          <StatBox icon="chat" total={asesorStats.wspEnviados || 0} detalle={asesorStats.wspDetalle} color="#00bcd4" />
          <StatBox icon="sms" total={asesorStats.smsEnviados || 0} detalle={asesorStats.smsDetalle} color="#ff9800" />
          <StatBox icon="mail" total={asesorStats.correosEnviados || 0} detalle={asesorStats.emailDetalle} color="#9c27b0" />
        </div>

        {/* Gestiones / Compromisos */}
        <div className="asesor-stats-totals">
          <div className="asesor-stat-pill" style={{ justifyContent: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span className="asesor-stat-pill__label">GESTIONES</span>
              <span className="asesor-stat-pill__value" style={{ color: '#00bcd4' }}>{asesorStats.totalGestiones || 0}</span>
            </div>
          </div>
          <div className="asesor-stat-pill" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingRight: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span className="asesor-stat-pill__label">COMPROMISOS</span>
              <span className="asesor-stat-pill__value asesor-stat-pill__value--comp" style={{ color: '#00e676' }}>{asesorStats.totalCompromisos || 0}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#00e676' }}>check_circle</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#00e676' }}>{asesorStats.compromisosCumplidos || 0}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#2196f3' }}>event_repeat</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#2196f3' }}>{asesorStats.compromisosReagendados || 0}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#ff9800' }}>cancel</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#ff9800' }}>{asesorStats.compromisosIncumplidos || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: connection + status */}
        <div className="top-app-bar__right" style={{ marginLeft: 'auto', gap: 12 }}>
          <div className={`dot ${isConnected ? 'dot-primary dot-pulse' : 'dot-error'}`} style={{ width: 8, height: 8 }} />
          <span style={{ fontSize: 10, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {isConnected ? 'Conectado' : 'Sin conexión'}
          </span>
        </div>
      </header>
    );
  }

  return (
    <header className="top-app-bar">
      <div className="top-app-bar__left" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <Logo width="120px" className="top-app-bar__logo" style={{ cursor: 'pointer' }} />
        {leftContent}
      </div>

      {tabs && tabs.length > 0 && (
        <nav className="top-app-bar__tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`top-app-bar__tab ${activeTab === tab.id ? 'top-app-bar__tab--active' : ''}`}
              onClick={() => onTabChange?.(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      <div className="top-app-bar__right">
        {actions}

        {!hideConnection && (
          <div className="top-app-bar__status">
            <div className={`dot ${isConnected ? 'dot-primary dot-pulse' : 'dot-error'}`} />
            <span className="top-app-bar__status-text">
              {isConnected ? 'Conectado' : 'Desconectado'}
            </span>
          </div>
        )}

        {!hideUserInfo && (
          <div className="top-app-bar__user">
            <div className="top-app-bar__user-info">
              <span className="top-app-bar__user-name">{userName}</span>
              <span className="top-app-bar__user-role" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{userRole}</span>
            </div>
            <div className="top-app-bar__avatar">
              <span className="material-symbols-outlined">person</span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
