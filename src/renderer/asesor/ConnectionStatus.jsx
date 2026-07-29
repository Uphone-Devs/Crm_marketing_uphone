import React, { useState, useEffect, useCallback } from 'react';
import './ConnectionStatus.css';

const ESTADOS_CONEXION = {
  DESCONECTADO:  { label: 'Desconectado',  dotClass: 'dot-red',    icon: '⚠' },
  CONECTANDO:    { label: 'Conectando...',   dotClass: 'dot-yellow dot-pulse', icon: '↻' },
  CONECTADO_USB: { label: 'USB Conectado',  dotClass: 'dot-green',  icon: '⚡' },
  CONECTADO_WIFI:{ label: 'WiFi Conectado', dotClass: 'dot-green',  icon: '📶' }
};

export default function ConnectionStatus() {
  const [estado, setEstado] = useState('DESCONECTADO');
  const [device, setDevice] = useState(null);
  const [error, setError] = useState(null);

  const checkDevices = useCallback(async () => {
    try {
      const result = await window.api.invoke('adb:devices');
      if (result.success && result.devices.length > 0) {
        const dev = result.devices[0];
        setDevice(dev);
        setEstado(dev.isWifi ? 'CONECTADO_WIFI' : 'CONECTADO_USB');
        setError(null);
      } else {
        setDevice(null);
        setEstado('DESCONECTADO');
        if (!result.success) setError(result.error);
      }
    } catch (err) {
      setEstado('DESCONECTADO');
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    checkDevices();
    const interval = setInterval(checkDevices, 10000);
    return () => clearInterval(interval);
  }, [checkDevices]);

  const info = ESTADOS_CONEXION[estado];

  return (
    <div className={`conn-status-card card ${estado === 'CONECTADO_USB' || estado === 'CONECTADO_WIFI' ? 'connected' : ''}`}>
      <div className="conn-header">
        <span className="section-title">Estado del Dispositivo</span>
        <span className="conn-icon">{info.icon}</span>
      </div>

      <div className="conn-main">
        <span className={`dot ${info.dotClass}`} />
        <span className="conn-label">{info.label}</span>
      </div>

      {device && (
        <div className="conn-details">
          <div className="conn-detail-row">
            <span className="conn-detail-label">Dispositivo</span>
            <span className="conn-detail-val">{device.model}</span>
          </div>
          {device.isWifi && (
            <div className="conn-detail-row">
              <span className="conn-detail-label">IP</span>
              <span className="conn-detail-val">{device.ip}</span>
            </div>
          )}
          {device.isInfinix && (
            <div className="conn-infinix-badge">
              <span>✓ INFINIX — Modo compatibilidad activo</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="conn-error">
          <span>⚠ {error}</span>
        </div>
      )}
    </div>
  );
}
