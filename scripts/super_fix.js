const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbsOptions = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'terminal-cobranza', 'terminal.db'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Electron', 'terminal-cobranza', 'terminal.db'),
    path.join(__dirname, '..', 'data', 'terminal.db')
];

const tipificacionesAceptadas = [
    { codigo: 'PMP', descripcion: 'Compromiso de pago', requiere_agd: 1, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1 },
    { codigo: 'AB_PARC', descripcion: 'Abono parcial', requiere_agd: 0, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1 },
    { codigo: 'VOL_CALL', descripcion: 'Volver a llamar', requiere_agd: 1, categoria: 'CONTACTO EXITOSO', finaliza_gestion: 1 },
    { codigo: 'NEG_PAG', descripcion: 'Negativa de Pago', requiere_agd: 0, categoria: 'CONTACTO NEUTRO', finaliza_gestion: 1 },
    { codigo: 'TER_CON', descripcion: 'Tercero conocido', requiere_agd: 0, categoria: 'CONTACTO NEUTRO', finaliza_gestion: 1 },
    { codigo: 'NUM_EQ', descripcion: 'Numero equivocado', requiere_agd: 0, categoria: 'CONTACTO NEGATIVO', finaliza_gestion: 1 },
    { codigo: 'TIT_FAL', descripcion: 'Titular fallecido', requiere_agd: 0, categoria: 'CONTACTO NEGATIVO', finaliza_gestion: 1 }
];

const codigosAceptados = tipificacionesAceptadas.map(t => `'${t.codigo}'`).join(',');

dbsOptions.forEach(dbPath => {
    if (fs.existsSync(dbPath)) {
        try {
            console.log('Fixing:', dbPath);
            const db = new Database(dbPath);
            const tables = db.pragma("table_info(tipificaciones)");
            if (tables.length === 0) return;

            db.transaction(() => {
                const hasCol = tables.some(c => c.name === 'categoria');
                if (!hasCol) db.prepare("ALTER TABLE tipificaciones ADD COLUMN categoria TEXT DEFAULT 'NO_CONTACTADO'").run();
                const hasFg = tables.some(c => c.name === 'finaliza_gestion');
                if (!hasFg) db.prepare("ALTER TABLE tipificaciones ADD COLUMN finaliza_gestion INTEGER DEFAULT 1").run();

                db.prepare(`UPDATE cdrs SET tipificacion_id = NULL WHERE tipificacion_id IN (SELECT id FROM tipificaciones WHERE codigo NOT IN (${codigosAceptados}))`).run();
                const res = db.prepare(`DELETE FROM tipificaciones WHERE codigo NOT IN (${codigosAceptados})`).run();
                console.log(`Deleted ${res.changes} invalid tipificaciones in`, dbPath);

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
            db.close();
        } catch (e) {
            console.log('Error on', dbPath, e.message);
        }
    }
});
