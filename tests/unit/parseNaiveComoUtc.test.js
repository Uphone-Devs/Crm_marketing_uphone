/**
 * tests/unit/parseNaiveComoUtc.test.js
 *
 * El cliente Electron arma horas "naive" (sin Z/offset) cuyos dígitos ya
 * son la hora de reloj de Guayaquil (ver nowLocalISO() en
 * src/renderer/shared/timeUtils.js, y los pickers de fecha/hora del
 * agendamiento). El backend debe guardar esos dígitos tal cual, como si
 * fueran UTC — nunca dejar que `new Date(str)` los interprete con la zona
 * horaria del proceso, porque entonces el resultado depende de cómo esté
 * configurado el reloj de la VM (bug real: alguien cambió la zona horaria
 * de la VM y todas las horas quedaron corridas +5h).
 */
const { parseNaiveComoUtc } = require('../../backend/src/utils/fechas');

describe('parseNaiveComoUtc', () => {
  it('string naive con separador T, sin Z → trata los dígitos como UTC', () => {
    const d = parseNaiveComoUtc('2026-09-22T22:06:55');
    expect(d.toISOString()).toBe('2026-09-22T22:06:55.000Z');
  });

  it('string naive con separador espacio (formato Postgres) → normaliza y trata como UTC', () => {
    const d = parseNaiveComoUtc('2026-09-22 22:06:55');
    expect(d.toISOString()).toBe('2026-09-22T22:06:55.000Z');
  });

  it('preserva milisegundos', () => {
    const d = parseNaiveComoUtc('2026-09-22T22:06:55.422');
    expect(d.toISOString()).toBe('2026-09-22T22:06:55.422Z');
  });

  it('string que ya trae Z explícita → se respeta tal cual, sin tocar', () => {
    const d = parseNaiveComoUtc('2026-09-22T22:06:55Z');
    expect(d.toISOString()).toBe('2026-09-22T22:06:55.000Z');
  });

  it('string que ya trae un offset explícito → se respeta (no se reinterpreta como UTC)', () => {
    const d = parseNaiveComoUtc('2026-09-22T22:06:55-05:00');
    expect(d.toISOString()).toBe('2026-09-23T03:06:55.000Z');
  });

  it('null/undefined → null (no revienta el caller)', () => {
    expect(parseNaiveComoUtc(null)).toBeNull();
    expect(parseNaiveComoUtc(undefined)).toBeNull();
  });

  it('ya viene como Date → se devuelve igual, sin reconvertir', () => {
    const original = new Date('2026-09-22T22:06:55.000Z');
    expect(parseNaiveComoUtc(original)).toBe(original);
  });

  it('es inmune a la zona horaria del proceso que lo ejecuta (el bug real)', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Guayaquil';
      const enGuayaquil = parseNaiveComoUtc('2026-09-22T22:06:55').getTime();
      process.env.TZ = 'UTC';
      const enUtc = parseNaiveComoUtc('2026-09-22T22:06:55').getTime();
      expect(enGuayaquil).toBe(enUtc);
    } finally {
      process.env.TZ = original;
    }
  });
});
