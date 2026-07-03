-- ═══════════════════════════════════════════════════════════════
-- UPHONE Terminal de Cobranza v2.0 — Schema Unificado
-- Motor: SQLite (better-sqlite3 nativo)
-- Nota: Todos los CREATE son idempotentes (IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════

-- ── Usuarios (Supervisores + Asesores) ──────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT    NOT NULL,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  rol           TEXT    NOT NULL DEFAULT 'asesor' CHECK(rol IN ('supervisor','jefe_area','jefe','asesor','admin')),
  estado        TEXT    NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','inactivo')),
  creado_en     TEXT    DEFAULT (datetime('now'))
);

-- ── Campañas de Cobranza ────────────────────────────────────
CREATE TABLE IF NOT EXISTS campanas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT    NOT NULL,
  descripcion TEXT,
  fecha_inicio TEXT,
  fecha_fin    TEXT,
  supervisor_id INTEGER REFERENCES usuarios(id),
  estado      TEXT    NOT NULL DEFAULT 'activa' CHECK(estado IN ('activa','pausada','finalizada'))
);

-- ── Contactos (deudores asignados a campañas) ───────────────
CREATE TABLE IF NOT EXISTS contactos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  campana_id       INTEGER NOT NULL REFERENCES campanas(id),
  cedula           TEXT,
  nombre_deudor    TEXT,
  telefono         TEXT    NOT NULL,
  monto_deuda      REAL,
  producto         TEXT,
  estado_marcacion TEXT    NOT NULL DEFAULT 'PENDIENTE',
  intentos_realizados INTEGER NOT NULL DEFAULT 0,
  asignado_a       INTEGER REFERENCES usuarios(id),
  metadata         TEXT,
  whatsapp_status  TEXT    DEFAULT 'INACTIVO',
  rcs_status       TEXT    DEFAULT 'ACTIVO',
  correo_status    TEXT    DEFAULT 'INACTIVO',
  wsp_enviado_fecha     TEXT DEFAULT NULL,
  rcs_enviado_fecha     TEXT DEFAULT NULL,
  correo_enviado_fecha  TEXT DEFAULT NULL
);

-- ── Tipificaciones de llamadas ──────────────────────────────
CREATE TABLE IF NOT EXISTS tipificaciones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo       TEXT    UNIQUE NOT NULL,
  descripcion  TEXT    NOT NULL,
  requiere_agd INTEGER DEFAULT 0,
  categoria    TEXT    DEFAULT 'NO_CONTACTADO',
  finaliza_gestion INTEGER DEFAULT 1
);

-- ── CDR (Call Detail Records) ───────────────────────────────
CREATE TABLE IF NOT EXISTS cdrs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contacto_id      INTEGER NOT NULL REFERENCES contactos(id),
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id),
  tipificacion_id  INTEGER REFERENCES tipificaciones(id),
  timestamp_inicio  TEXT    NOT NULL,
  timestamp_ringing TEXT,
  timestamp_answered TEXT,
  timestamp_fin     TEXT,
  duracion_seg      INTEGER DEFAULT 0,
  latencia_ms       INTEGER DEFAULT 0,
  operadora         TEXT,
  resultado         TEXT,
  url_grabacion     TEXT,
  notas             TEXT,
  canal             TEXT    DEFAULT 'llamada' CHECK(canal IN ('llamada', 'whatsapp', 'rcs', 'gmail')),
  creado_en         TEXT    DEFAULT (datetime('now'))
);

-- ── Sesiones de trabajo ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sesiones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
  inicio        TEXT    NOT NULL DEFAULT (datetime('now')),
  fin           TEXT,
  tipo_conexion TEXT    CHECK(tipo_conexion IN ('USB','WIFI','LOCAL'))
);

-- ── Eventos de actividad ────────────────────────────────────
CREATE TABLE IF NOT EXISTS eventos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id),
  sesion_id    INTEGER REFERENCES sesiones(id),
  tipo         TEXT    NOT NULL CHECK(tipo IN ('ESTADO','LLAMADA','CONEXION','DESCONEXION','ACCION_RAPIDA')),
  estado_id    INTEGER,
  duracion_seg INTEGER,
  timestamp    TEXT    DEFAULT (datetime('now')),
  metadata     TEXT
);

