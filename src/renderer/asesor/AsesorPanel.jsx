import React, { useState, useEffect, useRef, useCallback } from 'react';
import NavigationDrawer from '../shared/NavigationDrawer';
import TopAppBar from '../shared/TopAppBar';
import Modal from '../shared/Modal';
import ToastContainer, { showToast } from '../shared/Toast';
import '../shared/theme.css';
import './AsesorPanel.css';
import CampaignSelector from './CampaignSelector';
import TipificacionDialog from './TipificacionDialog';
import AsesorCompromisos from './AsesorCompromisos';
import AsesorMensajes from './AsesorMensajes';
import IndicadoresPanel from './IndicadoresPanel';
import DashboardProductividad from './DashboardProductividad';
import { nowLocalISO, todayLocalISO } from '../shared/timeUtils';
import { assertChannelAllowedLocal, handleAuthStatus } from '../shared/apiClient';

const WS_PORT = 3001;

const ESTADOS = [
  { id: 1, nombre: 'En Gestión',     icon: 'phone_in_talk', cssClass: 'active' },
  { id: 2, nombre: 'Almuerzo',       icon: 'restaurant',    cssClass: 'data' },
  { id: 3, nombre: 'Baño',           icon: 'wc',            cssClass: 'break' },
  { id: 4, nombre: 'Capacitación',   icon: 'school',        cssClass: 'training' },
  { id: 5, nombre: 'Reunión',        icon: 'groups',        cssClass: 'meeting' },
];

