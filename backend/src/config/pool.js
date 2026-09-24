/**
 * pool.js — Pool de conexiones de PostgreSQL.
 *
 * Vive separado de db.js para que el pool se pueda leer sin importar el cliente
 * de Prisma: el diagnóstico del error `Unable to start a transaction in the
 * given time` necesita los contadores del pool (ver infra/poolMetrics.js), y
 * db.js exporta el cliente de Prisma directamente, sin lugar donde colgarlos.
 *
 * IMPORTANTE: require('dotenv').config() DEBE ejecutarse ANTES de importar este
 * módulo (se hace en index.js línea 1).
 */

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ ERROR: DATABASE_URL no está definida en .env');
  console.error('   Asegúrate de que el archivo backend/.env existe y contiene DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 30,                    // 100 max_connections − 70 reserva
  idleTimeoutMillis: 30_000,  // liberar conexiones inactivas después de 30s
  connectionTimeoutMillis: 15_000, // 15s — más margen en picos de reconexión simultánea
  allowExitOnIdle: true,
});

pool.on('error', (err) => {
  console.error('[DB POOL] Error inesperado en cliente idle:', err.message);
});

module.exports = { pool, connectionString };
