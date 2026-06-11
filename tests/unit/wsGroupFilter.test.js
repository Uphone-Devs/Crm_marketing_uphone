/**
 * tests/unit/wsGroupFilter.test.js
 *
 * Bug 4 (v3.0) — Broadcast WS por grupo: un supervisor solo recibe eventos
 * (estado/métricas) de asesores de SU equipo. El admin recibe todos.
 *
 * PRIME DIRECTIVE v2.1 — F.I.R.S.T.
 */

const { shouldDeliverToSupervisor } = require('../../src/main/wsGroupFilter');

describe('shouldDeliverToSupervisor (Bug 4)', () => {
  it('entrega al supervisor del mismo grupo que el asesor', () => {
    expect(shouldDeliverToSupervisor(2, { supervisorId: 2, esAdmin: false })).toBe(true);
  });

  it('NO entrega a un supervisor de otro grupo', () => {
    expect(shouldDeliverToSupervisor(3, { supervisorId: 2, esAdmin: false })).toBe(false);
  });

  it('el admin recibe eventos de cualquier grupo', () => {
    expect(shouldDeliverToSupervisor(99, { supervisorId: 1, esAdmin: true })).toBe(true);
  });

  it('un asesor sin grupo (supervisor_id null) no llega a ningún supervisor', () => {
    expect(shouldDeliverToSupervisor(null, { supervisorId: 2, esAdmin: false })).toBe(false);
  });

  it('compara por valor aunque vengan como string/number', () => {
    expect(shouldDeliverToSupervisor('2', { supervisorId: 2, esAdmin: false })).toBe(true);
  });

  it('cliente supervisor sin id de grupo (legacy) recibe todo — fail-open para no romper', () => {
    expect(shouldDeliverToSupervisor(5, { supervisorId: null, esAdmin: false })).toBe(true);
  });

  it('sin cliente no entrega', () => {
    expect(shouldDeliverToSupervisor(2, null)).toBe(false);
  });
});
