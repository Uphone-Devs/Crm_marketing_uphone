/**
 * auth.routes.js — POST /api/auth/login
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const authService = require('../services/auth.service');

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,                   // 10 intentos por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Intente nuevamente en 15 minutos.' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    res.json(result);
  } catch (err) {
    // Prisma validation/client errors exponen paths internos — sanitizar
    const isPrismaInternal =
      err.name?.startsWith('Prisma') ||
      err.message?.includes('Invalid `db.') ||
      err.message?.includes('\\backend\\') ||
      err.message?.includes('/backend/');
    const message = isPrismaInternal
      ? 'Error interno del servidor. Contacte al administrador.'
      : err.message;
    res.status(401).json({ error: message });
  }
});

module.exports = router;
