/**
 * tests/unit/queries-campanas.test.js
 *
 * Prueba las funciones REALES de queries.js (asesores, campañas, contactos, config)
 * contra una BD temporal con schema + migraciones reales (helper realDb).
 *
 * PRIME DIRECTIVE v2.1 — F.I.R.S.T.
 */

const { setupRealDb, HASH } = require('../helpers/realDb');
const {
  getAsesores, getCampanas, getCampanaById, getSiguienteContacto,
  marcarContactoGestionado, incrementarIntentoContacto,
  getAllConfig, setConfig, getConfig, insertCdr,
} = require('../../src/main/database/queries');

function seedFixture(d) {
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Admin','admin@test.com',?,'supervisor')").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Asesor 1','asesor1@test.com',?,'asesor')").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Asesor 2','asesor2@test.com',?,'asesor')").run(HASH);
  d.prepare("INSERT INTO campanas (nombre,supervisor_id,estado,fecha_inicio) VALUES ('Campaña Q1',1,'activa','2026-01-01')").run();

  const ins = d.prepare(`
    INSERT INTO contactos (campana_id, telefono, nombre_deudor, cedula, asignado_a, estado_marcacion, intentos_realizados)
    VALUES (1, ?, ?, ?, ?, ?, ?)
  `);
  ins.run('0999999001', 'Cliente A', '1710000001', 2, 'PENDIENTE', 0);
  ins.run('0999999002', 'Cliente B', '1710000002', 2, 'PENDIENTE', 1);
  ins.run('0999999003', 'Cliente C', '1710000003', null, 'PENDIENTE', 0);
  ins.run('0999999004', 'Cliente D', '1710000004', 2, 'GESTIONADO', 2);
}

const harness = setupRealDb({
  name: 'campanas',
  seed: seedFixture,
  tables: ['cdrs', 'contactos', 'campanas', 'config', 'usuarios'],
});

describe('getAsesores', () => {
  it('lista solo asesores activos, excluye supervisores', () => {
    const rows = getAsesores();
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.rol)).not.toContain('supervisor');
  });
});

describe('getCampanas / getCampanaById', () => {
  it('getCampanas lista las campañas', () => {
    const rows = getCampanas();
    expect(rows).toHaveLength(1);
    expect(rows[0].nombre).toBe('Campaña Q1');
  });

  it('getCampanaById encuentra por ID; falsy si no existe', () => {
    expect(getCampanaById(1).nombre).toBe('Campaña Q1');
    expect(getCampanaById(999)).toBeFalsy();
  });
});

describe('getSiguienteContacto', () => {
  it('devuelve el primer PENDIENTE del asesor (menor id, sin orden manual)', () => {
    const row = getSiguienteContacto(1, 2);
    expect(row.nombre_deudor).toBe('Cliente A');
    expect(row.intentos_realizados).toBe(0);
  });

  it('asigna automáticamente un contacto sin asignar al solicitarlo', () => {
    // Asesor 3 no tiene PENDIENTES propios → toma el primer asignado_a NULL (Cliente C).
    const row = getSiguienteContacto(1, 3);
    expect(row.nombre_deudor).toBe('Cliente C');
    expect(row.asignado_a).toBe(3);
  });
});

describe('marcarContactoGestionado', () => {
  it('cambia estado_marcacion a GESTIONADO', () => {
    marcarContactoGestionado(3);
    const row = harness.db.prepare('SELECT estado_marcacion FROM contactos WHERE id = 3').get();
    expect(row.estado_marcacion).toBe('GESTIONADO');
  });
});

describe('incrementarIntentoContacto', () => {
  it('bajo el máximo deja el contacto EN_INTENTOS', () => {
    incrementarIntentoContacto(1, 3);
    const row = harness.db.prepare('SELECT estado_marcacion, intentos_realizados FROM contactos WHERE id = 1').get();
    expect(row.intentos_realizados).toBe(1);
    expect(row.estado_marcacion).toBe('EN_INTENTOS');
  });

  it('al alcanzar el máximo marca GESTIONADO', () => {
    incrementarIntentoContacto(1, 1);
    const row = harness.db.prepare('SELECT estado_marcacion, intentos_realizados FROM contactos WHERE id = 1').get();
    expect(row.intentos_realizados).toBe(1);
    expect(row.estado_marcacion).toBe('GESTIONADO');
  });
});

describe('config', () => {
  it('setConfig inserta y getConfig/getAllConfig recuperan', () => {
    setConfig('test_key', 'test_value');
    expect(getConfig('test_key')).toBe('test_value');
    expect(getAllConfig().test_key).toBe('test_value');
  });

  it('setConfig sobre clave existente reemplaza el valor', () => {
    setConfig('modo_marcacion', 'MANUAL');
    setConfig('modo_marcacion', 'AUTOMATICA');
    expect(getConfig('modo_marcacion')).toBe('AUTOMATICA');
  });

  it('getConfig devuelve null para clave inexistente', () => {
    expect(getConfig('no_existe')).toBeNull();
  });
});

describe('insertCdr — null-safety / FK', () => {
  it('rechaza contactoId inválido (FK constraint)', () => {
    expect(() => insertCdr({ contactoId: 999, usuarioId: 1, timestampInicio: new Date().toISOString() })).toThrow();
  });

  it('inserta CDR válido y devuelve lastInsertRowid', () => {
    const r = insertCdr({ contactoId: 1, usuarioId: 2, timestampInicio: new Date().toISOString() });
    expect(Number(r.lastInsertRowid)).toBeGreaterThan(0);
  });
});
