/**
 * db.js — Singleton de base de datos local (better-sqlite3 nativo).
 *
 * Decisión de diseño: better-sqlite3 vs sql.js WASM vs Prisma runtime:
 *   - better-sqlite3: Sincrónico, ~10x más rápido, menor huella de memoria
 *   - sql.js: Requiere WASM, asíncrono, más lento en queries pesadas
 *   - Prisma runtime: Overhead del query engine (~8MB), innecesario para local
 *
 * Strategy Pattern: Para migración a cloud, reemplazar este archivo con un
 * cliente PostgreSQL (pg). La interfaz pública (getDb/closeDb) se mantiene.
 */

const path = require('path');
const fs = require('fs');

let db = null;
let dbPath = null;

/**
 * Intenta obtener la ruta de userData de Electron.
 * Si estamos fuera de Electron (tests, scripts), usa una ruta fallback.
 */
function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'terminal-cobranza', 'terminal.db');
  } catch {
    // Fallback para ejecución fuera de Electron (tests, seed)
    return path.join(__dirname, '..', '..', '..', 'data', 'terminal.db');
  }
}

/**
 * Inicializa la base de datos.
 * 1. Crea el directorio si no existe
 * 2. Abre (o crea) el archivo .db
 * 3. Ejecuta el schema DDL (IF NOT EXISTS, idempotente)
 * 4. Ejecuta seed si la tabla está vacía
 */
