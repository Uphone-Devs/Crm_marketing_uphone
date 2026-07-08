const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { app } = require('electron');
const { isInfinixDevice, getInfinixGuide, getScrcpyFlags } = require('./device/InfinixCompat');

let childProcesses = [];
let _cachedScrcpyFolder = null; // Cache para evitar log spam

function resolveAdbPath() {
  const isDev = !require('electron').app.isPackaged;
  const root = isDev ? process.cwd() : path.join(process.resourcesPath, 'app.asar.unpacked');
  
  const paths = [
    path.join(root, 'scrcpy-win64-v3.1', 'adb.exe'),
    path.join(root, 'adb', 'adb.exe'),
    'adb'
  ];

  for (const p of paths) {
    if (p === 'adb' || fs.existsSync(p)) return p;
  }
  return 'adb';
}

function getScrcpyFolderPath() {
  if (_cachedScrcpyFolder !== null) return _cachedScrcpyFolder;

  const root = app.getAppPath();
  const cwd = process.cwd();
  
  const paths = [
    // Producción: electron-builder coloca extraResources aquí
    path.join(process.resourcesPath || '', 'scrcpy-win64-v3.1'),
    // Desarrollo: carpeta en la raíz del proyecto
    path.join(cwd, 'scrcpy-win64-v3.1'),
    path.join(root, 'scrcpy-win64-v3.1'),
    path.join(root, '..', 'scrcpy-win64-v3.1'),
    path.join(path.dirname(root), 'scrcpy-win64-v3.1'),
  ];

  for (const p of paths) {
    if (p && fs.existsSync(p)) {
      console.log(`[ADB] Carpeta scrcpy encontrada: ${p}`);
      _cachedScrcpyFolder = p;
      return p;
    }
  }
  
  console.warn('[ADB] ⚠ No se encontró carpeta scrcpy en ninguna ruta:', paths);
  _cachedScrcpyFolder = '';
  return '';
}

