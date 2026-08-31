/**
 * auth.service.js — Lógica de autenticación.
 * Aislada de Express (SoC): No conoce req/res.
 */

const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  throw new Error('[AUTH] JWT_SECRET env var must be set — add it to your .env file');
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

class AuthService {
  async login(email, password) {
    if (!email || !password) {
      throw new Error('Email y contraseña son requeridos.');
    }

    const rows = await db.$queryRaw`
      SELECT id, email, password_hash AS "passwordHash", rol, nombre, estado, empresa
      FROM usuarios WHERE email = ${email} LIMIT 1
    `;
    const raw = rows[0] ?? null;
    if (!raw) {
      throw new Error('Credenciales inválidas.');
    }
    const usuario = { ...raw, id: Number(raw.id) };

    if (usuario.estado !== 'activo') {
      throw new Error('Cuenta deshabilitada. Contacte al supervisor.');
    }

    const passwordValido = await bcrypt.compare(password, usuario.passwordHash);
    if (!passwordValido) {
      throw new Error('Credenciales inválidas.');
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol, nombre: usuario.nombre, empresa: usuario.empresa ?? null },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return {
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        empresa: usuario.empresa ?? null,
      },
    };
  }

  verificarToken(token) {
    if (!token) throw new Error('Token no proporcionado.');
    return jwt.verify(token, JWT_SECRET);
  }
}

module.exports = new AuthService();
