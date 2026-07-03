import React, { useState, useEffect, useCallback } from 'react';
import { showToast } from '../shared/Toast';

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  if (!ws || ws === '127.0.0.1' || ws === 'localhost') return null;
  return (ws.startsWith('http') ? ws.replace(/\/$/, '') : `http://${ws}:3001`) + '/api';
}

const SEGMENTOS = [
  { key: 'TODOS',       label: 'Todos los asesores',    icon: 'groups',         color: '#00e676', gradient: 'linear-gradient(135deg,#00e676,#00bfa5)' },
  { key: 'MENSUALES',   label: 'Campaña Mensual',        icon: 'calendar_month', color: '#29b6f6', gradient: 'linear-gradient(135deg,#29b6f6,#1565c0)' },
  { key: 'QUINCENALES', label: 'Campaña Quincenal',      icon: 'event_repeat',   color: '#ce93d8', gradient: 'linear-gradient(135deg,#ce93d8,#7b1fa2)' },
  { key: 'TRAMO_0',     label: 'Tramo 0  ·  0 días',    icon: 'circle',         color: '#90a4ae', gradient: 'linear-gradient(135deg,#90a4ae,#546e7a)' },
  { key: 'TRAMO_1',     label: 'Tramo 1  ·  1-30 días', icon: 'trending_up',    color: '#ffd54f', gradient: 'linear-gradient(135deg,#ffd54f,#f9a825)' },
  { key: 'TRAMO_2',     label: 'Tramo 2  ·  31-60 días',icon: 'warning',        color: '#ffb74d', gradient: 'linear-gradient(135deg,#ffb74d,#e65100)' },
  { key: 'PLAZO',       label: 'Plazo  ·  +60 días',    icon: 'priority_high',  color: '#ef5350', gradient: 'linear-gradient(135deg,#ef5350,#b71c1c)' },
];

const SEGMENTO_META = Object.fromEntries(SEGMENTOS.map(s => [s.key, s]));

