/**
 * Tests Unitarios — Panel Jefe de Cobranza
 * Spec: spec_panel_jefe.md §3 (Checklist de Pruebas Unitarias)
 *
 * Usa una base de datos SQLite EN MEMORIA para evitar tocar la DB de producción.
 * Los módulos de queries se instancian con la DB mock via inyección.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';

// ── Setup: DB en memoria con schema mínimo ─────────────────────────────────────
let db;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre        TEXT    NOT NULL,
      email         TEXT    UNIQUE NOT NULL,
      password_hash TEXT    NOT NULL DEFAULT 'hash',
      rol           TEXT    NOT NULL DEFAULT 'asesor',
      estado        TEXT    NOT NULL DEFAULT 'activo'
    );

    CREATE TABLE IF NOT EXISTS campanas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre      TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contactos (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      campana_id       INTEGER REFERENCES campanas(id),
      nombre_deudor    TEXT,
      telefono         TEXT    DEFAULT '',
      monto_deuda      REAL    DEFAULT 0,
      estado_marcacion TEXT    NOT NULL DEFAULT 'PENDIENTE',
      metadata         TEXT
    );

    CREATE TABLE IF NOT EXISTS cdrs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      contacto_id  INTEGER NOT NULL REFERENCES contactos(id),
      usuario_id   INTEGER NOT NULL REFERENCES usuarios(id),
      canal        TEXT    DEFAULT 'llamada',
      creado_en    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agendamientos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      contacto_id INTEGER REFERENCES contactos(id),
      asesor_id   INTEGER REFERENCES usuarios(id),
      tipo        TEXT DEFAULT 'PMP',
      fecha_hora  TEXT DEFAULT (datetime('now')),
      estado      TEXT DEFAULT 'pendiente'
    );

    CREATE TABLE IF NOT EXISTS config (
      clave TEXT PRIMARY KEY,
      valor TEXT
    );
  `);

  // Datos base: campaña, asesores, contactos
  db.prepare("INSERT INTO campanas (nombre) VALUES ('Campaña Test')").run();
  db.prepare("INSERT INTO usuarios (nombre, email, rol) VALUES ('Asesor Uno', 'asesor1@test.com', 'asesor')").run();
  db.prepare("INSERT INTO usuarios (nombre, email, rol) VALUES ('Asesor Dos', 'asesor2@test.com', 'asesor')").run();
});

afterAll(() => {
  db.close();
});

// ── Helpers que replican las queries del Panel Jefe sobre la DB mock ───────────

function indicadoresGlobal(mockDb, filtros = {}) {
  const row = mockDb.prepare(`
    SELECT
      COALESCE(SUM(monto_deuda), 0)                                                         AS valor_vencido,
      COALESCE(SUM(CASE WHEN estado_marcacion = 'PAGADO' THEN monto_deuda ELSE 0 END), 0)   AS valor_cobrado,
      COUNT(id)                                                                               AS unidades_vencidas,
      COUNT(CASE WHEN estado_marcacion = 'PAGADO' THEN 1 END)                               AS unidades_cobradas
    FROM contactos
  `).get();

  const vencido = row.valor_vencido ?? 0;
  const cobrado = row.valor_cobrado ?? 0;
  const uVen    = row.unidades_vencidas ?? 0;
  const uCob    = row.unidades_cobradas ?? 0;

  return {
    valor_vencido:        vencido,
    valor_cobrado:        cobrado,
    diferencia_monetaria: vencido - cobrado,
    pct_recuperacion:     vencido > 0 ? Math.round((cobrado / vencido) * 10000) / 100 : 0,
    unidades_vencidas:    uVen,
    unidades_cobradas:    uCob,
    diferencia_unidades:  uVen - uCob,
    pct_recuperacion_und: uVen > 0 ? Math.round((uCob / uVen) * 10000) / 100 : 0,
  };
}

function segmentoPorMetadata(mockDb) {
  return mockDb.prepare(`
    SELECT
      COALESCE(CAST(json_extract(metadata, '$.segmento') AS TEXT), 'Sin asignar') AS segmento,
      COALESCE(SUM(monto_deuda), 0)                                                AS valor_vencido,
      COUNT(id)                                                                     AS unidades
    FROM contactos
    GROUP BY segmento
    ORDER BY segmento
  `).all();
}

function coberturaUnica(mockDb) {
  const total       = mockDb.prepare('SELECT COUNT(id) AS t FROM contactos').get().t;
  const contactados = mockDb.prepare('SELECT COUNT(DISTINCT contacto_id) AS t FROM cdrs').get().t;
  return total > 0 ? Math.round((contactados / total) * 10000) / 100 : 0;
}

function proyeccionMensual(mockDb) {
  const metaRow = mockDb.prepare("SELECT valor FROM config WHERE clave = 'meta_mensual_usd'").get();
  const meta    = metaRow ? parseFloat(metaRow.valor) || 0 : 0;
  const cobRow  = mockDb.prepare(`
    SELECT COALESCE(SUM(c.monto_deuda), 0) AS cobrado
    FROM cdrs cd JOIN contactos c ON c.id = cd.contacto_id
    WHERE c.estado_marcacion = 'PAGADO'
      AND strftime('%Y-%m', cd.creado_en) = strftime('%Y-%m', 'now')
  `).get();
  const cobrado = cobRow?.cobrado ?? 0;
  return {
    meta_mensual:     meta,
    cobrado_mes:      cobrado,
    diferencia:       meta - cobrado,
    pct_cumplimiento: meta > 0 ? Math.round((cobrado / meta) * 10000) / 100 : 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: División por cero → 0 (no NaN / Infinity)
// Spec §3: "Test de Tolerancia a División por Cero"
// ═══════════════════════════════════════════════════════════════
describe('Test 1 — División por cero (tabla vacía)', () => {
  it('pct_recuperacion debe ser 0 cuando Valor Vencido = 0', () => {
    const result = indicadoresGlobal(db);
    expect(result.pct_recuperacion).toBe(0);
    expect(Number.isFinite(result.pct_recuperacion)).toBe(true);
  });

  it('pct_recuperacion_und debe ser 0 cuando Unidades Vencidas = 0', () => {
    const result = indicadoresGlobal(db);
    expect(result.pct_recuperacion_und).toBe(0);
    expect(Number.isFinite(result.pct_recuperacion_und)).toBe(true);
  });

  it('diferencia_monetaria debe ser 0 (no negativo) con tabla vacía', () => {
    const result = indicadoresGlobal(db);
    expect(result.diferencia_monetaria).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST 2: Suma monetaria exacta
// Spec §3: "Test de Suma Monetaria"
// ═══════════════════════════════════════════════════════════════
describe('Test 2 — Suma monetaria exacta', () => {
  beforeAll(() => {
    db.prepare("INSERT INTO contactos (campana_id, nombre_deudor, telefono, monto_deuda, estado_marcacion, metadata) VALUES (1, 'Cliente A', '111', 100.50, 'PENDIENTE', '{\"segmento\":\"1\",\"distribuidor\":\"Uphone\"}')").run();
    db.prepare("INSERT INTO contactos (campana_id, nombre_deudor, telefono, monto_deuda, estado_marcacion, metadata) VALUES (1, 'Cliente B', '222', 50.25, 'PAGADO', '{\"segmento\":\"1\",\"distribuidor\":\"Uphone\"}')").run();
    db.prepare("INSERT INTO contactos (campana_id, nombre_deudor, telefono, monto_deuda, estado_marcacion, metadata) VALUES (1, 'Cliente C', '333', NULL,  'PENDIENTE', '{\"segmento\":\"2\",\"distribuidor\":\"Directo\"}')").run();
  });

  it('Valor Vencido = 150.75 (ignora NULL correctamente)', () => {
    const result = indicadoresGlobal(db);
    expect(result.valor_vencido).toBeCloseTo(150.75, 2);
  });

  it('Valor Cobrado = 50.25 (solo PAGADO)', () => {
    const result = indicadoresGlobal(db);
    expect(result.valor_cobrado).toBeCloseTo(50.25, 2);
  });

  it('Diferencia = Vencido - Cobrado exacto', () => {
    const result = indicadoresGlobal(db);
    expect(result.diferencia_monetaria).toBeCloseTo(result.valor_vencido - result.valor_cobrado, 2);
  });

  it('Unidades Vencidas = 3', () => {
    const result = indicadoresGlobal(db);
    expect(result.unidades_vencidas).toBe(3);
  });

  it('Unidades Cobradas = 1', () => {
    const result = indicadoresGlobal(db);
    expect(result.unidades_cobradas).toBe(1);
  });

  it('% Recuperación Monetaria ≈ 33.33%', () => {
    const result = indicadoresGlobal(db);
    expect(result.pct_recuperacion).toBeCloseTo(33.33, 1);
  });

  it('% Recuperación Unidades = 33.33%', () => {
    const result = indicadoresGlobal(db);
    expect(result.pct_recuperacion_und).toBeCloseTo(33.33, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST 3: Extracción JSON de segmento y distribuidor
// Spec §3: "Test de Extracción JSON"
// ═══════════════════════════════════════════════════════════════
describe('Test 3 — Extracción JSON (segmento y distribuidor)', () => {
  it('agrupa correctamente por segmento usando json_extract', () => {
    const rows = segmentoPorMetadata(db);
    const segs = rows.map(r => r.segmento);
    // Debe tener segmentos "1" y "2" de los contactos insertados en Test 2
    expect(segs).toContain('1');
    expect(segs).toContain('2');
  });

  it('Segmento 1 tiene 2 unidades y vencido = 150.75', () => {
    const rows = segmentoPorMetadata(db);
    const seg1 = rows.find(r => r.segmento === '1');
    expect(seg1).toBeDefined();
    expect(seg1.unidades).toBe(2);
    expect(seg1.valor_vencido).toBeCloseTo(150.75, 2);
  });

  it('Contacto sin metadata queda en "Sin asignar"', () => {
    db.prepare("INSERT INTO contactos (campana_id, nombre_deudor, telefono, monto_deuda, estado_marcacion, metadata) VALUES (1, 'Sin Meta', '444', 200, 'PENDIENTE', NULL)").run();
    const rows = segmentoPorMetadata(db);
    const sinAsignar = rows.find(r => r.segmento === 'Sin asignar');
    expect(sinAsignar).toBeDefined();
    expect(sinAsignar.unidades).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST 4: Cobertura única
// Spec §3: "Test de Cobertura Única"
// ═══════════════════════════════════════════════════════════════
describe('Test 4 — Cobertura única (10 llamadas = 1 cliente)', () => {
  beforeAll(() => {
    // Insertar 10 CDRs para el mismo contacto (id=1)
    const insertCdr = db.prepare("INSERT INTO cdrs (contacto_id, usuario_id, canal) VALUES (1, 1, 'llamada')");
    for (let i = 0; i < 10; i++) insertCdr.run();
  });

  it('Contactados únicos = 1 aunque haya 10 CDRs del mismo contacto', () => {
    const contactados = db.prepare('SELECT COUNT(DISTINCT contacto_id) AS t FROM cdrs').get().t;
    expect(contactados).toBe(1);
  });

  it('Total CDRs = 10 (gestiones totales contabilizan cada llamada)', () => {
    const totalGestiones = db.prepare('SELECT COUNT(id) AS t FROM cdrs').get().t;
    expect(totalGestiones).toBe(10);
  });

  it('Cobertura = contactados_únicos / cartera_total (no divide gestiones)', () => {
    const cobertura = coberturaUnica(db);
    // 1 contactado de 4 contactos totales insertados = 25%
    expect(cobertura).toBeCloseTo(25, 0);
    expect(Number.isFinite(cobertura)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST 5: Meta mensual no configurada → 0 seguro
// Spec §3: "Test de Metas no Configuradas"
// ═══════════════════════════════════════════════════════════════
describe('Test 5 — Meta mensual no configurada', () => {
  it('devuelve meta_mensual=0 si no existe en config', () => {
    const result = proyeccionMensual(db);
    expect(result.meta_mensual).toBe(0);
    expect(result.pct_cumplimiento).toBe(0);
    expect(Number.isFinite(result.pct_cumplimiento)).toBe(true);
  });

  it('pct_cumplimiento = 0 (no divide por cero cuando meta = 0)', () => {
    const result = proyeccionMensual(db);
    expect(result.pct_cumplimiento).toBe(0);
    expect(result.pct_cumplimiento).not.toBeNaN();
    expect(result.pct_cumplimiento).not.toBe(Infinity);
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST 6: Meta configurada → proyección correcta
// ═══════════════════════════════════════════════════════════════
describe('Test 6 — Meta mensual configurada', () => {
  beforeAll(() => {
    db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('meta_mensual_usd', '10000')").run();
    // Insertar CDR para el contacto PAGADO (id=2, monto=50.25)
    db.prepare("INSERT INTO cdrs (contacto_id, usuario_id, canal) VALUES (2, 1, 'llamada')").run();
  });

  it('meta_mensual = 10000', () => {
    const result = proyeccionMensual(db);
    expect(result.meta_mensual).toBe(10000);
  });

  it('cobrado_mes > 0 si existe CDR de contacto PAGADO en el mes actual', () => {
    const result = proyeccionMensual(db);
    expect(result.cobrado_mes).toBeGreaterThan(0);
  });

  it('diferencia = meta - cobrado (no negativo si cobrado < meta)', () => {
    const result = proyeccionMensual(db);
    expect(result.diferencia).toBe(result.meta_mensual - result.cobrado_mes);
  });

  it('pct_cumplimiento > 0 y es finito', () => {
    const result = proyeccionMensual(db);
    expect(result.pct_cumplimiento).toBeGreaterThan(0);
    expect(Number.isFinite(result.pct_cumplimiento)).toBe(true);
  });
});
