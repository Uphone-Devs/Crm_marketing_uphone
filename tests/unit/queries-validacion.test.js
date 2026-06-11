/**
 * tests/unit/queries-validacion.test.js
 *
 * Prueba la función REAL correlacionarPagos (src/main/database/queries.js)
 * contra una BD temporal con schema + migraciones reales (helper realDb).
 *
 * PRIME DIRECTIVE v2.1 — F.I.R.S.T.
 */

const { setupRealDb, HASH } = require('../helpers/realDb');
const { correlacionarPagos } = require('../../src/main/database/queries');

function insertContacto(d, { telefono, nombre, cedula, asesorId, metadata, fecha }) {
  d.prepare(`
    INSERT INTO contactos
      (campana_id, telefono, nombre_deudor, cedula, asignado_a, estado_marcacion, intentos_realizados, metadata, fecha_asignacion)
    VALUES (1, ?, ?, ?, ?, 'PENDIENTE', 0, ?, ?)
  `).run(telefono, nombre, cedula, asesorId, JSON.stringify(metadata), fecha);
}

function seedFixture(d) {
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Super','sup@t.com',?,'supervisor')").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Asesor A','a@t.com',?,'asesor')").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Asesor B','b@t.com',?,'asesor')").run(HASH);
  d.prepare("INSERT INTO campanas (nombre,supervisor_id,estado,fecha_inicio) VALUES ('C1',1,'activa','2026-01-01')").run();

  // 1: Asesor A (id 2), 2026-05-20, contrato 1001
  insertContacto(d, { telefono: '0991', nombre: 'Juan', cedula: '111', asesorId: 2,
    metadata: { 'Nº CONTRATO': '1001', EMPRESA: 'SCC', 'VALOR EN MORA': '100.00' }, fecha: '2026-05-20' });
  // 2: Asesor B (id 3), 2026-05-20, mismo contrato 1001
  insertContacto(d, { telefono: '0992', nombre: 'Pedro', cedula: '222', asesorId: 3,
    metadata: { 'Nº CONTRATO': '1001', EMPRESA: 'SCC', 'VALOR EN MORA': '100.00' }, fecha: '2026-05-20' });
  // 3: Asesor A (id 2), 2026-05-21, contrato 1002
  insertContacto(d, { telefono: '0993', nombre: 'Maria', cedula: '333', asesorId: 2,
    metadata: { 'Nº CONTRATO': '1002', EMPRESA: 'SCC', 'VALOR EN MORA': '200.00' }, fecha: '2026-05-21' });
}

setupRealDb({ name: 'validacion', seed: seedFixture });

// Helper: arma pagosData (formato real) a partir de números de contrato.
function pagos(...contratos) {
  return contratos.map(c => ({ contrato: c, montoPagado: 100, empresa: 'SCC' }));
}

describe('correlacionarPagos — filtros opts', () => {
  it('sin opts devuelve ambos contactos con contrato 1001', () => {
    const { matches, totalMatches } = correlacionarPagos(pagos('1001'));
    expect(totalMatches).toBe(2);
    expect(matches).toHaveLength(2);
  });

  it('con asesorId=2 devuelve solo el contacto del Asesor A', () => {
    const { matches } = correlacionarPagos(pagos('1001'), { asesorId: 2 });
    expect(matches).toHaveLength(1);
    expect(matches[0].asesorNombre).toBe('Asesor A');
    expect(matches[0].contrato).toBe('1001');
  });

  it('con asesorId=2 y fecha=2026-05-20 devuelve solo contrato 1001 del Asesor A', () => {
    const { matches } = correlacionarPagos(pagos('1001', '1002'), { asesorId: 2, fecha: '2026-05-20' });
    expect(matches).toHaveLength(1);
    expect(matches[0].contrato).toBe('1001');
  });

  it('con asesorId=2 y fecha=2026-05-21 devuelve solo contrato 1002', () => {
    const { matches } = correlacionarPagos(pagos('1001', '1002'), { asesorId: 2, fecha: '2026-05-21' });
    expect(matches).toHaveLength(1);
    expect(matches[0].contrato).toBe('1002');
  });

  it('con asesorId inexistente devuelve vacío', () => {
    const { matches, totalMatches } = correlacionarPagos(pagos('1001'), { asesorId: 999 });
    expect(matches).toHaveLength(0);
    expect(totalMatches).toBe(0);
  });

  it('pagosData vacío no consulta la BD', () => {
    const res = correlacionarPagos([]);
    expect(res.totalContratos).toBe(0);
    expect(res.matches).toHaveLength(0);
  });
});
