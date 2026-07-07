import React, { useState, useEffect } from 'react';

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  if (!ws || ws === '127.0.0.1' || ws === 'localhost') return null;
  return (ws.startsWith('http') ? ws.replace(/\/$/, '') : `http://${ws}:3001`) + '/api';
}
async function vmFetch(apiBase, token, path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
import AudioPlayer from '../shared/AudioPlayer';
import { todayLocalISO } from '../shared/timeUtils';

/**
 * HistoryPage — El supervisor puede auditar las gestiones realizadas
 * por todos los asesores, ver tipificaciones y escuchar grabaciones.
 */
export default function HistoryPage() {
  const apiBase   = buildApiBase();
  const isRemote  = !!apiBase;
  const authToken = localStorage.getItem('auth_token');
  const [cdrs, setCdrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState({
    asesorId: '',
    fecha: todayLocalISO(),
  });
  const [asesores, setAsesores] = useState([]);

  useEffect(() => {
    async function init() {
      try {
        const listAsesores = isRemote
          ? await vmFetch(apiBase, authToken, '/asesores')
          : await window.api.invoke('db:getAsesores');
        setAsesores(listAsesores);
        fetchHistory();
      } catch (err) {
        console.error('Error al inicializar historial:', err);
      }
    }
    init();
  }, []);

  async function fetchHistory() {
    setLoading(true);
    try {
      let data;
      if (isRemote) {
        const params = new URLSearchParams();
        if (filtros.asesorId) params.set('asesor_id', filtros.asesorId);
        if (filtros.fecha)    params.set('fecha',     filtros.fecha);
        data = await vmFetch(apiBase, authToken, `/cdrs/all?${params}`);
      } else {
        data = await window.api.invoke('db:getAllCdrs', filtros);
      }
      setCdrs(data);
    } catch (err) {
      console.error('Error al cargar historial:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleFiltroChange = (e) => {
    const { name, value } = e.target;
    setFiltros(prev => ({ ...prev, [name]: value }));
  };

  useEffect(() => {
    fetchHistory();
  }, [filtros.asesorId, filtros.fecha]);

  return (
    <div className="history-page">
      <header className="history-header">
        <h2 className="text-headline-sm">Auditoría de Gestiones (CDRs)</h2>
        <div className="history-filters">
          <div className="filter-group">
            <label className="text-label-sm">Asesor</label>
            <select 
              name="asesorId" 
              className="input-sm" 
              value={filtros.asesorId} 
              onChange={handleFiltroChange}
            >
              <option value="">Todos los Asesores</option>
              {asesores.map(a => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label className="text-label-sm">Fecha</label>
            <input aria-label="Fecha" 
              type="date" 
              name="fecha" 
              className="input-sm" 
              value={filtros.fecha} 
              onChange={handleFiltroChange} 
            />
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={fetchHistory} title="Refrescar">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>refresh</span>
          </button>
        </div>
      </header>

      {loading ? (
        <div className="spinner-container" style={{ minHeight: 300 }}>
          <span className="spinner" />
          <p className="text-body-sm" style={{ marginTop: 12, opacity: 0.7 }}>Cargando CDRs...</p>
        </div>
      ) : (
        <div className="card history-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha/Hora</th>
                <th>Asesor</th>
                <th>Deudor</th>
                <th>Teléfono</th>
                <th>Tipificación</th>
                <th>Grabación</th>
              </tr>
            </thead>
            <tbody>
              {cdrs.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center" style={{ padding: 48, opacity: 0.5 }}>
                    No se encontraron registros para los filtros seleccionados
                  </td>
                </tr>
              ) : (
                cdrs.map(cdr => (
                  <tr key={cdr.id}>
                    <td>
                      <div className="text-body-sm">{new Date(cdr.creado_en).toLocaleTimeString()}</div>
                      <div className="text-label-sm" style={{ opacity: 0.5 }}>{new Date(cdr.creado_en).toLocaleDateString()}</div>
                    </td>
                    <td className="text-body-sm" style={{ fontWeight: 600 }}>{cdr.asesor_nombre}</td>
                    <td>
                      <div className="text-body-sm">{cdr.nombre_deudor}</div>
                      <div className="text-label-sm" style={{ opacity: 0.7 }}>{cdr.producto || 'Genérico'}</div>
                    </td>
                    <td className="text-body-sm">{cdr.telefono}</td>
                    <td>
                      <span className={`badge badge--tipification`}>
                        {cdr.resultado || 'Sin Tipificar'}
                      </span>
                    </td>
                    <td>
                      {cdr.url_grabacion ? (
                        <AudioPlayer audioPath={cdr.url_grabacion} />
                      ) : (
                        <span className="text-label-sm" style={{ opacity: 0.4 }}>No disponible</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
