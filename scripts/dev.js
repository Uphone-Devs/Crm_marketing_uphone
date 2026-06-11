/**
 * dev.js — Script de arranque para desarrollo
 * Orden: 1) electron-vite build main/preload  2) copy src/main→out/main  3) electron-vite serve renderer + launch electron
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 1. Build main + preload (sin renderer ni servidor)
console.log('[dev] Building main + preload...');
try {
  execSync('node_modules\\.bin\\electron-vite.cmd build --mode development --outDir out/main -- --config electron.vite.config.js', {
    cwd: ROOT, stdio: 'inherit'
  });
} catch (e) {
  // ignorar errores de build parcial — el renderer se sirve en dev
}

// 2. Copiar src/main/* → out/main/ (sin sobreescribir index.js del bundle)
console.log('[dev] Copiando módulos locales...');
const SRC = path.join(ROOT, 'src', 'main');
const DST = path.join(ROOT, 'out', 'main');

function copyDir(src, dst, skipIndex = false) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  const items = fs.readdirSync(src, { withFileTypes: true });
  for (const item of items) {
    if (skipIndex && item.name === 'index.js') continue; // no sobreescribir bundle
    const s = path.join(src, item.name);
    const d = path.join(dst, item.name);
    if (item.isDirectory()) {
      copyDir(s, d, false);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

copyDir(SRC, DST, true);
console.log('[dev] Módulos copiados OK');

// 3. Lanzar electron-vite dev (que servirá el renderer y lanzará electron)
console.log('[dev] Iniciando electron-vite dev...');
const evite = spawn('node_modules\\.bin\\electron-vite.cmd', ['dev'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true
});

evite.on('close', (code) => process.exit(code || 0));
