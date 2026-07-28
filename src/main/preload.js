const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, ...args) => {
    const allowedChannels = [
      // Auth
      'auth:login',
      // ADB & Device
      'adb:devices', 'adb:getDevices', 'adb:connectUSB', 'adb:connectWifi', 'adb:stop',
      'adb:getDeviceStats', 'adb:getMPH', 'adb:getROI', 'adb:dial',
      'adb:hangup', 'adb:toggleHold', 'adb:toggleMute', 'adb:toggleSpeaker',
      'adb:startRecordOnDevice', 'adb:checkCallStatus', 'adb:isScrcpyRunning', 'adb:sendSMS', 'adb:openWhatsApp', 'adb:whatsappCall', 'adb:stopAll',
      'adb:pinDevice', 'adb:getPinnedSlots', 'adb:setDeviceOrderInverted', 'adb:getDeviceOrderInverted',
      // Audio
      'audio:start', 'audio:stop', 'audio:status',
      // Recorder
      'recorder:devices', 'recorder:setDevice', 'recorder:start', 'recorder:stop', 'recorder:status',
      'recorder:getBuffer',
      // DB: Usuarios
      'db:getAsesores', 'db:getAllUsuarios', 'db:insertAsesor', 'db:updateAsesor', 'db:deleteAsesor', 'db:anonymizeAsesor',
      // DB: Campañas
      'db:getCampanas', 'db:getCampana', 'db:getSiguienteContacto', 'db:insertCampana', 'db:insertContactos',
      'db:getContactoById',
      'db:getCampaignSummary', 'db:getCampanasDashboard', 'db:deleteCampana', 'db:deleteContactosPorAsesor', 'db:getProgresoCampana',
      'db:incrementarIntentoContacto', 'db:resetearIntentosContacto',
      // DB: CDRs
      'db:insertCdr', 'db:updateCdr', 'db:marcarContactoGestionado', 'db:marcarYaPago', 'db:getCdrs', 'db:getCdrsByContacto', 'db:getSubGestionesByAsesor', 'db:getBitacoraAsesor', 'db:getRefsBitacora', 'db:getCarteraAsesor', 'db:getCarteraFiltradaAsesor', 'db:getCarteraEquipo', 'cartera:reordenar', 'db:insertSubGestion', 'db:getSubGestionesByContacto', 'db:buscarContactoPorCedula', 'db:getAllReferencias', 'db:getAllCdrs',
      'db:toggleContactoMensajeria', 'db:getLoteMensajeria', 'db:marcarLoteEnviado',
      // DB: Tipificaciones
      'db:getTipificaciones',
      // DB: CDRs Tipificar (M-004)
      'cdrs:tipificar',
      // DB: Contactabilidad (M-004)
      'db:getContactabilidadDia',
      // DB: Agendamientos (M-006)
      'db:insertAgendamiento', 'db:getAgendamientosPendientes', 'db:cancelarAgendamiento',
      // DB: Eventos
      'db:insertEvento', 'db:getEventosDia',
      // DB: Compromisos
      'db:eliminarCompromiso', 'db:confirmarPagoCompromiso', 'db:reagendarCompromiso', 'db:marcarCompromisoIncumplido',
      // DB: Métricas
      'db:getMetricasDia', 'db:getMetricasEquipo', 'db:getCompromisosEquipo', 'db:getProgresoAsesor', 'db:getDetalleContactabilidad',
      // DB: Evolución de Cartera
      'db:getCarteraAnalisis', 'db:getCarteraRefinanciada', 'db:getMetadataKeys',
      'db:getGestionesAsesores', 'db:upsertMetaAsesor', 'db:getRotacionCarteraPeriodo',
      // Validación de Pagos
      'validacion:correlacionar', 'validacion:confirmarPagos', 'validacion:getMetricas',
      'validacion:getHistorial', 'validacion:revertir',
      'validacion:getSesiones', 'validacion:eliminarSesion',
      // DB: Config & Indicadores
      'db:getConfig', 'db:setConfig', 'db:getAllConfig',
      'db:getIndicadoresConfig', 'db:saveIndicadoresConfig',
      'db:getIndicadoresRecaudo', 'db:saveIndicadoresRecaudo',
      'db:getProyeccionMensual', 'db:getIndicadoresCobranza', 'db:getMetaDiariaCampanas',
      // DB: Ranking de Gestores
      'db:getRankingGestores', 'db:getRankingLlamadas', 'db:getRankingGeneralAsesores',
      // DB: Mensajes Broadcast & Segmentos
      'db:getSegmentos', 'db:insertSegmento',
      'db:insertMensajeBroadcast', 'db:getMensajesBroadcast', 'db:deleteMensajeBroadcast',
      // System
      'reports:generate', 'shell:openPath', 'shell:openExternal', 'app:switch-role', 'app:logout',
      'ws:notifyCarteraAsignada',
      // Admin
      'admin:getSystemInfo', 'admin:getConnectedUsers', 'admin:getGlobalMetrics',
      'admin:getUsers', 'admin:createUser', 'admin:updateUser', 'admin:toggleUser',
      'admin:changePassword', 'admin:openSupervisor',
      'admin:getDbConfig', 'admin:setDbConfig', 'admin:testVmConnection', 'admin:vmLogin',
      // Auto-update
      'updater:start', 'updater:restartNow',
    ];
    if (allowedChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`Canal IPC no permitido: ${channel}`));
  },

  on: (channel, callback) => {
    const allowedChannels = ['audio:chunk', 'audio:error', 'agendamiento:aviso', 'agendamiento:ejecutar', 'agendamiento:aviso_pmp', 'promesa:aviso_supervisor', 'ws:message', 'updater:downloaded'];
    if (allowedChannels.includes(channel)) {
      const subscription = (event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    console.warn(`Canal IPC no permitido: ${channel}`);
    return () => {};
  },

  removeAllListeners: (channel) => {
    const allowedChannels = ['audio:chunk', 'audio:error', 'agendamiento:aviso', 'agendamiento:ejecutar', 'agendamiento:aviso_pmp', 'promesa:aviso_supervisor', 'ws:message', 'updater:downloaded'];
    if (allowedChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  }
});