export default function MessagesConfig() {
  const [loading,   setLoading]   = useState(true);
  const [sending,   setSending]   = useState(false);
  const [mensaje,   setMensaje]   = useState('');
  const [segmento,  setSegmento]  = useState('TODOS');
  const [mensajes,  setMensajes]  = useState([]);
  const [expanded,  setExpanded]  = useState('activos');

  const cargarMensajes = useCallback(async () => {
    try {
      const apiBase   = buildApiBase();
      const authToken = localStorage.getItem('auth_token');
      let lista = [];
      if (apiBase) {
        const res = await fetch(`${apiBase}/mensajes-broadcast`, { headers: { Authorization: `Bearer ${authToken}` } });
        lista = await res.json();
      } else {
        lista = await window.api.invoke('db:getMensajesBroadcast');
      }
      setMensajes(Array.isArray(lista) ? lista : []);
    } catch {
      showToast('Error al cargar mensajes', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarMensajes(); }, [cargarMensajes]);

  // ── Tiempo real: escuchar eventos WS desde el main process ──────────
  useEffect(() => {
    const removeListener = window.api?.on?.('ws:message', (data) => {
      if (
        data?.tipo === 'NUEVO_MENSAJE_SUPERVISOR' ||
        data?.tipo === 'MENSAJE_DESACTIVADO'      ||
        data?.tipo === 'MENSAJE_BROADCAST'
      ) {
        cargarMensajes();
      }
    });
    return () => removeListener?.();
  }, [cargarMensajes]);

  async function handleEnviar() {
    if (!mensaje.trim()) { showToast('Escribe el mensaje antes de enviar', 'warning'); return; }
    setSending(true);
    try {
      const apiBase   = buildApiBase();
      const authToken = localStorage.getItem('auth_token');
      if (apiBase) {
        await fetch(`${apiBase}/mensajes-broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ mensaje: mensaje.trim(), segmento_destino: segmento }),
        });
      } else {
        const user = JSON.parse(localStorage.getItem('uphone_user') || '{}');
        await window.api.invoke('db:insertMensajeBroadcast', user.id, mensaje.trim(), segmento);
      }
      showToast('Mensaje enviado a los gestores ✓', 'success');
      setMensaje('');
      await cargarMensajes();
      setExpanded('activos');
    } catch {
      showToast('Error al enviar el mensaje', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleDesactivar(id) {
    try {
      const apiBase   = buildApiBase();
      const authToken = localStorage.getItem('auth_token');
      if (apiBase) {
        await fetch(`${apiBase}/mensajes-broadcast/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } });
      } else {
        await window.api.invoke('db:deleteMensajeBroadcast', id);
      }
      showToast('Mensaje desactivado', 'info');
      await cargarMensajes();
    } catch {
      showToast('Error al desactivar', 'error');
    }
  }

  const activos     = mensajes.filter(m => m.activo !== 0);
  const efectivos   = mensajes.filter(m => m.activo === 0 && (m.pagos_posteriores ?? 0) > 0);
  const noEfectivos = mensajes.filter(m => m.activo === 0 && (m.pagos_posteriores ?? 0) === 0);

  const segActivo = SEGMENTO_META[segmento] || {};

  /* ── Badge de segmento ──────────────────────────────────────────────── */
  function SegmentoBadge({ keyVal }) {
    const meta = SEGMENTO_META[keyVal] || {};
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 11px', borderRadius: 20,
        background: `${meta.color || '#888'}18`,
        border: `1.5px solid ${meta.color || '#888'}50`,
        color: meta.color || '#aaa',
        fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
        textTransform: 'uppercase',
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{meta.icon || 'label'}</span>
        {meta.label || keyVal}
      </span>
    );
  }

  /* ── Tarjeta de mensaje ─────────────────────────────────────────────── */
  function MensajeCard({ m, showDelete }) {
    const meta = SEGMENTO_META[m.segmento_destino] || {};
    return (
      <div style={{
        position: 'relative',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: `3px solid ${meta.color || '#555'}`,
        borderRadius: 12,
        padding: '14px 18px',
        display: 'flex', flexDirection: 'column', gap: 12,
        transition: 'box-shadow 0.2s',
      }}>
        {/* Meta-row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SegmentoBadge keyVal={m.segmento_destino} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: 0.45, fontSize: 11 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>person</span>
            {m.supervisor_nombre || 'Supervisor'}
          </div>
          <div style={{ marginLeft: 'auto', opacity: 0.3, fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>schedule</span>
            {m.creado_en ? new Date(m.creado_en).toLocaleString('es-EC', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : ''}
          </div>
        </div>

        {/* Contenido del mensaje */}
        <p style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.7,
          color: 'rgba(255,255,255,0.82)',
          background: 'rgba(0,0,0,0.25)',
          borderRadius: 10,
          padding: '12px 16px',
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          letterSpacing: 0.15,
        }}>
          {m.mensaje}
        </p>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          {(m.pagos_posteriores ?? 0) > 0 && (
            <span style={{
              fontSize: 10.5, color: '#00e676',
              background: 'rgba(0,230,118,0.1)',
              border: '1px solid rgba(0,230,118,0.25)',
              borderRadius: 20, padding: '3px 10px',
              display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>check_circle</span>
              {m.pagos_posteriores} pago(s)
            </span>
          )}
          {showDelete && (
            <button
              onClick={() => handleDesactivar(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'rgba(239,83,80,0.1)',
                border: '1px solid rgba(239,83,80,0.3)',
                color: '#ef5350',
                borderRadius: 20, padding: '4px 12px',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
                transition: 'all 0.18s',
                outline: 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,83,80,0.22)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,83,80,0.1)'; }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>cancel</span>
              Desactivar
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ── Acordeón ───────────────────────────────────────────────────────── */
  function Acordeon({ id, label, icon, color, count, children }) {
    const open = expanded === id;
    return (
      <div style={{
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: 8,
        background: open ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.015)',
        border: `1px solid ${open ? `${color}35` : 'rgba(255,255,255,0.06)'}`,
        transition: 'border-color 0.2s',
      }}>
        <button
          onClick={() => setExpanded(open ? null : id)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 18px', background: 'transparent', border: 'none',
            cursor: 'pointer', textAlign: 'left', outline: 'none',
          }}
        >
          {/* Dot indicator */}
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: color, flexShrink: 0,
            boxShadow: open ? `0 0 8px ${color}` : 'none',
            transition: 'box-shadow 0.2s',
          }} />
          <span className="material-symbols-outlined" style={{ fontSize: 18, color, flexShrink: 0 }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.88)', letterSpacing: 0.3 }}>
            {label}
          </span>
          {/* Badge count */}
          <span style={{
            marginLeft: 4,
            background: count > 0 ? color : 'rgba(255,255,255,0.1)',
            color: count > 0 ? '#000' : 'rgba(255,255,255,0.4)',
            borderRadius: 20, padding: '1px 9px',
            fontSize: 11, fontWeight: 800,
            minWidth: 22, textAlign: 'center',
          }}>
            {count}
          </span>
          <span className="material-symbols-outlined" style={{ fontSize: 18, marginLeft: 'auto', opacity: 0.35, color: 'white' }}>
            {open ? 'expand_less' : 'expand_more'}
          </span>
        </button>

        {open && (
          <div style={{ padding: '0 14px 14px' }}>
            <div style={{ height: 1, background: `${color}25`, marginBottom: 14 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {count === 0 ? (
                <div style={{
                  textAlign: 'center', padding: '24px 0', opacity: 0.35,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 30 }}>inbox</span>
                  <p style={{ margin: 0, fontSize: 12 }}>Sin mensajes en esta categoría</p>
                </div>
              ) : children}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <span className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  return (
    <div style={{ padding: '28px 28px 40px', maxWidth: 820, margin: '0 auto' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: 'linear-gradient(135deg,#00e676,#00bfa5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,230,118,0.3)',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#000' }}>campaign</span>
        </div>
        <div>
          <h3 style={{ margin: '0 0 5px', fontSize: 20, fontWeight: 800, letterSpacing: -0.3, color: '#fff' }}>
            Mensajes para Gestores
          </h3>
          <p style={{ margin: 0, fontSize: 12.5, opacity: 0.45, lineHeight: 1.5, maxWidth: 480 }}>
            Redacta el mensaje que los gestores deben enviar a su cartera, elige el tramo de trabajo y envíalo en tiempo real.
          </p>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={cargarMensajes}
          style={{ marginLeft: 'auto', flexShrink: 0, opacity: 0.5 }}
          title="Recargar"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
        </button>
      </div>

      {/* ── Compositor ──────────────────────────────────────────────────── */}
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: 22,
        marginBottom: 28,
        boxShadow: '0 4px 32px rgba(0,0,0,0.2)',
      }}>

        {/* Label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#00e676' }}>edit_note</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>
            Nuevo Mensaje
          </span>
        </div>

        {/* Segmento Destino */}
        <div style={{ marginBottom: 18 }}>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, opacity: 0.4, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            Segmento Destino
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SEGMENTOS.map(s => {
              const active = segmento === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setSegmento(s.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 22,
                    border: `1.5px solid ${active ? s.color : 'rgba(255,255,255,0.1)'}`,
                    background: active ? `${s.color}20` : 'transparent',
                    color: active ? s.color : 'rgba(255,255,255,0.5)',
                    fontSize: 12, fontWeight: active ? 700 : 400,
                    cursor: 'pointer', outline: 'none',
                    transition: 'all 0.18s ease',
                    boxShadow: active ? `0 0 12px ${s.color}30` : 'none',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{s.icon}</span>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Textarea */}
        <div style={{ marginBottom: 18, position: 'relative' }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, opacity: 0.4, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            Redactar Mensaje
          </p>
          <textarea
            value={mensaje}
            onChange={e => setMensaje(e.target.value)}
            rows={4}
            style={{
              width: '100%',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 12,
              padding: '14px 16px',
              color: 'rgba(255,255,255,0.9)',
              fontSize: 13.5,
              lineHeight: 1.7,
              fontFamily: 'inherit',
              resize: 'vertical',
              minHeight: 110,
              outline: 'none',
              transition: 'border-color 0.18s',
              boxSizing: 'border-box',
            }}
            onFocus={e => { e.target.style.borderColor = segActivo.color || 'rgba(0,230,118,0.5)'; }}
            onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
            placeholder="Escribe el mensaje que los gestores deben enviar a sus clientes…"
          />
          {mensaje.trim() && (
            <span style={{
              position: 'absolute', bottom: 10, right: 12,
              fontSize: 10, opacity: 0.3,
            }}>
              {mensaje.length} chars
            </span>
          )}
        </div>

        {/* Botón enviar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 20,
              background: `${segActivo.color || '#00e676'}15`,
              border: `1.5px solid ${segActivo.color || '#00e676'}40`,
              color: segActivo.color || '#00e676',
              fontSize: 11, fontWeight: 700,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{segActivo.icon || 'groups'}</span>
              {segActivo.label || 'Todos'}
            </span>
          </div>

          <button
            onClick={handleEnviar}
            disabled={sending || !mensaje.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 24px', borderRadius: 22,
              background: sending || !mensaje.trim()
                ? 'rgba(255,255,255,0.08)'
                : 'linear-gradient(135deg,#00e676,#00bfa5)',
              border: 'none',
              color: sending || !mensaje.trim() ? 'rgba(255,255,255,0.3)' : '#000',
              fontSize: 13, fontWeight: 800,
              cursor: sending || !mensaje.trim() ? 'not-allowed' : 'pointer',
              boxShadow: !sending && mensaje.trim() ? '0 4px 18px rgba(0,230,118,0.35)' : 'none',
              transition: 'all 0.2s ease',
              outline: 'none',
            }}
          >
            {sending ? (
              <><span className="spinner" style={{ width: 15, height: 15, borderColor: 'rgba(255,255,255,0.4)', borderTopColor: '#fff' }} /> Enviando…</>
            ) : (
              <><span className="material-symbols-outlined" style={{ fontSize: 17 }}>send</span> Enviar a Gestores</>
            )}
          </button>
        </div>
      </div>

      {/* ── Acordeones de estado ─────────────────────────────────────────── */}
      <div>
        <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>
          Estado de Mensajes
        </p>

        <Acordeon id="activos" label="Mensajes Activos" icon="notifications_active" color="#00e676" count={activos.length}>
          {activos.map(m => <MensajeCard key={m.id} m={m} showDelete />)}
        </Acordeon>

        <Acordeon id="efectivos" label="Mensajes Efectivos" icon="trending_up" color="#29b6f6" count={efectivos.length}>
          {efectivos.map(m => <MensajeCard key={m.id} m={m} />)}
        </Acordeon>

        <Acordeon id="no_efectivos" label="Mensajes No Efectivos" icon="trending_down" color="#ef5350" count={noEfectivos.length}>
          {noEfectivos.map(m => <MensajeCard key={m.id} m={m} />)}
        </Acordeon>
      </div>

    </div>
  );
}