function initDatabase() {
  const Database = require('better-sqlite3');

  dbPath = resolveDbPath();
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Optimizaciones SQLite para rendimiento local
  db.pragma('journal_mode = WAL');       // Write-Ahead Log: lecturas no bloquean escrituras
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');     // Balance entre seguridad y velocidad
  db.pragma('cache_size = -8000');       // 8MB de caché en memoria

  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  // MIGRACIÓN: Añadir columnas si no existen (SQLite no soporta ADD COLUMN IF NOT EXISTS directamente con múltiples columnas)
  try {
    const columns = db.prepare("PRAGMA table_info(cdrs)").all();
    const columnNames = columns.map(c => c.name);
    
    if (!columnNames.includes('timestamp_ringing')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN timestamp_ringing TEXT").run();
    }
    if (!columnNames.includes('timestamp_answered')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN timestamp_answered TEXT").run();
    }
    if (!columnNames.includes('latencia_ms')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN latencia_ms INTEGER DEFAULT 0").run();
    }
    if (!columnNames.includes('operadora')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN operadora TEXT").run();
    }
    if (!columnNames.includes('canal')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN canal TEXT DEFAULT 'llamada'").run();
    }
    console.log('[DB] Migración de columnas de métricas completada');
  } catch (err) {
    console.warn('[DB] Error en migración CDR (posiblemente ya migrado):', err.message);
  }

  // MIGRACIÓN: Columnas para variables de mensajes de cobranza
  try {
    const colsContactos = db.prepare("PRAGMA table_info(contactos)").all();
    const colNamesContactos = colsContactos.map(c => c.name);

    if (!colNamesContactos.includes('cedula')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN cedula TEXT DEFAULT ''").run();
    }
    if (!colNamesContactos.includes('metadata')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN metadata TEXT").run();
    }
    if (!colNamesContactos.includes('valor_promocional')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN valor_promocional REAL DEFAULT 0").run();
    }
    console.log('[DB] Migración de columnas contactos (cedula, metadata, valor_promocional) completada');
  } catch (err) {
    console.warn('[DB] Error en migración contactos:', err.message);
  }

  // MIGRACIÓN: Trazabilidad de supervisor en campañas
  try {
    const colsCamp = db.prepare("PRAGMA table_info(campanas)").all();
    const colNamesCamp = colsCamp.map(c => c.name);
    if (!colNamesCamp.includes('supervisor_id')) {
      db.prepare("ALTER TABLE campanas ADD COLUMN supervisor_id INTEGER REFERENCES usuarios(id)").run();
    }
    console.log('[DB] Migración de columna supervisor_id en campanas completada');
  } catch (err) {
    console.warn('[DB] Error en migración campanas (supervisor_id):', err.message);
  }

  // MIGRACIÓN: Control de intentos de marcación por contacto
  try {
    const colsContactos = db.prepare("PRAGMA table_info(contactos)").all();
    const colNamesContactos = colsContactos.map(c => c.name);
    if (!colNamesContactos.includes('intentos_realizados')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN intentos_realizados INTEGER NOT NULL DEFAULT 0").run();
    }
    console.log('[DB] Migración de columna intentos_realizados en contactos completada');
  } catch (err) {
    console.warn('[DB] Error en migración intentos_realizados:', err.message);
  }

  // M-004+M-005: Migración tipificaciones — columna categoria + finaliza_gestion + nuevos estados
  try {
    const colsTipif = db.prepare("PRAGMA table_info(tipificaciones)").all();
    const colNamesTipif = colsTipif.map(c => c.name);

    if (!colNamesTipif.includes('categoria')) {
      db.prepare("ALTER TABLE tipificaciones ADD COLUMN categoria TEXT DEFAULT 'NO_CONTACTADO'").run();
      // Clasificar existentes
      db.prepare("UPDATE tipificaciones SET categoria='CONTACTO_EFECTIVO' WHERE codigo IN ('PMP','RECH','TIT_FAL','VOL_CALL')").run();
      db.prepare("UPDATE tipificaciones SET categoria='NO_CONTACTADO' WHERE codigo IN ('NC','NE','ILOC')").run();
      // Renombrar RECH
      db.prepare("UPDATE tipificaciones SET descripcion='Negativa de pago' WHERE codigo='RECH'").run();
    }

    if (!colNamesTipif.includes('finaliza_gestion')) {
      db.prepare("ALTER TABLE tipificaciones ADD COLUMN finaliza_gestion INTEGER DEFAULT 1").run();
      // PMP y VOL_CALL no finalizan — quedan para agendar (M-006)
      db.prepare("UPDATE tipificaciones SET finaliza_gestion=0 WHERE codigo IN ('PMP','VOL_CALL')").run();
    }

    // Nuevos estados M-005
    db.prepare("INSERT OR IGNORE INTO tipificaciones (codigo, descripcion, requiere_agd, categoria, finaliza_gestion) VALUES ('PAGO_REAL','Pago realizado',1,'CONTACTO_EFECTIVO',1)").run();
    db.prepare("INSERT OR IGNORE INTO tipificaciones (codigo, descripcion, requiere_agd, categoria, finaliza_gestion) VALUES ('PEND_COMP','Pendiente registro comprobante',1,'CONTACTO_EFECTIVO',1)").run();

    console.log('[DB] Migración tipificaciones (categoria, finaliza_gestion, nuevos estados) completada');
  } catch (err) {
    console.warn('[DB] Error en migración tipificaciones:', err.message);
  }

  // M-004+M-005: Estado AGENDADO habilitado en contactos
  try {
    console.log('[DB] Estado AGENDADO habilitado en contactos');
  } catch (err) {
    console.warn('[DB] Error en migración estado AGENDADO:', err.message);
  }

  // M-006: Tabla agendamientos
  try {
    const colsAgend = db.prepare("PRAGMA table_info(agendamientos)").all();
    if (colsAgend.length === 0) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agendamientos (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          contacto_id  INTEGER NOT NULL REFERENCES contactos(id),
          asesor_id    INTEGER NOT NULL REFERENCES usuarios(id),
          tipo         TEXT NOT NULL CHECK(tipo IN ('PMP','VOL_CALL','REAGENDADO')),
          fecha_hora   TEXT NOT NULL,
          notas        TEXT,
          estado       TEXT NOT NULL DEFAULT 'pendiente'
                       CHECK(estado IN ('pendiente','ejecutado','cancelado')),
          creado_en    TEXT DEFAULT (datetime('now'))
        )
      `);
      db.exec("CREATE INDEX IF NOT EXISTS idx_agend_fecha  ON agendamientos(fecha_hora)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_agend_asesor ON agendamientos(asesor_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_agend_estado ON agendamientos(estado)");
      console.log('[DB] Migración tabla agendamientos completada');
    }
  } catch (err) {
    console.warn('[DB] Error en migración agendamientos:', err.message);
  }

  // M-006b: Limpiar tabla huérfana agendamientos_new si quedó de una migración fallida
  try {
    const orphan = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agendamientos_new'").get();
    if (orphan) {
      db.exec('DROP TABLE agendamientos_new');
      console.log('[DB] M-006b: tabla huérfana agendamientos_new eliminada');
    }
  } catch (err) {
    console.warn('[DB] M-006b cleanup error:', err.message);
  }

  // Migración para añadir columnas faltantes en tipificaciones si la bd local es antigua
  try {
    const tableInfo = db.pragma("table_info(tipificaciones)");
    const hasCategoria = tableInfo.some(col => col.name === 'categoria');
    const hasFinalizaGestion = tableInfo.some(col => col.name === 'finaliza_gestion');

    if (!hasCategoria) {
      db.prepare("ALTER TABLE tipificaciones ADD COLUMN categoria TEXT DEFAULT 'NO_CONTACTADO'").run();
      console.log('[DB] Columna categoria añadida a tipificaciones');
    }
    if (!hasFinalizaGestion) {
      db.prepare("ALTER TABLE tipificaciones ADD COLUMN finaliza_gestion INTEGER DEFAULT 1").run();
      console.log('[DB] Columna finaliza_gestion añadida a tipificaciones');
    }
  } catch (err) {
    console.warn('[DB] Error verificando/añadiendo columnas en tipificaciones:', err.message);
  }

  // Migración para añadir columnas WSP y RCS en contactos
  try {
    const tableInfoContactos = db.pragma("table_info(contactos)");
    const hasWhatsapp = tableInfoContactos.some(col => col.name === 'whatsapp_status');
    const hasRcs = tableInfoContactos.some(col => col.name === 'rcs_status');

    if (!hasWhatsapp) {
      db.prepare("ALTER TABLE contactos ADD COLUMN whatsapp_status TEXT DEFAULT 'INACTIVO'").run();
      console.log('[DB] Columna whatsapp_status añadida a contactos');
    }
    if (!hasRcs) {
      db.prepare("ALTER TABLE contactos ADD COLUMN rcs_status TEXT DEFAULT 'ACTIVO'").run();
      console.log('[DB] Columna rcs_status añadida a contactos');
    }
  } catch (err) {
    console.warn('[DB] Error verificando/añadiendo columnas WSP/RCS en contactos:', err.message);
  }

  // M-007: Normalización tipificaciones legacy
  // Asegura que TODA tipificación tenga categoria y finaliza_gestion válidos,
  // incluso las insertadas manualmente fuera del schema v2.0.
  try {
    db.prepare(`
      UPDATE tipificaciones 
      SET categoria = 'NO_CONTACTADO' 
      WHERE categoria IS NULL OR categoria = ''
    `).run();
    
    db.prepare(`
      UPDATE tipificaciones 
      SET finaliza_gestion = 1 
      WHERE finaliza_gestion IS NULL
    `).run();
    
    console.log('[DB] M-007: Normalización de tipificaciones legacy completada');
  } catch (err) {
    console.warn('[DB] M-007 Error:', err.message);
  }

  // M-008: Tabla segmentos_config y defaults
  try {
    const hasSegmentos = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='segmentos_config'").get();
    if (!hasSegmentos) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS segmentos_config (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          clave     TEXT UNIQUE NOT NULL,
          etiqueta  TEXT NOT NULL,
          color     TEXT NOT NULL,
          icono     TEXT DEFAULT 'label',
          creado_en TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `);
      console.log('[DB] Tabla segmentos_config creada');
    }
    
    // Seed
    const countSeg = db.prepare("SELECT COUNT(*) as c FROM segmentos_config").get().c;
    if (countSeg === 0) {
      db.exec(`
        INSERT INTO segmentos_config (clave, etiqueta, color, icono) VALUES 
        ('TODOS', 'Todos los asesores', '#00e676', 'groups'),
        ('MENSUALES', 'Campaña Mensual', '#29b6f6', 'calendar_month'),
        ('QUINCENALES', 'Campaña Quincenal', '#ce93d8', 'event_repeat'),
        ('TRAMO_0', 'Tramo 0 · 0 días', '#90a4ae', 'circle'),
        ('TRAMO_1', 'Tramo 1 · 1-30 días', '#ffd54f', 'trending_up'),
        ('TRAMO_2', 'Tramo 2 · 31-60 días', '#ffb74d', 'warning'),
        ('PLAZO', 'Plazo · +60 días', '#ef5350', 'priority_high');
      `);
      console.log('[DB] Seed de segmentos_config completado');
    }
  } catch (err) {
    console.warn('[DB] Error en segmentos_config:', err.message);
  }

  // M-008: Actualización de tipificaciones requeridas (Limpieza y sincronización)
  try {
    const tipificacionesAceptadas = [
      { codigo: 'PMP',        descripcion: 'Compromiso de pago',         requiere_agd: 1, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'AB_PARC',    descripcion: 'Abono parcial',               requiere_agd: 0, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'VOL_CALL',   descripcion: 'Volver a llamar',             requiere_agd: 1, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'PAGO_REAL',  descripcion: 'Pago realizado',              requiere_agd: 0, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'PEND_COMP',  descripcion: 'Pendiente registro',          requiere_agd: 0, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'NEG_PAG',    descripcion: 'Negativa de Pago',            requiere_agd: 0, categoria: 'CONTACTO NEUTRO',  finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'TER_CON',    descripcion: 'Tercero conocido',            requiere_agd: 0, categoria: 'CONTACTO NEUTRO',  finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'NC',         descripcion: 'No contesta',                 requiere_agd: 0, categoria: 'CONTACTO NEUTRO',  finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'BUZON',      descripcion: 'Buzon',                       requiere_agd: 0, categoria: 'CONTACTO NEUTRO',  finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'NUM_EQ',     descripcion: 'Numero equivocado',           requiere_agd: 0, categoria: 'NO CONTACTADO',    finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'TIT_FAL',    descripcion: 'Titular fallecido',           requiere_agd: 0, categoria: 'NO CONTACTADO',    finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'FUERA_SERV', descripcion: 'Fuera de servicio',           requiere_agd: 0, categoria: 'NO CONTACTADO',    finaliza_gestion: 1, solo_sistema: 0 },
      // Tipificaciones de sistema — solo_sistema=1, no aparecen en el diálogo del asesor
      { codigo: 'INCUMP',     descripcion: 'Compromiso Incumplido',       requiere_agd: 0, categoria: 'CONTACTO NEUTRO',  finaliza_gestion: 1, solo_sistema: 1 },
      { codigo: 'COMP_CUM',   descripcion: 'Compromiso Cumplido',         requiere_agd: 0, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1, solo_sistema: 1 },
      { codigo: 'REAG',       descripcion: 'Reagendamiento',              requiere_agd: 1, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 0, solo_sistema: 1 },
    ];

    const codigosAceptados = tipificacionesAceptadas.map(t => `'${t.codigo}'`).join(',');

    db.transaction(() => {
      db.prepare(`UPDATE cdrs SET tipificacion_id = NULL WHERE tipificacion_id IN (SELECT id FROM tipificaciones WHERE codigo NOT IN (${codigosAceptados}))`).run();
      db.prepare(`DELETE FROM tipificaciones WHERE codigo NOT IN (${codigosAceptados})`).run();

      const hasSoloSistema = db.prepare("PRAGMA table_info(tipificaciones)").all().some(c => c.name === 'solo_sistema');
      const insertOrUpdate = hasSoloSistema
        ? db.prepare(`
            INSERT INTO tipificaciones (codigo, descripcion, requiere_agd, categoria, finaliza_gestion, solo_sistema)
            VALUES (@codigo, @descripcion, @requiere_agd, @categoria, @finaliza_gestion, @solo_sistema)
            ON CONFLICT(codigo) DO UPDATE SET
                descripcion = excluded.descripcion,
                requiere_agd = excluded.requiere_agd,
                categoria = excluded.categoria,
                finaliza_gestion = excluded.finaliza_gestion,
                solo_sistema = excluded.solo_sistema
          `)
        : db.prepare(`
            INSERT INTO tipificaciones (codigo, descripcion, requiere_agd, categoria, finaliza_gestion)
            VALUES (@codigo, @descripcion, @requiere_agd, @categoria, @finaliza_gestion)
            ON CONFLICT(codigo) DO UPDATE SET
                descripcion = excluded.descripcion,
                requiere_agd = excluded.requiere_agd,
                categoria = excluded.categoria,
                finaliza_gestion = excluded.finaliza_gestion
          `);

      for (const t of tipificacionesAceptadas) {
        insertOrUpdate.run(t);
      }
    })();
    console.log('[DB] M-008: Tipificaciones actualizadas (incluye INCUMP/COMP_CUM/REAG como solo_sistema)');
  } catch (err) {
    console.warn('[DB] M-008 Error:', err.message);
  }

  // M-011: Módulo Validación de Pagos — ya_pago en contactos + tabla validaciones_pago
  try {
    const colsCt = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
    if (!colsCt.includes('ya_pago')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN ya_pago INTEGER NOT NULL DEFAULT 0").run();
      db.exec("CREATE INDEX IF NOT EXISTS idx_contactos_ya_pago ON contactos(ya_pago)");
      console.log('[DB] M-011: Columna ya_pago añadida a contactos');
    }
  } catch (err) {
    console.warn('[DB] M-011 ya_pago Error:', err.message);
  }

  try {
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='validaciones_pago'").get();
    if (!tbl) {
      db.exec(`
        CREATE TABLE validaciones_pago (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          contacto_id     INTEGER NOT NULL REFERENCES contactos(id) ON DELETE CASCADE,
          campana_id      INTEGER REFERENCES campanas(id),
          contrato        TEXT    NOT NULL,
          cedula          TEXT,
          empresa         TEXT,
          monto_pagado    REAL    DEFAULT 0,
          ultima_fecha    TEXT,
          cuotas          INTEGER DEFAULT 1,
          validado_por    INTEGER REFERENCES usuarios(id),
          validado_en     TEXT    DEFAULT (datetime('now'))
        )
      `);
      db.exec("CREATE INDEX IF NOT EXISTS idx_valp_contacto ON validaciones_pago(contacto_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_valp_campana  ON validaciones_pago(campana_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_valp_contrato ON validaciones_pago(contrato)");
      console.log('[DB] M-011: Tabla validaciones_pago creada');
    }
  } catch (err) {
    console.warn('[DB] M-011 validaciones_pago Error:', err.message);
  }

  // M-012: Añadir estado_pago y valor_en_mora a validaciones_pago para KPIs de recuperación
  try {
    const colsVP = db.prepare("PRAGMA table_info(validaciones_pago)").all().map(c => c.name);
    if (!colsVP.includes('estado_pago')) {
      db.prepare("ALTER TABLE validaciones_pago ADD COLUMN estado_pago TEXT").run();
      console.log('[DB] M-012: Columna estado_pago añadida a validaciones_pago');
    }
    if (!colsVP.includes('valor_en_mora')) {
      db.prepare("ALTER TABLE validaciones_pago ADD COLUMN valor_en_mora REAL DEFAULT 0").run();
      console.log('[DB] M-012: Columna valor_en_mora añadida a validaciones_pago');
    }
  } catch (err) {
    console.warn('[DB] M-012 Error:', err.message);
  }

  // M-013: Reparar empresa vacía en validaciones_pago — recuperar desde metadata del contacto
  try {
    db.prepare(`
      UPDATE validaciones_pago
      SET empresa = (
        SELECT
          CASE
            WHEN UPPER(COALESCE(TRIM(json_extract(ct.metadata, '$."EMPRESA"')), '')) LIKE '%TEC%'
              OR UPPER(COALESCE(TRIM(json_extract(ct.metadata, '$."EMPRESA"')), '')) LIKE '%SAS%'
              THEN 'TEC_SAS'
            WHEN UPPER(COALESCE(TRIM(json_extract(ct.metadata, '$."EMPRESA"')), '')) LIKE '%SCC%'
              THEN 'SCC'
            ELSE NULL
          END
        FROM contactos ct WHERE ct.id = validaciones_pago.contacto_id
      )
      WHERE empresa IS NULL OR TRIM(empresa) = ''
    `).run();
    console.log('[DB] M-013: empresa reparada en validaciones_pago');
  } catch (err) {
    console.warn('[DB] M-013 Error:', err.message);
  }

  // M-014: Sesiones de validación — agrupar confirmaciones por corrida para borrado en bloque
  try {
    const tblSes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sesiones_validacion'").get();
    if (!tblSes) {
      db.exec(`
        CREATE TABLE sesiones_validacion (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          creado_en     TEXT    DEFAULT (datetime('now','localtime')),
          supervisor_id INTEGER REFERENCES usuarios(id),
          total_registros INTEGER DEFAULT 0,
          monto_total   REAL    DEFAULT 0
        )
      `);
      db.exec("CREATE INDEX IF NOT EXISTS idx_sesval_fecha ON sesiones_validacion(creado_en)");
      console.log('[DB] M-014: Tabla sesiones_validacion creada');
    }

    const colsVP2 = db.prepare("PRAGMA table_info(validaciones_pago)").all().map(c => c.name);
    if (!colsVP2.includes('sesion_id')) {
      db.prepare("ALTER TABLE validaciones_pago ADD COLUMN sesion_id INTEGER REFERENCES sesiones_validacion(id) ON DELETE CASCADE").run();
      db.exec("CREATE INDEX IF NOT EXISTS idx_valp_sesion ON validaciones_pago(sesion_id)");
      console.log('[DB] M-014: Columna sesion_id añadida a validaciones_pago');

      // Agrupar registros existentes en una sesión de migración
      const existing = db.prepare("SELECT COUNT(*) as n, COALESCE(SUM(monto_pagado),0) as total FROM validaciones_pago WHERE sesion_id IS NULL").get();
      if (existing.n > 0) {
        const res = db.prepare("INSERT INTO sesiones_validacion (total_registros, monto_total) VALUES (?,?)").run(existing.n, existing.total);
        db.prepare("UPDATE validaciones_pago SET sesion_id = ? WHERE sesion_id IS NULL").run(res.lastInsertRowid);
        console.log(`[DB] M-014: ${existing.n} registros migrados a sesión #${res.lastInsertRowid}`);
      }
    }
  } catch (err) {
    console.warn('[DB] M-014 Error:', err.message);
  }

  // M-015: Sub-gestiones — llamadas a referencias/números alternativos por contacto
  try {
    const tblSub = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'").get();
    if (!tblSub) {
      db.exec(`
        CREATE TABLE sub_gestiones (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          contacto_id INTEGER NOT NULL REFERENCES contactos(id) ON DELETE CASCADE,
          asesor_id   INTEGER NOT NULL REFERENCES usuarios(id),
          telefono    TEXT    NOT NULL,
          notas       TEXT,
          creado_en   TEXT    DEFAULT (datetime('now','localtime'))
        )
      `);
      db.exec("CREATE INDEX IF NOT EXISTS idx_subgest_contacto ON sub_gestiones(contacto_id)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_subgest_asesor   ON sub_gestiones(asesor_id)");
      console.log('[DB] M-015: Tabla sub_gestiones creada');
    }
  } catch (err) {
    console.warn('[DB] M-015 Error:', err.message);
  }

  // M-016: Vincular sub_gestiones al CDR padre para agrupamiento en historial
  try {
    const hasSub = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'").get();
    if (hasSub) {
      const colsSub = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
      if (!colsSub.includes('cdr_id')) {
        db.prepare("ALTER TABLE sub_gestiones ADD COLUMN cdr_id INTEGER REFERENCES cdrs(id) ON DELETE SET NULL").run();
        db.exec("CREATE INDEX IF NOT EXISTS idx_subgest_cdr ON sub_gestiones(cdr_id)");
        console.log('[DB] M-016: Columna cdr_id añadida a sub_gestiones');
      }
    }
  } catch (err) {
    console.warn('[DB] M-016 Error:', err.message);
  }

  // M-017: Re-vincular refs huérfanas (cdr_id NULL) al CDR más cercano en tiempo
  // del mismo contacto+asesor+día. One-time backfill para datos pre-M-016.
  try {
    const hasSub = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'").get();
    if (hasSub) {
      const colsSub = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
      const colsCdr = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
      const cdrHasCreado = colsCdr.includes('creado_en');
      const cdrTimeExpr = cdrHasCreado ? 'COALESCE(c.creado_en, c.timestamp_inicio)' : 'c.timestamp_inicio';
      if (colsSub.includes('cdr_id')) {
        const orphanCount = db.prepare('SELECT COUNT(*) AS n FROM sub_gestiones WHERE cdr_id IS NULL').get().n;
        if (orphanCount > 0) {
          const result = db.prepare(`
            UPDATE sub_gestiones
            SET cdr_id = (
              SELECT c.id FROM cdrs c
              WHERE c.contacto_id = sub_gestiones.contacto_id
                AND c.usuario_id = sub_gestiones.asesor_id
                AND date(${cdrTimeExpr}) = date(sub_gestiones.creado_en)
              ORDER BY ABS(strftime('%s', ${cdrTimeExpr}) - strftime('%s', sub_gestiones.creado_en)) ASC
              LIMIT 1
            )
            WHERE cdr_id IS NULL
              AND EXISTS (
                SELECT 1 FROM cdrs c
                WHERE c.contacto_id = sub_gestiones.contacto_id
                  AND c.usuario_id = sub_gestiones.asesor_id
                  AND date(${cdrTimeExpr}) = date(sub_gestiones.creado_en)
              )
          `).run();
          if (result.changes > 0) {
            console.log(`[DB] M-017: ${result.changes} sub_gestiones huérfanas re-vinculadas a CDRs existentes`);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[DB] M-017 Error:', err.message);
  }

  // M-020: Snapshot del cliente en CDRs — preserva nombre/cédula/teléfono/empresa
  // al momento de cada gestión, para que el Historial de Gestiones del asesor
  // sobreviva si el supervisor elimina la cartera (auditoría intacta).
  try {
    const colsCdr = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
    const snapshots = [
      ['snapshot_nombre',   'TEXT'],
      ['snapshot_cedula',   'TEXT'],
      ['snapshot_telefono', 'TEXT'],
      ['snapshot_empresa',  'TEXT'],
    ];
    const colsCdrSet = new Set(colsCdr);
    let added = false;
    for (const [col, type] of snapshots) {
      if (!colsCdrSet.has(col)) {
        db.prepare(`ALTER TABLE cdrs ADD COLUMN ${col} ${type}`).run();
        added = true;
      }
    }
    // Backfill: poblar snapshots de CDRs existentes desde contactos
    db.prepare(`
      UPDATE cdrs SET
        snapshot_nombre   = COALESCE(snapshot_nombre,   (SELECT nombre_deudor FROM contactos WHERE id = cdrs.contacto_id)),
        snapshot_cedula   = COALESCE(snapshot_cedula,   (SELECT cedula        FROM contactos WHERE id = cdrs.contacto_id)),
        snapshot_telefono = COALESCE(snapshot_telefono, (SELECT telefono      FROM contactos WHERE id = cdrs.contacto_id)),
        snapshot_empresa  = COALESCE(snapshot_empresa,  (SELECT json_extract(metadata, '$."EMPRESA"') FROM contactos WHERE id = cdrs.contacto_id))
      WHERE snapshot_nombre IS NULL OR snapshot_cedula IS NULL OR snapshot_telefono IS NULL OR snapshot_empresa IS NULL
    `).run();
    if (added) console.log('[DB] M-020: Columnas snapshot añadidas a cdrs + backfill');
  } catch (err) {
    console.warn('[DB] M-020 Error:', err.message);
  }

  // M-022: Hacer cdrs.contacto_id NULLABLE + ON DELETE SET NULL
  // Permite borrar contactos manteniendo CDRs intactos (con snapshot).
  // Solo corre si la columna aún es NOT NULL (verificamos vía PRAGMA).
  try {
    const colsInfo = db.prepare("PRAGMA table_info(cdrs)").all();
    const contactoCol = colsInfo.find(c => c.name === 'contacto_id');
    if (contactoCol && contactoCol.notnull === 1) {
      console.log('[DB] M-022: Recreando tabla cdrs con contacto_id nullable + ON DELETE SET NULL...');

      // Obtener FKs actuales para preservarlas
      const fks = db.prepare("PRAGMA foreign_key_list(cdrs)").all();
      const colNames = colsInfo.map(c => c.name).join(', ');

      db.exec('PRAGMA foreign_keys = OFF;');
      db.transaction(() => {
        // Construir CREATE TABLE nueva: copia exacta excepto contacto_id NOT NULL y FK
        const colDefs = colsInfo.map(c => {
          let def = `${c.name} ${c.type || 'TEXT'}`;
          if (c.pk === 1) def += ' PRIMARY KEY AUTOINCREMENT';
          if (c.name !== 'contacto_id' && c.notnull === 1 && c.pk !== 1) def += ' NOT NULL';
          // Envolver el default en paréntesis: PRAGMA table_info devuelve las
          // expresiones (p.ej. datetime('now')) SIN los paréntesis externos, y
          // SQLite exige DEFAULT (expr) al recrear la tabla. Los literales
          // (0, 'texto') también son válidos entre paréntesis.
          if (c.dflt_value != null) def += ` DEFAULT (${c.dflt_value})`;
          return def;
        });
        // Agregar FKs (contacto_id con ON DELETE SET NULL; el resto como estaban)
        const fkClauses = fks.map(fk => {
          const onDel = fk.from === 'contacto_id' ? 'ON DELETE SET NULL' : '';
          return `FOREIGN KEY (${fk.from}) REFERENCES ${fk.table}(${fk.to}) ${onDel}`.trim();
        });
        const createSql = `CREATE TABLE cdrs_new (\n  ${colDefs.concat(fkClauses).join(',\n  ')}\n)`;
        db.exec(createSql);
        db.exec(`INSERT INTO cdrs_new (${colNames}) SELECT ${colNames} FROM cdrs`);
        db.exec('DROP TABLE cdrs');
        db.exec('ALTER TABLE cdrs_new RENAME TO cdrs');
        // Reconstruir índices si existen
        try { db.exec('CREATE INDEX IF NOT EXISTS idx_cdrs_usuario ON cdrs(usuario_id)'); } catch(_) {}
        try { db.exec('CREATE INDEX IF NOT EXISTS idx_cdrs_contacto ON cdrs(contacto_id)'); } catch(_) {}
        try { db.exec('CREATE INDEX IF NOT EXISTS idx_cdrs_tipificacion ON cdrs(tipificacion_id)'); } catch(_) {}
      })();
      db.exec('PRAGMA foreign_keys = ON;');
      console.log('[DB] M-022: cdrs recreada — contacto_id nullable + ON DELETE SET NULL');
    }
  } catch (err) {
    console.warn('[DB] M-022 Error:', err.message);
  }

  // M-023: Reconciliar estado_marcacion según último CDR tipificado del contacto.
  // Antes del fix, todas las tipif (PMP, VOL_CALL, PAGO_REAL, PEND_COMP) caían en
  // GESTIONADO porque finaliza_gestion=1 en M-008. Esta migración one-time corrige:
  //   último CDR con tipif PAGO_REAL              → YA_PAGO + ya_pago=1
  //   último CDR con tipif PMP/VOL_CALL/PEND_COMP → AGENDADO
  // No toca contactos ya en PENDIENTE/EN_INTENTOS. Idempotente vía flag en config.
  try {
    const flag = db.prepare("SELECT valor FROM config WHERE clave = 'M-023-reconciliar-estado-marcacion'").get();
    if (!flag) {
      const ultimoCdrTipif = `
        SELECT c.contacto_id, t.codigo AS cod
        FROM cdrs c
        JOIN tipificaciones t ON c.tipificacion_id = t.id
        WHERE c.contacto_id IS NOT NULL
          AND c.id = (
            SELECT MAX(c2.id) FROM cdrs c2
            WHERE c2.contacto_id = c.contacto_id AND c2.tipificacion_id IS NOT NULL
          )
      `;

      const rYa = db.prepare(`
        UPDATE contactos
        SET ya_pago = 1, estado_marcacion = 'YA_PAGO'
        WHERE estado_marcacion = 'GESTIONADO'
          AND id IN (SELECT contacto_id FROM (${ultimoCdrTipif}) WHERE cod = 'PAGO_REAL')
      `).run();

      const rAg = db.prepare(`
        UPDATE contactos
        SET estado_marcacion = 'AGENDADO'
        WHERE estado_marcacion = 'GESTIONADO'
          AND id IN (SELECT contacto_id FROM (${ultimoCdrTipif}) WHERE cod IN ('PMP','VOL_CALL','PEND_COMP'))
      `).run();

      if (rYa.changes > 0 || rAg.changes > 0) {
        console.log(`[DB] M-023: estado_marcacion reconciliado → ${rYa.changes} a YA_PAGO, ${rAg.changes} a AGENDADO`);
      }
      db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('M-023-reconciliar-estado-marcacion', ?)").run(new Date().toISOString());
    }
  } catch (err) {
    console.warn('[DB] M-023 Error:', err.message);
  }

  // M-024: Reparar metadata de eventos doblemente codificado (bug Multi-PC).
  // Antes del fix en apiServer.js, el endpoint POST /api/eventos aplicaba
  // JSON.stringify al metadata, y luego insertEvento lo volvía a stringify →
  // resultaba un string JSON envuelto en string: '"{\"canal\":\"WSP\"}"'.
  // Esto hacía que json_extract(metadata, '$.canal') retornara NULL, dejando
  // la card "Comunicación Omnicanal" del supervisor en cero pese a tener envíos.
  // Solo afecta eventos creados via REST (Multi-PC). Eventos via IPC local OK.
  // Detección: metadata empieza y termina con comillas dobles (string envuelto).
  // Fix: json_extract(metadata, '$') desenvuelve la capa extra de stringify.
  // Idempotente vía flag en config.
  try {
    const flag = db.prepare("SELECT valor FROM config WHERE clave = 'M-024-eventos-metadata-double-encoded'").get();
    if (!flag) {
      const result = db.prepare(`
        UPDATE eventos
        SET metadata = json_extract(metadata, '$')
        WHERE metadata IS NOT NULL
          AND length(metadata) >= 2
          AND substr(metadata, 1, 1) = '"'
          AND substr(metadata, length(metadata), 1) = '"'
      `).run();
      if (result.changes > 0) {
        console.log(`[DB] M-024: ${result.changes} eventos con metadata doble-codificada reparados`);
      }
      db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('M-024-eventos-metadata-double-encoded', ?)").run(new Date().toISOString());
    }
  } catch (err) {
    console.warn('[DB] M-024 Error:', err.message);
  }

  // M-025: Ampliar CHECK constraint de eventos.tipo para incluir 'ACCION_RAPIDA'.
  // La constraint original solo permitía ('ESTADO','LLAMADA','CONEXION','DESCONEXION'),
  // rechazando los INSERT de acciones rápidas (WSP/SMS/Email) desde TipificacionDialog.
  // Resultado: los eventos nunca se persistían → la card "Comunicación Omnicanal" del
  // supervisor mostraba todo en cero.
  // SQLite no soporta ALTER CONSTRAINT → se recrea la tabla (patrón ya usado en M-022).
  // Idempotente: solo ejecuta si la definición SQL actual NO contiene 'ACCION_RAPIDA'.
  try {
    const eventosSchema = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='eventos'"
    ).get();
    if (eventosSchema && eventosSchema.sql && !eventosSchema.sql.includes('ACCION_RAPIDA')) {
      console.log('[DB] M-025: Recreando tabla eventos con CHECK constraint ampliada...');

      const colsInfo = db.prepare("PRAGMA table_info(eventos)").all();
      const colNames = colsInfo.map(c => c.name).join(', ');

      db.exec('PRAGMA foreign_keys = OFF;');
      db.transaction(() => {
        db.exec(`
          CREATE TABLE eventos_new (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id   INTEGER NOT NULL REFERENCES usuarios(id),
            sesion_id    INTEGER REFERENCES sesiones(id),
            tipo         TEXT    NOT NULL CHECK(tipo IN ('ESTADO','LLAMADA','CONEXION','DESCONEXION','ACCION_RAPIDA')),
            estado_id    INTEGER,
            duracion_seg INTEGER,
            timestamp    TEXT    DEFAULT (datetime('now')),
            metadata     TEXT
          )
        `);
        db.exec(`INSERT INTO eventos_new (${colNames}) SELECT ${colNames} FROM eventos`);
        db.exec('DROP TABLE eventos');
        db.exec('ALTER TABLE eventos_new RENAME TO eventos');
        // Reconstruir índices
        try { db.exec('CREATE INDEX IF NOT EXISTS idx_eventos_usuario ON eventos(usuario_id)'); } catch(_) {}
        try { db.exec('CREATE INDEX IF NOT EXISTS idx_eventos_timestamp ON eventos(timestamp)'); } catch(_) {}
      })();
      db.exec('PRAGMA foreign_keys = ON;');
      console.log('[DB] M-025: Tabla eventos recreada — tipo ACCION_RAPIDA ahora permitido');
    }
  } catch (err) {
    console.warn('[DB] M-025 Error:', err.message);
  }

  // M-026: Columna orden_marcacion en contactos — permite al supervisor
  // reordenar manualmente (drag & drop) la cola de marcación de un asesor.
  // NULL = orden natural (id ASC); INTEGER = orden manual (asc).
  // getSiguienteContacto / getCarteraAsesor / getCarteraEquipo respetan
  // primero orden_marcacion (NOT NULL ASC), luego estado, luego id ASC.
  try {
    const colsCt = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
    if (!colsCt.includes('orden_marcacion')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN orden_marcacion INTEGER").run();
      try { db.exec('CREATE INDEX IF NOT EXISTS idx_contactos_orden_marcacion ON contactos(asignado_a, orden_marcacion)'); } catch(_) {}
      console.log('[DB] M-026: Columna orden_marcacion añadida en contactos');
    }
  } catch (err) {
    console.warn('[DB] M-026 Error:', err.message);
  }

  // M-027: Columna validado_pago en contactos — diferencia YA_PAGO declarado
  // (tipif del asesor, sujeto a error en comprobante) vs validado (confirmado
  // en módulo "Comprobación de Pagos", inmutable). Reglas:
  //   - validado_pago=0 + estado_marcacion=YA_PAGO → asesor puede re-llamar si
  //     supervisor le asigna orden en Carteras (recallable).
  //   - validado_pago=1 → bloqueado para queue, sin importar orden_marcacion.
  // Backfill: TODO ya_pago=1 existente → validado_pago=1 para preservar el
  // comportamiento previo (no destapar de golpe contactos antiguos a la cola).
  try {
    const colsCt = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
    if (!colsCt.includes('validado_pago')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN validado_pago INTEGER NOT NULL DEFAULT 0").run();
      const r = db.prepare("UPDATE contactos SET validado_pago = 1 WHERE ya_pago = 1").run();
      console.log(`[DB] M-027: Columna validado_pago añadida; ${r.changes} contactos YA_PAGO backfilleados como validados`);
    }
  } catch (err) {
    console.warn('[DB] M-027 Error:', err.message);
  }

  // M-019: Columna fecha_asignacion en contactos — registra cuándo el supervisor
  // asignó cada contacto al asesor. Permite ordenar/filtrar cartera por antigüedad.
  try {
    const colsCt = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
    if (!colsCt.includes('fecha_asignacion')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN fecha_asignacion TEXT").run();
      // Backfill: contactos con asignado_a pero sin fecha → usar 'now' como aproximación
      db.prepare("UPDATE contactos SET fecha_asignacion = datetime('now', 'localtime') WHERE asignado_a IS NOT NULL AND fecha_asignacion IS NULL").run();
      console.log('[DB] M-019: Columna fecha_asignacion añadida y backfilleada');
    }
  } catch (err) {
    console.warn('[DB] M-019 Error:', err.message);
  }

  // M-021: Corregir backfill bulk de M-019 — para contactos cuya fecha_asignacion
  // sea mucho posterior a la fecha_inicio de su campaña, usar fecha_inicio como
  // valor real (el supervisor creó la campaña cuando subió la cartera).
  // Solo corre UNA vez (flag en tabla config).
  try {
    const flag = db.prepare("SELECT valor FROM config WHERE clave = 'M-021-fecha-asignacion-fix'").get();
    if (!flag) {
      const colsCt = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
      if (colsCt.includes('fecha_asignacion')) {
        const result = db.prepare(`
          UPDATE contactos
          SET fecha_asignacion = (
            SELECT c.fecha_inicio FROM campanas c WHERE c.id = contactos.campana_id
          )
          WHERE asignado_a IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM campanas c
              WHERE c.id = contactos.campana_id
                AND c.fecha_inicio IS NOT NULL
                AND julianday(contactos.fecha_asignacion) - julianday(c.fecha_inicio) > 1
            )
        `).run();
        if (result.changes > 0) {
          console.log(`[DB] M-021: ${result.changes} fechas de asignación corregidas con fecha_inicio de campaña`);
        }
      }
      db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('M-021-fecha-asignacion-fix', ?)").run(new Date().toISOString());
    }
  } catch (err) {
    console.warn('[DB] M-021 Error:', err.message);
  }

  // M-018: Limpieza one-time de refs huérfanas residuales (cdr_id IS NULL)
  // tras M-017. Solo corre UNA vez por DB (flag en tabla config).
  try {
    const flag = db.prepare("SELECT valor FROM config WHERE clave = 'M-018-cleanup-orphans-2026-05-07'").get();
    if (!flag) {
      const hasSub = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sub_gestiones'").get();
      if (hasSub) {
        const cols = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
        if (cols.includes('cdr_id')) {
          const result = db.prepare("DELETE FROM sub_gestiones WHERE cdr_id IS NULL").run();
          if (result.changes > 0) {
            console.log(`[DB] M-018: ${result.changes} sub_gestiones huérfanas eliminadas (limpieza one-time)`);
          }
        }
      }
      db.prepare("INSERT OR REPLACE INTO config (clave, valor) VALUES ('M-018-cleanup-orphans-2026-05-07', ?)").run(new Date().toISOString());
    }
  } catch (err) {
    console.warn('[DB] M-018 Error:', err.message);
  }

  // M-028: Insertar nuevas tipificaciones para el menú de gestión rápida
  try {
    const tipificacionesNuevas = [
      { codigo: 'CUELGA', descripcion: 'Cuelga', requiere_agd: 0, categoria: 'NO_CONTACTADO', finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'REF', descripcion: 'Referencia', requiere_agd: 0, categoria: 'NO_CONTACTADO', finaliza_gestion: 1, solo_sistema: 0 },
      { codigo: 'SIN_BUZON', descripcion: 'Sin buzon', requiere_agd: 0, categoria: 'NO_CONTACTADO', finaliza_gestion: 1, solo_sistema: 0 },
    ];

    const insertOrUpdateM028 = db.prepare(`
      INSERT INTO tipificaciones (codigo, descripcion, requiere_agd, categoria, finaliza_gestion, solo_sistema)
      VALUES (@codigo, @descripcion, @requiere_agd, @categoria, @finaliza_gestion, @solo_sistema)
      ON CONFLICT(codigo) DO UPDATE SET
          descripcion = excluded.descripcion,
          requiere_agd = excluded.requiere_agd,
          categoria = excluded.categoria,
          finaliza_gestion = excluded.finaliza_gestion,
          solo_sistema = excluded.solo_sistema
    `);

    const hasSoloSistema = db.pragma("table_info(tipificaciones)").some(c => c.name === 'solo_sistema');
    if (hasSoloSistema) {
      db.transaction(() => {
        for (const t of tipificacionesNuevas) {
          insertOrUpdateM028.run(t);
        }
      })();
      console.log('[DB] M-028: Tipificaciones rápidas añadidas (CUELGA, REF, SIN_BUZON)');
    } else {
      const insertOrUpdateLegacy = db.prepare(`
        INSERT INTO tipificaciones (codigo, descripcion, requiere_agd, categoria, finaliza_gestion)
        VALUES (@codigo, @descripcion, @requiere_agd, @categoria, @finaliza_gestion)
        ON CONFLICT(codigo) DO UPDATE SET
            descripcion = excluded.descripcion,
            requiere_agd = excluded.requiere_agd,
            categoria = excluded.categoria,
            finaliza_gestion = excluded.finaliza_gestion
      `);
      db.transaction(() => {
        for (const t of tipificacionesNuevas) {
          insertOrUpdateLegacy.run(t);
        }
      })();
      console.log('[DB] M-028: Tipificaciones rápidas añadidas (Fallback sin solo_sistema)');
    }
  } catch (err) {
    console.warn('[DB] M-028 Error:', err.message);
  }

  // M-010: monto_acordado en CDRs — compromiso real ingresado por el asesor
  try {
    const colsCdrs = db.prepare("PRAGMA table_info(cdrs)").all();
    const colNamesCdrs = colsCdrs.map(c => c.name);
    if (!colNamesCdrs.includes('monto_acordado')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN monto_acordado REAL DEFAULT NULL").run();
      console.log('[DB] M-010: Columna monto_acordado añadida a cdrs');
    }
  } catch (err) {
    console.warn('[DB] M-010 Error:', err.message);
  }

  // M-030: Datos de confirmación de pago directo desde el asesor (sin re-tipificación)
  // Evita doble conteo al confirmar un PMP: el asesor actualiza el CDR existente
  // con comprobante/forma_pago/monto_pagado en lugar de crear un nuevo CDR PAGO_REAL.
  try {
    const colsCdr030 = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
    if (!colsCdr030.includes('comprobante')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN comprobante TEXT").run();
    }
    if (!colsCdr030.includes('forma_pago')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN forma_pago TEXT").run();
    }
    if (!colsCdr030.includes('monto_pagado')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN monto_pagado REAL").run();
    }
    console.log('[DB] M-030: Columnas comprobante/forma_pago/monto_pagado añadidas a cdrs');
  } catch (err) {
    console.warn('[DB] M-030 Error:', err.message);
  }

  // MIGRACIÓN DE EMERGENCIA (M-009): Asegurar creado_en y datos de tiempo para historial
  try {
    const tables = ['cdrs', 'agendamientos'];
    db.transaction(() => {
      for (const table of tables) {
        const info = db.pragma(`table_info(${table})`);
        if (!info.some(c => c.name === 'creado_en')) {
          db.prepare(`ALTER TABLE ${table} ADD COLUMN creado_en TEXT DEFAULT (datetime('now'))`).run();
          console.log(`[DB] M-009: Columna creado_en añadida a ${table}`);
        }
      }
      // Poblar si están vacíos (retrocompatibilidad) para que el historial no salga vacío (-)
      db.prepare("UPDATE cdrs SET creado_en = timestamp_inicio WHERE creado_en IS NULL").run();
    })();
    console.log('[DB] M-009: Migración de emergencia de tiempos completada');
  } catch (err) {
    console.warn('[DB] M-009 Error:', err.message);
  }

  // M-031: Columnas de estado de compromisos en CDRs — requeridas por getCompromisosEquipo,
  // getMetricasDia y getMetricasEquipo. Cualquier BD creada antes de esta versión puede
  // carecer de estas columnas, causando SqliteError "no such column" en producción.
  try {
    const colsCdr031 = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
    if (!colsCdr031.includes('resultado')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN resultado TEXT").run();
      console.log('[DB] M-031: Columna resultado añadida a cdrs');
    }
    if (!colsCdr031.includes('notas')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN notas TEXT").run();
      console.log('[DB] M-031: Columna notas añadida a cdrs');
    }
    if (!colsCdr031.includes('duracion_seg')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN duracion_seg INTEGER").run();
      console.log('[DB] M-031: Columna duracion_seg añadida a cdrs');
    }
    if (!colsCdr031.includes('timestamp_inicio')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN timestamp_inicio TEXT").run();
      console.log('[DB] M-031: Columna timestamp_inicio añadida a cdrs');
    }
    if (!colsCdr031.includes('timestamp_fin')) {
      db.prepare("ALTER TABLE cdrs ADD COLUMN timestamp_fin TEXT").run();
      console.log('[DB] M-031: Columna timestamp_fin añadida a cdrs');
    }
  } catch (err) {
    console.warn('[DB] M-031 Error:', err.message);
  }

  // M-032: Poblar timestamp_inicio en CDRs históricos (creado_en UTC → timestamp_inicio local).
  // Idempotente: solo corre en filas donde timestamp_inicio IS NULL. Tras esta migración,
  // timestamp_inicio queda NOT NULL → el WHERE no vuelve a coincidir en reinicios futuros.
  // NO modifica creado_en para evitar doble conversión en máquinas ya migradas.
  try {
    const colsCdr032 = db.prepare("PRAGMA table_info(cdrs)").all().map(c => c.name);
    if (colsCdr032.includes('creado_en') && colsCdr032.includes('timestamp_inicio')) {
      const affected = db.prepare(`
        UPDATE cdrs
        SET timestamp_inicio = datetime(creado_en, 'localtime')
        WHERE timestamp_inicio IS NULL
          AND creado_en IS NOT NULL
          AND length(creado_en) >= 10
      `).run();
      if (affected.changes > 0) {
        console.log(`[DB] M-032: ${affected.changes} CDRs timestamp_inicio poblado desde creado_en`);
      }
    }
  } catch (err) {
    console.warn('[DB] M-032 Error:', err.message);
  }

  // M-033: Enriquecer sub_gestiones con datos de la referencia (nombre, parentesco).
  // Idempotente: ALTER TABLE solo si la columna no existe.
  try {
    const colsSub033 = db.prepare("PRAGMA table_info(sub_gestiones)").all().map(c => c.name);
    if (!colsSub033.includes('nombre_ref')) {
      db.prepare("ALTER TABLE sub_gestiones ADD COLUMN nombre_ref TEXT").run();
      console.log('[DB] M-033: Columna nombre_ref añadida a sub_gestiones');
    }
    if (!colsSub033.includes('parentesco')) {
      db.prepare("ALTER TABLE sub_gestiones ADD COLUMN parentesco TEXT").run();
      console.log('[DB] M-033: Columna parentesco añadida a sub_gestiones');
    }
  } catch (err) {
    console.warn('[DB] M-033 Error:', err.message);
  }

  // M-034: Tabla metas_asesores — metas de cumplimiento por asesor y período
  try {
    const tblMetas = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metas_asesores'").get();
    if (!tblMetas) {
      db.exec(`
        CREATE TABLE metas_asesores (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          asesor_id       INTEGER NOT NULL REFERENCES usuarios(id),
          periodo         TEXT    NOT NULL,
          valor_recaudado REAL    NOT NULL DEFAULT 0,
          meta_propuesta  REAL    NOT NULL DEFAULT 0,
          UNIQUE(asesor_id, periodo)
        )
      `);
      console.log('[DB] M-034: Tabla metas_asesores creada');
    }
  } catch (err) {
    console.warn('[DB] M-034 Error:', err.message);
  }

  // M-035: Columnas meta_diaria, meta_semanal, meta_mensual en metas_asesores
  try {
    const metaCols = db.prepare("PRAGMA table_info(metas_asesores)").all().map(c => c.name);
    if (!metaCols.includes('meta_diaria'))  db.exec(`ALTER TABLE metas_asesores ADD COLUMN meta_diaria  REAL NOT NULL DEFAULT 0`);
    if (!metaCols.includes('meta_semanal')) db.exec(`ALTER TABLE metas_asesores ADD COLUMN meta_semanal REAL NOT NULL DEFAULT 0`);
    if (!metaCols.includes('meta_mensual')) db.exec(`ALTER TABLE metas_asesores ADD COLUMN meta_mensual REAL NOT NULL DEFAULT 0`);
  } catch (err) {
    console.warn('[DB] M-035 Error:', err.message);
  }

  // M-036: Ampliar CHECK constraint de usuarios.rol para incluir 'admin'.
  // SQLite no permite ALTER CONSTRAINT → se recrea la tabla.
  // Idempotente: solo corre si la definición actual NO contiene 'admin'.
  try {
    const usuariosSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'").get();
    if (usuariosSchema && !usuariosSchema.sql.includes("'admin'")) {
      console.log('[DB] M-036: Recreando tabla usuarios con rol admin...');
      const colsInfo = db.prepare('PRAGMA table_info(usuarios)').all();
      const colNames = colsInfo.map(c => c.name).join(', ');
      db.exec('PRAGMA foreign_keys = OFF;');
      db.transaction(() => {
        db.exec(`
          CREATE TABLE usuarios_new (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre        TEXT    NOT NULL,
            email         TEXT    UNIQUE NOT NULL,
            password_hash TEXT    NOT NULL,
            rol           TEXT    NOT NULL DEFAULT 'asesor' CHECK(rol IN ('supervisor','jefe_area','asesor','admin')),
            estado        TEXT    NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','inactivo')),
            creado_en     TEXT    DEFAULT (datetime('now'))
          )
        `);
        db.exec(`INSERT INTO usuarios_new (${colNames}) SELECT ${colNames} FROM usuarios`);
        db.exec('DROP TABLE usuarios');
        db.exec('ALTER TABLE usuarios_new RENAME TO usuarios');
      })();
      db.exec('PRAGMA foreign_keys = ON;');
      console.log('[DB] M-036: Tabla usuarios recreada — rol admin habilitado');
    }
  } catch (err) {
    console.warn('[DB] M-036 Error:', err.message);
  }

  // M-039: Añadir rol 'jefe_area' al CHECK constraint de usuarios (si aún no está incluido)
  try {
    const colInfo = db.prepare("PRAGMA table_info(usuarios)").all();
    const rolCol  = colInfo.find(c => c.name === 'rol');
    // SQLite no expone el CHECK textualmente; la estrategia segura es intentar
    // insertar un row temporal con rol='jefe_area'. Si lanza ConstraintError,
    // el CHECK no lo permite y hay que recrear la tabla.
    const needsRebuild = (() => {
      try {
        db.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('__test__','__test__@test','__hash__','jefe_area')").run();
        db.prepare("DELETE FROM usuarios WHERE email = '__test__@test'").run();
        return false; // el rol ya es válido
      } catch { return true; }
    })();

    if (needsRebuild) {
      db.exec('PRAGMA foreign_keys = OFF;');
      (() => {
        const colNames = colInfo.map(c => c.name).join(', ');
        db.exec('DROP TABLE IF EXISTS usuarios_m039');
        db.exec(`
          CREATE TABLE usuarios_m039 (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre        TEXT    NOT NULL,
            email         TEXT    UNIQUE NOT NULL,
            password_hash TEXT    NOT NULL,
            rol           TEXT    NOT NULL DEFAULT 'asesor' CHECK(rol IN ('supervisor','jefe_area','asesor','admin')),
            estado        TEXT    NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','inactivo')),
            creado_en     TEXT    DEFAULT (datetime('now')),
            supervisor_id INTEGER REFERENCES usuarios(id)
          )
        `);
        db.exec(`INSERT INTO usuarios_m039 (${colNames}) SELECT ${colNames} FROM usuarios`);
        db.exec('DROP TABLE usuarios');
        db.exec('ALTER TABLE usuarios_m039 RENAME TO usuarios');
      })();
      db.exec('PRAGMA foreign_keys = ON;');
      console.log('[DB] M-039: CHECK constraint actualizado — rol jefe_area habilitado');
    } else {
      console.log('[DB] M-039: rol jefe_area ya era válido, sin cambios');
    }
  } catch (err) {
    console.warn('[DB] M-039 Error:', err.message);
  }

  // M-036b: Seed usuario administrador del sistema (one-time)
  try {
    const adminExists = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin'").get();
    if (!adminExists) {
      const bcrypt = require('bcryptjs');
      const hash = bcrypt.hashSync('***CREDENTIAL_REMOVED***', 10);
      db.prepare("INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol, estado) VALUES (?, ?, ?, 'admin', 'activo')")
        .run('Administrador Sistema', 'admin@sistema.local', hash);
      console.log('[DB] M-036b: Usuario admin creado → admin@sistema.local / ***CREDENTIAL_REMOVED***');
    }
  } catch (err) {
    console.warn('[DB] M-036b Error creando usuario admin:', err.message);
  }

  // M-037: Índice de expresión sobre DIAS IMPAGO para las cards de cartera/métricas
  // del supervisor. Sin él, getCarteraAnalisis hace full SCAN de contactos (medido:
  // 24ms→7ms con 40k filas, -72%). La expresión DEBE coincidir con la del WHERE de
  // getCarteraAnalisis para que SQLite use el índice. Idempotente.
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ct_dias_impago
             ON contactos(COALESCE(CAST(NULLIF(TRIM(json_extract(metadata,'$."DIAS IMPAGO"')),'') AS INTEGER),0))`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_cdrs_contacto ON cdrs(contacto_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_ct_campana_fecha ON contactos(campana_id, fecha_asignacion)');
    console.log('[DB] M-037: Índices de cartera/métricas asegurados');
  } catch (err) {
    console.warn('[DB] M-037 Error:', err.message);
  }

  // M-038: Aislamiento de equipos (Bug 4 v3.0). Cada asesor pertenece a un
  // supervisor vía supervisor_id. Las vistas del supervisor filtran por su id;
  // el admin ve todo. Asesores existentes quedan NULL → el admin los asigna por UI.
  try {
    const colsU = db.prepare("PRAGMA table_info(usuarios)").all().map(c => c.name);
    if (!colsU.includes('supervisor_id')) {
      db.prepare("ALTER TABLE usuarios ADD COLUMN supervisor_id INTEGER REFERENCES usuarios(id)").run();
      console.log('[DB] M-038: Columna supervisor_id añadida a usuarios');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_usuarios_supervisor_id ON usuarios(supervisor_id)');
  } catch (err) {
    console.warn('[DB] M-038 Error:', err.message);
  }

  // M-040: Añadir columna activo a mensajes_broadcast para borrado lógico y reemplazo en tiempo real
  try {
    const colsM = db.prepare("PRAGMA table_info(mensajes_broadcast)").all().map(c => c.name);
    if (!colsM.includes('activo')) {
      db.prepare("ALTER TABLE mensajes_broadcast ADD COLUMN activo INTEGER DEFAULT 1").run();
      console.log('[DB] M-040: Columna activo añadida a mensajes_broadcast');
    }
  } catch (err) {
    console.warn('[DB] M-040 Error:', err.message);
  }

  // M-041: Columnas de fecha de envío por canal para contabilización diaria.
  // El checkmark ✓ en Cartera Asignada solo debe aparecer si se envió HOY.
  try {
    const colsCt = db.prepare("PRAGMA table_info(contactos)").all().map(c => c.name);
    if (!colsCt.includes('wsp_enviado_fecha')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN wsp_enviado_fecha TEXT DEFAULT NULL").run();
      console.log('[DB] M-041: Columna wsp_enviado_fecha añadida a contactos');
    }
    if (!colsCt.includes('rcs_enviado_fecha')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN rcs_enviado_fecha TEXT DEFAULT NULL").run();
      console.log('[DB] M-041: Columna rcs_enviado_fecha añadida a contactos');
    }
    if (!colsCt.includes('correo_enviado_fecha')) {
      db.prepare("ALTER TABLE contactos ADD COLUMN correo_enviado_fecha TEXT DEFAULT NULL").run();
      console.log('[DB] M-041: Columna correo_enviado_fecha añadida a contactos');
    }
  } catch (err) {
    console.warn('[DB] M-041 Error:', err.message);
  }

  // MIGRACIÓN: Columna activo en mensajes_broadcast (soft-delete de mensajes)
  try {
    const colsMB = db.prepare("PRAGMA table_info(mensajes_broadcast)").all().map(c => c.name);
    if (!colsMB.includes('activo')) {
      db.prepare("ALTER TABLE mensajes_broadcast ADD COLUMN activo INTEGER NOT NULL DEFAULT 1").run();
      console.log('[DB] Migración: columna activo añadida a mensajes_broadcast');
    }
  } catch (err) {
    console.warn('[DB] Migración mensajes_broadcast.activo:', err.message);
  }

  // MIGRACIÓN: Tabla segmentos_config (tramos dinámicos de mensajes)
  try {
    const tblSeg = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='segmentos_config'").get();
    if (!tblSeg) {
      db.exec(`
        CREATE TABLE segmentos_config (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          clave     TEXT UNIQUE NOT NULL,
          etiqueta  TEXT NOT NULL,
          color     TEXT NOT NULL,
          icono     TEXT DEFAULT 'label',
          creado_en TEXT DEFAULT (datetime('now', 'localtime'))
        )
      `);
      console.log('[DB] Migración: tabla segmentos_config creada');
    }
  } catch (err) {
    console.warn('[DB] Migración segmentos_config:', err.message);
  }

  // Seed si la tabla usuarios está vacía
  const count = db.prepare('SELECT COUNT(*) as c FROM usuarios').get();
  if (count.c === 0) {
    seedDatabase();
  }

  // ── Forzar usuarios operativos (INSERT + UPDATE para garantizar hash correcto) ──
  try {
    const bcryptSync   = require('bcryptjs');
    const HASH_ADMIN   = bcryptSync.hashSync('***CREDENTIAL_REMOVED***',      10); // admin@sistema.local
    const HASH_JEFE    = bcryptSync.hashSync('Marketing2026!',  10); // jefe.marketing@uphone.local
    const HASH_ASESOR  = bcryptSync.hashSync('asesor123',       10); // asesor@uphone.local

    const upsertUser = db.prepare(`
      INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol, estado)
      VALUES (?, ?, ?, ?, 'activo')
    `);
    const forceUpdate = db.prepare(`
      UPDATE usuarios SET password_hash = ?, rol = ?, estado = 'activo' WHERE email = ?
    `);

    // Admin del sistema
    upsertUser.run('Administrador Sistema', 'admin@sistema.local', HASH_ADMIN, 'admin');
    forceUpdate.run(HASH_ADMIN, 'admin', 'admin@sistema.local');

    // Jefe de Marketing — rol propio jefe_area (supervisor reservado para implementación futura)
    upsertUser.run('Jefe de Marketing', 'jefe.marketing@uphone.local', HASH_JEFE, 'jefe_area');
    forceUpdate.run(HASH_JEFE, 'jefe_area', 'jefe.marketing@uphone.local');

    // Jefe temporal para pruebas del usuario
    const HASH_JEFE_TMP = bcryptSync.hashSync('admin123', 10);
    upsertUser.run('Jefe Prueba', 'jefe1@uphone.local', HASH_JEFE_TMP, 'jefe_area');
    forceUpdate.run(HASH_JEFE_TMP, 'jefe_area', 'jefe1@uphone.local');

    // Asesor de prueba
    upsertUser.run('Asesor de Prueba', 'asesor@uphone.local', HASH_ASESOR, 'asesor');
    forceUpdate.run(HASH_ASESOR, 'asesor', 'asesor@uphone.local');

    // Usuarios REDACTED (admin, jefe, gestor)
    const HASH_UPHONE  = bcryptSync.hashSync('REDACTED', 10);
    upsertUser.run('Administrador', 'admin@uphone.local', HASH_UPHONE, 'admin');
    forceUpdate.run(HASH_UPHONE, 'admin', 'admin@uphone.local');
    upsertUser.run('Jefe de Area', 'jefe@uphone.local', HASH_UPHONE, 'jefe_area');
    forceUpdate.run(HASH_UPHONE, 'jefe_area', 'jefe@uphone.local');
    upsertUser.run('Gestor Demo', 'gestor@uphone.local', HASH_UPHONE, 'asesor');
    forceUpdate.run(HASH_UPHONE, 'asesor', 'gestor@uphone.local');

    // Gestor de prueba con contraseña Uphone@202
    const HASH_GESTOR = bcryptSync.hashSync('Uphone@202', 10);
    upsertUser.run('Gestor de Prueba', 'gestor@uphone.local', HASH_GESTOR, 'asesor');
    forceUpdate.run(HASH_GESTOR, 'asesor', 'gestor@uphone.local');

    // Limpieza a petición del cliente (quiquilloso)
    try {
      db.prepare("DELETE FROM usuarios WHERE email = 'supervisor1@uphone.local'").run();
      db.prepare("UPDATE usuarios SET rol = 'jefe_area' WHERE rol = 'supervisor'").run();
    } catch(e) {}

    console.log('[DB] Usuarios operativos sincronizados:');
    console.log('[DB]   admin@sistema.local         / ***CREDENTIAL_REMOVED***');
    console.log('[DB]   jefe.marketing@uphone.local / Marketing2026!');
    console.log('[DB]   jefe1@uphone.local          / admin123');
    console.log('[DB]   asesor@uphone.local          / asesor123');
    console.log('[DB]   admin@uphone.local           / REDACTED');
    console.log('[DB]   jefe@uphone.local            / REDACTED');
    console.log('[DB]   gestor@uphone.local          / Uphone@202  ← cuenta de prueba');
  } catch(e) {
    console.error('[DB] Error sincronizando usuarios operativos:', e.message);
  }

  console.log(`[DB] better-sqlite3 inicializado -> ${dbPath}`);
  console.log(`[DB] WAL mode, ${count.c} usuarios en BD (inicial)`);
  return db;
}

/**
 * Seed inicial con datos de desarrollo.
 * 1 Supervisor + 9 Asesores + Tipificaciones + Campaña demo + Contactos
 */
function seedDatabase() {
  console.log('[DB] Ejecutando seed de simulación v2.0...');

  const HASH_ADMIN = '$2b$10$6ItfBMhhFZ4McGKVD23JruwO8jnMGRklF5bK.dGCH1rXPvWbgBilG'; // admin123
  const HASH_ASESOR = '$2b$10$x3asUJ1hbzydIh7XiYJfBu8K5pIJk/7mWhDI//CAazIbDfAU22M.2'; // asesor123

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO usuarios (nombre, email, password_hash, rol, estado)
    VALUES (?, ?, ?, ?, 'activo')
  `);

  const insertTipif = db.prepare(`
    INSERT OR IGNORE INTO tipificaciones (codigo, descripcion, requiere_agd)
    VALUES (?, ?, ?)
  `);

  const insertCampana = db.prepare(`
    INSERT OR IGNORE INTO campanas (nombre, descripcion, estado)
    VALUES (?, ?, 'activa')
  `);

  const insertContacto = db.prepare(`
    INSERT INTO contactos (campana_id, nombre_deudor, telefono, monto_deuda, producto, estado_marcacion)
    VALUES (?, ?, ?, ?, ?, 'PENDIENTE')
  `);

  const seedAll = db.transaction(() => {
    // 1. Usuarios
    insertUser.run('Jefe de Marketing', 'jefe.marketing@uphone.local', HASH_ADMIN, 'supervisor');
    insertUser.run('Asesor de Prueba', 'asesor@uphone.local', HASH_ASESOR, 'asesor');

    // 2. Tipificaciones (Sustituye o complementa)
    const tipifs = [
      ['PMP', 'Compromiso de pago', 1, 'CONTACTO EXITOSO', 1],
      ['AB_PARC', 'Abono parcial', 0, 'CONTACTO EXITOSO', 1],
      ['VOL_CALL', 'Volver a llamar', 1, 'CONTACTO EXITOSO', 1],
      ['NEG_PAG', 'Negativa de Pago', 0, 'CONTACTO NEUTRO', 1],
      ['TER_CON', 'Tercero conocido', 0, 'CONTACTO NEUTRO', 1],
      ['NC', 'No contesta', 0, 'CONTACTO NEUTRO', 1],
      ['BUZON', 'Buzon', 0, 'CONTACTO NEUTRO', 1],
      ['NUM_EQ', 'Numero equivocado', 0, 'CONTACTO NEGATIVO', 1],
      ['TIT_FAL', 'Titular fallecido', 0, 'CONTACTO NEGATIVO', 1],
      ['FUERA_SERV', 'Fuera de servicio', 0, 'CONTACTO NEGATIVO', 1]
    ];
    for (const [codigo, desc, agd, cat, fin] of tipifs) {
      insertTipif.run(codigo, desc, agd);
      db.prepare("UPDATE tipificaciones SET descripcion=?, categoria=?, finaliza_gestion=? WHERE codigo=?").run(desc, cat, fin, codigo);
    }

    // 3. Campaña Simulación
    const campResult = insertCampana.run('RECUPERACIÓN CARTERA ABRIL', 'Campaña de cobro masivo v2.0 - Simulación General');
    const campId = Number(campResult.lastInsertRowid);

    // 4. Contactos de Prueba
    const clientes = [
      ['Juan Pérez', '5551234567', 1500.50, 'Crédito Personal'],
      ['María García', '5559876543', 2400.00, 'Tarjeta Premium'],
      ['Carlos López', '5550001111', 850.75, 'Préstamo Auto'],
      ['Elena Rivas', '5552223333', 12000.00, 'Hipotecario'],
      ['Roberto Díaz', '5554445555', 450.25, 'Microcrédito'],
    ];
    for (const [nombre, tel, monto, prod] of clientes) {
      insertContacto.run(campId, nombre, tel, monto, prod);
    }
  });

  seedAll();
  console.log('[DB] [OK] Seed de simulación v2.0 completado.');
}

function getDb() {
  if (!db) throw new Error('Base de datos no inicializada. Llama initDatabase() primero.');
  return db;
}

/** Devuelve true si la BD ya fue inicializada correctamente */
function isDbReady() {
  return db !== null;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Conexión cerrada');
  }
}

module.exports = { initDatabase, getDb, isDbReady, closeDb };
