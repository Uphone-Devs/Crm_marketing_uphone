/**
 * server.js — Entry point headless (sin Electron) para deploy en VM/servidor.
 * PM2 apunta a este archivo, no a index.js (que lanza Electron GUI).
 */
require('dotenv').config();

const { initDatabase } = require('./database/db');
const { initApiServer } = require('./apiServer');

initDatabase();
initApiServer(parseInt(process.env.PORT) || 3001);

process.on('uncaughtException',  (err) => console.error('[FATAL]', err.message));
process.on('unhandledRejection', (err) => console.error('[FATAL]', err.message));
