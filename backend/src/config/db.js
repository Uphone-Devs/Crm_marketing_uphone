/**
 * db.js — Singleton de PrismaClient con Driver Adapter (Prisma v7).
 *
 * Prisma v7 usa el patrón Factory: PrismaBetterSqlite3 almacena la config
 * y crea la conexión lazily al llamar connect(). La URL del datasource
 * se inyecta desde prisma.config.ts en el CLI, pero en runtime hay que
 * pasarla explícitamente al adapter.
 *
 * Patrón Strategy: Si DEPLOY_MODE === 'cloud', cambiar este archivo
 * para usar @prisma/adapter-pg sin tocar ningún otro archivo.
 */

const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

// prisma.config.ts usa 'file:./dev.db' relativo al CWD (backend/), así que dev.db está en backend/
const DB_PATH = path.join(__dirname, '../../dev.db');
const DB_URL = `file:${DB_PATH}`;

console.log(`🛠️ Prisma SQLite → ${DB_PATH}`);

const adapter = new PrismaBetterSqlite3({ url: DB_URL });

const prisma = new PrismaClient({
  adapter,
  log: ['warn', 'error'],
});

module.exports = prisma;
