/**
 * ffmpeg.recorder.js
 * 
 * Módulo de grabación de audio para el proceso principal de Electron.
 * Responsabilidades:
 *   - Auto-descubrir dispositivos de audio del sistema (dshow).
 *   - Iniciar/detener grabaciones .opus con mínimo impacto en CPU.
 *   - Proveer stream de datos crudos para escucha en vivo (supervisor).
 *
 * Decisión arquitectónica: Se ejecuta en Main Process (Node.js nativo)
 * porque spawn de C/C++ consume fracciones del CPU/RAM que consumiría
 * MediaRecorder en el Renderer (Chromium). Esto evita congelamiento del DOM.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

// ── Estado interno ─────────────────────────────────────────────
let ffmpegProcess = null;
let currentOutputPath = null;
let cachedAudioDevice = null;

// ── Constantes ─────────────────────────────────────────────────
const RECORDING_DIR = path.join(os.tmpdir(), 'uphone_grabaciones');
const OPUS_BITRATE = '24k'; // Calidad optimizada para voz humana

// ── Resolución de ruta FFmpeg ──────────────────────────────────
function getFfmpegPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  }
  // Dev: buscar en resources locales, luego fallback a PATH del sistema
  const localPath = path.join(__dirname, '..', '..', 'resources', 'ffmpeg', 'ffmpeg.exe');
  if (fs.existsSync(localPath)) return localPath;

  // Último recurso: confiar en que ffmpeg está en el PATH del sistema
  return 'ffmpeg';
}

// ── Auto-descubrimiento de dispositivos de audio ───────────────
/**
 * Ejecuta `ffmpeg -list_devices` y extrae los nombres de los dispositivos
 * de audio disponibles en Windows (DirectShow).
 * @returns {string[]} Lista de nombres de dispositivos de audio
 */
function listarDispositivosAudio() {
  const ffmpegPath = getFfmpegPath();

  try {
    // FFmpeg escribe la lista de dispositivos en stderr (no stdout)
    execSync(`"${ffmpegPath}" -list_devices true -f dshow -i dummy`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
  } catch (err) {
    // FFmpeg siempre sale con error aquí porque "dummy" no es un input válido.
    // La información útil está en stderr, que Node.js captura en err.stderr.
    const stderr = err.stderr || '';
    const dispositivos = [];
    const regex = /\] "([^"]+)" \(audio\)/gi;
    let match;
    while ((match = regex.exec(stderr)) !== null) {
      dispositivos.push(match[1]);
    }
    return dispositivos;
  }

  return [];
}

/**
 * Selecciona automáticamente el mejor dispositivo de audio para grabar.
 * Prioridad:
 *   1. "Mezcla estéreo" / "Stereo Mix" (captura loopback del sistema)
 *   2. "CABLE Output" (VB-Audio Virtual Cable)
 *   3. Primer dispositivo disponible como fallback
 *
 * @returns {string|null} Nombre del dispositivo seleccionado
 */
function seleccionarDispositivoAudio() {
  if (cachedAudioDevice) return cachedAudioDevice;

  const dispositivos = listarDispositivosAudio();

  if (dispositivos.length === 0) {
    console.warn('[RECORDER] No se encontraron dispositivos de audio.');
    return null;
  }

  console.log('[RECORDER] Dispositivos detectados:', dispositivos);

  // Palabras clave ordenadas por prioridad descendente
  const prioridades = [
    /mezcla\s*est[eé]reo/i,
    /stereo\s*mix/i,
    /cable\s*output/i,
    /virtual\s*cable/i,
    /what\s*u\s*hear/i,
    /loopback/i,
  ];

  for (const patron of prioridades) {
    const encontrado = dispositivos.find((d) => patron.test(d));
    if (encontrado) {
      cachedAudioDevice = encontrado;
      console.log(`[RECORDER] Dispositivo auto-seleccionado: "${encontrado}"`);
      return encontrado;
    }
  }

  // Fallback: primer dispositivo disponible
  cachedAudioDevice = dispositivos[0];
  console.log(`[RECORDER] Fallback al primer dispositivo: "${cachedAudioDevice}"`);
  return cachedAudioDevice;
}

/**
 * Fuerza un dispositivo de audio específico, saltándose el auto-descubrimiento.
 * Útil para configuraciones manuales vía UI o .env.
 * @param {string} nombreDispositivo
 */
function forzarDispositivo(nombreDispositivo) {
  cachedAudioDevice = nombreDispositivo;
  console.log(`[RECORDER] Dispositivo forzado manualmente: "${nombreDispositivo}"`);
}

// ── Grabación ──────────────────────────────────────────────────

/**
 * Asegura que el directorio de grabaciones temporales exista.
 */
function asegurarDirectorioGrabaciones() {
  if (!fs.existsSync(RECORDING_DIR)) {
    fs.mkdirSync(RECORDING_DIR, { recursive: true });
  }
}

/**
 * Inicia la grabación de audio del sistema a un archivo .opus.
 *
 * @param {string|number} cdrId - Identificador del CDR para nombrar el archivo
 * @param {function} [onLiveChunk] - Callback opcional para streaming en vivo.
 *   Recibe `Buffer` con datos PCM crudos para reenviar al supervisor.
 * @returns {{ success: boolean, filePath?: string, error?: string }}
 */
