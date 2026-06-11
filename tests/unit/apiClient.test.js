/**
 * tests/unit/apiClient.test.js
 *
 * Capa de conexión VM↔terminal (modo remoto).
 * Cubre las correcciones de auditoría 2026-06-01:
 *   C1 — canal de datos no mapeado NO debe caer silenciosamente a SQLite local.
 *   C2 — respuesta 401 debe disparar logout global (sesión expirada).
 *
 * PRIME DIRECTIVE v2.1 — F.I.R.S.T.
 */

import {
  isLocalChannel,
  assertChannelAllowedLocal,
  handleAuthStatus,
  UnmappedRemoteChannelError,
  SessionExpiredError,
} from '../../src/renderer/shared/apiClient.js'

// ═══════════════════════════════════════════════════════════
// isLocalChannel — distingue canales de dispositivo/sistema
// ═══════════════════════════════════════════════════════════
describe('isLocalChannel', () => {
  it('reconoce canales de dispositivo como locales', () => {
    expect(isLocalChannel('adb:dial')).toBe(true)
    expect(isLocalChannel('audio:start')).toBe(true)
    expect(isLocalChannel('recorder:stop')).toBe(true)
    expect(isLocalChannel('shell:openPath')).toBe(true)
    expect(isLocalChannel('app:logout')).toBe(true)
  })

  it('NO considera locales los canales de datos', () => {
    expect(isLocalChannel('db:getCdrs')).toBe(false)
    expect(isLocalChannel('validacion:confirmarPagos')).toBe(false)
    expect(isLocalChannel('cdrs:tipificar')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════
// C1 — canal no mapeado en modo remoto
// ═══════════════════════════════════════════════════════════
describe('assertChannelAllowedLocal (C1)', () => {
  it('permite ejecución local para canales de dispositivo', () => {
    expect(assertChannelAllowedLocal('adb:hangup')).toBe(true)
  })

  it('lanza error para un canal de datos no mapeado en vez de leer la DB local', () => {
    expect(() => assertChannelAllowedLocal('db:getCarteraEquipo'))
      .toThrow(UnmappedRemoteChannelError)
  })

  it('el error expone el nombre del canal ofensor', () => {
    try {
      assertChannelAllowedLocal('db:getMetricasEquipo')
    } catch (err) {
      expect(err.channel).toBe('db:getMetricasEquipo')
    }
  })
})

// ═══════════════════════════════════════════════════════════
// C2 — manejo global de 401
// ═══════════════════════════════════════════════════════════
describe('handleAuthStatus (C2)', () => {
  it('en 401 invoca onUnauthorized exactamente una vez y lanza SessionExpiredError', () => {
    let calls = 0
    const onUnauthorized = () => { calls++ }
    expect(() => handleAuthStatus(401, onUnauthorized)).toThrow(SessionExpiredError)
    expect(calls).toBe(1)
  })

  it('en 200 no lanza ni invoca onUnauthorized', () => {
    let calls = 0
    handleAuthStatus(200, () => { calls++ })
    expect(calls).toBe(0)
  })

  it('no falla si onUnauthorized no es función', () => {
    expect(() => handleAuthStatus(401, null)).toThrow(SessionExpiredError)
  })
})
