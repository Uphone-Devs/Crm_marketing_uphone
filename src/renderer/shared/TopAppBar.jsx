import React from 'react';
import Logo from './Logo';
import './TopAppBar.css';

/**
 * TopAppBar — Header fijo con branding, tabs de navegación, y zona de acciones.
 * UI "tonta": solo renderiza datos recibidos por props.
 *
 * @param {string}   userName    - Nombre del usuario logueado
 * @param {string}   userRole    - Rol textual ("Supervisor Administrador", "Asesor")
 * @param {boolean}  isConnected - Estado de conexión al servidor
 * @param {object[]} [tabs]      - Array de tabs {id, label} para la barra superior
 * @param {string}   [activeTab] - ID del tab activo
 * @param {function} [onTabChange] - Callback al cambiar de tab
 * @param {React.ReactNode} [actions] - Botones/acciones adicionales (slot derecho)
 */
export default function TopAppBar({
  userName,
  userRole,
  isConnected,
  tabs,
  activeTab,
  onTabChange,
  actions,
  onLogout,
}) {
  return (
    <header className="top-app-bar">
      {/* Left: Brand */}
      <div className="top-app-bar__left">
        <Logo width="120px" className="top-app-bar__logo" style={{ cursor: 'pointer' }} />
      </div>

      {/* Center: Tabs (optional) */}
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

      {/* Right: Actions + Status + User */}
      <div className="top-app-bar__right">
        {/* Custom actions slot */}
        {actions}

        {/* Connection status */}
        <div className="top-app-bar__status">
          <div className={`dot ${isConnected ? 'dot-primary dot-pulse' : 'dot-error'}`} />
          <span className="top-app-bar__status-text">
            {isConnected ? 'Conectado' : 'Desconectado'}
          </span>
        </div>

        {/* User info */}
        <div className="top-app-bar__user">
          <div className="top-app-bar__user-info">
            <span className="top-app-bar__user-name">{userName}</span>
            <span className="top-app-bar__user-role" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{userRole}</span>
          </div>
          <div className="top-app-bar__avatar">
            <span className="material-symbols-outlined">person</span>
          </div>
          
          <button 
            className="top-app-bar__logout" 
            onClick={onLogout}
            title="Cerrar Sesión"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
