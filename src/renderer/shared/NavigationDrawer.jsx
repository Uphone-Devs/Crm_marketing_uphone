import React, { useState, useRef, useEffect } from 'react';
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
  { id: 'campanas',            icon: 'folder_open',   label: 'Asignación de Cartera' },
  { id: 'carteras',    icon: 'folder_shared', label: 'Carteras' },
  { id: 'validacion',  icon: 'verified',      label: 'Validación Pagos' },
  { id: 'metricas',    icon: 'analytics',     label: 'Métricas' },
  { id: 'actividad',   icon: 'monitor_heart', label: 'Actividad Gestores' },
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
  { id: 'mensajes_sv',    icon: 'mark_unread_chat_alt',   label: 'Mensajes' },
  { id: 'indicadores',    icon: 'bar_chart',              label: 'Indicadores' },

];

export default function NavigationDrawer({ userRole, activePage, onNavigate, usuario, onLogout, compactContent, collapsed = false, onToggleCollapse }) {
  const items = userRole === 'supervisor' ? NAV_ITEMS_SUPERVISOR : NAV_ITEMS_ASESOR;
  const [profileOpen, setProfileOpen] = useState(false);
  const [expanded, setExpanded] = useState(
    () => {
      const campaignIds = ['campanas_wsp', 'campanas_rcs', 'campanas_correo'];
      return campaignIds.includes(activePage) ? 'campanas_group' : null;
    }
  );
  // Flyout para modo colapsado con sub-items
  const [flyout, setFlyout] = useState(null); // { itemId, top }
  const flyoutRef = useRef(null);

  // Cerrar flyout al hacer click fuera
  useEffect(() => {
    if (!flyout) return;
    const handler = (e) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target)) {
        setFlyout(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [flyout]);

  const toggleExpand = (id) => setExpanded(prev => (prev === id ? null : id));

  const isSubActive = (item) =>
    item.subItems && item.subItems.some(s => s.id === activePage);

  const inicial = usuario?.nombre ? usuario.nombre.charAt(0).toUpperCase() : '?';

  return (
    <aside className={`nav-drawer${collapsed ? ' nav-drawer--collapsed' : ''}`}>
      {/* Brand */}
      <div className="nav-drawer__brand">
        {userRole === 'asesor' ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 6 }}>
            {onToggleCollapse && (
              <button type="button" className="nav-drawer__toggle" onClick={onToggleCollapse} title={collapsed ? 'Expandir menú' : 'Colapsar menú'}>
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
      {userRole === 'asesor' && usuario && (
        <div className="nav-drawer__profile">
          <div className="nav-drawer__avatar">{inicial}</div>
          <div className="nav-drawer__user-info">
            <span className="nav-drawer__user-name">{usuario.nombre}</span>
            <span className="nav-drawer__user-role">Asesor de Cobranza</span>
            <span className="nav-drawer__user-status">
              <span style={{ color: 'var(--color-primary)', fontSize: 12 }}>●</span> En linea
            </span>
          </div>
          {onLogout && (
            <button type="button" className="nav-drawer__logout-btn" onClick={onLogout} title="Cerrar Sesión">
              <span className="material-symbols-outlined">logout</span>
            </button>
          )}
        </div>
      )}

      {/* Navigation Items */}
      <nav className="nav-drawer__nav" style={{ position: 'relative' }}>
        {items.map(item => (
          <div key={item.id} style={{ position: 'relative' }}>
            <button type="button"
              className={`nav-drawer__item ${
                (!item.subItems && activePage === item.id) || isSubActive(item)
                  ? 'nav-drawer__item--active'
                  : ''
              }`}
              title={collapsed ? item.label : undefined}
              onClick={(e) => {
                if (item.subItems) {
                  if (collapsed) {
                    // Modo colapsado: mostrar flyout flotante
                    if (flyout?.itemId === item.id) {
                      setFlyout(null);
                    } else {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setFlyout({ itemId: item.id, top: rect.top });
                    }
                  } else {
                    // Modo expandido: accordion normal
                    toggleExpand(item.id);
                  }
                } else {
                  setFlyout(null);
                  onNavigate(item.id);
                }
              }}
            >
              <span className="material-symbols-outlined nav-drawer__item-icon">
                {item.icon}
              </span>
              <span className="nav-drawer__item-label">{item.label}</span>
              {item.subItems && !collapsed && (
                <span
                  className="material-symbols-outlined"
                  style={{ marginLeft: 'auto', fontSize: 16, opacity: 0.6 }}
                >
                  {expanded === item.id ? 'expand_less' : 'expand_more'}
                </span>
              )}
              {/* Indicador flyout disponible en modo colapsado */}
              {item.subItems && collapsed && (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 12, position: 'absolute', right: 2, bottom: 4, opacity: 0.5 }}
                >
                  chevron_right
                </span>
              )}
            </button>

            {/* Accordion (modo expandido) */}
            {item.subItems && expanded === item.id && !collapsed && (
              <div className="nav-drawer__subitems">
                {item.subItems.map(sub => (
                  <button type="button"
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

        {/* Flyout flotante (modo colapsado) */}
        {flyout && (() => {
          const item = items.find(i => i.id === flyout.itemId);
          if (!item?.subItems) return null;
          return (
            <div
              ref={flyoutRef}
              style={{
                position: 'fixed',
                top: flyout.top,
                left: 60,
                zIndex: 9999,
                background: 'rgba(18,18,28,0.97)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                padding: '6px 0',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                minWidth: 170,
              }}
            >
              <div style={{ padding: '4px 14px 8px', fontSize: 12, opacity: 0.4, letterSpacing: 1, textTransform: 'uppercase' }}>
                {item.label}
              </div>
              {item.subItems.map(sub => (
                <button type="button"
                  key={sub.id}
                  onClick={() => { onNavigate(sub.id); setFlyout(null); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '9px 14px',
                    background: activePage === sub.id ? 'rgba(0,230,118,0.12)' : 'transparent',
                    border: 'none', cursor: 'pointer', color: activePage === sub.id ? 'var(--color-primary)' : 'rgba(255,255,255,0.75)',
                    fontSize: 13, textAlign: 'left', borderRadius: 0,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
                  onMouseLeave={e => e.currentTarget.style.background = activePage === sub.id ? 'rgba(0,230,118,0.12)' : 'transparent'}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: activePage === sub.id ? 'var(--color-primary)' : 'inherit' }}>
                    {sub.icon}
                  </span>
                  {sub.label}
                </button>
              ))}
            </div>
          );
        })()}
      </nav>

      {/* Contenido compacto extra (ej: mensajes activos) */}
      {compactContent && (
        <div className="nav-drawer__compact">
          {compactContent}
        </div>
      )}

      {/* Supervisor: perfil + logout dropdown */}
      {userRole === 'supervisor' && (
        <div style={{ padding: '0 8px 12px', position: 'relative' }}>
          <button type="button"
            onClick={() => setProfileOpen(p => !p)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 12,
              background: profileOpen ? 'rgba(0,230,118,0.08)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${profileOpen ? 'rgba(0,230,118,0.25)' : 'rgba(255,255,255,0.08)'}`,
              cursor: 'pointer', transition: 'background 0.18s, opacity 0.18s, border-color 0.18s, color 0.18s',
            }}
          >
            <div style={{
              width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg,#00e676,#00bfa5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800, color: '#000',
            }}>
              {usuario?.nombre ? usuario.nombre.charAt(0).toUpperCase() : 'J'}
            </div>
            {!collapsed && (
              <>
                <div style={{ flex: 1, textAlign: 'left', overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {usuario?.nombre || 'Jefe de Área'}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.45, marginTop: 1 }}>Jefe de Área</div>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: 16, opacity: 0.5, color: '#fff' }}>
                  {profileOpen ? 'expand_less' : 'expand_more'}
                </span>
              </>
            )}
          </button>

          {profileOpen && (
            <div style={{
              marginTop: 6, borderRadius: 10,
              background: 'rgba(18,18,28,0.97)',
              border: '1px solid rgba(255,255,255,0.1)',
              overflow: 'hidden',
            }}>
              {onLogout && (
                <button type="button"
                  onClick={() => { setProfileOpen(false); onLogout(); }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '11px 14px', background: 'transparent',
                    border: 'none', cursor: 'pointer', color: '#ef5350',
                    fontSize: 13, fontWeight: 600, textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,83,80,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>logout</span>
                  Cerrar Sesión
                </button>
              )}
            </div>
          )}
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
