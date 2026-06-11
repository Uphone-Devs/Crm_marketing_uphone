/**
 * anonymize-db.js — Genera una copia ANONIMIZADA de la base de datos para
 * entregar a terceros (desarrollo) sin exponer datos personales (LOPDP).
 *
 * - Trabaja sobre una COPIA: nunca modifica la BD original.
 * - Enmascara identificadores directos (nombres, cédulas, teléfonos, emails,
 *   contratos, comprobantes, notas). Conserva estructura y volumen para pruebas.
 * - Valores financieros agregados (DIAS IMPAGO, VALOR EN MORA) se conservan:
 *   dejan de ser personales una vez removidos nombre/cédula/teléfono.
 *
 * Uso:
 *   node scripts/anonymize-db.js <entrada.db> <salida.db>
 * Ejemplo (en la VM, sobre una copia):
 *   node scripts/anonymize-db.js F:\cobranza\data\terminal.db F:\cobranza\backups\terminal-anon.db
 */
const fs = require('fs');
const Database = require('better-sqlite3');

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('Uso: node scripts/anonymize-db.js <entrada.db> <salida.db>');
  process.exit(1);
}
if (!fs.existsSync(input)) { console.error('No existe la BD de entrada:', input); process.exit(1); }
if (fs.existsSync(output)) { console.error('La salida ya existe (borra o usa otro nombre):', output); process.exit(1); }

// 1. Copiar el archivo → trabajamos solo sobre la copia
fs.copyFileSync(input, output);
const db = new Database(output);
db.pragma('foreign_keys = OFF');

const exists = (t) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
const cols = (t) => exists(t) ? db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name) : [];
const has = (t, c) => cols(t).includes(c);
const run = (label, sql) => { try { const r = db.prepare(sql).run(); console.log(`  ${label}: ${r.changes} filas`); } catch (e) { console.warn(`  ${label}: omitido (${e.message})`); } };

console.log('Anonimizando copia:', output);
db.transaction(() => {
  // usuarios — conserva rol/estado/supervisor_id (estructura), enmascara identidad
  if (exists('usuarios')) {
    run('usuarios.nombre/email/hash',
      "UPDATE usuarios SET nombre='Usuario '||id, email='user'||id||'@example.local', password_hash='$2a$10$anonAnonAnonAnonAnonAOanonAnonAnonAnonAnonAnonAn'");
  }
  // contactos — identificadores directos del deudor
  if (exists('contactos')) {
    if (has('contactos','nombre_deudor')) run('contactos.nombre_deudor', "UPDATE contactos SET nombre_deudor='Deudor '||id");
    if (has('contactos','cedula'))        run('contactos.cedula',        "UPDATE contactos SET cedula=printf('%010d', id)");
    if (has('contactos','telefono'))      run('contactos.telefono',      "UPDATE contactos SET telefono='09'||printf('%08d', id)");
    if (has('contactos','metadata')) {
      // Enmascara Nº CONTRATO y EMPRESA dentro del JSON (si es JSON válido)
      run('contactos.metadata.Nº CONTRATO',
        "UPDATE contactos SET metadata=json_set(metadata,'$.\"Nº CONTRATO\"','CT-'||id) WHERE json_valid(metadata) AND json_extract(metadata,'$.\"Nº CONTRATO\"') IS NOT NULL");
      run('contactos.metadata.EMPRESA',
        "UPDATE contactos SET metadata=json_set(metadata,'$.\"EMPRESA\"','EMP-'||(id%5)) WHERE json_valid(metadata) AND json_extract(metadata,'$.\"EMPRESA\"') IS NOT NULL");
    }
  }
  // cdrs — snapshots del cliente + comprobante + notas libres
  if (exists('cdrs')) {
    if (has('cdrs','snapshot_nombre'))   run('cdrs.snapshot_nombre',   "UPDATE cdrs SET snapshot_nombre='Deudor '||contacto_id WHERE snapshot_nombre IS NOT NULL");
    if (has('cdrs','snapshot_cedula'))   run('cdrs.snapshot_cedula',   "UPDATE cdrs SET snapshot_cedula=printf('%010d', COALESCE(contacto_id,id)) WHERE snapshot_cedula IS NOT NULL");
    if (has('cdrs','snapshot_telefono')) run('cdrs.snapshot_telefono', "UPDATE cdrs SET snapshot_telefono='09'||printf('%08d', COALESCE(contacto_id,id)) WHERE snapshot_telefono IS NOT NULL");
    if (has('cdrs','snapshot_empresa'))  run('cdrs.snapshot_empresa',  "UPDATE cdrs SET snapshot_empresa='EMP' WHERE snapshot_empresa IS NOT NULL");
    if (has('cdrs','comprobante'))       run('cdrs.comprobante',       "UPDATE cdrs SET comprobante='CMP-'||id WHERE comprobante IS NOT NULL");
    if (has('cdrs','notas'))             run('cdrs.notas',             "UPDATE cdrs SET notas=NULL WHERE notas IS NOT NULL");
  }
  // sub_gestiones — referencias (terceros)
  if (exists('sub_gestiones')) {
    if (has('sub_gestiones','telefono'))   run('sub_gestiones.telefono',   "UPDATE sub_gestiones SET telefono='09'||printf('%08d', id)");
    if (has('sub_gestiones','nombre_ref')) run('sub_gestiones.nombre_ref', "UPDATE sub_gestiones SET nombre_ref='Referencia '||id WHERE nombre_ref IS NOT NULL");
    if (has('sub_gestiones','notas'))      run('sub_gestiones.notas',      "UPDATE sub_gestiones SET notas=NULL WHERE notas IS NOT NULL");
  }
  // validaciones_pago — cédula/contrato/empresa
  if (exists('validaciones_pago')) {
    if (has('validaciones_pago','cedula'))   run('validaciones_pago.cedula',   "UPDATE validaciones_pago SET cedula=printf('%010d', id) WHERE cedula IS NOT NULL");
    if (has('validaciones_pago','contrato')) run('validaciones_pago.contrato', "UPDATE validaciones_pago SET contrato='CT-'||id WHERE contrato IS NOT NULL");
    if (has('validaciones_pago','empresa'))  run('validaciones_pago.empresa',  "UPDATE validaciones_pago SET empresa='EMP' WHERE empresa IS NOT NULL");
  }
  // agendamientos — notas libres
  if (exists('agendamientos') && has('agendamientos','notas')) {
    run('agendamientos.notas', "UPDATE agendamientos SET notas=NULL WHERE notas IS NOT NULL");
  }
})();

db.pragma('foreign_keys = ON');
db.exec('VACUUM');
db.close();
console.log('Listo. Copia anonimizada lista para entregar:', output);
console.log('IMPORTANTE: revisa una muestra antes de entregar y conserva el original solo en la VM.');
