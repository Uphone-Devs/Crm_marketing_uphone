/**
 * auth.service.js — Lógica de autenticación.
 * Aislada de Express (SoC): No conoce req/res.
 */

const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'uphone-dev-secret-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

class AuthService {
  async login(email, password) {
    if (!email || !password) {
      throw new Error('Email y contraseña son requeridos.');
    }

    const usuario = await db.usuario.findUnique({ where: { email } });
    if (!usuario) {
      throw new Error('Credenciales inválidas.');
    }

    if (usuario.estado !== 'activo') {
      throw new Error('Cuenta deshabilitada. Contacte al supervisor.');
    }

    const passwordValido = await bcrypt.compare(password, usuario.passwordHash);
    if (!passwordValido) {
      throw new Error('Credenciales inválidas.');
    }

    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol, nombre: usuario.nombre },
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
      },
    };
  }

  verificarToken(token) {
    if (!token) throw new Error('Token no proporcionado.');
    return jwt.verify(token, JWT_SECRET);
  }
}

module.exports = new AuthService();
