/**
 * apiClient.js — Helpers puros de la capa de conexión VM↔terminal (modo remoto).
 *
 * Correcciones de auditoría 2026-06-01:
 *   C1 — Un canal de datos no mapeado NO debe leer/escribir la SQLite local del
 *        cliente (en Multi-PC eso devuelve datos vacíos o corruptos). Solo los
 *        canales de dispositivo/sistema (adb/audio/recorder/shell/app) son
 *        legítimamente locales aunque la app esté en modo remoto.
 *   C2 — Una respuesta 401 (token expirado/ inválido) debe disparar logout global
 *        en vez de dejar la sesión zombi fallando módulo por módulo.
 *
 * Funciones puras (sin React/DOM) → testeables con vitest en entorno node.
 */

// Canales que SIEMPRE corren localmente: controlan hardware/SO de la PC del asesor.
export const LOCAL_CHANNEL_PREFIXES = ['adb:', 'audio:', 'recorder:', 'shell:', 'app:'];

export class UnmappedRemoteChannelError extends Error {
  constructor(channel) {
    super(`Canal de datos no mapeado en modo remoto: ${channel}`);
    this.name = 'UnmappedRemoteChannelError';
    this.channel = channel;
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super('Sesión expirada. Vuelve a iniciar sesión.');
    this.name = 'SessionExpiredError';
  }
}

/** ¿El canal controla dispositivo/SO local (no debe ir a la VM)? */
export function isLocalChannel(channel) {
  return LOCAL_CHANNEL_PREFIXES.some((prefix) => channel.startsWith(prefix));
}

/**
 * C1: decide qué hacer con un canal que llegó al `default` del switch en modo remoto.
 * @returns {true} si es legítimamente local y puede ejecutarse vía IPC.
 * @throws {UnmappedRemoteChannelError} si es un canal de datos sin mapeo REST.
 */
export function assertChannelAllowedLocal(channel) {
  if (isLocalChannel(channel)) return true;
  throw new UnmappedRemoteChannelError(channel);
}

/**
 * C2: inspecciona el status de una respuesta remota.
 * En 401 invoca onUnauthorized (logout global) y lanza SessionExpiredError.
 */
export function handleAuthStatus(status, onUnauthorized) {
  if (status === 401) {
    if (typeof onUnauthorized === 'function') onUnauthorized();
    throw new SessionExpiredError();
  }
}
