import React, { useState, useEffect, useCallback } from 'react';
import { showToast } from '../shared/Toast';

const SEGMENTOS_LABEL = {
  TODOS: 'Todos',
  MENSUALES: 'Campaña Mensual',
  QUINCENALES: 'Campaña Quincenal',
  TRAMO_0: 'Tramo 0',
  TRAMO_1: 'Tramo 1',
  TRAMO_2: 'Tramo 2',
  PLAZO: 'Plazo',
};

export default function AsesorMensajes({ usuario, cartera, compact = false }) {
  const [mensajes, setMensajes] = useState([]);
  const [inactivos, setInactivos] = useState([]);
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [loading, setLoading] = useState(true);

  const cargarMensajes = useCallback(async () => {
    try {
      const data = await window.api.invoke('db:getMensajesBroadcast');
      const latestPerSegment = {};
      const arr = data || [];
      arr.filter(m => m.activo === 1).forEach(msg => {
        if (!latestPerSegment[msg.segmento_destino]) {
          latestPerSegment[msg.segmento_destino] = msg;
        }
      });
      setMensajes(Object.values(latestPerSegment));
      setInactivos(arr.filter(m => m.activo === 0).slice(0, 30)); // Mostrar solo los últimos 30 inactivos
    } catch (err) {
      console.error('Error cargando mensajes broadcast:', err);
      showToast('Error al cargar mensajes del supervisor', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarMensajes();
    // Auto-refresh messages every minute as fallback
    const interval = setInterval(cargarMensajes, 60000);
    return () => clearInterval(interval);
  }, [cargarMensajes]);

  // Escuchar eventos WebSocket para actualización inmediata
  useEffect(() => {
    const handleWsMessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (
          data.tipo === 'NUEVO_MENSAJE_SUPERVISOR' ||
          data.tipo === 'MENSAJE_DESACTIVADO' ||
          data.tipo === 'MENSAJE_BROADCAST'
        ) {
          cargarMensajes();
        }
      } catch { /* ignorar mensajes no JSON */ }
    };

    // window.api.onWsMessage existe si el asesor es remoto (WebSocket externo)
    if (window.api?.onWsMessage) {
      window.api.onWsMessage(handleWsMessage);
      return () => window.api?.offWsMessage?.(handleWsMessage);
    }

    // Fallback: IPC evento desde Electron main (asesores locales)
    const removeListener = window.api?.on?.('ws:message', (data) => {
      if (
        data?.tipo === 'NUEVO_MENSAJE_SUPERVISOR' ||
        data?.tipo === 'MENSAJE_DESACTIVADO'
      ) {
        cargarMensajes();
      }
    });
    return () => removeListener?.();
  }, [cargarMensajes]);

  const handleCopiar = (texto) => {
    navigator.clipboard.writeText(texto)
      .then(() => showToast('Mensaje copiado al portapapeles', 'success'))
      .catch(() => showToast('Error al copiar el mensaje', 'error'));
  };

  const getSegmentoColor = (segmento) => {
    switch (segmento) {
      case 'TODOS': return '#4caf50';
      case 'MENSUALES': return '#2196f3';
      case 'QUINCENALES': return '#ff9800';
      case 'TRAMO_0': return '#00bcd4';
      case 'TRAMO_1': return '#9c27b0';
      case 'TRAMO_2': return '#e91e63';
      case 'PLAZO': return '#f44336';
      default: return 'var(--color-primary)';
    }
  };

  const getSegmentoLabel = (segmento) => SEGMENTOS_LABEL[segmento] || segmento.replace('_', ' ');

  if (loading && mensajes.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: compact ? 16 : 64 }}>
        <span className="spinner" style={compact ? {width: 16, height: 16} : {}} />
      </div>
    );
  }

  if (compact) {
    if (mensajes.length === 0) return null; // Don't show anything in sidebar if no messages
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '30vh', overflowY: 'auto', paddingRight: 4 }}>
        <h4 style={{ fontSize: 11, margin: 0, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Mensajes Activos</h4>
        {mensajes.map((msg) => (
          <div key={msg.id} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ 
                fontSize: 9, fontWeight: 800, padding: '2px 4px', borderRadius: 4, 
                background: `${getSegmentoColor(msg.segmento_destino)}22`, color: getSegmentoColor(msg.segmento_destino),
              }}>
                {getSegmentoLabel(msg.segmento_destino)}
              </span>
            </div>
            <p style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap', fontSize: 11, lineHeight: 1.4, opacity: 0.9, maxHeight: 60, overflowY: 'auto' }}>
              {msg.mensaje}
            </p>
            <button 
              className="btn btn-outline" 
              onClick={() => handleCopiar(msg.mensaje)}
              style={{ width: '100%', fontSize: 10, padding: '4px 8px', borderColor: 'rgba(0, 229, 255, 0.2)', color: '#00e5ff', display: 'flex', justifyContent: 'center' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12, marginRight: 4 }}>content_copy</span>
              Copiar
            </button>
          </div>
        ))}
      </div>
    );
  }

  const renderMensaje = (msg, isActive) => (
    <div key={msg.id} className="card" style={{ padding: 0, overflow: 'hidden', opacity: isActive ? 1 : 0.65 }}>
      <div style={{ 
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
        padding: '12px 16px', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span 
            style={{ 
              fontSize: 10, 
              fontWeight: 800, 
              padding: '4px 8px', 
              borderRadius: 4, 
              background: `${getSegmentoColor(msg.segmento_destino)}22`, 
              color: getSegmentoColor(msg.segmento_destino),
              border: `1px solid ${getSegmentoColor(msg.segmento_destino)}44`
            }}
          >
            {getSegmentoLabel(msg.segmento_destino)}
          </span>
          <div style={{ fontSize: 12, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>person</span>
            Supervisor: {msg.supervisor_nombre}
          </div>
          {!isActive && (
            <span style={{ fontSize: 10, background: '#333', padding: '2px 6px', borderRadius: 4 }}>Inactivo</span>
          )}
        </div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>
          {new Date(msg.creado_en).toLocaleString()}
        </div>
      </div>
      
      <div style={{ padding: 16 }}>
        <p style={{ margin: '0 0 16px', whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.5 }}>
          {msg.mensaje}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            className="btn btn-outline" 
            onClick={() => handleCopiar(msg.mensaje)}
            style={{ borderColor: 'rgba(0, 229, 255, 0.3)', color: '#00e5ff' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>content_copy</span>
            Copiar Mensaje
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 className="text-headline-sm" style={{ marginBottom: 8 }}>
            <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: 8, color: 'var(--color-primary)' }}>forum</span>
            Mensajes del Supervisor
          </h3>
          <p className="text-body-sm" style={{ opacity: 0.6, maxWidth: 600 }}>
            Aquí encontrarás los textos redactados por tu supervisor para enviarlos por WhatsApp o SMS a tu cartera asignada.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={cargarMensajes}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
          Actualizar
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 48, textAlign: 'center', opacity: 0.5 }}>Cargando mensajes...</div>
      ) : mensajes.length === 0 ? (
        <div style={{ padding: 48, textAlign: 'center', opacity: 0.4, border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 48, marginBottom: 16 }}>chat_bubble_outline</span>
          <h4 style={{ margin: '0 0 8px' }}>No hay mensajes nuevos</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Tu supervisor aún no ha enviado mensajes para copiar.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {mensajes.map((msg) => renderMensaje(msg, true))}
        </div>
      )}

      {inactivos.length > 0 && (
        <div style={{ marginTop: 32, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 24 }}>
          <button
            onClick={() => setMostrarInactivos(!mostrarInactivos)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 8, cursor: 'pointer', color: 'inherit'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-symbols-outlined" style={{ opacity: 0.6 }}>history</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Mensajes Anteriores (Inactivos)</span>
              <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: 12 }}>
                {inactivos.length}
              </span>
            </div>
            <span className="material-symbols-outlined" style={{ transform: mostrarInactivos ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              expand_more
            </span>
          </button>
          
          {mostrarInactivos && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
              {inactivos.map((msg) => renderMensaje(msg, false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
