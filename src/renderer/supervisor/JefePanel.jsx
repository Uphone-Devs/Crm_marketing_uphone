import React, { useState, useEffect, useRef, useCallback } from 'react';

class MetricasErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(e, info) { console.error('[METRICAS_CRASH]', e, info); }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 32, color: '#ff5252', background: 'rgba(255,82,82,0.08)', borderRadius: 8, margin: 16 }}>
        <strong>Error al renderizar métricas:</strong>
        <pre style={{ fontSize: 12, marginTop: 8, whiteSpace: 'pre-wrap', opacity: 0.8 }}>{this.state.error?.message}</pre>
        <button type="button" style={{ marginTop: 12, padding: '6px 12px' }} onClick={() => this.setState({ error: null })}>Reintentar</button>
      </div>
    );
    return this.props.children;
  }
}
import NavigationDrawer from '../shared/NavigationDrawer';
import TopAppBar from '../shared/TopAppBar';
import MetricsOverview from './MetricsOverview';
import AdvisorList from './AdvisorList';
import ActivityLog from './ActivityLog';
import ToastContainer, { showToast } from '../shared/Toast';
import Modal from '../shared/Modal';
import AudioMonitor from './AudioMonitor';
import HistoryPage from './HistoryPage';
import Campaigns from './Campaigns';
import ValidacionPagos from './ValidacionPagos';
import Compromisos from './Compromisos';
import CarterasEquipo from './CarterasEquipo';
import DetalleMetricaModal from './DetalleMetricaModal';
import ContactabilidadModal from './ContactabilidadModal';
import VolumenModal from './VolumenModal';
import AdvancedMetricsCharts from './AdvancedMetricsCharts';
import MessagesConfig from './MessagesConfig';
import SupervisorMensajes from './SupervisorMensajes';
import DashboardDirectivo from './DashboardDirectivo';
import SupervisorIndicadores from './SupervisorIndicadores';
import { nowLocalISO, todayLocalISO } from '../shared/timeUtils';
import { handleAuthStatus } from '../shared/apiClient';
import '../shared/theme.css';
import './JefePanel.css';

const WS_PORT = 3001;
const POLLING_MS = 30000; // Fallback: DB polling cada 30s (WS es primario)

function buildApiBase() {
  const ws = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  if (!ws || ws === '127.0.0.1' || ws === 'localhost') return null;
  return (ws.startsWith('http') ? ws.replace(/\/$/, '') : `http://${ws}:3001`) + '/api';
}

// C2: handler de sesión expirada registrado por el componente (logout global).
// Módulo-scope porque vmFetch vive fuera del componente; el panel es ventana única.
let vmUnauthorizedHandler = null;
function setVmUnauthorizedHandler(fn) { vmUnauthorizedHandler = fn; }

