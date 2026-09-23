/**
 * tests/unit/tipificacionEstado.test.js
 *
 * Regla de negocio confirmada con la operación el 2026-09-23: si el asesor
 * llamó y tipificó, la gestión cuenta — el contacto queda GESTIONADO con
 * cualquier código. Una versión anterior dejaba NC y BUZON en EN_INTENTOS y
 * eso dejó gestiones reales sin contabilizar en producción.
 */
const { decidirEstadoTrasTipificacion } = require('../../backend/src/domain/tipificacionEstado');

describe('decidirEstadoTrasTipificacion', () => {
  const CODIGOS = ['NC', 'BUZON', 'PMP', 'PAGO_REAL', 'AB_PARC', 'VOL_CALL', 'INCUMP'];

  it.each(CODIGOS)('con código %s el contacto queda GESTIONADO', (codigo) => {
    const r = decidirEstadoTrasTipificacion({ codigoTipificacion: codigo, intentosActuales: 0 });
    expect(r.estadoMarcacion).toBe('GESTIONADO');
  });

  it('cuenta el intento realizado', () => {
    expect(decidirEstadoTrasTipificacion({ intentosActuales: 0 }).intentosRealizados).toBe(1);
    expect(decidirEstadoTrasTipificacion({ intentosActuales: 4 }).intentosRealizados).toBe(5);
  });

  it('sin intentosActuales arranca en 1', () => {
    expect(decidirEstadoTrasTipificacion({})).toEqual({ estadoMarcacion: 'GESTIONADO', intentosRealizados: 1 });
  });

  it('sin argumentos no revienta (el endpoint siempre pasa el contacto, pero no debe romper)', () => {
    expect(decidirEstadoTrasTipificacion()).toEqual({ estadoMarcacion: 'GESTIONADO', intentosRealizados: 1 });
  });

  it('maxIntentos ya no influye en el estado — nunca deja el contacto sin gestionar', () => {
    const r = decidirEstadoTrasTipificacion({ codigoTipificacion: 'NC', intentosActuales: 0, maxIntentos: 99 });
    expect(r.estadoMarcacion).toBe('GESTIONADO');
  });
});
