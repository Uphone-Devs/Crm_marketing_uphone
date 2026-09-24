/**
 * tests/unit/tipificacionEstado.test.js
 *
 * Regla de negocio confirmada con la operación el 2026-09-23: si el asesor
 * llamó y tipificó, la gestión cuenta — el contacto queda GESTIONADO con
 * cualquier código. Una versión anterior dejaba NC y BUZON en EN_INTENTOS y
 * eso dejó gestiones reales sin contabilizar en producción.
 *
 * El conteo del intento no vive acá: lo hace la base con
 * `intentos_realizados + 1` desde el endpoint transaccional.
 */
const { decidirEstadoTrasTipificacion } = require('../../backend/src/domain/tipificacionEstado');

describe('decidirEstadoTrasTipificacion', () => {
  it('siempre deja el contacto GESTIONADO', () => {
    expect(decidirEstadoTrasTipificacion()).toEqual({ estadoMarcacion: 'GESTIONADO' });
  });

  it('no depende del código de tipificación: ninguno deja la gestión sin contabilizar', () => {
    const CODIGOS = ['NC', 'BUZON', 'PMP', 'PAGO_REAL', 'AB_PARC', 'VOL_CALL', 'INCUMP', 'NEG', 'NOTIFICADO'];
    for (const codigo of CODIGOS) {
      expect(decidirEstadoTrasTipificacion({ codigoTipificacion: codigo }).estadoMarcacion).toBe('GESTIONADO');
    }
  });

  it('ignora argumentos sobrantes sin romper (el endpoint no le pasa ninguno)', () => {
    expect(decidirEstadoTrasTipificacion({ intentosActuales: 7, maxIntentos: 3 }))
      .toEqual({ estadoMarcacion: 'GESTIONADO' });
  });
});
