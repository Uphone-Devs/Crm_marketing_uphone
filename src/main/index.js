/**
 * index.js — Entry point del main process de Electron.
 *
 * Flujo de arranque:
 *   1. initDatabase() → better-sqlite3 (WAL mode, auto-seed)
 *   2. registerIpcHandlers() → canales IPC para renderer
 *   3. initApiServer(3001) → Express REST + WebSocket (un solo puerto)
 *   4. createSupervisorWindow() → ventana principal
 *
 * Un solo servidor en puerto 3001 maneja REST API + WebSocket.
 */

// ── Load environment variables (MUST be before any other imports) ──
require('dotenv').config();

const { app, BrowserWindow } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const { initDatabase, closeDb } = require('./database/db');
const { registerIpcHandlers } = require('./ipcHandlers');
const { initApiServer, stopApiServer } = require('./apiServer');
const { stopWebSocketServer } = require('./wsServer');
const { stopAll: stopAdbProcesses } = require('./adbManager');
const { initScheduler, stopScheduler } = require('./scheduler');
const { createLoginWindow } = require('./windowManager');

/**
 * Agrega una regla de Firewall de Windows para permitir conexiones entrantes
 * en el puerto 3001 (REST API + WebSocket). Necesario para que las PCs Asesor
 * puedan conectarse a esta PC cuando actúa como Supervisor.
 * Best-effort: si no hay privilegios de admin, falla silenciosamente.
 */
// ── Backend PostgreSQL auto-start ────────────────────────────────
let backendProcess = null;
let backendStopping = false;   // true cuando stopBackend() fue llamado — no reiniciar
let backendRestartDelay = 2000; // ms; se duplica en cada fallo hasta MAX
const BACKEND_RESTART_MAX = 30000;

function startBackend() {
  if (backendStopping) return;

  const backendDir   = path.join(__dirname, '../../backend');
  const backendEntry = path.join(backendDir, 'src/index.js');

  backendProcess = spawn('node', ['--max-old-space-size=512', backendEntry], {
    cwd: backendDir,
    env: { ...process.env },
    stdio: 'pipe',
    windowsHide: true,
  });

  // Redirigir stdout/stderr del backend al proceso principal para que aparezca en logs
  backendProcess.stdout?.on('data', d => process.stdout.write(d));
  backendProcess.stderr?.on('data', d => process.stderr.write(d));

  backendProcess.on('error', (err) => {
    console.error('[BACKEND] Error al iniciar proceso:', err.message);
  });

  backendProcess.on('close', (code) => {
    console.log(`[BACKEND] Proceso terminado (código ${code})`);
    backendProcess = null;
    if (backendStopping) return;
    console.log(`[BACKEND] Reiniciando en ${backendRestartDelay / 1000}s…`);
    setTimeout(() => {
      backendRestartDelay = Math.min(backendRestartDelay * 2, BACKEND_RESTART_MAX);
      startBackend();
    }, backendRestartDelay);
  });

  console.log('[BACKEND] Iniciado — PID:', backendProcess.pid);
  backendRestartDelay = 2000; // reset al arrancar exitosamente
}

function stopBackend() {
  backendStopping = true;
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
    console.log('[BACKEND] Proceso detenido');
  }
}

function ensureFirewallRule() {
  if (process.platform !== 'win32') return;
  const ruleName = 'Terminal UPHONE Puerto 3001';
  exec(
    `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=3001 enable=yes`,
    (err) => {
      if (err) {
        console.warn('[APP] [WARN] No se pudo agregar regla de firewall (se requieren permisos de administrador):', err.message);
      } else {
        console.log('[APP] [OK] Regla de firewall para puerto 3001 verificada');
      }
    }
  );
}

// Deshabilitar Autofill para evitar errores de consola
app.commandLine.appendSwitch('disable-features', 'Autofill');

app.whenReady().then(() => {
  // ── 1. Base de datos ──────────────────────────────────────
  try {
    initDatabase();
    console.log('[APP] [OK] Base de datos inicializada');
  } catch (err) {
    console.error('[APP] [FATAL] No se pudo inicializar la base de datos:', err.message);
    // Mostrar un dialogo nativo antes de salir
    const { dialog } = require('electron');
    dialog.showErrorBox(
      'Error crítico — Base de datos',
      `No se pudo inicializar la base de datos local.\n\nDetalle: ${err.message}\n\nLa aplicación se cerrará.`
    );
    app.quit();
    return;          // detener el resto de la secuencia de arranque
  }

  // ── 1b. Scheduler de agendamientos ────────────────────
  try {
    initScheduler();
    console.log('[APP] [OK] Scheduler de agendamientos iniciado');
  } catch (err) {
    console.error('[APP] [FAIL] Error scheduler:', err.message);
  }

  // ── 2. Handlers IPC ───────────────────────────────────
  registerIpcHandlers();
  console.log('[APP] [OK] IPC handlers registrados');

  // ── 3. Backend PostgreSQL — arranca automáticamente ──────────
  try {
    startBackend();
    console.log('[APP] [OK] Backend PostgreSQL arrancando...');
  } catch (err) {
    console.error('[APP] [WARN] No se pudo iniciar backend:', err.message);
  }

  // ── 3b. Firewall Windows — abrir puerto 3001 para LAN ─────────
  ensureFirewallRule();

  // ── 4. Ventana de inicio (Login) ─────────────────────
  createLoginWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createLoginWindow();
    }
  });
});

// ── Limpieza al cerrar ────────────────────────────────────
app.on('will-quit', () => {
  console.log('[APP] Cerrando — limpiando procesos...');
  stopBackend();
  stopScheduler();
  try { require('./updater').stopUpdater(); } catch {}
  stopAdbProcesses();
  stopWebSocketServer();
  stopApiServer();
  closeDb();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
