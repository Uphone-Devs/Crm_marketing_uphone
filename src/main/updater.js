/**
 * updater.js — Auto-update con electron-updater, restringido a ventana horaria.
 * Solo activo en app empaquetada. El renderer pasa `apiBase` tras login (startUpdater).
 * Cada ciclo lee la política del backend y, si estamos dentro de la ventana,
 * dispara checkForUpdates(). Al descargar, avisa al renderer (updater:downloaded).
 */
const { app, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const { isDentroDeVentana } = require('./updateWindow');

let apiBase = null;      // ej. http://127.0.0.1:3001/api
let timer = null;
let intervalMin = 30;

function log(...args) {
  console.log('[UPDATER]', ...args);
}

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  });
}

async function fetchPolicy() {
  const res = await fetch(`${apiBase}/admin/update-policy`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function tick() {
  try {
    const policy = await fetchPolicy();
    if (Number.isInteger(policy.checkIntervalMin) && policy.checkIntervalMin > 0) {
      // Reprograma el timer si cambió el intervalo.
      if (policy.checkIntervalMin !== intervalMin) {
        intervalMin = policy.checkIntervalMin;
        reschedule();
      }
    }
    if (isDentroDeVentana(new Date(), policy)) {
      log('Dentro de ventana → checkForUpdates');
      autoUpdater.checkForUpdates().catch((e) => log('checkForUpdates error:', e.message));
    } else {
      log('Fuera de ventana → skip');
    }
  } catch (err) {
    log('tick error (skip ciclo):', err.message);
  }
}

function reschedule() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, intervalMin * 60 * 1000);
}

/** Llamado vía IPC desde el renderer tras login. */
function startUpdater(base) {
  if (!app.isPackaged) {
    log('Dev mode → updater desactivado');
    return;
  }
  apiBase = base;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // el usuario controla el reinicio

  autoUpdater.removeAllListeners();
  autoUpdater.on('update-downloaded', (info) => {
    log('update-downloaded', info.version);
    broadcast('updater:downloaded', { version: info.version });
  });
  autoUpdater.on('error', (err) => log('autoUpdater error:', err.message));

  reschedule();
  tick(); // primer chequeo inmediato
}

function restartNow() {
  autoUpdater.quitAndInstall();
}

function stopUpdater() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startUpdater, restartNow, stopUpdater };
