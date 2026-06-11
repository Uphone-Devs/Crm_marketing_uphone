const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let asesorWin = null;
let supervisorWin = null;
let adminWin = null;
let selectorWin = null;
let loginWin = null;

function createLoginWindow() {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return loginWin;
  }

  loginWin = new BrowserWindow({
    width: 450,
    height: 700,
    resizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    title: 'UPHONE — Inicio de Sesión',
    backgroundColor: '#131313'
  });

  // Quitar menú en login para un look limpio
  loginWin.setMenuBarVisibility(false);

  if (process.env.NODE_ENV === 'development') {
    const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    loginWin.loadURL(`${devUrl}/login/index.html`);
  } else {
    loginWin.loadFile(path.join(__dirname, '..', '..', 'out', 'renderer', 'login', 'index.html'));
  }

  loginWin.on('closed', () => { loginWin = null; });
  return loginWin;
}

function createSelectorWindow() {
  selectorWin = new BrowserWindow({
    width: 500,
    height: 380,
    resizable: false,
    frame: false,
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    title: 'Terminal de Cobranza'
  });

  if (process.env.NODE_ENV === 'development') {
    const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    selectorWin.loadURL(`${devUrl}/selector/index.html`);
  } else {
    selectorWin.loadFile(path.join(__dirname, '..', '..', 'out', 'renderer', 'selector', 'index.html'));
  }

  return selectorWin;
}

function createAsesorWindow() {
  if (asesorWin && !asesorWin.isDestroyed()) {
    asesorWin.focus();
    return asesorWin;
  }

  asesorWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    title: 'Terminal de Cobranza — Asesor',
    backgroundColor: '#131313'
  });

  if (process.env.NODE_ENV === 'development') {
    const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    asesorWin.loadURL(`${devUrl}/asesor/index.html`);
    asesorWin.webContents.openDevTools();
  } else {
    asesorWin.loadFile(path.join(__dirname, '..', '..', 'out', 'renderer', 'asesor', 'index.html'));
  }

  asesorWin.on('closed', () => { asesorWin = null; });
  // Restaurar foco de teclado al renderer cuando el OS devuelve foco a la ventana
  // (e.g. después de shell:openExternal que abre WhatsApp/Gmail/SMS)
  asesorWin.on('focus', () => { asesorWin.webContents.focus(); });
  return asesorWin;
}

function createSupervisorWindow() {
  if (supervisorWin && !supervisorWin.isDestroyed()) {
    supervisorWin.focus();
    return supervisorWin;
  }

  supervisorWin = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    title: 'Terminal de Cobranza — Supervisor',
    backgroundColor: '#131313'
  });

  if (process.env.NODE_ENV === 'development') {
    const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    supervisorWin.loadURL(`${devUrl}/supervisor/index.html`);
    supervisorWin.webContents.openDevTools();
  } else {
    supervisorWin.loadFile(path.join(__dirname, '..', '..', 'out', 'renderer', 'supervisor', 'index.html'));
  }

  supervisorWin.on('closed', () => { supervisorWin = null; });
  // Restaurar foco de teclado al renderer cuando el OS devuelve foco a la ventana
  supervisorWin.on('focus', () => { supervisorWin.webContents.focus(); });
  return supervisorWin;
}

function createAdminWindow() {
  if (adminWin && !adminWin.isDestroyed()) {
    adminWin.focus();
    return adminWin;
  }

  adminWin = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    title: 'UPHONE — Administrador del Sistema',
    backgroundColor: '#0f1117'
  });

  if (process.env.NODE_ENV === 'development') {
    const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
    adminWin.loadURL(`${devUrl}/admin/index.html`);
    adminWin.webContents.openDevTools();
  } else {
    adminWin.loadFile(path.join(__dirname, '..', '..', 'out', 'renderer', 'admin', 'index.html'));
  }

  adminWin.on('closed', () => { adminWin = null; });
  return adminWin;
}

function getAsesorWindow() { return asesorWin; }
function getSupervisorWindow() { return supervisorWin; }
function getAdminWindow() { return adminWin; }

module.exports = {
  createLoginWindow,
  createSelectorWindow,
  createAsesorWindow,
  createSupervisorWindow,
  createAdminWindow,
  getAsesorWindow,
  getSupervisorWindow,
  getAdminWindow,
};
