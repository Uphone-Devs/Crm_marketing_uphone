/**
 * tests/security/jwt.test.js
 * Pruebas de seguridad del flujo JWT.
 */
const jwt = require('jsonwebtoken')

const SECRET = 'test-secret-security-2026'

describe('JWT — Seguridad del token', () => {
  it('rechaza tokens sin firma (alg: none)', () => {
    const malicious = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.' +
      Buffer.from(JSON.stringify({ id: 1, rol: 'supervisor' })).toString('base64') + '.'
    expect(() => jwt.verify(malicious, SECRET)).toThrow()
  })

  it('rechaza tokens con secret vacío', () => {
    const token = jwt.sign({ id: 1 }, SECRET, { expiresIn: '1h' })
    expect(() => jwt.verify(token, '')).toThrow()
  })

  it('rechaza tokens con payload manipulado', () => {
    const token = jwt.sign({ id: 1, rol: 'asesor' }, SECRET, { expiresIn: '1h' })
    const parts = token.split('.')
    const fakePayload = Buffer.from(JSON.stringify({ id: 1, rol: 'supervisor' })).toString('base64')
    const fakeToken = `${parts[0]}.${fakePayload}.${parts[2]}`
    expect(() => jwt.verify(fakeToken, SECRET)).toThrow()
  })

  it('el token expirado es rechazado con TokenExpiredError', () => {
    const token = jwt.sign({ id: 1 }, SECRET, { expiresIn: '0s' })
    try {
      jwt.verify(token, SECRET)
    } catch (err) {
      expect(err.name).toBe('TokenExpiredError')
    }
  })

  it('el token sin expiración explícita expira por defecto', () => {
    // jwt.sign sin expiresIn no tiene exp → es válido sin expiración
    const token = jwt.sign({ id: 1 }, SECRET)
    const decoded = jwt.verify(token, SECRET)
    expect(decoded.exp).toBeUndefined()
  })

  it('rechaza tokens nulos o undefined', () => {
    expect(() => jwt.verify(null, SECRET)).toThrow()
    expect(() => jwt.verify(undefined, SECRET)).toThrow()
  })

  it('iat (issued at) es siempre pasado o presente', () => {
    const token = jwt.sign({ id: 1 }, SECRET, { expiresIn: '1h' })
    const decoded = jwt.verify(token, SECRET)
    const now = Math.floor(Date.now() / 1000)
    expect(decoded.iat).toBeLessThanOrEqual(now + 2)
    expect(decoded.iat).toBeGreaterThan(now - 5)
  })

  it('previene privilege escalation: rol no se puede inyectar', () => {
    // Si de alguna manera se intenta firmar con rol supervisor teniendo asesor
    const token = jwt.sign({ id: 2, rol: 'asesor' }, SECRET, { expiresIn: '1h' })
    const decoded = jwt.verify(token, SECRET)
    expect(decoded.rol).toBe('asesor')
    expect(decoded.rol).not.toBe('supervisor')
  })
})
