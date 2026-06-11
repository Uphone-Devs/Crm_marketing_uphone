const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const appDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'terminal-cobranza', 'terminal.db');
const devAppDataPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Electron', 'terminal-cobranza', 'terminal.db');

let dbPath = appDataPath;
if(process.argv.includes('--dev')) dbPath = devAppDataPath;

try {
    const db = new Database(dbPath);
    const row = db.prepare('SELECT * FROM tipificaciones').all();
    console.log(`DB PATH: ${dbPath}`);
    console.log(JSON.stringify(row, null, 2));
} catch(e) {
    console.log('Error opening db:', e.message);
}
