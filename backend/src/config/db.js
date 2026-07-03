/**
 * db.js — Singleton de PrismaClient para Prisma 7 + PostgreSQL
 * Usa el adapter @prisma/adapter-pg con la URL de .env
 * 
 * IMPORTANTE: require('dotenv').config() DEBE ejecutarse ANTES de
 * importar este módulo (se hace en index.js línea 1).
 */

const { Pool } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ ERROR: DATABASE_URL no está definida en .env');
  console.error('   Asegúrate de que el archivo backend/.env existe y contiene DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ['warn', 'error'],
});

console.log('🛠️ Prisma PostgreSQL conectado a:', connectionString.replace(/:([^@]+)@/, ':****@'));

module.exports = prisma;
