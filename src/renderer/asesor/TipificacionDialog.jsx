import React, { useState, useEffect, useCallback } from 'react';
import Modal from '../shared/Modal';
import { showToast } from '../shared/Toast';
import { todayLocalISO } from '../shared/timeUtils';

/**
 * Reemplaza tokens de plantilla con datos reales del contacto.
 * Lógica pura, sin side-effects — testeable de forma aislada.
 */
function interpolateTemplate(template, contacto, asesorNombre) {
  if (!template || !contacto) return template || '';
  // Normalizar \n literal (backslash+n) que puede quedar si la plantilla fue
  // guardada/transferida con newlines escapados en lugar de chars reales (char 10)
  const tpl = template.replace(/\\n/g, '\n');

  const m = contacto.metadata || {};

  // Parser robusto de moneda (admite "1.500,50" y "1,500.50")
  const parseMonto = (v) => {
    if (v == null) return 0;
    const s = String(v).replace(/[^\d.,-]/g, '').trim();
    if (!s) return 0;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    let normalized;
    if (lastComma > lastDot) normalized = s.replace(/\./g, '').replace(',', '.');
    else normalized = s.replace(/,/g, '');
    const n = parseFloat(normalized);
    return isNaN(n) ? 0 : n;
  };
  const fmt$ = (n) => n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Financiero
  const valorMoraRaw = m['VALOR EN MORA'];
  let valorMora = contacto.monto_deuda || 0;
  if (valorMoraRaw != null) {
    const parsed = parseMonto(valorMoraRaw);
    if (parsed > 0) valorMora = parsed;
  }
  const porCobrar = parseMonto(m['MONTO POR COBRAR'] || m['SALDO POR COBRAR'] || m['SALDO PENDIENTE']);
  const montoTotal = parseMonto(
    m['MONTO TOTAL'] || m['DEUDA TOTAL'] || m['VALOR TOTAL'] || m['SALDO TOTAL']
    || (contacto.monto_deuda != null ? String(contacto.monto_deuda) : '')
  );
  const diasMora = Math.max(0, parseInt(m['DIAS IMPAGO'] || m['DIAS EN INPAGO'] || m['DIAS MORA'] || 0, 10) || 0);
  const numCuota = m['CUOTA'] || m['N° CUOTA'] || m['NRO CUOTA'] || m['NUMERO CUOTA']
    || m['NÚMERO CUOTA'] || m['CUOTA VENCIDA'] || m['CUOTAS VENCIDAS']
    || m['NRO DE CUOTA'] || m['# CUOTA'] || m['NUM CUOTA'] || '';
  const valorIntereses = valorMora + diasMora; // $1 por día de mora

  // Cliente / Producto / Identificadores
  const telefono = m['TELEFONO 1'] || contacto.telefono || '';
  const correo = m['CORREO CLIENTE'] || m['CORREO'] || m['EMAIL'] || '';
  const empresa = m['EMPRESA'] || '';
  const contrato = m['Nº CONTRATO'] || m['CONTRATO'] || '';
  const distribuidor = m['DISTRIBUIDOR'] || m['Distribuidor'] || m['DISTRIBUIDORA'] || '';
  const modelo = m['MODELO'] || m['Modelo'] || m['MODELO EQUIPO'] || '';
  const grupo = m['GRUPO'] || contacto.producto || '';

  // Fecha de venta normalizada a dd-mm-aaaa (mismo formato que el banner asesor)
  const fechaVentaRaw = m['FECHA DE VENTA'] || m['FECHA VENTA'] || m['Fecha de Venta'] || '';
  const fechaVenta = (() => {
    if (!fechaVentaRaw) return '';
    const raw = String(fechaVentaRaw).trim();
    const pad = (n) => n.toString().padStart(2, '0');
    const fmt = (d, mo, y) => `${pad(d)}-${pad(mo)}-${y}`;
    if (/^\d+(\.\d+)?$/.test(raw)) {
      const serial = parseFloat(raw);
      if (serial > 25000 && serial < 80000) {
        const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
        return fmt(d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear());
      }
    }
    const m1 = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m1) return fmt(parseInt(m1[3]), parseInt(m1[2]), m1[1]);
    const m2 = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m2) { const y = m2[3].length === 2 ? '20' + m2[3] : m2[3]; return fmt(parseInt(m2[1]), parseInt(m2[2]), y); }
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return fmt(d.getDate(), d.getMonth() + 1, d.getFullYear());
    return raw;
  })();

  return tpl
    .replaceAll('{nombres_apellidos}', contacto.nombre_deudor || 'Cliente')
    .replaceAll('{cedula}', contacto.cedula || 'N/A')
    .replaceAll('{telefono}', telefono || 'N/A')
    .replaceAll('{correo}', correo || 'N/A')
    .replaceAll('{empresa}', empresa || '')
    .replaceAll('{contrato}', contrato || 'N/A')
    .replaceAll('{valor_mora}', fmt$(valorMora))
    .replaceAll('{monto_por_cobrar}', fmt$(porCobrar))
    .replaceAll('{monto_total}', fmt$(montoTotal))
    .replaceAll('{valor_intereses}', fmt$(valorIntereses))
    .replaceAll('{dias_mora}', String(diasMora))
    .replaceAll('{valor_promocional}', fmt$(parseMonto(contacto.valor_promocional)))
    .replaceAll('{distribuidor}', distribuidor || 'N/A')
    .replaceAll('{fecha_venta}', fechaVenta || 'N/A')
    .replaceAll('{modelo}', modelo || 'N/A')
    .replaceAll('{grupo}', grupo || '')
    .replaceAll('{numero_cuota}', numCuota || 'N/A')
    .replaceAll('{asesor_nombre}', asesorNombre || '');
}

