// .env SIEMPRE el de backend/ (path absoluto). override:true fuerza el valor
// aunque el proceso padre (Electron dev) ya haya inyectado DATABASE_URL del
// root .env (Prisma Postgres local). Sin override, dotenv no sobreescribe vars
// existentes y el backend queda apuntando a prisma+postgres://localhost:51213/
// (no arranca solo), rompiendo toda la API REST.
require('dotenv').config({ path: require('path').join(__dirname, '../.env'), override: true });
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const db = require('./config/db');
const setupWsServer = require('./wsServer');
const { authMiddleware } = require('./middleware/auth.middleware');

const app = express();
// El backend siempre corre detrás de cloudflared en la misma VM (Internet -> Cloudflare
// -> cloudflared -> 127.0.0.1:3001), así que el único hop real es desde loopback. Sin esto,
// express-rate-limit no puede confiar en X-Forwarded-For y falla identificando al cliente
// (ERR_ERL_UNEXPECTED_X_FORWARDED_FOR), degradando el rate-limit de login a una clave compartida.
app.set('trust proxy', 'loopback');
const server = http.createServer(app);

// Socket.io retirado: el namespace /calls (sockets/call.socket.js) no exigía
// autenticación y ningún cliente lo consumía — el renderer usa el WS nativo y no
// incluye socket.io-client. Los archivos siguen en el árbol por si el flujo de
// llamadas se retoma; volver a montarlo requiere autenticar el handshake.

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

// ── Liveness: responde mientras el proceso siga en pie ────────
app.get('/live', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ── Readiness: solo OK si la base responde ───────────────────
// Un health que no consulta la base deja al túnel enrutando tráfico a un
// backend con PostgreSQL caído, y el problema se ve como errores sueltos
// en los paneles en vez de como una caída.
app.get('/health', async (req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'OK', db: 'up', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[HEALTH] Base no disponible:', err.message);
    res.status(503).json({ status: 'DEGRADED', db: 'down' });
  }
});

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

// ── Server startup ────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

// Por defecto solo loopback: el acceso externo entra por el túnel de Cloudflare,
// que corre en la misma VM. Exponer en 0.0.0.0 debe ser una decisión explícita.
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`🚀 API + WebSocket escuchando en ${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
});

// Apagado ordenado: cierra el servidor HTTP y drena el pool de Prisma antes de salir.
// Sin esto, cada reinicio deja conexiones colgadas en pg_stat_activity hasta que
// Postgres las expira solo.
let cerrando = false;
async function apagar(senal) {
  if (cerrando) return;
  cerrando = true;
  console.log(`[APP] ${senal} recibido — cerrando...`);

  const forzar = setTimeout(() => {
    console.error('[APP] Cierre forzado tras 10s');
    process.exit(1);
  }, 10_000);
  forzar.unref();

  server.close(async () => {
    try {
      await db.$disconnect();
    } catch (err) {
      console.error('[APP] Error al desconectar Prisma:', err.message);
    }
    console.log('[APP] Cierre limpio');
    process.exit(0);
  });
}

// En Linux/systemd basta con las senales. La VM de produccion es Windows Server, que
// no tiene senales POSIX: process.kill() ahi termina el proceso de forma incondicional
// (equivale a SIGKILL), asi que estos dos handlers NUNCA se ejecutan bajo PM2 en la VM.
// Se dejan porque si aplican en desarrollo local y en cualquier host Unix.
process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

// El camino real de apagado en la VM: PM2 suple la falta de senales mandando el string
// 'shutdown' por el canal IPC antes de matar el proceso (respeta --kill-timeout). Sin
// este handler, `pm2 restart` nunca llama a db.$disconnect().
// Si el proceso corre sin PM2 no hay canal IPC y el listener simplemente no se dispara.
process.on('message', (msg) => {
  if (msg === 'shutdown') apagar('shutdown (PM2)');
});

// Manejo de Upgrade para WebSockets Nativos (Monitor).
// Retirado socket.io, todo upgrade corresponde al WS de monitoreo. La sesión sigue
// autenticándose en el mensaje IDENTIFICAR (ver wsServer.js), no aquí.
server.on('upgrade', (request, socket, head) => {
  monitorWss.handleUpgrade(request, socket, head, (ws) => {
    monitorWss.emit('connection', ws, request);
  });
});