function iniciarGrabacion(cdrId, onLiveChunk) {
  if (ffmpegProcess) {
    return { success: false, error: 'Ya existe una grabación en curso.' };
  }

  const dispositivo = seleccionarDispositivoAudio();
  if (!dispositivo) {
    return { success: false, error: 'No se detectó ningún dispositivo de audio.' };
  }

  asegurarDirectorioGrabaciones();

  const nombreArchivo = `grabacion_${cdrId}_${Date.now()}.opus`;
  currentOutputPath = path.join(RECORDING_DIR, nombreArchivo);

  const ffmpegPath = getFfmpegPath();

  // Argumentos optimizados para grabación de voz en call center
  const args = [
    '-f', 'dshow',
    '-i', `audio=${dispositivo}`,
    '-c:a', 'libopus',
    '-b:a', OPUS_BITRATE,
    '-application', 'voip',    // Optimización Opus para voz
    '-frame_duration', '20',   // Frames de 20ms = baja latencia
    '-vn',                     // Sin video
    '-y',                      // Sobrescribir si existe
    currentOutputPath,
  ];

  // Si necesitamos stream en vivo, añadimos una salida paralela a stdout
  if (onLiveChunk) {
    args.splice(args.length - 1, 0,
      '-f', 'wav',        // Formato crudo para streaming
      '-ar', '16000',     // 16kHz suficiente para voz
      '-ac', '1',         // Mono
      'pipe:1',           // Enviar a stdout
    );
  }

  try {
    ffmpegProcess = spawn(ffmpegPath, args, {
      stdio: ['pipe', onLiveChunk ? 'pipe' : 'ignore', 'pipe'],
    });
  } catch (err) {
    console.error('[RECORDER] Error al lanzar FFmpeg:', err.message);
    ffmpegProcess = null;
    return { success: false, error: err.message };
  }

  // Streaming en vivo hacia el supervisor (si aplica)
  if (onLiveChunk && ffmpegProcess.stdout) {
    const CHUNK_SIZE = 4096;
    let buffer = Buffer.alloc(0);

    ffmpegProcess.stdout.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= CHUNK_SIZE) {
        onLiveChunk(buffer.subarray(0, CHUNK_SIZE));
        buffer = buffer.subarray(CHUNK_SIZE);
      }
    });
  }

  // Log errores reales (FFmpeg usa stderr para info normal también)
  ffmpegProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.toLowerCase().includes('error') && !msg.includes('Last message repeated')) {
      console.error('[RECORDER] FFmpeg error:', msg.trim());
    }
  });

  ffmpegProcess.on('error', (err) => {
    console.error('[RECORDER] Proceso FFmpeg falló:', err.message);
    ffmpegProcess = null;
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`[RECORDER] FFmpeg cerrado (código: ${code})`);
    ffmpegProcess = null;
  });

  console.log(`[RECORDER] Grabación iniciada → ${currentOutputPath}`);
  return { success: true, filePath: currentOutputPath };
}

/**
 * Detiene la grabación de forma limpia enviando 'q' a stdin de FFmpeg.
 * @returns {Promise<{ success: boolean, filePath?: string, error?: string }>}
 */
function detenerGrabacion() {
  if (!ffmpegProcess) {
    return Promise.resolve({ success: false, error: 'No hay grabación activa.' });
  }

  return new Promise((resolve) => {
    const outputPath = currentOutputPath;

    ffmpegProcess.on('close', () => {
      ffmpegProcess = null;
      currentOutputPath = null;

      // Verificar que el archivo se creó correctamente
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.log(`[RECORDER] Archivo finalizado: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`);
        resolve({ success: true, filePath: outputPath });
      } else {
        resolve({ success: false, error: 'El archivo de grabación no fue creado.' });
      }
    });

    // Enviar 'q' para cierre limpio (FFmpeg libera el codec correctamente)
    try {
      ffmpegProcess.stdin.write('q');
      ffmpegProcess.stdin.end();
    } catch (err) {
      // Si stdin ya cerró, forzar kill
      try { ffmpegProcess.kill('SIGTERM'); } catch (_) { /* proceso ya muerto */ }
    }

    // Timeout de seguridad: si FFmpeg no cierra en 5s, forzar
    setTimeout(() => {
      if (ffmpegProcess) {
        console.warn('[RECORDER] Timeout — forzando cierre de FFmpeg');
        try { ffmpegProcess.kill('SIGKILL'); } catch (_) { /* ignorar */ }
        ffmpegProcess = null;
        currentOutputPath = null;
        resolve({ success: true, filePath: outputPath });
      }
    }, 5000);
  });
}

/**
 * Fuerza el cierre inmediato si hay grabación activa.
 * Usado en cleanup de app.on('will-quit').
 */
function forzarCierre() {
  if (ffmpegProcess) {
    try { ffmpegProcess.kill(); } catch (_) { /* ignorar */ }
    ffmpegProcess = null;
    currentOutputPath = null;
  }
}

/**
 * @returns {boolean} true si hay una grabación activa
 */
function isGrabando() {
  return ffmpegProcess !== null;
}

/**
 * @returns {string|null} Ruta del archivo siendo grabado actualmente
 */
function getArchivoActual() {
  return currentOutputPath;
}

module.exports = {
  listarDispositivosAudio,
  seleccionarDispositivoAudio,
  forzarDispositivo,
  iniciarGrabacion,
  detenerGrabacion,
  forzarCierre,
  isGrabando,
  getArchivoActual,
};
