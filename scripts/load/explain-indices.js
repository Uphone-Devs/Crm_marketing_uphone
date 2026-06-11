/**
 * explain-indices.js — Análisis de plan de ejecución de las queries "calientes"
 * del supervisor (cartera/métricas) sobre un dataset sintético grande, en LOCAL.
 *
 * Objetivo: decidir CON EVIDENCIA si hace falta crear índices, antes de tocar la VM.
 * Seguro: usa una BD temporal propia, no toca producción.
 *
 * Uso:  node scripts/load/explain-indices.js [filas]   (default 40000)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const N = parseInt(process.argv[2] || '40000', 10);
const TMP = path.join(os.tmpdir(), `explain-indices-${process.pid}.db`);
process.env.DB_PATH = TMP;

const { initDatabase, getDb, closeDb } = require('../../src/main/database/db');

function rm() { for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(TMP + s); } catch (_) {} } }

function seed(db, n) {
  db.pragma('foreign_keys = OFF');
  for (const t of ['cdrs', 'contactos', 'campanas', 'usuarios']) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ('S','s@t.com','x','supervisor')").run();
  db.prepare("INSERT INTO campanas (nombre,supervisor_id,estado,fecha_inicio) VALUES ('C',1,'activa','2026-01-01')").run();
  const ins = db.prepare(`INSERT INTO contactos
    (campana_id, telefono, nombre_deudor, cedula, asignado_a, estado_marcacion, intentos_realizados, metadata, fecha_asignacion, ya_pago)
    VALUES (1, ?, ?, ?, 1, 'PENDIENTE', 0, ?, ?, 0)`);
  const insCdr = db.prepare("INSERT INTO cdrs (contacto_id, usuario_id, timestamp_inicio) VALUES (?,1,'2026-05-10T10:00:00')");
  const tx = db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const dias = i % 90;                       // 0..89 días
      const meta = JSON.stringify({ 'DIAS IMPAGO': String(dias), 'VALOR EN MORA': '100.00' });
      const r = ins.run(`09${i}`, `Cli${i}`, String(i), meta, '2026-05-10');
      if (i % 3 === 0) insCdr.run(Number(r.lastInsertRowid)); // 1/3 con CDR (gestión REALIZADA)
    }
  });
  tx();
  db.pragma('foreign_keys = ON');
}

function explainAndTime(db, label, sql, params) {
  const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params);
  const scans = plan.filter(p => /SCAN/.test(p.detail)).map(p => p.detail);
  const t0 = Date.now();
  for (let i = 0; i < 5; i++) db.prepare(sql).all(...params);   // 5 corridas
  const ms = (Date.now() - t0) / 5;
  console.log(`\n── ${label} ──`);
  plan.forEach(p => console.log('   ' + p.detail));
  console.log(`   → ${scans.length ? 'SCAN(s): ' + scans.length : 'sin full scan'} | ${ms.toFixed(1)} ms/corrida`);
  return ms;
}

const CARTERA_SQL = `
  SELECT CASE WHEN EXISTS (SELECT 1 FROM cdrs c WHERE c.contacto_id = ct.id)
              THEN 'REALIZADA' ELSE 'NO REALIZADA' END AS gestion,
         COUNT(ct.id) AS num_clientes
  FROM contactos ct
  WHERE COALESCE(CAST(NULLIF(TRIM(json_extract(ct.metadata,'$."DIAS IMPAGO"')),'') AS INTEGER),0) BETWEEN ? AND ?
  GROUP BY gestion`;

(function main() {
  rm(); initDatabase(); const db = getDb();
  console.log(`Sembrando ${N} contactos sintéticos...`);
  seed(db, N);

  console.log('\n========== ANTES de índices ==========');
  const before = explainAndTime(db, 'getCarteraAnalisis (0-30 días)', CARTERA_SQL, [0, 30]);

  // Índice candidato: expresión sobre DIAS IMPAGO (debe coincidir con la del WHERE)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ct_dias_impago
           ON contactos(COALESCE(CAST(NULLIF(TRIM(json_extract(metadata,'$."DIAS IMPAGO"')),'') AS INTEGER),0))`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_cdrs_contacto ON cdrs(contacto_id)');

  console.log('\n========== DESPUÉS de índices ==========');
  const after = explainAndTime(db, 'getCarteraAnalisis (0-30 días)', CARTERA_SQL, [0, 30]);

  console.log(`\n>>> Mejora: ${before.toFixed(1)}ms → ${after.toFixed(1)}ms (${(100*(before-after)/before).toFixed(0)}% más rápido)\n`);
  closeDb(); rm();
})();
