import React, { useEffect, useRef, useState } from 'react';

/**
 * AudioMonitor — Recibe chunks de audio (PCM Int16) vía eventos de ventana 
 * y los reproduce usando Web Audio API. 
 * Se usa en el Panel del Supervisor para la escucha en vivo.
 */
export default function AudioMonitor({ asesorId, activo }) {
  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!activo) {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
      return;
    }

    // Inicializar AudioContext
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    gain.connect(ctx.destination);
    
    audioCtxRef.current = ctx;
    gainRef.current = gain;

    const handleAudioData = (e) => {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current?.resume();
      }

      const chunk = e.detail; // ArrayBuffer o Buffer
      try {
        // Convertir PCM Int16 a Float32 para Web Audio
        const buf = audioCtxRef.current.createBuffer(1, chunk.length / 2, 44100);
        const data = buf.getChannelData(0);
        const view = new DataView(chunk instanceof ArrayBuffer ? chunk : chunk.buffer);
        
        for (let i = 0; i < data.length; i++) {
          data[i] = view.getInt16(i * 2, true) / 32768;
        }

        const src = audioCtxRef.current.createBufferSource();
        src.buffer = buf;
        src.connect(gainRef.current);
        src.start();
      } catch (err) {
        console.error('Error al reproducir chunk de audio:', err);
      }
    };

    window.addEventListener('supervisor:audio_data', handleAudioData);

    return () => {
      window.removeEventListener('supervisor:audio_data', handleAudioData);
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, [activo, asesorId]);

  if (!activo) return null;

  return (
    <div className="audio-monitor-status" style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: 8, 
      padding: '4px 12px', 
      background: 'rgba(var(--color-primary-rgb), 0.1)', 
      borderRadius: 16,
      border: '1px solid var(--color-primary)',
      fontSize: 12,
      color: 'var(--color-primary)',
      marginTop: 8
    }}>
      <span className="material-symbols-outlined pulse" style={{ fontSize: 16 }}>headset</span>
      Escuchando en vivo...
    </div>
  );
}
