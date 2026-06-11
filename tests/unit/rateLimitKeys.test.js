/**
 * tests/unit/rateLimitKeys.test.js
 *
 * C4 — El rate limit de login debe ser POR CUENTA (email), no por IP.
 * Detrás del túnel los asesores comparten IP → con key por IP, tras 10 intentos
 * todo el equipo queda bloqueado. Key por email → cada asesor su propio cupo.
 *
 * PRIME DIRECTIVE v2.1 — F.I.R.S.T.
 */

const { loginRateLimitKey } = require('../../src/main/security/rateLimitKeys');

describe('loginRateLimitKey (C4)', () => {
  it('usa el email normalizado (trim + minúsculas) como clave', () => {
    expect(loginRateLimitKey({ body: { email: '  Asesor@Uphone.Local ' } }))
      .toBe('login:asesor@uphone.local');
  });

  it('asesores distintos obtienen claves distintas (aislamiento de cupo)', () => {
    const a = loginRateLimitKey({ body: { email: 'a@uphone.local' }, ip: '10.0.0.1' });
    const b = loginRateLimitKey({ body: { email: 'b@uphone.local' }, ip: '10.0.0.1' });
    expect(a).not.toBe(b); // misma IP, pero cupos separados
  });

  it('mismo email con distinta capitalización/espacios comparte cupo', () => {
    const a = loginRateLimitKey({ body: { email: 'X@Y.com' } });
    const b = loginRateLimitKey({ body: { email: ' x@y.com ' } });
    expect(a).toBe(b);
  });

  it('sin email cae a la IP para no dejar la ruta sin límite', () => {
    expect(loginRateLimitKey({ ip: '190.1.2.3' })).toBe('login:ip:190.1.2.3');
  });

  it('sin email ni IP devuelve una clave estable de respaldo', () => {
    expect(loginRateLimitKey({})).toBe('login:ip:unknown');
  });
});