/** Extrae días en mora del contacto usando los mismos keys que interpolateTemplate */
function getDiasMora(contacto) {
  if (!contacto) return 0;
  const m = contacto.metadata || {};
  return Math.max(0, parseInt(m['DIAS IMPAGO'] || m['DIAS EN INPAGO'] || m['DIAS MORA'] || 0, 10) || 0);
}

/**
 * Selecciona la plantilla correcta para un canal dado el tramo de mora del cliente.
 * Prioridad: tramo coincidente → plantilla global → cadena vacía.
 * Soporte de tramo abierto: hasta < 0 significa sin límite superior.
 */
function selectTemplate(canal, diasMora, tramos, globalTemplates) {
  if (tramos && tramos.length > 0) {
    const matched = tramos.find(t => {
      const desde = t.desde ?? 0;
      const hasta = t.hasta ?? -1;
      return diasMora >= desde && (hasta < 0 || diasMora <= hasta);
    });
    if (matched) return matched[canal] || globalTemplates[canal] || '';
  }
  return globalTemplates[canal] || '';
}

/**
 * Limpia un número telefónico y le antepone el código de país.
 * Elimina el 0 inicial si existe (ej: 0991234567 → 593991234567).
 */
function buildInternationalPhone(telefono, codigoPais) {
  if (!telefono) return '';
  let clean = telefono.replace(/\D/g, '');
  if (clean.startsWith('0')) clean = clean.slice(1);
  return `${codigoPais}${clean}`;
}

/**
 * TipificacionDialog — Componente para registrar el resultado de la gestión.
 *
 * Soporta dos modos de renderizado:
 *   - mode="modal" (default): Renderiza dentro de <Modal> overlay
 *   - mode="inline": Renderiza como widget-card embebido en el sidebar
 *
 * Props:
 *   - open: boolean
 *   - mode: 'modal' | 'inline' (default: 'inline')
 *   - onSave: ({ tipificacionId, notas, tipificacion, agendamiento }) => void
 *   - onCancel: () => void
 *   - contacto: objeto del contacto actual
 *   - asesorNombre: nombre del asesor actual
 *   - callApi: funcion opcional para resolucion remota (Multi-PC)
 */
