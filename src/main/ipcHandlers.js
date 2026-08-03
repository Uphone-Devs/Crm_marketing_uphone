/**
 * ipcHandlers.js — Canales IPC entre main process y renderer.
 *
 * Solo cubre hardware local (ADB, audio, recorder) y gestión de ventanas.
 * Toda la lógica de negocio va por HTTP al backend PostgreSQL (puerto 3002).
 */

require('dotenv').config();

const { ipcMain, shell, BrowserWindow } = require('electron');
const fs = require('fs');

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
  openWhatsApp,
  whatsappCall,
  pinDevice,
  getPinnedSlots,
  setDeviceOrderInverted,
  getDeviceOrderInverted,
} = require('./adbManager');

const { startCapture, stopCapture, isCapturing } = require('./audioManager');
const recorder = require('./ffmpeg.recorder');
const { getLocalConfig, setLocalConfig } = require('./localConfig');

let windowManager = null;

try {
  windowManager = require('./windowManager');
} catch (e) {
  console.error('[DEBUG] Error al cargar windowManager:', e);
}

function registerIpcHandlers() {
  // ── ADB & DISPOSITIVO ────────────────────────────────────
  ipcMain.handle('adb:devices',              async () => getDevices());
  ipcMain.handle('adb:getDevices',           async () => getDevices());
  ipcMain.handle('adb:connectUSB',           async () => connectUSB_Bat());
  ipcMain.handle('adb:connectWifi',          async (event, ip) => connectWifi_Bat(ip));
  ipcMain.handle('adb:stats',                async () => getDeviceStats());
  ipcMain.handle('adb:getDeviceStats',       async () => getDeviceStats());
  ipcMain.handle('adb:dial',                 async (event, num, deviceIndex) => dial(num, deviceIndex || 0));
  ipcMain.handle('adb:hangup',               async () => hangup());
  ipcMain.handle('adb:toggleHold',           async () => toggleHold());
  ipcMain.handle('adb:toggleMute',           async () => toggleMute());
  ipcMain.handle('adb:toggleSpeaker',        async (event, state) => toggleSpeaker(state));
  ipcMain.handle('adb:startRecordOnDevice',  async (event, isCurrentlyRecording) => startRecordOnDevice(isCurrentlyRecording));
  ipcMain.handle('adb:checkCallStatus',      async () => checkCallStatus());
  ipcMain.handle('adb:isScrcpyRunning',      async () => isScrcpyRunning());
  ipcMain.handle('adb:stopAll',              async () => { stopAll(); return { success: true }; });
  ipcMain.handle('adb:stop',                 async () => { stopAll(); return { success: true }; });
  ipcMain.handle('adb:sendSMS',              async (event, phoneNumber, message) => sendSMS(phoneNumber, message));
  ipcMain.handle('adb:openWhatsApp',         async (event, phoneNumber, message) => openWhatsApp(phoneNumber, message));
  ipcMain.handle('adb:whatsappCall',         async (event, phoneNumber, deviceIndex) => whatsappCall(phoneNumber, deviceIndex == null ? 1 : deviceIndex));
  ipcMain.handle('adb:pinDevice',            async (event, serial, slotIndex) => pinDevice(serial, slotIndex));
  ipcMain.handle('adb:getPinnedSlots',       async () => getPinnedSlots());
  ipcMain.handle('adb:setDeviceOrderInverted', async (event, inverted) => setDeviceOrderInverted(inverted));
  ipcMain.handle('adb:getDeviceOrderInverted', async () => getDeviceOrderInverted());

  // ── AUDIO ──────────────────────────────────────────────────
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

  ipcMain.handle('audio:stop',   async () => { stopCapture(); return { success: true }; });
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
  ipcMain.handle('recorder:stop',   async () => await recorder.detenerGrabacion());
  ipcMain.handle('recorder:status', async () => ({
    grabando:      recorder.isGrabando(),
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

  // ── SHELL ──────────────────────────────────────────────
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

  // ── WINDOW MANAGEMENT ──────────────────────────────────
  ipcMain.handle('app:switch-role', async (event, rol) => {
    if (!windowManager) return { error: 'WindowManager no disponible' };

    console.log(`[APP] [INFO] Cambiando a rol: ${rol}`);

    if (rol === 'admin') {
      windowManager.createAdminWindow();
    } else if (rol === 'supervisor' || rol === 'jefe_area' || rol === 'jefe' || rol === 'ADMINISTRADOR' || rol === 'SUPERVISOR') {
      windowManager.createSupervisorWindow();
    } else {
      windowManager.createAsesorWindow();
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();

    return { success: true };
  });

  ipcMain.handle('app:logout', async (event) => {
    const { createLoginWindow } = require('./windowManager');
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.close();
      createLoginWindow();
    }
  });

  // ── ADMIN: Info del sistema (OS, sin BD) ──────────────
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
    };
  });

  ipcMain.handle('admin:openSupervisor', () => {
    try {
      if (windowManager) windowManager.createSupervisorWindow();
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── ADMIN: Configuración de conexión VM ────────────────
  ipcMain.handle('admin:getDbConfig', () => ({
    mode:     getLocalConfig('admin_db_mode')   || 'local',
    vmUrl:    getLocalConfig('admin_vm_url')    || '',
    vmToken:  getLocalConfig('admin_vm_token')  || '',
    pgString: getLocalConfig('admin_pg_string') || '',
  }));

  ipcMain.handle('admin:setDbConfig', (_, cfg) => {
    try {
      if (cfg.mode     !== undefined) setLocalConfig('admin_db_mode',   cfg.mode);
      if (cfg.vmUrl    !== undefined) setLocalConfig('admin_vm_url',    cfg.vmUrl);
      if (cfg.vmToken  !== undefined) setLocalConfig('admin_vm_token',  cfg.vmToken);
      if (cfg.pgString !== undefined) setLocalConfig('admin_pg_string', cfg.pgString);
      const supWin = windowManager?.getSupervisorWindow?.();
      if (supWin && !supWin.isDestroyed()) supWin.webContents.reload();
      return { success: true };
    } catch (err) { return { error: err.message }; }
  });

  ipcMain.handle('admin:testVmConnection', async (_, { vmUrl, vmToken } = {}) => {
    if (!vmUrl) return { ok: false, error: 'URL requerida' };
    try {
      const http   = require('http');
      const https  = require('https');
      const target = `${vmUrl.replace(/\/$/, '')}/health`;
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
                setLocalConfig('admin_vm_token', json.token);
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

  // ── Auto-update ────────────────────────────────────────
  const { startUpdater, restartNow } = require('./updater');
  ipcMain.handle('updater:start', (_, { apiBase } = {}) => {
    try { startUpdater(apiBase); return { ok: true }; }
    catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('updater:restartNow', () => {
    try { restartNow(); return { ok: true }; }
    catch (err) { return { error: err.message }; }
  });
}

module.exports = { registerIpcHandlers };
