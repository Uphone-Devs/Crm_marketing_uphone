const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Attempting to resolve the db path like in the app
let dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'terminal-cobranza', 'terminal.db');
if (!fs.existsSync(dbPath)) {
    console.error('No DB found at:', dbPath);
    process.exit(1);
}

const db = new Database(dbPath);

const tipificacionesAceptadas = [
    // CONTACTO EXITOSO
    { codigo: 'PMP', descripcion: 'Compromiso de pago', requiere_agd: 1, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1 },
    { codigo: 'AB_PARC', descripcion: 'Abono parcial', requiere_agd: 0, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1 },
    { codigo: 'VOL_CALL', descripcion: 'Volver a llamar', requiere_agd: 1, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1 },
    
    // CONTACTO NEUTRO
    { codigo: 'NEG_PAG', descripcion: 'Negativa de Pago', requiere_agd: 0, categoria: 'CONTACTO NEUTRO', finaliza_gestion: 1 },
    { codigo: 'TER_CON', descripcion: 'Tercero conocido', requiere_agd: 0, categoria: 'CONTACTO NEUTRO', finaliza_gestion: 1 },
    
    // CONTACTO NEGATIVO
    { codigo: 'NUM_EQ', descripcion: 'Numero equivocado', requiere_agd: 0, categoria: 'CONTACTO NEGATIVO', finaliza_gestion: 1 },
    { codigo: 'TIT_FAL', descripcion: 'Titular fallecido', requiere_agd: 0, categoria: 'CONTACTO NEGATIVO', finaliza_gestion: 1 }
];

const codigosAceptados = tipificacionesAceptadas.map(t => t.codigo);

db.transaction(() => {
    // Para las descripciones que hay que eliminar, primero actualizamos cualquier CDR que las esté referenciando para que no haya FK constaint error (aunque SQLite default foreign_keys=OFF, mejor prevenir)
    db.prepare(`UPDATE cdrs SET tipificacion_id = NULL WHERE tipificacion_id IN (SELECT id FROM tipificaciones WHERE codigo NOT IN (${codigosAceptados.map(()=>'?').join(',')}))`).run(...codigosAceptados);
    
    // Eliminamos las que no están en la lista
    const stmtDel = db.prepare(`DELETE FROM tipificaciones WHERE codigo NOT IN (${codigosAceptados.map(()=>'?').join(',')})`);
    stmtDel.run(...codigosAceptados);
    
    // Insertamos / Actualizamos las nuevas
    const insertOrUpdate = db.prepare(`
        INSERT INTO tipificaciones (codigo, descripcion, requiere_agd, categoria, finaliza_gestion)
        VALUES (@codigo, @descripcion, @requiere_agd, @categoria, @finaliza_gestion)
        ON CONFLICT(codigo) DO UPDATE SET 
            descripcion = excluded.descripcion,
            requiere_agd = excluded.requiere_agd,
            categoria = excluded.categoria,
            finaliza_gestion = excluded.finaliza_gestion
    `);

    for(const t of tipificacionesAceptadas) {
        insertOrUpdate.run(t);
    }
})();

console.log('Tipificaciones actualizadas con éxito.');
