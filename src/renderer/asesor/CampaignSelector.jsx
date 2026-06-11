import React, { useState, useEffect } from 'react';
import Modal from '../shared/Modal';

/**
 * CampaignSelector — Diálogo inicial para que el asesor elija la campaña 
 * activa antes de comenzar a gestionar contactos.
 */
export default function CampaignSelector({ open, onSelect, usuarioId, callApi }) {
  const [campanas, setCampanas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    
    async function loadCampanas() {
      try {
        // Usar callApi (que maneja local vs remoto) en lugar de window.api.invoke directo
        const data = await callApi('db:getCampanas', usuarioId);
        setCampanas(data || []);
      } catch (err) {
        console.error('Error al cargar campañas:', err);
      } finally {
        setLoading(false);
      }
    }

    loadCampanas();
  }, [open, usuarioId, callApi]);

  return (
    <Modal open={open} title="Seleccionar Campaña" onClose={() => {}}>
      <div className="campaign-selector">
        <p className="text-body-md" style={{ marginBottom: 16 }}>
          Elige la campaña en la que trabajarás hoy:
        </p>
        
        {loading ? (
          <div className="spinner-container"><span className="spinner" /></div>
        ) : (
          <div className="campaign-list" style={{ display: 'grid', gap: 12 }}>
            {campanas.length === 0 ? (
              <p className="text-label-md" style={{ textAlign: 'center', opacity: 0.6 }}>
                No hay campañas activas disponibles.
              </p>
            ) : (
              campanas.map(c => (
                <button
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
