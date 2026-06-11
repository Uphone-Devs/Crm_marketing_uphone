/**
 * tests/setup.js — Configuración global para tests.
 *
 * Estrategia: mejor-sqlite3 en memoria para tests de queries.
 * Cada suite que requiera DB llama a createTestDb() y recibe
 * una instancia aislada con el schema completo.
 */

const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')

// ── Variables de entorno para tests ──────────────────────────
process.env.JWT_SECRET = 'test-secret-key-supertest-2026'
process.env.NODE_ENV = 'test'

// ── Crear DB en memoria con schema ─────────────────────────
function createTestDb() {
  const db = new Database(':memory:')

  // Habilitar WAL mode y foreign keys
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Cargar schema desde el archivo SQL del proyecto
  const schemaPath = path.resolve(__dirname, '..', 'src', 'main', 'database', 'schema.sql')
  const schema = fs.readFileSync(schemaPath, 'utf-8')

  // Ejecutar schema (better-sqlite3 permite múltiples statements con exec)
  db.exec(schema)

  return db
}

/**
 * Poblar DB con datos de prueba mínimos:
 * - 1 supervisor
 * - 2 asesores
 * - 1 campaña
 * - contactos de prueba
 */
function seedTestDb(db) {
  // Usuarios (password_hash = bcrypt.hashSync('test123', 10))
  const hash = '$2a$10$dummyHashForTestingPurposesOnly1234567890abcdef'
  const hash2 = '$2a$10$dummyHashForTestingPurposesOnly0987654321abcdef'

  db.prepare(`INSERT INTO usuarios (nombre, email, password_hash, rol)
    VALUES ('Super Admin', 'admin@test.com', ?, 'supervisor')`).run(hash)

  db.prepare(`INSERT INTO usuarios (nombre, email, password_hash, rol)
    VALUES ('Asesor Uno', 'asesor1@test.com', ?, 'asesor')`).run(hash2)

  db.prepare(`INSERT INTO usuarios (nombre, email, password_hash, rol)
    VALUES ('Asesor Dos', 'asesor2@test.com', ?, 'asesor')`).run(hash2)

  // Campaña
  db.prepare(`INSERT INTO campanas (nombre, supervisor_id, estado, fecha_inicio)
    VALUES ('Campaña Test Q1', 1, 'activa', '2026-01-01')`).run()

  // Contactos
  const insertContacto = db.prepare(`INSERT INTO contactos
    (campana_id, telefono, nombre, cedula, empresa, asignado_a, estado, intentos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)

  insertContacto.run(1, '0999999001', 'Cliente A', '1710000001', 'Empresa A', 2, 'PENDIENTE', 0)
  insertContacto.run(1, '0999999002', 'Cliente B', '1710000002', 'Empresa B', 2, 'PENDIENTE', 1)
  insertContacto.run(1, '0999999003', 'Cliente C', '1710000003', 'Empresa C', null, 'PENDIENTE', 0)
  insertContacto.run(1, '0999999004', 'Cliente D', '1710000004', 'Empresa D', 2, 'GESTIONADO', 2)

  // Config
  db.prepare(`INSERT OR IGNORE INTO config (clave, valor) VALUES ('version_db', '2.0.0')`).run()

  return db
}

module.exports = { createTestDb, seedTestDb }
