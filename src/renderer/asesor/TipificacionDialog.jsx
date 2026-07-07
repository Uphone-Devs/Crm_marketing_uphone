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
const CATEGORY_META = {
    'CONTACTO EXITOSO':  { icon:'check_circle', color:'#00e676', bg:'rgba(0,230,118,0.08)',   border:'rgba(0,230,118,0.2)' },
    'CONTACTO NEUTRO':   { icon:'help_center',  color:'#64b5f6', bg:'rgba(100,181,246,0.08)', border:'rgba(100,181,246,0.2)' },
    'CONTACTO NEGATIVO': { icon:'cancel',       color:'#ff5252', bg:'rgba(255,82,82,0.08)',   border:'rgba(255,82,82,0.2)' },
    'NO CONTACTADO':     { icon:'person_off',   color:'#b0bec5', bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.1)' },
    'OTROS':             { icon:'category',     color:'#b0bec5', bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.1)' },
  };
const TIPIF_ICON = {
    PMP:'handshake', COMP_CUM:'verified', PAGO_REAL:'paid', AB_PARC:'payment',
    PEND_COMP:'pending', REAG:'event_repeat', VOL_CALL:'phone_callback',
    INCUMP:'warning', BUZON:'voicemail', NO_CONT:'phone_missed',
  };
const LABEL_MONTO = { PMP:'Monto comprometido a pagar', PAGO_REAL:'Monto realmente pagado', AB_PARC:'Monto del abono parcial', PEND_COMP:'Monto pendiente de comprobar' };