function formatTimer(seg) {
  const h = Math.floor(seg / 3600).toString().padStart(2, '0');
  const m = Math.floor((seg % 3600) / 60).toString().padStart(2, '0');
  const s = (seg % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function Kpi({ label, value, color }) {
  return (
    <div style={{
      flex: '1 1 130px', minWidth: 110, padding: '8px 12px', borderRadius: 8,
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <div style={{ fontSize: 12, opacity: 0.5, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2, color: color || 'inherit' }}>{value}</div>
    </div>
  );
}

function SectionHeader({ icon, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      fontSize: 12, fontWeight: 700, opacity: 0.55,
      textTransform: 'uppercase', letterSpacing: 0.6,
      marginBottom: 8,
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{icon}</span>
      {label}
    </div>
  );
}

function Field({ icon, label, value, mono, bold = 600, color }) {
  return (
    <div>
      <span style={{ fontSize: 12, opacity: 0.5, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, letterSpacing: 0.3 }}>
        {icon && <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{icon}</span>}
        {label}
      </span>
      <span className={mono ? 'text-mono' : ''} style={{ display: 'block', fontSize: 12, fontWeight: bold, marginTop: 2, color: color || 'inherit' }}>
        {value}
      </span>
    </div>
  );
}

function playBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.3);
  } catch (e) { console.warn('BEEP fallido:', e); }
}

export default function AsesorPanel({ usuario, onLogout }) {
  // ── Estado de Navegación y Conectividad ──
  const [activePage, setActivePage] = useState('dashboard');
  const wsStatusRef = useRef('DESCONECTADO');
  const [isDeviceConnected, setIsDeviceConnected] = useState(false);
  const [wsIp, setWsIp] = useState(localStorage.getItem('uphone_ws_ip') || '192.168.1.192');
  const wsActiveIpRef = useRef(wsIp);
  const adbErrorNotifiedRef = useRef(false);

  // ── Estado de Gestión ──
  const [estadoActual, setEstadoActual] = useState(null);
  const [tiempoEstado, setTiempoEstado] = useState(0);
  const [tiemposAcumulados, setTiemposAcumulados] = useState({});
  // Base de tiempo cargada desde DB (incluye sesiones anteriores del día)
  const [tiempoProductivoDB, setTiempoProductivoDB] = useState(0);
  const [tiempoImproductivoDB, setTiempoImproductivoDB] = useState(0);
  const [marcaciones, setMarcaciones] = useState(0);
  const [marcacionesDetalle, setMarcacionesDetalle] = useState([0, 0, 0]);
  // Contadores de acciones rápidas del día (WSP/SMS/EMAIL)
  const [wspEnviados, setWspEnviados] = useState(0);
  const [wspDetalle, setWspDetalle] = useState({ 0: 0, 1: 0, 2: 0 });
  const [smsEnviados, setSmsEnviados] = useState(0);
  const [smsDetalle, setSmsDetalle] = useState({ 0: 0, 1: 0, 2: 0 });
  const [correosEnviados, setCorreosEnviados] = useState(0);
  const [emailDetalle, setEmailDetalle] = useState({ 0: 0, 1: 0, 2: 0 });
  // Sidebar estado colapsado (icon-only)
  const [navCollapsed, setNavCollapsed] = useState(true);

  // ── Campaña y Contacto ──
  const [campana, setCampana] = useState(() => {
    try { const s = sessionStorage.getItem('active_campaign:v1'); return s ? JSON.parse(s) : null; }
    catch { return null; }
  });
  const [showCampaignSelector, setShowCampaignSelector] = useState(!sessionStorage.getItem('active_campaign:v1'));
  const [dialingMode, setDialingMode] = useState('MANUAL');
  const [intentosConfig, setIntentosConfig] = useState(1);
  const [contactoActual, setContactoActual] = useState(null);
  const intentosContactoRef = useRef(0); // intentos acumulados sobre el contacto actual

  // ── Llamada Activa ──
  const [cdrId, setCdrId] = useState(null);
  const [enLlamada, setEnLlamada] = useState(false);
  const [grabando, setGrabando] = useState(false);
  const ultimoAudioPathRef = useRef('');
  const [silenciado, setSilenciado] = useState(false);
  const [altavozActivo, setAltavozActivo] = useState(false);
  const [deviceGrabando, setDeviceGrabando] = useState(false);

  // ── Tipificación y Historial ──
  const [showTipificacion, setShowTipificacion] = useState(false);
  const [tipifInicial, setTipifInicial] = useState(null);
  const [tipificacionesCache, setTipificacionesCache] = useState([]);
  const [dashRefreshTrigger, setDashRefreshTrigger] = useState(0);
  const [historialGestiones, setHistorialGestiones] = useState([]);
  const [totalGestiones, setTotalGestiones] = useState(0);
  const [totalCompromisos, setTotalCompromisos] = useState(0);
  const [compCumplidos, setCompCumplidos] = useState(0);
  const [compReagendados, setCompReagendados] = useState(0);
  const [compIncumplidos, setCompIncumplidos] = useState(0);

  // Función Universal de Tiempo (vFinal): Resiliente a nombres de propiedades inconsistentes
  const formatRawTime = useCallback((itemOrStr) => {
    if (!itemOrStr) return '-';
    
    // Si es objeto, buscar recursivamente en candidatos conocidos de la DB o el State local
    if (typeof itemOrStr === 'object') {
      const val = itemOrStr.agendamiento_hora || itemOrStr.agendamiento_fecha_hora || 
                  itemOrStr.hora_gestion || itemOrStr.creado_en || 
                  itemOrStr.timestamp_inicio || itemOrStr.hora || itemOrStr.timestamp;
      return formatRawTime(val);
    }

    const rawStr = String(itemOrStr);
    if (!rawStr || rawStr === '-' || rawStr === 'undefined') return '-';

    // Priorizar formato HH:MM
    const match = rawStr.match(/(\d{1,2}:\d{2})/);
    if (match) {
      let timeVal = match[1];
      // Si parece ISO, intentar conversión a hora local del navegador
      if (rawStr.includes('T') || rawStr.includes('Z')) {
        try {
          const d = new Date(rawStr.replace(' ', 'T'));
          if (!isNaN(d.getTime())) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          }
        } catch(e) {}
      }
      return timeVal;
    }
    return '-';
  }, []);

  // ── WiFi IP Modal ──
  const [showWifiModal, setShowWifiModal] = useState(false);
  const [wifiIp, setWifiIp] = useState('');

  const [progresoCampana, setProgresoCampana] = useState({ total: 0, gestionados: 0 });
  const [showAgendamientoModal, setShowAgendamientoModal] = useState(false);
  const [agendamientoData, setAgendamientoData] = useState(null);
  const [activeSideTab, setActiveSideTab] = useState('estado');
  const [historialCliente, setHistorialCliente] = useState({ cdrs: [], refs: [] });
  const [expandedCdrId, setExpandedCdrId] = useState(null);
  const [historialRefs, setHistorialRefs] = useState([]);
  const [expandedHistCdrId, setExpandedHistCdrId] = useState(null);
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [cartera, setCartera] = useState([]);
  const [carteraFiltroDias, setCarteraFiltroDias] = useState('general');
  const [carteraFiltro, setCarteraFiltro] = useState('');
  const [carteraEstado, setCarteraEstado] = useState('TODOS');
  const [carteraDesde, setCarteraDesde] = useState('');
  const [carteraHasta, setCarteraHasta] = useState('');

  // ── Refs para estabilidad de red (Backbone de Comunicación) ──
  const wsRef = useRef(null);
  const wsPingRef = useRef(null); // keep-alive para Cloudflare tunnel
  const estadoRef = useRef(estadoActual);
  const metricasRef = useRef({ 
    marcaciones, 
    tiemposAcumulados, 
    totalGestiones, 
    totalCompromisos,
    tiempoEstado 
  });

  // Sincronizar Refs con el estado de React (sin disparar re-renderizados)
  useEffect(() => { estadoRef.current = estadoActual; }, [estadoActual]);
  useEffect(() => {
    metricasRef.current = { marcaciones, tiemposAcumulados, totalGestiones, totalCompromisos, tiempoEstado };
  }, [marcaciones, tiemposAcumulados, totalGestiones, totalCompromisos, tiempoEstado]);

  // ══════════════════════════════════════════════════════════
  // UNIVERSAL DATA FETCHING (Local vs Remote)
  // ══════════════════════════════════════════════════════════
  const isRemote = wsIp && wsIp !== '127.0.0.1' && wsIp !== 'localhost';
  const apiBase = (wsIp?.startsWith('http') ? wsIp.replace(/\/$/, '') : `http://${wsIp}:3001`) + '/api';
  const authToken = localStorage.getItem('auth_token');

  // C2: limpia credenciales y vuelve al login cuando el token caduca.
  const handleUnauthorized = useCallback(() => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user:v1');
    if (typeof onLogout === 'function') onLogout();
  }, [onLogout]);

  const callApi = useCallback(async (channel, ...args) => {
    if (!isRemote) {
      return await window.api.invoke(channel, ...args);
    }

    // Mapeo de canales IPC a endpoints REST
    try {
      let url = '';
      let options = {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      };

      switch (channel) {
        case 'db:getCampanas':
          // args[0] es asesorId
          url = `${apiBase}/campanas/asesor/${args[0] || usuario.id}`;
          break;
        case 'db:getSiguienteContacto':
          // args[0]=campanaId, args[1]=asesorId
          url = `${apiBase}/campanas/${args[0]}/siguiente`;
          break;
        case 'db:insertCdr':
          url = `${apiBase}/cdrs`;
          options.method = 'POST';
          options.body = JSON.stringify(args[0]);
          break;
        case 'db:updateCdr':
          url = `${apiBase}/cdrs/${args[0]}`;
          options.method = 'PATCH';
          options.body = JSON.stringify(args[1]);
          break;
        case 'db:getTipificaciones':
          url = `${apiBase}/tipificaciones`;
          break;
        case 'db:insertEvento':
          url = `${apiBase}/eventos`;
          options.method = 'POST';
          options.body = JSON.stringify(args[0]);
          break;
        case 'db:getMetricasDia':
          url = `${apiBase}/metricas/${args[0] || usuario.id}?fecha=${args[1] || ''}&campanaId=${args[2]?.campanaId || ''}`;
          break;
        case 'db:getCdrs':
          url = `${apiBase}/cdrs?fecha=${args[1] || ''}`;
          break;
        case 'db:marcarContactoGestionado':
          url = `${apiBase}/contactos/${args[0]}/gestionar`;
          options.method = 'PATCH';
          break;
        case 'db:incrementarIntentoContacto':
          url = `${apiBase}/contactos/${args[0]}/intentar`;
          options.method = 'PATCH';
          options.body = JSON.stringify({ maxIntentos: args[1] });
          break;
        case 'db:resetearIntentosContacto':
          url = `${apiBase}/contactos/${args[0]}/resetear-intentos`;
          options.method = 'PATCH';
          break;
        case 'db:insertAgendamiento':
          url = `${apiBase}/agendamientos`;
          options.method = 'POST';
          options.body = JSON.stringify(args[0]);
          break;
        case 'db:getProgresoCampana':
          url = `${apiBase}/campanas/${args[0]}/progreso`;
          break;
        case 'db:getContactoById':
          url = `${apiBase}/contactos/${args[0]}`;
          break;
        case 'db:getCdrsByContacto':
          url = `${apiBase}/contactos/${args[0]}/cdrs`;
          break;
        case 'db:getSubGestionesByAsesor':
          url = `${apiBase}/sub-gestiones?fecha=${args[1] || ''}`;
          break;
        case 'db:getBitacoraAsesor':
          url = `${apiBase}/bitacora?limite=${args[1] || 500}`;
          break;
        case 'db:getCompromisosEquipo': {
          // En Multi-PC el asesor solo ve los suyos via /api/mis-compromisos
          // (args: fecha, asesorId, opts). asesorId se ignora — el backend usa req.user.id.
          const fechaArg = args[0] || '';
          const incVc = args[2]?.incluirVolCall ? '1' : '';
          url = `${apiBase}/mis-compromisos?fecha=${encodeURIComponent(fechaArg)}${incVc ? '&incluirVolCall=' + incVc : ''}`;
          break;
        }
        case 'db:getRefsBitacora':
          url = `${apiBase}/bitacora/refs?limite=${args[1] || 1000}`;
          break;
        case 'db:getCarteraAsesor':
          url = `${apiBase}/cartera?campanaId=${args[1] || ''}`;
          break;
        case 'db:insertSubGestion':
          url = `${apiBase}/sub-gestiones`;
          options.method = 'POST';
          options.body = JSON.stringify(args[0]);
          break;
        case 'db:getConfig': {
          url = `${apiBase}/config`;
          const cfgRes = await fetch(url, options);
          handleAuthStatus(cfgRes.status, handleUnauthorized);
          const fetchedConfig = await cfgRes.json();
          return { valor: fetchedConfig[args[0]] };
        }
        case 'db:getAllConfig':
          url = `${apiBase}/config`;
          break;
        case 'reports:generate': {
          // args[0]=tipo, args[1]=params
          const tipo = args[0];
          const params = args[1] || {};
          // Pasar TODOS los params escalares como query string (excluye objetos/arrays)
          const qsObj = {
            asesor_id: params.asesor_id || usuario.id,
            formato: params.formato || 'xlsx',
          };
          for (const [k, v] of Object.entries(params)) {
            if (v == null || v === '' || typeof v === 'object') continue;
            qsObj[k] = String(v);
          }
          const qs = new URLSearchParams(qsObj);
          url = `${apiBase}/reports/${tipo}?${qs}`;
          const dlRes = await fetch(url, options);
          handleAuthStatus(dlRes.status, handleUnauthorized);
          if (!dlRes.ok) {
            const errData = await dlRes.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${dlRes.status}`);
          }
          // Descargar blob y guardar localmente
          const blob = await dlRes.blob();
          const disposition = dlRes.headers.get('content-disposition') || '';
          const match = disposition.match(/filename="?([^";\n]+)"?/);
          const filename = match ? match[1] : `reporte_${tipo}.xlsx`;
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          return { success: true, archivo: filename };
        }
        case 'db:confirmarPagoCompromiso':
          url = `${apiBase}/confirmar-pago-compromiso`;
          options.method = 'POST';
          options.body = JSON.stringify({ cdrId: args[0], ...(args[1] || {}) });
          break;
        case 'db:reagendarCompromiso':
          url = `${apiBase}/reagendar-compromiso`;
          options.method = 'POST';
          options.body = JSON.stringify({ cdrId: args[0], ...(args[1] || {}) });
          break;
        case 'db:marcarCompromisoIncumplido':
          url = `${apiBase}/marcar-compromiso-incumplido`;
          options.method = 'POST';
          options.body = JSON.stringify({ cdrId: args[0] });
          break;
        case 'db:toggleContactoMensajeria':
          url = `${apiBase}/contactos/${args[0]}/toggle-mensajeria`;
          options.method = 'PATCH';
          options.body = JSON.stringify({ tipo: args[1], estado: args[2] });
          break;
        case 'db:marcarLoteEnviado':
          url = `${apiBase}/marcar-lote-enviado`;
          options.method = 'POST';
          options.body = JSON.stringify({ tipo: args[1], contactoIds: args[2] });
          break;
        case 'db:getLoteMensajeria':
          url = `${apiBase}/cartera?campanaId=&tipo=${args[1] || ''}`;
          break;
        case 'db:getRankingGeneralAsesores':
          url = `${apiBase}/ranking-general?fecha=${args[0] || ''}`;
          break;
        case 'db:getProyeccionMensual':
          url = `${apiBase}/proyeccion-mensual`;
          break;
        case 'db:getIndicadoresCobranza':
          url = `${apiBase}/indicadores-cobranza`;
          break;
        default:
          // C1: solo los canales de dispositivo/sistema (adb/audio/recorder/shell/app)
          // son legítimamente locales. Un canal de datos no mapeado lanzaría error
          // antes de leer la SQLite local vacía del cliente (Multi-PC).
          assertChannelAllowedLocal(channel);
          return await window.api.invoke(channel, ...args);
      }

      const response = await fetch(url, options);
      // C2: token expirado/ inválido → logout global en vez de sesión zombi.
      handleAuthStatus(response.status, handleUnauthorized);
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      console.error(`[API_REMOTE] Error enviando ${channel}:`, err);
      // Fallback a local solo si el error es de red y queremos resiliencia, 
      // pero para Multi-PC si la red falla, no habrá datos.
      throw err;
    }
  }, [isRemote, apiBase, authToken, usuario.id, handleUnauthorized]);

  // ══════════════════════════════════════════════════════════
  // MÉTRICAS WebSocket — Definida aquí para que handleDial pueda usarla
  // ══════════════════════════════════════════════════════════

  const enviarMetricasWS = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const { marcaciones, tiemposAcumulados, totalGestiones, totalCompromisos, tiempoEstado } = metricasRef.current;
    const est = estadoRef.current;

    // Calcular tiempos actuales (incluyendo el tick en curso)
    const currentTiempoProductivo =
      (tiemposAcumulados[1] || 0) + (est?.id === 1 ? tiempoEstado : 0);

    const currentTiempoImproductivo = [2, 3, 4, 5].reduce((acc, id) => {
      return acc + (tiemposAcumulados[id] || 0) + (est?.id === id ? tiempoEstado : 0);
    }, 0);

    const currentProductividad = marcaciones > 0
      ? Math.round((totalCompromisos / marcaciones) * 100)
      : 0;

    ws.send(JSON.stringify({
      tipo: 'METRICAS_ASESOR',
      asesor_id: usuario.id,
      nombre: usuario.nombre,
      marcaciones,
      tiempos_acumulados: tiemposAcumulados,
      total_gestiones: totalGestiones,
      total_compromisos: totalCompromisos,
      eficiencia: currentProductividad,
      tiempo_productivo: currentTiempoProductivo,
      tiempo_improductivo: currentTiempoImproductivo,
      estado_actual_id: est?.id || null,
      progreso_campana: progresoCampana
    }));
  }, [usuario.id, progresoCampana]);

  // ══════════════════════════════════════════════════════════
  // MARCACIÓN FÍSICA (ADB) — Arquitectura Resiliente
  // ══════════════════════════════════════════════════════════

  const handleDial = useCallback(async (contactoIdOrNumber, currentIntentos = 0) => {
    let targetNumber = '';
    let targetContacto = null;

    if (typeof contactoIdOrNumber === 'object') {
      targetNumber = contactoIdOrNumber.telefono;
      targetContacto = contactoIdOrNumber;
    } else {
      targetNumber = contactoIdOrNumber;
      targetContacto = contactoActual;
    }

    if (!targetNumber || enLlamada) return;

    // Asegurar prefijo 0 para celulares/fijos según requerimiento
    if (!targetNumber.startsWith('0')) {
      targetNumber = '0' + targetNumber;
    }

    console.log('[DIAL] Iniciando marcación a:', targetNumber);

    let currentCdrId = cdrId;

    try {
      // PASO 1: invocar ADB primero. Si tiene éxito → llamada real (enLlamada=true, graba).
      // Si falla → gestión manual: un solo CDR + tipificación, sin reintentos automáticos.
      const res = await window.api.invoke('adb:dial', targetNumber);

      if (res.success) {
        setEnLlamada(true);
        setMarcaciones(prev => prev + 1);
        showToast(`Llamada iniciada (${res.latency}ms)`, 'success');

        // PASO 2: ADB OK → crear CDR para tracking de gestión
        if (targetContacto?.id) {
          try {
            const result = await callApi('db:insertCdr', {
              contactoId: targetContacto.id,
              usuarioId: usuario.id,
              timestamp_inicio: nowLocalISO()
            });
            currentCdrId = result.id;
            setCdrId(result.id);
            // Ya NO abrimos tipificación automáticamente al iniciar
          } catch (cdrErr) {
            console.error('[DIAL] Error CDR (no bloquea llamada):', cdrErr);
          }
        }

        enviarMetricasWS();

        if (!grabando && currentCdrId) {
          try {
            await window.api.invoke('recorder:start', currentCdrId);
            setGrabando(true);
          } catch (recErr) {
            console.error('[DIAL] Error grabación (no bloquea):', recErr);
          }
        }
      } else {
        // ADB no disponible: registrar marcación y abrir tipificación para gestión manual.
        // NO se reintenta — un intento por click evita inflado de métricas cuando no hay celular.
        setMarcaciones(prev => prev + 1);
        showToast('Sin conexión ADB — completa la tipificación manualmente', 'warning');
        if (targetContacto?.id) {
          try {
            const result = await callApi('db:insertCdr', {
              contactoId: targetContacto.id,
              usuarioId: usuario.id,
              timestamp_inicio: nowLocalISO()
            });
            currentCdrId = result.id;
            setCdrId(result.id);
            setShowTipificacion(true);
          } catch (cdrErr) {
            console.error('[DIAL] Error CDR (no bloquea):', cdrErr);
          }
        }
        enviarMetricasWS();
      }
    } catch (dialErr) {
      // Error de comunicación con proceso ADB → mismo tratamiento: intento manual
      setMarcaciones(prev => prev + 1);
      showToast(`Sin dispositivo ADB — tipifica manualmente`, 'warning');
      if (targetContacto?.id) {
        try {
          const result = await callApi('db:insertCdr', {
            contactoId: targetContacto.id,
            usuarioId: usuario.id,
            timestamp_inicio: nowLocalISO()
          });
          setCdrId(result.id);
          setShowTipificacion(true);
        } catch { /* silencioso */ }
      }
      enviarMetricasWS();
    }
  }, [usuario.id, contactoActual, cdrId, grabando, enLlamada, dialingMode, intentosConfig, enviarMetricasWS, callApi]);

  async function handleHangup() {
    try {
      const res = await window.api.invoke('adb:hangup');
      if (res.success) {
        setEnLlamada(false);
        setSilenciado(false);
        setAltavozActivo(false);
        setDeviceGrabando(false);

        if (grabando) {
          try {
            const result = await window.api.invoke('recorder:stop');
            setGrabando(false);
            if (result.success) ultimoAudioPathRef.current = result.filePath;
          } catch { /* ignorar */ }
        }

        setShowTipificacion(true);
      } else {
        showToast(`Error al colgar: ${res.error}`, 'error');
      }
    } catch (err) {
      showToast('Error de comunicación con dispositivo', 'error');
    }
  }

  async function handleToggleMute() {
    try {
      const res = await window.api.invoke('adb:toggleMute');
      if (res.success) {
        setSilenciado(prev => !prev);
        showToast(`Micrófono ${!silenciado ? 'silenciado' : 'activado'} (${res.method})`, 'success');
      } else {
        showToast(res.error || 'No se pudo mutear el micrófono', 'error');
      }
    } catch (err) {
      showToast('Error de comunicación con dispositivo', 'error');
    }
  }

  async function handleRecordOnDevice() {
    try {
      const res = await window.api.invoke('adb:startRecordOnDevice', deviceGrabando);
      if (res.success) {
        const nextState = res.recording !== undefined ? res.recording : !deviceGrabando;
        setDeviceGrabando(nextState);
        showToast(
          nextState 
            ? `Grabación iniciada en celular (${res.method})` 
            : `Grabación detenida en celular (${res.method})`, 
          'success'
        );
      } else {
        showToast(res.error || 'No se pudo controlar la grabación remota', 'error');
      }
    } catch (err) {
      showToast('Error de comunicación con dispositivo', 'error');
    }
  }

  async function handleToggleSpeaker() {
    try {
      const newState = !altavozActivo;
      const res = await window.api.invoke('adb:toggleSpeaker', newState);
      if (res.success) {
        setAltavozActivo(newState);
        showToast(`Altavoz ${newState ? 'activado' : 'desactivado'} (${res.method})`, 'success');
      } else {
        showToast(res.error || 'Altavoz no disponible en este dispositivo', 'error');
      }
    } catch (err) {
      showToast('Error de comunicación con dispositivo', 'error');
    }
  }

  const conectarWS = useCallback(() => {
    try {
      // Evitar múltiples conexiones paralelas
      if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
        return;
      }

      const targetIp = wsActiveIpRef.current;
      const wsToken = localStorage.getItem('auth_token') || '';
      const wsUrl = targetIp.startsWith('http')
        ? `${targetIp.replace(/^http/, 'ws').replace(/\/$/, '')}?token=${encodeURIComponent(wsToken)}`
        : `ws://${targetIp}:${WS_PORT}?token=${encodeURIComponent(wsToken)}`;
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        wsStatusRef.current = 'CONECTADO';
        const est = estadoRef.current;
        const met = metricasRef.current;

        socket.send(JSON.stringify({
          tipo: 'IDENTIFICAR',
          rol: 'ASESOR',
          asesor_id: usuario.id,
          nombre: usuario.nombre,
          estado_id: est?.id || null,
        }));

        setTimeout(() => {
          if (est) {
            socket.send(JSON.stringify({
              tipo: 'ESTADO_ASESOR',
              asesor_id: usuario.id,
              estado_id: est.id,
              nombre_estado: est.nombre,
              nombre: usuario.nombre,
              tiempos_acumulados: met.tiemposAcumulados,
            }));
          }
          enviarMetricasWS();
        }, 500);

        // Keep-alive para Cloudflare tunnel (corta WS idle ~100s si solo hay protocol pings)
        clearInterval(wsPingRef.current);
        wsPingRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ tipo: 'ping' }));
          }
        }, 25000);
      };

      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data);

        if (msg.tipo === 'pong') return;

        if (msg.tipo === 'REMOTE_DIAL' || msg.tipo === 'MARCAR_CLIENTE') {
          const tel = msg.telefono || msg.cliente?.telefono;
          if (tel) handleDial(tel);
        }

        if (msg.tipo === 'SET_DIALING_MODE') {
          setDialingMode(msg.modo);
          if (msg.intentos !== undefined) setIntentosConfig(Number(msg.intentos));
        }

        if (msg.tipo === 'CONFIG_UPDATED') {
          window.dispatchEvent(new CustomEvent('config-updated', { detail: msg }));
        }

        if (msg.tipo === 'agendamiento:aviso' || msg.tipo === 'agendamiento:ejecutar') {
          const evtName = msg.tipo;
          const handler = evtName === 'agendamiento:aviso' ? handleAvisoLocal : handleEjecutarLocal;
          if (handler) handler(msg);
        }
      };

      socket.onclose = () => {
        wsStatusRef.current = 'DESCONECTADO';
        clearInterval(wsPingRef.current);
        if (wsRef.current === socket) {
          // Reintento amortiguado para evitar martilleo
          setTimeout(conectarWS, 5000);
        }
      };

      socket.onerror = (err) => {
        wsStatusRef.current = 'ERROR';
      };
    } catch (err) {
      setTimeout(conectarWS, 5000);
    }
  }, [usuario.id, handleDial, enviarMetricasWS]); // Dependencias estables

  useEffect(() => {
    const handleAudioChunk = (chunk) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          tipo: 'AUDIO_CHUNK',
          asesor_id: usuario.id,
          data: chunk
        }));
      }
    };
    window.api.on('audio:chunk', handleAudioChunk);
    return () => window.api.removeAllListeners('audio:chunk');
  }, [usuario.id]);

  // ── MONITOREO DEL ESTADO FÍSICO DE LA LLAMADA ──
  useEffect(() => {
    let pollInterval;
    if (enLlamada) {
      pollInterval = setInterval(async () => {
        try {
          const res = await window.api.invoke('adb:checkCallStatus');
          // Si comprobamos exitosamente que no hay llamada activa pero nuestra app cree que sí
          if (res.success && res.active === false) {
            console.log('[CALL SYNC] El celular ha colgado, reseteando estado local.');
            setEnLlamada(false);
            setSilenciado(false);
            setAltavozActivo(false);
            setDeviceGrabando(false);
            
            if (grabando) {
              try {
                const result = await window.api.invoke('recorder:stop');
                setGrabando(false);
                if (result.success) ultimoAudioPathRef.current = result.filePath;
              } catch { /* ignorar */ }
            }
            setShowTipificacion(true);
          }
        } catch (e) {
             // Ignorar errores de red temporales
        }
      }, 3000); // Revisar cada 3s
    }
    return () => clearInterval(pollInterval);
  }, [enLlamada, grabando]);

  // ── LISTENERS DE AGENDAMIENTO ──
  const cargarContactoAgendado = useCallback(async (contactoId) => {
    try {
      const contacto = await callApi('db:getContactoById', contactoId);
      if (contacto) {
        if (contacto.metadata && typeof contacto.metadata === 'string') {
          try { contacto.metadata = JSON.parse(contacto.metadata); } catch { /* ignorar */ }
        }
        // Resetear estado de contacto para permitir nueva gestión
        setContactoActual(contacto);
        setCdrId(null);
        intentosContactoRef.current = 0;
        showToast(`Contacto ${contacto.nombre_deudor || contacto.telefono} cargado`, 'success');
      } else {
        showToast('Contacto no encontrado en la base', 'warning');
      }
    } catch (err) {
      showToast('Error al cargar contacto agendado', 'error');
    }
  }, [callApi]);


  const handleAvisoLocal = useCallback((data) => {
    const nombre = data.nombre_deudor || `#${data.contacto_id}`;
    const tipoLabel = (data.tipo_agendamiento || data.tipo) === 'PMP' ? 'Compromiso de pago' : 'Volver a llamar';

    playBeep();
    showToast(
      `En 5 min: ${tipoLabel} — ${nombre}`,
      'warning', 0,
      { actionLabel: 'VER CLIENTE', onClick: () => cargarContactoAgendado(data.contacto_id) }
    );
  }, [cargarContactoAgendado]);

  const handleEjecutarLocal = useCallback((data) => {
    const nombre = data.nombre_deudor || `#${data.contacto_id}`;
    const tipoLabel = (data.tipo_agendamiento || data.tipo) === 'PMP' ? 'Compromiso de pago' : 'Volver a llamar';

    playBeep();
    setTimeout(playBeep, 500); // Doble beep para ejecución

    setAgendamientoData(data);
    setShowAgendamientoModal(true);

    showToast(
      `AHORA: ${tipoLabel} — ${nombre} (${data.telefono || ''})`,
      'success', 0,
      { actionLabel: 'GESTIONAR', onClick: () => {
        setShowAgendamientoModal(false);
        cargarContactoAgendado(data.contacto_id);
        setActivePage('dashboard');
      }}
    );
  }, [cargarContactoAgendado]);

  useEffect(() => {
    const offAviso = window.api.on('agendamiento:aviso', handleAvisoLocal);
    const offEjecutar = window.api.on('agendamiento:ejecutar', handleEjecutarLocal);

    return () => {
      if (typeof offAviso === 'function') offAviso();
      if (typeof offEjecutar === 'function') offEjecutar();
    };
  }, [handleAvisoLocal, handleEjecutarLocal]);

  // 🚀 CONEXIÓN WEB SOCKET ESTABLE (Solo al montar o cambiar IP)
  useEffect(() => {
    conectarWS();
    return () => {
      console.log('[WS] Cerrando socket por cleanup del panel');
      wsRef.current?.close();
    };
  }, [conectarWS]); // conectarWS ahora es estable

  // ⏰ CRONÓMETRO Y LATIDO DE MÉTRICAS (Independiente de la red)
  useEffect(() => {
    const timerInterval = setInterval(() => {
      if (estadoActual) {
        setTiempoEstado(prev => prev + 1);
      }
    }, 1000);

    const metricsHeartbeat = setInterval(() => {
      enviarMetricasWS();
    }, 15000);

    return () => {
      clearInterval(timerInterval);
      clearInterval(metricsHeartbeat);
    };
  }, [estadoActual, enviarMetricasWS]);

  useEffect(() => {
    async function checkDevice() {
      try {
        const stats = await window.api.invoke('adb:getDeviceStats');
        setIsDeviceConnected(!!stats.connected);
        if (!!stats.connected) {
          adbErrorNotifiedRef.current = false; // Reset when connected
        }
      } catch (err) {
        setIsDeviceConnected(false);
        if (!adbErrorNotifiedRef.current) {
          showToast('Dispositivo ADB desconectado o no encontrado.', 'error');
          adbErrorNotifiedRef.current = true;
        }
      }
    }

    async function loadInitialDialingConfig() {
      try {
        const resModo = await callApi('db:getConfig', 'modo_marcacion');
        if (resModo?.valor) setDialingMode(resModo.valor);

        const resIntentos = await callApi('db:getConfig', 'intentos_marcacion');
        if (resIntentos?.valor) setIntentosConfig(parseInt(resIntentos.valor) || 1);
      } catch (e) {
        console.warn('Error cargando config inicial de marcación:', e);
      }
    }

    checkDevice();
    loadInitialDialingConfig();
    const interval = setInterval(checkDevice, 4000);
    return () => clearInterval(interval);
  }, [callApi]);

  const fetchMetricas = useCallback(async () => {
    try {
      const opts = campana?.id ? { campanaId: campana.id } : {};
      const data = await callApi('db:getMetricasDia', usuario.id, null, opts);
      if (data && typeof data.total_marcaciones === 'number') {
        setMarcaciones(data.total_marcaciones);
      }
      if (data) {
        if (typeof data.tiempo_al_aire === 'number') setTiempoProductivoDB(data.tiempo_al_aire);
        if (typeof data.tiempo_muerto  === 'number') setTiempoImproductivoDB(data.tiempo_muerto);
        if (Array.isArray(data.marcaciones_detalle))  setMarcacionesDetalle(data.marcaciones_detalle);
        // wsp/sms/email detalle se calculan desde cartera — no sobreescribir con totales históricos del servidor
        if (typeof data.compromisos_cumplidos   === 'number') setCompCumplidos(data.compromisos_cumplidos);
        if (typeof data.compromisos_reagendados === 'number') setCompReagendados(data.compromisos_reagendados);
        if (typeof data.compromisos_incumplidos === 'number') setCompIncumplidos(data.compromisos_incumplidos);
        // Sincronizar contadores de sesión con la BD (cubre reconexiones mid-day)
        if (typeof data.cdrs_total       === 'number') setTotalGestiones(data.cdrs_total);
        if (typeof data.total_compromisos === 'number') setTotalCompromisos(data.total_compromisos);
      }
    } catch (err) {
      console.warn('Error fetching metrics:', err);
    }
  }, [usuario.id, callApi, campana?.id]);

  // Sincroniza métricas desde DB y luego empuja heartbeat WS con datos frescos.
  // Usado por AsesorCompromisos onCompromisoAction para actualizar supervisor inmediatamente.
  const fetchMetricasYEnviar = useCallback(async () => {
    await fetchMetricas();
    // Esperar un tick para que React propague el nuevo state a metricasRef vía useEffect
    await new Promise(resolve => setTimeout(resolve, 50));
    enviarMetricasWS();
  }, [fetchMetricas, enviarMetricasWS]);

  useEffect(() => {
    fetchMetricas();
    const refreshInterval = setInterval(fetchMetricas, 30000); // refresh cada 30 seg
    return () => clearInterval(refreshInterval);
  }, [fetchMetricas]);

  // Cargar tipificaciones al montar — cache para guardar sin abrir diálogo
  useEffect(() => {
    callApi('db:getTipificaciones').then(data => {
      if (Array.isArray(data)) setTipificacionesCache(data);
    }).catch(() => {});
  }, [callApi]);

  // Tiempo real: actualizar métricas al instante cuando se marca un lote enviado
  useEffect(() => {
    const removeListener = window.api?.on?.('ws:message', (data) => {
      if (data?.tipo === 'LOTE_ENVIADO' && String(data.asesor_id) === String(usuario?.id)) {
        fetchMetricas();
      }
    });
    return () => removeListener?.();
  }, [fetchMetricas, usuario?.id]);

  async function fetchHistorial() {
    try {
      const [items, refs] = await Promise.all([
        callApi('db:getBitacoraAsesor', usuario.id, 500),
        callApi('db:getRefsBitacora', usuario.id, 1000).catch(() => []),
      ]);
      setHistorialGestiones(items || []);
      setHistorialRefs(refs || []);
    } catch (err) {
      console.error('Error fetching historial:', err);
    }
  }

  useEffect(() => {
    if (!contactoActual?.id) { setHistorialCliente({ cdrs: [], refs: [] }); return; }
    callApi('db:getCdrsByContacto', contactoActual.id)
      .then(data => setHistorialCliente(data || { cdrs: [], refs: [] }))
      .catch(() => setHistorialCliente({ cdrs: [], refs: [] }));
  }, [contactoActual?.id]);

  // Cargar bitácora completa cuando se entra a la página de Historial de Gestiones
  useEffect(() => {
    if (activePage === 'historial' && usuario?.id) {
      fetchHistorial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage, usuario?.id]);

  const [carteraLoading, setCarteraLoading] = useState(false);

  // Estados para Lotes / Campañas
  const [loteFiltroDias, setLoteFiltroDias] = useState('general');
  const [loteOrdenMonto, setLoteOrdenMonto] = useState(true);
  const [popupCliente, setPopupCliente] = useState(null);

  const copiarLoteTelefonos = (loteId, clientes) => {
    const text = clientes.map(c => c.telefono).join(',');
    navigator.clipboard.writeText(text).then(() => {
      showToast('Teléfonos del Lote ' + loteId + ' copiados', 'success');
    }).catch(err => showToast('Error al copiar: ' + err.message, 'error'));
  };

  const copiarLoteDatos = (loteId, clientes) => {
    const text = clientes.map(c => (c.nombre_deudor || '') + '\t' + (c.cedula || '') + '\t' + (c.monto_deuda || '')).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      showToast('Datos del Lote ' + loteId + ' copiados', 'success');
    }).catch(err => showToast('Error al copiar: ' + err.message, 'error'));
  };

  // ── Mensajería ──────────────────────────────────────────────────────────────
  const handleToggleMensajeria = async (contactoId, tipo, activo) => {
    if (!usuario?.id) return;
    try {
      await callApi('db:toggleContactoMensajeria', contactoId, tipo, activo ? 'ACTIVO' : 'INACTIVO', usuario.id);
      cargarCartera();
      showToast(activo ? 'Contacto incluido en lote' : 'Contacto quitado del lote', 'success');
    } catch (err) {
      showToast('Error al cambiar estado: ' + err.message, 'error');
    }
  };

  const handleMarcarEnviado = async (tipo) => {
    if (!usuario?.id) return;
    const isWsp = tipo === 'whatsapp';
    const isCorreo = tipo === 'correo';
    const activos = cartera.filter(c => {
      const st = isWsp ? c.whatsapp_status : isCorreo ? c.correo_status : c.rcs_status;
      return st !== 'ENVIADO';
    });
    if (activos.length === 0) {
      showToast('No hay contactos activos en el lote', 'warning');
      return;
    }
    try {
      await callApi('db:marcarLoteEnviado', usuario.id, tipo, activos.map(c => c.id));
      showToast(`✓ ${activos.length} contactos marcados como Enviado`, 'success');
      cargarCartera();
      fetchMetricasYEnviar();
    } catch (err) {
      showToast('Error al marcar enviado: ' + err.message, 'error');
    }
  };

    const cargarCartera = useCallback(async () => {
    if (!usuario?.id) return;
    setCarteraLoading(true);
    try {
      const data = await callApi('db:getCarteraAsesor', usuario.id, campana?.id);
      const arr = Array.isArray(data) ? data : [];
      setCartera(arr);
      // Sincronizar métricas canal con estado real de cartera (círculos verdes = ENVIADO hoy)
      const rcs = { 0: 0, 1: 0, 2: 0 };
      const wsp = { 0: 0, 1: 0, 2: 0 };
      const mail = { 0: 0, 1: 0, 2: 0 };
      arr.forEach(c => {
        let meta = {};
        try { meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {}); } catch (_) {}
        const dias = parseInt(meta['DIAS IMPAGO'] || meta['DIAS EN MORA'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || '0', 10);
        const seg = dias >= 0 && dias <= 2 ? dias : null;
        if (seg === null) return;
        if (c.rcs_status === 'ENVIADO')       rcs[seg]++;
        if (c.whatsapp_status === 'ENVIADO')  wsp[seg]++;
        if (c.correo_status === 'ENVIADO')    mail[seg]++;
      });
      setSmsDetalle(rcs);
      setWspDetalle(wsp);
      setEmailDetalle(mail);
    } catch (err) {
      console.error('[CARTERA]', err);
      setCartera([]);
    } finally {
      setCarteraLoading(false);
    }
  }, [usuario?.id, callApi]);

  // Cargar cartera al montar para inicializar métricas S0/S1/S2 desde el primer momento
  useEffect(() => {
    cargarCartera();
  }, [cargarCartera]);

  // Recargar cartera al navegar a páginas que la muestran
  useEffect(() => {
    if (activePage === 'cartera' || activePage === 'campanas_wsp' || activePage === 'campanas_rcs') {
      cargarCartera();
    }
  }, [activePage, cargarCartera]);

  async function handleConnectUSB() {
    try {
      showToast('Iniciando puente USB...', 'info');
      await window.api.invoke('adb:connectUSB');
    } catch (err) {
      showToast('Error al iniciar puente', 'error');
    }
  }

  async function openWifiModal() {
    try {
      const { valor } = await callApi('db:getConfig', 'ultima_ip_wifi');
      if (valor) setWifiIp(valor);
    } catch { /* ignorar */ }
    setShowWifiModal(true);
  }

  async function handleConnectWifi() {
    if (!wifiIp.trim()) {
      showToast('Ingresa la IP del celular', 'warning');
      return;
    }
    setShowWifiModal(false);
    try {
      showToast(`Conectando WiFi a ${wifiIp}...`, 'info');
      await window.api.invoke('adb:connectWifi', wifiIp);
    } catch (err) {
      showToast('Error al sincronizar', 'error');
    }
  }

  // Cuando el asesor presiona el botón 📞 (dial al externo): SIEMPRE cuenta como
  // marcación, sin importar si después guarda la sub-gestión o si ADB fue exitoso.
  // Registra evento LLAMADA con subtipo DIAL_EXTERNO en metadata.
  async function handleExternalDial(telefono) {
    try {
      await callApi('db:insertEvento', {
        usuario_id: usuario.id,
        tipo: 'LLAMADA',
        metadata: { subtipo: 'DIAL_EXTERNO', telefono, contacto_id: contactoActual?.id || null },
      });
    } catch (err) {
      console.warn('[DIAL_EXT] Error registrando evento:', err);
    }
    setMarcaciones(prev => prev + 1);
    enviarMetricasWS();
  }

  async function handleAltDialed(telefono, notas, nombreRef, parentesco) {
    if (!contactoActual?.id) return;
    try {
      await callApi('db:insertSubGestion', {
        contactoId: contactoActual.id,
        asesorId: usuario.id,
        cdrId: cdrId || null,
        telefono,
        notas: notas || null,
        nombreRef: nombreRef || null,
        parentesco: parentesco || null,
      });
      const [data, refs] = await Promise.all([
        callApi('db:getCdrsByContacto', contactoActual.id),
        callApi('db:getRefsBitacora', usuario.id, 1000).catch(() => []),
      ]);
      setHistorialCliente(data || { cdrs: [], refs: [] });
      setHistorialRefs(refs || []);
    } catch (err) {
      console.warn('[SUB_GESTION] Error al guardar:', err);
    }
  }

  async function registrarEvento(tipo, estadoId, duracion, meta = {}) {
    try {
      await callApi('db:insertEvento', {
        usuario_id: usuario.id,
        tipo,
        estado_id: estadoId,
        duracion_seg: duracion,
        metadata: meta
      });
    } catch (err) {
      console.warn('[SYNC] Error registrando evento remoto:', err);
    }
  }

  function handleEstadoChange(estado) {
    if (estadoActual && tiempoEstado > 0) {
      setTiemposAcumulados(prev => ({
        ...prev,
        [estadoActual.id]: (prev[estadoActual.id] || 0) + tiempoEstado
      }));
      registrarEvento('ESTADO', estadoActual.id, tiempoEstado, { nombre_estado: estadoActual.nombre });
    }

    setEstadoActual(estado);
    setTiempoEstado(0);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        tipo: 'ESTADO_ASESOR',
        asesor_id: usuario.id,
        estado_id: estado.id,
        nombre_estado: estado.nombre,
        nombre: usuario.nombre,
        tiempos_acumulados: tiemposAcumulados,
      }));
    }

    enviarMetricasWS();

    // Ya no hacemos fetchNextContact() automático al entrar a "En Gestión"
    // para que la vista principal (dashboard) no sea reemplazada si el usuario solo quiere contar tiempo.
  }

  async function fetchNextContact() {
    if (!campana?.id) {
      console.warn('[FETCH_CONTACT] Sin campaña activa — abortando');
      return;
    }
    intentosContactoRef.current = 0; // siempre resetear al avanzar de cliente
    try {
      const contacto = await callApi('db:getSiguienteContacto', campana.id, usuario.id);
      if (contacto) {
        if (contacto.metadata && typeof contacto.metadata === 'string') {
          try { contacto.metadata = JSON.parse(contacto.metadata); } catch { /* ignorar */ }
        }
        setContactoActual(contacto);

        // Fetch progreso actualizado
        const p = await callApi('db:getProgresoCampana', campana.id, usuario?.id);
        if (p) setProgresoCampana(p);

        if (dialingMode === 'AUTOMATICA') {
          handleDial(contacto, 0);
        }
      } else {
        showToast('No hay contactos pendientes', 'info');
      }
    } catch (err) {
      console.error('[FETCH_CONTACT] Error:', err?.message || err);
      if (err?.message?.includes('HTTP') || err?.message?.includes('fetch')) {
        showToast('Sin conexión con el servidor — revisa la red LAN', 'error');
      } else {
        showToast('Error al obtener contacto — intenta seleccionar la campaña nuevamente', 'error');
      }
    }
  }

  async function handleSelectCampaign(c) {
    setCampana(c);
    sessionStorage.setItem('active_campaign:v1', JSON.stringify(c));
    setShowCampaignSelector(false);
    
    // Resetear las métricas visuales instantáneamente para que arranquen de 0 en la UI
    setMarcaciones(0);
    setTiempoProductivoDB(0);
    setTiempoImproductivoDB(0);
    setWspEnviados(0);
    setSmsEnviados(0);
    setCorreosEnviados(0);
    setCompCumplidos(0);
    setCompReagendados(0);
    setCompIncumplidos(0);
    setTotalGestiones(0);
    setTotalCompromisos(0);

    // Obtener progreso + métricas con el campanaId correcto inmediatamente
    try {
      const [p, metricaData] = await Promise.allSettled([
        callApi('db:getProgresoCampana', c.id, usuario?.id),
        callApi('db:getMetricasDia', usuario.id, null, { campanaId: c.id }),
      ]);
      if (p.status === 'fulfilled' && p.value) setProgresoCampana(p.value);
      if (metricaData.status === 'fulfilled' && metricaData.value) {
        const d = metricaData.value;
        if (typeof d.total_marcaciones === 'number') setMarcaciones(d.total_marcaciones);
        // wsp/sms/email detalle se calculan desde cartera — no sobreescribir con totales históricos del servidor
        if (typeof d.cdrs_total       === 'number') setTotalGestiones(d.cdrs_total);
        if (typeof d.total_compromisos=== 'number') setTotalCompromisos(d.total_compromisos);
        if (typeof d.compromisos_cumplidos   === 'number') setCompCumplidos(d.compromisos_cumplidos);
        if (typeof d.compromisos_reagendados === 'number') setCompReagendados(d.compromisos_reagendados);
        if (typeof d.compromisos_incumplidos === 'number') setCompIncumplidos(d.compromisos_incumplidos);
        if (Array.isArray(d.marcaciones_detalle)) setMarcacionesDetalle(d.marcaciones_detalle);
      }
    } catch (e) {
      console.warn('Error fetching initial campaign data:', e);
    }
  }

  async function handleSaveTipificacion({ tipificacionId, notas, tipificacion, agendamiento, montoAcordado, _contacto }) {
    // _contacto override evita race condition cuando se llama sin abrir diálogo
    const contactoSnapshot = _contacto || contactoActual;

    try {
      // Resolver CDR activo. Si no existe (fallo silencioso en insertCdr durante el dial
      // o inestabilidad WS en modo Multi-PC), crear uno de respaldo ahora para que el
      // compromiso quede con tipificacion_id y aparezca en getCompromisosEquipo.
      let activeCdrId = cdrId;
      if (!activeCdrId && contactoSnapshot?.id) {
        console.warn('[TIPIFICACION] Sin CDR activo — creando CDR de respaldo');
        try {
          const r = await callApi('db:insertCdr', {
            contactoId: contactoSnapshot.id,
            usuarioId: usuario.id,
            timestamp_inicio: nowLocalISO(),
          });
          activeCdrId = r?.id ?? null;
          if (activeCdrId) setCdrId(activeCdrId);
        } catch (cdrErr) {
          console.error('[TIPIFICACION] No se pudo crear CDR de respaldo:', cdrErr);
        }
      }

      // Lista blanca de códigos que permiten reintento automático.
      // Solo cuando NO hubo contacto humano genuino (no contestó / sonó buzón).
      // Cualquier otro código (efectivo, decisivo, número malo, fallecido, etc.)
      // detiene el ciclo. Failsafe: tipificación nueva sin clasificar NO reintenta.
      const codigosQueReintentan = ['NC', 'BUZON'];
      const esContactoEfectivo = !codigosQueReintentan.includes(tipificacion.codigo);

      // Incrementar contador de intentos ANTES de decidir si marca gestionado
      intentosContactoRef.current += 1;
      const nIntentosActual = intentosContactoRef.current;
      const nIntentosMax = Number(intentosConfig);

      // Optimistic UI: actualizar cartera al instante (estado + gestiones_count)
      if (contactoSnapshot?.id) {
        setCartera(prev => prev.map(x =>
          x.id === contactoSnapshot.id
            ? { ...x, estado_marcacion: 'GESTIONADO', gestiones_count: (x.gestiones_count || 0) + 1 }
            : x
        ));
      }

      // Paralelizar todas las escrituras a BD — reduce latencia de ~6s a ~1-2s
      const dbWrites = [];
      if (activeCdrId) {
        dbWrites.push(callApi('db:updateCdr', activeCdrId, {
          tipificacionId,
          notas,
          timestampFin: nowLocalISO(),
          resultado: tipificacion.descripcion,
          urlGrabacion: ultimoAudioPathRef.current,
          montoAcordado: montoAcordado ?? null,
        }));
      } else {
        console.warn('[TIPIFICACION] Sin CDR activo ni respaldo — gestión sin referencia CDR');
      }
      if (contactoSnapshot?.id && typeof contactoSnapshot.id === 'number') {
        dbWrites.push(callApi('db:incrementarIntentoContacto', contactoSnapshot.id, nIntentosMax));
        dbWrites.push(callApi('db:marcarContactoGestionado', contactoSnapshot.id));
      }
      await Promise.all(dbWrites);

      // Agendamiento (secuencial — depende del contacto ya gestionado)
      if (agendamiento && contactoSnapshot?.id) {
        try {
          await callApi('db:insertAgendamiento', {
            contacto_id: contactoSnapshot.id,
            asesor_id: usuario.id,
            tipo: agendamiento.tipo,
            fecha_hora: `${agendamiento.fecha}T${agendamiento.hora}:00`,
            notas: notas || tipificacion.descripcion
          });
          showToast('Agendamiento programado', 'info');
        } catch (err) {
          console.error('[AGENDAMIENTO] Error al guardar:', err);
          showToast('Error al registrar horario de agendamiento', 'error');
        }
      }

      // Actualizar historial local con nombres de propiedad ESTÁNDAR de la DB
      const nuevaGestion = {
        id: Date.now(),
        contacto_id: contactoSnapshot?.id || null,
        nombre_deudor: contactoSnapshot?.nombre_deudor || 'Desconocido',
        telefono: contactoSnapshot?.telefono || '',
        resultado: tipificacion.descripcion,
        hora_gestion: nowLocalISO(),
        agendamiento_hora: agendamiento ? `${agendamiento.hora}` : '-'
      };

      setHistorialGestiones(prev => [nuevaGestion, ...prev].slice(0, 20));

      setTotalGestiones(prev => prev + 1);
      // Compromisos de pago reales (excluye VOL_CALL que es solo "volver a llamar")
      // Alineado con query backend: códigos PMP, PAGO_REAL, AB_PARC, PEND_COMP
      const codigosCompromiso = ['PMP', 'PAGO_REAL', 'AB_PARC', 'PEND_COMP'];
      const esGestionExitosa = codigosCompromiso.includes(tipificacion.codigo);
      if (esGestionExitosa) setTotalCompromisos(prev => prev + 1);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          tipo: 'TIPIFICACION_REALIZADA',
          asesor_id: usuario.id,
          nombre: usuario.nombre,
          contacto_id: contactoSnapshot?.id,
          tipificacion: tipificacion.descripcion,
          notas,
          tiempos_acumulados: tiemposAcumulados,
          progreso_campana: progresoCampana
        }));
        // Refrescar progreso en segundo plano (no bloquea el flujo principal)
        if (campana?.id) {
          callApi('db:getProgresoCampana', campana.id, usuario?.id)
            .then(p => { if (p) setProgresoCampana(p); })
            .catch(() => {});
        }
      }

      showToast('Gestión registrada', 'success');
      setDashRefreshTrigger(p => p + 1);
      fetchMetricasYEnviar();

      // ── Lógica de intentos por contacto ──────────────────────────────────
      // (intentosContactoRef ya fue incrementado arriba, antes de debeMarcarGestionado)

      const puedeReintentar =
        !esContactoEfectivo &&
        dialingMode === 'AUTOMATICA' &&
        nIntentosActual < nIntentosMax &&
        estadoActual?.id === 1 &&
        campana;
      if (puedeReintentar) {
        showToast(`Reintentando contacto (${nIntentosActual + 1}/${intentosConfig})...`, 'info');
        setTimeout(() => handleDial(contactoSnapshot, 0), 1500);
      } else {
        // Avanzar al siguiente contacto
        intentosContactoRef.current = 0;
        setContactoActual(null);
        if (estadoActual?.id === 1 && campana) {
          setTimeout(fetchNextContact, 1500);
        }
      }

    } catch (err) {
      console.error('[handleSaveTipificacion] Excepción crítica:', err);
      showToast(`Error: ${err.message || 'Fallo interno al guardar tipificación'}`, 'error');
    } finally {
      // Siempre limpiar estado de llamada activa — incluso si hubo error en DB/IPC.
      // Sin esto el form queda "pegado" abierto con enLlamada=true tras un fallo.
      setEnLlamada(false);
      setShowTipificacion(false);
      setTipifInicial(null);
      setCdrId(null);
      setDeviceGrabando(false);
    }
  }

  // Base de DB (sesiones previas del día) + acumulado local (estados cambiados en esta sesión)
  // + tiempo en estado actual (ticking en vivo)
  const tiempoTotalProductivo = tiempoProductivoDB
    + (tiemposAcumulados[1] || 0)
    + (estadoActual?.id === 1 ? tiempoEstado : 0);
  const tiempoTotalImproductivo = tiempoImproductivoDB
    + [2, 3, 4, 5].reduce((acc, id) => acc + (tiemposAcumulados[id] || 0), 0)
    + ([2, 3, 4, 5].includes(estadoActual?.id) ? tiempoEstado : 0);
  
  const handleDownloadExcel = async () => {
    try {
      const res = await callApi('reports:generate', 'gestiones', { asesor_id: usuario.id, formato: 'xlsx' });
      if (res.success) {
        showToast('Historial descargado con éxito', 'success');
        // En modo remoto el archivo ya se descargó vía blob; en local abrir el archivo
        if (!isRemote && res.archivo) await callApi('shell:openPath', res.archivo);
      } else {
        showToast('Error al descargar historial: ' + res.error, 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error en la comunicación al descargar EXCEL', 'error');
    }
  };

  // Exporta la bitácora FILTRADA desde el frontend a CSV
  const handleDownloadCsv = (entries) => {
    if (!entries || entries.length === 0) {
      showToast('No hay registros para exportar', 'warning');
      return;
    }
    const escapeCsv = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n;]/.test(s) ? `"${s}"` : s;
    };
    const headers = ['Tipo', 'Fecha', 'Hora', 'Cliente', 'Telefono', 'Tipificacion', 'Duracion_seg', 'Notas'];
    const rows = entries.map(e => {
      const ts = e.creado_en || e.timestamp_inicio || e.timestamp || '';
      const fecha = ts ? ts.slice(0, 10) : '';
      const hora = ts ? ts.slice(11, 19) : '';
      const tip = e._tipo === 'REF' ? 'Llamada referencia' : (e.tipificacion_desc || e.resultado || '');
      const tel = e._tipo === 'REF' ? (e.telefono || e.telefono_ref || '') : (e.telefono || '');
      return [
        e._tipo, fecha, hora,
        e.nombre_deudor || e.nombre || '',
        tel, tip,
        e.duracion_seg || '',
        e.notas || '',
      ].map(escapeCsv).join(',');
    });
    // BOM UTF-8 → Excel detecta acentos
    const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bitacora_${usuario.nombre.replace(/\s+/g, '_')}_${todayLocalISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${entries.length} registros exportados a CSV`, 'success');
  };

  return (
    <div className={`app-layout${navCollapsed ? ' nav-collapsed' : ''}`}>
      <ToastContainer />

      <NavigationDrawer
        userRole="asesor"
        activePage={activePage}
        onNavigate={(page) => {
          setActivePage(page);
          // Al entrar a la consola (dashboard) activar timer productivo automáticamente
          if (page === 'dashboard' && estadoActual?.id !== 1) {
            handleEstadoChange(ESTADOS[0]); // ESTADOS[0] = { id:1, nombre:'En Gestión' }
          }
        }}
        usuario={usuario}
        onLogout={onLogout}
        compactContent={<AsesorMensajes compact={true} usuario={usuario} />}
        collapsed={navCollapsed}
        onToggleCollapse={() => setNavCollapsed(prev => !prev)}
      />

      <div className="app-main">
        <TopAppBar
          userName={usuario.nombre}
          userRole="Asesor de Cobranza"
          isConnected={isDeviceConnected}
          onLogout={onLogout}
          asesorStats={{
            tiempoProductivo: tiempoTotalProductivo,
            tiempoImproductivo: tiempoTotalImproductivo,
            marcaciones,
            marcacionesDetalle,
            wspEnviados: Object.values(wspDetalle).reduce((a, b) => a + b, 0),
            wspDetalle,
            smsEnviados: Object.values(smsDetalle).reduce((a, b) => a + b, 0),
            smsDetalle,
            correosEnviados: Object.values(emailDetalle).reduce((a, b) => a + b, 0),
            emailDetalle,
            totalGestiones,
            totalCompromisos,
            compromisosCumplidos: compCumplidos,
            compromisosReagendados: compReagendados,
            compromisosIncumplidos: compIncumplidos,
          }}
        />

        <div className="app-content">
          {activePage === 'historial' ? (
            <div className="widget-card" style={{ maxWidth: 900, margin: '0 auto' }}>
              <div className="widget-header" style={{ marginBottom: 12 }}>
                <div>
                  <span className="text-label" style={{ opacity: 0.5 }}>BITÁCORA DEL ASESOR</span>
                  <h3 className="widget-title" style={{ marginTop: 4 }}>Historial de Gestiones</h3>
                  <p className="text-body-sm" style={{ opacity: 0.4, marginTop: 2, fontSize: 12 }}>
                    Todas tus gestiones, agrupadas por día
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button"
                    className="btn btn-outline btn-sm"
                    style={{ padding: '4px 12px', fontSize: 12, height: 'auto' }}
                    onClick={handleDownloadExcel}
                    disabled={historialGestiones.length === 0}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
                    Descargar XLS
                  </button>
                  {grabando && (
                    <div className="audio-wave">
                      {[...Array(4)].map((_, i) => <span key={i} className="bar" />)}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Barra de filtros ── */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '10px 12px', marginBottom: 14, borderRadius: 8,
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
                  <span className="material-symbols-outlined" style={{
                    position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 16, opacity: 0.4, pointerEvents: 'none',
                  }}>search</span>
                  <input aria-label="Campo"
                    type="text"
                    value={filtroTexto}
                    onChange={(e) => setFiltroTexto(e.target.value)}
                    placeholder="Buscar nombre, teléfono, tipificación, notas..."
                    style={{
                      width: '100%', padding: '6px 28px 6px 30px', fontSize: 12,
                      background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6, color: 'inherit',
                    }}
                  />
                  {filtroTexto && (
                    <button type="button"
                      onClick={() => setFiltroTexto('')}
                      title="Limpiar texto"
                      style={{
                        position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        padding: 4, opacity: 0.5, display: 'flex',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="text-label-sm" style={{ opacity: 0.5, fontSize: 12 }}>Desde</span>
                  <input aria-label="Desde"
                    type="date"
                    value={filtroDesde}
                    onChange={(e) => setFiltroDesde(e.target.value)}
                    style={{
                      padding: '5px 8px', fontSize: 12, colorScheme: 'dark',
                      background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6, color: 'inherit',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="text-label-sm" style={{ opacity: 0.5, fontSize: 12 }}>Hasta</span>
                  <input aria-label="Hasta"
                    type="date"
                    value={filtroHasta}
                    onChange={(e) => setFiltroHasta(e.target.value)}
                    style={{
                      padding: '5px 8px', fontSize: 12, colorScheme: 'dark',
                      background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6, color: 'inherit',
                    }}
                  />
                </div>
                {(filtroTexto || filtroDesde || filtroHasta) && (
                  <button type="button"
                    onClick={() => { setFiltroTexto(''); setFiltroDesde(''); setFiltroHasta(''); }}
                    style={{
                      padding: '5px 10px', fontSize: 12, background: 'rgba(255,80,80,0.1)',
                      border: '1px solid rgba(255,80,80,0.25)', color: '#ff8080',
                      borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>filter_alt_off</span>
                    Limpiar
                  </button>
                )}
              </div>

              {(() => {
                const fmtDur = (seg) => {
                  if (!seg || seg <= 0) return null;
                  const m = Math.floor(seg / 60);
                  const s = seg % 60;
                  return `${m}:${s.toString().padStart(2, '0')}`;
                };
                const fmtHora = (ts) => {
                  if (!ts || typeof ts !== 'string') return '-';
                  try {
                    const d = new Date(ts.replace(' ', 'T'));
                    if (isNaN(d.getTime())) return '-';
                    return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });
                  } catch { return '-'; }
                };
                const histRefsForCdr = (cdrId) => historialRefs.filter(r => r.cdr_id != null && Number(r.cdr_id) === Number(cdrId));
                const histOrphanRefs = historialRefs.filter(r => r.cdr_id == null);
                const fmtFechaDia = (iso) => {
                  if (!iso) return 'Sin fecha';
                  const hoy = todayLocalISO();
                  const ayer = (() => { const d = new Date(Date.now() - 86400000); const tz = d.getTimezoneOffset() * 60000; return new Date(d.getTime() - tz).toISOString().slice(0, 10); })();
                  if (iso === hoy) return 'Hoy';
                  if (iso === ayer) return 'Ayer';
                  try {
                    return new Date(iso + 'T00:00:00').toLocaleDateString('es-EC', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
                  } catch { return iso; }
                };
                const extraerFecha = (item) => {
                  if (item.fecha_gestion) return item.fecha_gestion;
                  const candidatos = [item.creado_en, item.timestamp_inicio, item.hora_gestion, item.hora, item.timestamp];
                  for (const c of candidatos) {
                    if (c && typeof c === 'string' && c.length >= 10) return c.slice(0, 10);
                  }
                  return '';
                };
                const tsValue = (item) => {
                  const ts = item.creado_en || item.timestamp_inicio || item.hora_gestion || item.timestamp || '';
                  return ts ? new Date(ts.replace(' ', 'T')).getTime() : 0;
                };

                // Lista unificada: CDRs + refs huérfanas (cada una como entrada independiente)
                const entriesAll = [
                  ...historialGestiones.map(g => ({ ...g, _tipo: 'CDR', _ts: tsValue(g) })),
                  ...histOrphanRefs.map(r => ({ ...r, _tipo: 'REF', _ts: tsValue(r) })),
                ].sort((a, b) => b._ts - a._ts);

                // ── Aplicar filtros ──
                const txt = filtroTexto.trim().toLowerCase();
                const matchesTexto = (e) => {
                  if (!txt) return true;
                  const haystack = [
                    e.nombre_deudor, e.nombre, e.telefono, e.telefono_principal, e.telefono_ref,
                    e.tipificacion_desc, e.tipificacion_codigo, e.resultado, e.notas,
                    e._tipo === 'REF' ? 'llamada referencia' : '',
                  ].filter(Boolean).join(' ').toLowerCase();
                  // También buscar refs vinculadas para CDRs
                  if (e._tipo === 'CDR') {
                    const refsJoined = histRefsForCdr(e.id).map(r =>
                      [r.telefono, r.telefono_ref, r.notas].filter(Boolean).join(' ')
                    ).join(' ').toLowerCase();
                    if (refsJoined.includes(txt)) return true;
                  }
                  return haystack.includes(txt);
                };
                const matchesFecha = (e) => {
                  const f = extraerFecha(e);
                  if (filtroDesde && f < filtroDesde) return false;
                  if (filtroHasta && f > filtroHasta) return false;
                  return true;
                };
                const entries = entriesAll.filter(e => matchesTexto(e) && matchesFecha(e));
                const hayFiltros = txt || filtroDesde || filtroHasta;

                return entriesAll.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{
                      fontSize: 12, opacity: 0.55, marginBottom: 4,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span>
                        {hayFiltros
                          ? `${entries.length} de ${entriesAll.length} registros`
                          : `${entriesAll.length} registros`}
                      </span>
                      {hayFiltros && entries.length > 0 && (
                        <button type="button"
                          onClick={() => handleDownloadCsv(entries)}
                          style={{
                            padding: '3px 9px', fontSize: 12,
                            background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)',
                            color: 'var(--color-primary)', borderRadius: 6, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 3,
                          }}
                          title="Descargar resultados filtrados a CSV"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>download</span>
                          Descargar filtrado (CSV)
                        </button>
                      )}
                    </div>

                    {entries.length === 0 && (
                      <div style={{ padding: '32px 0', textAlign: 'center', opacity: 0.4 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 36, marginBottom: 8 }}>search_off</span>
                        <p className="text-body-sm">Ningún registro coincide con los filtros</p>
                      </div>
                    )}

                    {entries.map((entry, idx) => {
                      const fechaActual = extraerFecha(entry);
                      const fechaPrev = idx > 0 ? extraerFecha(entries[idx - 1]) : null;
                      const showDateHeader = fechaActual !== fechaPrev;
                      const dateHeader = showDateHeader && (
                        <div key={`dh-${fechaActual}`} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          marginTop: idx === 0 ? 0 : 12, marginBottom: 2,
                          padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)'
                        }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 13, opacity: 0.4 }}>event</span>
                          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.55 }}>
                            {fmtFechaDia(fechaActual)}
                          </span>
                        </div>
                      );

                      // ── REF huérfana: tarjeta naranja sin expand ──
                      if (entry._tipo === 'REF') {
                        return (
                          <React.Fragment key={`ref-frag-${entry.id}`}>
                            {dateHeader}
                            <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,152,0,0.15)' }}>
                              <div style={{
                                background: 'rgba(255,152,0,0.04)', padding: '10px 14px',
                                borderLeft: '3px solid #ffb74d',
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                                  <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>
                                    {entry.nombre_deudor || 'Cliente'}
                                  </span>
                                  <button type="button"
                                    className="btn btn-outline btn-sm"
                                    style={{ padding: '2px 9px', fontSize: 12, height: 'auto' }}
                                    onClick={() => { cargarContactoAgendado(entry.contacto_id); setActivePage('dashboard'); }}
                                    disabled={!entry.contacto_id}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 12, marginRight: 2 }}>phone_callback</span>
                                    Gestionar
                                  </button>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{
                                    fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                                    background: 'rgba(255,152,0,0.18)', color: '#ffb74d',
                                  }}>
                                    📞 Llamada a referencia
                                  </span>
                                  <span className="text-mono" style={{ fontSize: 12, opacity: 0.7, color: '#ffb74d' }}>
                                    {entry.telefono || entry.telefono_ref}
                                  </span>
                                  {entry.nombre_ref && (
                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', opacity: 0.85 }}>
                                      {entry.nombre_ref}
                                    </span>
                                  )}
                                  {entry.parentesco && (
                                    <span style={{ fontSize: 12, padding: '1px 6px', borderRadius: 10, background: 'rgba(100,181,246,0.15)', color: '#64b5f6', fontWeight: 600 }}>
                                      {entry.parentesco}
                                    </span>
                                  )}
                                  <span className="text-mono" style={{ fontSize: 12, opacity: 0.4 }}>
                                    {fmtHora(entry.timestamp || entry.creado_en)}
                                  </span>
                                </div>
                                {entry.notas && (
                                  <p style={{ fontSize: 12, opacity: 0.55, margin: '5px 0 0', lineHeight: 1.4 }}>
                                    {entry.notas}
                                  </p>
                                )}
                              </div>
                            </div>
                          </React.Fragment>
                        );
                      }

                      // ── CDR: tarjeta verde colapsable ──
                      const g = entry;
                      const isOpen = expandedHistCdrId === g.id;
                      const gRefs = histRefsForCdr(g.id);
                      const dur = fmtDur(g.duracion_seg);
                      return (
                        <React.Fragment key={`hg-frag-${g.id}`}>
                          {dateHeader}
                          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)' }}>
                            <div
                              onClick={() => setExpandedHistCdrId(isOpen ? null : g.id)}
                              style={{
                                background: 'rgba(255,255,255,0.04)', padding: '10px 14px',
                                cursor: 'pointer', borderLeft: '3px solid var(--color-primary)',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>
                                  {g.nombre_deudor || g.nombre || 'Cliente'}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <button type="button"
                                    className="btn btn-outline btn-sm"
                                    style={{ padding: '2px 9px', fontSize: 12, height: 'auto' }}
                                    onClick={(e) => { e.stopPropagation(); cargarContactoAgendado(g.contacto_id); setActivePage('dashboard'); }}
                                    disabled={!g.contacto_id}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 12, marginRight: 2 }}>phone_callback</span>
                                    Gestionar
                                  </button>
                                  <span className="material-symbols-outlined" style={{ fontSize: 14, opacity: 0.4, transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                                    chevron_right
                                  </span>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{
                                  fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                                  background: 'rgba(0,230,118,0.12)', color: 'var(--color-primary)',
                                }}>
                                  {g.tipificacion_desc || g.resultado || 'Sin tipificación'}
                                </span>
                                <span className="text-mono" style={{ fontSize: 12, opacity: 0.55 }}>{g.telefono || '-'}</span>
                                {dur && (
                                  <span style={{ fontSize: 12, opacity: 0.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>timer</span>
                                    {dur}
                                  </span>
                                )}
                                <span className="text-mono" style={{ fontSize: 12, opacity: 0.4 }}>
                                  {fmtHora(g.hora_gestion || g.creado_en || g.hora)}
                                </span>
                                {gRefs.length > 0 && (
                                  <span style={{ fontSize: 12, background: 'rgba(255,152,0,0.2)', color: '#ffb74d', padding: '1px 5px', borderRadius: 99 }}>
                                    {gRefs.length} ref
                                  </span>
                                )}
                                {(() => {
                                  const agTs = g.agendamiento_hora || g.agendamiento_fecha_hora || g.fecha_hora;
                                  const agStr = fmtHora(agTs);
                                  if (!agTs || agStr === '-') return null;
                                  return (
                                    <span style={{ fontSize: 12, background: 'rgba(0,150,255,0.15)', color: '#64b5f6', padding: '1px 5px', borderRadius: 99 }}>
                                      ⏰ {agStr}
                                    </span>
                                  );
                                })()}
                              </div>
                              {g.notas && (
                                <p style={{
                                  fontSize: 12, opacity: 0.55, margin: '5px 0 0', lineHeight: 1.4,
                                  overflow: 'hidden', display: '-webkit-box',
                                  WebkitLineClamp: isOpen ? 10 : 2, WebkitBoxOrient: 'vertical'
                                }}>
                                  {g.notas}
                                </p>
                              )}
                            </div>

                            {isOpen && (
                              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '6px 14px 8px 22px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                {gRefs.length > 0 ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    <span style={{ fontSize: 12, opacity: 0.4, fontWeight: 700, marginBottom: 2 }}>LLAMADAS EXTERNAS</span>
                                    {gRefs.map((ref) => (
                                      <div key={`href-${ref.id}`} style={{
                                        display: 'flex', flexDirection: 'column', gap: 3,
                                        borderLeft: '2px solid rgba(255,152,0,0.4)', paddingLeft: 8
                                      }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                          <span style={{ fontSize: 12, fontWeight: 600, color: '#ffb74d' }}>
                                            📞 {ref.telefono || ref.telefono_ref}
                                          </span>
                                          {ref.nombre_ref && (
                                            <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>{ref.nombre_ref}</span>
                                          )}
                                          {ref.parentesco && (
                                            <span style={{ fontSize: 12, padding: '1px 6px', borderRadius: 10, background: 'rgba(100,181,246,0.15)', color: '#64b5f6', fontWeight: 600 }}>
                                              {ref.parentesco}
                                            </span>
                                          )}
                                          <span className="text-mono" style={{ fontSize: 12, opacity: 0.45, marginLeft: 'auto' }}>{fmtHora(ref.timestamp || ref.creado_en)}</span>
                                        </div>
                                        {ref.notas && <p style={{ fontSize: 12, opacity: 0.6, margin: 0, lineHeight: 1.3 }}>{ref.notas}</p>}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span style={{ fontSize: 12, opacity: 0.3, fontStyle: 'italic' }}>Sin llamadas externas registradas</span>
                                )}
                              </div>
                            )}
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '48px 0', textAlign: 'center', opacity: 0.3 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 48, marginBottom: 12 }}>history</span>
                    <p className="text-body-sm">Sin gestiones registradas</p>
                  </div>
                );
              })()}
            </div>
          ) : activePage === 'cartera' ? (
            <div className="widget-card" style={{ maxWidth: 1100, margin: '0 auto' }}>
              <div className="widget-header" style={{ marginBottom: 12 }}>
                <div>
                  <span className="text-label" style={{ opacity: 0.5 }}>ASESOR · CARTERA</span>
                  <h3 className="widget-title" style={{ marginTop: 4 }}>Cartera Asignada</h3>
                  <p className="text-body-sm" style={{ opacity: 0.4, marginTop: 2, fontSize: 12 }}>
                    Clientes asignados por el Jefe de Area. Selecciona uno para gestionarlo.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="text-label-sm" style={{ color: 'var(--color-primary)' }}>
                    {cartera.length} clientes
                  </span>
                  <button type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={cargarCartera}
                    disabled={carteraLoading}
                    title="Actualizar orden de marcación"
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 16, animation: carteraLoading ? 'spin 0.8s linear infinite' : 'none' }}
                    >
                      refresh
                    </span>
                    {carteraLoading ? 'Actualizando…' : 'Actualizar'}
                  </button>
                </div>
              </div>

              {/* ── Resumen rápido ── */}
              {(() => {
                const cnt = (estado) => cartera.filter(c => c.estado_marcacion === estado).length;
                const total = cartera.length;
                const gestionados = cnt('GESTIONADO');
                const pendientes = cnt('PENDIENTE');
                const enIntentos = cnt('EN_INTENTOS');
                const agendados = cnt('AGENDADO');
                const yaPago = cnt('YA_PAGO');
                return (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    <Kpi label="Total" value={total} color="var(--color-primary)" />
                    <Kpi label="Pendientes" value={pendientes} color="#ffb74d" />
                    <Kpi label="En intentos" value={enIntentos} color="#fbc02d" />
                    <Kpi label="Agendados" value={agendados} color="#64b5f6" />
                    <Kpi label="Gestionados" value={gestionados} color="var(--color-primary)" />
                    <Kpi label="Ya pagó" value={yaPago} color="#ce93d8" />
                  </div>
                );
              })()}

              {/* ── Chips Días ── */}
              {(() => {
                const countDias = (d) => cartera.filter(c => {
                  let meta = {};
                  try { meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {}); } catch (_) {}
                  return String(meta['DIAS IMPAGO'] || meta['DIAS EN MORA'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || '0') === String(d);
                }).length;
                const gestionados = cartera.filter(c => c.estado_marcacion === 'GESTIONADO').length;
                const chips = [
                  { key: 'general', label: `General ${cartera.length}` },
                  { key: '0',       label: `0 Dias ${countDias(0)}` },
                  { key: '1',       label: `1 Dia ${countDias(1)}` },
                  { key: '2',       label: `2 Dias ${countDias(2)}` },
                  { key: 'gestionados', label: `Gestionados ${gestionados}`, isGestionado: true }
                ];
                return (
                  <div className="cartera-filters" style={{ marginBottom: 12, gap: 8 }}>
                    {chips.map(f => (
                      <button type="button" 
                        key={f.key} 
                        className={`cartera-filter-btn ${carteraFiltroDias === f.key ? 'active' : ''}`}
                        style={f.isGestionado && carteraFiltroDias === f.key ? { background: 'rgba(0,230,118,0.2)', color: 'var(--color-primary)', borderColor: 'var(--color-primary)' } : f.isGestionado ? { color: 'var(--color-primary)' } : {}}
                        onClick={() => setCarteraFiltroDias(f.key)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                );
              })()}

              {/* ── Filtros ── */}
              <div style={{
                display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
                padding: '10px 12px', marginBottom: 12, borderRadius: 8,
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{ flex: '1 1 220px', position: 'relative' }}>
                  <span className="material-symbols-outlined" style={{
                    position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 14, opacity: 0.4, pointerEvents: 'none',
                  }}>search</span>
                  <input aria-label="Campo"
                    type="text"
                    value={carteraFiltro}
                    onChange={(e) => setCarteraFiltro(e.target.value)}
                    placeholder="Buscar nombre, cédula, teléfono, contrato..."
                    style={{
                      width: '100%', padding: '6px 26px 6px 28px', fontSize: 12,
                      background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6, color: 'inherit',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 12, opacity: 0.5 }}>Estado</span>
                  <select
                    value={carteraEstado}
                    onChange={(e) => setCarteraEstado(e.target.value)}
                    style={{
                      padding: '5px 8px', fontSize: 12,
                      background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6, color: 'inherit',
                    }}
                  >
                    <option value="TODOS">Todos</option>
                    <option value="PENDIENTE">Pendientes</option>
                    <option value="EN_INTENTOS">En intentos</option>
                    <option value="AGENDADO">Agendados</option>
                    <option value="GESTIONADO">Gestionados</option>
                    <option value="YA_PAGO">Ya pagó</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 12, opacity: 0.5 }}>Desde</span>
                  <input aria-label="Ya pagó"
                    type="date"
                    value={carteraDesde}
                    onChange={(e) => setCarteraDesde(e.target.value)}
                    style={{
                      padding: '5px 8px', fontSize: 12, colorScheme: 'dark',
                      background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6, color: 'inherit',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 12, opacity: 0.5 }}>Hasta</span>
                  <input aria-label="Hasta"
                    type="date"
                    value={carteraHasta}
                    onChange={(e) => setCarteraHasta(e.target.value)}
                    style={{
                      padding: '5px 8px', fontSize: 12, colorScheme: 'dark',
                      background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6, color: 'inherit',
                    }}
                  />
                </div>
                {(carteraFiltro || carteraEstado !== 'TODOS' || carteraDesde || carteraHasta) && (
                  <button type="button"
                    onClick={() => { setCarteraFiltro(''); setCarteraEstado('TODOS'); setCarteraDesde(''); setCarteraHasta(''); }}
                    style={{
                      padding: '5px 10px', fontSize: 12, background: 'rgba(255,80,80,0.1)',
                      border: '1px solid rgba(255,80,80,0.25)', color: '#ff8080',
                      borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>filter_alt_off</span>
                    Limpiar
                  </button>
                )}
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                  <button type="button"
                    onClick={async () => {
                      if (cartera.length === 0) return;
                      try {
                        await callApi('reports:generate', 'cartera_asesor', {
                          asesor_id: usuario.id,
                          formato: 'xlsx',
                          fecha_desde: carteraDesde || undefined,
                          fecha_hasta: carteraHasta || undefined,
                          estado: carteraEstado !== 'TODOS' ? carteraEstado : undefined,
                        });
                        showToast('Cartera descargada en XLS', 'success');
                      } catch (err) {
                        showToast('Error al descargar XLS: ' + (err.message || err), 'error');
                      }
                    }}
                    className="btn btn-outline btn-sm"
                    style={{ padding: '4px 10px', fontSize: 12, height: 'auto' }}
                    disabled={cartera.length === 0}
                    title="Descargar como Excel"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>table_view</span>
                    XLS
                  </button>
                  <button type="button"
                    onClick={async () => {
                      if (cartera.length === 0) return;
                      try {
                        await callApi('reports:generate', 'cartera_asesor', {
                          asesor_id: usuario.id,
                          formato: 'csv',
                          fecha_desde: carteraDesde || undefined,
                          fecha_hasta: carteraHasta || undefined,
                          estado: carteraEstado !== 'TODOS' ? carteraEstado : undefined,
                        });
                        showToast('Cartera descargada en CSV', 'success');
                      } catch (err) {
                        showToast('Error al descargar CSV: ' + (err.message || err), 'error');
                      }
                    }}
                    className="btn btn-outline btn-sm"
                    style={{ padding: '4px 10px', fontSize: 12, height: 'auto' }}
                    disabled={cartera.length === 0}
                    title="Descargar como CSV"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>download</span>
                    CSV
                  </button>
                </div>
              </div>

              {/* ── Tabla ── */}
              {(() => {
                const ESTADO_STYLE = {
                  PENDIENTE:   { bg: 'rgba(255,152,0,0.15)',  fg: '#ffb74d', label: 'Pendiente'   },
                  EN_INTENTOS: { bg: 'rgba(251,192,45,0.15)', fg: '#fbc02d', label: 'En intentos' },
                  AGENDADO:    { bg: 'rgba(33,150,243,0.15)', fg: '#64b5f6', label: 'Agendado'    },
                  GESTIONADO:  { bg: 'rgba(0,230,118,0.18)',  fg: 'var(--color-primary)', label: 'Gestionado' },
                  YA_PAGO:     { bg: 'rgba(156,39,176,0.15)', fg: '#ce93d8', label: 'Ya pagó'     },
                };
                const ESTADO_STYLE_YA_PAGO_DECL = { bg: 'rgba(255,193,7,0.15)', fg: '#ffd54f', label: 'Ya pagó (s/validar)' };
                const txt = carteraFiltro.trim().toLowerCase();
                const extraerFechaIso = (raw) => (raw && typeof raw === 'string' && raw.length >= 10) ? raw.slice(0, 10) : '';
                const filtrados = cartera.filter(c => {
                  if (carteraEstado !== 'TODOS' && c.estado_marcacion !== carteraEstado) return false;
                  
                  if (carteraFiltroDias !== 'general') {
                    if (carteraFiltroDias === 'gestionados') {
                      if (c.estado_marcacion !== 'GESTIONADO') return false;
                    } else {
                      let meta = {};
                      try { meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {}); } catch (_) {}
                      const dias = String(meta['DIAS IMPAGO'] || meta['DIAS EN MORA'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || '0');
                      if (dias !== carteraFiltroDias) return false;
                    }
                  }

                  if (carteraDesde || carteraHasta) {
                    const f = extraerFechaIso(c.fecha_asignacion);
                    if (carteraDesde && (!f || f < carteraDesde)) return false;
                    if (carteraHasta && (!f || f > carteraHasta)) return false;
                  }
                  if (!txt) return true;
                  let meta = {};
                  try { meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {}); } catch (_) {}
                  const hay = [
                    c.nombre_deudor, c.cedula, c.telefono, c.producto,
                    meta['Nº CONTRATO'], meta['CONTRATO'], meta['NOMBRE CLIENTE'],
                    meta['APELLIDO CLIENTE'], meta['EMPRESA'],
                  ].filter(Boolean).join(' ').toLowerCase();
                  return hay.includes(txt);
                });
                if (cartera.length === 0) {
                  return (
                    <div style={{ padding: '40px 0', textAlign: 'center', opacity: 0.4 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 36 }}>folder_off</span>
                      <p className="text-body-sm" style={{ marginTop: 8 }}>No tienes cartera asignada</p>
                    </div>
                  );
                }
                if (filtrados.length === 0) {
                  return (
                    <div style={{ padding: '32px 0', textAlign: 'center', opacity: 0.4 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 32 }}>search_off</span>
                      <p className="text-body-sm" style={{ marginTop: 6 }}>Sin clientes para los filtros aplicados</p>
                    </div>
                  );
                }
                // Cola de marcación: PENDIENTE/EN_INTENTOS por defecto + cualquier
                // estado (GESTIONADO/AGENDADO/YA_PAGO declarado) con orden_marcacion
                // explícito del supervisor. YA_PAGO validado bancariamente nunca entra.
                const turnoMap = new Map();
                let __t = 0;
                cartera.forEach(c => {
                  if (c.validado_pago === 1) return;
                  const enCola =
                    c.estado_marcacion === 'EN_INTENTOS' ||
                    c.estado_marcacion === 'PENDIENTE' ||
                    c.orden_marcacion != null;
                  if (enCola) turnoMap.set(c.id, ++__t);
                });
                return (
                  <div style={{ borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)', textAlign: 'left' }}>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', textAlign: 'center' }} title="Turno de marcación">Turno</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase' }}>Estado</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase' }}>Cliente</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase' }}>Cédula</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase' }}>Teléfono</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', textAlign: 'right' }}>Mora</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', textAlign: 'center' }}>Días Mora</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', textAlign: 'center' }}>Gestiones</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', textAlign: 'center' }}>RCS</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', textAlign: 'center' }}>Correo</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', textAlign: 'center' }}>WSP</th>
                          <th style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', textAlign: 'right' }}>Llamada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtrados.map(c => {
                          const esYaPagoDecl = c.estado_marcacion === 'YA_PAGO' && c.validado_pago !== 1;
                          const est = esYaPagoDecl
                            ? ESTADO_STYLE_YA_PAGO_DECL
                            : (ESTADO_STYLE[c.estado_marcacion] || { bg: 'rgba(255,255,255,0.08)', fg: '#ccc', label: c.estado_marcacion || '—' });
                          let meta = {};
                          try { meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {}); } catch (_) {}
                          const mora = meta['VALOR EN MORA'] || c.monto_deuda;
                          const diasMora = meta['DIAS IMPAGO'] || meta['DIAS EN MORA'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || '';
                          const yaGestionado = c.estado_marcacion === 'GESTIONADO' || (c.estado_marcacion === 'YA_PAGO' && c.validado_pago === 1);
                          const turno = turnoMap.get(c.id);
                          const esSiguiente = turno === 1;
                          return (
                            <tr key={`crt-${c.id}`} style={{
                              borderTop: '1px solid rgba(255,255,255,0.04)',
                              background: esSiguiente ? 'rgba(0,230,118,0.06)' : undefined,
                            }}>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                {turno ? (
                                  <span style={{
                                    fontSize: esSiguiente ? 11 : 10, fontWeight: 800,
                                    padding: esSiguiente ? '2px 8px' : '1px 6px', borderRadius: 99,
                                    background: esSiguiente ? 'rgba(0,230,118,0.22)' : 'rgba(255,255,255,0.06)',
                                    color: esSiguiente ? 'var(--color-primary)' : 'rgba(255,255,255,0.7)',
                                    border: esSiguiente ? '1px solid rgba(0,230,118,0.45)' : '1px solid rgba(255,255,255,0.08)',
                                    display: 'inline-flex', alignItems: 'center', gap: 3,
                                  }} title={esSiguiente ? 'Próximo cliente a marcar' : `Turno #${turno}`}>
                                    {esSiguiente && <span className="material-symbols-outlined" style={{ fontSize: 12 }}>arrow_forward</span>}
                                    {turno}
                                  </span>
                                ) : (
                                  <span style={{ opacity: 0.3, fontSize: 12 }}>—</span>
                                )}
                              </td>
                              <td style={{ padding: '8px 10px' }}>
                                <span style={{
                                  fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                                  background: est.bg, color: est.fg, whiteSpace: 'nowrap',
                                }}>
                                  {yaGestionado && <span className="material-symbols-outlined" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 2 }}>check_circle</span>}
                                  {est.label}
                                </span>
                              </td>
                              <td style={{ padding: '8px 10px', fontWeight: 600 }}>{c.nombre_deudor || '—'}</td>
                              <td style={{ padding: '8px 10px' }}><span className="text-mono">{c.cedula || '—'}</span></td>
                              <td style={{ padding: '8px 10px' }}><span className="text-mono">{c.telefono || '—'}</span></td>
                              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--color-danger)' }}>
                                {mora ? `$${Number(mora).toFixed(2)}` : '—'}
                              </td>
                              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: diasMora && parseInt(diasMora, 10) > 0 ? '#ff9800' : 'rgba(255,255,255,0.4)' }}>
                                {diasMora ? `${parseInt(diasMora, 10) || diasMora}` : '—'}
                              </td>
                              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                <span style={{
                                  fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                                  background: c.gestiones_count > 0 ? 'rgba(0,230,118,0.15)' : 'rgba(255,255,255,0.05)',
                                  color: c.gestiones_count > 0 ? 'var(--color-primary)' : 'rgba(255,255,255,0.4)',
                                }}>
                                  {c.gestiones_count || 0}
                                </span>
                              </td>
                              {['rcs','correo','wsp'].map(canal => {
                                const statusKey = canal === 'wsp' ? 'whatsapp_status' : canal === 'rcs' ? 'rcs_status' : 'correo_status';
                                const enviado = c[statusKey] === 'ENVIADO';
                                const canalApi = canal === 'wsp' ? 'whatsapp' : canal;
                                const esGestionado = c.estado_marcacion === 'GESTIONADO' || c.estado_marcacion === 'YA_PAGO';
                                const bloqueado = enviado && esGestionado;
                                return (
                                  <td key={canal} style={{ padding: '8px 10px', textAlign: 'center' }}>
                                    <button type="button"
                                      title={bloqueado ? `${canal.toUpperCase()} fijo — cliente gestionado` : enviado ? `Desmarcar ${canal.toUpperCase()}` : `Marcar ${canal.toUpperCase()} como enviado`}
                                      onClick={async () => {
                                        if (bloqueado) return;
                                        const nuevoEstado = enviado ? 'ACTIVO' : 'ENVIADO';
                                        setCartera(prev => prev.map(x =>
                                          x.id === c.id ? { ...x, [statusKey]: nuevoEstado } : x
                                        ));
                                        // Actualizar S0/S1/S2 top bar en tiempo real
                                        let meta = {};
                                        try { meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {}); } catch (_) {}
                                        const diasMora = parseInt(meta['DIAS IMPAGO'] || meta['DIAS EN MORA'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || '0', 10);
                                        const seg = diasMora >= 0 && diasMora <= 2 ? diasMora : null;
                                        const delta = enviado ? -1 : +1;
                                        if (seg !== null) {
                                          if (canal === 'rcs')    setSmsDetalle(p => ({ ...p, [seg]: Math.max(0, (p[seg] || 0) + delta) }));
                                          if (canal === 'correo') setEmailDetalle(p => ({ ...p, [seg]: Math.max(0, (p[seg] || 0) + delta) }));
                                          if (canal === 'wsp')    setWspDetalle(p => ({ ...p, [seg]: Math.max(0, (p[seg] || 0) + delta) }));
                                        }
                                        try {
                                          if (enviado) {
                                            await callApi('db:toggleContactoMensajeria', c.id, canalApi, 'ACTIVO');
                                          } else {
                                            await callApi('db:marcarLoteEnviado', usuario.id, canalApi, [c.id]);
                                          }
                                          fetchMetricasYEnviar();
                                        } catch (e) {
                                          setCartera(prev => prev.map(x =>
                                            x.id === c.id ? { ...x, [statusKey]: enviado ? 'ENVIADO' : 'ACTIVO' } : x
                                          ));
                                          // Revertir contador si falla API
                                          if (seg !== null) {
                                            const revert = -delta;
                                            if (canal === 'rcs')    setSmsDetalle(p => ({ ...p, [seg]: Math.max(0, (p[seg] || 0) + revert) }));
                                            if (canal === 'correo') setEmailDetalle(p => ({ ...p, [seg]: Math.max(0, (p[seg] || 0) + revert) }));
                                            if (canal === 'wsp')    setWspDetalle(p => ({ ...p, [seg]: Math.max(0, (p[seg] || 0) + revert) }));
                                          }
                                          showToast('Error: ' + e.message, 'error');
                                        }
                                      }}
                                      style={{
                                        background: 'none', border: 'none',
                                        cursor: bloqueado ? 'not-allowed' : 'pointer',
                                        padding: 2, borderRadius: 4, display: 'inline-flex', alignItems: 'center',
                                        transition: 'opacity 0.15s', opacity: bloqueado ? 0.5 : 1,
                                      }}
                                      onMouseEnter={e => { if (!bloqueado && !enviado) e.currentTarget.querySelector('span').style.color = '#00e676'; if (!bloqueado && enviado) e.currentTarget.querySelector('span').style.color = '#ff5252'; }}
                                      onMouseLeave={e => { if (!bloqueado && !enviado) e.currentTarget.querySelector('span').style.color = 'rgba(255,255,255,0.2)'; if (!bloqueado && enviado) e.currentTarget.querySelector('span').style.color = '#00e676'; }}
                                    >
                                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: enviado ? '#00e676' : 'rgba(255,255,255,0.2)' }}>
                                        {enviado ? 'check_circle' : 'radio_button_unchecked'}
                                      </span>
                                    </button>
                                  </td>
                                );
                              })}
                              <td style={{ padding: '6px 10px', textAlign: 'center', minWidth: 148 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                  {/* Selector tipificación */}
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (!val) return;
                                      const codeMap = {
                                        cuelga: 'CUE', no_contesta: 'NC', referencia: 'REF',
                                        equivocado: 'EQ', suspendido: 'SUS', negativa_pago: 'NEG',
                                        promesa_pago: 'PMP', tercero: 'TER', volver_llamar: 'VOL_CALL', buzon_voz: 'BUZON',
                                      };
                                      const code = codeMap[val] || val;
                                      if (code === 'PMP') {
                                        // PMP: abre diálogo para fecha/monto/notas
                                        setContactoActual(c);
                                        setTipifInicial('PMP');
                                        setShowTipificacion(true);
                                      } else {
                                        // Resto: guardar directo sin diálogo
                                        const tipif = tipificacionesCache.find(t => t.codigo === code);
                                        if (!tipif) {
                                          // Código no en cache — abrir diálogo como fallback
                                          setContactoActual(c);
                                          setTipifInicial(code);
                                          setShowTipificacion(true);
                                          return;
                                        }
                                        handleSaveTipificacion({
                                          tipificacionId: tipif.id,
                                          notas: '',
                                          tipificacion: { id: tipif.id, codigo: tipif.codigo, descripcion: tipif.descripcion },
                                          agendamiento: null,
                                          montoAcordado: null,
                                          _contacto: c,
                                        });
                                      }
                                    }}
                                    style={{
                                      width: '100%', padding: '5px 8px', fontSize: 11, borderRadius: 6,
                                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)',
                                      color: 'rgba(255,255,255,0.75)', cursor: 'pointer', outline: 'none',
                                      appearance: 'none', textAlign: 'center',
                                    }}
                                  >
                                    <option value="" disabled style={{ background: '#1e1e1e' }}>⚡ Tipificar...</option>
                                    <option value="cuelga" style={{ background: '#1e1e1e' }}>Cuelga</option>
                                    <option value="no_contesta" style={{ background: '#1e1e1e' }}>No contesta</option>
                                    <option value="referencia" style={{ background: '#1e1e1e' }}>Referencia</option>
                                    <option value="equivocado" style={{ background: '#1e1e1e' }}>Equivocado</option>
                                    <option value="suspendido" style={{ background: '#1e1e1e' }}>Suspendido</option>
                                    <option value="negativa_pago" style={{ background: '#1e1e1e' }}>Negativa de pago</option>
                                    <option value="promesa_pago" style={{ background: '#1e1e1e' }}>Promesa de pago</option>
                                    <option value="tercero" style={{ background: '#1e1e1e' }}>Tercero</option>
                                    <option value="volver_llamar" style={{ background: '#1e1e1e' }}>Volver a llamar</option>
                                    <option value="buzon_voz" style={{ background: '#1e1e1e' }}>Buzón de voz</option>
                                  </select>
                                  {/* Botón PMP */}
                                  <button type="button"
                                    onClick={() => { setContactoActual(c); setTipifInicial('PMP'); setShowTipificacion(true); }}
                                    style={{
                                      width: '100%', padding: '5px 8px', fontSize: 11, borderRadius: 6, fontWeight: 700,
                                      background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)',
                                      color: '#00e676', cursor: 'pointer', letterSpacing: '0.04em',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                    }}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>payments</span>
                                    PROMESA DE PAGO
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>) : activePage === 'campanas_wsp' || activePage === 'campanas_rcs' || activePage === 'campanas_correo' ? (
              <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
                {(() => {
                  const isWsp = activePage === 'campanas_wsp';
                  const isRcs = activePage === 'campanas_rcs';
                  const isCorreo = activePage === 'campanas_correo';
                  const BLOQUE = isWsp ? 50 : 200;

                  // Conteo por días para los chips de filtro
                  const countDias = (d) => cartera.filter(c => {
                    let meta = {};
                    try { meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {}); } catch (_) {}
                    return String(meta['DIAS IMPAGO'] || meta['DIAS EN MORA'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || '0') === String(d);
                  }).length;

                  // Base filtrada
                  let base = [...cartera];
                  if (loteFiltroDias !== 'general') {
                    base = base.filter(c => {
                      let meta = {};
                      try { meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {}); } catch (_) {}
                      const dias = String(meta['DIAS IMPAGO'] || meta['DIAS EN MORA'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || '0');
                      return dias === String(loteFiltroDias);
                    });
                  }
                  if (loteOrdenMonto) {
                    base = base.sort((a, b) => {
                      let mA = {}, mB = {};
                      try { mA = typeof a.metadata === 'string' ? JSON.parse(a.metadata || '{}') : (a.metadata || {}); } catch (_) {}
                      try { mB = typeof b.metadata === 'string' ? JSON.parse(b.metadata || '{}') : (b.metadata || {}); } catch (_) {}
                      return parseFloat(mB['VALOR EN MORA'] || b.monto_deuda || 0) - parseFloat(mA['VALOR EN MORA'] || a.monto_deuda || 0);
                    });
                  }

                  // Armar lotes
                  const lotes = [];
                  for (let i = 0; i < base.length; i += BLOQUE) {
                    const clients = base.slice(i, i + BLOQUE);
                    const pendientes = clients.filter(c => {
                      const st = isWsp ? c.whatsapp_status : isRcs ? c.rcs_status : c.correo_status;
                      return st !== 'ENVIADO';
                    }).length;
                    const total = clients.length;
                    const pct = total > 0 ? Math.round(((total - pendientes) / total) * 100) : 100;
                    lotes.push({ num: Math.floor(i / BLOQUE) + 1, clients, pendientes, total, pct });
                  }

                  const filterChips = [
                    { key: 'general', label: `General (${cartera.length})` },
                    { key: '0',       label: `0 Dias (${countDias(0)})` },
                    { key: '1',       label: `1 Dia (${countDias(1)})` },
                    { key: '2',       label: `2 Días (${countDias(2)})` },
                  ];

                  return (
                    <>
                      {/* Header */}
                      <span className="text-label" style={{ opacity: 0.5, fontSize: 12, letterSpacing: '0.08em' }}>
                        CAMPAÑAS MASIVAS ({isWsp ? 'WHATSAPP' : isRcs ? 'RCS' : 'CORREOS'})
                      </span>
                      <h2 style={{ margin: '4px 0 6px', fontSize: 26, fontWeight: 800 }}>
                        Campañas de {isWsp ? 'WhatsApp' : isRcs ? 'RCS' : 'Correos'}
                      </h2>
                      <p style={{ opacity: 0.45, fontSize: 13, marginBottom: 24 }}>
                        Total disponibles en la base completa: {cartera.length}
                      </p>

                      {/* Filtros */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>DÍAS IMPAGO:</span>
                        <div className="cartera-filters">
                          {filterChips.map(f => (
                            <button type="button" key={f.key} className={'cartera-filter-btn ' + (loteFiltroDias === f.key ? 'active' : '')} onClick={() => setLoteFiltroDias(f.key)}>
                              {f.label}
                            </button>
                          ))}
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, marginLeft: 8 }}>
                          <input type="checkbox" checked={loteOrdenMonto} onChange={e => setLoteOrdenMonto(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--color-primary)' }} />
                          Ordenar por Monto (mayor primero)
                        </label>
                      </div>

                      {/* Lotes */}
                      {carteraLoading ? (
                        <div style={{ padding: 48, textAlign: 'center', opacity: 0.5 }}>Cargando datos...</div>
                      ) : lotes.length === 0 ? (
                        <div style={{ padding: 48, textAlign: 'center', opacity: 0.4, border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 8 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 40, display: 'block', marginBottom: 12 }}>campaign</span>
                          No hay clientes en esta campaña.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {lotes.map(lote => {
                            const completado = lote.pendientes === 0;
                            return (
                              <div key={lote.num} className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px' }}>
                                  {/* Número */}
                                  <div style={{ width: 38, height: 38, borderRadius: 8, background: completado ? 'rgba(0,229,255,0.15)' : 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: completado ? 'var(--color-primary)' : '#000', fontSize: 15, flexShrink: 0 }}>
                                    {lote.num}
                                  </div>

                                  {/* Info */}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                                      <span style={{ fontWeight: 700, fontSize: 14 }}>Lote {lote.num}</span>
                                      <span style={{
                                        fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                                        background: completado ? 'rgba(0,229,255,0.1)' : 'rgba(255,180,0,0.12)',
                                        color: completado ? 'var(--color-primary)' : '#ffb400',
                                        border: `1px solid ${completado ? 'rgba(0,229,255,0.25)' : 'rgba(255,180,0,0.25)'}`,
                                      }}>
                                        {completado ? 'COMPLETADO' : 'PENDIENTE'}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 12, opacity: 0.55, marginBottom: 5 }}>
                                      {lote.total} clientes ({lote.pendientes} pendientes)
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                      <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                                        <div style={{ height: '100%', background: 'var(--color-primary)', width: lote.pct + '%' }} />
                                      </div>
                                      <span style={{ fontSize: 12, opacity: 0.45, flexShrink: 0, minWidth: 32 }}>{lote.pct}%</span>
                                    </div>
                                  </div>

                                  {/* Botones */}
                                  <button type="button"
                                    className="btn btn-outline"
                                    style={{ fontSize: 12, padding: '7px 16px', opacity: completado ? 0.35 : 0.85, display: 'flex', alignItems: 'center', gap: 6 }}
                                    onClick={() => {
                                      const skCopy = isWsp ? 'whatsapp_status' : isRcs ? 'rcs_status' : 'correo_status';
                                      const pendientes = lote.clients.filter(c => c[skCopy] !== 'ENVIADO');
                                      copiarLoteTelefonos(lote.num, pendientes);
                                    }}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>content_copy</span>
                                    COPIAR
                                  </button>
                                  <button type="button"
                                    className={completado ? 'btn btn-ghost' : 'btn btn-primary'}
                                    style={{ fontSize: 12, padding: '7px 16px', opacity: completado ? 0.35 : 1, display: 'flex', alignItems: 'center', gap: 6 }}
                                    disabled={completado}
                                    onClick={async () => {
                                      const statusKey = isWsp ? 'whatsapp_status' : isRcs ? 'rcs_status' : 'correo_status';
                                      const canalApi = isWsp ? 'whatsapp' : isRcs ? 'rcs' : 'correo';
                                      const pendingClients = lote.clients.filter(c => c[statusKey] !== 'ENVIADO');
                                      const ids = pendingClients.map(c => c.id);
                                      if (!ids.length) return;

                                      // Actualizar círculos en cartera optimísticamente
                                      setCartera(prev => prev.map(x =>
                                        ids.includes(x.id) ? { ...x, [statusKey]: 'ENVIADO' } : x
                                      ));

                                      // Sumar S0/S1/S2 al top bar
                                      const detalleInc = { 0: 0, 1: 0, 2: 0 };
                                      pendingClients.forEach(c => {
                                        let meta = {};
                                        try { meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata || '{}') : (c.metadata || {}); } catch (_) {}
                                        const dias = parseInt(meta['DIAS IMPAGO'] || meta['DIAS EN MORA'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || '0', 10);
                                        if (dias >= 0 && dias <= 2) detalleInc[dias]++;
                                      });
                                      const addDetalle = (setter) => setter(p => ({
                                        0: (p[0] || 0) + detalleInc[0],
                                        1: (p[1] || 0) + detalleInc[1],
                                        2: (p[2] || 0) + detalleInc[2],
                                      }));
                                      if (isRcs)         addDetalle(setSmsDetalle);
                                      else if (isWsp)    addDetalle(setWspDetalle);
                                      else               addDetalle(setEmailDetalle);

                                      try {
                                        await callApi('db:marcarLoteEnviado', usuario.id, canalApi, ids);
                                        showToast(`✓ ${ids.length} contactos marcados como Enviado`, 'success');
                                        cargarCartera();
                                        fetchMetricasYEnviar();
                                      } catch (err) {
                                        // Revertir cartera y contadores
                                        setCartera(prev => prev.map(x =>
                                          ids.includes(x.id) ? { ...x, [statusKey]: 'ACTIVO' } : x
                                        ));
                                        const subDetalle = (setter) => setter(p => ({
                                          0: Math.max(0, (p[0] || 0) - detalleInc[0]),
                                          1: Math.max(0, (p[1] || 0) - detalleInc[1]),
                                          2: Math.max(0, (p[2] || 0) - detalleInc[2]),
                                        }));
                                        if (isRcs)         subDetalle(setSmsDetalle);
                                        else if (isWsp)    subDetalle(setWspDetalle);
                                        else               subDetalle(setEmailDetalle);
                                        showToast('Error: ' + err.message, 'error');
                                      }
                                    }}
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>done_all</span>
                                    MARCAR ENVIADO
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : activePage === 'compromisos' ? (
            <AsesorCompromisos
              usuario={usuario}
              callApi={callApi}
              showToast={showToast}
              onGestionar={(contactoId) => { cargarContactoAgendado(contactoId); setActivePage('dashboard'); }}
              onCompromisoAction={fetchMetricasYEnviar}
            />
          ) : activePage === 'dashboard' ? (
            <div className="asesor-layout-grid">
              <div className="asesor-main-column">
                {!contactoActual ? (
                  <DashboardProductividad
                    usuario={usuario}
                    callApi={callApi}
                    refreshTrigger={dashRefreshTrigger}
                  />
                ) : (
                <div className="widget-card customer-card">
                  <div className="widget-header">
                    <span className="text-label" style={{ opacity: 0.5 }}>EXPEDIENTE DEL CLIENTE</span>
                    
                    {/* Visualización de Progreso (Punto 3 de Correcciones) */}
                    {progresoCampana && progresoCampana.total > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', marginRight: 16 }}>
                        <div style={{ textAlign: 'right' }}>
                          <span className="text-label-xs" style={{ display: 'block', opacity: 0.4, fontSize: 12 }}>AVANCE CAMPAÑA</span>
                          <span className="text-mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-primary)' }}>
                            {progresoCampana.gestionados} / {progresoCampana.total}
                          </span>
                        </div>
                        <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ 
                            width: `${Math.min(100, (progresoCampana.gestionados / progresoCampana.total) * 100)}%`, 
                            height: '100%', 
                            background: 'var(--color-primary)',
                            boxShadow: '0 0 8px var(--color-primary)',
                            transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)'
                          }} />
                        </div>
                      </div>
                    )}

                    <button type="button" 
                      className="btn-crm"
                      onClick={() => {/* TODO: abrir CRM */}}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4 }}>open_in_new</span>
                      VER EN CRM
                    </button>
                  </div>
                  
                  {contactoActual && (() => {
                    const m = contactoActual.metadata || {};
                    const nombre = (m['NOMBRE CLIENTE'] || m['APELLIDO CLIENTE'])
                      ? `${m['NOMBRE CLIENTE'] || ''} ${m['APELLIDO CLIENTE'] || ''}`.trim()
                      : (contactoActual.nombre_deudor || 'Cliente No Identificado');
                    const contrato = m['Nº CONTRATO'] || m['CONTRATO'] || 'N/A';
                    const cedula = m['CEDULA'] || contactoActual.cedula || 'N/A';
                    const empresa = m['EMPRESA'] || '';
                    const esTec = empresa && empresa.toUpperCase().includes('TEC');
                    const valorMora = m['VALOR EN MORA'] || contactoActual.monto_deuda?.toLocaleString() || '0.00';
                    const porCobrar = m['MONTO POR COBRAR'] || m['SALDO POR COBRAR']
                      || m['SALDO PENDIENTE'] || '';
                    const montoTotalRaw = m['MONTO TOTAL'] || m['DEUDA TOTAL'] || m['VALOR TOTAL']
                      || m['SALDO TOTAL'] || (contactoActual.monto_deuda != null ? String(contactoActual.monto_deuda) : '');
                    const diasImpago = m['DIAS IMPAGO'] || m['DIAS EN MORA'] || m['DIAS EN INPAGO'] || m['DIAS MORA'] || '0';
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
                    const fmtMonto = (n) => n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    const moraNum = parseMonto(valorMora);
                    const diasNum = Math.max(0, parseInt(diasImpago, 10) || 0);
                    const valorIntereses = moraNum + diasNum;
                    const montoTotalDisplay = montoTotalRaw ? fmtMonto(parseMonto(montoTotalRaw)) : '';
                    const grupo = m['GRUPO'] || contactoActual.producto || 'General';
                    const telefono = m['TELEFONO 1'] || contactoActual.telefono;
                    const correo = m['CORREO CLIENTE'] || 'N/A';
                    const distribuidor = m['DISTRIBUIDOR'] || m['Distribuidor'] || m['DISTRIBUIDORA'] || '';
                    const fechaVentaRaw = m['FECHA DE VENTA'] || m['FECHA VENTA'] || m['Fecha de Venta'] || '';
                    const modelo = m['MODELO'] || m['Modelo'] || m['MODELO EQUIPO'] || '';
                    const numCuota = m['CUOTA'] || m['N° CUOTA'] || m['NRO CUOTA'] || m['NUMERO CUOTA']
                      || m['NÚMERO CUOTA'] || m['CUOTA VENCIDA'] || m['CUOTAS VENCIDAS']
                      || m['NRO DE CUOTA'] || m['# CUOTA'] || m['NUM CUOTA'] || '';
                    const fechaVenta = (() => {
                      if (!fechaVentaRaw) return 'N/A';
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
                    const tieneProducto = distribuidor || fechaVentaRaw || modelo;
                    const esRefinanciado = String(m['CONTRATO REFINANCIADO'] || '').toUpperCase().includes('REFIN');

                    return (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>

                      {/* ── 1. HEADER: nombre + identificadores ── */}
                      <div>
                        <h3 className="text-headline-sm" style={{ marginBottom: 6 }}>{nombre}</h3>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 99,
                            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 12, opacity: 0.6 }}>description</span>
                            <span style={{ opacity: 0.5 }}>CONTRATO</span>
                            <span className="text-mono" style={{ fontWeight: 800 }}>{contrato}</span>
                          </span>
                          <span style={{
                            fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 99,
                            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                          }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 12, opacity: 0.6 }}>badge</span>
                            <span style={{ opacity: 0.5 }}>CI</span>
                            <span className="text-mono" style={{ fontWeight: 800 }}>{cedula}</span>
                          </span>
                          {empresa && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '3px 9px', borderRadius: 99, fontSize: 12, fontWeight: 700,
                              letterSpacing: 0.4, textTransform: 'uppercase',
                              background: esTec ? 'rgba(255,152,0,0.15)' : 'rgba(33,150,243,0.15)',
                              color: esTec ? '#ffb74d' : '#64b5f6',
                              border: `1px solid ${esTec ? 'rgba(255,152,0,0.3)' : 'rgba(33,150,243,0.3)'}`,
                            }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>business</span>
                              {empresa}
                            </span>
                          )}
                          {esRefinanciado && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '3px 9px', borderRadius: 99, fontSize: 12, fontWeight: 700,
                              letterSpacing: 0.4, textTransform: 'uppercase',
                              background: 'rgba(255,193,7,0.15)',
                              color: '#ffc107',
                              border: '1px solid rgba(255,193,7,0.35)',
                            }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>autorenew</span>
                              Refinanciado
                            </span>
                          )}
                        </div>
                      </div>

                      {/* ── 2. BANNER FINANCIERO (5 cards · fila única) ── */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
                        {[
                          { label: 'VALOR EN MORA',     value: `$${valorMora}`,            sub: `${diasImpago} días de atraso`,                  color: '#ef5350', bg: 'rgba(239,68,68,0.09)',   border: 'rgba(239,68,68,0.26)'   },
                          { label: 'VALOR + INTERESES', value: `$${fmtMonto(valorIntereses)}`, sub: `Mora + $1 × ${diasNum} día${diasNum===1?'':'s'}`, color: '#4db6ac', bg: 'rgba(38,166,154,0.10)', border: 'rgba(38,166,154,0.26)'  },
                          { label: 'N° DE CUOTA',       value: numCuota || '—',            sub: 'Cuota vencida',                                  color: '#64b5f6', bg: 'rgba(33,150,243,0.09)',  border: 'rgba(33,150,243,0.26)'  },
                          { label: 'MONTO POR COBRAR',  value: porCobrar ? `$${porCobrar}` : '—', sub: 'Saldo · base liquidación',               color: '#ffb74d', bg: 'rgba(255,152,0,0.08)',   border: 'rgba(255,152,0,0.25)'   },
                          { label: 'MONTO TOTAL',       value: montoTotalDisplay ? `$${montoTotalDisplay}` : '—', sub: 'Totalidad de la deuda',  color: '#ba68c8', bg: 'rgba(156,39,176,0.09)',  border: 'rgba(156,39,176,0.25)'  },
                        ].map(({ label, value, sub, color, bg, border }) => (
                          <div key={label} style={{
                            padding: '8px 10px', borderRadius: 10,
                            background: `linear-gradient(135deg, ${bg}, transparent)`,
                            border: `1px solid ${border}`,
                          }}>
                            <div style={{ fontSize: 12.5, opacity: 0.75, fontWeight: 700, letterSpacing: 0.4, color, textTransform: 'uppercase', marginBottom: 2 }}>
                              {label}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {value}
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.45, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {sub}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* ── 3. DATOS DE CONTACTO ── */}
                      <div style={{
                        padding: 12, borderRadius: 10,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        <SectionHeader icon="contact_page" label="Datos del Cliente" />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, rowGap: 12 }}>
                          <Field icon="call" label="TELÉFONO" value={telefono || 'N/A'} mono />
                          <Field icon="mail" label="CORREO" value={correo} bold={500} />
                          <Field icon="category" label="GRUPO" value={grupo} />
                          <Field icon="hourglass_bottom" label="DÍAS EN IMPAGO" value={diasImpago} bold={800} color="#ff9800" />
                        </div>
                      </div>

                      {/* ── 4. DATOS DEL PRODUCTO ── */}
                      {tieneProducto && (
                        <div style={{
                          padding: 12, borderRadius: 10,
                          background: 'rgba(33,150,243,0.05)',
                          border: '1px solid rgba(33,150,243,0.18)',
                        }}>
                          <SectionHeader icon="inventory_2" label="Datos del Producto" />
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                            <Field icon="store" label="DISTRIBUIDOR" value={distribuidor || 'N/A'} />
                            <Field icon="event" label="FECHA DE VENTA" value={fechaVenta} mono bold={800} />
                            <Field icon="smartphone" label="MODELO" value={modelo || 'N/A'} />
                          </div>
                        </div>
                      )}

                      <div className="call-actions-bar">
                        <button type="button" 
                          className="call-btn call-btn--dial"
                          onClick={() => handleDial(contactoActual)}
                          disabled={!contactoActual.telefono || enLlamada}
                        >
                          <span className="material-symbols-outlined">call</span>
                          MARCAR
                        </button>
                        <button type="button" 
                          className="call-btn call-btn--hangup"
                          onClick={handleHangup}
                          disabled={!enLlamada}
                        >
                          <span className="material-symbols-outlined">call_end</span>
                          COLGAR
                        </button>
                        <button type="button" 
                          className={`call-btn ${silenciado ? 'call-btn--hold-active' : 'call-btn--hold'}`}
                          onClick={handleToggleMute}
                          disabled={!enLlamada}
                        >
                          <span className="material-symbols-outlined">{silenciado ? 'mic_off' : 'mic'}</span>
                          {silenciado ? 'CON VOZ' : 'SILENCIAR'}
                        </button>
                        <button type="button" 
                          className={`call-btn ${altavozActivo ? 'call-btn--speaker-active' : 'call-btn--speaker'}`}
                          onClick={handleToggleSpeaker}
                          disabled={!enLlamada}
                        >
                          <span className="material-symbols-outlined">{altavozActivo ? 'volume_up' : 'volume_off'}</span>
                          ALTAVOZ
                        </button>
                        <button type="button" 
                          className={`call-btn ${deviceGrabando ? 'call-btn--record-active' : 'call-btn--record'}`}
                          onClick={handleRecordOnDevice}
                          disabled={!enLlamada}
                          title={deviceGrabando ? "Detener grabación desde Android" : "Iniciar grabación desde Android"}
                        >
                          <span className="material-symbols-outlined" style={{ color: '#f44336' }}>
                            {deviceGrabando ? 'stop' : 'fiber_manual_record'}
                          </span>
                          {deviceGrabando ? 'DETENER' : 'GRABAR'}
                        </button>
                      </div>

                      {enLlamada && (
                        <div className="call-live-indicator">
                          <div className="call-live-dot" />
                          <span>Llamada en curso — {contactoActual.telefono}</span>
                          {silenciado && <span className="call-hold-badge" style={{ backgroundColor: '#ff9800' }}>SILENCIADA</span>}
                        </div>
                      )}
                    </div>
                    );
                  })()}
                </div>
                )}

                {/* ── Panel de Tipificación Inline (se despliega después de llamada) ── */}
                <TipificacionDialog
                  open={showTipificacion}
                  tipifInicial={tipifInicial}
                  mode="inline"
                  onSave={handleSaveTipificacion}
                  onCancel={() => {
                    setShowTipificacion(false);
                    setTipifInicial(null);
                  }}
                  contacto={contactoActual}
                  asesorNombre={usuario.nombre}
                  asesorId={usuario.id}
                  callApi={callApi}
                  onAltDialed={handleAltDialed}
                  onExternalDial={handleExternalDial}
                  onAccionRapida={(canal) => {
                    if (canal === 'WSP')   setWspEnviados(prev => prev + 1);
                    if (canal === 'SMS')   setSmsEnviados(prev => prev + 1);
                    if (canal === 'EMAIL') setCorreosEnviados(prev => prev + 1);
                    // Actualizar detalle por segmento (TRAMO_0→0, TRAMO_1→1, TRAMO_2→2)
                    const prod = (contactoActual?.producto || '').toUpperCase();
                    const seg = prod.includes('TRAMO_0') ? 0 : prod.includes('TRAMO_1') ? 1 : prod.includes('TRAMO_2') ? 2 : null;
                    if (seg !== null) {
                      if (canal === 'WSP')   setWspDetalle(prev => ({ ...prev, [seg]: (prev[seg] || 0) + 1 }));
                      if (canal === 'SMS')   setSmsDetalle(prev => ({ ...prev, [seg]: (prev[seg] || 0) + 1 }));
                      if (canal === 'EMAIL') setEmailDetalle(prev => ({ ...prev, [seg]: (prev[seg] || 0) + 1 }));
                    }
                  }}
                />

                {/* ── Mini-historial del cliente actual ── */}
                {contactoActual && (() => {
                  const { cdrs = [], refs = [] } = historialCliente;
                  const fmtDur = (seg) => {
                    if (!seg || seg <= 0) return null;
                    const m = Math.floor(seg / 60);
                    const s = seg % 60;
                    return `${m}:${s.toString().padStart(2, '0')}`;
                  };
                  const fmtHora = (ts) => {
                    if (!ts || typeof ts !== 'string') return '-';
                    try {
                      const d = new Date(ts.replace(' ', 'T'));
                      if (isNaN(d.getTime())) return '-';
                      return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });
                    } catch { return '-'; }
                  };
                  const fmtFecha = (ts) => {
                    if (!ts || typeof ts !== 'string') return '-';
                    try {
                      const d = new Date(ts.replace(' ', 'T'));
                      if (isNaN(d.getTime())) return '-';
                      return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: '2-digit' });
                    } catch { return '-'; }
                  };
                  const refsForCdr = (cdrId) => refs.filter(r => r.cdr_id != null && Number(r.cdr_id) === Number(cdrId));
                  const orphanRefs = refs.filter(r => r.cdr_id == null);

                  return (
                    <div className="widget-card">
                      <div className="widget-header">
                        <div>
                          <span className="text-label" style={{ opacity: 0.5 }}>HISTORIAL DEL CLIENTE</span>
                          <h3 className="widget-title" style={{ marginTop: 4, fontSize: 13 }}>Gestiones previas</h3>
                        </div>
                        <span className="text-label-sm" style={{ opacity: 0.5 }}>
                          {cdrs.length > 0 ? `${cdrs.length} gestión(es)` : 'Sin historial'}
                        </span>
                      </div>

                      {cdrs.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                          {cdrs.map((cdr) => {
                            const isOpen = expandedCdrId === cdr.id;
                            const cdrRefs = refsForCdr(cdr.id);
                            const dur = fmtDur(cdr.duracion_seg);
                            return (
                              <div key={`cdr-${cdr.id}`} style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.07)' }}>
                                {/* ── Header CDR (clic para expandir) ── */}
                                <div
                                  onClick={() => setExpandedCdrId(isOpen ? null : cdr.id)}
                                  style={{
                                    background: 'rgba(255,255,255,0.04)', padding: '8px 12px',
                                    cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4,
                                    borderLeft: '3px solid var(--color-primary)',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{
                                      fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                                      background: 'rgba(0,230,118,0.12)', color: 'var(--color-primary)',
                                    }}>
                                      {cdr.tipificacion_desc || 'Sin tipificación'}
                                    </span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      {dur && (
                                        <span style={{ fontSize: 12, opacity: 0.55, display: 'flex', alignItems: 'center', gap: 2 }}>
                                          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>timer</span>
                                          {dur}
                                        </span>
                                      )}
                                      <span className="text-mono" style={{ fontSize: 12, opacity: 0.4 }}>{fmtHora(cdr.timestamp)}</span>
                                      <span className="text-mono" style={{ fontSize: 12, opacity: 0.3 }}>{fmtFecha(cdr.timestamp)}</span>
                                      {cdrRefs.length > 0 && (
                                        <span style={{ fontSize: 12, background: 'rgba(255,152,0,0.2)', color: '#ffb74d', padding: '1px 5px', borderRadius: 99 }}>
                                          {cdrRefs.length} ref
                                        </span>
                                      )}
                                      <span className="material-symbols-outlined" style={{ fontSize: 13, opacity: 0.4, transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>
                                        chevron_right
                                      </span>
                                    </div>
                                  </div>
                                  {cdr.notas && (
                                    <p style={{
                                      fontSize: 12, opacity: 0.6, margin: 0, lineHeight: 1.4,
                                      overflow: 'hidden', display: '-webkit-box',
                                      WebkitLineClamp: isOpen ? 10 : 2, WebkitBoxOrient: 'vertical'
                                    }}>
                                      {cdr.notas}
                                    </p>
                                  )}
                                  <span style={{ fontSize: 12, opacity: 0.25 }}>{cdr.asesor_nombre || ''}</span>
                                </div>

                                {/* ── Sub-gestiones expandidas ── */}
                                {isOpen && cdrRefs.length > 0 && (
                                  <div style={{ background: 'rgba(255,152,0,0.04)', padding: '6px 12px 8px 20px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                                    {cdrRefs.map((ref) => (
                                      <div key={`ref-${ref.id}`} style={{
                                        display: 'flex', flexDirection: 'column', gap: 3,
                                        borderLeft: '2px solid rgba(255,152,0,0.4)', paddingLeft: 8
                                      }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                          <span style={{ fontSize: 12, fontWeight: 600, color: '#ffb74d' }}>
                                            📞 {ref.telefono_ref}
                                          </span>
                                          {ref.nombre_ref && (
                                            <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>{ref.nombre_ref}</span>
                                          )}
                                          {ref.parentesco && (
                                            <span style={{ fontSize: 12, padding: '1px 6px', borderRadius: 10, background: 'rgba(100,181,246,0.15)', color: '#64b5f6', fontWeight: 600 }}>
                                              {ref.parentesco}
                                            </span>
                                          )}
                                          <span className="text-mono" style={{ fontSize: 12, opacity: 0.45, marginLeft: 'auto' }}>
                                            {fmtHora(ref.timestamp)}
                                          </span>
                                        </div>
                                        {ref.notas && (
                                          <p style={{ fontSize: 12, opacity: 0.6, margin: 0, lineHeight: 1.3 }}>
                                            {ref.notas}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* ── REFs huérfanas (sin CDR vinculado) ── */}
                          {orphanRefs.length > 0 && (
                            <div style={{ borderRadius: 8, border: '1px solid rgba(255,152,0,0.15)', overflow: 'hidden' }}>
                              <div style={{ padding: '5px 12px', background: 'rgba(255,152,0,0.05)' }}>
                                <span style={{ fontSize: 12, opacity: 0.5, fontWeight: 700 }}>LLAMADAS A REFERENCIAS SIN GESTIÓN TIPIFICADA</span>
                              </div>
                              {orphanRefs.map((ref) => (
                                <div key={`orphan-${ref.id}`} style={{ padding: '6px 12px 6px 20px', borderLeft: '2px solid rgba(255,152,0,0.3)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: '#ffb74d' }}>📞 {ref.telefono_ref}</span>
                                    {ref.nombre_ref && (
                                      <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>{ref.nombre_ref}</span>
                                    )}
                                    {ref.parentesco && (
                                      <span style={{ fontSize: 12, padding: '1px 6px', borderRadius: 10, background: 'rgba(100,181,246,0.15)', color: '#64b5f6', fontWeight: 600 }}>
                                        {ref.parentesco}
                                      </span>
                                    )}
                                    <span className="text-mono" style={{ fontSize: 12, opacity: 0.4, marginLeft: 'auto' }}>{fmtHora(ref.timestamp)}</span>
                                  </div>
                                  {ref.notas && <p style={{ fontSize: 12, opacity: 0.55, margin: 0, lineHeight: 1.3 }}>{ref.notas}</p>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ padding: '16px 0', textAlign: 'center', opacity: 0.3 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 28 }}>manage_search</span>
                          <p className="text-body-sm" style={{ marginTop: 6 }}>Primer contacto con este cliente</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

              </div>

              <div className="asesor-side-column">
                {/* ── Columna lateral: Estado + Métricas ── */}
                {true && (<>
                  {/* ── Estado Asesor Premium ── */}
                  <div style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 16,
                    overflow: 'hidden',
                  }}>
                    {/* Header */}
                    <div style={{
                      padding: '12px 16px 10px',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--color-primary)', opacity: 0.8 }}>
                        person_pin_circle
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.5 }}>
                        Estado Asesor
                      </span>
                    </div>

                    {/* Estado Activo destacado */}
                    {estadoActual && (() => {
                      const colorMap = { 1: '#00e676', 2: '#ff9800', 3: '#64b5f6', 4: '#ce93d8', 5: '#ffb74d' };
                      const color = colorMap[estadoActual.id] || '#00e676';
                      return (
                        <div style={{
                          margin: '10px 12px',
                          background: `linear-gradient(135deg, ${color}18 0%, ${color}08 100%)`,
                          border: `1px solid ${color}30`,
                          borderRadius: 12,
                          padding: '10px 14px',
                          display: 'flex', alignItems: 'center', gap: 10,
                        }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: `${color}22`,
                            border: `1.5px solid ${color}50`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 18, color }}>{estadoActual.icon}</span>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1.2 }}>{estadoActual.nombre}</div>
                            <div style={{ fontSize: 12, opacity: 0.5, marginTop: 1 }}>estado actual</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color, letterSpacing: 1 }}>
                              {formatTimer(tiempoEstado)}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 2 }}>
                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, animation: 'pulse 1.5s infinite' }} />
                              <span style={{ fontSize: 12, color, opacity: 0.7, letterSpacing: 0.5 }}>ACTIVO</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Lista de otros estados */}
                    <div style={{ padding: '4px 8px 10px' }}>
                      {ESTADOS.map(estado => {
                        const isActive = estadoActual?.id === estado.id;
                        if (isActive) return null; // El activo ya se muestra arriba
                        const colorMap = { 1: '#00e676', 2: '#ff9800', 3: '#64b5f6', 4: '#ce93d8', 5: '#ffb74d' };
                        const color = colorMap[estado.id] || '#ffffff';
                        const acum = tiemposAcumulados[estado.id] || 0;
                        return (
                          <button type="button"
                            key={estado.id}
                            onClick={() => handleEstadoChange(estado)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              width: '100%', padding: '8px 8px',
                              background: 'transparent', border: 'none', cursor: 'pointer',
                              borderRadius: 9, transition: 'background 0.15s',
                              color: 'rgba(255,255,255,0.6)',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = `${color}10`}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{
                              width: 28, height: 28, borderRadius: 8,
                              background: `${color}12`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                              <span className="material-symbols-outlined" style={{ fontSize: 15, color: `${color}aa` }}>{estado.icon}</span>
                            </div>
                            <span style={{ flex: 1, fontSize: 12, textAlign: 'left', fontWeight: 500 }}>{estado.nombre}</span>
                            <span style={{ fontSize: 12, fontFamily: 'monospace', opacity: acum > 0 ? 0.6 : 0.25 }}>
                              {formatTimer(acum)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>


                </>)}

              </div>
            </div>
          ) : activePage === 'mensajes_sv' ? (
              <AsesorMensajes usuario={usuario} callApi={callApi} showToast={showToast} />
          ) : activePage === 'indicadores' ? (
              <IndicadoresPanel usuario={usuario} callApi={callApi} />
          ) : activePage === 'campanas_correo' ? (
              <div className="widget-card" style={{ maxWidth: 900, margin: '0 auto', padding: 40, textAlign: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: 0.3 }}>mail</span>
                <h3 style={{ marginTop: 12, opacity: 0.5 }}>Campañas de Correo</h3>
                <p style={{ opacity: 0.35, marginTop: 8, fontSize: 13 }}>Próximamente disponible.</p>
              </div>
          ) : (
            <div className="card" style={{ maxWidth: 600, margin: '0 auto' }}>
              <h3 className="text-headline-sm" style={{ marginBottom: 16 }}>Configuración de Red</h3>
              <p className="text-body-sm" style={{ opacity: 0.7, marginBottom: 24 }}>
                Configura la IP del servidor para conectarte en modo Multi-PC.
              </p>
              
              <div style={{ marginBottom: 24 }}>
                 <label className="text-label-sm" style={{ opacity: 0.6 }}>IP DEL JEFE DE ÁREA (WEBSOCKET)</label>
                 <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                    <input aria-label="Campo" 
                      type="text" 
                      className="input" 
                      value={wsIp}
                      onChange={e => setWsIp(e.target.value)}
                      placeholder="Ej: 192.168.1.100"
                    />
                    <button type="button" 
                      className="btn btn-primary"
                      onClick={() => {
                        localStorage.setItem('uphone_ws_ip', wsIp);
                        wsActiveIpRef.current = wsIp;
                        showToast('IP Guardada. Reconectando...', 'success');
                        if (wsRef.current) {
                          wsRef.current.onclose = null;
                          wsRef.current.close();
                        }
                        conectarWS();
                      }}
                    >
                      <span className="material-symbols-outlined">save</span>
                      Guardar y Conectar
                    </button>
                 </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal de Agendamiento "Loud" (vFinal) */}
      <Modal 
        open={showAgendamientoModal} 
        onClose={() => setShowAgendamientoModal(false)}
        title="🔔 RECORDATORIO DE AGENDAMIENTO"
      >
        <div className="agendamiento-alert-content">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 64, color: 'var(--color-warning)' }}>
              event_upcoming
            </span>
          </div>
          <h2 style={{ textAlign: 'center', color: '#fff', marginBottom: 8 }}>
            ¡Es hora de llamar!
          </h2>
          <div className="alert-data-box" style={{ background: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 12, marginBottom: 24 }}>
            <p style={{ margin: '4px 0', opacity: 0.7 }}>CLIENTE:</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-primary)' }}>
              {agendamientoData?.nombre_deudor || 'Cliente Desconocido'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <span>TELÉFONO: <strong>{agendamientoData?.telefono || 'N/A'}</strong></span>
              <span>ID: <strong>#{agendamientoData?.contacto_id}</strong></span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowAgendamientoModal(false)}>
              IGNORAR
            </button>
            <button type="button" className="btn btn-primary" style={{ flex: 2, padding: '16px' }} onClick={() => {
              setShowAgendamientoModal(false);
              cargarContactoAgendado(agendamientoData.contacto_id);
              setActivePage('dashboard');
            }}>
              <span className="material-symbols-outlined" style={{ marginRight: 8 }}>phone_callback</span>
              GESTIONAR AHORA
            </button>
          </div>
        </div>
      </Modal>

      <CampaignSelector
        open={showCampaignSelector}
        onSelect={handleSelectCampaign}
        usuarioId={usuario.id}
        callApi={callApi}
      />

      {/* TipificacionDialog modal para cartera y otras páginas (no dashboard) */}
      {activePage !== 'dashboard' && (
        <TipificacionDialog
          open={showTipificacion}
          mode="modal"
          tipifInicial={tipifInicial}
          onSave={handleSaveTipificacion}
          onCancel={() => { setShowTipificacion(false); setTipifInicial(null); }}
          contacto={contactoActual}
          asesorNombre={usuario.nombre}
          asesorId={usuario.id}
          callApi={callApi}
          onAltDialed={handleAltDialed}
          onExternalDial={handleExternalDial}
          onAccionRapida={(canal) => {
            let meta = {};
            try { meta = typeof contactoActual?.metadata === 'string' ? JSON.parse(contactoActual.metadata || '{}') : (contactoActual?.metadata || {}); } catch (_) {}
            const dias = parseInt(meta['DIAS IMPAGO'] || meta['DIAS EN MORA'] || meta['DIAS EN INPAGO'] || meta['DIAS MORA'] || '0', 10);
            const seg = dias >= 0 && dias <= 2 ? dias : null;
            if (seg !== null) {
              if (canal === 'SMS')   setSmsDetalle(p => ({ ...p, [seg]: (p[seg] || 0) + 1 }));
              if (canal === 'WSP')   setWspDetalle(p => ({ ...p, [seg]: (p[seg] || 0) + 1 }));
              if (canal === 'EMAIL') setEmailDetalle(p => ({ ...p, [seg]: (p[seg] || 0) + 1 }));
            }
          }}
        />
      )}
      {/* ── Modal WiFi IP ── */}
      <Modal open={showWifiModal} onClose={() => setShowWifiModal(false)} title="Conectar por WiFi">
        <div style={{ padding: '1rem' }}>
          <label className="text-label-sm" style={{ opacity: 0.6, display: 'block', marginBottom: 8 }}>Dirección IP del dispositivo celular</label>
          <input aria-label="Dirección IP del dispositivo celular"
            id="input-asesor-wifi-ip"
            className="input"
            type="text"
            placeholder="192.168.1.100"
            value={wifiIp}
            onChange={e => setWifiIp(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleConnectWifi()}
            style={{ width: '100%', marginBottom: 8 }}
          />
          <p className="text-body-sm" style={{ opacity: 0.4, marginBottom: 16 }}>El puerto 5555 se configurará automáticamente.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setShowWifiModal(false)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={handleConnectWifi}>Conectar</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
