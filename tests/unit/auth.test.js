/**
 * tests/unit/auth.test.js
 *
 * Pruebas unitarias del flujo de autenticación:
 * bcrypt + JWT + validación de credenciales.
 *
 * PRIME DIRECTIVE v2.1 — F.I.R.S.T.:
 *   Fast (ms), Independent, Repeatable, Self-validating, Timely
 */

const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

// ═══════════════════════════════════════════════════════════
// bcryptjs — hashing y verificación
// ═══════════════════════════════════════════════════════════

describe('bcryptjs — password hashing', () => {
  it('genera un hash diferente para el mismo input (salt aleatorio)', () => {
    const password = 'test123'
    const hash1 = bcrypt.hashSync(password, 10)
    const hash2 = bcrypt.hashSync(password, 10)
    expect(hash1).not.toBe(hash2)
    expect(hash1).toHaveLength(60) // bcrypt hash = 60 chars
  })

  it('verifica correctamente una contraseña contra su hash', () => {
    const password = 'super-secret-2026'
    const hash = bcrypt.hashSync(password, 10)
    expect(bcrypt.compareSync(password, hash)).toBe(true)
  })

  it('rechaza contraseñas incorrectas', () => {
    const hash = bcrypt.hashSync('correcta', 10)
    expect(bcrypt.compareSync('incorrecta', hash)).toBe(false)
  })

  it('maneja contraseñas vacías', () => {
    const hash = bcrypt.hashSync('', 10)
    expect(bcrypt.compareSync('', hash)).toBe(true)
    expect(bcrypt.compareSync('algo', hash)).toBe(false)
  })

  it('es determinista con la misma contraseña y mismo salt', () => {
    const password = 'deterministic-test'
    const salt = bcrypt.genSaltSync(10)
    const hash1 = bcrypt.hashSync(password, salt)
    const hash2 = bcrypt.hashSync(password, salt)
    expect(hash1).toBe(hash2)
  })
})

// ═══════════════════════════════════════════════════════════
// jsonwebtoken — generación y verificación
// ═══════════════════════════════════════════════════════════

describe('jsonwebtoken — token generation & validation', () => {
  const payload = { id: 1, nombre: 'Test User', rol: 'asesor' }

  it('genera un token JWT válido', () => {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' })
    expect(token).toBeTypeOf('string')
    expect(token.split('.')).toHaveLength(3) // header.payload.signature
  })

  it('decodifica un token correctamente', () => {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' })
    const decoded = jwt.verify(token, JWT_SECRET)
    expect(decoded.id).toBe(1)
    expect(decoded.nombre).toBe('Test User')
    expect(decoded.rol).toBe('asesor')
  })

  it('rechaza tokens expirados', () => {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '0s' })
    // Esperar un ms para asegurar expiración
    expect(() => jwt.verify(token, JWT_SECRET)).toThrow()
  })

  it('rechaza tokens firmados con secret diferente', () => {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow()
  })

  it('rechaza tokens malformados', () => {
    expect(() => jwt.verify('not.a.token', JWT_SECRET)).toThrow()
    expect(() => jwt.verify('', JWT_SECRET)).toThrow()
    expect(() => jwt.verify('solo-una-parte', JWT_SECRET)).toThrow()
  })

  it('incluye expiración en el payload', () => {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' })
    const decoded = jwt.verify(token, JWT_SECRET)
    expect(decoded.exp).toBeDefined()
    expect(typeof decoded.exp).toBe('number')
  })

  it('token contiene claim iat y exp válidos', () => {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })
    const decoded = jwt.verify(token, JWT_SECRET)
    expect(typeof decoded.iat).toBe('number')
    expect(decoded.exp).toBeGreaterThan(decoded.iat)
  })

  it('respeta el claim de rol en el token', () => {
    const supervisorPayload = { id: 2, nombre: 'Admin', rol: 'supervisor' }
    const token = jwt.sign(supervisorPayload, JWT_SECRET, { expiresIn: '1h' })
    const decoded = jwt.verify(token, JWT_SECRET)
    expect(decoded.rol).toBe('supervisor')
  })
})

// ═══════════════════════════════════════════════════════════
// Validación de inputs de login
// ═══════════════════════════════════════════════════════════

describe('login — input validation', () => {
  function validateLoginInput(email, password) {
    const errors = []
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      errors.push('Email inválido')
    }
    if (!password || typeof password !== 'string' || password.length < 1) {
      errors.push('Password requerido')
    }
    return { valid: errors.length === 0, errors }
  }

  it('acepta credenciales válidas', () => {
    expect(validateLoginInput('user@test.com', 'password123')).toEqual({
      valid: true, errors: []
    })
  })

  it('rechaza email vacío', () => {
    expect(validateLoginInput('', 'password')).toEqual({
      valid: false, errors: ['Email inválido']
    })
  })

  it('rechaza email sin @', () => {
    expect(validateLoginInput('notanemail', 'password')).toEqual({
      valid: false, errors: ['Email inválido']
    })
  })

  it('rechaza password vacío', () => {
    expect(validateLoginInput('user@test.com', '')).toEqual({
      valid: false, errors: ['Password requerido']
    })
  })

  it('rechaza ambos campos vacíos', () => {
    const result = validateLoginInput('', '')
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(2)
  })
})
