import React, { useState, useEffect } from 'react';
import './ActivityLog.css';

/**
 * ActivityLog — Feed de actividad reciente del sistema (tipo notificación).
 * Se auto-descarta tras unos segundos de inactividad.
 */

const TIPO_ICONS = {
  ESTADO_CAMBIO: { icon: 'swap_horiz', cssClass: 'info' },
  CONEXION:      { icon: 'login',       cssClass: 'success' },
  DESCONEXION:   { icon: 'logout',      cssClass: 'error' },
  LLAMADA:       { icon: 'call',        cssClass: 'success' },
  ALERTA:        { icon: 'warning',     cssClass: 'warning' },
  SISTEMA:       { icon: 'settings',    cssClass: 'neutral' },
  LLAMADA_TIPIFICADA: { icon: 'description', cssClass: 'info' },
};

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

export default function ActivityLog({ eventos = [] }) {
  const [visible, setVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  // Mostrar al recibir nuevos eventos
  useEffect(() => {
    if (eventos.length > 0) {
      setShouldRender(true);
      setVisible(true);
      
      const timer = setTimeout(() => {
        setVisible(false);
        // Esperar a que termine la animación de salida para dejar de renderizar
        setTimeout(() => setShouldRender(false), 400);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [eventos]);

  if (!shouldRender || eventos.length === 0) return null;

  // Solo mostramos los últimos 3 para no saturar la notificación
  const ultimosEventos = eventos.slice(0, 3);

  return (
    <div className={`activity-log ${!visible ? 'activity-log--hidden' : ''}`}>
      <div className="activity-log__header">
        <h3 className="text-label-sm">Actividad Reciente</h3>
        <span className="dot dot-primary dot-pulse" />
      </div>

      <div className="activity-log__list">
        {ultimosEventos.map((evento, idx) => {
          const tipo = TIPO_ICONS[evento.tipo] || TIPO_ICONS.SISTEMA;
          return (
            <div key={evento.id || idx} className="activity-log__item">
              <span className={`material-symbols-outlined activity-log__icon activity-log__icon--${tipo.cssClass}`}>
                {tipo.icon}
              </span>
              <div className="activity-log__content">
                <span className="activity-log__message">{evento.mensaje}</span>
                <span className="activity-log__time">{formatTimeAgo(evento.timestamp)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

