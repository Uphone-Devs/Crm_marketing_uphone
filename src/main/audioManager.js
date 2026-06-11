/**
 * audioManager.js
 *
 * Capa de compatibilidad que expone la misma API pública que tenía antes
 * (startCapture, stopCapture, isCapturing) pero delega internamente al
 * nuevo ffmpeg.recorder.js con auto-descubrimiento de dispositivos.
 *
 * Razón de existencia (Chesterton's Fence): ipcHandlers.js y el resto del
 * código ya importan { startCapture, stopCapture, isCapturing } de este módulo.
 * Mantener la firma evita romper dependencias existentes.
 */

const recorder = require('./ffmpeg.recorder');

// Contador creciente para nombrar grabaciones cuando no hay cdrId formal
let captureSessions = 0;

/**
 * Inicia la captura de audio del sistema.
 * @param {function} onChunk - Callback que recibe Buffer con datos PCM para streaming
 * @param {function} onError - Callback que recibe Error si FFmpeg falla
 * @returns {boolean} true si la captura inició correctamente
 */
function startCapture(onChunk, onError) {
  if (recorder.isGrabando()) return true; // Ya estaba corriendo

  captureSessions++;
  const sessionId = `live_${captureSessions}`;

  const result = recorder.iniciarGrabacion(sessionId, onChunk);

  if (!result.success) {
    if (onError) onError(new Error(result.error));
    return false;
  }

  return true;
}

/**
 * Detiene la captura de audio.
 */
function stopCapture() {
  recorder.detenerGrabacion().catch((err) => {
    console.error('[AUDIO] Error al detener grabación:', err.message);
  });
}

/**
 * @returns {boolean} true si hay una captura activa
 */
function isCapturing() {
  return recorder.isGrabando();
}

module.exports = { startCapture, stopCapture, isCapturing };
