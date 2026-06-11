/**
 * tests/integration/api.test.js
 * Pruebas de integración del servidor Express API (sin DB real).
 * Usa supertest para testear endpoints, middlewares y rate-limiting.
 */
const request = require('supertest')
const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-integration'

// ── Factory: crear mini-app de prueba ──────────────────────
function createTestApp(customMiddleware = {}) {
  const app = express()
  app.use(express.json())

  // Auth middleware (mismo patrón que apiServer.js)
  function requireAuth(req, res, next) {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' })
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET)
      next()
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado' })
    }
  }

  function requireSupervisor(req, res, next) {
    if (req.user?.rol !== 'supervisor') return res.status(403).json({ error: 'Requiere rol supervisor' })
    next()
  }

  // Health
  app.get('/api/health', (req, res) => res.json({ ok: true }))

  // Auth
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos' } })
  app.post('/api/auth/login', authLimiter, (req, res) => {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' })
    if (email !== 'admin@test.com' || password !== 'test123') return res.status(401).json({ error: 'Credenciales inválidas' })
    const token = jwt.sign({ id: 1, nombre: 'Admin', rol: 'supervisor' }, JWT_SECRET, { expiresIn: '12h' })
    res.json({ token, usuario: { id: 1, nombre: 'Admin', email, rol: 'supervisor' } })
  })

  // Ruta protegida genérica
  app.get('/api/protegida', requireAuth, (req, res) => res.json({ user: req.user }))
  app.get('/api/solo-supervisor', requireAuth, requireSupervisor, (req, res) => res.json({ ok: true }))

  return app
}

const app = createTestApp()
let validToken = null

beforeAll(() => {
  validToken = jwt.sign({ id: 1, nombre: 'Admin', rol: 'supervisor' }, JWT_SECRET, { expiresIn: '12h' })
})

// ═══════════════════════════════════════════════════════════

describe('API — Health', () => {
  it('GET /api/health responde ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('API — Auth /login', () => {
  it('401 con credenciales inválidas', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('400 si falta email o password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com' })
    expect(res.status).toBe(400)
  })

  it('200 + token con credenciales válidas', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'test123' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.usuario.rol).toBe('supervisor')
  })
})

describe('API — Auth Middleware', () => {
  it('401 sin token', async () => {
    const res = await request(app).get('/api/protegida')
    expect(res.status).toBe(401)
  })

  it('401 con token malformado', async () => {
    const res = await request(app).get('/api/protegida').set('Authorization', 'not-bearer')
    expect(res.status).toBe(401)
  })

  it('401 con token inválido', async () => {
    const res = await request(app).get('/api/protegida').set('Authorization', 'Bearer token.falso.malware')
    expect(res.status).toBe(401)
  })

  it('401 con token expirado', async () => {
    const expired = jwt.sign({ id: 1, rol: 'asesor' }, JWT_SECRET, { expiresIn: '0s' })
    const res = await request(app).get('/api/protegida').set('Authorization', `Bearer ${expired}`)
    expect(res.status).toBe(401)
  })

  it('200 con token válido', async () => {
    const res = await request(app).get('/api/protegida').set('Authorization', `Bearer ${validToken}`)
    expect(res.status).toBe(200)
    expect(res.body.user.rol).toBe('supervisor')
  })
})

describe('API — Role Middleware (Supervisor)', () => {
  it('403 si no es supervisor', async () => {
    const tokenAsesor = jwt.sign({ id: 2, nombre: 'Asesor', rol: 'asesor' }, JWT_SECRET, { expiresIn: '1h' })
    const res = await request(app).get('/api/solo-supervisor').set('Authorization', `Bearer ${tokenAsesor}`)
    expect(res.status).toBe(403)
  })

  it('200 si es supervisor', async () => {
    const res = await request(app).get('/api/solo-supervisor').set('Authorization', `Bearer ${validToken}`)
    expect(res.status).toBe(200)
  })
})

describe('API — Rate Limiting', () => {
  it('permite requests bajo el límite (credenciales inválidas → 401)', async () => {
    const promises = []
    for (let i = 0; i < 5; i++) {
      promises.push(request(app).post('/api/auth/login').send({ email: 'test@test.com', password: 'wrong' }))
    }
    const results = await Promise.all(promises)
    results.forEach(r => expect(r.status).toBe(401))
  })

  it('bloquea después de 10 intentos', async () => {
    // Forzar rate-limit en test: hacer 11 requests secuenciales
    let lastStatus = null
    for (let i = 0; i < 11; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: 'test@test.com', password: 'wrong' })
      lastStatus = res.status
    }
    // La 11va debería ser 429 (rate-limited)
    expect(lastStatus).toBe(429)
  })
})
