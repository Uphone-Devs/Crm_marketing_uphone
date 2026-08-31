import React, { useState, useEffect, useCallback } from 'react';
import Modal from '../shared/Modal';

export default function CampaignSelector({ open, onSelect, usuarioId, callApi, onLogout }) {
  const [campanas, setCampanas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadCampanas = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const data = await callApi('db:getCampanas', usuarioId);
      setCampanas(data || []);
    } catch (err) {
      console.error('Error al cargar campañas:', err);
      setError('No se pudo conectar al servidor. Verifica la conexión.');
    } finally {
      setLoading(false);
    }
  }, [open, usuarioId, callApi]);

  useEffect(() => {
    loadCampanas();
  }, [loadCampanas]);

  return (
    <Modal open={open} title="Seleccionar Campaña" onClose={() => {}}>
      <div className="campaign-selector">
        <p className="text-body-md" style={{ marginBottom: 16 }}>
          Elige la campaña en la que trabajarás hoy:
        </p>

        {loading ? (
          <div className="spinner-container"><span className="spinner" /></div>
        ) : error ? (
          <div style={{ textAlign: 'center' }}>
            <p className="text-label-md" style={{ color: '#ff5252', marginBottom: 16 }}>{error}</p>
            <button type="button" className="btn btn--primary" onClick={loadCampanas}>
              Reintentar
            </button>
          </div>
        ) : (
          <div className="campaign-list" style={{ display: 'grid', gap: 12 }}>
            {campanas.length === 0 ? (
              <div style={{ textAlign: 'center' }}>
                <p className="text-label-md" style={{ opacity: 0.6, marginBottom: 8 }}>
                  No hay campañas activas asignadas a tu usuario.
                </p>
                <p className="text-label-sm" style={{ opacity: 0.45, marginBottom: 20 }}>
                  Contacta a tu supervisor para que te asigne una campaña.
                </p>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  <button type="button" className="btn btn--secondary" onClick={loadCampanas}>
                    Reintentar
                  </button>
                  {typeof onLogout === 'function' && (
                    <button type="button" className="btn btn--ghost" onClick={onLogout}>
                      Cerrar sesión
                    </button>
                  )}
                </div>
              </div>
            ) : (
              campanas.map(c => (
                <button type="button"
                  key={c.id}
                  className="btn btn-outline"
                  style={{ justifyContent: 'space-between', padding: '16px 20px' }}
                  onClick={() => onSelect(c)}
                >
                  <div style={{ textAlign: 'left' }}>
                    <div className="text-headline-sm" style={{ fontWeight: 600 }}>{c.nombre}</div>
                    <div className="text-label-sm" style={{ opacity: 0.7 }}>{c.descripcion || 'Sin descripción'}</div>
                  </div>
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
