require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const db = require('./config/db');
const setupWsServer = require('./wsServer');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

// ── Middleware global ─────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Servir archivos de grabaciones (mock S3) ──────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
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
