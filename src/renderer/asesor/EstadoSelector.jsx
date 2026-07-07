import React, { useState, useEffect, useRef } from 'react';
import './EstadoSelector.css';

const ESTADOS = [
  { id: 1, nombre: 'En Gestión',       color: '#22C55E', tipo: 'PRODUCTIVO',    icon: '📞' },
  { id: 2, nombre: 'Ingreso de Datos', color: '#3B82F6', tipo: 'IMPRODUCTIVO', icon: '⌨' },
  { id: 3, nombre: 'Baño / Pausa',     color: '#EAB308', tipo: 'IMPRODUCTIVO', icon: '☕' },
  { id: 4, nombre: 'Capacitación',     color: '#F97316', tipo: 'IMPRODUCTIVO', icon: '📚' },
  { id: 5, nombre: 'Reunión',          color: '#8B5CF6', tipo: 'IMPRODUCTIVO', icon: '👥' },
  { id: 6, nombre: 'Desconectado',     color: '#EF4444', tipo: 'NO_APLICA',    icon: '⛔' }
];

function formatTimer(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function EstadoSelector({ asesorId, ws, onEstadoCambiado }) {
  const [estadoActual, setEstadoActual] = useState(ESTADOS[0]);
  const [segundos, setSegundos] = useState(0);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  if (startTimeRef.current === null) startTimeRef.current = Date.now();

  useEffect(() => {
    // Timer
    timerRef.current = setInterval(() => {
      setSegundos(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [estadoActual]);

  async function cambiarEstado(estado) {
    const duracion = Math.floor((Date.now() - startTimeRef.current) / 1000);

    // Guardar el evento del estado anterior
    if (asesorId) {
      try {
        await window.api.invoke('db:insertEvento', {
          asesor_id: asesorId,
          sesion_id: null,
          tipo: 'ESTADO',
          estado_id: estadoActual.id,
          duracion_seg: duracion,
          metadata: null
        });
      } catch (e) {
        console.warn('[EstadoSelector] No se pudo insertar evento:', e.message);
      }
    }

    // Notificar al supervisor via WS
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        tipo: 'CAMBIO_ESTADO',
        estado_id: estado.id,
        nombre_estado: estado.nombre
      }));
    }

    startTimeRef.current = Date.now();
    setSegundos(0);
    setEstadoActual(estado);
    onEstadoCambiado?.(estado);
  }

  return (
    <div className="estado-selector card">
      <p className="section-title">Estado del Asesor</p>

      {/* Estado actual + timer */}
      <div className="estado-actual" style={{ borderColor: estadoActual.color + '44', background: estadoActual.color + '11' }}>
        <div className="estado-actual-info">
          <span className="estado-icon">{estadoActual.icon}</span>
          <div>
            <span className="estado-nombre" style={{ color: estadoActual.color }}>{estadoActual.nombre}</span>
            <span className="estado-tipo">{estadoActual.tipo}</span>
          </div>
        </div>
        <div className="timer" style={{ color: estadoActual.color }}>{formatTimer(segundos)}</div>
      </div>

      {/* Grid de estados */}
      <div className="estado-grid">
        {ESTADOS.map(est => (
          <button type="button"
            key={est.id}
            id={`btn-estado-${est.id}`}
            className={`estado-btn ${estadoActual.id === est.id ? 'activo' : ''}`}
            style={{
              '--estado-color': est.color,
              borderColor: estadoActual.id === est.id ? est.color : 'transparent'
            }}
            onClick={() => cambiarEstado(est)}
          >
            <span className="estado-btn-icon">{est.icon}</span>
            <span className="estado-btn-label">{est.nombre}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
