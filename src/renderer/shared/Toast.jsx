import React, { useEffect, useState, useCallback } from 'react';
import './Toast.css';

let addToastFn = null;

/**
 * Muestra un toast.
 * @param {string} message - Texto del toast
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {number} duration - ms antes de cerrar (0 = persistente, requiere clic)
 * @param {object} [opts] - { onClick, actionLabel }
 */
export function showToast(message, type = 'info', duration = 2500, opts = {}) {
  if (addToastFn) addToastFn({ message, type, duration, id: Date.now() + Math.random(), ...opts });
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  addToastFn = useCallback((toast) => {
    setToasts(prev => [...prev, toast]);
    if (toast.duration > 0) {
      setTimeout(() => dismiss(toast.id), toast.duration);
    }
  }, [dismiss]);

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`toast toast-${t.type} ${t.onClick ? 'toast-clickable' : ''} ${t.duration === 0 ? 'toast-persistent' : ''}`}
          onClick={() => {
            if (t.onClick) t.onClick();
            dismiss(t.id);
          }}
          style={t.onClick || t.duration === 0 ? { pointerEvents: 'auto', cursor: 'pointer' } : undefined}
        >
          <span className="toast-icon">
            {t.type === 'success' && '✓'}
            {t.type === 'error'   && '✕'}
            {t.type === 'warning' && '⚠'}
            {t.type === 'info'    && 'ℹ'}
          </span>
          <span className="toast-msg">
            {t.message}
            {t.actionLabel && <span className="toast-action">{t.actionLabel}</span>}
          </span>
          {t.duration === 0 && <span className="toast-close" onClick={(e) => { e.stopPropagation(); dismiss(t.id); }}>✕</span>}
        </div>
      ))}
    </div>
  );
}
