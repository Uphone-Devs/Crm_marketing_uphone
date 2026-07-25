/**
 * tunnel.js — Wrapper para cloudflared quick tunnel (solo desarrollo/demo).
 * NUNCA usar en producción: expone el puerto 3001 a internet sin TLS propio.
 * En producción usar nginx + certificado + NSG que restrinja el 3001 a localhost.
 */
if (process.env.NODE_ENV === 'production') {
  console.error('[TUNNEL] Bloqueado en producción. Usar nginx+TLS en su lugar.');
  process.exit(1);
}

const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');

const LOG_FILE = path.join('F:\\cobranza\\logs', 'tunnel-url.txt');

const proc = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3001'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

function handleOutput(data) {
  const text = data.toString();
  process.stdout.write(text);

  const match = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
  if (match) {
    const url = match[0];
    console.log(`\n[TUNNEL] URL activa: ${url}\n`);
    fs.writeFileSync(LOG_FILE, url, 'utf8');
  }
}

proc.stdout.on('data', handleOutput);
proc.stderr.on('data', handleOutput);

proc.on('exit', (code) => {
  console.log(`[TUNNEL] cloudflared salió con código ${code}`);
});
