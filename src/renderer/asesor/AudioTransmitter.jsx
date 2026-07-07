import React, { useState, useEffect, useRef } from 'react';
import './AudioTransmitter.css';

const VU_BARS = 20;

export default function AudioTransmitter() {
  const [activo, setActivo] = useState(false);
  const [volumen, setVolumen] = useState(80);
  const [vuLevels, setVuLevels] = useState(() => Array(VU_BARS).fill(0));
  const [error, setError] = useState(null);
  const [noSoportado, setNoSoportado] = useState(false);
  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);
  const unsubRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    // Suscribirse a chunks de audio del main process
    unsubRef.current = window.api.on('audio:chunk', (chunk) => {
      if (!audioCtxRef.current) return;
      try {
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
      } catch (e) { /* ignorar errores de decode */ }
    });

    window.api.on('audio:error', (msg) => {
      setError(msg);
      setActivo(false);
      setNoSoportado(true);
    });

    return () => {
      unsubRef.current?.();
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volumen / 100;
  }, [volumen]);

  function animateVU() {
    // Simular VU meter con valores aleatorios cuando está activo
    if (activo) {
      setVuLevels(prev =>
        prev.map((_, i) => {
          const target = activo ? Math.random() * (i < 5 ? 0.9 : Math.random() * 0.6) : 0;
          return target;
        })
      );
      animFrameRef.current = setTimeout(animateVU, 80);
    } else {
      setVuLevels(Array(VU_BARS).fill(0));
    }
  }

  useEffect(() => {
    if (activo) {
      animFrameRef.current = setTimeout(animateVU, 80);
    } else {
      clearTimeout(animFrameRef.current);
      setVuLevels(Array(VU_BARS).fill(0));
    }
    return () => clearTimeout(animFrameRef.current);
  }, [activo]);

  async function toggleAudio() {
    if (activo) {
      await window.api.invoke('audio:stop');
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      gainRef.current = null;
      setActivo(false);
      setError(null);
    } else {
      setError(null);
      const ctx = new AudioContext({ sampleRate: 44100 });
      const gain = ctx.createGain();
      gain.gain.value = volumen / 100;
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainRef.current = gain;

      const result = await window.api.invoke('audio:start');
      if (result.success) {
        setActivo(true);
      } else {
        setError(result.error || 'No se pudo iniciar audio');
        setNoSoportado(true);
        ctx.close();
        audioCtxRef.current = null;
      }
    }
  }

  return (
    <div className="audio-transmitter card">
      <p className="section-title">Transmisión de Audio</p>

      <div className="vu-meter">
        {vuLevels.map((level, i) => (
          <div
            key={i}
            className="vu-bar"
            style={{ height: `${Math.max(3, level * 100)}%`, opacity: activo ? 1 : 0.2 }}
          />
        ))}
      </div>

      {noSoportado && (
        <div className="audio-warning">
          ⚠ Dispositivo no compatible con audio — modo visual activo
        </div>
      )}

      {error && !noSoportado && (
        <div className="audio-error">✕ {error}</div>
      )}

      <div className="audio-controls">
        <button type="button"
          id="btn-audio-toggle"
          className={`btn ${activo ? 'btn-danger' : 'btn-primary'} audio-toggle`}
          onClick={toggleAudio}
        >
          {activo ? '⏹ Detener Audio' : '▶ Iniciar Audio'}
        </button>

        <div className="volumen-control">
          <span className="volumen-label">🔊 {volumen}%</span>
          <input aria-label="Campo"
            id="slider-volumen"
            type="range"
            min="0"
            max="100"
            value={volumen}
            onChange={e => setVolumen(Number(e.target.value))}
            className="volumen-slider"
          />
        </div>
      </div>
    </div>
  );
}
