/**
 * tests/unit/carterasEquipoUtils.test.js
 *
 * Lógica pura extraída de CarterasEquipo.jsx para el rework de lazy-load
 * (resumen liviano + detalle por asesor bajo demanda). Ver
 * .agentes/adr/20260917-limite-cartera-equipo.md.
 *
 * PRIME DIRECTIVE v2.1 — F.I.R.S.T.
 */

import {
  estaEnCola,
  extraerFechaIso,
  coincideTexto,
  aplicarFiltrosFila,
  sumarResumen,
} from '../../src/renderer/supervisor/carterasEquipoUtils.js';

describe('estaEnCola', () => {
  it('excluye YA_PAGO validado aunque tenga orden_marcacion', () => {
    expect(estaEnCola({ validado_pago: 1, estado_marcacion: 'YA_PAGO', orden_marcacion: 3 })).toBe(false);
  });

  it('incluye PENDIENTE y EN_INTENTOS por defecto', () => {
    expect(estaEnCola({ estado_marcacion: 'PENDIENTE', validado_pago: 0 })).toBe(true);
    expect(estaEnCola({ estado_marcacion: 'EN_INTENTOS', validado_pago: 0 })).toBe(true);
  });

  it('incluye GESTIONADO solo si el supervisor le asignó orden_marcacion', () => {
    expect(estaEnCola({ estado_marcacion: 'GESTIONADO', orden_marcacion: null, validado_pago: 0 })).toBe(false);
    expect(estaEnCola({ estado_marcacion: 'GESTIONADO', orden_marcacion: 1, validado_pago: 0 })).toBe(true);
  });
});

describe('extraerFechaIso', () => {
  it('recorta timestamp completo a los primeros 10 caracteres', () => {
    expect(extraerFechaIso('2026-09-18 10:30:00')).toBe('2026-09-18');
  });

  it('devuelve string vacío para valores no-string o vacíos', () => {
    expect(extraerFechaIso(null)).toBe('');
    expect(extraerFechaIso(undefined)).toBe('');
    expect(extraerFechaIso(12345)).toBe('');
  });
});

describe('coincideTexto', () => {
  it('matchea por cédula, nombre, teléfono o campos de metadata', () => {
    const row = {
      nombre_deudor: 'Juan Perez', cedula: '0102030405', telefono: '0991234567',
      metadata: JSON.stringify({ 'Nº CONTRATO': 'ABC-123', EMPRESA: 'SCC' }),
    };
    expect(coincideTexto(row, 'perez')).toBe(true);
    expect(coincideTexto(row, '0102030405')).toBe(true);
    expect(coincideTexto(row, 'abc-123')).toBe(true);
    expect(coincideTexto(row, 'scc')).toBe(true);
    expect(coincideTexto(row, 'no existe')).toBe(false);
  });

  it('metadata inválida no rompe la búsqueda — solo se ignora ese campo', () => {
    const row = { nombre_deudor: 'Ana', metadata: '{roto' };
    expect(coincideTexto(row, 'ana')).toBe(true);
  });

  it('texto vacío matchea todo', () => {
    expect(coincideTexto({}, '')).toBe(true);
  });
});

describe('aplicarFiltrosFila', () => {
  const rows = [
    { id: 1, estado_marcacion: 'PENDIENTE', fecha_asignacion: '2026-09-10', nombre_deudor: 'Ana Lopez' },
    { id: 2, estado_marcacion: 'GESTIONADO', fecha_asignacion: '2026-09-15', nombre_deudor: 'Beto Ruiz' },
    { id: 3, estado_marcacion: 'PENDIENTE', fecha_asignacion: '2026-09-18', nombre_deudor: 'Caro Diaz' },
  ];

  it('sin filtros devuelve todas las filas', () => {
    expect(aplicarFiltrosFila(rows)).toHaveLength(3);
  });

  it('filtra por estado', () => {
    const r = aplicarFiltrosFila(rows, { filtroEstado: 'PENDIENTE' });
    expect(r.map(x => x.id)).toEqual([1, 3]);
  });

  it('filtra por rango de fecha (desde/hasta inclusive)', () => {
    const r = aplicarFiltrosFila(rows, { filtroDesde: '2026-09-12', filtroHasta: '2026-09-16' });
    expect(r.map(x => x.id)).toEqual([2]);
  });

  it('filtra por texto libre', () => {
    const r = aplicarFiltrosFila(rows, { filtroTexto: 'lopez' });
    expect(r.map(x => x.id)).toEqual([1]);
  });

  it('combina estado + texto (AND, no OR)', () => {
    const r = aplicarFiltrosFila(rows, { filtroEstado: 'PENDIENTE', filtroTexto: 'diaz' });
    expect(r.map(x => x.id)).toEqual([3]);
  });
});

describe('sumarResumen', () => {
  it('suma conteos por asesor en totales de equipo', () => {
    const resumen = [
      { asesor_id: 1, total: 10, pendientes: 4, en_intentos: 2, agendados: 1, gestionados: 2, ya_pago: 1 },
      { asesor_id: 2, total: 5,  pendientes: 1, en_intentos: 1, agendados: 0, gestionados: 3, ya_pago: 0 },
    ];
    expect(sumarResumen(resumen)).toEqual({
      total: 15, pendientes: 5, en_intentos: 3, agendados: 1, gestionados: 5, ya_pago: 1, asesores: 2,
    });
  });

  it('array vacío o undefined no rompe — devuelve todo en cero', () => {
    expect(sumarResumen([])).toEqual({ total: 0, pendientes: 0, en_intentos: 0, agendados: 0, gestionados: 0, ya_pago: 0, asesores: 0 });
    expect(sumarResumen(undefined)).toEqual({ total: 0, pendientes: 0, en_intentos: 0, agendados: 0, gestionados: 0, ya_pago: 0, asesores: 0 });
  });
});
