import React, { useState, useEffect, useCallback, useRef } from 'react';
import { showToast } from '../shared/Toast';

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  return (ws.startsWith('http') ? ws.replace(/\/$/, '') : `http://${ws}:3001`) + '/api';
}

const CANALES = [
  { id: 'WSP',          label: 'WhatsApp',     icon: 'chat',         color: '#25D366' },
  { id: 'RCS',          label: 'RCS',           icon: 'sms',          color: '#64b5f6' },
  { id: 'CORREO',       label: 'Correo',        icon: 'email',        color: '#f48fb1' },
  { id: 'COMPROMISOS',  label: 'Compromisos',   icon: 'handshake',    color: '#ffb74d' },
];

const SEGMENTOS = [
  { id: 'TRAMO_0', label: 'Tramo 0', sub: '0 días',   color: '#90a4ae' },
  { id: 'TRAMO_1', label: 'Tramo 1', sub: '1 día',    color: '#ffd54f' },
  { id: 'TRAMO_2', label: 'Tramo 2', sub: '2+ días',  color: '#ffb74d' },
  { id: 'TODOS',   label: 'General', sub: 'todos',     color: '#ce93d8' },
];

function CanalTab({ c, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '7px 16px', borderRadius: 8,
        border: 'none', outline: 'none',
        background: active ? `${c.color}14` : 'transparent',
        color: active ? c.color : 'rgba(255,255,255,0.35)',
        cursor: 'pointer', font: 'inherit',
        borderBottom: `2px solid ${active ? c.color : 'transparent'}`,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{c.icon}</span>
      <span style={{ fontSize: 13, fontWeight: active ? 700 : 400 }}>{c.label}</span>
    </button>
  );
}

function SegmentoChip({ s, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 12px', borderRadius: 20,
        border: `1px solid ${active ? s.color + '66' : 'rgba(255,255,255,0.08)'}`,
        background: active ? `${s.color}10` : 'transparent',
        color: active ? s.color : 'rgba(255,255,255,0.4)',
        fontSize: 12, fontWeight: active ? 700 : 400,
        cursor: 'pointer', font: 'inherit', transition: 'all 0.15s',
      }}
    >
      {s.label}
      <span style={{ opacity: 0.45, fontSize: 10 }}>{s.sub}</span>
    </button>
  );
}

