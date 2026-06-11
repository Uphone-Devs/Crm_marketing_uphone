/**
 * tests/helpers/realDb.js
 *
 * Harness compartido para probar las funciones REALES de queries.js contra una
 * BD better-sqlite3 temporal levantada con el schema + migraciones reales
 * (initDatabase). Evita copias SQL inline que divergen de producción.
 *
 * Uso:
 *   const { setupRealDb, HASH } = require('../helpers/realDb');
 *   const harness = setupRealDb({ name: 'mi-suite', seed: (d) => { ... } });
 *   // dentro de los tests: harness.db.prepare(...) / funciones reales de queries.js
 *
 * No es un archivo *.test.js → el runner no lo colecta como suite.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Hash bcrypt ficticio para sembrar usuarios sin coste de hashing real.
const HASH = '$2a$10$dummyHashForTestingPurposesOnly1234567890abcdef';

/**
 * Registra el ciclo de vida (beforeAll/afterAll/beforeEach) de una BD real aislada.
 * @param {object}   cfg
 * @param {string}   cfg.name    Prefijo único del archivo .db temporal.
 * @param {function} cfg.seed    (db) => void — siembra el fixture controlado.
 * @param {string[]} [cfg.tables] Tablas a limpiar antes de cada test (orden hijo→padre).
 * @returns {{db: import('better-sqlite3').Database}} ref con .db disponible tras beforeAll.
 */
function setupRealDb({ name, seed, tables = ['cdrs', 'contactos', 'campanas', 'usuarios'] }) {
  const TMP_DB = path.join(os.tmpdir(), `${name}-test-${process.pid}.db`);
  // DB_PATH se lee dentro de initDatabase() (runtime), basta fijarlo antes de esa llamada.
  process.env.DB_PATH = TMP_DB;

  const { initDatabase, getDb, closeDb } = require('../../src/main/database/db');
  const ref = { db: null };

  function rmDbFiles() {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(TMP_DB + suffix); } catch (_) { /* no existe */ }
    }
  }

  function cleanData(d) {
    d.pragma('foreign_keys = OFF');
    for (const t of tables) d.prepare(`DELETE FROM ${t}`).run();
    // sqlite_sequence solo existe para tablas AUTOINCREMENT (no 'config').
    const seqTables = tables.filter(t => t !== 'config').map(t => `'${t}'`).join(',');
    if (seqTables) d.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${seqTables})`).run();
    d.pragma('foreign_keys = ON');
  }

  beforeAll(() => { rmDbFiles(); initDatabase(); ref.db = getDb(); });
  afterAll(() => { closeDb(); rmDbFiles(); });
  beforeEach(() => { cleanData(ref.db); seed(ref.db); });

  return ref;
}

module.exports = { setupRealDb, HASH };
