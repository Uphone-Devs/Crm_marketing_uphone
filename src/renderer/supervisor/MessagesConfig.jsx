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
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 18px', border: 'none', outline: 'none',
        background: active ? `${c.color}18` : 'transparent',
        color: active ? c.color : 'rgba(255,255,255,0.3)',
        cursor: 'pointer', font: 'inherit',
        borderBottom: `2px solid ${active ? c.color : 'transparent'}`,
        transition: 'all 0.15s', flexShrink: 0,
      }}
      onMouseEnter={e => { if (!active) { e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; e.currentTarget.style.background = 'transparent'; } }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 15, opacity: active ? 1 : 0.7 }}>{c.icon}</span>
      <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 400, letterSpacing: active ? '0.01em' : 0 }}>{c.label}</span>
    </button>
  );
}

function SegmentoChip({ s, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 11px', borderRadius: 20,
        border: `1px solid ${active ? s.color + '55' : 'rgba(255,255,255,0.07)'}`,
        background: active ? `${s.color}12` : 'transparent',
        color: active ? s.color : 'rgba(255,255,255,0.35)',
        fontSize: 11.5, fontWeight: active ? 700 : 400,
        cursor: 'pointer', font: 'inherit', transition: 'all 0.12s',
      }}
    >
      {s.label}
      <span style={{ opacity: 0.4, fontSize: 9.5 }}>{s.sub}</span>
    </button>
  );
}

