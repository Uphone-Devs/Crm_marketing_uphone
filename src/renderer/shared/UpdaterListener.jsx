import React, { useEffect, useState } from 'react';

/**
 * Escucha 'updater:downloaded' del main y muestra un aviso persistente
 * con botón "Reiniciar ahora" → updater:restartNow (quitAndInstall).
 */
export default function UpdaterListener() {
  const [version, setVersion] = useState(null);

  useEffect(() => {
    const off = window.api.on('updater:downloaded', ({ version }) => setVersion(version));
    // El evento puede haber salido antes de que este componente existiera
    // (instalador ya en cache -> se emite al instante tras el login, y el
    // panel se monta ~2.8s despues). Preguntamos al main si hay una version
    // esperando, en vez de depender de llegar a tiempo al evento.
    window.api.invoke('updater:pendiente')
      .then(r => { if (r?.version) setVersion(r.version); })
      .catch(() => {});
    return off;
  }, []);

  if (!version) return null;

  const restart = () => window.api.invoke('updater:restartNow').catch(() => {});

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      background: '#1e1e1e', color: '#fff', padding: '14px 18px',
      borderRadius: 10, boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', gap: 14, maxWidth: 360,
    }}>
      <span>Actualización {version} lista.</span>
      <button
        onClick={restart}
        style={{
          background: '#00e676', color: '#000', border: 'none',
          borderRadius: 6, padding: '8px 12px', fontWeight: 700, cursor: 'pointer',
        }}
      >
        Reiniciar ahora
      </button>
    </div>
  );
}
