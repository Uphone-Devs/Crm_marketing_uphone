import React from 'react';
import './NavigationDrawer.css';

/**
 * NavigationDrawer — Sidebar de navegación global.
 * Patrón: UI "tonta" (solo renderiza props). No conoce lógica de negocio.
 *
 * @param {string}   role      - 'supervisor' | 'asesor'
 * @param {string}   activePage - ID de la página activa
 * @param {function} onNavigate - Callback cuando se selecciona una página
 * @param {object}   [deviceInfo] - Info del dispositivo conectado (opcional)
 */

const NAV_ITEMS_SUPERVISOR = [
  { id: 'monitoreo', icon: 'monitor_heart',           label: 'Monitoreo' },
  { id: 'campanas',  icon: 'campaign',                label: 'Campañas' },
  { id: 'carteras',  icon: 'folder_shared',           label: 'Carteras' },
  { id: 'validacion', icon: 'verified',              label: 'Validación Pagos' },
  { id: 'metricas',  icon: 'analytics',               label: 'Métricas' },
  { id: 'compromisos',  icon: 'handshake',             label: 'Compromisos' },
  { id: 'referencias', icon: 'contacts',              label: 'Referencias' },
  { id: 'reportes',    icon: 'description',           label: 'Reportes' },
  { id: 'mensajes',  icon: 'chat',                     label: 'Mensajes' },
  // Bug 3 v3.0: "Administración de Personal" se movió al panel del Admin del sistema.
  // El supervisor ya no gestiona usuarios (evita ver/gestionar la cuenta admin y otros equipos).
  { id: 'red',       icon: 'lan',                     label: 'Configuracion de red' },
];

const NAV_ITEMS_ASESOR = [
  { id: 'dashboard',   icon: 'grid_view',                label: 'Consola de asesor' },
  { id: 'historial',   icon: 'history',                  label: 'Historial de Gestiones' },
  { id: 'cartera',     icon: 'folder_shared',            label: 'Cartera Asignada' },
  { id: 'compromisos', icon: 'handshake',                label: 'Mis Compromisos' },
  { id: 'config',      icon: 'settings_input_component', label: 'Configuración del sistema' },
];

export default function NavigationDrawer({ role, activePage, onNavigate }) {
  const items = role === 'supervisor' ? NAV_ITEMS_SUPERVISOR : NAV_ITEMS_ASESOR;
  const isAsesor = role === 'asesor';

  return (
    <aside className="nav-drawer">
      {/* Brand */}
      <div className="nav-drawer__brand">
        {role === 'asesor' ? (
          <h2 className="nav-drawer__brand-role" style={{ fontSize: '1rem', color: 'var(--color-primary)' }}>ROL DE TERMINAL ASESOR</h2>
        ) : (
          <>
            <span className="nav-drawer__brand-label">ROL DE TERMINAL</span>
            <h2 className="nav-drawer__brand-role">SUPERVISOR</h2>
          </>
        )}
      </div>

      {/* Navigation Items */}
      <nav className="nav-drawer__nav">
        {items.map(item => (
          <button
            key={item.id}
            className={`nav-drawer__item ${activePage === item.id ? 'nav-drawer__item--active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="nav-drawer__item-label">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Bottom Status */}
      <div className="nav-drawer__footer">
        <div className="nav-drawer__status-card">
          <div className="dot dot-primary dot-pulse" />
          <span className="text-label">Terminal Seguro</span>
        </div>
      </div>
    </aside>
  );
}
