/**
 * ipcHandlers.js — Canales IPC entre main process y renderer.
 *
 * Cada handler delega a queries.js (sincrónico, better-sqlite3).
 * NO hay requests HTTP intermedios: todo es directo a la DB local.
 */

// ── Load environment variables ──
require('dotenv').config();

const { ipcMain, shell, BrowserWindow } = require('electron');
const { isDbReady } = require('./database/db');

/**
 * Envuelve un handler IPC que necesita la BD lista.
 * Si la BD no está inicializada devuelve { error } en vez de lanzar excepción.
 */
function dbGuard(fn) {
  return async (...args) => {
    if (!isDbReady()) {
      console.error('[IPC] [DB_GUARD] Handler llamado antes de initDatabase()');
      return { error: 'Base de datos no disponible. Reinicia la aplicación.' };
    }
    return fn(...args);
  };
}

const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { 
  getDevices, 
  connectUSB_Bat, 
  connectWifi_Bat, 
  getDeviceStats,
  stopAll, 
  dial,
  hangup,
  toggleHold,
  toggleMute,
  toggleSpeaker,
  isScrcpyRunning,
  startRecordOnDevice,
  checkCallStatus,
  sendSMS,
} = require('./adbManager');
const metricsManager = require('./metricsManager');
const { startCapture, stopCapture, isCapturing } = require('./audioManager');
const recorder = require('./ffmpeg.recorder');
const { broadcastToAll, getConnectedClients } = require('./wsServer');
const {
  findUserByEmail, findUserById,
  getAsesores, getAllUsuarios, insertAsesor, updateAsesor, deleteAsesor, anonymizeAsesor,
  getAllUsuariosAdmin, updateUsuarioAdmin, toggleUsuarioEstado, changePasswordAdmin,
  getCampanas, getCampanasPorAsesor, getCampanaById, getContactoById, getSiguienteContacto, getCampaignSummary, getCampanasDashboard, deleteCampana, deleteContactosPorAsesorEnCampana, insertCampana, insertContactos,
  insertCdr, updateCdr, marcarContactoGestionado, marcarYaPagoDeclarado, eliminarCompromiso, confirmarPagoCompromiso, reagendarCompromiso, marcarCompromisoIncumplido, incrementarIntentoContacto, resetearIntentosContacto, getCdrsByUsuario, getSubGestionesByAsesor, getSubGestionesByContacto, buscarContactoPorCedula, getAllReferencias, getCdrsByContacto, insertSubGestion, getAllCdrs, getBitacoraAsesor, getRefsBitacora, getCarteraAsesor, getCarteraEquipo, setOrdenMarcacionBatch, getCarteraFiltradaAsesor, toggleContactoMensajeria, getLoteMensajeria, marcarLoteEnviado,
  getTipificaciones, getTipificacionById, actualizarEstadoContacto,
  getContactabilidadDia,
  insertAgendamiento, getAgendamientosPorAsesor, getAgendamientosPendientes,
  marcarAgendamientoEjecutado, cancelarAgendamiento,
  insertEvento, getEventosDia,
  getMetricasDia, getMetricasEquipo, getRotacionCarteraPeriodo, getCarteraAnalisis, getCarteraRefinanciada, getMetadataKeys, getCompromisosEquipo, getProgresoAsesor, getDetalleContactabilidad, getPagosVerificadosPorAsesor,
  getGestionesAsesores, upsertMetaAsesor, getRankingGeneralAsesores,
  getIndicadoresRecaudo, saveIndicadoresRecaudo,
  getIndicadoresCobranza, getProyeccionMensual,
  correlacionarPagos, confirmarPagos, getMetricasValidacion, getHistorialValidaciones, revertirValidacion,
  getSesionesValidacion, eliminarSesion,
  getConfig, setConfig, getAllConfig,
  getProgresoCampana,
  getGestoresRanking, getRankingLlamadas,
  insertMensajeBroadcast, getMensajesBroadcast, deleteMensajeBroadcast,
} = require('./database/queries');

const JWT_SECRET = process.env.JWT_SECRET
  || (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('[SEGURIDAD] JWT_SECRET no definido.'); })()
    : 'uphone-local-dev-2026');

let windowManager = null;
let ReportGenerator = null;

try {
  windowManager = require('./windowManager');
  ReportGenerator = require('./reports/ReportGenerator');
} catch (e) {
  console.error('[DEBUG] Error al cargar modulos en ipcHandlers:', e);
}

