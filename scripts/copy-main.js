/**
 * copy-main.js
 * Copia recursivamente src/main/ → out/main/ para que electron-vite
 * pueda resolver los módulos locales en modo dev.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'main');
const DST = path.join(__dirname, '..', 'out', 'main');

function copyDir(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  const items = fs.readdirSync(src, { withFileTypes: true });
  for (const item of items) {
    const s = path.join(src, item.name);
    const d = path.join(dst, item.name);
    if (item.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

copyDir(SRC, DST);
console.log('[copy-main] src/main/ → out/main/ copiado OK');
