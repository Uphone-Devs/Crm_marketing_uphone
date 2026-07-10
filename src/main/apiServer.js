/**
 * apiServer.js — Servidor Express + WebSocket consolidado (puerto 3001).
 *
 * Arquitectura:
 *   - Express REST API (auth, campañas, CDRs, métricas)
 *   - WebSocket Server montado en el mismo http.Server (sin puerto extra)
 *   - Las respuestas usan las queries directas de better-sqlite3 (sincrónicas)
 *
 * Security: helmet + CORS restrictivo (solo localhost)
 */

// ── Load environment variables ──
// A1: cargar .env por ruta ABSOLUTA (raíz del app), no relativa al CWD del proceso.
// Bajo PM2/Windows Service el CWD puede no ser la raíz → dotenv.config() sin path
// no encontraba .env y JWT_SECRET caía al fallback dev. __dirname/../../.env es estable.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const helmet = require('helmet');

const {
  findUserByEmail, findUserById,
  getAsesores, getCampanas, getCampanasPorAsesor, getCampanaById, getSiguienteContacto,
  insertCdr, updateCdr, getCdrsByUsuario, getSubGestionesByAsesor, getSubGestionesByContacto, getCdrsByContacto, insertSubGestion, getBitacoraAsesor, getRefsBitacora, getCarteraAsesor, getCarteraEquipo, setOrdenMarcacionBatch, getTipificaciones,
  insertEvento, getMetricasDia, getMetricasEquipo, getCompromisosEquipo, confirmarPagoCompromiso, reagendarCompromiso, marcarCompromisoIncumplido, getPagosVerificadosPorAsesor,
  getAllConfig, setConfig, marcarContactoGestionado, marcarYaPagoDeclarado, getProgresoCampana,
  incrementarIntentoContacto, resetearIntentosContacto, getContactoById,
  insertAgendamiento,
  getAllUsuariosAdmin, insertUsuario, updateUsuarioAdmin, toggleUsuarioEstado, changePasswordAdmin,
  insertCampana, insertContactos, getCampanasDashboard, getCampaignSummary, deleteContactosPorAsesorEnCampana,
  correlacionarPagos, confirmarPagos, getMetricasValidacion, getHistorialValidaciones, revertirValidacion,
  getSesionesValidacion, eliminarSesion,
  getCarteraAnalisis, getCarteraRefinanciada, getGestionesAsesores, upsertMetaAsesor, getDetalleContactabilidad,
  getRotacionCarteraPeriodo,
  getAllCdrs, buscarContactoPorCedula, getAllReferencias,
  eliminarCompromiso,
  getProgresoAsesor,
  getCarteraFiltradaAsesor, toggleContactoMensajeria, getLoteMensajeria, marcarLoteEnviado,
  getIndicadoresRecaudo, saveIndicadoresRecaudo,
  getConfig,
  // Panel Jefe de Cobranza
  getIndicadoresCobranza, getProductividadJefe, getTopAsesoresJefe,
  getMorosidadPorDistribuidor, getRecaudacionSemanal, getProyeccionMensual,
  getMetaDiariaCampanas, setMetaDiariaCampana,
  // Mensajes Broadcast
  insertMensajeBroadcast, deleteMensajeBroadcast, getMensajesBroadcast,
} = require('./database/queries');
const { getConnectedAsesores, getConnectedClients, initWebSocket, broadcastToAll, broadcastToAsesor } = require('./wsServer');
const { loginRateLimitKey } = require('./security/rateLimitKeys');

let ReportGenerator = null;
try { ReportGenerator = require('./reports/ReportGenerator'); } catch { /* ignorar si no está disponible */ }

// ── JWT_SECRET: env variable (production) with dev fallback ──
const JWT_SECRET = process.env.JWT_SECRET
  || (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('[SEGURIDAD] JWT_SECRET no definido. Detener el proceso.'); })()
    : 'uphone-local-dev-2026');

let httpServer = null;

