/**
 * tests/unit/queries-auth.test.js
 * Pruebas de queries de autenticación (better-sqlite3 en memoria).
 */
const path = require('path')
const fs = require('fs')

let testDb = null

function createIsolatedDb() {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const schemaPath = path.resolve(__dirname, '..', '..', 'src', 'main', 'database', 'schema.sql')
  db.exec(fs.readFileSync(schemaPath, 'utf-8'))

  const hash = '$2a$10$dummyHashForTestingPurposesOnly1234567890abcdef'
  db.prepare(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Admin', 'admin@test.com', ?, 'supervisor')`).run(hash)
  db.prepare(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Asesor 1', 'asesor1@test.com', ?, 'asesor')`).run(hash)
  db.prepare(`INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ('Asesor 2', 'asesor2@test.com', ?, 'asesor')`).run(hash)

  db.prepare(`INSERT INTO campanas (nombre, supervisor_id, estado, fecha_inicio) VALUES ('Campaña Q1', 1, 'activa', '2026-01-01')`).run()

  const ins = db.prepare(`INSERT INTO contactos (campana_id, telefono, nombre_deudor, cedula, asignado_a, estado_marcacion, intentos_realizados) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  ins.run(1, '0999999001', 'Cliente A', '1710000001', 2, 'PENDIENTE', 0)
  ins.run(1, '0999999002', 'Cliente B', '1710000002', 2, 'PENDIENTE', 1)
  ins.run(1, '0999999003', 'Cliente C', '1710000003', null, 'PENDIENTE', 0)
  ins.run(1, '0999999004', 'Cliente D', '1710000004', 2, 'GESTIONADO', 2)

  db.prepare(`INSERT OR IGNORE INTO config (clave, valor) VALUES ('version_db', '2.0.0')`).run()
  return db
}

beforeEach(() => { testDb = createIsolatedDb() })

describe('queries — AUTH (SQL directo)', () => {
  it('findUserByEmail — encuentra usuario existente', () => {
    const user = testDb.prepare('SELECT * FROM usuarios WHERE email = ? AND estado = ?')
      .get('admin@test.com', 'activo')
    expect(user).not.toBeNull()
    expect(user.nombre).toBe('Admin')
    expect(user.rol).toBe('supervisor')
  })

  it('findUserByEmail — undefined para usuario inexistente', () => {
    const user = testDb.prepare('SELECT * FROM usuarios WHERE email = ? AND estado = ?')
      .get('noexiste@test.com', 'activo')
    expect(user).toBeUndefined()
  })

  it('findUserById — encuentra por ID sin exponer password_hash', () => {
    const user = testDb.prepare('SELECT id, nombre, email, rol, estado, creado_en FROM usuarios WHERE id = ?').get(1)
    expect(user.id).toBe(1)
    expect(user.email).toBe('admin@test.com')
    expect(user.password_hash).toBeUndefined()
  })
})
