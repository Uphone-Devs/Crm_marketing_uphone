/**
 * tests/unit/tipificacionEstado.test.js
 *
 * decidirEstadoTrasTipificacion() es la lógica pura que reemplaza la cadena
 * incrementarIntentoContacto().then(marcarContactoGestionado()) del cliente
 * Electron — esa cadena forzaba SIEMPRE 'GESTIONADO' al final, sin importar
 * el código de tipificación, pisando el 'EN_INTENTOS' que el propio conteo
 * de intentos acababa de fijar. Esta función es la fuente única de verdad
 * para el nuevo endpoint transaccional (PATCH /api/cdrs/:id/tipificar).
 */
const { decidirEstadoTrasTipificacion, CODIGOS_REINTENTABLES } = require('../../backend/src/domain/tipificacionEstado');

describe('decidirEstadoTrasTipificacion', () => {
  it('código no reintentable (ej. contacto efectivo) → GESTIONADO de una', () => {
    const r = decidirEstadoTrasTipificacion({ codigoTipificacion: 'PMP', intentosActuales: 0, maxIntentos: 3 });
    expect(r).toEqual({ estadoMarcacion: 'GESTIONADO', intentosRealizados: 1 });
  });

  it('el intento se cuenta siempre, tambien en codigos no reintentables (paridad con /intentar)', () => {
    const r = decidirEstadoTrasTipificacion({ codigoTipificacion: 'PAGO_REAL', intentosActuales: 4, maxIntentos: 3 });
    expect(r.intentosRealizados).toBe(5);
    expect(r.estadoMarcacion).toBe('GESTIONADO');
  });

  it('código reintentable (NC) bajo el máximo → EN_INTENTOS, incrementa intentos', () => {
    const r = decidirEstadoTrasTipificacion({ codigoTipificacion: 'NC', intentosActuales: 0, maxIntentos: 3 });
    expect(r).toEqual({ estadoMarcacion: 'EN_INTENTOS', intentosRealizados: 1 });
  });

  it('código reintentable (BUZON) al alcanzar el máximo → GESTIONADO', () => {
    const r = decidirEstadoTrasTipificacion({ codigoTipificacion: 'BUZON', intentosActuales: 2, maxIntentos: 3 });
    expect(r).toEqual({ estadoMarcacion: 'GESTIONADO', intentosRealizados: 3 });
  });

  it('código reintentable sin maxIntentos configurado → nunca fuerza GESTIONADO, sigue EN_INTENTOS', () => {
    const r = decidirEstadoTrasTipificacion({ codigoTipificacion: 'NC', intentosActuales: 50, maxIntentos: undefined });
    expect(r).toEqual({ estadoMarcacion: 'EN_INTENTOS', intentosRealizados: 51 });
  });

  it('CODIGOS_REINTENTABLES expone exactamente NC y BUZON (contrato con el frontend)', () => {
    expect(CODIGOS_REINTENTABLES).toEqual(['NC', 'BUZON']);
  });
});
