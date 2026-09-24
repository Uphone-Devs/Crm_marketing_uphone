/**
 * db.js — Singleton de PrismaClient para Prisma 7 + PostgreSQL
 * Usa el adapter @prisma/adapter-pg sobre el pool de config/pool.js
 *
 * IMPORTANTE: require('dotenv').config() DEBE ejecutarse ANTES de
 * importar este módulo (se hace en index.js línea 1).
 */

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { pool, connectionString } = require('./pool');

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ['warn', 'error'],
});

console.log('🛠️ Prisma PostgreSQL conectado a:', connectionString.replace(/:([^@]+)@/, ':****@'));

module.exports = prisma;