async function vmFetch(apiBase, token, path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  // C2: token expirado/ inválido → logout global en vez de sesión zombi.
  handleAuthStatus(res.status, vmUnauthorizedHandler);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function handleIncomingAudio(chunk) {
  const event = new CustomEvent('supervisor:audio_data', { detail: chunk });
  window.dispatchEvent(event);
}

// ──────────────────────────────────────────────────────────────
// SupervisorPanel — Dashboard principal del supervisor.
// Arquitectura: SPA con routing interno (login → dashboard/monitoring).
// ──────────────────────────────────────────────────────────────
export default function JefePanel({ usuario, onLogout }) {
  // ── State ──
  const [activePage, setActivePage] = useState('dashboard_directivo'); // 'dashboard_directivo' | 'monitoreo' | 'metricas' | 'reportes' | 'config'
  const [asesores, setAsesores] = useState([]);
  const [estadosWS, setEstadosWS] = useState({});
  const [tiemposEstado, setTiemposEstado] = useState({});
  const [metricas, setMetricas] = useState({});
  const [metricasEquipo, setMetricasEquipo] = useState(null);
  const [metricasValidacion, setMetricasValidacion] = useState(null);
  const [filtro, setFiltro] = useState('TODOS');
  const [busqueda, setBusqueda] = useState('');
  // Filtros de progreso del panel Monitoreo
  const [progresoFiltroFecha, setProgresoFiltroFecha] = useState(''); // '' = histórico, 'YYYY-MM-DD' = ese día
  const [progresoFiltroCampana, setProgresoFiltroCampana] = useState(''); // '' = todas
  const [progresosFiltrados, setProgresosFiltrados] = useState({}); // asesorId → {total, gestionados}
  const [campanasDisponibles, setCampanasDisponibles] = useState([]);
  // Filtros del panel Métricas
  const [metricasFiltroDesde,    setMetricasFiltroDesde]    = useState('');
  const [metricasFiltroHasta,    setMetricasFiltroHasta]    = useState('');
  const [metricasFiltroCampana,  setMetricasFiltroCampana]  = useState('');
  const [metricasEquipoFiltradas, setMetricasEquipoFiltradas] = useState(null); // null = usa metricasEquipo global
  // Refs para que el polling lea filtros vigentes sin redeclarar el interval
  const metricasFiltroDesdeRef   = useRef('');
  const metricasFiltroHastaRef   = useRef('');
  const metricasFiltroCampanaRef = useRef('');
  const activePageRef            = useRef(activePage);
  useEffect(() => { metricasFiltroDesdeRef.current   = metricasFiltroDesde;   }, [metricasFiltroDesde]);
  useEffect(() => { metricasFiltroHastaRef.current   = metricasFiltroHasta;   }, [metricasFiltroHasta]);
  useEffect(() => { metricasFiltroCampanaRef.current = metricasFiltroCampana; }, [metricasFiltroCampana]);
  useEffect(() => { activePageRef.current            = activePage;            }, [activePage]);
  // Modal de detalle al clickear cards de Promesas / Ya Recaudado
  const [detalleModal, setDetalleModal] = useState(null); // 'PROMESAS' | 'RECAUDADO' | null
  const [showContactModal, setShowContactModal] = useState(false);
  const [showVolumenModal, setShowVolumenModal] = useState(false);
  const [wsStatus, setWsStatus] = useState('DESCONECTADO');
  const [escuchando, setEscuchando] = useState(null);
  const [showReporteModal, setShowReporteModal] = useState(false);
  const [reporteFiltros, setReporteFiltros] = useState({
    asesor_id: '',
    fechaInicio: todayLocalISO(),
    fechaFin: todayLocalISO(),
    formato: 'xlsx',
  });
  const [reporteTipo, setReporteTipo] = useState('actividad'); // 'actividad' | 'gestiones'
  const [eventos, setEventos] = useState([]);
  const [dialingMode, setDialingMode] = useState('MANUAL');
  const [intentosConfig, setIntentosConfig] = useState(1);
  // configsMarcacion: { [asesorId]: { modo: 'MANUAL'|'AUTOMATICA', intentos: number } | null }
  const [configsMarcacion, setConfigsMarcacion] = useState({});
  const [audioChunks, setAudioChunks] = useState({}); // asesor_id -> array of chunks
  const [metricasWS, setMetricasWS] = useState({});   // asesor_id -> metricas recibidas via WS
  
  // States para config de sistema
  const [allUsuarios, setAllUsuarios] = useState([]);
  const [newAsesorName, setNewAsesorName] = useState('');
  const [newAsesorEmail, setNewAsesorEmail] = useState('');
  const [newAsesorPassword, setNewAsesorPassword] = useState('');
  const [newAsesorRol, setNewAsesorRol] = useState('asesor');
  
  // Jefe de Área / Jefa de Cobranza puede gestionar usuarios
  const esAdminPrincipal = usuario?.rol === 'supervisor' || usuario?.rol === 'jefe_area' || usuario?.rol === 'jefe';
  const [wsIp, setWsIp] = useState(localStorage.getItem('uphone_ws_ip') || '192.168.1.192');
  const apiBase   = buildApiBase();
  const isRemote  = !!apiBase;
  const authToken = localStorage.getItem('auth_token');

  // C2: al expirar el token (401), vmFetch dispara logout global vía este handler.
  useEffect(() => {
    setVmUnauthorizedHandler(() => {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user:v1');
      if (typeof onLogout === 'function') onLogout();
    });
    return () => setVmUnauthorizedHandler(null);
  }, [onLogout]);
  const wsActiveIpRef = useRef(wsIp); // IP usada para la conexión activa

  const wsRef = useRef(null);
  const wsPingRef = useRef(null); // keep-alive para Cloudflare tunnel

  // ── Data loading ──
  const cargarAsesores = useCallback(async () => {
    try {
      const data = isRemote
        ? await vmFetch(apiBase, authToken, '/asesores')
        : await window.api.invoke('db:getAsesores');
      setAsesores(data);
    } catch (err) {
      console.error('Error cargando asesores:', err);
    }
  }, [isRemote, apiBase, authToken]);

  const cargarMetricasAsesores = useCallback(async () => {
    try {
      const data = isRemote
        ? await vmFetch(apiBase, authToken, '/asesores')
        : await window.api.invoke('db:getAsesores');
      const metricasArray = await Promise.all(
        data.map(a => isRemote
          ? vmFetch(apiBase, authToken, `/metricas/${a.id}`)
          : window.api.invoke('db:getMetricasDia', a.id)
        )
      );
      const mets = {};
      data.forEach((a, i) => { mets[a.id] = metricasArray[i]; });
      setMetricas(mets);
    } catch (err) {
      console.error('Error cargando métricas:', err);
    }
  }, [isRemote, apiBase, authToken]);

  const cargarMetricasEquipo = useCallback(async () => {
    try {
      const data = isRemote
        ? await vmFetch(apiBase, authToken, '/metricas-equipo')
        : await window.api.invoke('db:getMetricasEquipo');
      setMetricasEquipo(data);
    } catch (err) {
      console.error('Error cargando métricas equipo:', err);
    }
  }, [isRemote, apiBase, authToken]);

  const cargarMetricasValidacion = useCallback(async (fecha = null, campanaId = null) => {
    try {
      let data;
      if (isRemote) {
        const params = new URLSearchParams();
        if (fecha) params.set('fecha', fecha);
        if (campanaId) params.set('campana_id', campanaId);
        data = await vmFetch(apiBase, authToken, `/validacion/metricas?${params}`);
      } else {
        const opts = campanaId ? { campanaId: Number(campanaId) } : {};
        data = await window.api.invoke('validacion:getMetricas', fecha || null, opts);
      }
      setMetricasValidacion(data);
    } catch (err) {
      console.error('Error cargando métricas validación:', err);
    }
  }, [isRemote, apiBase, authToken]);

  // Recargar métricas equipo filtradas: utilizado por el useEffect de cambio de filtro
  // y por el polling (para mantener live la vista filtrada durante la jornada).
  // Debe declararse ANTES del useEffect del polling — useCallback no se hoistea (TDZ).
  const cargarMetricasEquipoFiltradas = useCallback(async (desde, hasta, campanaId) => {
    const hayFiltro = desde || campanaId;
    if (!hayFiltro) { setMetricasEquipoFiltradas(null); return; }
    try {
      let r;
      if (isRemote) {
        const params = new URLSearchParams();
        if (desde) params.set('fecha', desde);
        if (hasta && hasta !== desde) params.set('fecha_fin', hasta);
        if (campanaId) params.set('campana_id', campanaId);
        r = await vmFetch(apiBase, authToken, `/metricas-equipo?${params}`);
      } else {
        const opts = {};
        if (campanaId) opts.campanaId = Number(campanaId);
        if (hasta && hasta !== desde) opts.fechaFin = hasta;
        r = await window.api.invoke('db:getMetricasEquipo', desde || null, opts);
      }
      setMetricasEquipoFiltradas(r);
    } catch (err) {
      console.error('[METRICAS_FILTRO]', err);
      setMetricasEquipoFiltradas(null);
    }
  }, [isRemote, apiBase, authToken]);

  // ── WebSocket ──
  const conectarWS = useCallback(() => {
    try {
      const targetIp = wsActiveIpRef.current;
      const wsToken = localStorage.getItem('auth_token') || '';
      const wsUrl = targetIp.startsWith('http')
        ? `${targetIp.replace(/^http/, 'ws').replace(/\/$/, '')}?token=${encodeURIComponent(wsToken)}`
        : `ws://${targetIp}:${WS_PORT}?token=${encodeURIComponent(wsToken)}`;
      console.log(`[WS] Conectando a ${wsUrl}...`);
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsStatus('CONECTADO');
        socket.send(JSON.stringify({
          tipo: 'IDENTIFICAR',
          rol: 'SUPERVISOR',
          nombre: usuario?.nombre || 'Jefe de Area',
          supervisor_id: usuario?.id,            // Bug 4: grupo del supervisor
          es_admin: usuario?.rol === 'admin',    // admin ve todos los grupos
        }));
        agregarEvento('CONEXION', 'Conectado al servidor de monitoreo');

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
        if (msg.tipo === 'ESTADO_ASESOR') {
          setEstadosWS(prev => ({ ...prev, [msg.asesor_id]: msg }));
          setTiemposEstado(prev => ({ ...prev, [msg.asesor_id]: 0 }));
          agregarEvento('ESTADO_CAMBIO', `${msg.nombre || 'Asesor'} cambió a estado ${msg.estado_id}`);
        }
        if (msg.tipo === 'SNAPSHOT_ESTADOS') {
          setEstadosWS(msg.estados || {});
          if (msg.metricas) setMetricasWS(msg.metricas);
          if (msg.dialing_mode) setDialingMode(msg.dialing_mode);
          if (msg.intentos) setIntentosConfig(msg.intentos);
        }
        if (msg.tipo === 'SET_DIALING_MODE') {
          setDialingMode(msg.modo);
          if (msg.intentos) setIntentosConfig(msg.intentos);
          showToast(`Modo: ${msg.modo} (${msg.intentos || 1} intentos)`, 'info');
        }
        if (msg.tipo === 'AUDIO_CHUNK') {
          // Si estamos escuchando a ESTE asesor, procesar el audio
          if (escuchando === msg.asesor_id) {
            handleIncomingAudio(msg.data);
          }
        }
        if (msg.tipo === 'TIPIFICACION_REALIZADA') {
          agregarEvento('LLAMADA_TIPIFICADA', `${msg.nombre} tipificó contacto como: ${msg.tipificacion}`);
          showToast(`Nueva tipificación de ${msg.nombre}`, 'info');
        }
        if (msg.tipo === 'METRICAS_ASESOR') {
          setMetricasWS(prev => ({
            ...prev,
            [msg.asesor_id]: {
              marcaciones: msg.marcaciones,
              tiempos_acumulados: msg.tiempos_acumulados,
              total_gestiones: msg.total_gestiones,
              total_compromisos: msg.total_compromisos,
              eficiencia: msg.eficiencia,
              tiempo_productivo: msg.tiempo_productivo,
              tiempo_improductivo: msg.tiempo_improductivo,
              estado_actual_id: msg.estado_actual_id,
              progreso_campana: msg.progreso_campana,
              timestamp: msg.timestamp,
            },
          }));
        }
        if (msg.tipo === 'ASESOR_DESCONECTADO') {
          setEstadosWS(prev => {
            const next = { ...prev };
            delete next[msg.asesor_id];
            return next;
          });
          setMetricasWS(prev => {
            const next = { ...prev };
            delete next[msg.asesor_id];
            return next;
          });
          agregarEvento('DESCONEXION', `${msg.nombre || 'Asesor'} se desconectó`);
        }
        if (msg.tipo === 'LOTE_ENVIADO') {
          // Un asesor marcó un lote de campaña como enviado → refrescar métricas diarias
          cargarMetricasAsesores();
        }
      };

      socket.onclose = (e) => {
        setWsStatus('DESCONECTADO');
        clearInterval(wsPingRef.current);
        console.warn(`[WS] Conexión cerrada: ${targetIp}. Reintentando en 5s...`, e.reason);
        // Solo reintentar si el socket cerrado es el actual
        if (wsRef.current === socket) {
          setTimeout(conectarWS, 5000);
        }
      };

      socket.onerror = (err) => {
        setWsStatus('ERROR');
        console.error(`[WS] Error en conexión a ${targetIp}:`, err);
      };
    } catch (err) {
      console.error('[WS] Error fatal al crear socket:', err);
      setTimeout(conectarWS, 5000);
    }
  }, [usuario]); // Eliminado wsIp de dependencias para evitar recreación al escribir

  // ── Event log helper ──
  function agregarEvento(tipo, mensaje) {
    setEventos(prev => [
      { id: Date.now(), tipo, mensaje, timestamp: new Date().toISOString() },
      ...prev.slice(0, 49), // Keep max 50 events
    ]);
  }

  // ── Effects ──
  useEffect(() => {
    cargarAsesores();
    cargarMetricasEquipo();
    cargarMetricasValidacion();
    conectarWS();

    // Cargar todos los usuarios
    (isRemote
      ? vmFetch(apiBase, authToken, '/admin/users')
      : window.api.invoke('db:getAllUsuarios')
    ).then(res => setAllUsuarios(Array.isArray(res) ? res : [])).catch(() => {});

    // Cargar configuraciones globales persistentes + configs individuales por asesor
    const cargarConfigGlobal = async () => {
      try {
        const all = isRemote
          ? await vmFetch(apiBase, authToken, '/config')
          : await window.api.invoke('db:getAllConfig');
        if (all?.modo_marcacion) setDialingMode(all.modo_marcacion);
        if (all?.intentos_marcacion) setIntentosConfig(parseInt(all.intentos_marcacion) || 1);
        // Parsear configs individuales: modo_marcacion_asesor_<id> / intentos_marcacion_asesor_<id>
        const configs = {};
        for (const [k, v] of Object.entries(all || {})) {
          if (v == null || String(v).trim() === '') continue; // vacío = restaurado a global
          let m = k.match(/^modo_marcacion_asesor_(\d+)$/);
          if (m) { configs[m[1]] = configs[m[1]] || {}; configs[m[1]].modo = v; continue; }
          m = k.match(/^intentos_marcacion_asesor_(\d+)$/);
          if (m) { configs[m[1]] = configs[m[1]] || {}; configs[m[1]].intentos = parseInt(v) || null; }
        }
        setConfigsMarcacion(configs);
      } catch (e) {
        console.warn('Error cargando config inicial:', e);
      }
    };
    cargarConfigGlobal();

    const pollInterval = setInterval(() => {
      // Solo refrescar métricas pesadas cuando el usuario está en tabs que las muestran.
      // Evita re-renders innecesarios en Reportes/Config/Red que recalientan el renderer.
      if (activePageRef.current === 'monitoreo' || activePageRef.current === 'metricas') {
        cargarMetricasAsesores();
        cargarMetricasEquipo();
        // Respetar filtros activos para no pisar la vista filtrada
        const fDesde = metricasFiltroDesdeRef.current   || null;
        const fHasta = metricasFiltroHastaRef.current   || null;
        const fCamp  = metricasFiltroCampanaRef.current || null;
        cargarMetricasValidacion(fDesde, fCamp);
        // Si hay filtro de Métricas activo, refrescar también el snapshot filtrado
        // para que las cards (Gestiones, MPH, Contactabilidad, Monto, ROI, etc.) sigan live.
        if (fDesde || fCamp) {
          cargarMetricasEquipoFiltradas(fDesde, fHasta, fCamp);
        }
      }
    }, POLLING_MS);

    return () => {
      clearInterval(pollInterval);
      wsRef.current?.close();
    };
  }, [cargarAsesores, cargarMetricasEquipo, cargarMetricasAsesores, cargarMetricasValidacion, cargarMetricasEquipoFiltradas, conectarWS]);

  // ── Alertas de Promesas de Pago (supervisor) ──
  useEffect(() => {
    if (!window.api?.on) return;
    const offPmp = window.api.on('promesa:aviso_supervisor', (data) => {
      const nombreAsesor = data.nombreAsesor || `Asesor #${data.asesor_id}`;
      const nombreCliente = data.nombre_deudor || `#${data.contacto_id}`;
      showToast(
        `La promesa de ${nombreAsesor} — ${nombreCliente} aún no paga. ¿Qué hacer?`,
        'error', 0
      );
    });
    return () => { if (typeof offPmp === 'function') offPmp(); };
  }, []);

  useEffect(() => {
    if (activePage === 'config') {
      (isRemote
        ? vmFetch(apiBase, authToken, '/admin/users')
        : window.api.invoke('db:getAllUsuarios')
      ).then(res => setAllUsuarios(Array.isArray(res) ? res : [])).catch(() => {});
    }
    if (activePage === 'metricas') {
      cargarMetricasValidacion(metricasFiltroDesde || null, metricasFiltroCampana || null);
    }
    if (activePage === 'monitoreo' || activePage === 'metricas') {
      (isRemote
        ? vmFetch(apiBase, authToken, '/campanas')
        : window.api.invoke('db:getCampanas')
      ).then(c => setCampanasDisponibles(Array.isArray(c) ? c : [])).catch(() => {});
    }
  }, [activePage, cargarMetricasValidacion, isRemote, apiBase, authToken]);

  useEffect(() => {
    if (activePage !== 'metricas') return;
    cargarMetricasEquipoFiltradas(metricasFiltroDesde || null, metricasFiltroHasta || null, metricasFiltroCampana || null);
  }, [activePage, metricasFiltroDesde, metricasFiltroHasta, metricasFiltroCampana, cargarMetricasEquipoFiltradas]);

  // Timer de "tiempo en estado" — solo activo en página Monitoreo.
  // Antes corría siempre cada 1s, causando re-render de SupervisorPanel cada
  // segundo y memory leak progresivo en las cards de recharts de Métricas
  // (pantalla en negro tras unos minutos).
  useEffect(() => {
    if (activePage !== 'monitoreo') return;
    const id = setInterval(() => {
      setTiemposEstado(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { next[k] = (next[k] || 0) + 1; });
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [activePage]);

  // Recargar métricas de validación (Recuperación de Cartera) cuando cambian filtros.
  // Sin filtro → totales históricos. Con filtro día/campaña → solo lo que aplica al scope.
  useEffect(() => {
    if (activePage !== 'metricas') return;
    cargarMetricasValidacion(metricasFiltroDesde || null, metricasFiltroCampana || null);
  }, [activePage, metricasFiltroDesde, metricasFiltroCampana, cargarMetricasValidacion]);

  // Recargar progresos filtrados cuando cambian los filtros o los asesores
  useEffect(() => {
    if (activePage !== 'monitoreo') return;
    const hayFiltro = progresoFiltroFecha || progresoFiltroCampana;
    if (!hayFiltro) { setProgresosFiltrados({}); return; }
    const opts = {};
    if (progresoFiltroFecha) opts.fecha = progresoFiltroFecha;
    if (progresoFiltroCampana) opts.campanaId = Number(progresoFiltroCampana);
    Promise.all(asesores.map(a => {
      let p;
      if (isRemote) {
        const params = new URLSearchParams();
        if (opts.fecha) params.set('fecha', opts.fecha);
        if (opts.campanaId) params.set('campanaId', String(opts.campanaId));
        p = vmFetch(apiBase, authToken, `/asesores/${a.id}/progreso?${params}`).catch(() => null);
      } else {
        p = window.api.invoke('db:getProgresoAsesor', a.id, opts).catch(() => null);
      }
      return p.then(r => [a.id, r]);
    })).then(arr => {
      const map = {};
      for (const [id, r] of arr) if (r) map[id] = r;
      setProgresosFiltrados(map);
    });
  }, [activePage, progresoFiltroFecha, progresoFiltroCampana, asesores]);
  // ══════════════════════════════════════════════════════════
  // FUSIÓN HÍBRIDA: WS (primario) + DB (fallback)
  // ══════════════════════════════════════════════════════════

  // Métricas por asesor: WS prevalece sobre DB
  const metricasFusionadas = React.useMemo(() => {
    const merged = {};
    asesores.forEach(a => {
      const dbM = metricas[a.id] || {};
      const wsM = metricasWS[a.id] || {};

      merged[a.id] = {
        total_marcaciones: wsM.marcaciones !== undefined ? wsM.marcaciones : dbM.total_marcaciones || 0,
        tiempo_al_aire: wsM.tiempo_productivo !== undefined ? wsM.tiempo_productivo : dbM.tiempo_al_aire || 0,
        tiempo_muerto: wsM.tiempo_improductivo !== undefined ? wsM.tiempo_improductivo : dbM.tiempo_muerto || 0,
        ratio_productividad: wsM.eficiencia !== undefined ? wsM.eficiencia : dbM.ratio_productividad || 0,
        total_gestiones: wsM.total_gestiones !== undefined ? wsM.total_gestiones : (dbM.cdrs_total || 0),
        total_compromisos: wsM.total_compromisos !== undefined ? wsM.total_compromisos : dbM.total_compromisos || 0,
        // Exponer también al nivel superior para AdvancedMetricsCharts
        total_asignados:     wsM.progreso_campana?.total      !== undefined ? wsM.progreso_campana.total      : (dbM.total_asignados  || 0),
        gestionados_base:    wsM.progreso_campana?.gestionados !== undefined ? wsM.progreso_campana.gestionados : (dbM.gestionados_base || 0),
        // Mensajería — WS tiene prioridad (tiempo real); DB como fallback
        wsp_enviados:        wsM.wsp_enviados     !== undefined ? wsM.wsp_enviados     : (dbM.wsp_enviados     || 0),
        sms_enviados:        wsM.sms_enviados     !== undefined ? wsM.sms_enviados     : (dbM.sms_enviados     || 0),
        correos_enviados:    wsM.correos_enviados !== undefined ? wsM.correos_enviados : (dbM.correos_enviados  || 0),
        wsp_detalle:         wsM.wsp_detalle   || dbM.wsp_detalle   || { 0: 0, 1: 0, 2: 0 },
        sms_detalle:         wsM.sms_detalle   || dbM.sms_detalle   || { 0: 0, 1: 0, 2: 0 },
        email_detalle:       wsM.email_detalle || dbM.email_detalle || { 0: 0, 1: 0, 2: 0 },
        // Compromisos breakdown — WS tiene prioridad
        compromisos_cumplidos:   wsM.compromisos_cumplidos   !== undefined ? wsM.compromisos_cumplidos   : (dbM.compromisos_cumplidos   || 0),
        compromisos_reagendados: wsM.compromisos_reagendados !== undefined ? wsM.compromisos_reagendados : (dbM.compromisos_reagendados || 0),
        compromisos_incumplidos: wsM.compromisos_incumplidos !== undefined ? wsM.compromisos_incumplidos : (dbM.compromisos_incumplidos || 0),
        // ratio_eficacia: gestiones / marcaciones
        ratio_eficacia: (() => {
          const marc = wsM.marcaciones !== undefined ? wsM.marcaciones : (dbM.total_marcaciones || 0);
          const gest = wsM.total_gestiones !== undefined ? wsM.total_gestiones : (dbM.cdrs_total || 0);
          return marc > 0 ? Math.round((gest / marc) * 100) : 0;
        })(),
        // Métricas de cobranza — solo DB
        monto_comprometido:  dbM.monto_comprometido  || 0,
        mora_total_base:     dbM.mora_total_base      || 0,
        contactos_efectivos: dbM.contactos_efectivos  || 0,
        promesas_pago:       dbM.promesas_pago        || 0,
        monto_prometido:     dbM.monto_prometido      || 0,
        pagos_recaudados:    dbM.pagos_recaudados     || 0,
        monto_recaudado:     dbM.monto_recaudado      || 0,
        cdrs_total:          dbM.cdrs_total           || 0,
        cdrs_neutros:        dbM.cdrs_neutros         || 0,
        cdrs_no_contactados: dbM.cdrs_no_contactados  || 0,
        cdrs_sin_tipificar:  dbM.cdrs_sin_tipificar   || 0,
        // Compatibilidad con AdvisorList
        progreso_campana: wsM.progreso_campana || {
          total: dbM.total_asignados || 0,
          gestionados: dbM.gestionados_base || 0
        }
      };
    });
    return merged;
  }, [metricas, metricasWS, asesores]);

  // Métricas de equipo: fusionar totales
  const metricasEquipoFusionadas = React.useMemo(() => {
    const base = metricasEquipo || {};
    const totalConectados = Object.keys(estadosWS).length || base.totalConectados || 0;

    // Sumar métricas de todos los asesores fusionados
    let marcacionesTotales  = 0;
    let tiempoAlAireSeg     = 0;
    let sumaProductividad   = 0;
    let countProductividad  = 0;
    let montoComprometido   = 0;
    let moraTotal           = 0;
    let contactosEfectivos  = 0;
    let totalCompromisos    = 0;
    let promesasPago        = 0;
    let montoPrometido      = 0;
    let pagosRecaudados     = 0;
    let montoRecaudado      = 0;
    let wspEnviadosTotal     = 0;
    let smsEnviadosTotal     = 0;
    let correosEnviadosTotal = 0;
    let cdrsTotalEquipo        = 0;
    let cdrsNeutrosTotal       = 0;
    let cdrsNoContactadosTotal = 0;
    let cdrsSinTipificarTotal  = 0;
    let compCumplidosTotal     = 0;
    let compReagendadosTotal   = 0;
    let compIncumplidosTotal   = 0;

    asesores.forEach(a => {
      const m = metricasFusionadas[a.id];
      if (m) {
        marcacionesTotales += m.total_marcaciones   || 0;
        tiempoAlAireSeg    += m.tiempo_al_aire      || 0;
        sumaProductividad  += m.ratio_productividad || 0;
        montoComprometido  += m.monto_comprometido  || 0;
        moraTotal          += m.mora_total_base      || 0;
        contactosEfectivos += m.contactos_efectivos  || 0;
        totalCompromisos   += m.total_compromisos    || 0;
        promesasPago       += m.promesas_pago        || 0;
        montoPrometido     += m.monto_prometido      || 0;
        pagosRecaudados    += m.pagos_recaudados     || 0;
        montoRecaudado     += m.monto_recaudado      || 0;
        wspEnviadosTotal     += m.wsp_enviados     || 0;
        smsEnviadosTotal     += m.sms_enviados     || 0;
        correosEnviadosTotal += m.correos_enviados || 0;
        cdrsTotalEquipo        += m.cdrs_total          || 0;
        cdrsNeutrosTotal       += m.cdrs_neutros        || 0;
        cdrsNoContactadosTotal += m.cdrs_no_contactados || 0;
        cdrsSinTipificarTotal  += m.cdrs_sin_tipificar  || 0;
        compCumplidosTotal     += m.compromisos_cumplidos   || 0;
        compReagendadosTotal   += m.compromisos_reagendados || 0;
        compIncumplidosTotal   += m.compromisos_incumplidos || 0;
        countProductividad++;
      }
    });

    const promedioProductividad = countProductividad > 0
      ? Math.round(sumaProductividad / countProductividad)
      : base.promedioProductividad || 0;

    const tasaRecuperacion = moraTotal > 0
      ? Math.round((montoComprometido / moraTotal) * 10000) / 100
      : 0;

    return {
      totalConectados,
      marcacionesTotales:    marcacionesTotales || base.marcacionesTotales || 0,
      promedioProductividad,
      tiempoAlAireSeg:       tiempoAlAireSeg || base.tiempoAlAireSeg || 0,
      montoComprometidoTotal: montoComprometido,
      moraTotal,
      contactosEfectivosTotal: contactosEfectivos,
      totalCompromisosEquipo:  totalCompromisos,
      tasaRecuperacion,
      promesasPagoTotal:    promesasPago,
      montoPrometidoTotal:  montoPrometido,
      pagosRecaudadosTotal: pagosRecaudados,
      montoRecaudadoTotal:  montoRecaudado,
      wspEnviadosTotal,
      smsEnviadosTotal,
      correosEnviadosTotal,
      cdrsTotalEquipo,
      cdrsNeutrosTotal,
      cdrsNoContactadosTotal,
      cdrsSinTipificarTotal,
      compCumplidosTotal,
      compReagendadosTotal,
      compIncumplidosTotal,
      detalleAsesores: asesores.map(a => ({
        asesor: a,
        metricas: metricasFusionadas[a.id] || {
          total_marcaciones: 0, tiempo_al_aire: 0, tiempo_muerto: 0,
          ratio_productividad: 0, total_asignados: 0, gestionados_base: 0,
          monto_comprometido: 0, mora_total_base: 0, contactos_efectivos: 0,
          total_compromisos: 0,
          wsp_enviados: 0, sms_enviados: 0, correos_enviados: 0,
          wsp_detalle: { 0: 0, 1: 0, 2: 0 }, sms_detalle: { 0: 0, 1: 0, 2: 0 }, email_detalle: { 0: 0, 1: 0, 2: 0 },
          compromisos_cumplidos: 0, compromisos_reagendados: 0, compromisos_incumplidos: 0,
          ratio_eficacia: 0,
        },
      })),
    };
  }, [metricasEquipo, metricasFusionadas, estadosWS, asesores]);

  // Versión estable de las métricas del equipo para AdvancedMetricsCharts (página Métricas).
  // NO depende de metricasWS ni estadosWS — solo se recalcula cuando llega data DB
  // (polling 30s o cambio de asesores). Evita re-renders del árbol de Recharts con
  // cada mensaje WS, que causaba memory leak progresivo + pantalla negra.
  // AdvisorList (Monitoreo) sigue usando metricasFusionadas (live WS).
  const metricasEquipoEstable = React.useMemo(() => {
    const base = metricasEquipo || {};
    let marcacionesTotales = 0;
    let tiempoAlAireSeg = 0;
    let montoComprometido = 0;
    let moraTotal = 0;
    let contactosEfectivos = 0;
    let totalCompromisos = 0;
    let promesasPago = 0;
    let montoPrometido = 0;
    let pagosRecaudados = 0;
    let montoRecaudado = 0;
    let wspEnviadosTotal = 0;
    let smsEnviadosTotal = 0;
    let correosEnviadosTotal = 0;
    let cdrsTotalEquipo = 0;
    let cdrsNeutrosTotal = 0;
    let cdrsNoContactadosTotal = 0;
    let cdrsSinTipificarTotal = 0;
    let totalConectados = 0;
    asesores.forEach(a => {
      const m = metricas[a.id] || {};
      if ((m.total_marcaciones || 0) > 0 || (m.tiempo_al_aire || 0) > 0) totalConectados++;
      marcacionesTotales += m.total_marcaciones || 0;
      tiempoAlAireSeg    += m.tiempo_al_aire    || 0;
      montoComprometido  += m.monto_comprometido || 0;
      moraTotal          += m.mora_total_base   || 0;
      contactosEfectivos += m.contactos_efectivos || 0;
      totalCompromisos   += m.total_compromisos || 0;
      promesasPago       += m.promesas_pago     || 0;
      montoPrometido     += m.monto_prometido   || 0;
      pagosRecaudados    += m.pagos_recaudados  || 0;
      montoRecaudado     += m.monto_recaudado   || 0;
      wspEnviadosTotal     += m.wsp_enviados     || 0;
      smsEnviadosTotal     += m.sms_enviados     || 0;
      correosEnviadosTotal += m.correos_enviados || 0;
      cdrsTotalEquipo        += m.cdrs_total          || 0;
      cdrsNeutrosTotal       += m.cdrs_neutros        || 0;
      cdrsNoContactadosTotal += m.cdrs_no_contactados || 0;
      cdrsSinTipificarTotal  += m.cdrs_sin_tipificar  || 0;
    });
    const tasaRecuperacion = moraTotal > 0 ? Math.round((montoComprometido / moraTotal) * 10000) / 100 : 0;
    return {
      totalConectados,
      marcacionesTotales: marcacionesTotales || base.marcacionesTotales || 0,
      tiempoAlAireSeg:    tiempoAlAireSeg    || base.tiempoAlAireSeg    || 0,
      montoComprometidoTotal: montoComprometido,
      moraTotal,
      contactosEfectivosTotal: contactosEfectivos,
      totalCompromisosEquipo:  totalCompromisos,
      tasaRecuperacion,
      promesasPagoTotal:    promesasPago,
      montoPrometidoTotal:  montoPrometido,
      pagosRecaudadosTotal: pagosRecaudados,
      montoRecaudadoTotal:  montoRecaudado,
      wspEnviadosTotal,
      smsEnviadosTotal,
      correosEnviadosTotal,
      cdrsTotalEquipo,
      cdrsNeutrosTotal,
      cdrsNoContactadosTotal,
      cdrsSinTipificarTotal,
      detalleAsesores: asesores.map(a => ({
        asesor: a,
        metricas: metricas[a.id] || {
          total_marcaciones: 0, tiempo_al_aire: 0, tiempo_muerto: 0,
          ratio_productividad: 0, total_asignados: 0, gestionados_base: 0,
          monto_comprometido: 0, mora_total_base: 0, contactos_efectivos: 0,
          total_compromisos: 0, cdrs_total: 0, cdrs_neutros: 0,
          cdrs_no_contactados: 0, cdrs_sin_tipificar: 0,
          wsp_enviados: 0, sms_enviados: 0, correos_enviados: 0,
          wsp_detalle: { 0: 0, 1: 0, 2: 0 }, sms_detalle: { 0: 0, 1: 0, 2: 0 }, email_detalle: { 0: 0, 1: 0, 2: 0 },
          compromisos_cumplidos: 0, compromisos_reagendados: 0, compromisos_incumplidos: 0,
          monto_recaudado: 0, monto_prometido: 0,
        },
      })),
    };
  }, [metricasEquipo, metricas, asesores]);

  // ── Handlers ──
  function handleEscuchar(asesorId) {
    setEscuchando(prev => prev === asesorId ? null : asesorId);
    if (escuchando !== asesorId) {
      showToast(`Escuchando a asesor ${asesorId}`, 'info');
    }
  }

  // Cambia config de marcación individual de un asesor
  // newCfg = { modo, intentos }  o  null para restaurar a global (hereda)
  function handleForceOffline(asesorId) {
    const ws = wsRef.current;
    if (ws?.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({ tipo: 'FORCE_OFFLINE', asesor_id: asesorId }));
    }
  }

  async function handleAsesorMarcacionChange(asesorId, newCfg) {
    try {
      if (newCfg == null) {
        if (isRemote) {
          await vmFetch(apiBase, authToken, '/config', { method: 'POST', body: JSON.stringify({ clave: `modo_marcacion_asesor_${asesorId}`, valor: '' }) });
          await vmFetch(apiBase, authToken, '/config', { method: 'POST', body: JSON.stringify({ clave: `intentos_marcacion_asesor_${asesorId}`, valor: '' }) });
        } else {
          await window.api.invoke('db:setConfig', `modo_marcacion_asesor_${asesorId}`, '');
          await window.api.invoke('db:setConfig', `intentos_marcacion_asesor_${asesorId}`, '');
        }
        setConfigsMarcacion(prev => { const n = { ...prev }; delete n[asesorId]; return n; });
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            tipo: 'SET_DIALING_MODE',
            modo: dialingMode,
            intentos: intentosConfig,
            asesor_id: asesorId,
          }));
        }
        showToast(`Restaurado a configuración global`, 'info');
        return;
      }
      const { modo, intentos } = newCfg;
      if (isRemote) {
        await vmFetch(apiBase, authToken, '/config', { method: 'POST', body: JSON.stringify({ clave: `modo_marcacion_asesor_${asesorId}`, valor: modo }) });
        await vmFetch(apiBase, authToken, '/config', { method: 'POST', body: JSON.stringify({ clave: `intentos_marcacion_asesor_${asesorId}`, valor: String(intentos) }) });
      } else {
        await window.api.invoke('db:setConfig', `modo_marcacion_asesor_${asesorId}`, modo);
        await window.api.invoke('db:setConfig', `intentos_marcacion_asesor_${asesorId}`, String(intentos));
      }
      setConfigsMarcacion(prev => ({ ...prev, [asesorId]: { modo, intentos } }));
      // Envío TARGETED al asesor específico via WS
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          tipo: 'SET_DIALING_MODE',
          modo, intentos,
          asesor_id: asesorId,
        }));
      }
      const nombre = asesores.find(a => a.id === asesorId)?.nombre || 'asesor';
      showToast(`${nombre}: ${modo} · ${intentos} intento(s)`, 'success');
    } catch (err) {
      console.error('[MARCACION_ASESOR]', err);
      showToast('Error al guardar config del asesor', 'error');
    }
  }


  function handleToggleDialingMode() {
    // Ciclo: MANUAL → AUTOMATICA → PERSONALIZADO → MANUAL
    const ciclo = { MANUAL: 'AUTOMATICA', AUTOMATICA: 'PERSONALIZADO', PERSONALIZADO: 'MANUAL' };
    const nuevoModo = ciclo[dialingMode] || 'MANUAL';
    setDialingMode(nuevoModo);

    if (isRemote) {
      vmFetch(apiBase, authToken, '/config', { method: 'POST', body: JSON.stringify({ clave: 'modo_marcacion', valor: nuevoModo }) }).catch(() => {});
    } else {
      window.api.invoke('db:setConfig', 'modo_marcacion', nuevoModo);
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        tipo: 'SET_DIALING_MODE',
        modo: nuevoModo,
        intentos: intentosConfig
      }));
    }
  }

  function handleUpdateIntentos(val) {
    const n = parseInt(val) || 1;
    setIntentosConfig(n);

    if (isRemote) {
      vmFetch(apiBase, authToken, '/config', { method: 'POST', body: JSON.stringify({ clave: 'intentos_marcacion', valor: n.toString() }) }).catch(() => {});
    } else {
      window.api.invoke('db:setConfig', 'intentos_marcacion', n.toString());
    }

    if (dialingMode === 'AUTOMATICA' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        tipo: 'SET_DIALING_MODE',
        modo: dialingMode,
        intentos: n
      }));
    }
  }


  async function generarReporte() {
    try {
      const tipo = reporteTipo === 'gestiones'
        ? (reporteFiltros.asesor_id ? 'gestiones' : 'gestiones_equipo')
        : (reporteFiltros.asesor_id ? 'diario' : 'equipo');
      let result;
      if (isRemote) {
        const params = new URLSearchParams({
          ...reporteFiltros,
          fecha:    reporteFiltros.fechaInicio,
          fecha_hasta: reporteFiltros.fechaFin || reporteFiltros.fechaInicio,
        });
        result = await vmFetch(apiBase, authToken, `/reports/${tipo}?${params}`);
        if (result.success) showToast('Reporte generado en el servidor VM', 'success');
        else showToast(result.error || 'Error al generar reporte', 'error');
      } else {
        result = await window.api.invoke('reports:generate', tipo, {
          ...reporteFiltros,
          fecha:    reporteFiltros.fechaInicio,
          fechaFin: reporteFiltros.fechaFin || reporteFiltros.fechaInicio,
        });
        if (result.success) {
          showToast(`Reporte generado: ${result.archivo.split('\\').pop()}`, 'success');
          window.api.invoke('shell:openPath', result.archivo);
        } else {
          showToast(result.error, 'error');
        }
      }
    } catch (err) {
      showToast('Error al generar reporte', 'error');
    }
  }

  // ── Render Tabs ──
  function renderTabMonitoreo() {
    const hayFiltroProgreso = !!(progresoFiltroFecha || progresoFiltroCampana);
    return (
      <div className="sup-dashboard-monitoreo">
        {/* Barra de filtros del progreso */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13, verticalAlign: 'middle', marginRight: 4 }}>filter_alt</span>
            Filtrar Progreso
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>Día</span>
            <input aria-label="Día"
              type="date"
              value={progresoFiltroFecha}
              onChange={(e) => setProgresoFiltroFecha(e.target.value)}
              style={{
                padding: '5px 8px', fontSize: 12, colorScheme: 'dark',
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit',
              }}
            />
            <button type="button"
              onClick={() => setProgresoFiltroFecha(todayLocalISO())}
              title="Filtrar solo hoy"
              style={{
                padding: '4px 8px', fontSize: 12, fontWeight: 700,
                background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)',
                color: 'var(--color-primary)', borderRadius: 6, cursor: 'pointer',
              }}
            >HOY</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>Campaña</span>
            <select
              value={progresoFiltroCampana}
              onChange={(e) => setProgresoFiltroCampana(e.target.value)}
              style={{
                padding: '5px 8px', fontSize: 12,
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit', minWidth: 140,
              }}
            >
              <option value="">Todas</option>
              {campanasDisponibles.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
          {hayFiltroProgreso && (
            <button type="button"
              onClick={() => { setProgresoFiltroFecha(''); setProgresoFiltroCampana(''); }}
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
          {hayFiltroProgreso && (
            <span style={{ fontSize: 12, opacity: 0.55, fontStyle: 'italic', marginLeft: 'auto' }}>
              Progreso base filtrado · {progresoFiltroFecha && `día ${progresoFiltroFecha}`}{progresoFiltroFecha && progresoFiltroCampana && ' · '}{progresoFiltroCampana && `campaña #${progresoFiltroCampana}`}
            </span>
          )}
        </div>
        <AdvisorList
          asesores={asesores}
          estadosWS={estadosWS}
          metricas={metricasFusionadas}
          tiemposEstado={tiemposEstado}
          configsMarcacion={configsMarcacion}
          onChangeMarcacion={handleAsesorMarcacionChange}
          onForceOffline={handleForceOffline}
          modoGlobal={dialingMode}
          intentosGlobal={intentosConfig}
          filtro={filtro}
          onFiltroChange={setFiltro}
          busqueda={busqueda}
          onBusquedaChange={setBusqueda}
          progresosFiltrados={progresosFiltrados}
          hayFiltroProgreso={hayFiltroProgreso}
        />
        <ActivityLog eventos={eventos} />
      </div>
    );
  }

  function renderTabCampanas() {
    return <Campaigns asesores={asesores} usuario={usuario} estadosWS={estadosWS} />;
  }

  function renderTabMetricas() {
    const hayFiltroMet = !!(metricasFiltroDesde || metricasFiltroCampana);
    // Con filtro → snapshot filtrado (polling 30s, DB pura).
    // Sin filtro → versión estable derivada solo de DB (no WS) para evitar
    // re-renders por mensajes WS que causaban memory leak en recharts y pantalla negra.
    // AdvisorList sigue usando metricasFusionadas (live WS) — solo Métricas cambia.
    const metricasParaMostrar = hayFiltroMet && metricasEquipoFiltradas
      ? metricasEquipoFiltradas
      : metricasEquipoEstable;
    return (
      <div className="sup-metricas-tab">
        {/* Barra de filtros */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 12, borderRadius: 8,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13, verticalAlign: 'middle', marginRight: 4 }}>filter_alt</span>
            Filtrar Métricas
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>Desde</span>
            <input aria-label="Desde"
              type="date"
              value={metricasFiltroDesde}
              onChange={(e) => {
                const val = e.target.value;
                setMetricasFiltroDesde(val);
                if (!metricasFiltroHasta || metricasFiltroHasta < val) {
                  setMetricasFiltroHasta(val);
                }
              }}
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
              value={metricasFiltroHasta}
              min={metricasFiltroDesde || undefined}
              onChange={(e) => setMetricasFiltroHasta(e.target.value)}
              style={{
                padding: '5px 8px', fontSize: 12, colorScheme: 'dark',
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit',
              }}
            />
          </div>
          <button type="button"
            onClick={() => { setMetricasFiltroDesde(todayLocalISO()); setMetricasFiltroHasta(todayLocalISO()); }}
            style={{
              padding: '4px 8px', fontSize: 12, fontWeight: 700,
              background: 'rgba(0,230,118,0.1)', border: '1px solid rgba(0,230,118,0.3)',
              color: 'var(--color-primary)', borderRadius: 6, cursor: 'pointer',
            }}
          >HOY</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>Campaña</span>
            <select
              value={metricasFiltroCampana}
              onChange={(e) => setMetricasFiltroCampana(e.target.value)}
              style={{
                padding: '5px 8px', fontSize: 12,
                background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6, color: 'inherit', minWidth: 140,
              }}
            >
              <option value="">Todas</option>
              {campanasDisponibles.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>
          {hayFiltroMet && (
            <button type="button"
              onClick={() => { setMetricasFiltroDesde(''); setMetricasFiltroHasta(''); setMetricasFiltroCampana(''); }}
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
          {hayFiltroMet && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, opacity: 0.55, fontStyle: 'italic' }}>
                {metricasFiltroDesde && metricasFiltroHasta && metricasFiltroDesde !== metricasFiltroHasta
                  ? `Filtrando: ${metricasFiltroDesde} → ${metricasFiltroHasta}`
                  : metricasFiltroDesde
                    ? `Filtrando: ${metricasFiltroDesde}`
                    : ''
                }
                {metricasFiltroCampana && ` · campaña #${metricasFiltroCampana}`}
              </span>
            </div>
          )}
        </div>

        <MetricasErrorBoundary>
        <MetricsOverview
          metricas={metricasParaMostrar}
          validacion={metricasValidacion}
          onCardClick={(key) => setDetalleModal(key)}
          onNavigate={setActivePage}
        />

        <AdvancedMetricsCharts
          metricas={metricas}
          metricasEquipo={metricasParaMostrar}
          asesores={asesores}
          filtroFechaDesde={metricasFiltroDesde || null}
          filtroFechaHasta={metricasFiltroHasta || null}
          filtroCampana={metricasFiltroCampana || null}
          onOpenContactabilidad={() => setShowContactModal(true)}
          onOpenVolumen={() => setShowVolumenModal(true)}
        />
        </MetricasErrorBoundary>
      </div>
    );
  }

  function renderTabReportes() {
    return (
      <div className="sup-reportes-tab">
        <div className="card" style={{ maxWidth: 600 }}>
          <div className="widget-header">
            <h3 className="widget-title">Configuración de Exportación</h3>
          </div>
          
          <div className="reporte-form" style={{ padding: 0 }}>
            <div style={{ marginBottom: 24 }}>
              <label className="reporte-form__label">Tipo de Reporte</label>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button"
                  className={`btn btn-sm ${reporteTipo === 'actividad' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setReporteTipo('actividad')}
                >ACTIVIDAD / MÉTRICAS</button>
                <button type="button"
                  className={`btn btn-sm ${reporteTipo === 'gestiones' ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setReporteTipo('gestiones')}
                >REPORTE DE GESTIONES</button>
              </div>
            </div>
            <div style={{ marginBottom: 24 }}>
              <label className="reporte-form__label">Nivel de Reporte</label>
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" 
                  className={`btn btn-sm ${!reporteFiltros.asesor_id ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setReporteFiltros(p => ({ ...p, asesor_id: '' }))}
                >
                  EQUIPO COMPLETO
                </button>
                <button type="button" 
                  className={`btn btn-sm ${reporteFiltros.asesor_id ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setReporteFiltros(p => ({ ...p, asesor_id: asesores[0]?.id || '' }))}
                >
                  ASESOR ESPECÍFICO
                </button>
              </div>
            </div>

            {reporteFiltros.asesor_id && (
              <div style={{ marginBottom: 24 }}>
                <label className="reporte-form__label">Seleccionar Asesor</label>
                <select
                  className="input"
                  value={reporteFiltros.asesor_id}
                  onChange={e => setReporteFiltros(p => ({ ...p, asesor_id: e.target.value }))}
                >
                  {asesores.map(a => (
                    <option key={a.id} value={a.id}>{a.nombre}</option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
              <div style={{ flex: 1 }}>
                <label className="reporte-form__label">Fecha Inicio</label>
                <input aria-label="Fecha Inicio"
                  className="input"
                  type="date"
                  value={reporteFiltros.fechaInicio}
                  onChange={e => setReporteFiltros(p => ({ ...p, fechaInicio: e.target.value }))}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="reporte-form__label">Fecha Fin</label>
                <input aria-label="Fecha Fin"
                  className="input"
                  type="date"
                  value={reporteFiltros.fechaFin}
                  onChange={e => setReporteFiltros(p => ({ ...p, fechaFin: e.target.value }))}
                />
              </div>
            </div>

            <label className="reporte-form__label" style={{ marginTop: 24 }}>Formato de Salida</label>
            <div style={{ display: 'flex', gap: 12 }}>
              {['xlsx', 'pdf', 'csv'].map(fmt => (
                <button type="button" 
                  key={fmt}
                  className={`btn btn-sm ${reporteFiltros.formato === fmt ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setReporteFiltros(p => ({ ...p, formato: fmt }))}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>

            <button type="button" 
              className="btn btn-primary btn-lg" 
              style={{ width: '100%', marginTop: 32 }}
              onClick={generarReporte}
            >
              <span className="material-symbols-outlined">download</span>
              GENERAR Y DESCARGAR
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleAddAsesor = async () => {
    if(!newAsesorName.trim() || !newAsesorEmail.trim() || !newAsesorPassword.trim()) {
      showToast('Por favor complete todos los campos', 'warning');
      return;
    }
    try {
        const payload = { nombre: newAsesorName, email: newAsesorEmail, password: newAsesorPassword, rol: esAdminPrincipal ? newAsesorRol : 'asesor' };
        const resInsert = isRemote
          ? await vmFetch(apiBase, authToken, '/admin/users', { method: 'POST', body: JSON.stringify(payload) })
          : await window.api.invoke('db:insertAsesor', payload);

       if (resInsert.error) { showToast(`Error: ${resInsert.error}`, 'error'); return; }

       showToast('Asesor agregado correctamente', 'success');
        setNewAsesorName(''); setNewAsesorEmail(''); setNewAsesorPassword(''); setNewAsesorRol('asesor');
       const res = isRemote ? await vmFetch(apiBase, authToken, '/admin/users') : await window.api.invoke('db:getAllUsuarios');
       setAllUsuarios(Array.isArray(res) ? res : []);
       cargarAsesores();
    } catch(e){
       showToast('Error al agregar asesor. Verifique que el correo no esté duplicado.', 'error');
    }
  };

  const handleDeleteAsesor = async (id, nombre) => {
    if (!window.confirm(`¿Eliminar permanentemente a "${nombre}"?\n\nSe borrarán también todas sus gestiones, CDRs y métricas.\n\nSi desea conservar el historial, use "Anonimizar" en su lugar.`)) return;
    try {
       if (isRemote) { showToast('Eliminar usuario no disponible en modo VM — use Desactivar', 'warning'); return; }
       await window.api.invoke('db:deleteAsesor', id);
       showToast('Asesor eliminado', 'success');
       const res = await window.api.invoke('db:getAllUsuarios');
       setAllUsuarios(res || []);
       cargarAsesores();
    } catch(e){
       showToast('Error al eliminar: ' + (e?.message || 'error desconocido'), 'error');
    }
  };

  const handleAnonymizeAsesor = async (id, nombre) => {
    if (!window.confirm(`¿Anonimizar a "${nombre}"?\n\nSe eliminarán sus datos personales (nombre, email, contraseña) pero se conservarán todas sus gestiones, CDRs y métricas en los reportes.`)) return;
    try {
       if (isRemote) { showToast('Anonimizar no disponible en modo VM', 'warning'); return; }
       await window.api.invoke('db:anonymizeAsesor', id);
       showToast('Asesor anonimizado — historial conservado', 'success');
       const res = await window.api.invoke('db:getAllUsuarios');
       setAllUsuarios(res || []);
       cargarAsesores();
    } catch(e){
       showToast('Error al anonimizar', 'error');
    }
  };

  const handleToggleEstadoAsesor = async (id, actualEstado) => {
    try {
       const res = isRemote
         ? await vmFetch(apiBase, authToken, `/admin/users/${id}/toggle`, { method: 'POST' })
         : await window.api.invoke('db:updateAsesor', id, { estado: actualEstado === 'activo' ? 'inactivo' : 'activo' });
       const usuarios = isRemote ? await vmFetch(apiBase, authToken, '/admin/users') : await window.api.invoke('db:getAllUsuarios');
       setAllUsuarios(Array.isArray(usuarios) ? usuarios : []);
       cargarAsesores();
       showToast(`Estado actualizado`, 'info');
    } catch(e){
       showToast('Error al actualizar estado', 'error');
    }
  };

  function renderPersonalConfig() {
    return (
      <div className="sup-config" style={{ padding: '24px' }}>
        <div className="card" style={{ maxWidth: 800, margin: '0 auto' }}>
          <h3 className="text-headline-sm" style={{ marginBottom: 'var(--space-md)' }}>
            Administración de Personal
          </h3>
          <p style={{ color: 'var(--color-on-surface-variant)', fontSize: 13, marginBottom: 24 }}>
            Control de las terminales asesor activas en el piso.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: esAdminPrincipal ? '1fr 1fr 1fr 1fr auto' : '1fr 1fr 1fr auto', gap: 12, marginBottom: 24, alignItems: 'end' }}>
             <div>
               <label className="text-label-sm" style={{ display: 'block', marginBottom: 6, opacity: 0.6 }}>NOMBRE</label>
               <input aria-label="NOMBRE" 
                 type="text" 
                 className="input" 
                 placeholder="Ej: Juan Pérez" 
                 value={newAsesorName} 
                 onChange={e => setNewAsesorName(e.target.value)} 
               />
             </div>
             <div>
               <label className="text-label-sm" style={{ display: 'block', marginBottom: 6, opacity: 0.6 }}>CORREO ACCESO</label>
               <input aria-label="CORREO ACCESO" 
                 type="email" 
                 className="input" 
                 placeholder="juan@uphone.local" 
                 value={newAsesorEmail} 
                 onChange={e => setNewAsesorEmail(e.target.value)} 
               />
             </div>
             <div>
               <label className="text-label-sm" style={{ display: 'block', marginBottom: 6, opacity: 0.6 }}>CONTRASEÑA</label>
               <input aria-label="CONTRASEÑA" 
                 type="password" 
                 className="input" 
                 placeholder="••••••••" 
                 value={newAsesorPassword} 
                 onChange={e => setNewAsesorPassword(e.target.value)} 
               />
             </div>
             {esAdminPrincipal && (
                <div>
                  <label className="text-label-sm" style={{ display: 'block', marginBottom: 6, opacity: 0.6 }}>ROL</label>
                  <select 
                    className="input" 
                    value={newAsesorRol} 
                    onChange={e => setNewAsesorRol(e.target.value)}
                  >
                    <option value="asesor">Gestor</option>
                    <option value="supervisor">Jefe de Area</option>
                  </select>
                </div>
              )}
             <button type="button" className="btn btn-primary" style={{ padding: '0 16px', height: '38px', gridColumn: esAdminPrincipal ? 'span 1' : 'auto' }} onClick={handleAddAsesor}>
                <span className="material-symbols-outlined">person_add</span>
                Agregar
             </button>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>
              <span className="text-label-sm" style={{ width: 40, opacity: 0.4 }}>#ID</span>
              <span className="text-label-sm" style={{ flex: 1, opacity: 0.4 }}>NOMBRE Y CORREO</span>
              <span className="text-label-sm" style={{ width: 100, opacity: 0.4 }}>ROL</span>
              <span className="text-label-sm" style={{ width: 220, opacity: 0.4, textAlign: 'right' }}>ACCIONES</span>
           </div>

          <div className="stats-table">
             {allUsuarios.filter(u => esAdminPrincipal || u.rol === 'asesor').map(u => (
                <div key={u.id} className="stats-row" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                      <span className="text-mono" style={{ width: 40, fontSize: 13, opacity: 0.3, fontWeight: 'bold' }}>#{u.id}</span>
                      <div className={`dot ${u.estado === 'activo' ? 'dot-primary dot-pulse' : ''}`} style={{ backgroundColor: u.estado !== 'activo' ? 'rgba(255,255,255,0.2)' : undefined }} />
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                         <span style={{ fontWeight: 600, fontSize: 14, color: u.estado === 'activo' ? '#fff' : 'rgba(255,255,255,0.5)' }}>{u.nombre}</span>
                         <span className="text-mono" style={{ fontSize: 12, opacity: 0.4 }}>{u.email}</span>
                      </div>
                   </div>
                   <div style={{ width: 100 }}>
                      <span className="badge" style={{ 
                        fontSize: 12, 
                        background: u.rol === 'supervisor' ? 'var(--color-primary)' : 'transparent',
                        color: u.rol === 'supervisor' ? 'white' : 'var(--color-primary)',
                        border: u.rol === 'supervisor' ? 'none' : '1px solid var(--color-primary)',
                        padding: '2px 8px',
                        borderRadius: 4
                      }}>
                        {u.rol.toUpperCase()}
                      </span>
                   </div>
                   <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: 220, justifyContent: 'flex-end' }}>
                      <span className="text-label-sm" style={{ marginRight: 8, opacity: 0.5, fontSize: 12 }}>{u.estado.toUpperCase()}</span>
                      <button type="button" 
                         className={`btn btn-sm ${u.estado === 'activo' ? 'btn-outline' : 'btn-primary'}`}
                         style={{ minWidth: 90, height: 28, fontSize: 12 }}
                         onClick={() => handleToggleEstadoAsesor(u.id, u.estado)}
                      >
                         {u.estado === 'activo' ? 'Desactivar' : 'Reactivar'}
                      </button>
                      <button type="button"
                         className="btn btn-sm btn-ghost"
                         style={{ color: '#ffb300' }}
                         onClick={() => handleAnonymizeAsesor(u.id, u.nombre)}
                         title="Anonimizar (conserva historial)"
                      >
                         <span className="material-symbols-outlined" style={{ fontSize: 18 }}>person_off</span>
                      </button>
                      <button type="button"
                         className="btn btn-sm btn-ghost"
                         style={{ color: '#ff5252' }}
                         onClick={() => handleDeleteAsesor(u.id, u.nombre)}
                         title="Eliminar con todo el historial"
                      >
                         <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                      </button>
                   </div>
                </div>
             ))}
             {allUsuarios.length === 0 && <p className="text-body-sm" style={{ opacity: 0.5, textAlign: 'center' }}>No hay asesores cargados.</p>}
          </div>
        </div>
      </div>
    );
  }

  function renderNetworkConfig() {
    return (
      <div className="sup-config" style={{ padding: '24px' }}>
        <div className="card" style={{ 
          maxWidth: 480, 
          margin: '0 auto', 
          border: '1px solid rgba(255,255,255,0.08)', 
          background: 'rgba(255,255,255,0.01)',
          padding: '16px 20px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          height: 'fit-content'
        }}>
          <h3 className="text-headline-xs" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem' }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '18px' }}>lan</span>
            Configuración de Red (Multi-PC)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <label className="text-label-sm" style={{ display: 'block', marginBottom: 4, opacity: 0.6, fontSize: '12px', textTransform: 'uppercase' }}>
                Servidor (IP WebSocket)
              </label>
              <input aria-label="Campo" 
                type="text" 
                className="input" 
                placeholder="Ej: 192.168.1.108" 
                style={{ height: '34px', fontSize: '13px' }}
                value={wsIp} 
                onChange={e => setWsIp(e.target.value)} 
              />
            </div>
            <button type="button" 
              className="btn btn-primary btn-sm" 
              style={{ height: '34px', padding: '0 12px', fontSize: '12px' }}
              onClick={() => {
                localStorage.setItem('uphone_ws_ip', wsIp);
                wsActiveIpRef.current = wsIp; 
                showToast('IP guardada', 'success');
                if (wsRef.current) {
                  wsRef.current.onclose = null; 
                  wsRef.current.close();
                }
                conectarWS(); 
              }}
            >
              Guardar
            </button>
          </div>
          <p style={{ marginTop: 8, fontSize: '12px', opacity: 0.35 }}>
            Use '127.0.0.1' si el servidor está en esta misma PC local.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <ToastContainer />

      <NavigationDrawer
        userRole="supervisor"
        activePage={activePage}
        onNavigate={setActivePage}
        usuario={usuario}
        onLogout={onLogout}
      />

      <div className="app-main">
        <TopAppBar
          userName={usuario?.nombre || 'Jefe de Area'}
          userRole="Jefe de Área"
          isConnected={wsStatus === 'CONECTADO'}
          onLogout={onLogout}
          actions={
            <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center' }}>
              {/* Controles de Intentos y Modo removidos por solicitud */}
            </div>
          }
        />

        <div className="app-content">
          {/* ═══ TABS PESADAS — Mount once, hide/show (evita recrear SVG charts cada switch) ═══ */}
          {activePage === 'dashboard_directivo' && (
            <DashboardDirectivo apiBase={buildApiBase() || 'http://127.0.0.1:3001/api'} token={usuario.token || localStorage.getItem('auth_token')} />
          )}
          <div style={{ display: activePage === 'monitoreo' ? 'block' : 'none' }}>
            {renderTabMonitoreo()}
          </div>
          <div style={{ display: activePage === 'metricas' ? 'block' : 'none' }}>
            {renderTabMetricas()}
          </div>

          {/* ═══ TABS LIVIANAS — mount/unmount normal (sin charts pesados) ═══ */}
          {activePage === 'campanas' && renderTabCampanas()}
          {activePage === 'validacion' && <ValidacionPagos usuario={usuario} />}
          {activePage === 'compromisos' && (
            <Compromisos
              callApi={async (ch, ...args) => {
                if (!isRemote) return window.api.invoke(ch, ...args);
                if (ch === 'db:getCompromisosEquipo') {
                  const [fecha, asesorId] = args;
                  const p = new URLSearchParams();
                  if (fecha) p.set('fecha', fecha);
                  if (asesorId) p.set('asesor_id', asesorId);
                  return vmFetch(apiBase, authToken, `/compromisos-equipo?${p}`);
                }
                if (ch === 'db:eliminarCompromiso') {
                  return vmFetch(apiBase, authToken, `/compromisos/${args[0]}`, { method: 'DELETE' });
                }
                return window.api.invoke(ch, ...args);
              }}
              asesores={asesores}
            />
          )}
          {activePage === 'carteras' && (
            <CarterasEquipo callApi={async (ch, ...args) => {
              if (!isRemote) return window.api.invoke(ch, ...args);
              if (ch === 'db:getCarteraEquipo') return vmFetch(apiBase, authToken, '/cartera-equipo');
              if (ch === 'cartera:reordenar') {
                const [asesorId, contactoIdsEnOrden] = args;
                return vmFetch(apiBase, authToken, '/cartera/reordenar', { method: 'POST', body: JSON.stringify({ asesorId, contactoIdsEnOrden }) });
              }
              if (ch === 'reports:generate') {
                const [tipo, opts] = args;
                return vmFetch(apiBase, authToken, `/reports/${tipo}?${new URLSearchParams(opts)}`);
              }
              if (ch === 'shell:openPath') return { success: false };
              return window.api.invoke(ch, ...args);
            }} />
          )}
          {activePage === 'reportes' && renderTabReportes()}
          {activePage === 'mensajes_broadcast' && <SupervisorMensajes usuario={usuario} />}
          {activePage === 'mensajes' && <MessagesConfig />}
          {activePage === 'indicadores' && (
            <SupervisorIndicadores callApi={(ch, ...args) => window.api.invoke(ch, ...args)} />
          )}
          {/* Bug 3 v3.0: Administración de Personal movida al panel del Admin del sistema. */}
          {activePage === 'red' && renderNetworkConfig()}
          
          {escuchando && <AudioMonitor asesorId={escuchando} activo={!!escuchando} />}
        </div>

        {/* Modal de detalle Promesas/Recaudado */}
        {detalleModal && (
          <DetalleMetricaModal
            tipo={detalleModal}
            fecha={metricasFiltroDesde || null}
            fechaFin={metricasFiltroHasta || null}
            campanaId={metricasFiltroCampana ? Number(metricasFiltroCampana) : null}
            onClose={() => setDetalleModal(null)}
          />
        )}

        {/* Modal Contactabilidad por Hora */}
        {showContactModal && (
          <ContactabilidadModal
            fechaDesde={metricasFiltroDesde || null}
            fechaHasta={metricasFiltroHasta || null}
            campanaId={metricasFiltroCampana ? Number(metricasFiltroCampana) : null}
            asesores={asesores}
            campanas={campanasDisponibles}
            onFiltersChange={(desde, hasta, campanaId) => {
              setMetricasFiltroDesde(desde || '');
              setMetricasFiltroHasta(hasta || desde || '');
              setMetricasFiltroCampana(campanaId ? String(campanaId) : '');
            }}
            onClose={() => setShowContactModal(false)}
          />
        )}

        {/* Modal Volumen de Marcación por Hora */}
        {showVolumenModal && (
          <VolumenModal
            fechaDesde={metricasFiltroDesde || null}
            fechaHasta={metricasFiltroHasta || null}
            campanaId={metricasFiltroCampana ? Number(metricasFiltroCampana) : null}
            asesores={asesores}
            campanas={campanasDisponibles}
            onFiltersChange={(desde, hasta, campanaId) => {
              setMetricasFiltroDesde(desde || '');
              setMetricasFiltroHasta(hasta || desde || '');
              setMetricasFiltroCampana(campanaId ? String(campanaId) : '');
            }}
            onClose={() => setShowVolumenModal(false)}
          />
        )}
      </div>

      {/* Modal Reporte */}
      <Modal
        open={showReporteModal}
        onClose={() => setShowReporteModal(false)}
        title="Exportar Reporte"
      >
        <div className="reporte-form">
          <label className="reporte-form__label">Asesor</label>
          <select
            className="input"
            value={reporteFiltros.asesor_id}
            onChange={e => setReporteFiltros(p => ({ ...p, asesor_id: e.target.value }))}
          >
            <option value="">Todos los asesores</option>
            {asesores.map(a => (
              <option key={a.id} value={a.id}>{a.nombre}</option>
            ))}
          </select>

          <label className="reporte-form__label">Fecha</label>
          <input aria-label="Fecha"
            className="input"
            type="date"
            value={reporteFiltros.fecha}
            onChange={e => setReporteFiltros(p => ({ ...p, fecha: e.target.value }))}
          />

          <label className="reporte-form__label">Formato</label>
          <select
            className="input"
            value={reporteFiltros.formato}
            onChange={e => setReporteFiltros(p => ({ ...p, formato: e.target.value }))}
          >
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="pdf">PDF</option>
            <option value="csv">CSV</option>
          </select>

          <div className="reporte-form__actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowReporteModal(false)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={generarReporte}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>download</span>
              Generar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
