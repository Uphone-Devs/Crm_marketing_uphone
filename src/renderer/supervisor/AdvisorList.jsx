import React from 'react';
import './AdvisorList.css';

/**
 * AdvisorList — Lista de asesores con estado en tiempo real.
 * Diseño basado en mockup #3 del Desing.md (Supervisor Monitoring).
 */

const ESTADOS_INFO = {
  1: { nombre: 'En Gestión',     icon: 'phone_in_talk', cssClass: 'active' },
  2: { nombre: 'Almuerzo',       icon: 'restaurant',    cssClass: 'data' },
  3: { nombre: 'Pausa',          icon: 'coffee',        cssClass: 'break' },
  4: { nombre: 'Capacitación',   icon: 'school',        cssClass: 'training' },
  5: { nombre: 'Reunión',        icon: 'groups',        cssClass: 'meeting' },
  6: { nombre: 'Desconectado',   icon: 'power_off',     cssClass: 'offline' },
};

function formatTimer(seg) {
  const h = Math.floor(seg / 3600).toString().padStart(2, '0');
  const m = Math.floor((seg % 3600) / 60).toString().padStart(2, '0');
  const s = (seg % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatHora(seg) {
  if (!seg) return '0m';
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function AdvisorCard({ asesor, estadoWS, metricas, tiempoEnEstado, configMarcacion, onChangeMarcacion, modoGlobal, intentosGlobal, progresoFiltrado, hayFiltroProgreso, onForceOffline }) {
  const estadoId = estadoWS?.estado_id || 6;
  const estado = ESTADOS_INFO[estadoId] || ESTADOS_INFO[6];
  const isOnline = !!estadoWS;
  const pausaAlerta = estadoId === 3 && tiempoEnEstado > 600;

  return (
    <div className={`adv-card ${pausaAlerta ? 'adv-card--alert' : ''}`} style={{ position: 'relative' }}>
      {/* Botón "Desconectar" (forzar desconexión) removido — entorpecía la gestión.
          La plomería WS FORCE_OFFLINE se conserva por si se reactiva en el futuro. */}
      <div className="adv-card__left">
        {/* Avatar */}
        <div className={`adv-card__avatar adv-card__avatar--${estado.cssClass}`}>
          {asesor.nombre.charAt(0).toUpperCase()}
          <span className={`adv-card__indicator ${isOnline ? 'adv-card__indicator--online' : 'adv-card__indicator--offline'}`} />
        </div>

        {/* Info */}
        <div className="adv-card__info">
          <span className="adv-card__name">{asesor.nombre}</span>
          <div className="adv-card__status-row">
            <span className={`adv-card__status-badge adv-card__status-badge--${estado.cssClass}`}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{estado.icon}</span>
              {estado.nombre}
            </span>
            <span className="adv-card__timer">{formatTimer(tiempoEnEstado)}</span>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="adv-card__metrics">
        <div className="adv-card__metric">
          <span className="adv-card__metric-value">{metricas?.total_marcaciones ?? 0}</span>
          <span className="adv-card__metric-label">Marcaciones</span>
        </div>
        <div className="adv-card__metric">
          <span className="adv-card__metric-value" style={{ color: hayFiltroProgreso ? '#64b5f6' : 'var(--color-secondary)' }}>
            {progresoFiltrado
              ? `${progresoFiltrado.gestionados ?? 0} / ${progresoFiltrado.total ?? 0}`
              : `${metricas?.progreso_campana?.gestionados ?? 0} / ${metricas?.progreso_campana?.total ?? 0}`}
          </span>
          <span className="adv-card__metric-label">
            {hayFiltroProgreso ? 'Progreso Filtrado' : 'Progreso Base'}
          </span>
        </div>
        <div className="adv-card__metric">
          <span className="adv-card__metric-value">{formatHora(metricas?.tiempo_al_aire)}</span>
          <span className="adv-card__metric-label">Al Aire</span>
        </div>
        <div className="adv-card__metric">
          <span className="adv-card__metric-value" style={{ color: 'var(--color-danger)' }}>{formatHora(metricas?.tiempo_muerto)}</span>
          <span className="adv-card__metric-label">Tiempo Impr.</span>
        </div>
        <div className="adv-card__metric">
          <span className={`adv-card__metric-value adv-card__metric-value--productivity ${
            (metricas?.ratio_productividad ?? 0) >= 70 ? 'high' :
            (metricas?.ratio_productividad ?? 0) >= 40 ? 'mid' : 'low'
          }`}>
            {metricas?.ratio_productividad ?? 0}%
          </span>
          <span className="adv-card__metric-label">Productividad</span>
        </div>
      </div>

      {/* Marcación individual: solo editable si modo global = PERSONALIZADO */}
      <div className="adv-card__actions" style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 130 }}>
        {(() => {
          const personalizable = modoGlobal === 'PERSONALIZADO';
          const modoAsignado = configMarcacion?.modo || null;
          const intentosAsignado = configMarcacion?.intentos ?? null;
          // En modo PERSONALIZADO usa override (o default MANUAL/1 si no hay). En otros modos muestra el global.
          const modoMostrado = personalizable
            ? (modoAsignado || 'MANUAL')
            : (modoGlobal || 'MANUAL');
          const intentosMostrados = personalizable
            ? (intentosAsignado != null ? intentosAsignado : 1)
            : (intentosGlobal ?? 1);
          const opacidad = personalizable ? 1 : 0.45;
          return (
            <>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', opacity: opacidad }}>
                <select
                  value={modoMostrado === 'PERSONALIZADO' ? 'MANUAL' : modoMostrado}
                  disabled={!personalizable}
                  onChange={(e) => onChangeMarcacion(asesor.id, { modo: e.target.value, intentos: intentosMostrados })}
                  title={personalizable ? 'Modo de marcación de este asesor' : 'Activá modo global PERSONALIZADO para editar'}
                  style={{
                    flex: 1, padding: '3px 6px', fontSize: 10, fontWeight: 700,
                    background: modoMostrado === 'AUTOMATICA' ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.05)',
                    color: modoMostrado === 'AUTOMATICA' ? 'var(--color-primary)' : 'inherit',
                    border: '1px solid ' + (modoMostrado === 'AUTOMATICA' ? 'rgba(0,230,118,0.3)' : 'rgba(255,255,255,0.1)'),
                    borderRadius: 6, outline: 'none', cursor: personalizable ? 'pointer' : 'not-allowed',
                  }}
                >
                  <option value="MANUAL">MANUAL</option>
                  <option value="AUTOMATICA">AUTOMÁTICA</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', opacity: opacidad }}>
                <span style={{ fontSize: 9, opacity: 0.5, fontWeight: 600 }}>Intentos:</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={intentosMostrados}
                  disabled={!personalizable}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                    onChangeMarcacion(asesor.id, { modo: modoMostrado === 'PERSONALIZADO' ? 'MANUAL' : modoMostrado, intentos: v });
                  }}
                  title={personalizable ? 'Intentos máximos para este asesor' : 'Activá modo global PERSONALIZADO para editar'}
                  style={{
                    width: 42, padding: '3px 4px', fontSize: 10, fontWeight: 700, textAlign: 'center',
                    background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, color: 'inherit', outline: 'none',
                    cursor: personalizable ? 'text' : 'not-allowed',
                  }}
                />
              </div>
              <span style={{ fontSize: 8, opacity: 0.5, fontStyle: 'italic', textAlign: 'center' }}>
                {personalizable
                  ? (modoAsignado ? 'config personalizada' : 'sin override · default MANUAL')
                  : `siguiendo modo global · ${modoGlobal}`}
              </span>
            </>
          );
        })()}
      </div>
    </div>
  );
}

