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
// -> cloudflared -> 127.0.0.1:PORT), así que el único hop real es desde loopback. Sin esto,
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

// ── Auto-update: artefactos públicos (latest.yml + .exe) ──────
app.use('/updates', express.static(path.join(__dirname, '../updates')));

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
  // Socket already closed (request aborted) — don't try to respond, it would crash Node.
  if (res.headersSent || req.socket?.destroyed) return;
  console.error('[Error]', err.stack);
  const status = err.status || err.statusCode || 500;
  const safeMsg = status < 500 ? err.message : 'Error interno del servidor';
  try { res.status(status).json({ error: safeMsg }); } catch (_) { /* socket closed mid-response */ }
});

// ── Guard against unhandled errors crashing the process ───────
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// ── Server startup — schema-heal ANTES de aceptar requests ───
// ADD COLUMN IF NOT EXISTS es idempotente; no hace nada si la columna ya existe.
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

async function schemaHeal() {
  // Cada sentencia por separado: si una falla, las demás siguen. Log del error real.
  // NOTA: ALTER TABLE mensajes_broadcast requiere ser dueño de la tabla.
  // Correr una vez como superuser en prod:
  //   ALTER TABLE mensajes_broadcast ADD COLUMN IF NOT EXISTS canal      VARCHAR(20) NOT NULL DEFAULT 'TODOS';
  //   ALTER TABLE mensajes_broadcast ADD COLUMN IF NOT EXISTS asunto     VARCHAR(255);
  //   ALTER TABLE mensajes_broadcast ADD COLUMN IF NOT EXISTS imagen_url TEXT;
  const stmts = [
    [`mensajes_broadcast_empresa`, `
      ALTER TABLE mensajes_broadcast ADD COLUMN IF NOT EXISTS empresa VARCHAR(20)
    `],
    [`metricas_diarias_asesor`, `
      CREATE TABLE IF NOT EXISTS metricas_diarias_asesor (
        asesor_id       INTEGER          NOT NULL,
        fecha           TEXT             NOT NULL,
        gestiones       INTEGER          NOT NULL DEFAULT 0,
        efectivos       INTEGER          NOT NULL DEFAULT 0,
        neutros         INTEGER          NOT NULL DEFAULT 0,
        no_contact      INTEGER          NOT NULL DEFAULT 0,
        compromisos     INTEGER          NOT NULL DEFAULT 0,
        monto_acordado  DOUBLE PRECISION NOT NULL DEFAULT 0,
        monto_recaudado DOUBLE PRECISION NOT NULL DEFAULT 0,
        tiempo_aire_seg INTEGER          NOT NULL DEFAULT 0,
        actualizado_en  TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
        CONSTRAINT metricas_diarias_asesor_pkey PRIMARY KEY (asesor_id, fecha)
      )`],
    [`update_policy`, `
      CREATE TABLE IF NOT EXISTS update_policy (
        id                 INTEGER      NOT NULL DEFAULT 1,
        enabled            BOOLEAN      NOT NULL DEFAULT false,
        start_time         TEXT         NOT NULL DEFAULT '13:00',
        end_time           TEXT         NOT NULL DEFAULT '14:00',
        days               INTEGER[]    NOT NULL DEFAULT '{1,2,3,4,5}',
        check_interval_min INTEGER      NOT NULL DEFAULT 30,
        updated_at         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        CONSTRAINT update_policy_pkey PRIMARY KEY (id)
      )`],
  ];
  for (const [label, sql] of stmts) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch (e) {
      console.error(`[schema-heal] FALLÓ ${label}:`, e.message);
    }
  }
  console.log('[schema-heal] completado');
}

schemaHeal().finally(() => {
  server.listen(PORT, HOST, () => {
    console.log(`API + WebSocket escuchando en ${HOST}:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  });
});

// systemd envía SIGTERM, no SIGINT: sin este handler el proceso moría sin cerrar
// el servidor HTTP ni drenar el pool de Prisma en cada `systemctl restart`.
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

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

// Manejo de Upgrade para WebSockets Nativos (Monitor).
// Retirado socket.io, todo upgrade corresponde al WS de monitoreo. La sesión sigue
// autenticándose en el mensaje IDENTIFICAR (ver wsServer.js), no aquí.
server.on('upgrade', (request, socket, head) => {
  monitorWss.handleUpgrade(request, socket, head, (ws) => {
    monitorWss.emit('connection', ws, request);
  });
});
