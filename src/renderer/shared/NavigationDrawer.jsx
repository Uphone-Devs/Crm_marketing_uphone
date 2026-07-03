import React, { useState } from 'react';
import './NavigationDrawer.css';

/**
 * NavigationDrawer – Sidebar de navegación global.
 * Patrón: UI "tonta" (solo renderiza props). No conoce lógica de negocio.
 *
 * @param {string}   role          - 'supervisor' | 'asesor'
 * @param {string}   activePage    - ID de la página activa
 * @param {function} onNavigate    - Callback cuando se selecciona una página
 * @param {object}   [usuario]     - Datos del usuario (asesor): nombre, etc.
 * @param {function} [onLogout]    - Callback para cerrar sesión (asesor)
 * @param {React.ReactNode} [compactContent] - Contenido extra al final del nav (ej: mensajes activos)
 */

const NAV_ITEMS_SUPERVISOR = [
  { id: 'dashboard_directivo', icon: 'dashboard',     label: 'Dashboard Directivo' },
  { id: 'monitoreo',           icon: 'monitor_heart', label: 'Monitoreo' },
  { id: 'campanas',            icon: 'campaign',      label: 'Campañas' },
  { id: 'carteras',    icon: 'folder_shared', label: 'Carteras' },
  { id: 'validacion',  icon: 'verified',      label: 'Validación Pagos' },
  { id: 'metricas',    icon: 'analytics',     label: 'Métricas' },
  { id: 'compromisos', icon: 'handshake',     label: 'Compromisos' },
  { id: 'reportes',    icon: 'description',   label: 'Reportes' },
  { id: 'indicadores', icon: 'bar_chart',     label: 'Indicadores de Recaudo' },
  { id: 'mensajes',    icon: 'chat',          label: 'Mensajes' },
  { id: 'red',         icon: 'lan',           label: 'Configuracion de red' },
];

const NAV_ITEMS_ASESOR = [
  { id: 'dashboard',   icon: 'grid_view',    label: 'Consola de asesor' },
  { id: 'historial',   icon: 'history',      label: 'Historial de Gestiones' },
  { id: 'cartera',     icon: 'folder_shared',label: 'Cartera Asignada' },
  { 
    id: 'campanas_group', 
    icon: 'campaign', 
    label: 'Campañas Masivas',
    subItems: [
      { id: 'campanas_wsp',   icon: 'chat', label: 'WhatsApp' },
      { id: 'campanas_rcs',   icon: 'sms',  label: 'RCS' },
      { id: 'campanas_correo',icon: 'mail', label: 'Correos' },
    ]
  },
  { id: 'compromisos',    icon: 'handshake',              label: 'Mis Compromisos' },
  { id: 'mensajes_sv',    icon: 'mark_unread_chat_alt',   label: 'Mensajes del Supervisor' },
  { id: 'indicadores',    icon: 'bar_chart',              label: 'Indicadores' },
  { id: 'config',         icon: 'settings_input_component', label: 'Configuración del sistema' },
];

export default function NavigationDrawer({ role, activePage, onNavigate, usuario, onLogout, compactContent, collapsed = false, onToggleCollapse }) {
  const items = role === 'supervisor' ? NAV_ITEMS_SUPERVISOR : NAV_ITEMS_ASESOR;
  const [expanded, setExpanded] = useState(
    () => {
      const campaignIds = ['campanas_wsp', 'campanas_rcs', 'campanas_correo'];
      return campaignIds.includes(activePage) ? 'campanas_group' : null;
    }
  );

  const toggleExpand = (id) => setExpanded(prev => (prev === id ? null : id));

  const isSubActive = (item) =>
    item.subItems && item.subItems.some(s => s.id === activePage);

  const inicial = usuario?.nombre ? usuario.nombre.charAt(0).toUpperCase() : '?';

  return (
    <aside className={`nav-drawer${collapsed ? ' nav-drawer--collapsed' : ''}`}>
      {/* Brand */}
      <div className="nav-drawer__brand">
        {role === 'asesor' ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 6 }}>
            {onToggleCollapse && (
              <button className="nav-drawer__toggle" onClick={onToggleCollapse} title={collapsed ? 'Expandir' : 'Colapsar'}>
                <span className="material-symbols-outlined">
                  {collapsed ? 'menu' : 'menu_open'}
                </span>
              </button>
            )}
            {!collapsed && (
              <>
                <h2 className="nav-drawer__brand-role" style={{ fontSize: '0.85rem', color: 'var(--color-primary)', margin: 0, flex: 1 }}>
                  ROL DE TERMINAL ASESOR
                </h2>
                <span className="material-symbols-outlined" style={{ fontSize: 18, opacity: 0.5, cursor: 'pointer' }} onClick={() => onNavigate('config')}>
                  settings
                </span>
              </>
            )}
          </div>
        ) : (
          <>
            <span className="nav-drawer__brand-label">ROL DE TERMINAL</span>
            <h2 className="nav-drawer__brand-role">JEFE DE ÁREA</h2>
          </>
        )}
      </div>

      {/* Profile Card (solo asesor) */}
      {role === 'asesor' && usuario && (
        <div className="nav-drawer__profile">
          <div className="nav-drawer__avatar">{inicial}</div>
          <div className="nav-drawer__user-info">
            <span className="nav-drawer__user-name">{usuario.nombre}</span>
            <span className="nav-drawer__user-role">Asesor de Cobranza</span>
            <span className="nav-drawer__user-status">
              <span style={{ color: 'var(--color-primary)', fontSize: 8 }}>●</span> En linea
            </span>
          </div>
          {onLogout && (
            <button className="nav-drawer__logout-btn" onClick={onLogout} title="Cerrar Sesión">
              <span className="material-symbols-outlined">logout</span>
            </button>
          )}
        </div>
      )}

      {/* Navigation Items */}
      <nav className="nav-drawer__nav">
        {items.map(item => (
          <div key={item.id}>
            <button
              className={`nav-drawer__item ${
                (!item.subItems && activePage === item.id) || isSubActive(item)
                  ? 'nav-drawer__item--active'
                  : ''
              }`}
              onClick={() => {
                if (item.subItems) {
                  if (expanded !== item.id) {
                    setExpanded(item.id);
                  } else {
                    setExpanded(null);
                  }
                  if (collapsed && onToggleCollapse) {
                    onToggleCollapse();
                  }
                } else {
                  onNavigate(item.id);
                }
              }}
            >
              <span className="material-symbols-outlined nav-drawer__item-icon">
                {item.icon}
              </span>
              <span className="nav-drawer__item-label">{item.label}</span>
              {item.subItems && (
                <span
                  className="material-symbols-outlined"
                  style={{ marginLeft: 'auto', fontSize: 16, opacity: 0.6 }}
                >
                  {expanded === item.id ? 'expand_less' : 'expand_more'}
                </span>
              )}
            </button>

            {item.subItems && expanded === item.id && (
              <div className="nav-drawer__subitems">
                {item.subItems.map(sub => (
                  <button
                    key={sub.id}
                    className={`nav-drawer__subitem ${activePage === sub.id ? 'nav-drawer__subitem--active' : ''}`}
                    onClick={() => onNavigate(sub.id)}
                  >
                    <span className="material-symbols-outlined nav-drawer__subitem-icon">
                      {sub.icon}
                    </span>
                    <span className="nav-drawer__subitem-label">{sub.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* Contenido compacto extra (ej: mensajes activos) */}
      {compactContent && (
        <div className="nav-drawer__compact">
          {compactContent}
        </div>
      )}

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