function MensajeCard({ m, onDesactivar }) {
  const canal  = CANALES.find(c => c.id === m.canal)    || { color: '#888', icon: 'chat',  label: m.canal || 'General' };
  const seg    = SEGMENTOS.find(s => s.id === m.segmento_destino) || { color: '#888', label: m.segmento_destino };
  const fecha  = m.creado_en ? new Date(String(m.creado_en).replace(' ', 'T').replace(/Z$/i, '').replace(/\.\d+$/, '')).toLocaleString('es-EC', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', borderRadius: 10,
      border: `1px solid rgba(255,255,255,0.06)`,
      borderLeft: `2px solid ${canal.color}88`,
      padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 20,
          background: `${canal.color}14`, color: canal.color, fontSize: 11, fontWeight: 700,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 11 }}>{canal.icon}</span>
          {canal.label}
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '2px 8px', borderRadius: 20,
          background: `${seg.color}14`, color: seg.color, fontSize: 11, fontWeight: 700,
        }}>{seg.label}</span>
        <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.25)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 11 }}>person</span>
          {m.supervisor_nombre || 'Jefe'}
          {fecha && <><span style={{ margin: '0 3px', opacity: 0.4 }}>·</span>{fecha}</>}
        </span>
      </div>
      {/* Mensaje */}
      <p style={{
        margin: 0, fontSize: 12.5, lineHeight: 1.65,
        color: 'rgba(255,255,255,0.75)', whiteSpace: 'pre-wrap', fontFamily: 'inherit',
      }}>{m.mensaje}</p>
      {/* Acciones */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        {(m.pagos_posteriores ?? 0) > 0 && (
          <span style={{
            fontSize: 11, color: '#00e676', background: 'rgba(0,230,118,0.08)',
            border: '1px solid rgba(0,230,118,0.2)', borderRadius: 20, padding: '2px 8px',
            display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 700,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 11 }}>check_circle</span>
            {m.pagos_posteriores} pago(s)
          </span>
        )}
        {onDesactivar && (
          <button type="button" onClick={() => onDesactivar(m.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'transparent', border: '1px solid rgba(239,83,80,0.2)',
            color: '#ef5350cc', borderRadius: 20, padding: '2px 10px',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', font: 'inherit',
            transition: 'all 0.12s',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,83,80,0.1)'; e.currentTarget.style.color = '#ef5350'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ef5350cc'; }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 12 }}>cancel</span>
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
    // canal='TODOS' aparece en cualquier filtro de canal (mensajes globales)
    if (filtroCanal && m.canal !== filtroCanal && m.canal !== 'TODOS') return false;
    if (filtroSegmento && m.segmento_destino !== filtroSegmento && m.segmento_destino !== 'TODOS') return false;
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
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginBottom: 14 }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginRight: 4, letterSpacing: '0.06em', fontWeight: 600 }}>Insertar:</span>
          {VARIABLES.map(v => (
            <button key={v.key} type="button" onClick={() => insertarVariable(v.key)}
              title={`Insertar ${v.key}`}
              style={{
                fontSize: 11, padding: '1px 8px', borderRadius: 4, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(255,255,255,0.45)', font: 'inherit', fontFamily: 'monospace',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = 'rgba(255,255,255,0.8)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'rgba(255,255,255,0.45)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
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

        <button type="button" onClick={handleEnviar} disabled={sending || !mensaje.trim()} style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '11px 0', borderRadius: 10, border: 'none',
          background: sending || !mensaje.trim()
            ? 'rgba(255,255,255,0.06)'
            : `linear-gradient(135deg, ${canalMeta.color}ee, ${canalMeta.color}99)`,
          color: sending || !mensaje.trim() ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.85)',
          fontSize: 13, fontWeight: 800, letterSpacing: '0.04em',
          cursor: sending || !mensaje.trim() ? 'not-allowed' : 'pointer',
          boxShadow: !sending && mensaje.trim() ? `0 2px 16px ${canalMeta.color}33` : 'none',
          transition: 'all 0.15s',
        }}>
          {sending
            ? <><span className="spinner" style={{ width: 13, height: 13 }} /> Enviando…</>
            : <><span className="material-symbols-outlined" style={{ fontSize: 15 }}>send</span> Enviar a Gestores</>
          }
        </button>
        </div>{/* end padding div */}
      </div>{/* end compositor */}

      {/* ── Historial ─────────────────────────────────────────────────────── */}
      <div>
        {/* Filtros inline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginRight: 4 }}>Historial</span>
          {[
            <select key="canal" value={filtroCanal} onChange={e => setFiltroCanal(e.target.value)}
              style={{ background: '#1a1f2b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 8px', color: filtroCanal ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)', fontSize: 12, cursor: 'pointer', colorScheme: 'dark' }}>
              <option value="">Canal</option>
              {CANALES.map(c => <option key={c.id} value={c.id} style={{ background: '#1a1f2b' }}>{c.label}</option>)}
            </select>,
            <select key="seg" value={filtroSegmento} onChange={e => setFiltroSegmento(e.target.value)}
              style={{ background: '#1a1f2b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 8px', color: filtroSegmento ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)', fontSize: 12, cursor: 'pointer', colorScheme: 'dark' }}>
              <option value="">Segmento</option>
              {SEGMENTOS.map(s => <option key={s.id} value={s.id} style={{ background: '#1a1f2b' }}>{s.label}</option>)}
            </select>,
            <input key="fecha" type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)}
              style={{ background: '#1a1f2b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '4px 8px', color: filtroFecha ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)', fontSize: 12, colorScheme: 'dark' }} />,
          ]}
          {(filtroCanal || filtroSegmento || filtroFecha) && (
            <button type="button" onClick={() => { setFiltroCanal(''); setFiltroSegmento(''); setFiltroFecha(''); }}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, padding: '4px 6px', font: 'inherit' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>close</span>limpiar
            </button>
          )}
        </div>

        {/* Activos */}
        {activos.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#00e676', textTransform: 'uppercase' }}>Activos · {activos.length}</span>
            {activos.map(m => <MensajeCard key={m.id} m={m} onDesactivar={handleDesactivar} />)}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'rgba(255,255,255,0.2)', fontSize: 12 }}>
            Sin mensajes activos
          </div>
        )}

        {/* Historial inactivos */}
        {inactivos.length > 0 && (
          <details>
            <summary style={{
              cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase',
              listStyle: 'none', display: 'flex', alignItems: 'center', gap: 5,
              padding: '8px 0', userSelect: 'none',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13 }}>history</span>
              Inactivos · {inactivos.length}
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {inactivos.map(m => <MensajeCard key={m.id} m={m} />)}
            </div>
          </details>
        )}
      </div>

    </div>
  );
}
