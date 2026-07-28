import { describe, it, expect } from 'vitest';
import { isDentroDeVentana, validatePolicyInput } from '../../src/main/updateWindow.js';

// Helper: construye un Date que, en TZ America/Guayaquil (UTC-5, sin DST),
// cae en el día/hora deseados. Guayaquil = UTC-5 → sumamos 5h al armar el UTC.
function gyeDate(weekday0Sun, hh, mm) {
  // 2026-07-05 es domingo. Sumamos 'weekday0Sun' días para elegir el día.
  const day = 5 + weekday0Sun; // 5=domingo ... 11=sábado (julio 2026)
  return new Date(Date.UTC(2026, 6, day, hh + 5, mm, 0));
}

describe('isDentroDeVentana', () => {
  const base = { enabled: true, startTime: '13:00', endTime: '14:00', days: [1, 2, 3, 4, 5] };

  it('false si enabled=false', () => {
    expect(isDentroDeVentana(gyeDate(1, 13, 30), { ...base, enabled: false })).toBe(false);
  });

  it('true dentro de ventana mismo día y día permitido (martes 13:30)', () => {
    expect(isDentroDeVentana(gyeDate(2, 13, 30), base)).toBe(true);
  });

  it('false fuera de ventana (martes 15:00)', () => {
    expect(isDentroDeVentana(gyeDate(2, 15, 0), base)).toBe(false);
  });

  it('false si el día no está en days (domingo 13:30)', () => {
    expect(isDentroDeVentana(gyeDate(0, 13, 30), base)).toBe(false);
  });

  it('ventana que cruza medianoche: true a las 23:00', () => {
    const nocturna = { enabled: true, startTime: '20:00', endTime: '08:00', days: [0, 1, 2, 3, 4, 5, 6] };
    expect(isDentroDeVentana(gyeDate(3, 23, 0), nocturna)).toBe(true);
  });

  it('ventana que cruza medianoche: true a las 02:00', () => {
    const nocturna = { enabled: true, startTime: '20:00', endTime: '08:00', days: [0, 1, 2, 3, 4, 5, 6] };
    expect(isDentroDeVentana(gyeDate(3, 2, 0), nocturna)).toBe(true);
  });

  it('ventana nula start==end → false', () => {
    expect(isDentroDeVentana(gyeDate(2, 13, 0), { ...base, startTime: '13:00', endTime: '13:00' })).toBe(false);
  });
});

describe('validatePolicyInput', () => {
  it('acepta payload válido', () => {
    const r = validatePolicyInput({ enabled: true, startTime: '13:00', endTime: '14:00', days: [1, 2], checkIntervalMin: 30 });
    expect(r.ok).toBe(true);
  });

  it('rechaza HH:MM inválido', () => {
    const r = validatePolicyInput({ enabled: true, startTime: '25:00', endTime: '14:00', days: [1], checkIntervalMin: 30 });
    expect(r.ok).toBe(false);
  });

  it('rechaza día fuera de rango', () => {
    const r = validatePolicyInput({ enabled: true, startTime: '13:00', endTime: '14:00', days: [7], checkIntervalMin: 30 });
    expect(r.ok).toBe(false);
  });

  it('rechaza checkIntervalMin <= 0', () => {
    const r = validatePolicyInput({ enabled: true, startTime: '13:00', endTime: '14:00', days: [1], checkIntervalMin: 0 });
    expect(r.ok).toBe(false);
  });
});
