import { describe, it, expect, vi, afterEach } from 'vitest';

// Helpers defined inline for pure unit testing (no component import needed)
function getNaiveNowForGYE() {
  const now = new Date();
  const gyeStr = now.toLocaleString('sv-SE', { timeZone: 'America/Guayaquil' });
  return new Date(gyeStr.replace(' ', 'T') + 'Z');
}

function calcGph(totalCount, primeraGestionTs) {
  if (!primeraGestionTs || !totalCount) return null;
  const naiveNow = getNaiveNowForGYE();
  const elapsed = (naiveNow.getTime() - new Date(primeraGestionTs).getTime()) / 3600000;
  if (elapsed < 0.1) return null;
  return totalCount / elapsed;
}

function getProyeccion(totalCount, gph) {
  if (gph == null) return null;
  const naiveNow = getNaiveNowForGYE();
  const ymd = naiveNow.toISOString().slice(0, 10);
  const naiveMidnight = new Date(`${ymd}T23:59:59.999Z`);
  const horasRestantes = (naiveMidnight.getTime() - naiveNow.getTime()) / 3600000;
  if (horasRestantes < 0.1) return null;
  return Math.round(totalCount + gph * horasRestantes);
}

afterEach(() => { vi.useRealTimers(); });

describe('calcGph', () => {
  it('returns null when no gestiones', () => {
    expect(calcGph(0, '2026-07-29T08:00:00.000Z')).toBeNull();
  });

  it('returns null when primeraGestionTs is null', () => {
    expect(calcGph(10, null)).toBeNull();
  });

  it('returns null when elapsed < 6 min', () => {
    vi.useFakeTimers();
    // Real UTC 13:03 → GYE = 08:03; primera_gestion naive = 08:00 GYE → only 3 min elapsed
    vi.setSystemTime(new Date('2026-07-29T13:03:00.000Z'));
    expect(calcGph(5, '2026-07-29T08:00:00.000Z')).toBeNull();
  });

  it('calculates correct rate after sufficient time', () => {
    vi.useFakeTimers();
    // Real UTC 13:00 → GYE = 08:00; primera_gestion naive = 06:00 GYE → 2h elapsed, 20 gest → 10/hr
    vi.setSystemTime(new Date('2026-07-29T13:00:00.000Z'));
    const result = calcGph(20, '2026-07-29T06:00:00.000Z');
    expect(result).toBeCloseTo(10, 0);
  });
});

describe('getProyeccion', () => {
  it('returns null when gph is null', () => {
    expect(getProyeccion(10, null)).toBeNull();
  });

  it('returns null when near midnight GYE', () => {
    vi.useFakeTimers();
    // Real UTC 04:57 → GYE 23:57 → < 6 min until naive midnight
    vi.setSystemTime(new Date('2026-07-30T04:57:00.000Z'));
    expect(getProyeccion(100, 15)).toBeNull();
  });

  it('projects correctly mid-day', () => {
    vi.useFakeTimers();
    // Real UTC 15:00 → GYE 10:00; naive midnight = T23:59:59Z; ~14h remaining; 20 + 10*14 ≈ 160
    vi.setSystemTime(new Date('2026-07-29T15:00:00.000Z'));
    const result = getProyeccion(20, 10);
    expect(result).toBeGreaterThan(100);
    expect(result).toBeLessThan(200);
  });
});