function MensajeCard({ m, onDesactivar }) {
  const canal  = CANALES.find(c => c.id === m.canal)    || { color: '#888', icon: 'chat',  label: m.canal || 'General' };
  const seg    = SEGMENTOS.find(s => s.id === m.segmento_destino) || { color: '#888', label: m.segmento_destino };
  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)',
      border: `1px solid rgba(255,255,255,0.06)`,
      borderLeft: `3px solid ${canal.color}`,
      borderRadius: 12, padding: '14px 18px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 10px', borderRadius: 20,
          background: `${canal.color}18`, border: `1px solid ${canal.color}40`,
          color: canal.color, fontSize: 12, fontWeight: 700,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{canal.icon}</span>
          {canal.label}
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 10px', borderRadius: 20,
          background: `${seg.color}18`, border: `1px solid ${seg.color}40`,
          color: seg.color, fontSize: 12, fontWeight: 700,
        }}>
          {seg.label}
        </span>
        <span style={{ marginLeft: 'auto', opacity: 0.3, fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>person</span>
          {m.supervisor_nombre || 'Jefe'}
          <span className="material-symbols-outlined" style={{ fontSize: 12, marginLeft: 6 }}>schedule</span>
          {m.creado_en ? new Date(String(m.creado_en).replace(' ', 'T').replace(/Z$/i, '').replace(/\.\d+$/, '')).toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
      </div>

      <p style={{
        margin: 0, fontSize: 13, lineHeight: 1.7,
        color: 'rgba(255,255,255,0.82)',
        background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '10px 14px',
        whiteSpace: 'pre-wrap', fontFamily: 'inherit',
      }}>
        {m.mensaje}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        {(m.pagos_posteriores ?? 0) > 0 && (
          <span style={{
            fontSize: 12, color: '#00e676', background: 'rgba(0,230,118,0.1)',
            border: '1px solid rgba(0,230,118,0.25)', borderRadius: 20, padding: '3px 10px',
            display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>check_circle</span>
            {m.pagos_posteriores} pago(s)
          </span>
        )}
        {onDesactivar && (
          <button type="button" onClick={() => onDesactivar(m.id)} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(239,83,80,0.08)', border: '1px solid rgba(239,83,80,0.25)',
            color: '#ef5350', borderRadius: 20, padding: '4px 12px',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>cancel</span>
            Desactivar
          </button>
        )}
      </div>
    </div>
  );
}

export default function MessagesConfig() {
  const [loading,   setLoading]   = useState(true);
  const [sending,   setSending]   = useState(false);
  const [mensaje,   setMensaje]   = useState('');
  const [canal,     setCanal]     = useState('WSP');
  const [segmento,  setSegmento]  = useState('TRAMO_0');
  const [mensajes,  setMensajes]  = useState([]);
  const [asunto,    setAsunto]    = useState('');
  const [imagenUrl, setImagenUrl] = useState('');
  const textareaRef = useRef(null);

  const VARIABLES = [
    { key: '{nombre}',   label: 'Nombre' },
    { key: '{deuda}',    label: 'Deuda' },
    { key: '{dias}',     label: 'Días mora' },
    { key: '{telefono}', label: 'Teléfono' },
    { key: '{cedula}',   label: 'Cédula' },
  ];

  const insertarVariable = (v) => {
    const el = textareaRef.current;
    if (!el) { setMensaje(p => p + v); return; }
    const start = el.selectionStart; const end = el.selectionEnd;
    const next = mensaje.slice(0, start) + v + mensaje.slice(end);
    setMensaje(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + v.length, start + v.length); });
  };

  const canalConImagen = canal === 'CORREO' || canal === 'RCS';

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

  useEffect(() => {
    const removeListener = window.api?.on?.('ws:message', (data) => {
      if (data?.tipo === 'NUEVO_MENSAJE_BROADCAST' || data?.tipo === 'MENSAJE_BROADCAST_DESACTIVADO') {
        cargarMensajes();
      }
    });
    return () => removeListener?.();
  }, [cargarMensajes]);

  // Pre-cargar mensaje activo al cambiar selección
  useEffect(() => {
    const activo = mensajes.find(m =>
      (m.activo === 1 || m.activo === true) &&
      m.canal === canal &&
      m.segmento_destino === segmento
    );
    setMensaje(activo ? activo.mensaje : '');
    setAsunto(activo?.asunto || '');
    setImagenUrl(activo?.imagen_url || '');
  }, [canal, segmento, mensajes]);

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
          body: JSON.stringify({
            mensaje:         mensaje.trim(),
            segmento_destino: segmento,
            canal,
            asunto:          canal === 'CORREO' ? asunto.trim() || null : null,
            imagen_url:      (canal === 'CORREO' || canal === 'RCS') ? imagenUrl.trim() || null : null,
          }),
        });
      } else {
        const user = JSON.parse(localStorage.getItem('uphone_user') || '{}');
        await window.api.invoke('db:insertMensajeBroadcast', user.id, mensaje.trim(), segmento);
      }
      showToast('Mensaje enviado ✓', 'success');
      await cargarMensajes();
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

  const [filtroCanal,    setFiltroCanal]    = useState('');
  const [filtroSegmento, setFiltroSegmento] = useState('');
  const [filtroFecha,    setFiltroFecha]    = useState('');

  const canalMeta    = CANALES.find(c => c.id === canal)    || CANALES[0];
  const segmentoMeta = SEGMENTOS.find(s => s.id === segmento) || SEGMENTOS[0];
  const activoActual = mensajes.find(m =>
    (m.activo === 1 || m.activo === true) &&
    m.canal === canal && m.segmento_destino === segmento
  );

  const aplicarFiltros = (lista) => lista.filter(m => {
    if (filtroCanal    && m.canal            !== filtroCanal)    return false;
    if (filtroSegmento && m.segmento_destino !== filtroSegmento) return false;
    if (filtroFecha) {
      const fechaMsg = String(m.creado_en).slice(0, 10);
      if (fechaMsg !== filtroFecha) return false;
    }
    return true;
  });

  const activos   = aplicarFiltros(mensajes.filter(m => m.activo !== 0));
  const inactivos = aplicarFiltros(mensajes.filter(m => m.activo === 0));

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <span className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 24px 48px', maxWidth: 820, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 22 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.9)', letterSpacing: -0.2 }}>
            Mensajes para Gestores
          </h3>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.3)', lineHeight: 1.4 }}>
            Configura el mensaje por canal y tramo de deuda
          </p>
        </div>
        <button type="button" onClick={cargarMensajes}
          style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', padding: 4 }}
          title="Recargar"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>refresh</span>
        </button>
      </div>

      {/* Compositor */}
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 14, marginBottom: 24,
      }}>
        {/* Canal tabs */}
        <div style={{
          display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)',
          padding: '0 8px',
        }}>
          {CANALES.map(c => (
            <CanalTab key={c.id} c={c} active={canal === c.id} onClick={() => setCanal(c.id)} />
          ))}
        </div>

        <div style={{ padding: '16px 20px' }}>
          {/* Segmento */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', flexShrink: 0 }}>Segmento</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SEGMENTOS.map(s => (
                <SegmentoChip key={s.id} s={s} active={segmento === s.id} onClick={() => setSegmento(s.id)} />
              ))}
            </div>
            {activoActual && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#00e676', display: 'flex', alignItems: 'center', gap: 3, fontWeight: 600, flexShrink: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }}>check_circle</span>activo
              </span>
            )}
          </div>

          {/* Step 3 label */}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', marginBottom: 10 }}>Mensaje</div>

        {/* Asunto — solo CORREO */}
        {canal === 'CORREO' && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, opacity: 0.4, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>Asunto</p>
            <input
              type="text"
              value={asunto}
              onChange={e => setAsunto(e.target.value)}
              placeholder="Asunto del correo…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(0,0,0,0.3)',
                border: `1.5px solid ${asunto.trim() ? '#f48fb160' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 10, padding: '10px 14px',
                color: 'rgba(255,255,255,0.9)', fontSize: 13, fontFamily: 'inherit',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => { e.target.style.borderColor = '#f48fb180'; }}
              onBlur={e => { e.target.style.borderColor = asunto.trim() ? '#f48fb160' : 'rgba(255,255,255,0.08)'; }}
            />
          </div>
        )}


        <textarea
          ref={textareaRef}
          value={mensaje}
          onChange={e => setMensaje(e.target.value)}
          rows={4}
          placeholder={`Escribe el mensaje para ${canalMeta.label} · ${segmentoMeta.label}…`}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(0,0,0,0.3)',
            border: `1.5px solid ${mensaje.trim() ? canalMeta.color + '60' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 12, padding: '13px 16px',
            color: 'rgba(255,255,255,0.9)', fontSize: 13.5, lineHeight: 1.7,
            fontFamily: 'inherit', resize: 'vertical', minHeight: 110,
            transition: 'border-color 0.2s',
            marginBottom: 8,
          }}
          onFocus={e => { e.target.style.borderColor = canalMeta.color + '80'; }}
          onBlur={e => { e.target.style.borderColor = mensaje.trim() ? canalMeta.color + '60' : 'rgba(255,255,255,0.08)'; }}
        />

        {/* Variables clickeables */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', alignSelf: 'center', marginRight: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Variables</span>
          {VARIABLES.map(v => (
            <button key={v.key} type="button" onClick={() => insertarVariable(v.key)}
              title={`Insertar ${v.key}`}
              style={{
                fontSize: 11, padding: '2px 9px', borderRadius: 20, cursor: 'pointer',
                border: `1px solid ${canalMeta.color}44`,
                background: `${canalMeta.color}0e`,
                color: canalMeta.color, font: 'inherit', fontWeight: 600,
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${canalMeta.color}20`; }}
              onMouseLeave={e => { e.currentTarget.style.background = `${canalMeta.color}0e`; }}
            >{v.key}</button>
          ))}
        </div>

        {/* Imagen — CORREO y RCS, después del mensaje */}
        {canalConImagen && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ margin: '0 0 6px', fontSize: 11, opacity: 0.4, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>Imagen ({canalMeta.label}) (opcional)</p>
            {imagenUrl ? (
              <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1.5px solid #f48fb150' }}>
                <img src={imagenUrl} alt="preview" style={{ width: '100%', maxHeight: 180, objectFit: 'contain', display: 'block', background: 'rgba(0,0,0,0.3)' }} />
                <button type="button" onClick={() => setImagenUrl('')} style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 20, padding: '4px 10px', color: '#fff',
                  fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                  Quitar
                </button>
              </div>
            ) : (
              <label style={{
                display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10,
                padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                border: '1.5px dashed rgba(244,143,177,0.35)', background: 'rgba(244,143,177,0.04)',
                transition: 'border-color 0.2s, background 0.2s',
              }}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#f48fb1'; e.currentTarget.style.background = 'rgba(244,143,177,0.1)'; }}
                onDragLeave={e => { e.currentTarget.style.borderColor = 'rgba(244,143,177,0.35)'; e.currentTarget.style.background = 'rgba(244,143,177,0.04)'; }}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = 'rgba(244,143,177,0.35)';
                  e.currentTarget.style.background = 'rgba(244,143,177,0.04)';
                  const file = e.dataTransfer.files[0];
                  if (!file || !file.type.startsWith('image/')) return;
                  const reader = new FileReader();
                  reader.onload = ev => setImagenUrl(ev.target.result);
                  reader.readAsDataURL(file);
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#f48fb1', opacity: 0.7, flexShrink: 0 }}>add_photo_alternate</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Arrastra o haz clic · <span style={{ opacity: 0.5 }}>JPG PNG GIF WebP</span></span>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                  const file = e.target.files[0]; if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => setImagenUrl(ev.target.result);
                  reader.readAsDataURL(file);
                }} />
              </label>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={handleEnviar} disabled={sending || !mensaje.trim()} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 26px', borderRadius: 22, border: 'none',
            background: sending || !mensaje.trim()
              ? 'rgba(255,255,255,0.07)'
              : `linear-gradient(135deg, ${canalMeta.color}, ${canalMeta.color}bb)`,
            color: sending || !mensaje.trim() ? 'rgba(255,255,255,0.25)' : '#000',
            fontSize: 13, fontWeight: 800, cursor: sending || !mensaje.trim() ? 'not-allowed' : 'pointer',
            boxShadow: !sending && mensaje.trim() ? `0 4px 18px ${canalMeta.color}40` : 'none',
            transition: 'all 0.2s ease',
          }}>
            {sending
              ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Enviando…</>
              : <><span className="material-symbols-outlined" style={{ fontSize: 16 }}>send</span> Enviar a Gestores</>
            }
          </button>
        </div>
        </div>{/* end padding div */}
      </div>{/* end compositor */}

      {/* ── Historial ─────────────────────────────────────────────────────── */}
      <div>
        {/* Filtros */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          marginBottom: 16, padding: '12px 16px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, opacity: 0.4 }}>filter_list</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, opacity: 0.35, textTransform: 'uppercase' }}>Filtrar historial</span>

          {/* Canal */}
          <select
            value={filtroCanal}
            onChange={e => setFiltroCanal(e.target.value)}
            style={{
              background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '5px 10px', color: filtroCanal ? '#fff' : 'rgba(255,255,255,0.4)',
              fontSize: 12, cursor: 'pointer',
            }}
          >
            <option value="">Todos los canales</option>
            {CANALES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>

          {/* Segmento */}
          <select
            value={filtroSegmento}
            onChange={e => setFiltroSegmento(e.target.value)}
            style={{
              background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '5px 10px', color: filtroSegmento ? '#fff' : 'rgba(255,255,255,0.4)',
              fontSize: 12, cursor: 'pointer',
            }}
          >
            <option value="">Todos los segmentos</option>
            {SEGMENTOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>

          {/* Fecha */}
          <input
            type="date"
            value={filtroFecha}
            onChange={e => setFiltroFecha(e.target.value)}
            style={{
              background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '5px 10px',
              color: filtroFecha ? '#fff' : 'rgba(255,255,255,0.4)',
              fontSize: 12, colorScheme: 'dark',
            }}
          />

          {(filtroCanal || filtroSegmento || filtroFecha) && (
            <button type="button"
              onClick={() => { setFiltroCanal(''); setFiltroSegmento(''); setFiltroFecha(''); }}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '5px 10px', color: 'rgba(255,255,255,0.5)',
                fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>close</span>
              Limpiar
            </button>
          )}
        </div>

        {/* Activos */}
        {activos.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, letterSpacing: 1, color: '#00e676', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>notifications_active</span>
              Activos ({activos.length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activos.map(m => <MensajeCard key={m.id} m={m} onDesactivar={handleDesactivar} />)}
            </div>
          </div>
        )}

        {activos.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0', opacity: 0.3, fontSize: 13 }}>
            Sin mensajes activos para los filtros seleccionados
          </div>
        )}

        {/* Historial inactivos */}
        {inactivos.length > 0 && (
          <details>
            <summary style={{
              cursor: 'pointer', fontSize: 11, fontWeight: 800, letterSpacing: 1,
              color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase',
              listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 0', userSelect: 'none',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>history</span>
              Historial inactivos ({inactivos.length})
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              {inactivos.map(m => <MensajeCard key={m.id} m={m} />)}
            </div>
          </details>
        )}
      </div>

    </div>
  );
}