export default function TipificacionDialog({ open, mode = 'inline', onSave, onCancel, contacto, asesorNombre, asesorId, callApi, onAltDialed, onExternalDial, onAccionRapida }) {
  const [tipificaciones, setTipificaciones] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [notas, setNotas] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [emailDestino, setEmailDestino] = useState('');
  const [telefonoAlt, setTelefonoAlt] = useState('');
  const [fechaAgendamiento, setFechaAgendamiento] = useState('');
  const [horaAgendamiento, setHoraAgendamiento] = useState('');
  const [montoAcordado, setMontoAcordado] = useState('');
  const [loading, setLoading] = useState(true);
  const [tramos, setTramos] = useState([]);
  const [showRefPanel, setShowRefPanel] = useState(false);
  const [refNombre, setRefNombre] = useState('');
  const [refParentesco, setRefParentesco] = useState('');

  // Auto set date/time for agendable tipifications + pre-fill montoAcordado for PMP/AB_PARC
  useEffect(() => {
    if (selectedId && tipificaciones.length > 0) {
      const tipificacion = tipificaciones.find(t => t.id === parseInt(selectedId));
      if (tipificacion?.requiere_agd === 1) {
        const now = new Date();
        const tzOffset = now.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 16);
        const [today, currentH] = localISOTime.split('T');
        setFechaAgendamiento(today);
        setHoraAgendamiento(currentH);
      } else {
        setFechaAgendamiento('');
        setHoraAgendamiento('');
      }

      // Monto se captura SIEMPRE en blanco — el asesor debe ingresarlo explícitamente.
      // Antes se pre-cargaba con VALOR EN MORA → causaba sobrestimación del recaudado
      // cuando el asesor no editaba (asumía pago total de la deuda).
      setMontoAcordado('');
    }
  }, [selectedId, tipificaciones, contacto]);

  // Plantillas cargadas desde la config del supervisor
  const [templates, setTemplates] = useState({});
  const [codigoPais, setCodigoPais] = useState('593');

  // Auto-populate email from contact metadata when dialog opens
  useEffect(() => {
    if (open && contacto?.metadata?.['CORREO CLIENTE']) {
      setEmailDestino(contacto.metadata['CORREO CLIENTE']);
    } else if (!open) {
      setEmailDestino('');
      setTelefonoAlt('');
    }
  }, [open, contacto]);

  const loadConfig = useCallback(async () => {
    try {
      const getConfFn = callApi || window.api.invoke;
      const config = await getConfFn('db:getAllConfig');
      setTemplates({
        wsp: config.msg_template_wsp || '',
        sms: config.msg_template_sms || '',
        email_subject: config.msg_template_email_subject || '',
        email_body: config.msg_template_email_body || '',
      });
      setCodigoPais(config.codigo_pais || '593');
      try {
        const parsed = JSON.parse(config.msg_tramos || '[]');
        setTramos(Array.isArray(parsed) ? parsed : []);
      } catch { setTramos([]); }
    } catch (err) {
      console.error('Error al cargar config de mensajes:', err);
    }
  }, [callApi]);

  useEffect(() => {
    if (!open) return;

    async function loadTipificaciones() {
      try {
        const getTipFn = callApi || window.api.invoke;
        const data = await getTipFn('db:getTipificaciones');
        setTipificaciones(data);
      } catch (err) {
        console.error('Error al cargar tipificaciones:', err);
      } finally {
        setLoading(false);
      }
    }

    loadTipificaciones();
    loadConfig();
  }, [open, loadConfig]);

  // Recargar templates cuando el supervisor los actualiza (vía WebSocket → CustomEvent)
  useEffect(() => {
    const handler = () => loadConfig();
    window.addEventListener('config-updated', handler);
    return () => window.removeEventListener('config-updated', handler);
  }, [loadConfig]);

  const handleSave = async () => {
    if (!selectedId || isSaving) return;
    const tipificacion = tipificaciones.find(t => t.id === parseInt(selectedId));

    // Validar si requiere agendamiento y tiene datos
    const isAgendable = tipificacion.requiere_agd === 1;
    if (isAgendable) {
      if (!fechaAgendamiento || !horaAgendamiento) {
        showToast('Debes seleccionar fecha y hora para el compromiso', 'warning');
        return;
      }
      if (fechaAgendamiento < todayLocalISO()) {
        showToast('La fecha del compromiso debe ser hoy o posterior — no se permiten fechas pasadas', 'warning');
        return;
      }
    }

    // Validar monto obligatorio para tipificaciones de compromiso
    const COMPROMISO_CODES = ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP'];
    const requiereMonto = COMPROMISO_CODES.includes(tipificacion.codigo);
    const montoAcordadoNum = montoAcordado !== '' ? parseFloat(montoAcordado) : null;
    if (requiereMonto) {
      if (montoAcordadoNum == null || isNaN(montoAcordadoNum) || montoAcordadoNum <= 0) {
        showToast('Debes ingresar el monto acordado para esta tipificación', 'warning');
        return;
      }
    }

    const agendamientoData = isAgendable
      ? { tipo: tipificacion.codigo === 'PMP' ? 'PMP' : 'VOL_CALL', fecha: fechaAgendamiento, hora: horaAgendamiento }
      : null;

    setIsSaving(true);
    try {
      await onSave({
        tipificacionId: parseInt(selectedId),
        notas,
        tipificacion,
        agendamiento: agendamientoData,
        montoAcordado: !isNaN(montoAcordadoNum) ? montoAcordadoNum : null,
      });
    } finally {
      setIsSaving(false);
      setSelectedId('');
      setNotas('');
      setFechaAgendamiento('');
      setHoraAgendamiento('');
      setMontoAcordado('');
    }
  };

  // ── Acciones Rápidas: WSP / SMS / CORREO ────────────────
  async function handleSendWSP() {
    const numeroBase = telefonoAlt.trim() || contacto?.telefono;
    if (!numeroBase) {
      showToast('No hay número telefónico disponible', 'warning');
      return;
    }
    const phone = buildInternationalPhone(numeroBase, codigoPais);
    const diasMora = getDiasMora(contacto);
    const message = interpolateTemplate(selectTemplate('wsp', diasMora, tramos, templates), contacto, asesorNombre);
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

    try {
      const invokeFn = callApi || window.api.invoke;
      await invokeFn('shell:openExternal', url);
      registrarAccionRapida(invokeFn, 'WSP', { telefono: phone, contacto_id: contacto?.id });
      showToast('WhatsApp abierto en el navegador', 'success');
    } catch (err) {
      console.error('[WSP] Error:', err);
      showToast('Error al abrir WhatsApp: ' + (err.message || err), 'error');
    }
  }

  // Persistir evento de acción rápida (WSP/SMS/EMAIL) y notificar al panel padre
  // para incrementar el contador en vivo de Métricas Diarias.
  function registrarAccionRapida(invokeFn, canal, extra = {}) {
    try {
      if (asesorId) {
        invokeFn('db:insertEvento', {
          usuario_id: Number(asesorId),
          tipo: 'ACCION_RAPIDA',
          metadata: { canal, ...extra },
        }).catch((err) => { console.error('[ACCION_RAPIDA] Error insertando evento:', err); });
      }
    } catch (_) { /* swallow */ }
    if (typeof onAccionRapida === 'function') onAccionRapida(canal);
  }

  async function handleSendSMS() {
    const numeroBase = telefonoAlt.trim() || contacto?.telefono;
    if (!numeroBase) {
      showToast('No hay número telefónico disponible', 'warning');
      return;
    }
    const phone = buildInternationalPhone(numeroBase, codigoPais);
    const diasMora = getDiasMora(contacto);
    const message = interpolateTemplate(selectTemplate('sms', diasMora, tramos, templates), contacto, asesorNombre);

    console.log('[SMS] Enviando a:', phone, '| Template cargada:', !!templates.sms, '| Mensaje length:', message.length);

    try {
      const invokeFn = callApi || window.api.invoke;
      const res = await invokeFn('adb:sendSMS', phone, message);
      console.log('[SMS] Respuesta ADB:', JSON.stringify(res));
      if (res?.success) {
        registrarAccionRapida(invokeFn, 'SMS', { telefono: phone, contacto_id: contacto?.id });
        showToast('App de SMS abierta en el celular', 'success');
      } else {
        showToast(res?.error || 'Error al abrir SMS en el celular', 'error');
      }
    } catch (err) {
      console.error('[SMS] Error:', err);
      showToast('Error de comunicación con el celular: ' + (err.message || err), 'error');
    }
  }

  async function handleSendEmail() {
    if (!emailDestino) {
      showToast('Por favor, ingresa el correo del cliente primero', 'warning');
      return;
    }
    const diasMora = getDiasMora(contacto);
    const subject = interpolateTemplate(selectTemplate('email_subject', diasMora, tramos, templates), contacto, asesorNombre);
    const body = interpolateTemplate(selectTemplate('email_body', diasMora, tramos, templates), contacto, asesorNombre);
    const url = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(emailDestino.trim())}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    try {
      const invokeFn = callApi || window.api.invoke;
      await invokeFn('shell:openExternal', url);
      registrarAccionRapida(invokeFn, 'EMAIL', { destino: emailDestino.trim(), contacto_id: contacto?.id });
      showToast('Gmail abierto en el navegador', 'success');
    } catch (err) {
      console.error('[EMAIL] Error:', err);
      showToast('Error al abrir Gmail: ' + (err.message || err), 'error');
    }
  }

  // ── Contenido reutilizable del formulario ──────────────────
  const formContent = (
    <>
      {loading ? (
        <div className="spinner-container"><span className="spinner" /></div>
      ) : (
        <>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="text-label-sm" style={{ display: 'block', marginBottom: 8, opacity: 0.6 }}>Resultado de la gestión</label>
              <div
              className="tipificacion-grid-container"
              style={{
                maxHeight: mode === 'inline' ? '200px' : '260px',
                overflowY: 'auto',
                paddingRight: '6px',
                scrollbarWidth: 'thin',
                scrollbarColor: 'var(--color-primary) transparent',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}
            >
              {(() => {
                const grouped = tipificaciones.reduce((acc, t) => {
                  const cat = (t.categoria || 'OTROS').toUpperCase();
                  if (!acc[cat]) acc[cat] = [];
                  if (!acc[cat].find(x => x.descripcion.toUpperCase() === t.descripcion.toUpperCase())) {
                    acc[cat].push(t);
                  }
                  return acc;
                }, {});

                return Object.keys(grouped).map(cat => (
                  <div key={cat}>
                    <p style={{ fontSize: 10, fontWeight: 700, opacity: 0.6, marginBottom: 6, letterSpacing: '0.05em' }}>{cat}</p>
                    <div className="tipificacion-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: mode === 'inline' ? '6px' : '10px' }}>
                      {grouped[cat].map(t => (
                        <button
                          key={t.id}
                          className={`btn ${selectedId === t.id.toString() ? 'btn-primary' : 'btn-outline'}`}
                          style={{
                            fontSize: mode === 'inline' ? '10px' : '11px',
                            padding: mode === 'inline' ? '8px 6px' : '12px 8px',
                            textAlign: 'center',
                            lineHeight: '1.2',
                            height: 'auto',
                            minHeight: mode === 'inline' ? '36px' : '44px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                            transition: 'all 0.2s',
                            borderColor: cat === 'CONTACTO NEGATIVO' && selectedId !== t.id.toString() ? 'rgba(255, 68, 68, 0.4)' : undefined,
                            color: cat === 'CONTACTO NEGATIVO' && selectedId !== t.id.toString() ? '#ff4444' : undefined,
                          }}
                          onClick={() => setSelectedId(t.id.toString())}
                        >
                          {t.descripcion.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

          {(() => {
            const selectedTip = tipificaciones.find(t => t.id.toString() === selectedId);
            const isAgendable = selectedTip?.requiere_agd === 1;
            return isAgendable ? (
              <div className="form-group" style={{ marginBottom: 12, padding: 10, background: 'rgba(0, 255, 127, 0.05)', borderRadius: 8, border: '1px solid rgba(0,255,127,0.2)' }}>
                <label className="text-label-sm" style={{ display: 'block', marginBottom: 8, color: 'var(--color-primary)', fontSize: 11 }}>Agendar Llamada</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label className="text-label-xs" style={{ opacity: 0.6, marginBottom: 2, display: 'block', fontSize: 9 }}>Fecha</label>
                    <input 
                      type="date" 
                      className="input" 
                      value={fechaAgendamiento} 
                      onChange={e => setFechaAgendamiento(e.target.value)}
                      min={todayLocalISO()}
                      style={{ fontSize: 12, padding: '6px 8px' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="text-label-xs" style={{ opacity: 0.6, marginBottom: 2, display: 'block', fontSize: 9 }}>Hora</label>
                    <input 
                      type="time" 
                      className="input" 
                      value={horaAgendamiento} 
                      onChange={e => setHoraAgendamiento(e.target.value)}
                      style={{ fontSize: 12, padding: '6px 8px' }}
                    />
                  </div>
                </div>
              </div>
            ) : null;
          })()}

          {(() => {
            const selectedTip2 = tipificaciones.find(t => t.id.toString() === selectedId);
            const COMP = ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP'];
            const showMonto = selectedTip2 && COMP.includes(selectedTip2.codigo);
            const labelMap = {
              PMP: 'Monto comprometido a pagar',
              PAGO_REAL: 'Monto realmente pagado',
              AB_PARC: 'Monto del abono parcial',
              PEND_COMP: 'Monto pendiente de comprobar',
            };
            const valorMora = (() => {
              const raw = contacto?.metadata?.['VALOR EN MORA'];
              if (raw == null) return null;
              const p = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
              return isNaN(p) ? null : p;
            })();
            return showMonto ? (
              <div className="form-group" style={{ marginBottom: 12, padding: 10, background: 'rgba(255, 192, 0, 0.05)', borderRadius: 8, border: '1px solid rgba(255,192,0,0.2)' }}>
                <label className="text-label-sm" style={{ display: 'block', marginBottom: 6, color: '#ffc107', fontSize: 11 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13, verticalAlign: 'middle', marginRight: 4 }}>payments</span>
                  {labelMap[selectedTip2.codigo] || 'Monto Acordado'} <span style={{ color: '#ff5252' }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    value={montoAcordado}
                    onChange={e => setMontoAcordado(e.target.value)}
                    placeholder="0.00"
                    required
                    style={{ flex: 1, fontSize: 13, padding: '7px 10px', fontWeight: 700 }}
                  />
                  {valorMora != null && (
                    <button
                      type="button"
                      onClick={() => setMontoAcordado(String(valorMora))}
                      title={`Usar valor en mora: $${valorMora.toFixed(2)}`}
                      style={{
                        padding: '0 10px', fontSize: 10, whiteSpace: 'nowrap',
                        background: 'rgba(255,192,0,0.15)', border: '1px solid rgba(255,192,0,0.35)',
                        color: '#ffc107', borderRadius: 6, cursor: 'pointer',
                      }}
                    >
                      Mora ${valorMora.toFixed(2)}
                    </button>
                  )}
                </div>
                <p style={{ fontSize: 9, opacity: 0.55, margin: '4px 0 0', lineHeight: 1.3 }}>
                  Campo obligatorio. Ingresa el monto exacto. Botón "Mora" auto-completa con el valor en mora del cliente.
                </p>
              </div>
            ) : null;
          })()}

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="text-label-sm" style={{ display: 'block', marginBottom: 6, fontSize: 11 }}>Notas / Observaciones</label>
            <textarea
              className="input"
              style={{ width: '100%', minHeight: mode === 'inline' ? 40 : 50, resize: 'none', padding: 10, fontSize: 12 }}
              placeholder="Escribe detalles relevantes de la gestión..."
              value={notas}
              onChange={e => setNotas(e.target.value)}
            />
          </div>

          {/* ── ACCIONES RÁPIDAS (WSP, SMS, CORREO) ── */}
          <div className="extra-actions-container" style={{
            background: 'rgba(255,255,255,0.03)',
            padding: mode === 'inline' ? '8px' : '12px',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.06)',
            marginBottom: 12
          }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <label className="text-label-sm" style={{ opacity: 0.6, fontSize: 10 }}>Acciones Rápidas</label>
                {tramos.length > 0 && (() => {
                  const dm = getDiasMora(contacto);
                  const matched = tramos.find(t => {
                    const desde = t.desde ?? 0;
                    const hasta = t.hasta ?? -1;
                    return dm >= desde && (hasta < 0 || dm <= hasta);
                  });
                  return matched ? (
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 4,
                      background: 'rgba(255,152,0,0.15)', border: '1px solid rgba(255,152,0,0.3)',
                      color: '#ff9800', fontWeight: 700,
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 10, verticalAlign: 'middle', marginRight: 2 }}>schedule_send</span>
                      {matched.label || `Tramo ${matched.desde}–${matched.hasta >= 0 ? matched.hasta : '∞'} días`}
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 4,
                      background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.3)', fontWeight: 700,
                    }}>Plantilla global</span>
                  );
                })()}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                  {/* Botón guardar sub-gestión — abre panel de referencia */}
                  <button
                    title="Guardar gestión de referencia"
                    disabled={!telefonoAlt.trim()}
                    onClick={() => {
                      if (!telefonoAlt.trim()) return;
                      setShowRefPanel(true);
                      setRefNombre('');
                      setRefParentesco('');
                    }}
                    style={{
                      flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                      border: 'none', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      background: telefonoAlt.trim() ? '#4caf50' : 'rgba(255,255,255,0.08)',
                      opacity: telefonoAlt.trim() ? 1 : 0.35,
                      transition: 'all 0.2s',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#000' }}>save</span>
                  </button>
                  <input
                    type="tel"
                    className="input"
                    value={telefonoAlt}
                    onChange={(e) => setTelefonoAlt(e.target.value)}
                    placeholder={contacto?.telefono || 'Otro número'}
                    style={{ padding: '3px 6px', fontSize: '10px', height: 'auto', margin: 0, width: '100%' }}
                  />
                  {/* Botón llamar — registra el intento de marcación SIEMPRE
                      (independiente de éxito ADB y del botón 💾 guardar) */}
                  <button
                    title="Llamar a este número (cuenta como marcación)"
                    disabled={!telefonoAlt.trim()}
                    onClick={async () => {
                      let num = telefonoAlt.trim();
                      if (!num.startsWith('0')) num = '0' + num;
                      // Registrar marcación SIEMPRE — antes del dial, así cuenta
                      // aunque ADB falle o el celular esté desconectado.
                      if (onExternalDial) onExternalDial(num);
                      try {
                        const res = await window.api.invoke('adb:dial', num);
                        if (res?.success) {
                          showToast(`Llamando a ${num}`, 'success');
                        } else {
                          showToast(res?.error || 'Marcación registrada (ADB falló)', 'warning');
                        }
                      } catch (err) {
                        showToast('Marcación registrada (sin conexión a celular)', 'warning');
                      }
                    }}
                    style={{
                      flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                      border: 'none', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      background: telefonoAlt.trim() ? 'var(--color-primary)' : 'rgba(255,255,255,0.08)',
                      opacity: telefonoAlt.trim() ? 1 : 0.35,
                      transition: 'all 0.2s',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13, color: '#000' }}>call</span>
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '12px', opacity: 0.6, flexShrink: 0 }}>email</span>
                  <input
                    type="email"
                    className="input"
                    value={emailDestino}
                    onChange={(e) => setEmailDestino(e.target.value)}
                    placeholder="Correo del cliente"
                    style={{ padding: '3px 6px', fontSize: '10px', height: 'auto', margin: 0, width: '100%' }}
                  />
                </div>
              </div>

              {/* Panel inline de datos de referencia */}
              {showRefPanel && (
                <div style={{
                  marginTop: 8,
                  padding: '10px 12px',
                  background: 'rgba(76,175,80,0.08)',
                  border: '1px solid rgba(76,175,80,0.25)',
                  borderRadius: 8,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Datos de la referencia (opcional)
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      className="input"
                      value={refNombre}
                      onChange={(e) => setRefNombre(e.target.value)}
                      placeholder="Nombre"
                      style={{ padding: '4px 8px', fontSize: '11px', height: 'auto', flex: 1 }}
                    />
                    <select
                      className="input"
                      value={refParentesco}
                      onChange={(e) => setRefParentesco(e.target.value)}
                      style={{ padding: '4px 6px', fontSize: '11px', height: 'auto', flex: 1 }}
                    >
                      <option value="">Parentesco</option>
                      <option value="Cónyuge">Cónyuge</option>
                      <option value="Padre">Padre</option>
                      <option value="Madre">Madre</option>
                      <option value="Hijo/a">Hijo/a</option>
                      <option value="Hermano/a">Hermano/a</option>
                      <option value="Cuñado/a materno">Cuñado/a materno</option>
                      <option value="Cuñado/a paterno">Cuñado/a paterno</option>
                      <option value="Tío/a materno">Tío/a materno</option>
                      <option value="Tío/a paterno">Tío/a paterno</option>
                      <option value="Primo/a materno">Primo/a materno</option>
                      <option value="Primo/a paterno">Primo/a paterno</option>
                      <option value="Amigo/a">Amigo/a</option>
                      <option value="Trabajo">Trabajo</option>
                      <option value="Vecino/a">Vecino/a</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        let num = telefonoAlt.trim();
                        if (!num.startsWith('0')) num = '0' + num;
                        if (onAltDialed) onAltDialed(num, notas, null, null);
                        showToast('Subgestión guardada', 'success');
                        setShowRefPanel(false);
                        setTelefonoAlt('');
                      }}
                      style={{ fontSize: 10, padding: '3px 8px' }}
                    >
                      Omitir referencia
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        let num = telefonoAlt.trim();
                        if (!num.startsWith('0')) num = '0' + num;
                        if (onAltDialed) onAltDialed(num, notas, refNombre.trim() || null, refParentesco || null);
                        showToast('Subgestión guardada con referencia', 'success');
                        setShowRefPanel(false);
                        setTelefonoAlt('');
                        setRefNombre('');
                        setRefParentesco('');
                      }}
                      style={{ fontSize: 10, padding: '3px 8px' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>check</span>
                      Confirmar
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
              <button
                className="btn btn-outline"
                style={{ flex: '1 1 calc(33.33% - 4px)', minWidth: '80px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', padding: '6px 4px' }}
                onClick={handleSendWSP}
                disabled={!contacto?.telefono}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>chat</span>
                WSP
              </button>
              <button
                className="btn btn-outline"
                style={{ flex: '1 1 calc(33.33% - 4px)', minWidth: '80px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', padding: '6px 4px' }}
                onClick={handleSendSMS}
                disabled={!contacto?.telefono}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>sms</span>
                SMS
              </button>
              <button
                className="btn btn-outline"
                style={{ flex: '1 1 calc(33.33% - 4px)', minWidth: '80px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', padding: '6px 4px' }}
                onClick={handleSendEmail}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>email</span>
                CORREO
              </button>
            </div>
            <p className="text-body-sm" style={{
              fontSize: '9px',
              opacity: 0.4,
              textAlign: 'center',
              margin: 0,
              lineHeight: '1.2'
            }}>
              * Mensaje generado con plantilla del supervisor.
            </p>
          </div>

          <div className="tipificacion-actions" style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" style={{ flex: 1, fontSize: 12, padding: '10px 8px' }} onClick={onCancel}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 2, fontSize: 12, padding: '10px 8px' }}
              onClick={handleSave}
              disabled={!selectedId || isSaving}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{isSaving ? 'hourglass_top' : 'save'}</span>
              {isSaving ? 'Guardando...' : 'Guardar Gestión'}
            </button>
          </div>
        </>
      )}
    </>
  );

  // ── Renderizado condicional: inline vs modal ──
  if (!open) return null;

  if (mode === 'inline') {
    return (
      <div className="widget-card tipificacion-inline-panel">
        <div className="widget-header" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--color-primary)' }}>assignment</span>
            <h3 className="widget-title" style={{ fontSize: 15 }}>Tipificar Gestión</h3>
          </div>
          <button className="btn-crm" onClick={onCancel} style={{ padding: '4px 8px', fontSize: 10 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, marginRight: 0 }}>close</span>
          </button>
        </div>
        <div className="tipificacion-form">
          {formContent}
        </div>
      </div>
    );
  }

  // Modo modal (legacy/fallback)
  return (
    <Modal open={open} title="Tipificar Gestión" onClose={onCancel}>
      <div className="tipificacion-form">
        <p className="text-body-md" style={{ marginBottom: 16 }}>
          Selecciona el resultado de esta llamada para cerrar la gestión:
        </p>
        {formContent}
      </div>
    </Modal>
  );
}