function runAdb(args) {
  return new Promise((resolve, reject) => {
    try {
      const scrcpyFolder = getScrcpyFolderPath();
      const adbCmd = scrcpyFolder ? path.join(scrcpyFolder, 'adb.exe') : 'adb';
      const command = adbCmd.includes(' ') ? `"${adbCmd}"` : adbCmd;

      const proc = spawn(command, args, { 
        shell: true,
        env: { ...process.env, PATH: scrcpyFolder ? (scrcpyFolder + ';' + process.env.PATH) : process.env.PATH } 
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      
      proc.on('close', code => {
        if (code === 0 || stdout.trim().length > 0) resolve(stdout);
        else reject(new Error(stderr || `ADB salió con código ${code}`));
      });
      
      proc.on('error', err => reject(err));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Ejecuta un comando ADB con timeout.
 * Previene que conexiones colgadas bloqueen el polling.
 */
function runAdbWithTimeout(args, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`ADB timeout después de ${timeoutMs}ms`));
    }, timeoutMs);

    runAdb(args)
      .then(result => { clearTimeout(timer); resolve(result); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Ejecuta un comando ADB shell de forma tolerante.
 * Los comandos como `input keyevent` y `cmd telecom` frecuentemente
 * escriben a stderr o retornan código no-0 aun siendo exitosos.
 * Esta función NUNCA rechaza — siempre resuelve con { output, error, code }.
 */
function runAdbShell(args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    try {
      const scrcpyFolder = getScrcpyFolderPath();
      const adbCmd = scrcpyFolder ? path.join(scrcpyFolder, 'adb.exe') : 'adb';
      const command = adbCmd.includes(' ') ? `"${adbCmd}"` : adbCmd;

      const proc = spawn(command, args, {
        shell: true,
        env: { ...process.env, PATH: scrcpyFolder ? (scrcpyFolder + ';' + process.env.PATH) : process.env.PATH }
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });

      const timer = setTimeout(() => {
        try { proc.kill(); } catch {}
        resolve({ output: stdout, error: 'timeout', code: -1 });
      }, timeoutMs);

      proc.on('close', code => {
        clearTimeout(timer);
        const combined = (stdout + stderr).toLowerCase();
        const hasError = combined.includes('exception') || combined.includes('not found') || combined.includes('no call');
        resolve({ output: stdout, error: hasError ? stderr.trim() : null, code });
      });

      proc.on('error', err => {
        clearTimeout(timer);
        resolve({ output: '', error: err.message, code: -1 });
      });
    } catch (err) {
      resolve({ output: '', error: err.message, code: -1 });
    }
  });
}

function parseDevices(output) {
  if (!output) return [];
  const lines = output.split(/\r?\n/).slice(1);
  const devices = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('*')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && parts[1] === 'device') {
      const serial = parts[0];
      const modelMatch = trimmed.match(/model:(\S+)/);
      const model = modelMatch ? modelMatch[1].replace(/_/g, ' ') : 'Desconocido';
      const isWifi = serial.includes(':');
      devices.push({
        serial,
        status: parts[1],
        model,
        isWifi,
        ip: isWifi ? serial.split(':')[0] : null,
        isInfinix: isInfinixDevice(model)
      });
    }
  }
  return devices;
}

// ═══════════════════════════════════════════════════════════════
// DETECCIÓN DE SCRCPY
// ═══════════════════════════════════════════════════════════════

/**
 * Verifica si scrcpy.exe está corriendo en el sistema operativo.
 * Usado para determinar si la proyección del celular está activa.
 */
function isScrcpyRunning() {
  return new Promise(resolve => {
    try {
      const proc = spawn('tasklist', ['/FI', 'IMAGENAME eq scrcpy.exe', '/NH'], { shell: true });
      let output = '';
      proc.stdout.on('data', d => { output += d.toString(); });
      proc.on('close', () => resolve(output.toLowerCase().includes('scrcpy.exe')));
      proc.on('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// CONSULTAS DE ESTADO
// ═══════════════════════════════════════════════════════════════

async function getDevices() {
  try {
    const output = await runAdb(['devices', '-l']);
    return { success: true, devices: parseDevices(output) };
  } catch (err) {
    return { success: false, error: err.message, devices: [] };
  }
}

async function getDeviceStats() {
  try {
    // Verificar si scrcpy está proyectando
    const scrcpyActive = await isScrcpyRunning();

    const devicesOut = await runAdbWithTimeout(['devices', '-l'], 3000);
    const devices = parseDevices(devicesOut);
    
    if (devices.length === 0) {
      return { connected: false, scrcpyActive: false };
    }

    const serial = devices[0].serial;

    // Heartbeat: confirmar que el dispositivo responde
    try {
      await runAdbWithTimeout(['-s', serial, 'shell', 'echo', 'OK'], 2000);
    } catch {
      return { connected: false, scrcpyActive };
    }

    return {
      connected: true, // El dispositivo está conectado y responde
      deviceReady: true,       
      scrcpyActive,
      serial,
      model: devices[0].model,
    };
  } catch (err) {
    return { connected: false, scrcpyActive: false };
  }
}

// ═══════════════════════════════════════════════════════════════
// CONEXIÓN BAT FILES
// ═══════════════════════════════════════════════════════════════

async function connectUSB_Bat() {
  try {
    const scrcpyFolder = getScrcpyFolderPath();
    if (!scrcpyFolder) throw new Error('No se encontró la carpeta scrcpy-win64-v3.1');
    const batName = 'CONEXION VIA USB.bat';
    const batPath = path.join(scrcpyFolder, batName);
    
    if (!fs.existsSync(batPath)) {
      throw new Error(`No se encontró el archivo ${batName} en ${scrcpyFolder}`);
    }

    // Usamos 'start' para abrir una nueva ventana de CMD visible,
    // permitiendo al usuario ver el prompt de autorización ADB
    // y aceptar la huella digital en el celular.
    const proc = spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/c', `"${batName}"`], {
      cwd: scrcpyFolder,
      shell: true,
      detached: true,
      stdio: 'ignore',
    });

    proc.unref(); 
    return { success: true };
  } catch (err) {
    console.error('[ADB] Error fatal al lanzar USB.bat:', err.message);
    return { success: false, error: err.message };
  }
}

async function connectWifi_Bat(ip) {
  try {
    const scrcpyFolder = getScrcpyFolderPath();
    if (!scrcpyFolder) throw new Error('No se encontró la carpeta scrcpy-win64-v3.1');
    if (!ip) throw new Error("Se requiere una dirección IP para la conexión WiFi.");
    
    const batName = 'connect_wifi_temp.bat';
    const batPath = path.join(scrcpyFolder, batName);
    
    const batContent = `@echo off
title Sistema de Monitoreo - Gestion de Cobranza (WIFI)
color 0b

echo ======================================================
echo    INICIANDO TERMINAL DE COBRANZA - UPHONE TEC SAS
echo ======================================================
echo.
echo [+] Configurando conexion para el dispositivo: ${ip}
echo [+] Configurando el puerto 5555 en el dispositivo...
echo.

:: Se requiere que el dispositivo este temporalmente conectado por USB 
:: para configurar el puerto antes de pasar a modo inalambrico.
adb tcpip 5555

echo.
echo [+] Esperando reinicio del servicio ADB en modo TCP/IP...
timeout /t 3 /nobreak >nul

echo [+] Conectando por via inalambrica...
adb connect ${ip}:5555

echo.
echo ------------------------------------------------------
echo [+] ESTADO: Conectando a Celular...
echo [+] Optimizando transmision para Red Wi-Fi...
echo ------------------------------------------------------
echo.

scrcpy -s ${ip}:5555 --video-bit-rate 2M --max-size 1024 --max-fps 30 --window-title "Terminal de Cobranza - ${ip}"

echo.
echo [!] La sesion ha finalizado o se ha perdido la conexion.
echo.
pause`;

    fs.writeFileSync(batPath, batContent);
    
    // Lanzar en ventana CMD visible para que el usuario vea el proceso
    const proc = spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/c', `"${batName}"`], {
      cwd: scrcpyFolder,
      shell: true,
      detached: true,
      stdio: 'ignore',
    });

    proc.unref();
    return { success: true };
  } catch (err) {
    console.error('[ADB] Error fatal al lanzar WIFI:', err.message);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// CONTROL DE LLAMADAS
// ═══════════════════════════════════════════════════════════════

async function dial(phoneNumber) {
  try {
    const devicesOut = await runAdb(['devices']);
    const devices = parseDevices(devicesOut);
    
    if (devices.length === 0) {
      throw new Error('Sin celular detectado (USB/WIFI)');
    }
    
    const serial = devices[0].serial;
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    console.log(`[ADB] Marcando a ${cleanNumber} en dispositivo ${serial}...`);
    
    const start = Date.now();
    await runAdb(['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.CALL', '-d', `tel:${cleanNumber}`]);
    const latency = Date.now() - start;
    
    return { success: true, latency, phoneNumber: cleanNumber };
  } catch (err) {
    console.error('[ADB] Fallo en marcación:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Abre la app de mensajería predeterminada en el celular con el mensaje y destino listos.
 *
 * IMPORTANTE: ejecuta `adb` SIN `shell: true`. En Windows, pasar por cmd.exe rompía
 * el envío cuando el template contenía caracteres especiales (& | ( ) % ^ < >),
 * porque cmd.exe los interpreta como operadores antes de llegar a adb.
 * Usar spawn directo entrega los argumentos tal cual a adb.exe.
 */
async function sendSMS(phoneNumber, messageStr) {
  try {
    const devicesOut = await runAdb(['devices']);
    const devices = parseDevices(devicesOut);

    if (devices.length === 0) {
      throw new Error('Sin celular detectado (USB/WIFI)');
    }

    const serial = devices[0].serial;
    const cleanNumber = '+' + phoneNumber.replace(/\D/g, '');

    // Normalizar mensaje: colapsar saltos de línea (am start no acepta \n en --es)
    const normalizedMsg = String(messageStr || '').replace(/\r\n|\r|\n/g, ' ').trim();

    console.log(`[ADB] Preparando SMS a ${cleanNumber} en dispositivo ${serial} (msg=${normalizedMsg.length} chars)`);

    const scrcpyFolder = getScrcpyFolderPath();
    const adbCmd = scrcpyFolder ? path.join(scrcpyFolder, 'adb.exe') : 'adb';

    // Escape POSIX single-quote: envolver en '...', escapando ' internas como '\''
    // Esto protege TODOS los caracteres especiales del shell de Android: ( ) & | $ ` " ; etc
    const shellQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

    // Construir el comando completo como UN solo string para el shell de Android.
    // adb shell <cmdline>  → adb entrega cmdline tal cual a /system/bin/sh -c
    const fullCmd =
      'am start -a android.intent.action.SENDTO' +
      ` -d 'sms:${cleanNumber}'` +
      ` --es sms_body ${shellQuote(normalizedMsg)}`;

    const args = ['-s', serial, 'shell', fullCmd];

    const result = await new Promise((resolve) => {
      // shell: false → no pasa por cmd.exe; cada arg llega íntegro a adb.exe
      const proc = spawn(adbCmd, args, {
        shell: false,
        env: { ...process.env, PATH: scrcpyFolder ? (scrcpyFolder + ';' + process.env.PATH) : process.env.PATH },
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      const timer = setTimeout(() => {
        try { proc.kill(); } catch {}
        resolve({ code: -1, stdout, stderr, timeout: true });
      }, 5000);
      proc.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      proc.on('error', err => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: err.message }); });
    });

    if (result.timeout) {
      throw new Error('Timeout enviando SMS al dispositivo');
    }
    if (result.code !== 0 && !result.stdout.includes('Starting:')) {
      throw new Error(result.stderr || `adb salió con código ${result.code}`);
    }

    return { success: true, phoneNumber: cleanNumber };
  } catch (err) {
    console.error('[ADB] Fallo en preparación de SMS:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Abre WhatsApp en el celular vía intent ADB para el número dado.
 * El número debe ser internacional sin '+' (ej: 593987654321).
 */
async function openWhatsApp(phoneNumber, messageText) {
  try {
    const devicesOut = await runAdb(['devices']);
    const devices = parseDevices(devicesOut);
    if (devices.length === 0) throw new Error('Sin celular detectado (USB/WIFI)');
    const serial = devices[0].serial;
    const clean = String(phoneNumber).replace(/\D/g, '');
    const scrcpyFolder = getScrcpyFolderPath();
    const adbCmd = scrcpyFolder ? path.join(scrcpyFolder, 'adb.exe') : 'adb';
    const normalizedMsg = String(messageText || '').replace(/\r\n|\r|\n/g, ' ').trim();
    const url = normalizedMsg
      ? `whatsapp://send?phone=${clean}&text=${encodeURIComponent(normalizedMsg)}`
      : `whatsapp://send?phone=${clean}`;
    const fullCmd = `am start -a android.intent.action.VIEW -d '${url}'`;
    const args = ['-s', serial, 'shell', fullCmd];
    const result = await new Promise((resolve) => {
      const proc = spawn(adbCmd, args, {
        shell: false,
        env: { ...process.env, PATH: scrcpyFolder ? (scrcpyFolder + ';' + process.env.PATH) : process.env.PATH },
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      const timer = setTimeout(() => { try { proc.kill(); } catch {} resolve({ code: -1, stdout, stderr, timeout: true }); }, 5000);
      proc.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      proc.on('error', err => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: err.message }); });
    });
    if (result.timeout) throw new Error('Timeout abriendo WhatsApp en el dispositivo');
    if (result.code !== 0 && !result.stdout.includes('Starting:')) {
      throw new Error(result.stderr || `adb salió con código ${result.code}`);
    }
    return { success: true, phone: clean };
  } catch (err) {
    console.error('[ADB] openWhatsApp error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Cuelga la llamada activa usando KEYCODE_ENDCALL (6).
 * Universalmente soportado en Android.
 */
async function hangup() {
  try {
    const devicesOut = await runAdb(['devices']);
    const devices = parseDevices(devicesOut);
    if (devices.length === 0) throw new Error('Sin celular detectado');
    
    const serial = devices[0].serial;
    await runAdb(['-s', serial, 'shell', 'input', 'keyevent', '6']);
    console.log('[ADB] Llamada colgada exitosamente');
    return { success: true };
  } catch (err) {
    console.error('[ADB] Error al colgar:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Caché de coordenadas UI para no ejecutar uiautomator en cada clic.
 */
const uiCoordsCache = {};

/**
 * Escanea la UI del celular, busca el botón, calcula sus coordenadas y lo presiona.
 * Inmensamente potente para burlar capas de personalización chinas (Infinix, Xiaomi, Tecno)
 * que ignoran comandos de telecom. Cachea las coordenadas para clics instantáneos posteriores.
 */
async function tapUIElement(serial, regexPattern, cacheKey) {
  try {
    if (uiCoordsCache[cacheKey]) {
      await runAdbShell(['-s', serial, 'shell', 'input', 'tap', uiCoordsCache[cacheKey].x, uiCoordsCache[cacheKey].y]);
      return true;
    }

    console.log(`[ADB] Extrayendo interfaz para buscar ${cacheKey}... (Toma ~1 seg la primera vez)`);
    await runAdbShell(['-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml'], 6000);
    const res = await runAdbShell(['-s', serial, 'shell', 'cat', '/sdcard/window_dump.xml']);
    if (!res.output) return false;

    const nodes = res.output.match(/<node[^>]*>/g);
    if (!nodes) return false;

    for (const node of nodes) {
      if (regexPattern.test(node)) {
        const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
        if (bounds) {
          const cx = Math.floor((parseInt(bounds[1]) + parseInt(bounds[3])) / 2);
          const cy = Math.floor((parseInt(bounds[2]) + parseInt(bounds[4])) / 2);
          
          uiCoordsCache[cacheKey] = { x: cx, y: cy };
          console.log(`[ADB] Guardado patrón ${cacheKey} en X:${cx} Y:${cy}`);
          
          await runAdbShell(['-s', serial, 'shell', 'input', 'tap', cx, cy]);
          return true;
        }
      }
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Pone la llamada en espera (hold) o la retoma.
 */
async function toggleHold() {
  try {
    const devicesOut = await runAdb(['devices']);
    const devices = parseDevices(devicesOut);
    if (devices.length === 0) throw new Error('Sin celular detectado');
    
    const serial = devices[0].serial;
    
    // Estrategia 1: Toque de Interfaz (Burlamos la capa de Infinix buscando el botón Retener/Hold textual o descriptivamente)
    const uiSuccess = await tapUIElement(serial, /retener|hold|pausa|espera/i, 'hold');
    if (uiSuccess) return { success: true, method: 'ui_automator_click' };
    
    // Estrategia 2: Telecom nativo (Útil en AOSP/Pixel, suele fallar en Infinix)
    const r1 = await runAdbShell(['-s', serial, 'shell', 'cmd', 'telecom', 'hold']);
    if (!r1.error && r1.output && !r1.output.includes('SecurityException')) {
      return { success: true, method: 'telecom' };
    }

    // Estrategia 2: KEYCODE_HEADSETHOOK (79) — más universal
    const r2 = await runAdbShell(['-s', serial, 'shell', 'input', 'keyevent', '79']);
    console.log('[ADB] keyevent 79 →', JSON.stringify(r2));
    if (!r2.error) {
      return { success: true, method: 'keyevent_79' };
    }

    // Estrategia 3: KEYCODE_MEDIA_PAUSE (127)
    const r3 = await runAdbShell(['-s', serial, 'shell', 'input', 'keyevent', '127']);
    console.log('[ADB] keyevent 127 →', JSON.stringify(r3));
    if (!r3.error) {
      return { success: true, method: 'keyevent_127' };
    }

    return { success: false, error: 'Dispositivo no soporta hold remoto. Opere desde la pantalla del celular.' };
  } catch (err) {
    console.error('[ADB] Error al poner en espera:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Silencia o activa el micrófono de la llamada (Mute)
 */
async function toggleMute() {
  try {
    const devicesOut = await runAdb(['devices']);
    const devices = parseDevices(devicesOut);
    if (devices.length === 0) throw new Error('Sin celular detectado');
    
    const serial = devices[0].serial;
    
    // Limpiar caché: el botón puede cambiar de "Silenciar" a "Activar mic" entre usos
    delete uiCoordsCache['mute'];

    // Estrategia 1: Toque en Interfaz
    const uiSuccess = await tapUIElement(serial, /silenciar|activar mic|mute|mic\b/i, 'mute');
    if (uiSuccess) return { success: true, method: 'ui_automator_click' };

    // Estrategia 2: KEYCODE_MUTE (91)
    const r1 = await runAdbShell(['-s', serial, 'shell', 'input', 'keyevent', '91']);
    console.log('[ADB] keyevent 91 →', JSON.stringify(r1));
    return { success: true, method: 'keyevent_91' };
  } catch (err) {
    console.error('[ADB] Error al mutear:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Activa/desactiva el altavoz durante una llamada.
 * Usa runAdbShell (tolerante) para no rechazar por stderr.
 */
async function toggleSpeaker(enableSpeaker) {
  try {
    const devicesOut = await runAdb(['devices']);
    const devices = parseDevices(devicesOut);
    if (devices.length === 0) throw new Error('Sin celular detectado');
    
    const serial = devices[0].serial;
    const route = enableSpeaker ? '2' : '1';
    
    // Estrategia 1: Toque en Interfaz
    const uiSuccess = await tapUIElement(serial, /altavoz|speaker/i, 'speaker');
    if (uiSuccess) return { success: true, speaker: enableSpeaker, method: 'ui_automator_click' };

    // Estrategia 2: Telecom set-audio-route (Miente en Infinix, reporta éxito pero no lo hace)
    const r1 = await runAdbShell(['-s', serial, 'shell', 'cmd', 'telecom', 'set-audio-route', route]);
    if (!r1.error && r1.output && !r1.output.includes('SecurityException')) {
      // Ignoramos confirmarlo aquí por la mentira de Infinix, dejamos que intente keys
    }

    // Estrategia 2: Volume keys como control audible
    if (enableSpeaker) {
      await runAdbShell(['-s', serial, 'shell', 'input', 'keyevent', '24']); // VOL_UP
      await runAdbShell(['-s', serial, 'shell', 'input', 'keyevent', '24']); // VOL_UP
      await runAdbShell(['-s', serial, 'shell', 'input', 'keyevent', '24']); // VOL_UP
    } else {
      await runAdbShell(['-s', serial, 'shell', 'input', 'keyevent', '25']); // VOL_DOWN
      await runAdbShell(['-s', serial, 'shell', 'input', 'keyevent', '25']); // VOL_DOWN
      await runAdbShell(['-s', serial, 'shell', 'input', 'keyevent', '25']); // VOL_DOWN
    }
    console.log(`[ADB] Speaker ${enableSpeaker ? 'ON' : 'OFF'} vía volume keys`);
    return { success: true, speaker: enableSpeaker, method: 'volume_keys' };
  } catch (err) {
    console.error('[ADB] Error al cambiar altavoz:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Toca el botón de grabar/detener grabación en la pantalla del celular vía ADB.
 * @param {boolean} isCurrentlyRecording — true = buscar botón de detener primero
 */
async function startRecordOnDevice(isCurrentlyRecording = false) {
  try {
    const devicesOut = await runAdb(['devices']);
    const devices = parseDevices(devicesOut);
    if (devices.length === 0) throw new Error('Sin celular detectado');

    const serial = devices[0].serial;

    // Limpiar caché en cada llamada: la UI cambia entre inicio y detención de grabación
    delete uiCoordsCache['record_btn'];
    delete uiCoordsCache['record_stop_btn'];

    // Si está grabando, intentar el patrón de "detener" primero
    if (isCurrentlyRecording) {
      const stopped = await tapUIElement(serial, /parar|detener|finalizar|stop|fin\b/i, 'record_stop_btn');
      if (stopped) return { success: true, recording: false, method: 'ui_stop' };
    }

    // Patrón amplio para el botón de inicio (cubre Infinix, Xiaomi, Samsung, Tecno)
    const started = await tapUIElement(serial, /grabar|grabac|record|rec\b|registrar/i, 'record_btn');
    if (started) return { success: true, recording: !isCurrentlyRecording, method: 'ui_start' };

    return {
      success: false,
      error: 'No se encontró el botón de grabación. Asegúrese de estar en la pantalla de llamada activa.',
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Consulta el estado actual de la llamada de forma agnóstica a la SIM (Dual SIM compatible)
 */
async function checkCallStatus() {
  try {
    const devicesOut = await runAdb(['devices']);
    const devices = parseDevices(devicesOut);
    if (devices.length === 0) return { success: true, active: false }; // Si no hay cel, asumimos no hay llamada
    
    const serial = devices[0].serial;
    const res = await runAdbShell(['-s', serial, 'shell', 'dumpsys', 'telephony.registry']);
    
    if (res.output) {
      // mCallState=0 (IDLE), 1 (RINGING), 2 (OFFHOOK - Llamada activa)
      // Usamos matchAll para capturar todos los slots SIM
      const matches = res.output.matchAll(/mCallState=(\d)/g);
      let isAnythingActive = false;
      
      for (const match of matches) {
        const state = match[1];
        if (state === '1' || state === '2') {
          isAnythingActive = true;
          break;
        }
      }
      
      return { success: true, active: isAnythingActive };
    }
    
    return { success: true, active: false }; 
  } catch(e) {
    console.error('[ADB] Fallo en checkCallStatus:', e.message);
    return { success: true, active: false }; // Fail-safe para no bloquear la UI
  }
}

function stopAll() {
  for (const proc of childProcesses) {
    try { proc.kill(); } catch (e) {}
  }
  childProcesses = [];
}

module.exports = { 
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
  startRecordOnDevice,
  checkCallStatus,
  isScrcpyRunning,
  sendSMS,
  openWhatsApp,
};
