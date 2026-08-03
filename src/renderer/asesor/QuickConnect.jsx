import React, { useState } from 'react';
import Modal from '../shared/Modal';
import { showToast } from '../shared/Toast';
import './QuickConnect.css';

export default function QuickConnect({ onConnected }) {
  const [loading, setLoading] = useState(null); // 'usb' | 'wifi' | null
  const [showWifiModal, setShowWifiModal] = useState(false);
  const [ip, setIp] = useState('');
  const [showInfinixGuide, setShowInfinixGuide] = useState(false);
  const [infinixGuide, setInfinixGuide] = useState('');

  async function handleUSB() {
    setLoading('usb');
    try {
      const result = await window.api.invoke('adb:connectUSB');
      if (result.success) {
        showToast(`Conectado por USB: ${result.device.model}`, 'success');
        if (result.infinixGuide) {
          setInfinixGuide(result.infinixGuide);
          setShowInfinixGuide(true);
        }
        onConnected?.('USB', result.device);
      } else {
        showToast(result.error || 'No se pudo conectar por USB', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(null);
    }
  }

  async function handleWifi() {
    if (!ip.trim()) {
      showToast('Ingresa una IP válida', 'warning');
      return;
    }
    setLoading('wifi');
    setShowWifiModal(false);
    try {
      localStorage.setItem('ultima_ip_wifi', ip);
      const result = await window.api.invoke('adb:connectWifi', ip);
      if (result.success) {
        showToast(`Conectado por WiFi a ${ip}`, 'success');
        onConnected?.('WIFI', { ip });
      } else {
        showToast(result.error || 'No se pudo conectar por WiFi', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(null);
    }
  }

  function openWifiModal() {
    const valor = localStorage.getItem('ultima_ip_wifi');
    if (valor) setIp(valor);
    setShowWifiModal(true);
  }

  async function handleDisconnect() {
    await window.api.invoke('adb:stop');
    showToast('Conexión terminada', 'info');
  }

  return (
    <div className="quick-connect card">
      <p className="section-title">Conexión Rápida</p>

      <div className="qc-buttons">
        <button type="button"
          id="btn-connect-usb"
          className="btn btn-success qc-btn"
          onClick={handleUSB}
          disabled={!!loading}
        >
          {loading === 'usb'
            ? <><span className="spinner" /> Conectando...</>
            : <><span className="qc-btn-icon">⚡</span> Conectar USB</>
          }
        </button>

        <button type="button"
          id="btn-connect-wifi"
          className="btn btn-primary qc-btn"
          onClick={openWifiModal}
          disabled={!!loading}
        >
          {loading === 'wifi'
            ? <><span className="spinner" /> Conectando WiFi...</>
            : <><span className="qc-btn-icon">📶</span> Conectar WiFi</>
          }
        </button>

        <button type="button"
          id="btn-disconnect"
          className="btn btn-ghost qc-btn btn-sm"
          onClick={handleDisconnect}
          disabled={!!loading}
        >
          ✕ Detener
        </button>
      </div>

      {/* Modal WiFi */}
      <Modal open={showWifiModal} onClose={() => setShowWifiModal(false)} title="Conectar por WiFi">
        <div className="wifi-modal-body">
          <label className="wifi-label">Dirección IP del dispositivo</label>
          <input aria-label="Dirección IP del dispositivo"
            id="input-wifi-ip"
            className="input"
            type="text"
            placeholder="192.168.1.100"
            value={ip}
            onChange={e => setIp(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleWifi()}
          />
          <p className="wifi-hint">El puerto 5555 se usará automáticamente.</p>
          <div className="wifi-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowWifiModal(false)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={handleWifi}>Conectar</button>
          </div>
        </div>
      </Modal>

      {/* Modal Guía INFINIX */}
      <Modal open={showInfinixGuide} onClose={() => setShowInfinixGuide(false)} title="🔧 Guía INFINIX — Modo Desarrollador">
        <div className="infinix-guide">
          <p className="infinix-guide-text">{infinixGuide}</p>
          <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: 16 }} onClick={() => setShowInfinixGuide(false)}>
            Entendido
          </button>
        </div>
      </Modal>
    </div>
  );
}