export default function TipificacionDialog({ open, tipifInicial, mode = 'inline', onSave, onCancel, contacto, asesorNombre, asesorId, callApi, onAltDialed, onExternalDial, onAccionRapida }) {
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
  const [prevSelectedId, setPrevSelectedId] = useState('');

  // Ajuste inline al cambiar selectedId — evita render con valor obsoleto (vs useEffect)
  if (selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    if (selectedId && tipificaciones.length > 0) {
      const tipificacion = tipificaciones.find(t => t.id === parseInt(selectedId));
      if (tipificacion?.requiere_agd) {
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
  }

  // Preselección inline cuando tipifInicial o tipificaciones cambia — evita stale render
  const [prevTipifInicial, setPrevTipifInicial] = useState(null);
  const [prevTipificacionesLen, setPrevTipificacionesLen] = useState(0);
  const tipifCode = typeof tipifInicial === 'string' ? tipifInicial : tipifInicial?.codigo;
  const tipifOrTipsChanged = tipifCode !== prevTipifInicial || tipificaciones.length !== prevTipificacionesLen;
  if (open && tipifCode && tipificaciones.length > 0 && !selectedId && tipifOrTipsChanged) {
    setPrevTipifInicial(tipifCode);
    setPrevTipificacionesLen(tipificaciones.length);
    const matched = tipificaciones.find(t => t.codigo === tipifCode);
    if (matched) setSelectedId(matched.id.toString());
  }

  // Plantillas cargadas desde la config del supervisor
  const [templates, setTemplates] = useState({});
  const [codigoPais, setCodigoPais] = useState('593');

  // Sincronizar email/teléfono inline cuando cambia open o contacto
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevContacto, setPrevContacto] = useState(contacto);
  if (open !== prevOpen || contacto !== prevContacto) {
    setPrevOpen(open);
    setPrevContacto(contacto);
    if (open && contacto?.metadata?.['CORREO CLIENTE']) {
      setEmailDestino(contacto.metadata['CORREO CLIENTE']);
    } else if (!open) {
      setEmailDestino('');
      setTelefonoAlt('');
    }
  }

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
        if (tipifInicial) {
          const initCode = typeof tipifInicial === 'string' ? tipifInicial : tipifInicial.codigo;
          const found = data.find(t => t.codigo === initCode);
          if (found) setSelectedId(found.id.toString());
        }
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
    if (!tipificacion) return;

    // Validar si requiere agendamiento y tiene datos
    const isAgendable = tipificacion.requiere_agd;
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

  // ── Helpers compartidos ──────────────────────────────────────
  const selectedTip  = tipificaciones.find(t => t.id.toString() === selectedId);
  const isAgendable  = selectedTip?.requiere_agd;
  const COMP_CODES   = ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP'];
  const showMonto    = selectedTip && COMP_CODES.includes(selectedTip.codigo);
  const valorMora    = (() => {
    const raw = contacto?.metadata?.['VALOR EN MORA'];
    if (raw == null) return null;
    const p = parseFloat(String(raw).replace(/[^0-9.-]/g, ''));
    return isNaN(p) ? null : p;
  })();


  // ── Sección: Agendar promesa ──────────────────────────────────
  const seccionAgendar = isAgendable ? (
    <div style={{ marginBottom: 12, padding: '14px', background: 'linear-gradient(135deg,rgba(0,230,118,0.07),rgba(0,230,118,0.03))', borderRadius: 12, border: '1px solid rgba(0,230,118,0.25)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:12 }}>
        <div style={{ width:28, height:28, borderRadius:'50%', background:'rgba(0,230,118,0.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span className="material-symbols-outlined" style={{ fontSize:16, color:'#00e676' }}>schedule</span>
        </div>
        <div>
          <div style={{ fontSize:12, fontWeight:700, color:'#00e676' }}>Agendar promesa</div>
          <div style={{ fontSize: 12, opacity:0.55 }}>¿Cuándo se realiza el pago?</div>
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight:700, opacity:0.5, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:5 }}>📅 Fecha</div>
          <input aria-label="Fecha" type="date" value={fechaAgendamiento} onChange={e=>setFechaAgendamiento(e.target.value)} min={todayLocalISO()}
            style={{ fontSize:13, padding:'8px 10px', colorScheme:'dark', background:'rgba(0,0,0,0.3)', border:'1px solid rgba(0,230,118,0.3)', borderRadius:8, color:'#fff', width:'100%' }} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight:700, opacity:0.5, letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:5 }}>🕐 Hora</div>
          <input aria-label="Hora" type="time" value={horaAgendamiento} onChange={e=>setHoraAgendamiento(e.target.value)}
            style={{ fontSize:13, padding:'8px 10px', colorScheme:'dark', background:'rgba(0,0,0,0.3)', border:'1px solid rgba(0,230,118,0.3)', borderRadius:8, color:'#fff', width:'100%' }} />
        </div>
      </div>
    </div>
  ) : null;

  // ── Sección: Monto ────────────────────────────────────────────
  const seccionMonto = showMonto ? (
    <div style={{ marginBottom:12, padding:'12px 14px', background:'linear-gradient(135deg,rgba(255,193,7,0.07),rgba(255,193,7,0.03))', borderRadius:12, border:'1px solid rgba(255,193,7,0.25)' }}>
      <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10 }}>
        <div style={{ width:28, height:28, borderRadius:'50%', background:'rgba(255,193,7,0.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span className="material-symbols-outlined" style={{ fontSize:16, color:'#ffc107' }}>payments</span>
        </div>
        <div>
          <div style={{ fontSize:12, fontWeight:700, color:'#ffc107' }}>{LABEL_MONTO[selectedTip.codigo] || 'Monto acordado'} <span style={{ color:'#ff5252' }}>*</span></div>
          <div style={{ fontSize: 12, opacity:0.5 }}>Campo obligatorio</div>
        </div>
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <div style={{ position:'relative', flex:1 }}>
          <span style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', fontSize:14, fontWeight:700, color:'#ffc107', opacity:0.7 }}>$</span>
          <input aria-label="Monto" type="number" min="0" step="0.01" value={montoAcordado} onChange={e=>setMontoAcordado(e.target.value)} placeholder="0.00" required
            style={{ width:'100%', fontSize:15, padding:'8px 10px 8px 26px', fontWeight:700, background:'rgba(0,0,0,0.35)', border:'1px solid rgba(255,193,7,0.3)', borderRadius:8, color:'#fff' }} />
        </div>
        {valorMora != null && (
          <button type="button" onClick={() => setMontoAcordado(String(valorMora))} title={`Mora: $${valorMora.toFixed(2)}`}
            style={{ padding:'0 12px', fontSize: 12, whiteSpace:'nowrap', fontWeight:700, background:'rgba(255,193,7,0.15)', border:'1px solid rgba(255,193,7,0.35)', color:'#ffc107', borderRadius:8, cursor:'pointer' }}>
            💰 ${valorMora.toFixed(2)}
          </button>
        )}
      </div>
    </div>
  ) : null;

  // ── Sección: Notas ────────────────────────────────────────────
  const seccionNotas = (
    <div style={{ marginBottom:12 }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
        <span className="material-symbols-outlined" style={{ fontSize:14, opacity:0.4 }}>edit_note</span>
        <span style={{ fontSize: 12, fontWeight:700, opacity:0.4, letterSpacing:'0.08em', textTransform:'uppercase' }}>Notas / Comentario</span>
      </div>
      <textarea aria-label="Notas / Comentario"
        style={{ width:'100%', minHeight:52, resize:'none', padding:'9px 12px', fontSize:12, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, lineHeight:1.5, color:'#fff', transition:'border-color 0.2s' }}
        onFocus={e=>e.target.style.borderColor='rgba(100,181,246,0.45)'}
        onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'}
        placeholder="Escribe detalles relevantes de la gestión..."
        value={notas} onChange={e=>setNotas(e.target.value)}
      />
    </div>
  );

  // ── Sección: Acciones rápidas ─────────────────────────────────
  const seccionAcciones = (
    <div style={{ background:'rgba(255,255,255,0.02)', padding:'10px 12px', borderRadius:10, border:'1px solid rgba(255,255,255,0.06)', marginBottom:14 }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
        <span className="material-symbols-outlined" style={{ fontSize:13, opacity:0.35 }}>bolt</span>
        <span style={{ fontSize: 12, fontWeight:700, opacity:0.35, letterSpacing:'0.1em', textTransform:'uppercase' }}>Acciones Rápidas</span>
      </div>
      <div style={{ display:'flex', gap:6, marginBottom:8, alignItems:'center' }}>
        <button type="button" disabled={!telefonoAlt.trim()} onClick={()=>{ if(!telefonoAlt.trim()) return; setShowRefPanel(true); setRefNombre(''); setRefParentesco(''); }}
          style={{ flexShrink:0, width:26, height:26, borderRadius:'50%', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', background: telefonoAlt.trim()?'rgba(76,175,80,0.8)':'rgba(255,255,255,0.08)', opacity: telefonoAlt.trim()?1:0.35, transition: 'background 0.2s, opacity 0.2s, border-color 0.2s, color 0.2s' }}>
          <span className="material-symbols-outlined" style={{ fontSize:13, color:'#000' }}>save</span>
        </button>
        <input aria-label="Teléfono" type="tel" value={telefonoAlt} onChange={e=>setTelefonoAlt(e.target.value)} placeholder={contacto?.telefono || 'Otro número'}
          style={{ padding:'5px 8px', fontSize: 12, width:'100%', background:'rgba(0,0,0,0.3)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'#fff' }} />
        <button type="button" disabled={!telefonoAlt.trim()} onClick={async()=>{ let num=telefonoAlt.trim(); if(!num.startsWith('0')) num='0'+num; const fn=callApi||window.api.invoke; try{await fn('adb:dial',num); if(onExternalDial) onExternalDial(num); showToast(`Marcando ${num}...`,'info');}catch(e){showToast('Error: '+(e?.message||e),'error');} }}
          style={{ flexShrink:0, width:26, height:26, borderRadius:'50%', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', background: telefonoAlt.trim()?'rgba(33,150,243,0.8)':'rgba(255,255,255,0.08)', opacity: telefonoAlt.trim()?1:0.35, transition: 'background 0.2s, opacity 0.2s, border-color 0.2s, color 0.2s' }}>
          <span className="material-symbols-outlined" style={{ fontSize:13, color:'#fff' }}>call</span>
        </button>
      </div>
      {showRefPanel && (
        <div style={{ marginBottom:8, padding:'9px 10px', background:'rgba(100,181,246,0.06)', border:'1px solid rgba(100,181,246,0.2)', borderRadius:8 }}>
          <div style={{ fontSize: 12, fontWeight:700, color:'#64b5f6', marginBottom:7 }}>GUARDAR REFERENCIA</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:7 }}>
            <input aria-label="Nombre del referido" type="text" placeholder="Nombre del referido" value={refNombre} onChange={e=>setRefNombre(e.target.value)}
              style={{ fontSize: 12, padding:'4px 8px', background:'rgba(0,0,0,0.3)', border:'1px solid rgba(100,181,246,0.25)', borderRadius:6, color:'#fff' }} />
            <select value={refParentesco} onChange={e=>setRefParentesco(e.target.value)}
              style={{ fontSize: 12, padding:'4px 8px', background:'rgba(0,0,0,0.5)', border:'1px solid rgba(100,181,246,0.25)', borderRadius:6, color:'#fff' }}>
              <option value="">Parentesco...</option>
              <option value="conyuge">Cónyuge</option><option value="padre/madre">Padre/Madre</option>
              <option value="hijo/a">Hijo/a</option><option value="hermano/a">Hermano/a</option>
              <option value="amigo/a">Amigo/a</option><option value="otro">Otro</option>
            </select>
          </div>
          <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
            <button type="button" style={{ fontSize: 12, padding:'3px 10px', background:'transparent', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'#aaa', cursor:'pointer' }} onClick={()=>setShowRefPanel(false)}>Omitir</button>
            <button type="button" style={{ fontSize: 12, padding:'3px 10px', background:'rgba(100,181,246,0.2)', border:'1px solid rgba(100,181,246,0.4)', borderRadius:6, color:'#64b5f6', cursor:'pointer', fontWeight:700 }}
              onClick={()=>{ let num=telefonoAlt.trim(); if(!num.startsWith('0')) num='0'+num; if(onAltDialed) onAltDialed(num, notas, refNombre.trim()||null, refParentesco||null); showToast('Subgestión guardada','success'); setShowRefPanel(false); setTelefonoAlt(''); setRefNombre(''); setRefParentesco(''); }}>
              Confirmar
            </button>
          </div>
        </div>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
        {[{label:'WhatsApp',icon:'chat',handler:handleSendWSP,color:'#25D366',disabled:!contacto?.telefono},{label:'SMS',icon:'sms',handler:handleSendSMS,color:'#64b5f6',disabled:!contacto?.telefono},{label:'Correo',icon:'email',handler:handleSendEmail,color:'#f48fb1',disabled:false}].map(({label,icon,handler,color,disabled})=>(
          <button type="button" key={label} onClick={handler} disabled={disabled}
            style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'7px 4px', borderRadius:8, border:`1px solid ${disabled?'rgba(255,255,255,0.06)':color+'33'}`, background:disabled?'rgba(255,255,255,0.02)':color+'11', color:disabled?'rgba(255,255,255,0.2)':color, cursor:disabled?'not-allowed':'pointer', fontSize: 12, fontWeight:700, letterSpacing:'0.04em' }}>
            <span className="material-symbols-outlined" style={{ fontSize:16 }}>{icon}</span>
            {label.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );

  // ── Botones principales ───────────────────────────────────────
  const seccionBotones = (canSave) => (
    <div style={{ display:'flex', gap:8 }}>
      <button type="button" onClick={onCancel} style={{ flex:1, fontSize:12, padding:'11px 8px', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.04)', color:'rgba(255,255,255,0.55)', cursor:'pointer', fontWeight:600 }}>
        Cancelar
      </button>
      <button type="button" onClick={handleSave} disabled={!canSave || isSaving}
        style={{ flex:2.5, fontSize:12, padding:'11px 8px', borderRadius:10, cursor:(!canSave||isSaving)?'not-allowed':'pointer', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:7, border:'none', background:(!canSave||isSaving)?'rgba(255,255,255,0.06)':'linear-gradient(135deg,#00e676,#00c853)', color:(!canSave||isSaving)?'rgba(255,255,255,0.3)':'#000', boxShadow:(!canSave||isSaving)?'none':'0 4px 20px rgba(0,230,118,0.35)', transition: 'background 0.2s, opacity 0.2s, border-color 0.2s, color 0.2s' }}>
        <span className="material-symbols-outlined" style={{ fontSize:17 }}>{isSaving?'hourglass_top':'task_alt'}</span>
        {isSaving?'Guardando...':'Guardar Gestión'}
      </button>
    </div>
  );

  // ── Modo COMPACTO: cuando viene de "Promesa de pago" ─────────
  const formContentCompacto = (
    <>
      {loading ? (
        <div className="spinner-container"><span className="spinner" /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Fila 1: Fecha · Hora · Monto */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.45, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 3 }}>FECHA</div>
              <input aria-label="Fecha" type="date" value={fechaAgendamiento} onChange={e=>setFechaAgendamiento(e.target.value)} min={todayLocalISO()}
                style={{ fontSize: 12, padding: '6px 8px', width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', colorScheme: 'dark' }}
                onFocus={e=>e.target.style.borderColor='#00e676'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'} />
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.45, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 3 }}>HORA</div>
              <input aria-label="Hora" type="time" value={horaAgendamiento} onChange={e=>setHoraAgendamiento(e.target.value)}
                style={{ fontSize: 12, padding: '6px 8px', width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', colorScheme: 'dark' }}
                onFocus={e=>e.target.style.borderColor='#00e676'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <div style={{ fontSize: 12, opacity: 0.45, fontWeight: 700, letterSpacing: '0.06em' }}>MONTO $</div>
                {valorMora != null && (
                  <button type="button" onClick={()=>setMontoAcordado(String(valorMora))}
                    style={{ fontSize: 12, color: '#ffc107', background: 'rgba(255,193,7,0.12)', border: 'none', borderRadius: 4, padding: '1px 5px', cursor: 'pointer', fontWeight: 700 }}>
                    ${valorMora.toFixed(2)}
                  </button>
                )}
              </div>
              <input aria-label="Monto" type="number" min="0" step="0.01" value={montoAcordado} onChange={e=>setMontoAcordado(e.target.value)} placeholder="0.00"
                style={{ fontSize: 12, padding: '6px 8px', width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff' }}
                onFocus={e=>e.target.style.borderColor='#ffc107'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'} />
            </div>
          </div>

          {/* Fila 2: Nota */}
          <textarea aria-label="Notas"
            style={{ width: '100%', minHeight: 38, resize: 'none', padding: '6px 9px', fontSize: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#fff', lineHeight: 1.4 }}
            onFocus={e=>e.target.style.borderColor='rgba(100,181,246,0.4)'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'}
            placeholder="Notas del compromiso..."
            value={notas} onChange={e=>setNotas(e.target.value)}
          />

          {/* Fila 3: Acciones rápidas + botones */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[
              {label:'WSP', icon:'chat', handler:handleSendWSP, color:'#25D366', disabled:!contacto?.telefono},
              {label:'SMS', icon:'sms',  handler:handleSendSMS,  color:'#64b5f6', disabled:!contacto?.telefono},
              {label:'Email',icon:'email',handler:handleSendEmail,color:'#f48fb1', disabled:false},
            ].map(({label,icon,handler,color,disabled})=>(
              <button type="button" key={label} onClick={handler} disabled={disabled} title={label}
                style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 10px', borderRadius:6, border:`1px solid ${disabled?'rgba(255,255,255,0.06)':color+'40'}`, background:disabled?'transparent':color+'12', color:disabled?'rgba(255,255,255,0.2)':color, cursor:disabled?'not-allowed':'pointer', fontSize:11, fontWeight:700 }}>
                <span className="material-symbols-outlined" style={{ fontSize:14 }}>{icon}</span>
                {label}
              </button>
            ))}
            <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
              <button type="button" onClick={onCancel}
                style={{ fontSize:12, padding:'6px 14px', borderRadius:6, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'rgba(255,255,255,0.5)', cursor:'pointer', fontWeight:600 }}>
                Cancelar
              </button>
              <button type="button" onClick={handleSave} disabled={!selectedId || isSaving}
                style={{ fontSize:12, padding:'6px 18px', borderRadius:6, cursor:(!selectedId||isSaving)?'not-allowed':'pointer', fontWeight:700, border:'none', background:(!selectedId||isSaving)?'rgba(255,255,255,0.06)':'linear-gradient(135deg,#00e676,#00c853)', color:(!selectedId||isSaving)?'rgba(255,255,255,0.3)':'#000' }}>
                {isSaving?'Guardando...':'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // ── Modo COMPLETO: llamada normal ────────────────────────────

  const formContentCompleto = (
    <>
      {loading ? (
        <div className="spinner-container"><span className="spinner" /></div>
      ) : (
        <>
          {/* Grilla de tipificaciones */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize: 12, fontWeight:700, opacity:0.35, letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:10 }}>Resultado de la gestión</div>
            {(() => {
              const grouped = tipificaciones.reduce((acc, t) => {
                const cat = (t.categoria || 'OTROS').toUpperCase();
                if (!acc[cat]) acc[cat] = [];
                if (!acc[cat].find(x => x.descripcion.toUpperCase() === t.descripcion.toUpperCase())) acc[cat].push(t);
                return acc;
              }, {});
              return Object.keys(grouped).map(cat => {
                const meta = CATEGORY_META[cat] || CATEGORY_META['OTROS'];
                return (
                  <div key={cat} style={{ marginBottom:10 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:7, padding:'3px 9px', background:meta.bg, border:`1px solid ${meta.border}`, borderRadius:20, width:'fit-content' }}>
                      <span className="material-symbols-outlined" style={{ fontSize:12, color:meta.color }}>{meta.icon}</span>
                      <span style={{ fontSize: 12, fontWeight:800, color:meta.color, letterSpacing:'0.1em' }}>{cat}</span>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))', gap:6 }}>
                      {grouped[cat].map(t => {
                        const isSel = selectedId === t.id.toString();
                        const tipIcon = TIPIF_ICON[t.codigo] || 'label';
                        return (
                          <button type="button" key={t.id} onClick={() => setSelectedId(t.id.toString())}
                            style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:5, padding:'9px 6px', borderRadius:10, cursor:'pointer', fontSize: 12, fontWeight:700, lineHeight:1.2, letterSpacing:'0.03em', textAlign:'center', transition: 'background 0.15s, opacity 0.15s, border-color 0.15s, color 0.15s', border:isSel?`2px solid ${meta.color}`:`1.5px solid ${meta.border}`, background:isSel?`${meta.bg.replace('0.08','0.22')}`:'rgba(255,255,255,0.03)', color:isSel?meta.color:'rgba(255,255,255,0.65)', boxShadow:isSel?`0 0 12px ${meta.color}28`:'none', transform:isSel?'translateY(-1px)':'none' }}>
                            <span className="material-symbols-outlined" style={{ fontSize:18, color:isSel?meta.color:'rgba(255,255,255,0.3)', transition:'color 0.15s' }}>{tipIcon}</span>
                            {t.descripcion.toUpperCase()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
          {seccionAgendar}
          {seccionMonto}
          {seccionNotas}
          {seccionAcciones}
          {seccionBotones(!!selectedId)}
        </>
      )}
    </>
  );

  // ── Selección de contenido ────────────────────────────────────
  const formContent = tipifInicial ? formContentCompacto : formContentCompleto;

  const isPmp = tipifInicial === 'PMP';
  const titleText = isPmp ? "Programar Promesa de Pago" : "Tipificar Gestión";
  const subtitleText = isPmp ? "Define los detalles del compromiso y contacta al cliente" : "Selecciona el resultado de esta llamada para cerrar la gestión:";

  if (!open) return null;

  if (mode === 'inline') {
    return (
      <div className="widget-card tipificacion-inline-panel">
        <div className="widget-header" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--color-primary)' }}>assignment</span>
            <h3 className="widget-title" style={{ fontSize: 15 }}>{titleText}</h3>
          </div>
          <button type="button" className="btn-crm" onClick={onCancel} style={{ padding: '4px 8px', fontSize: 12 }}>
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
    <Modal open={open} title={titleText} onClose={onCancel}>
      <div className="tipificacion-form">
        <p className="text-body-md" style={{ marginBottom: 20, color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 500 }}>
          {subtitleText}
        </p>
        {formContent}
      </div>
    </Modal>
  );
}

