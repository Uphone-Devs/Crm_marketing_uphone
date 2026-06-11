import React, { useState, useEffect, useRef } from 'react';

/**
 * AudioPlayer — Componente para reproducir archivos .opus locales.
 * Solicita el buffer al proceso Main vía IPC y crea un Blob URL.
 */
export default function AudioPlayer({ audioPath, onStatusChange }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!audioPath) return;

    async function loadAudio() {
      setLoading(true);
      setError(null);
      try {
        const result = await window.api.invoke('recorder:getBuffer', audioPath);
        if (result.error) {
          setError(result.error);
        } else {
          // Convertir Buffer de Node a Blob de navegador
          const blob = new Blob([result.buffer], { type: 'audio/ogg; codecs=opus' });
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadAudio();

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [audioPath]);

  if (error) {
    return (
      <div className="audio-player-error">
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>error</span>
        <span className="text-label-sm">{error}</span>
      </div>
    );
  }

  if (loading) {
    return <div className="audio-player-loading"><span className="spinner-sm" /></div>;
  }

  return (
    <div className="audio-player">
      {blobUrl ? (
        <audio 
          ref={audioRef} 
          controls 
          src={blobUrl} 
          className="custom-audio-controls"
          style={{ height: 32, borderRadius: 16 }}
        />
      ) : (
        <span className="text-label-sm" style={{ opacity: 0.5 }}>Sin audio</span>
      )}
    </div>
  );
}
