// .env SIEMPRE el de backend/ (path absoluto): dotenv por defecto lee el del
// directorio actual, y arrancar desde la raíz del proyecto conectaba a otra
// base de datos (la de desarrollo de Prisma) en vez de crm_marketing.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const db = require('./config/db');
const setupWsServer = require('./wsServer');
const { authMiddleware } = require('./middleware/auth.middleware');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

// ── CORS ──────────────────────────────────────────────────────
// CORS_ORIGIN en .env: lista separada por comas de orígenes permitidos.
// Default: permite Electron (sin origin) + localhost + LAN 192.168.x.x
const _corsWhitelist = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : null;

const corsOptions = {
  origin: _corsWhitelist || function (origin, cb) {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$/.test(origin)) {
      cb(null, true);
    } else {
      cb(new Error('CORS: origen no permitido'));
    }
  },
};

// ── Middleware global ─────────────────────────────────────────
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Servir archivos de grabaciones — requiere JWT válido ──────
app.use('/uploads', authMiddleware, express.static(path.join(__dirname, '../uploads')));

// ── Rutas REST ────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth.routes'));
app.use('/api/campanas',  require('./routes/campanas.routes'));
app.use('/api/contactos', require('./routes/contactos.routes'));
app.use('/api/cdrs',      require('./routes/cdrs.routes'));
app.use('/api/admin',     require('./routes/admin.routes'));
app.use('/api',           require('./routes/supervisor.routes'));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ── Sockets ───────────────────────────────────────────────────
const setupCallSockets = require('./sockets/call.socket');
setupCallSockets(io);

// ── Native Monitoring WS Server ───────────────────────────────
const monitorWss = setupWsServer(server);

// ── Error handling middleware ─────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack);
  // No exponer detalles internos (paths Prisma, stack traces) al cliente
  const status = err.status || err.statusCode || 500;
  const safeMsg = status < 500 ? err.message : 'Error interno del servidor';
  res.status(status).json({ error: safeMsg });
});

// ── Crear tablas auxiliares que no están en el schema Prisma ─
db.$executeRaw`
  CREATE TABLE IF NOT EXISTS sub_gestiones (
    id          SERIAL PRIMARY KEY,
    contacto_id INTEGER REFERENCES contactos(id) ON DELETE CASCADE,
    asesor_id   INTEGER REFERENCES usuarios(id)  ON DELETE SET NULL,
    cdr_id      INTEGER REFERENCES cdrs(id)      ON DELETE SET NULL,
    telefono    TEXT,
    notas       TEXT,
    nombre_ref  TEXT,
    parentesco  TEXT,
    creado_en   TIMESTAMP DEFAULT NOW()
  )
`.catch(e => console.warn('[INIT] sub_gestiones create warning:', e.message));

// ── Server startup ────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

process.on('SIGINT', async () => {
  await db.$disconnect();
  process.exit(0);
});

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`🚀 API + Socket.io Server running on ${HOST}:${PORT}`);
});

// Manejo de Upgrade para WebSockets Nativos (Monitor)
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  // Si no es un request de Socket.io (que usualmente empieza por /socket.io),
  // permitir que el monitorWss lo maneje.
  if (!pathname.startsWith('/socket.io')) {
    monitorWss.handleUpgrade(request, socket, head, (ws) => {
      monitorWss.emit('connection', ws, request);
    });
  }
});
