/**
 * tests/unit/queries-aislamiento-equipos.test.js
 *
 * Bug 4 (v3.0) — Aislamiento de equipos por supervisor (supervisor_id).
 * Cada supervisor ve solo sus asesores; el admin ve todos.
 *
 * PRIME DIRECTIVE v2.1 — F.I.R.S.T.
 */

const { setupRealDb, HASH } = require('../helpers/realDb');
const { getAsesores, insertUsuario, getMetricasEquipo, getCompromisosEquipo, updateUsuarioAdmin } = require('../../src/main/database/queries');

// ids: 1=admin, 2=Sup A, 3=Sup B, 4=A1(sup2), 5=A2(sup2), 6=B1(sup3), 7=Legacy(null)
function seedFixture(d) {
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Admin','admin@sistema.local',?,'admin')").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Sup A','supa@t.com',?,'supervisor')").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Sup B','supb@t.com',?,'supervisor')").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol,supervisor_id) VALUES ('A1','a1@t.com',?,'asesor',2)").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol,supervisor_id) VALUES ('A2','a2@t.com',?,'asesor',2)").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol,supervisor_id) VALUES ('B1','b1@t.com',?,'asesor',3)").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol,supervisor_id) VALUES ('Legacy','leg@t.com',?,'asesor',NULL)").run(HASH);

  // Datos para compromisos: campaña + 1 contacto por asesor + 1 CDR PMP el 2026-05-10
  d.prepare("INSERT INTO campanas (nombre,supervisor_id,estado,fecha_inicio) VALUES ('C1',2,'activa','2026-01-01')").run();
  d.prepare("INSERT INTO contactos (campana_id,telefono,nombre_deudor,cedula,asignado_a,estado_marcacion) VALUES (1,'001','C A1','001',4,'GESTIONADO')").run();
  d.prepare("INSERT INTO contactos (campana_id,telefono,nombre_deudor,cedula,asignado_a,estado_marcacion) VALUES (1,'002','C B1','002',6,'GESTIONADO')").run();
  const pmp = d.prepare("SELECT id FROM tipificaciones WHERE codigo='PMP'").get().id;
  // CDR compromiso de A1 (usuario 4) y de B1 (usuario 6)
  d.prepare("INSERT INTO cdrs (contacto_id,usuario_id,tipificacion_id,timestamp_inicio,monto_acordado) VALUES (1,4,?,?,100)").run(pmp, '2026-05-10T10:00:00');
  d.prepare("INSERT INTO cdrs (contacto_id,usuario_id,tipificacion_id,timestamp_inicio,monto_acordado) VALUES (2,6,?,?,200)").run(pmp, '2026-05-10T11:00:00');
}

setupRealDb({ name: 'aislamiento', seed: seedFixture });

describe('getAsesores — aislamiento por supervisor (Bug 4)', () => {
  it('sin filtro (admin) devuelve todos los asesores', () => {
    const rows = getAsesores();
    expect(rows).toHaveLength(4); // A1, A2, B1, Legacy
  });

  it('con supervisorId=2 devuelve solo los asesores del Sup A', () => {
    const rows = getAsesores({ supervisorId: 2 });
    expect(rows.map(r => r.nombre).sort()).toEqual(['A1', 'A2']);
  });

  it('con supervisorId=3 devuelve solo el asesor del Sup B', () => {
    const rows = getAsesores({ supervisorId: 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0].nombre).toBe('B1');
  });

  it('un asesor legacy sin supervisor_id NO aparece para ningún supervisor', () => {
    expect(getAsesores({ supervisorId: 2 }).some(r => r.nombre === 'Legacy')).toBe(false);
    expect(getAsesores({ supervisorId: 3 }).some(r => r.nombre === 'Legacy')).toBe(false);
  });
});

describe('insertUsuario — persiste supervisor_id (Bug 4)', () => {
  it('crea un asesor asignado a un supervisor y queda en su equipo', () => {
    insertUsuario({ nombre: 'Nuevo', email: 'nuevo@t.com', passwordHash: HASH, rol: 'asesor', supervisorId: 3 });
    const equipoB = getAsesores({ supervisorId: 3 });
    expect(equipoB.map(r => r.nombre).sort()).toEqual(['B1', 'Nuevo']);
  });
});

describe('getMetricasEquipo — agrega solo el equipo del supervisor (Bug 4)', () => {
  it('con supervisorId=2 solo considera asesores del Sup A', () => {
    const m = getMetricasEquipo(null, { supervisorId: 2 });
    expect(m.detalleAsesores).toHaveLength(2); // A1, A2 — no incluye equipo de B ni legacy
  });
});

describe('updateUsuarioAdmin — reasignar asesor a un supervisor (Bug 4)', () => {
  it('asigna un asesor legacy (sin grupo) a un supervisor', () => {
    // Legacy = id 7, supervisor_id NULL → no aparece para nadie
    updateUsuarioAdmin(7, { nombre: 'Legacy', email: 'leg@t.com', rol: 'asesor', estado: 'activo', supervisorId: 2 });
    expect(getAsesores({ supervisorId: 2 }).map(r => r.nombre).sort()).toEqual(['A1', 'A2', 'Legacy']);
  });

  it('sin supervisorId no altera el grupo existente', () => {
    // B1 (id 6) pertenece al Sup B (3); editar sin supervisorId lo deja igual
    updateUsuarioAdmin(6, { nombre: 'B1', email: 'b1@t.com', rol: 'asesor', estado: 'activo' });
    expect(getAsesores({ supervisorId: 3 }).map(r => r.nombre)).toEqual(['B1']);
  });
});

describe('getCompromisosEquipo — aislamiento por supervisor (Bug 4)', () => {
  it('sin filtro devuelve compromisos de todos los equipos', () => {
    const rows = getCompromisosEquipo('2026-05-10');
    expect(rows.length).toBe(2); // A1 y B1
  });

  it('con supervisorId=2 solo devuelve el compromiso del equipo A', () => {
    const rows = getCompromisosEquipo('2026-05-10', null, { supervisorId: 2 });
    expect(rows.length).toBe(1);
    expect(rows[0].usuario_id).toBe(4); // A1
  });

  it('con supervisorId=3 solo devuelve el compromiso del equipo B', () => {
    const rows = getCompromisosEquipo('2026-05-10', null, { supervisorId: 3 });
    expect(rows.length).toBe(1);
    expect(rows[0].usuario_id).toBe(6); // B1
  });
});
