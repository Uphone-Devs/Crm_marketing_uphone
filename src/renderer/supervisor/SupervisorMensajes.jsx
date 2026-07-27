import React, { useState, useEffect, useCallback, useRef } from 'react';
import { showToast } from '../shared/Toast';

const SEGMENTOS_BASE = [
  { id: 'TODOS',      label: 'Todos los asesores' },
  { id: 'MENSUALES',  label: 'Campaña Mensual' },
  { id: 'QUINCENALES',label: 'Campaña Quincenal' },
  { id: 'TRAMO_0',    label: 'Tramo 0 · 0 días' },
  { id: 'TRAMO_1',    label: 'Tramo 1 · 1 día' },
  { id: 'TRAMO_2',    label: 'Tramo 2 · 2 días' },
  { id: 'PLAZO',      label: 'Plazo · +2 días' },
];

function CollapsibleSection({ sec, renderMensajeCard }) {
  const [open, setOpen] = React.useState(sec.key === 'activos');
  return (
    <div style={{
      borderRadius: 12,
      border: `1px solid ${open ? sec.color + '33' : 'rgba(255,255,255,0.07)'}`,
      background: open ? sec.bg : 'transparent',
      overflow: 'hidden',
      transition: 'border-color 0.2s, background 0.2s',
    }}>
      {/* Header */}
      <button type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
          borderLeft: `3px solid ${sec.color}`,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20, color: sec.color, flexShrink: 0 }}>
          {sec.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: sec.color, letterSpacing: 0.3 }}>
              {sec.label.toUpperCase()}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 800, padding: '1px 7px', borderRadius: 20,
              background: sec.color + '22', color: sec.color, minWidth: 20, textAlign: 'center',
            }}>
              {sec.items.length}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.45, marginTop: 1 }}>{sec.sublabel}</p>
        </div>
        <span className="material-symbols-outlined" style={{
          fontSize: 18, opacity: 0.4, transition: 'transform 0.2s',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          flexShrink: 0,
        }}>
          expand_more
        </span>
      </button>

      {/* Body */}
      {open && (
        <div style={{ padding: '4px 18px 18px', borderTop: `1px solid ${sec.color}22` }}>
          {sec.items.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '28px 0', gap: 10, opacity: 0.35,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 36, color: sec.color }}>{sec.emptyIcon}</span>
              <p style={{ margin: 0, fontSize: 13, fontStyle: 'italic', textAlign: 'center', maxWidth: 340 }}>
                {sec.emptyText}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
              {sec.items.map(m => renderMensajeCard(m, sec.isActive))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function guardarSegmentosExtra(extras) {
  try {
    await window.api.invoke('db:setConfig', 'segmentos_broadcast_extra', JSON.stringify(extras));
  } catch (err) {
    console.error('Error guardando segmentos extra:', err);
  }
}

export default function SupervisorMensajes({ usuario }) {
  const [mensaje, setMensaje] = useState('');
  const [segmentoDestino, setSegmentoDestino] = useState('TODOS');
  const [historial, setHistorial] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [segmentos, setSegmentos] = useState(SEGMENTOS_BASE);
  const [mostrarNuevoTramo, setMostrarNuevoTramo] = useState(false);
  const [nuevoTramoLabel, setNuevoTramoLabel] = useState('');
  const nuevoTramoInputRef = useRef(null);
  const formRef = useRef(null);

  // Cargar tramos personalizados guardados en config
  const cargarSegmentosExtra = useCallback(async () => {
    try {
      const val = await window.api.invoke('db:getConfig', 'segmentos_broadcast_extra');
      if (val) {
        const extras = JSON.parse(val);
        setSegmentos([...SEGMENTOS_BASE, ...extras]);
      }
    } catch { /* si no existe, usar los base */ }
  }, []);


  const handleAgregarTramo = async () => {
    const label = nuevoTramoLabel.trim();
    if (!label) {
      showToast('Escribe el nombre del nuevo tramo', 'warning');
      return;
    }
    const id = 'CUSTOM_' + label.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    if (segmentos.find(s => s.id === id)) {
      showToast('Ya existe un tramo con ese nombre', 'warning');
      return;
    }
    const nuevoSeg = { id, label };
    const nuevaLista = [...segmentos, nuevoSeg];
    setSegmentos(nuevaLista);
    setSegmentoDestino(id);

    // Persistir sólo los extras (no los base)
    const extras = nuevaLista.filter(s => !SEGMENTOS_BASE.find(b => b.id === s.id));
    await guardarSegmentosExtra(extras);

    setNuevoTramoLabel('');
    setMostrarNuevoTramo(false);
    showToast(`Tramo "${label}" añadido`, 'success');
  };

  const handleEliminarTramo = async (id) => {
    if (SEGMENTOS_BASE.find(s => s.id === id)) {
      showToast('No se pueden eliminar los tramos base', 'warning');
      return;
    }
    const nuevaLista = segmentos.filter(s => s.id !== id);
    setSegmentos(nuevaLista);
    if (segmentoDestino === id) setSegmentoDestino('TODOS');
    const extras = nuevaLista.filter(s => !SEGMENTOS_BASE.find(b => b.id === s.id));
    await guardarSegmentosExtra(extras);
    showToast('Tramo eliminado', 'success');
  };

  const cargarHistorial = useCallback(async () => {
    try {
      const data = await window.api.invoke('db:getMensajesBroadcast');
      setHistorial(data || []);
    } catch (err) {
      console.error('Error cargando historial de mensajes:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarSegmentosExtra();
    cargarHistorial();
  }, [cargarSegmentosExtra, cargarHistorial]);

  useEffect(() => {
    if (mostrarNuevoTramo && nuevoTramoInputRef.current) {
      nuevoTramoInputRef.current.focus();
    }
  }, [mostrarNuevoTramo]);

  const handleEnviar = async () => {
    if (!mensaje.trim()) {
      showToast('Escriba un mensaje o promoción para enviar', 'warning');
      return;
    }

    setEnviando(true);
    try {
      const res = await window.api.invoke('db:insertMensajeBroadcast', usuario.id, mensaje.trim(), segmentoDestino);
      if (res.success) {
        showToast('Mensaje enviado y actualizado para los asesores', 'success');
        setMensaje('');
        cargarHistorial();
      } else {
        showToast('No se pudo enviar el mensaje', 'error');
      }
    } catch (err) {
      console.error('Error al enviar mensaje:', err);
      showToast('Error de comunicación al enviar', 'error');
    } finally {
      setEnviando(false);
    }
  };

  const handleDesactivar = async (id) => {
    if (!confirm('¿Desea desactivar este mensaje? Los asesores dejarán de verlo inmediatamente.')) return;
    try {
      const res = await window.api.invoke('db:deleteMensajeBroadcast', id);
      if (res.success) {
        showToast('Mensaje desactivado correctamente', 'success');
        cargarHistorial();
      } else {
        showToast('Error al desactivar el mensaje', 'error');
      }
    } catch (err) {
      console.error('Error desactivando mensaje:', err);
    }
  };

  const scrollToForm = () => {
    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
        <span className="spinner" />
      </div>
    );
  }

  const activos = historial.filter(m => m.activo === 1);
  const inactivos = historial.filter(m => m.activo === 0);
  const efectivos = inactivos.filter(m => m.pagos_posteriores > 0);
  const noEfectivos = inactivos.filter(m => m.pagos_posteriores === 0);

  const renderMensajeCard = (msg, isActive = false) => (
    <div key={msg.id} className="card" style={{ padding: 16, borderLeft: isActive ? '4px solid var(--color-primary)' : '4px solid #444', opacity: isActive ? 1 : 0.85 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, opacity: 0.6 }}>person</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{msg.supervisor_nombre}</span>
          <span style={{ fontSize: 12, background: 'rgba(0, 229, 255, 0.1)', color: 'var(--color-primary)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
            {segmentos.find(s => s.id === msg.segmento_destino)?.label || msg.segmento_destino}
          </span>
          {!isActive && <span style={{ fontSize: 12, background: '#333', padding: '2px 6px', borderRadius: 4 }}>Desactivado</span>}
        </div>
        <span style={{ fontSize: 12, opacity: 0.5 }}>{new Date(String(msg.creado_en).replace(' ', 'T').replace(/Z$/i, '').replace(/\.\d+$/, '')).toLocaleString('es-EC', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      </div>
      <p style={{ margin: '8px 0', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, opacity: 0.9 }}>
        {msg.mensaje}
      </p>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: msg.pagos_posteriores > 0 ? '#00e676' : 'inherit' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>query_stats</span>
          <span style={{ fontSize: 12, fontWeight: 500 }}>
            Efectividad: {msg.pagos_posteriores} pago(s) registrados después del envío
          </span>
        </div>
        
        {isActive ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => handleDesactivar(msg.id)} style={{ padding: '4px 10px', fontSize: 12, color: '#ff5252', borderColor: '#ff5252' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
            Ocultar de Asesores
          </button>
        ) : (
          <button type="button" 
            className="btn btn-outline btn-sm" 
            onClick={() => {
              setMensaje(msg.mensaje);
              if (segmentos.find(s => s.id === msg.segmento_destino)) {
                setSegmentoDestino(msg.segmento_destino);
              }
              scrollToForm();
              showToast('Mensaje copiado al formulario. Revise y haga clic en Enviar.', 'info');
            }} 
            style={{ padding: '4px 10px', fontSize: 12, color: '#00e5ff', borderColor: 'rgba(0, 229, 255, 0.3)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>recycling</span>
            Reusar Mensaje
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h3 className="text-headline-sm" style={{ marginBottom: 8 }}>
            <span className="material-symbols-outlined" style={{ verticalAlign: 'middle', marginRight: 8, color: 'var(--color-primary)' }}>campaign</span>
            Gestión de Promociones y Mensajes
          </h3>
          <p className="text-body-sm" style={{ opacity: 0.6, maxWidth: 600 }}>
            Envíe promociones a los asesores para que las copien. Al enviar uno nuevo a un segmento, se reemplazará automáticamente el anterior en el panel de los asesores.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={scrollToForm} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add_circle</span>
          Añadir Promoción
        </button>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 32 }} ref={formRef}>
        <h4 className="text-label" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span> NUEVO MENSAJE / PROMOCIÓN
        </h4>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label className="text-label-sm" style={{ opacity: 0.6 }}>
              SEGMENTO DESTINO
            </label>
            <button type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setMostrarNuevoTramo(v => !v)}
              style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px' }}
              title="Añadir nuevo tramo personalizado"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                {mostrarNuevoTramo ? 'close' : 'add'}
              </span>
              {mostrarNuevoTramo ? 'Cancelar' : 'Nuevo tramo'}
            </button>
          </div>

          {/* Mini-formulario para nuevo tramo */}
          {mostrarNuevoTramo && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, padding: '10px 12px', background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.2)', borderRadius: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--color-primary)', alignSelf: 'center' }}>label</span>
              <input
                ref={nuevoTramoInputRef}
                type="text"
                className="input"
                value={nuevoTramoLabel}
                onChange={e => setNuevoTramoLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAgregarTramo(); if (e.key === 'Escape') { setMostrarNuevoTramo(false); setNuevoTramoLabel(''); }}}
                placeholder="Nombre del nuevo tramo (ej: VIP, Empresas...)"
                style={{ flex: 1, fontSize: 13, padding: '6px 10px' }}
                maxLength={30}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={handleAgregarTramo} style={{ whiteSpace: 'nowrap' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check</span>
                Añadir
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {segmentos.map(seg => {
              const isCustom = !SEGMENTOS_BASE.find(b => b.id === seg.id);
              return (
                <label
                  key={seg.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: segmentoDestino === seg.id ? 'rgba(0, 229, 255, 0.1)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${segmentoDestino === seg.id ? 'var(--color-primary)' : isCustom ? 'rgba(255,200,0,0.3)' : 'transparent'}`,
                    padding: '8px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: 13,
                    position: 'relative',
                  }}
                >
                  <input
                    type="radio"
                    name="segmento"
                    value={seg.id}
                    checked={segmentoDestino === seg.id}
                    onChange={() => {
                      setSegmentoDestino(seg.id);
                      const activo = historial.find(m => (m.activo === 1 || m.activo === true) && m.segmento_destino === seg.id);
                      if (activo) setMensaje(activo.mensaje);
                      else setMensaje('');
                    }}
                    style={{ accentColor: 'var(--color-primary)' }}
                  />
                  {seg.label}
                  {isCustom && (
                    <span
                      className="material-symbols-outlined"
                      title="Eliminar este tramo"
                      onClick={(e) => { e.preventDefault(); handleEliminarTramo(seg.id); }}
                      style={{ fontSize: 13, opacity: 0.5, cursor: 'pointer', color: '#ff5252', marginLeft: 2 }}
                    >
                      cancel
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label className="text-label-sm" style={{ display: 'block', marginBottom: 8, opacity: 0.6 }}>
            TEXTO DE LA PROMOCIÓN
          </label>
          <textarea
            className="input"
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            placeholder="Escriba aquí la promoción o mensaje..."
            style={{ width: '100%', minHeight: 120, resize: 'vertical', fontFamily: 'inherit', padding: 12 }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" 
            className="btn btn-primary" 
            onClick={handleEnviar} 
            disabled={enviando || !mensaje.trim()}
          >
            {enviando ? <span className="spinner" style={{ width: 16, height: 16 }} /> : <span className="material-symbols-outlined" style={{ fontSize: 18 }}>send</span>}
            Enviar Promoción
          </button>
        </div>
      </div>

      {/* ── Secciones de historial con acordeones ── */}
      {[
        {
          key: 'activos',
          label: 'Mensajes Activos',
          sublabel: 'Visibles para asesores ahora mismo',
          icon: 'notifications_active',
          color: 'var(--color-primary)',
          bg: 'rgba(0,229,255,0.06)',
          items: activos,
          isActive: true,
          emptyText: 'No hay mensajes activos. Envía uno arriba para que los asesores lo vean.',
          emptyIcon: 'chat_bubble_outline',
        },
        {
          key: 'efectivos',
          label: 'Mensajes Efectivos (Historial Inactivo)',
          sublabel: 'Con pagos registrados después del envío',
          icon: 'trending_up',
          color: '#00e676',
          bg: 'rgba(0,230,118,0.05)',
          items: efectivos,
          isActive: false,
          emptyText: 'Ningún mensaje inactivo ha generado pagos registrados aún.',
          emptyIcon: 'bar_chart',
        },
        {
          key: 'no_efectivos',
          label: 'Mensajes No Efectivos (Historial Inactivo)',
          sublabel: 'Sin pagos posteriores detectados',
          icon: 'trending_down',
          color: '#ff5252',
          bg: 'rgba(255,82,82,0.05)',
          items: noEfectivos,
          isActive: false,
          emptyText: 'No hay mensajes inactivos sin efectividad o no hay historial.',
          emptyIcon: 'do_not_disturb',
        },
      ].map(sec => (
        <CollapsibleSection key={sec.key} sec={sec} renderMensajeCard={renderMensajeCard} />
      ))}
    </div>
  );
}
