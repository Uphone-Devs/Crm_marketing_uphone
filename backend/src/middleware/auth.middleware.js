/**
 * auth.middleware.js — Validación JWT para rutas protegidas.
 */

const authService = require('../services/auth.service');

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autorización requerido.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = authService.verificarToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado.' });
  }
}

/**
 * Middleware que restringe acceso por rol.
 * @param  {...string} roles - Roles permitidos ('supervisor', 'asesor', 'admin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'Acceso denegado. Rol insuficiente.' });
    }
    next();
  };
}

module.exports = { authMiddleware, requireRole };
