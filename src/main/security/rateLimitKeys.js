/**
 * rateLimitKeys.js — Generadores de clave para express-rate-limit.
 *
 * C4: el límite de login debe contarse POR CUENTA (email), no por IP. Detrás del
 * túnel de Cloudflare/nginx los asesores comparten la IP que ve Express, así que
 * una key por IP bloquea a todo el equipo tras N intentos colectivos. Con key por
 * email, cada asesor tiene su propio cupo y la protección anti-fuerza-bruta sigue
 * aplicando por cuenta.
 */

/**
 * Clave de rate limit para POST /api/auth/login.
 * @param {{ body?: { email?: string }, ip?: string }} req
 * @returns {string} clave estable por cuenta, con respaldo por IP.
 */
function loginRateLimitKey(req) {
  const email = req && req.body ? req.body.email : undefined;
  if (typeof email === 'string' && email.trim()) {
    return `login:${email.trim().toLowerCase()}`;
  }
  // Sin email (request malformado) → no dejar la ruta sin límite: usar IP.
  const ip = (req && req.ip) ? req.ip : 'unknown';
  return `login:ip:${ip}`;
}

module.exports = { loginRateLimitKey };