function initApiServer(port = 3001) {
  const app = express();

  // Confiar en proxy de Cloudflare/nginx — necesario para que
  // express-rate-limit lea X-Forwarded-For correctamente
  app.set('trust proxy', 1);

  // ── Middleware global ─────────────────────────────────
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '2mb' }));

  // ── CORS restrictivo (LAN + localhost) ───────────────
  const corsOptions = {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true) // mismo proceso Electron
      const allowed =
        origin.startsWith('http://localhost') ||
        origin.startsWith('http://127.0.0.1') ||
        /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}/.test(origin) ||
        /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(origin) ||
        /^https:\/\/[a-z0-9\-]+\.trycloudflare\.com$/.test(origin) // Cloudflare tunnel
      if (allowed) return callback(null, true)
      callback(new Error(`CORS bloqueado para origen: ${origin}`))
    },
    credentials: true
  }
  app.use(cors(corsOptions))

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ── Middleware de autenticación JWT ────────────────────
  function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token requerido' });
    }
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
  }

  /** Devuelve true si el rol tiene permisos de jefe/supervisor */
  function isJefeOrSupervisor(rol) {
    return rol === 'supervisor' || rol === 'jefe_area' || rol === 'jefe';
  }

  function requireSupervisor(req, res, next) {
    if (!isJefeOrSupervisor(req.user?.rol)) {
      return res.status(403).json({ error: 'Acceso denegado: requiere rol supervisor o jefe de área' });
    }
    next();
  }

  function requireAdmin(req, res, next) {
    if (req.user?.rol !== 'admin') {
      return res.status(403).json({ error: 'Acceso denegado: requiere rol admin' });
    }
    next();
  }

  function requireSupervisorOrAdmin(req, res, next) {
    if (req.user?.rol !== 'admin' && !isJefeOrSupervisor(req.user?.rol)) {
      return res.status(403).json({ error: 'Acceso denegado: requiere rol supervisor, jefe de área o admin' });
    }
    next();
  }

  // ═══════════════════════════════════════════════════════
  // RUTAS: Health
  // ═══════════════════════════════════════════════════════
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString(), engine: 'better-sqlite3' });
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Auth
  // ═══════════════════════════════════════════════════════

  // ── Rate Limiting para login (fuerza bruta) ───────────
  // C4: key POR CUENTA (email), no por IP. Detrás del túnel los asesores comparten
  // la IP que ve Express → con key por IP, 10 intentos colectivos bloqueaban a todo
  // el equipo. Por email cada asesor tiene su cupo y la protección sigue por cuenta.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutos
    max: 20,                     // 20 intentos por CUENTA (no por IP)
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: loginRateLimitKey,
    validate: { keyGeneratorIpFallback: false }, // key por email; el fallback IP es intencional
    message: { error: 'Demasiados intentos. Espera 15 minutos.' }
  })

  app.post('/api/auth/login', authLimiter, (req, res) => {
    try {
      const { email, password } = req.body;
      console.log(`[API] [LOGIN_ATTEMPT] Email: ${email} (IP: ${req.ip})`);

      if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña son requeridos' });
      }

      const user = findUserByEmail(email);
      if (!user) {
        console.warn(`[API] [LOGIN_FAIL] Usuario no encontrado: ${email}`);
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      if (user.estado !== 'activo') {
        console.warn(`[API] [LOGIN_FAIL] Cuenta inactiva: ${email}`);
        return res.status(401).json({ error: 'Cuenta desactivada. Contacte al administrador.' });
      }

      const passwordValid = bcrypt.compareSync(password, user.password_hash);
      if (!passwordValid) {
        console.warn(`[API] [LOGIN_FAIL] Contraseña incorrecta para: ${email}`);
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }

      const token = jwt.sign(
        { id: user.id, nombre: user.nombre, rol: user.rol },
        JWT_SECRET,
        { expiresIn: '12h' }
      );

      console.log(`[API] [LOGIN_SUCCESS] Usuario: ${user.nombre} (${user.rol})`);
      res.json({
        token,
        usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
      });
    } catch (err) {
      console.error('[API] [ERROR_FATAL] Error en login:', err.message);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Asesores
  // ═══════════════════════════════════════════════════════
  app.get('/api/asesores', requireAuth, (req, res) => {
    try {
      // Bug 4: jefe_area/supervisor ve solo su equipo; admin ve todos.
      const asesores = isJefeOrSupervisor(req.user?.rol)
        ? getAsesores({ supervisorId: req.user.id })
        : getAsesores();
      const conectados = getConnectedAsesores().map(c => c.asesor_id);
      const data = asesores.map(a => ({ ...a, conectado: conectados.includes(a.id) }));
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Campañas
  // ═══════════════════════════════════════════════════════
  app.get('/api/campanas/dashboard', requireAuth, (req, res) => {
    if (!isJefeOrSupervisor(req.user?.rol) && req.user?.rol !== 'admin')
      return res.status(403).json({ error: 'Acceso denegado' });
    try { res.json(getCampanasDashboard()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/campanas', requireAuth, (req, res) => {
    if (!isJefeOrSupervisor(req.user?.rol) && req.user?.rol !== 'admin')
      return res.status(403).json({ error: 'Acceso denegado' });
    try {
      const { nombre, descripcion } = req.body;
      if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
      const result = insertCampana({ nombre, descripcion, supervisor_id: req.user.id });
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/campanas/:id/contactos', requireAuth, (req, res) => {
    if (!isJefeOrSupervisor(req.user?.rol) && req.user?.rol !== 'admin')
      return res.status(403).json({ error: 'Acceso denegado' });
    try {
      const { asesorId, contactos } = req.body;
      if (!asesorId || !Array.isArray(contactos))
        return res.status(400).json({ error: 'asesorId y contactos[] requeridos' });
      const count = insertContactos(parseInt(req.params.id), asesorId, contactos);
      // Notificar al asesor en tiempo real para que recargue su cartera sin reiniciar
      try { broadcastToAsesor(asesorId, { tipo: 'CARTERA_ASIGNADA', campanaId: parseInt(req.params.id) }); } catch (_) {}
      res.json({ success: true, count });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/campanas/:id/summary', requireAuth, (req, res) => {
    try { res.json(getCampaignSummary(parseInt(req.params.id))); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/campanas/:campanaId/asesores/:asesorId', requireAuth, (req, res) => {
    if (!isJefeOrSupervisor(req.user?.rol) && req.user?.rol !== 'admin')
      return res.status(403).json({ error: 'Acceso denegado' });
    try {
      const result = deleteContactosPorAsesorEnCampana(parseInt(req.params.campanaId), parseInt(req.params.asesorId));
      res.json({ success: true, deleted: result.deleted });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/campanas', requireAuth, (req, res) => {
    try {
      res.json(getCampanas());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/campanas/asesor/:id', requireAuth, (req, res) => {
    try {
      const asesorId = parseInt(req.params.id);
      res.json(getCampanasPorAsesor(asesorId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/campanas/:id', requireAuth, (req, res) => {
    try {
      const campana = getCampanaById(parseInt(req.params.id));
      if (!campana) return res.status(404).json({ error: 'Campaña no encontrada' });
      res.json(campana);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/campanas/:id/siguiente', requireAuth, (req, res) => {
    try {
      const contacto = getSiguienteContacto(parseInt(req.params.id), req.user.id);
      if (!contacto) return res.json({ mensaje: 'No hay más contactos pendientes' });
      res.json(contacto);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/campanas/:id/progreso', requireAuth, (req, res) => {
    try {
      res.json(getProgresoCampana(parseInt(req.params.id), req.user?.id ?? null));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Progreso filtrado por asesor (usado por Monitoreo supervisor → filtro fecha/campaña)
  app.get('/api/asesores/:asesorId/progreso', requireAuth, (req, res) => {
    try {
      const asesorId = parseInt(req.params.asesorId);
      const opts = {};
      if (req.query.fecha) opts.fecha = req.query.fecha;
      if (req.query.campanaId) opts.campanaId = parseInt(req.query.campanaId);
      res.json(getProgresoAsesor(asesorId, opts));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/contactos/:id/gestionar', requireAuth, (req, res) => {
    try {
      marcarContactoGestionado(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Asesor declara "ya pagó" → pendiente de comprobación (validación bancaria del supervisor).
  app.patch('/api/contactos/:id/ya-pago', requireAuth, (req, res) => {
    try {
      marcarYaPagoDeclarado(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/contactos/:id/intentar', requireAuth, (req, res) => {
    try {
      const maxIntentos = req.body.maxIntentos || 1;
      incrementarIntentoContacto(parseInt(req.params.id), maxIntentos);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/agendamientos', requireAuth, (req, res) => {
    try {
      const result = insertAgendamiento(req.body);
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/contactos/:id/resetear-intentos', requireAuth, (req, res) => {
    try {
      resetearIntentosContacto(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/contactos/:id', requireAuth, (req, res) => {
    try {
      const contacto = getContactoById(parseInt(req.params.id));
      if (!contacto) return res.status(404).json({ error: 'Contacto no encontrado' });
      res.json(contacto);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/contactos/:id/cdrs', requireAuth, (req, res) => {
    try {
      res.json(getCdrsByContacto(parseInt(req.params.id)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/contactos/:id/referencias', requireAuth, (req, res) => {
    try {
      res.json(getSubGestionesByContacto(parseInt(req.params.id)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sub-gestiones', requireAuth, (req, res) => {
    try {
      const result = insertSubGestion({
        contactoId: parseInt(req.body.contactoId),
        asesorId: req.user.id,
        cdrId: req.body.cdrId ? parseInt(req.body.cdrId) : null,
        telefono: req.body.telefono,
        notas: req.body.notas || null,
        nombreRef: req.body.nombreRef || null,
        parentesco: req.body.parentesco || null,
      });
      res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  // ═══════════════════════════════════════════════════════
  // RUTAS: CDRs
  // ═══════════════════════════════════════════════════════
  app.get('/api/cdrs', requireAuth, (req, res) => {
    try {
      res.json(getCdrsByUsuario(req.user.id, req.query.fecha));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sub-gestiones', requireAuth, (req, res) => {
    try {
      res.json(getSubGestionesByAsesor(req.user.id, req.query.fecha));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/bitacora', requireAuth, (req, res) => {
    try {
      const limite = parseInt(req.query.limite) || 500;
      res.json(getBitacoraAsesor(req.user.id, limite));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Compromisos del asesor autenticado — usa req.user.id, no requiere supervisor.
  // El asesor solo ve los suyos. Acepta incluir VOL_CALL via query string.
  app.get('/api/mis-compromisos', requireAuth, (req, res) => {
    try {
      const fecha = req.query.fecha || null;
      const incluirVolCall = req.query.incluirVolCall === 'true' || req.query.incluirVolCall === '1';
      res.json(getCompromisosEquipo(fecha, req.user.id, { incluirVolCall }));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Recaudación verificada por asesor — sin doble conteo CDR + validación.
  app.get('/api/pagos-verificados', requireAuth, requireSupervisor, (req, res) => {
    try {
      const fecha     = req.query.fecha      || null;
      const campanaId = req.query.campana_id ? parseInt(req.query.campana_id) : null;
      const fechaFin  = req.query.fecha_fin  || null;
      res.json(getPagosVerificadosPorAsesor(fecha, campanaId, fechaFin));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Confirmar pago desde "Mis Compromisos" del asesor — evita doble conteo.
  // Actualiza CDR existente a PAGO_REAL sin crear uno nuevo.
  app.post('/api/confirmar-pago-compromiso', requireAuth, (req, res) => {
    try {
      const { cdrId, montoPagado, comprobante, formaPago } = req.body || {};
      if (!cdrId) return res.status(400).json({ error: 'cdrId requerido' });
      const result = confirmarPagoCompromiso(Number(cdrId), { montoPagado, comprobante, formaPago });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/reagendar-compromiso', requireAuth, (req, res) => {
    try {
      const { cdrId, nuevaFecha, nuevaHora, nuevoMonto } = req.body || {};
      if (!cdrId) return res.status(400).json({ error: 'cdrId requerido' });
      const result = reagendarCompromiso(Number(cdrId), { nuevaFecha, nuevaHora, nuevoMonto });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/marcar-compromiso-incumplido', requireAuth, (req, res) => {
    try {
      const { cdrId } = req.body || {};
      if (!cdrId) return res.status(400).json({ error: 'cdrId requerido' });
      const result = marcarCompromisoIncumplido(Number(cdrId));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/bitacora/refs', requireAuth, (req, res) => {
    try {
      const limite = parseInt(req.query.limite) || 1000;
      res.json(getRefsBitacora(req.user.id, limite));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/cartera', requireAuth, (req, res) => {
    try {
      const campanaId = req.query.campanaId ? parseInt(req.query.campanaId) : null;
      res.json(getCarteraAsesor(req.user.id, campanaId));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/cartera-filtrada', requireAuth, (req, res) => {
    try {
      const { intentos } = req.query;
      res.json(getCarteraAsesor(req.user.id, intentos || 'general'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/contacto/:id/mensajeria', requireAuth, (req, res) => {
    try {
      const { channel, state } = req.body;
      const result = toggleContactoMensajeria(parseInt(req.params.id), channel, state, req.user.id);
      res.json({ success: true, changes: result.changes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/lote-mensajeria/:channel', requireAuth, (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 200;
      res.json(getLoteMensajeria(req.user.id, req.params.channel, limit));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/lote-mensajeria/:channel/enviado', requireAuth, (req, res) => {
    try {
      const { contactoIds } = req.body;
      const result = marcarLoteEnviado(req.user.id, req.params.channel, contactoIds);
      // Notificar en tiempo real a asesores/supervisores conectados por WS
      broadcastToAll({ tipo: 'LOTE_ENVIADO', asesor_id: req.user.id, canal: req.params.channel, changes: result?.changes ?? 0 });
      res.json({ success: true, changes: result.changes });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Mensajes Broadcast (Supervisor → Asesores remotos) ──
  app.get('/api/mensajes-broadcast', requireAuth, (req, res) => {
    try {
      res.json(getMensajesBroadcast());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/mensajes-broadcast', requireAuth, requireSupervisor, (req, res) => {
    try {
      const { mensaje, segmento_destino } = req.body;
      if (!mensaje?.trim()) return res.status(400).json({ error: 'mensaje requerido' });
      const data = insertMensajeBroadcast(req.user.id, mensaje.trim(), segmento_destino || 'TODOS');
      broadcastToAll({ tipo: 'MENSAJE_BROADCAST', segmento: segmento_destino || 'TODOS' });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/mensajes-broadcast/:id', requireAuth, requireSupervisor, (req, res) => {
    try {
      const data = deleteMensajeBroadcast(Number(req.params.id));
      broadcastToAll({ tipo: 'MENSAJE_DESACTIVADO', id: Number(req.params.id) });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  app.get('/api/cartera-equipo', requireAuth, requireSupervisor, (req, res) => {
    try {
      res.json(getCarteraEquipo());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cartera/reordenar', requireAuth, requireSupervisor, (req, res) => {
    try {
      const asesorId = Number(req.body.asesorId || req.body.asesor_id);
      const ids = Array.isArray(req.body.contactoIds || req.body.contacto_ids)
        ? (req.body.contactoIds || req.body.contacto_ids).map(Number).filter(Number.isFinite)
        : [];
      if (!Number.isFinite(asesorId) || asesorId <= 0) return res.status(400).json({ error: 'asesorId inválido' });
      if (ids.length === 0) return res.status(400).json({ error: 'contactoIds vacío' });
      const result = setOrdenMarcacionBatch(asesorId, ids);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/cdrs', requireAuth, (req, res) => {
    try {
      // Soporte para camelCase y snake_case para robustez Multi-PC
      const contactoId = req.body.contactoId || req.body.contacto_id;
      const timestampInicio = req.body.timestampInicio || req.body.timestamp_inicio;
      
      if (!contactoId) return res.status(400).json({ error: 'contactoId es requerido' });

      const result = insertCdr({ 
        contactoId: parseInt(contactoId), 
        usuarioId: req.user.id, 
        timestampInicio: timestampInicio 
      });
      res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  app.patch('/api/cdrs/:id', requireAuth, (req, res) => {
    try {
      updateCdr(parseInt(req.params.id), req.body);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Tipificaciones
  // ═══════════════════════════════════════════════════════
  app.get('/api/tipificaciones', requireAuth, (req, res) => {
    try {
      res.json(getTipificaciones());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Eventos
  // ═══════════════════════════════════════════════════════
  app.post('/api/eventos', requireAuth, (req, res) => {
    try {
      // metadata se pasa como objeto crudo — insertEvento lo stringify internamente.
      // Antes había doble stringify (aquí + en insertEvento) que producía un
      // string JSON envuelto en string, rompiendo json_extract(metadata, '$.canal').
      // Síntoma: card "Comunicación Omnicanal" del supervisor en 0 en Multi-PC.
      const result = insertEvento({
        usuario_id: req.user.id,
        tipo: req.body.tipo,
        estado_id: req.body.estado_id,
        duracion_seg: req.body.duracion_seg,
        metadata: req.body.metadata || null
      });
      res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Métricas e Indicadores
  // ═══════════════════════════════════════════════════════
  app.get('/api/indicadores/config', requireAuth, (req, res) => {
    try {
      res.json(JSON.parse(getConfig('indicadores_config') || '[]'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/indicadores/config', requireAuth, requireSupervisor, (req, res) => {
    try {
      setConfig('indicadores_config', JSON.stringify(req.body));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/indicadores/recaudo', requireAuth, (req, res) => {
    try {
      const { asesor_id, mes, anio } = req.query;
      // IDOR fix: asesor solo lee los suyos; jefe/supervisor/admin puede pasar asesor_id ajeno
      const targetAsesorId = (asesor_id && (isJefeOrSupervisor(req.user?.rol) || req.user?.rol === 'admin'))
        ? parseInt(asesor_id)
        : req.user.id;
      res.json(getIndicadoresRecaudo(targetAsesorId, mes, anio));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/indicadores/recaudo', requireAuth, (req, res) => {
    try {
      const { asesor_id, datos } = req.body;
      // IDOR fix: solo jefe/supervisor/admin puede escribir indicadores de otro asesor
      const targetAsesorId = (asesor_id && (isJefeOrSupervisor(req.user?.rol) || req.user?.rol === 'admin'))
        ? parseInt(asesor_id)
        : req.user.id;
      res.json(saveIndicadoresRecaudo(targetAsesorId, datos || req.body));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/api/metricas/:usuario_id', requireAuth, (req, res) => {
    try {
      const targetId = parseInt(req.params.usuario_id);
      // IDOR fix: asesor solo puede ver sus propias métricas
      if (req.user?.rol === 'asesor' && req.user.id !== targetId) {
        return res.status(403).json({ error: 'Acceso denegado' });
      }
      const fecha = req.query.fecha || null;
      const opts = { campanaId: req.query.campanaId || null };
      res.json(getMetricasDia(targetId, fecha, opts));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/metricas-equipo', requireAuth, (req, res) => {
    if (!isJefeOrSupervisor(req.user?.rol) && req.user?.rol !== 'admin')
      return res.status(403).json({ error: 'Acceso denegado' });
    try {
      const fecha     = req.query.fecha      || null;
      const campanaId = req.query.campana_id ? parseInt(req.query.campana_id) : null;
      const fechaFin  = req.query.fecha_fin  || null;
      const opts = {};
      if (campanaId) opts.campanaId = campanaId;
      if (fechaFin)  opts.fechaFin  = fechaFin;
      // Bug 4: supervisor agrega solo su equipo; admin agrega todos.
      if (isJefeOrSupervisor(req.user?.rol)) opts.supervisorId = req.user.id;
      res.json(getMetricasEquipo(fecha, opts));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/compromisos-equipo', requireAuth, requireSupervisor, (req, res) => {
    try {
      const fecha = req.query.fecha || null;
      const asesorId = req.query.asesor_id ? parseInt(req.query.asesor_id) : null;
      const fechaFin = req.query.fecha_fin || null;
      const opts = fechaFin ? { fechaFin } : {};
      // Bug 4: jefe_area/supervisor ve solo compromisos de su equipo.
      if (isJefeOrSupervisor(req.user?.rol)) opts.supervisorId = req.user.id;
      res.json(getCompromisosEquipo(fecha, asesorId, opts));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/compromisos/:id', requireAuth, requireSupervisor, (req, res) => {
    try {
      res.json(eliminarCompromiso(parseInt(req.params.id)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Config
  // ═══════════════════════════════════════════════════════
  app.get('/api/config', requireAuth, (req, res) => {
    try {
      res.json(getAllConfig());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/config', requireAuth, requireSupervisor, (req, res) => {
    try {
      setConfig(req.body.clave, req.body.valor);
      broadcastToAll({ tipo: 'CONFIG_UPDATED', clave: req.body.clave });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Admin — gestión de usuarios (requiere rol admin)
  // ═══════════════════════════════════════════════════════

  app.get('/api/admin/users', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    // Bug 3: admin ve la cuenta admin; supervisor NO. Filtro por rol del token.
    try { res.json(getAllUsuariosAdmin(req.user?.rol)); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/users', requireAuth, requireSupervisorOrAdmin, async (req, res) => {
    try {
      const { nombre, email, password, rol } = req.body;
      if (!nombre || !email || !password || !rol)
        return res.status(400).json({ error: 'Campos requeridos: nombre, email, password, rol' });
      // Bug 4: el asesor se asigna a un supervisor. Si lo crea un supervisor → su id.
      // Si lo crea el admin → toma supervisor_id del body (puede asignar a cualquier grupo).
      let supervisorId = null;
      if (rol === 'asesor') {
        supervisorId = isJefeOrSupervisor(req.user?.rol)
          ? req.user.id
          : (req.body.supervisor_id != null ? parseInt(req.body.supervisor_id) : null);
      }
      const hash   = await bcrypt.hash(password, 10);
      const result = insertUsuario({ nombre, email, passwordHash: hash, rol, supervisorId });
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.put('/api/admin/users/:id', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const { nombre, email, rol, estado } = req.body;
      // Bug 4: solo el admin puede reasignar el grupo (supervisor_id) de un asesor.
      const payload = { nombre, email, rol, estado };
      if (req.user?.rol === 'admin' && req.body.supervisor_id !== undefined) {
        payload.supervisorId = req.body.supervisor_id != null ? parseInt(req.body.supervisor_id) : null;
      }
      updateUsuarioAdmin(Number(req.params.id), payload);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/users/:id/toggle', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try { res.json(toggleUsuarioEstado(Number(req.params.id))); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/admin/users/:id/password', requireAuth, requireAdmin, async (req, res) => {
    try {
      const { password } = req.body;
      if (!password || password.length < 6)
        return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });
      const hash = await bcrypt.hash(password, 10);
      changePasswordAdmin(Number(req.params.id), hash);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/admin/sysinfo', requireAuth, (req, res) => {
    if (req.user?.rol !== 'admin' && !isJefeOrSupervisor(req.user?.rol))
      return res.status(403).json({ error: 'Acceso denegado' });
    const os = require('os');
    const cpus1 = os.cpus();
    setTimeout(() => {
      const cpus2 = os.cpus();
      let totalIdle = 0, totalTick = 0;
      cpus1.forEach((cpu, i) => {
        for (const t in cpus2[i].times) totalTick += cpus2[i].times[t] - cpu.times[t];
        totalIdle += cpus2[i].times.idle - cpu.times.idle;
      });
      const cpuUsage = Math.max(0, Math.min(100, Math.round((1 - totalIdle / totalTick) * 100)));
      const total = os.totalmem(), free = os.freemem(), used = total - free;
      const upSec = os.uptime();
      res.json({
        cpu: { usage: cpuUsage, cores: os.cpus().length, model: os.cpus()[0]?.model?.trim() || 'N/A' },
        memory: { total, used, free, usedPercent: Math.round((used / total) * 100) },
        uptime: upSec,
        platform: os.platform(),
        hostname: os.hostname()
      });
    }, 200);
  });

  app.get('/api/admin/connected', requireAuth, (req, res) => {
    if (req.user?.rol !== 'admin' && !isJefeOrSupervisor(req.user?.rol))
      return res.status(403).json({ error: 'Acceso denegado' });
    const all = getConnectedClients();
    const asesores = all.filter(u => u.tipo === 'ASESOR');
    const supCount = all.filter(u => u.tipo === 'SUPERVISOR').length;
    res.json({ asesores, supervisores: supCount, total: all.length });
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Reportes
  // ═══════════════════════════════════════════════════════
  app.get('/api/reports/:tipo', requireAuth, async (req, res) => {
    try {
      if (!ReportGenerator) return res.status(503).json({ error: 'Módulo de reportes no disponible' });
      const { tipo } = req.params;
      const params = {
        asesor_id: req.query.asesor_id || req.user.id,
        fecha: req.query.fecha || null,
        formato: req.query.formato || 'xlsx',
        fecha_desde: req.query.fecha_desde || null,
        fecha_hasta: req.query.fecha_hasta || null,
        estado: req.query.estado || null,
        tipo_filtro: req.query.tipo_filtro || null,
      };
      const result = await ReportGenerator.generate(tipo, params);
      if (!result.success) return res.status(400).json(result);

      // Servir el archivo generado como descarga y limpiar después (en VM no hay carpeta Documents)
      const fs = require('fs');
      if (result.archivo && fs.existsSync(result.archivo)) {
        const filename = require('path').basename(result.archivo);
        res.download(result.archivo, filename, (err) => {
          try { fs.unlinkSync(result.archivo); } catch {}
          if (err && !res.headersSent) res.status(500).json({ error: 'Error al enviar archivo' });
        });
      } else {
        res.json(result);
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Validación de Pagos (supervisor o admin)
  // ═══════════════════════════════════════════════════════
  function requireSupervisorOrAdmin(req, res, next) {
    if (req.user?.rol !== 'admin' && !isJefeOrSupervisor(req.user?.rol))
      return res.status(403).json({ error: 'Acceso denegado: requiere rol supervisor, jefe de área o admin' });
    next();
  }

  app.post('/api/validacion/correlacionar', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const { pagosData, opts } = req.body;
      if (!Array.isArray(pagosData)) return res.status(400).json({ error: 'pagosData[] requerido' });
      res.json(correlacionarPagos(pagosData, opts || {}));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/validacion/confirmar', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const { contactoIds, matches } = req.body;
      if (!Array.isArray(contactoIds) || !Array.isArray(matches))
        return res.status(400).json({ error: 'contactoIds[] y matches[] requeridos' });
      res.json(confirmarPagos(contactoIds, req.user.id, matches));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/validacion/metricas', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const fecha     = req.query.fecha      || null;
      const campanaId = req.query.campana_id ? parseInt(req.query.campana_id) : null;
      res.json(getMetricasValidacion(fecha, campanaId ? { campanaId } : {}));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/validacion/historial', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try { res.json(getHistorialValidaciones()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/validacion/revertir/:contactoId', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try { res.json(revertirValidacion(parseInt(req.params.contactoId))); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/validacion/sesiones', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try { res.json(getSesionesValidacion()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/validacion/sesiones/:id', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try { res.json(eliminarSesion(parseInt(req.params.id))); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Evolución de Cartera / Analytics
  // ═══════════════════════════════════════════════════════
  app.get('/api/cartera/analisis', requireAuth, (req, res) => {
    try {
      const opts = {};
      if (req.query.fechaAsig)  opts.fechaAsig  = req.query.fechaAsig;
      if (req.query.desdeD)     opts.desdeD     = parseInt(req.query.desdeD);
      if (req.query.hastaD)     opts.hastaD     = parseInt(req.query.hastaD);
      if (req.query.campana_id) opts.campanaId  = parseInt(req.query.campana_id);
      res.json(getCarteraAnalisis(opts));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Rotación de cartera por asesor (usado por AdvancedMetricsCharts en VM mode)
  app.get('/api/cartera/rotacion', requireAuth, (req, res) => {
    try {
      const opts = {};
      if (req.query.campana_id)  opts.campanaId   = parseInt(req.query.campana_id);
      if (req.query.fechaInicio) opts.fechaInicio = req.query.fechaInicio;
      if (req.query.fechaFin)    opts.fechaFin    = req.query.fechaFin;
      res.json(getRotacionCarteraPeriodo(opts));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/cartera/refinanciada', requireAuth, (req, res) => {
    try {
      const opts = {};
      if (req.query.fechaAsig)  opts.fechaAsig  = req.query.fechaAsig;
      if (req.query.campana_id) opts.campanaId  = parseInt(req.query.campana_id);
      if (req.query.campoRef)   opts.campoRef   = req.query.campoRef;
      res.json(getCarteraRefinanciada(opts));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/cartera/gestiones-asesores', requireAuth, (req, res) => {
    try {
      const opts = {};
      if (req.query.desde)      opts.desde     = req.query.desde;
      if (req.query.hasta)      opts.hasta     = req.query.hasta;
      if (req.query.campana_id) opts.campanaId = parseInt(req.query.campana_id);
      res.json(getGestionesAsesores(opts));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/cartera/meta-asesor', requireAuth, (req, res) => {
    try {
      const { asesorId, periodo, campo, valor } = req.body;
      if (!asesorId || !periodo || !campo || valor == null)
        return res.status(400).json({ error: 'asesorId, periodo, campo y valor requeridos' });
      res.json(upsertMetaAsesor({ asesorId: Number(asesorId), periodo, campo, valor: Number(valor) }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/cartera/detalle-contactabilidad', requireAuth, (req, res) => {
    try {
      const fecha     = req.query.fecha      || null;
      const asesorId  = req.query.asesor_id  ? parseInt(req.query.asesor_id)  : null;
      const campanaId = req.query.campana_id ? parseInt(req.query.campana_id) : null;
      const fechaFin  = req.query.fecha_fin  || null;
      res.json(getDetalleContactabilidad(fecha, asesorId, campanaId, fechaFin));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: CDRs supervisor / historial completo
  // ═══════════════════════════════════════════════════════
  app.get('/api/cdrs/all', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const filtros = {};
      if (req.query.asesor_id)  filtros.asesorId  = parseInt(req.query.asesor_id);
      if (req.query.fecha)      filtros.fecha      = req.query.fecha;
      if (req.query.campana_id) filtros.campanaId  = parseInt(req.query.campana_id);
      res.json(getAllCdrs(filtros));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ═══════════════════════════════════════════════════════
  // RUTAS: Búsqueda contactos y referencias globales
  // ═══════════════════════════════════════════════════════
  app.get('/api/contactos/search', requireAuth, (req, res) => {
    try {
      const { cedula } = req.query;
      if (!cedula) return res.status(400).json({ error: 'cedula requerida' });
      const contacto = buscarContactoPorCedula(cedula);
      if (!contacto) return res.status(404).json({ error: 'Contacto no encontrado' });
      res.json(contacto);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/referencias', requireAuth, (req, res) => {
    try {
      const opts = {};
      if (req.query.asesor_id)  opts.asesorId  = parseInt(req.query.asesor_id);
      if (req.query.fecha)      opts.fecha      = req.query.fecha;
      if (req.query.parentesco) opts.parentesco = req.query.parentesco;
      if (req.query.limite)     opts.limite     = parseInt(req.query.limite);
      res.json(getAllReferencias(opts));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Crear http.Server y montar WebSocket ──────────────
  httpServer = http.createServer(app);

  // Montar WebSocket en el mismo server (comparten puerto)
  const verifyToken = (t) => jwt.verify(t, JWT_SECRET);
  initWebSocket(httpServer, verifyToken);

  // ═══════════════════════════════════════════════════════════════
  // RUTAS: Panel Jefe de Cobranza — KPIs y Métricas
  // Todas protegidas por requireAuth + requireSupervisorOrAdmin (incluye admin)
  // Spec: spec_panel_jefe.md §2
  // ═══════════════════════════════════════════════════════════════

  // GET /api/jefe/indicadores?campanaId=&segmento=&distribuidor=
  app.get('/api/jefe/indicadores', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const filtros = {
        campanaId:    req.query.campanaId    ? parseInt(req.query.campanaId)   : undefined,
        segmento:     req.query.segmento     ?? undefined,
        distribuidor: req.query.distribuidor ?? undefined,
      };
      res.json(getIndicadoresCobranza(filtros));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/jefe/productividad?campanaId=&fechaInicio=&fechaFin=
  app.get('/api/jefe/productividad', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const filtros = {
        campanaId:    req.query.campanaId    ? parseInt(req.query.campanaId)   : undefined,
        fechaInicio:  req.query.fechaInicio  ?? undefined,
        fechaFin:     req.query.fechaFin     ?? undefined,
      };
      res.json(getProductividadJefe(filtros));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/jefe/top-asesores?canal=global&limit=5
  app.get('/api/jefe/top-asesores', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const canal = req.query.canal || 'global';
      const limit = req.query.limit ? parseInt(req.query.limit) : 5;
      res.json(getTopAsesoresJefe(canal, limit));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/jefe/morosidad
  app.get('/api/jefe/morosidad', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      res.json(getMorosidadPorDistribuidor());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/jefe/tendencia-semanal?dias=7
  app.get('/api/jefe/tendencia-semanal', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const dias = req.query.dias ? parseInt(req.query.dias) : 7;
      res.json(getRecaudacionSemanal(dias));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/jefe/meta-mensual
  app.get('/api/jefe/meta-mensual', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      res.json(getProyeccionMensual());
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── DEV ONLY: Seed datos de prueba de pagos ──────────────────────
  app.post('/api/dev/seed-pagos', (req, res) => {
    try {
      const db = require('./database/db').getDb();
      const cdrCols = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
      const tsCol = cdrCols.includes('creado_en') ? 'creado_en'
                  : cdrCols.includes('timestamp_inicio') ? 'timestamp_inicio' : null;
      if (!tsCol) return res.status(500).json({ error: 'No columna fecha en cdrs' });
      const asesores  = db.prepare("SELECT id FROM usuarios WHERE rol = 'asesor' LIMIT 5").all();
      const contactos = db.prepare("SELECT id, monto_deuda FROM contactos ORDER BY RANDOM() LIMIT 40").all();
      const tipPMP    = db.prepare("SELECT id FROM tipificaciones WHERE codigo = 'PMP' LIMIT 1").get();
      if (!asesores.length || !contactos.length || !tipPMP) return res.status(400).json({ error: 'Faltan datos base' });
      const ins = db.prepare(`INSERT OR IGNORE INTO cdrs (usuario_id, contacto_id, tipificacion_id, resultado, duracion, ${tsCol}) VALUES (?, ?, ?, 'COMP_CUM', 120, ?)`);
      const pay = db.prepare("UPDATE contactos SET estado_marcacion = 'PAGADO' WHERE id = ?");
      function ago(n) { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,19).replace('T',' '); }
      let n = 0;
      db.transaction(() => {
        let ci = 0;
        for (let d = 0; d <= 6 && ci < contactos.length; d++) {
          const qty = 4 + (d % 4);
          for (let i = 0; i < qty && ci < contactos.length; i++, ci++) {
            pay.run(contactos[ci].id);
            ins.run(asesores[ci % asesores.length].id, contactos[ci].id, tipPMP.id, ago(d));
            n++;
          }
        }
      })();
      res.json({ ok: true, insertados: n, tsCol });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
  // ── FIN DEV SEED ─────────────────────────────────────────────────

  // POST /api/jefe/meta-mensual  { meta: 50000 }
  app.post('/api/jefe/meta-mensual', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const { meta } = req.body;
      if (meta === undefined || isNaN(parseFloat(meta))) {
        return res.status(400).json({ error: 'Valor de meta inválido' });
      }
      const { setConfig } = require('./database/queries');
      setConfig('meta_mensual_usd', String(parseFloat(meta)));
      res.json({ ok: true, meta: parseFloat(meta) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/jefe/meta-diaria-campanas
  app.get('/api/jefe/meta-diaria-campanas', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const data = getMetaDiariaCampanas();
      return res.json(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[API] /jefe/meta-diaria-campanas error:', err.message, err.stack);
      return res.json([]); // nunca 500 — retorna array vacío
    }
  });

  // POST /api/jefe/meta-diaria-campana  { campanaId, valor }
  app.post('/api/jefe/meta-diaria-campana', requireAuth, requireSupervisorOrAdmin, (req, res) => {
    try {
      const { campanaId, valor } = req.body;
      if (!campanaId || isNaN(parseFloat(valor))) {
        return res.status(400).json({ error: 'campanaId y valor requeridos' });
      }
      res.json(setMetaDiariaCampana(campanaId, valor));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[API] REST + WebSocket unificados en puerto ${port} (LAN admitida: 0.0.0.0)`);
  });

  return httpServer;
}

function stopApiServer() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

module.exports = { initApiServer, stopApiServer };
