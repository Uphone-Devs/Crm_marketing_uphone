/**
 * tests/unit/queries-usuarios-visibilidad.test.js
 *
 * Bug 3 (v3.0) — La cuenta admin del sistema NO debe aparecer en las listas de
 * usuarios que ve un supervisor. Solo el admin ve la cuenta admin.
 *
 * PRIME DIRECTIVE v2.1 — F.I.R.S.T.
 */

const { setupRealDb, HASH } = require('../helpers/realDb');
const { getAllUsuariosAdmin, getAllUsuarios } = require('../../src/main/database/queries');

function seedFixture(d) {
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Admin Sis','admin@sistema.local',?,'admin')").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Super','sup@t.com',?,'supervisor')").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Ase 1','a1@t.com',?,'asesor')").run(HASH);
  d.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('Ase 2','a2@t.com',?,'asesor')").run(HASH);
}

setupRealDb({ name: 'usuarios-visib', seed: seedFixture });

describe('getAllUsuariosAdmin — visibilidad por rol (Bug 3)', () => {
  it('el ADMIN ve la cuenta admin en la lista', () => {
    const rows = getAllUsuariosAdmin('admin');
    expect(rows.some(u => u.rol === 'admin')).toBe(true);
  });

  it('el SUPERVISOR NO ve la cuenta admin', () => {
    const rows = getAllUsuariosAdmin('supervisor');
    expect(rows.some(u => u.rol === 'admin')).toBe(false);
    // pero sí ve supervisores y asesores
    expect(rows.some(u => u.rol === 'asesor')).toBe(true);
  });

  it('sin viewerRol explícito, por defecto NO expone admin (seguro)', () => {
    const rows = getAllUsuariosAdmin();
    expect(rows.some(u => u.rol === 'admin')).toBe(false);
  });
});

describe('getAllUsuarios — vista local del supervisor (Bug 3)', () => {
  it('nunca incluye la cuenta admin', () => {
    const rows = getAllUsuarios();
    expect(rows.some(u => u.rol === 'admin')).toBe(false);
  });
});