export default function AdvisorList({
  asesores,
  estadosWS,
  metricas,
  tiemposEstado,
  filtro,
  onFiltroChange,
  busqueda,
  onBusquedaChange,
  configsMarcacion = {},
  onChangeMarcacion,
  onForceOffline,
  modoGlobal,
  intentosGlobal,
  progresosFiltrados = {},
  hayFiltroProgreso = false,
}) {
  const asesoresFiltrados = asesores.filter(a => {
    // Filtro por estado
    if (filtro === 'ACTIVOS' && !estadosWS[a.id]) return false;
    if (filtro === 'INACTIVOS' && estadosWS[a.id]) return false;

    // Filtro por búsqueda
    if (busqueda && !a.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false;

    return true;
  });

  return (
    <div className="adv-list">
      {/* Toolbar */}
      <div className="adv-list__toolbar">
        <div className="adv-list__search">
          <span className="material-symbols-outlined adv-list__search-icon">search</span>
          <input
            className="adv-list__search-input"
            type="text"
            placeholder="Buscar asesor..."
            value={busqueda}
            onChange={e => onBusquedaChange(e.target.value)}
          />
        </div>

        <div className="adv-list__filters">
          {['TODOS', 'ACTIVOS', 'INACTIVOS'].map(f => (
            <button
              key={f}
              className={`adv-list__filter-btn ${filtro === f ? 'adv-list__filter-btn--active' : ''}`}
              onClick={() => onFiltroChange(f)}
            >
              {f}
            </button>
          ))}
          <span className="adv-list__count">{asesoresFiltrados.length} asesor(es)</span>
        </div>
      </div>

      {/* List */}
      <div className="adv-list__items">
        {asesoresFiltrados.map(a => (
          <AdvisorCard
            key={a.id}
            asesor={a}
            estadoWS={estadosWS[a.id]}
            metricas={metricas[a.id]}
            tiempoEnEstado={tiemposEstado[a.id] || 0}
            configMarcacion={configsMarcacion[a.id]}
            onChangeMarcacion={onChangeMarcacion}
            modoGlobal={modoGlobal}
            intentosGlobal={intentosGlobal}
            progresoFiltrado={progresosFiltrados[a.id]}
            hayFiltroProgreso={hayFiltroProgreso}
            onForceOffline={onForceOffline}
          />
        ))}

        {asesoresFiltrados.length === 0 && (
          <div className="adv-list__empty">
            <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: 0.2 }}>
              person_off
            </span>
            <p>No hay asesores {filtro === 'ACTIVOS' ? 'conectados' : filtro === 'INACTIVOS' ? 'desconectados' : ''}</p>
          </div>
        )}
      </div>
    </div>
  );
}