function registerIpcHandlers() {
  // ── AUTH (directo a DB, sin HTTP) ─────────────────────
  ipcMain.handle('auth:login', dbGuard(async (event, { email, password }) => {
    try {
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        return { error: 'Email inválido' };
      }
      if (!password || typeof password !== 'string' || password.length < 4) {
        return { error: 'Password inválido' };
      }

      let user = findUserByEmail(email.trim().toLowerCase());
      if (!user) {
        return { error: 'Credenciales inválidas' };
      }

      const valid = bcrypt.compareSync(password, user.password_hash);
      if (!valid) {
        return { error: 'Credenciales inválidas' };
      }

      const token = jwt.sign(
        { id: user.id, nombre: user.nombre, rol: user.rol },
        JWT_SECRET,
        { expiresIn: '12h' }
      );

      return {
        token,
        usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
      };
    } catch (err) {
      console.error('[IPC] [AUTH_LOGIN_ERROR]', err?.message, err?.stack);
      return { error: 'Error de autenticación' };
    }
  }));

  // ── ADB & DISPOSITIVO ────────────────────────────────
  ipcMain.handle('adb:devices', async () => getDevices());
  ipcMain.handle('adb:getDevices', async () => getDevices());
  ipcMain.handle('adb:connectUSB', async () => connectUSB_Bat());
  ipcMain.handle('adb:connectWifi', async (event, ip) => connectWifi_Bat(ip));
  ipcMain.handle('adb:stats', async () => getDeviceStats());
  ipcMain.handle('adb:getDeviceStats', async () => getDeviceStats());
  ipcMain.handle('adb:getMPH', async (event, usuarioId) => {
    return metricsManager.calculateMPH(usuarioId);
  });
  ipcMain.handle('adb:getROI', async () => {
    return metricsManager.calculateROI();
  });
  ipcMain.handle('adb:dial', async (event, num) => dial(num));
  ipcMain.handle('adb:hangup', async () => hangup());
  ipcMain.handle('adb:toggleHold', async () => toggleHold());
  ipcMain.handle('adb:toggleMute', async () => toggleMute());
  ipcMain.handle('adb:toggleSpeaker', async (event, state) => toggleSpeaker(state));
  ipcMain.handle('adb:startRecordOnDevice', async (event, isCurrentlyRecording) => startRecordOnDevice(isCurrentlyRecording));
  ipcMain.handle('adb:checkCallStatus', async () => checkCallStatus());
  ipcMain.handle('adb:isScrcpyRunning', async () => isScrcpyRunning());
  ipcMain.handle('adb:stopAll', async () => { stopAll(); return { success: true }; });
  ipcMain.handle('adb:sendSMS', async (event, phoneNumber, message) => sendSMS(phoneNumber, message));
  ipcMain.handle('adb:stop', async () => { stopAll(); return { success: true }; });

  // ── AUDIO ──────────────────────────────────────────────
  ipcMain.handle('audio:start', async (event) => {
    if (isCapturing()) return { success: true, alreadyRunning: true };
    const started = startCapture(
      (chunk) => {
        try { event.sender.send('audio:chunk', chunk); } catch { /* ventana cerrada */ }
      },
      (err) => {
        try { event.sender.send('audio:error', err.message); } catch { /* ignorar */ }
      }
    );
    return { success: started, error: started ? null : 'FFmpeg no disponible' };
  });

  ipcMain.handle('audio:stop', async () => { stopCapture(); return { success: true }; });
  ipcMain.handle('audio:status', async () => ({ capturing: isCapturing() }));

  // ── RECORDER ───────────────────────────────────────────
  ipcMain.handle('recorder:devices', async () => ({
    dispositivos: recorder.listarDispositivosAudio(),
    seleccionado: recorder.seleccionarDispositivoAudio(),
  }));
  ipcMain.handle('recorder:setDevice', async (event, nombre) => {
    recorder.forzarDispositivo(nombre);
    return { success: true, device: nombre };
  });
  ipcMain.handle('recorder:start', async (event, cdrId) => {
    return recorder.iniciarGrabacion(cdrId, (chunk) => {
      try { event.sender.send('audio:chunk', chunk); } catch { /* ventana cerrada */ }
    });
  });
  ipcMain.handle('recorder:stop', async () => await recorder.detenerGrabacion());
  ipcMain.handle('recorder:status', async () => ({
    grabando: recorder.isGrabando(),
    archivoActual: recorder.getArchivoActual(),
  }));
  ipcMain.handle('recorder:getBuffer', async (event, filePath) => {
    try {
      if (!fs.existsSync(filePath)) return { error: 'Archivo no encontrado' };
      const buffer = fs.readFileSync(filePath);
      return { success: true, buffer };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── DB: USUARIOS ─────────────────────────────────────
  ipcMain.handle('db:getAsesores', dbGuard(async () => getAsesores()));
  ipcMain.handle('db:getAllUsuarios', dbGuard(async () => getAllUsuarios()));
  ipcMain.handle('db:insertAsesor', async (event, data) => {
    try {
      // Hashear contraseña antes de guardar
      let passHash = '';
      if (data.password) {
        passHash = bcrypt.hashSync(data.password, 10);
      } else {
        passHash = bcrypt.hashSync('REDACTED', 10);
      }
      
      const result = insertAsesor({ 
        nombre: data.nombre, 
        email: data.email, 
        passwordHash: passHash,
        rol: data.rol
      });
      return { success: true, id: Number(result.lastInsertRowid) };
    } catch (err) {
      console.error('[DB] Error en insertAsesor:', err);
      return { error: err.message };
    }
  });
  ipcMain.handle('db:updateAsesor', async (event, id, data) => {
    updateAsesor(id, data);
    return { success: true };
  });
  ipcMain.handle('db:deleteAsesor', async (event, id) => {
    if (!id || typeof id !== 'number') return { error: 'ID inválido' };
    deleteAsesor(id);
    return { success: true };
  });
  ipcMain.handle('db:anonymizeAsesor', async (event, id) => {
    if (!id || typeof id !== 'number') return { error: 'ID inválido' };
    anonymizeAsesor(id);
    return { success: true };
  });

  // ── DB: INDICADORES ──────────────────────────────────
  ipcMain.handle('db:getIndicadoresConfig', dbGuard(async () => {
    return getConfig('indicadores_config') || '[]';
  }));
  ipcMain.handle('db:saveIndicadoresConfig', dbGuard(async (event, configStr) => {
    setConfig('indicadores_config', configStr);
    return { success: true };
  }));
  ipcMain.handle('db:getIndicadoresRecaudo', dbGuard(async (event, asesorId, mes, anio) => {
    return getIndicadoresRecaudo(asesorId, mes, anio);
  }));
  ipcMain.handle('db:saveIndicadoresRecaudo', dbGuard(async (event, asesorId, datos) => {
    return saveIndicadoresRecaudo(asesorId, datos);
  }));

  // ── DB: CAMPAÑAS ─────────────────────────────────────
  ipcMain.handle('db:getCampanas', dbGuard(async (event, asesorId) => {
    const idNum = asesorId ? Number(asesorId) : null;
    if (idNum) {
      return getCampanasPorAsesor(idNum);
    }
    return getCampanas();
  }));
  ipcMain.handle('db:getCampana', dbGuard(async (event, id) => getCampanaById(id)));
  ipcMain.handle('db:getSiguienteContacto', dbGuard(async (event, campanaId, asesorId) =>
    getSiguienteContacto(campanaId, asesorId)
  ));
  ipcMain.handle('db:insertCampana', async (event, data) => {
    const result = insertCampana(data);
    return { success: true, id: Number(result.lastInsertRowid) };
  });
  ipcMain.handle('db:insertContactos', async (event, campanaId, asesorId, contactos) => {
    const count = insertContactos(Number(campanaId), Number(asesorId), contactos);
    return { success: true, count };
  });
  ipcMain.handle('db:getCampaignSummary', async (event, campanaId) =>
    getCampaignSummary(campanaId)
  );
  ipcMain.handle('db:deleteCampana', async (event, id) => deleteCampana(id));
  ipcMain.handle('db:deleteContactosPorAsesor', async (event, campanaId, asesorId) =>
    deleteContactosPorAsesorEnCampana(Number(campanaId), Number(asesorId))
  );
  ipcMain.handle('db:getProgresoCampana', async (event, campanaId, asesorId) =>
    getProgresoCampana(Number(campanaId), asesorId ? Number(asesorId) : null)
  );
  ipcMain.handle('db:getCampanasDashboard', async (event) => getCampanasDashboard());

  // ── DB: CDRs ───────────────────────────────────────────
  ipcMain.handle('db:insertCdr', async (event, data) => {
    try {
      if (!data || typeof data !== 'object') {
        return { error: 'Datos de CDR inválidos' };
      }
      if (!data.contactoId || typeof data.contactoId !== 'number') {
        return { error: 'contactoId es requerido y debe ser número' };
      }
      const result = insertCdr(data);
      return { success: true, id: Number(result.lastInsertRowid) };
    } catch (err) {
      return { error: 'Error al insertar CDR' };
    }
  });
  ipcMain.handle('db:updateCdr', async (event, id, data) => {
    if (!id || typeof id !== 'number') {
      return { error: 'ID de CDR inválido' };
    }
    updateCdr(id, data);
    return { success: true };
  });
  ipcMain.handle('db:getContactoById', async (event, id) => getContactoById(Number(id)));
  ipcMain.handle('db:marcarContactoGestionado', async (event, contactoId) => {
    if (!contactoId || typeof contactoId !== 'number') {
      return { error: 'contactoId inválido' };
    }
    marcarContactoGestionado(contactoId);
    return { success: true };
  });
  ipcMain.handle('db:incrementarIntentoContacto', async (event, contactoId, maxIntentos) => {
    if (!contactoId || typeof contactoId !== 'number') {
      return { error: 'contactoId inválido' };
    }
    incrementarIntentoContacto(contactoId, maxIntentos);
    return { success: true };
  });
  ipcMain.handle('db:resetearIntentosContacto', async (event, contactoId) => {
    if (!contactoId || typeof contactoId !== 'number') {
      return { error: 'contactoId inválido' };
    }
    resetearIntentosContacto(contactoId);
    return { success: true };
  });
  ipcMain.handle('db:getCdrs', async (event, usuarioId, fecha) =>
    getCdrsByUsuario(usuarioId, fecha)
  );
  ipcMain.handle('db:getCdrsByContacto', async (event, contactoId) =>
    getCdrsByContacto(contactoId)
  );
  ipcMain.handle('db:getBitacoraAsesor', async (event, asesorId, limite) =>
    getBitacoraAsesor(asesorId, limite || 500)
  );
  ipcMain.handle('db:getRefsBitacora', async (event, asesorId, limite) =>
    getRefsBitacora(asesorId, limite || 1000)
  );
  ipcMain.handle('db:getCarteraAsesor', async (event, asesorId, campanaId) =>
    getCarteraAsesor(Number(asesorId), campanaId ? Number(campanaId) : null)
  );
  ipcMain.handle('db:getCarteraFiltradaAsesor', async (event, asesorId, filterIntentos) =>
    getCarteraAsesor(Number(asesorId), filterIntentos)
  );
  ipcMain.handle('db:toggleContactoMensajeria', async (event, contactoId, channel, newState, usuarioId) =>
    toggleContactoMensajeria(contactoId, channel, newState, usuarioId)
  );
  ipcMain.handle('db:getLoteMensajeria', async (event, asesorId, channel, limit) =>
    getLoteMensajeria(asesorId, channel, limit)
  );
  ipcMain.handle('db:marcarLoteEnviado', async (event, asesorId, channel, contactoIds) => {
    const result = marcarLoteEnviado(asesorId, channel, contactoIds);
    // Notificar a todas las ventanas Electron (asesor local ve métricas actualizadas al instante)
    const wsPayload = { tipo: 'LOTE_ENVIADO', asesor_id: asesorId, canal: channel, changes: result?.changes ?? 0 };
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) win.webContents.send('ws:message', wsPayload);
    });
    // Notificar también a asesores/supervisores remotos conectados por WS
    broadcastToAll(wsPayload);
    return result;
  });
  ipcMain.handle('db:getCarteraEquipo', async () => getCarteraEquipo());
  ipcMain.handle('cartera:reordenar', async (event, asesorId, contactoIdsEnOrden) => {
    try {
      const aid = Number(asesorId);
      if (!Number.isFinite(aid) || aid <= 0) throw new Error('asesorId inválido');
      if (!Array.isArray(contactoIdsEnOrden)) throw new Error('contactoIdsEnOrden debe ser array');
      const ids = contactoIdsEnOrden.map(Number).filter(Number.isFinite);
      if (ids.length === 0) throw new Error('No hay IDs válidos');
      return setOrdenMarcacionBatch(aid, ids);
    } catch (err) {
      console.error('[CARTERA:REORDENAR]', err.message);
      return { error: err.message };
    }
  });
  ipcMain.handle('db:getSubGestionesByAsesor', async (event, asesorId, fecha) =>
    getSubGestionesByAsesor(asesorId, fecha)
  );
  ipcMain.handle('db:insertSubGestion', async (event, data) =>
    insertSubGestion(data)
  );
  ipcMain.handle('db:getSubGestionesByContacto', async (event, contactoId) =>
    getSubGestionesByContacto(contactoId)
  );
  ipcMain.handle('db:buscarContactoPorCedula', async (event, cedula) =>
    buscarContactoPorCedula(cedula)
  );
  ipcMain.handle('db:getAllReferencias', async (event, filtros) =>
    getAllReferencias(filtros || {})
  );
  ipcMain.handle('db:getAllCdrs', async (event, filtros) => getAllCdrs(filtros));

  // ── DB: TIPIFICACIONES ─────────────────────────────────
  ipcMain.handle('db:getTipificaciones', dbGuard(async () => getTipificaciones()));

  // M-004+M-005: Tipificar CDR con lógica de finalización de gestión
  ipcMain.handle('cdrs:tipificar', async (event, { cdrId, tipificacionId, notas, contactoId }) => {
    if (!cdrId || typeof cdrId !== 'number') return { error: 'CDR ID inválido' };
    if (!tipificacionId || typeof tipificacionId !== 'number') return { error: 'Tipificación ID inválido' };

    try {
      // Actualizar CDR con la tipificación
      updateCdr(cdrId, { tipificacionId, notas });

      // Mapear código de tipificación → estado_marcacion del contacto.
      // Precedencia por semántica (no por finaliza_gestion, que en M-008 quedó en 1
      // para todas las tipif activas, anulando la rama AGENDADO/YA_PAGO):
      //   PAGO_REAL                       → YA_PAGO   (ya_pago=1; supervisor puede validar/revertir)
      //   PMP / VOL_CALL / PEND_COMP      → AGENDADO  (compromiso o llamada futura)
      //   resto con finaliza_gestion=1    → GESTIONADO
      const tipif = getTipificacionById(tipificacionId);
      const cod = tipif?.codigo;
      if (cod === 'PAGO_REAL') {
        marcarYaPagoDeclarado(contactoId);
      } else if (cod === 'PMP' || cod === 'VOL_CALL' || cod === 'PEND_COMP') {
        actualizarEstadoContacto(contactoId, 'AGENDADO');
      } else if (tipif?.finaliza_gestion === 1) {
        marcarContactoGestionado(contactoId);
      }

      return { success: true };
    } catch (err) {
      return { error: 'Error al tipificar' };
    }
  });

  // M-004: Contactabilidad del día
  ipcMain.handle('db:getContactabilidadDia', async (event, usuarioId, fecha) => {
    if (!usuarioId || typeof usuarioId !== 'number') return { error: 'ID inválido' };
    return getContactabilidadDia(usuarioId, fecha || null);
  });

  // M-006: Agendamientos
  ipcMain.handle('db:insertAgendamiento', async (event, data) => {
    const contactoId = data?.contacto_id || data?.contactoId;
    const asesorId   = data?.asesor_id   || data?.asesorId;
    const tipo       = data?.tipo;
    const fechaHora  = data?.fecha_hora   || data?.fechaHora;
    if (!contactoId || !asesorId || !tipo || !fechaHora)
      return { error: 'Datos de agendamiento incompletos' };
    try {
      insertAgendamiento(data);
      console.log(`[IPC] Agendamiento insertado: contacto=${contactoId} asesor=${asesorId} tipo=${tipo} fecha=${fechaHora}`);
      return { success: true };
    } catch (err) {
      console.error('[IPC] Error insertAgendamiento:', err.message);
      return { error: 'Error al crear agendamiento' };
    }
  });

  ipcMain.handle('db:getAgendamientosPendientes', async (event, asesorId) => {
    if (!asesorId || typeof asesorId !== 'number') return { error: 'ID inválido' };
    return getAgendamientosPorAsesor(asesorId);
  });

  ipcMain.handle('db:cancelarAgendamiento', async (event, id) => {
    if (!id || typeof id !== 'number') return { error: 'ID inválido' };
    try {
      cancelarAgendamiento(id);
      return { success: true };
    } catch (err) {
      return { error: 'Error al cancelar agendamiento' };
    }
  });

  // ── DB: EVENTOS ────────────────────────────────────────
  ipcMain.handle('db:insertEvento', async (event, data) => {
    try {
      if (!data || typeof data !== 'object') {
        return { error: 'Datos de evento inválidos' };
      }
      if (!data.usuario_id || typeof data.usuario_id !== 'number') {
        return { error: 'usuario_id es requerido' };
      }
      const result = insertEvento(data);
      return { success: true, id: Number(result.lastInsertRowid) };
    } catch (err) {
      return { error: 'Error al insertar evento' };
    }
  });
  ipcMain.handle('db:getEventosDia', async (event, usuarioId, fecha) =>
    getEventosDia(usuarioId, fecha)
  );

  // ── DB: MÉTRICAS ───────────────────────────────────────
  ipcMain.handle('db:getRankingGeneralAsesores', async (event, fecha) => getRankingGeneralAsesores(fecha));
  ipcMain.handle('db:getMetricasDia', async (event, usuarioId, fecha, opts) =>
    getMetricasDia(usuarioId, fecha || null, opts || {})
  );
  ipcMain.handle('db:getMetricasEquipo', async (event, fecha, opts) =>
    getMetricasEquipo(fecha || null, opts || {})
  );
  ipcMain.handle('db:getRotacionCarteraPeriodo', async (event, opts) =>
    getRotacionCarteraPeriodo(opts || {})
  );
  ipcMain.handle('db:getCompromisosEquipo', async (event, fecha, asesorId, opts) =>
    getCompromisosEquipo(fecha || null, asesorId || null, opts || {})
  );
  ipcMain.handle('db:confirmarPagoCompromiso', async (event, cdrId, datosPago) => {
    if (!cdrId) return { success: false, error: 'cdrId requerido' };
    return confirmarPagoCompromiso(Number(cdrId), datosPago || {});
  });
  ipcMain.handle('db:reagendarCompromiso', async (event, cdrId, datos) => {
    if (!cdrId) return { success: false, error: 'cdrId requerido' };
    return reagendarCompromiso(Number(cdrId), datos || {});
  });
  ipcMain.handle('db:marcarCompromisoIncumplido', async (event, cdrId) => {
    if (!cdrId) return { success: false, error: 'cdrId requerido' };
    return marcarCompromisoIncumplido(Number(cdrId));
  });
  ipcMain.handle('db:eliminarCompromiso', async (event, cdrId) => {
    if (!cdrId) return { success: false, error: 'cdrId requerido' };
    return eliminarCompromiso(Number(cdrId));
  });
  ipcMain.handle('db:getProgresoAsesor', async (event, asesorId, opts) =>
    getProgresoAsesor(asesorId, opts || {})
  );
  ipcMain.handle('db:getDetalleContactabilidad', async (event, fecha, asesorId, campanaId, fechaFin) =>
    getDetalleContactabilidad(fecha || null, asesorId || null, campanaId || null, fechaFin || null)
  );
  ipcMain.handle('db:getPagosVerificadosPorAsesor', async (event, fecha, campanaId, fechaFin) =>
    getPagosVerificadosPorAsesor(fecha || null, campanaId || null, fechaFin || null)
  );

  // ── VALIDACIÓN DE PAGOS ──────────────────────────────────
  ipcMain.handle('validacion:correlacionar', async (event, pagosData, opts) => {
    if (!Array.isArray(pagosData) || pagosData.length === 0)
      return { matches: [], totalContratos: 0, totalMatches: 0 };
    return correlacionarPagos(pagosData, opts || {});
  });
  ipcMain.handle('validacion:confirmarPagos', async (event, contactoIds, matches, supervisorId) => {
    if (!Array.isArray(contactoIds) || contactoIds.length === 0)
      return { success: false, error: 'Sin IDs' };
    return confirmarPagos(contactoIds, supervisorId, matches);
  });
  ipcMain.handle('validacion:getMetricas',   async (event, fecha, opts) => getMetricasValidacion(fecha || null, opts || {}));
  ipcMain.handle('validacion:getHistorial', async () => getHistorialValidaciones());
  ipcMain.handle('validacion:revertir', async (event, contactoId) => {
    if (!contactoId) return { success: false, error: 'ID requerido' };
    return revertirValidacion(contactoId);
  });
  ipcMain.handle('validacion:getSesiones',   async () => getSesionesValidacion());
  ipcMain.handle('validacion:eliminarSesion', async (event, sesionId) => {
    if (!sesionId) return { success: false, error: 'ID sesión requerido' };
    return eliminarSesion(sesionId);
  });

  // ── Evolución de Cartera ─────────────────────────────────
  ipcMain.handle('db:getCarteraAnalisis',     async (_, opts) => getCarteraAnalisis(opts || {}));
  ipcMain.handle('db:getCarteraRefinanciada', async (_, opts) => getCarteraRefinanciada(opts || {}));
  ipcMain.handle('db:getGestionesAsesores',   async (_, opts) => getGestionesAsesores(opts || {}));
  ipcMain.handle('db:upsertMetaAsesor',       async (_, opts) => upsertMetaAsesor(opts));
  ipcMain.handle('db:getMetadataKeys',        async (_, opts) => getMetadataKeys(opts || {}));
  
  // ── INDICADORES GLOBALES (ASESORES) ──────────────────────
  ipcMain.handle('db:getProyeccionMensual',   async () => getProyeccionMensual());
  ipcMain.handle('db:getIndicadoresCobranza', async (_, opts) => getIndicadoresCobranza(opts || {}));

  // ── RANKING DE GESTORES ──────────────────────────────────
  ipcMain.handle('db:getRankingGestores', dbGuard(async () => {
    try { return getGestoresRanking(); }
    catch (err) { console.error('[IPC] getRankingGestores:', err.message); return []; }
  }));

  ipcMain.handle('db:getRankingLlamadas', dbGuard(async (_, fecha) => {
    try { return getRankingLlamadas(fecha || null); }
    catch (err) { 
      console.error('[IPC] getRankingLlamadas:', err.stack); 
      return { totalEquipo: 0, asesores: [], debugError: err.message }; 
    }
  }));

  // ── DB: CONFIG ─────────────────────────────────────────
  ipcMain.handle('db:getConfig', async (event, clave) => ({ valor: getConfig(clave) }));
  ipcMain.handle('db:setConfig', async (event, clave, valor) => {
    if (!clave || typeof clave !== 'string') {
      return { error: 'Clave de configuración inválida' };
    }
    setConfig(clave, valor);

    // Si se actualiza un template de mensaje, notificar a todos los asesores
    if (clave.startsWith('msg_template_') || clave === 'codigo_pais') {
      broadcastToAll({ tipo: 'CONFIG_UPDATED', clave, valor });
    }

    return { success: true };
  });
  ipcMain.handle('db:getAllConfig', async () => getAllConfig());

  // ── REPORTES ───────────────────────────────────────────
  ipcMain.handle('reports:generate', async (event, tipo, params) => {
    if (!ReportGenerator) return { error: 'Módulo de reportes no disponible' };
    return await ReportGenerator.generate(tipo, params);
  });

  ipcMain.handle('shell:openPath', async (event, filePath) => {
    await shell.openPath(filePath);
    return { success: true };
  });

  ipcMain.handle('shell:openExternal', async (event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── SEGMENTOS / TRAMOS DINÁMICOS ────────────────────────
  ipcMain.handle('db:getSegmentos', async () => {
    return require('./database/queries').getSegmentosConfig();
  });
  ipcMain.handle('db:insertSegmento', async (event, clave, etiqueta, color) => {
    return require('./database/queries').insertSegmentoConfig(clave, etiqueta, color);
  });

  // ── MENSAJES BROADCAST ────────────────────────────────
  ipcMain.handle('db:getMensajesBroadcast', async () => {
    return getMensajesBroadcast();
  });

  ipcMain.handle('db:deleteMensajeBroadcast', async (event, id) => {
    const result = deleteMensajeBroadcast(id);
    // Notificar a asesores remotos via WebSocket
    const wsPayloadDel = { tipo: 'MENSAJE_DESACTIVADO', id: Number(id) };
    broadcastToAll(wsPayloadDel);
    // Notificar a todas las ventanas Electron locales (supervisores desktop)
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) win.webContents.send('ws:message', wsPayloadDel);
    });
    return result;
  });

  ipcMain.handle('db:insertMensajeBroadcast', async (event, supervisorId, mensaje, segmentoDestino) => {
    const data = insertMensajeBroadcast(supervisorId, mensaje, segmentoDestino);
    
    // Obtener nombre del supervisor (ya que insertMensajeBroadcast no hace JOIN con el autor)
    const autor = getMensajesBroadcast().find(m => m.id === data.id)?.supervisor_nombre || 'Supervisor';

    // Broadcast por WebSocket a todos los clientes remotos (asesores)
    const wsPayloadNew = {
      tipo: 'NUEVO_MENSAJE_SUPERVISOR',
      mensaje: data.mensaje,
      segmento_destino: data.segmento_destino,
      supervisor_nombre: autor,
      timestamp: data.creado_en
    };
    broadcastToAll(wsPayloadNew);
    // Notificar a todas las ventanas Electron locales (supervisores desktop)
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) win.webContents.send('ws:message', wsPayloadNew);
    });

    return data;
  });

  // ── WINDOW MANAGEMENT ──────────────────────────────────
  ipcMain.handle('app:switch-role', async (event, rol) => {
    if (!windowManager) return { error: 'WindowManager no disponible' };
    
    console.log(`[APP] [INFO] Cambiando a rol: ${rol}`);
    
    // Abrir nueva ventana según rol
    if (rol === 'admin') {
      windowManager.createAdminWindow();
    } else if (rol === 'supervisor' || rol === 'jefe_area' || rol === 'jefe' || rol === 'ADMINISTRADOR' || rol === 'SUPERVISOR') {
      windowManager.createSupervisorWindow();
    } else {
      windowManager.createAsesorWindow();
    }
    
    // Cerrar la ventana actual (el login o selector)
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      win.close();
    }
    
    return { success: true };
  });

  ipcMain.handle('app:logout', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.close();
      createLoginWindow();
    }
  });

  // ── ADMIN HANDLERS ─────────────────────────────────────────────

  ipcMain.handle('admin:getSystemInfo', async () => {
    const os = require('os');
    const cpuPercent = await new Promise((resolve) => {
      const start = os.cpus();
      setTimeout(() => {
        const end = os.cpus();
        let idle = 0, total = 0;
        for (let i = 0; i < start.length; i++) {
          idle  += (end[i].times.idle  - start[i].times.idle);
          const s = Object.values(start[i].times).reduce((a, b) => a + b, 0);
          const e = Object.values(end[i].times).reduce((a, b) => a + b, 0);
          total += (e - s);
        }
        resolve(total > 0 ? Math.round((1 - idle / total) * 100) : 0);
      }, 500);
    });

    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const usedMem  = totalMem - freeMem;
    const cpuInfo  = os.cpus()[0];

    let disk = { total: 0, free: 0, percent: 0 };
    try {
      const fsP = require('fs').promises;
      if (typeof fsP.statfs === 'function') {
        const drive = process.platform === 'win32' ? 'C:\\' : '/';
        const st = await fsP.statfs(drive);
        disk = {
          total:   st.blocks * st.bsize,
          free:    st.bfree  * st.bsize,
          percent: Math.round((1 - st.bfree / st.blocks) * 100),
        };
      }
    } catch { /* statfs no disponible */ }

    const up = os.uptime();
    return {
      cpu: {
        percent: cpuPercent,
        model:   cpuInfo?.model || 'N/A',
        speed:   cpuInfo?.speed || 0,
        cores:   os.cpus().length,
      },
      ram: {
        percent: Math.round(usedMem / totalMem * 100),
        total:   totalMem,
        used:    usedMem,
        free:    freeMem,
      },
      disk,
      uptime: {
        hours:   Math.floor(up / 3600),
        minutes: Math.floor((up % 3600) / 60),
        seconds: Math.floor(up % 60),
      },
      platform: os.platform(),
      hostname: os.hostname(),
      processes: {
        express:    true,
        websocket:  true,
        adb:        true,
        sqlite:     true,
      },
    };
  });

  ipcMain.handle('admin:getConnectedUsers', () => {
    try { return getConnectedClients(); } catch { return []; }
  });

  ipcMain.handle('admin:getGlobalMetrics', (_, opts = {}) => {
    try { return getMetricasEquipo(opts); } catch { return null; }
  });

  ipcMain.handle('admin:getUsers', () => {
    // Panel del admin del sistema → ve la lista completa (incluye la cuenta admin).
    try { return getAllUsuariosAdmin('admin'); } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('admin:createUser', async (_, { nombre, email, password, rol, supervisor_id }) => {
    try {
      if (!nombre || !email || !password || !rol) return { error: 'Campos requeridos' };
      const hash = await bcrypt.hash(password, 10);
      const result = insertAsesor({ nombre, email, passwordHash: hash, rol, supervisorId: supervisor_id ?? null });
      return { success: true, id: result.lastInsertRowid };
    } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('admin:updateUser', (_, { id, nombre, email, rol, estado, supervisor_id }) => {
    try {
      const payload = { nombre, email, rol, estado };
      if (supervisor_id !== undefined) payload.supervisorId = supervisor_id != null ? Number(supervisor_id) : null;
      updateUsuarioAdmin(id, payload);
      return { success: true };
    } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('admin:toggleUser', (_, id) => {
    try { return toggleUsuarioEstado(id); } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('admin:changePassword', async (_, { id, password }) => {
    try {
      if (!password || password.length < 6) return { error: 'Contraseña mínimo 6 caracteres' };
      const hash = await bcrypt.hash(password, 10);
      changePasswordAdmin(id, hash);
      return { success: true };
    } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('admin:openSupervisor', () => {
    try {
      console.log('[DEBUG] admin:openSupervisor called. windowManager:', !!windowManager);
      if (windowManager) {
        const win = windowManager.createSupervisorWindow();
        console.log('[DEBUG] createSupervisorWindow returned:', !!win);
      }
      return { success: true };
    } catch (err) { 
      console.error('[DEBUG] Error in admin:openSupervisor:', err);
      return { error: err.message }; 
    }
  });

  // ── ADMIN: Configuración de BD dual-mode ───────────────────────

  ipcMain.handle('admin:getDbConfig', () => {
    return {
      mode:     getConfig('admin_db_mode')    || 'local',
      vmUrl:    getConfig('admin_vm_url')     || '',
      vmToken:  getConfig('admin_vm_token')   || '',
      pgString: getConfig('admin_pg_string')  || '',
    };
  });

  ipcMain.handle('admin:setDbConfig', (_, cfg) => {
    try {
      if (cfg.mode     !== undefined) setConfig('admin_db_mode',   cfg.mode);
      if (cfg.vmUrl    !== undefined) setConfig('admin_vm_url',    cfg.vmUrl);
      if (cfg.vmToken  !== undefined) setConfig('admin_vm_token',  cfg.vmToken);
      if (cfg.pgString !== undefined) setConfig('admin_pg_string', cfg.pgString);
      return { success: true };
    } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('admin:testVmConnection', async (_, { vmUrl, vmToken } = {}) => {
    if (!vmUrl) return { ok: false, error: 'URL requerida' };
    try {
      const http   = require('http');
      const https  = require('https');
      const target = `${vmUrl.replace(/\/$/, '')}/api/health`;
      const parsed = new URL(target);
      const proto  = parsed.protocol === 'https:' ? https : http;
      const start  = Date.now();
      return await new Promise((resolve) => {
        const req = proto.get(target, {
          headers: vmToken ? { Authorization: `Bearer ${vmToken}` } : {},
          timeout: 6000,
        }, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            resolve({ ok: res.statusCode < 400, status: res.statusCode, ms: Date.now() - start, body: body.slice(0, 300) });
          });
        });
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout (6s)' }); });
        req.on('error',   e => resolve({ ok: false, error: e.message }));
      });
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('admin:vmLogin', async (_, { vmUrl, email, password } = {}) => {
    if (!vmUrl || !email || !password) return { ok: false, error: 'Campos requeridos' };
    try {
      const http   = require('http');
      const https  = require('https');
      const target = `${vmUrl.replace(/\/$/, '')}/api/auth/login`;
      const parsed = new URL(target);
      const proto  = parsed.protocol === 'https:' ? https : http;
      const body   = JSON.stringify({ email, password });
      return await new Promise((resolve) => {
        const req = proto.request({
          hostname: parsed.hostname,
          port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 3001),
          path:     parsed.pathname,
          method:   'POST',
          headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          timeout:  8000,
        }, (res) => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.token) {
                setConfig('admin_vm_token', json.token);
                resolve({ ok: true, token: json.token, usuario: json.usuario });
              } else {
                resolve({ ok: false, error: json.error || 'Sin token en respuesta' });
              }
            } catch { resolve({ ok: false, error: 'Respuesta inválida del servidor' }); }
          });
        });
        req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout (8s)' }); });
        req.on('error', e => resolve({ ok: false, error: e.message }));
        req.write(body);
        req.end();
      });
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = { registerIpcHandlers };