-- ── Configuración del sistema ───────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

-- ── Agendamientos (M-006) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS agendamientos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contacto_id  INTEGER NOT NULL REFERENCES contactos(id),
  asesor_id    INTEGER NOT NULL REFERENCES usuarios(id),
  tipo         TEXT NOT NULL CHECK(tipo IN ('PMP','VOL_CALL')),
  fecha_hora   TEXT NOT NULL,
  notas        TEXT,
  estado       TEXT NOT NULL DEFAULT 'pendiente'
               CHECK(estado IN ('pendiente','ejecutado','cancelado')),
  creado_en    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agend_fecha   ON agendamientos(fecha_hora);
CREATE INDEX IF NOT EXISTS idx_agend_asesor  ON agendamientos(asesor_id);
CREATE INDEX IF NOT EXISTS idx_agend_estado  ON agendamientos(estado);

-- ── Índices para queries frecuentes ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_contactos_campana ON contactos(campana_id);
CREATE INDEX IF NOT EXISTS idx_contactos_estado ON contactos(estado_marcacion);
CREATE INDEX IF NOT EXISTS idx_cdrs_usuario ON cdrs(usuario_id);
CREATE INDEX IF NOT EXISTS idx_cdrs_contacto ON cdrs(contacto_id);
CREATE INDEX IF NOT EXISTS idx_eventos_usuario ON eventos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_eventos_timestamp ON eventos(timestamp);

-- ── Config defaults ─────────────────────────────────────────
INSERT OR IGNORE INTO config VALUES ('puerto_servidor', '3001');
INSERT OR IGNORE INTO config VALUES ('alerta_pausa_min', '10');
INSERT OR IGNORE INTO config VALUES ('max_fps_scrcpy', '30');
INSERT OR IGNORE INTO config VALUES ('ultima_ip_wifi', '');
INSERT OR IGNORE INTO config VALUES ('modo_marcacion', 'MANUAL');
INSERT OR IGNORE INTO config VALUES ('codigo_pais', '593');
INSERT OR IGNORE INTO config VALUES ('msg_template_wsp', 'Estimado/a {nombres_apellidos}, le informamos que su cuenta con cédula {cedula} presenta un saldo en mora de ${valor_mora}. Ofrecemos un valor promocional de ${valor_promocional} para regularizar su situación. Contáctenos para más información. UPHONE TEC SAS.');
INSERT OR IGNORE INTO config VALUES ('msg_template_sms', 'Estimado/a {nombres_apellidos}, su cuenta ({cedula}) tiene un saldo pendiente de ${valor_mora}. Valor promocional: ${valor_promocional}. Comuníquese con nosotros. UPHONE TEC.');
INSERT OR IGNORE INTO config VALUES ('msg_template_email_subject', 'Notificación de Cobro - Cuenta {cedula}');
INSERT OR IGNORE INTO config VALUES ('msg_template_email_body', 'Estimado/a {nombres_apellidos},\n\nPor medio de la presente le notificamos que su cuenta identificada con cédula {cedula} presenta un saldo en mora de ${valor_mora}.\n\nLe ofrecemos un valor promocional de ${valor_promocional} para regularizar su situación.\n\nQuedamos a su disposición.\n\nAtentamente,\nDepartamento de Cobranza\nUPHONE TEC SAS');

-- ── Seed Data manejado por db.js ─────────────────────────

-- ── Indicadores de Recaudo (Dinámicos por asesor) ────────────
DROP TABLE IF EXISTS indicadores_recaudo;

-- ── Mensajes Broadcast (Supervisor a Asesores) ───────────────
CREATE TABLE IF NOT EXISTS mensajes_broadcast (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  supervisor_id    INTEGER NOT NULL REFERENCES usuarios(id),
  mensaje          TEXT    NOT NULL,
  segmento_destino TEXT    NOT NULL DEFAULT 'TODOS',
  creado_en        TEXT    DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS indicadores_datos (
  asesor_id INTEGER NOT NULL,
  fecha     TEXT NOT NULL,
  segmento  TEXT NOT NULL,
  valores   TEXT DEFAULT '{}',
  PRIMARY KEY (asesor_id, fecha, segmento),
  FOREIGN KEY (asesor_id) REFERENCES usuarios (id) ON DELETE CASCADE
);
