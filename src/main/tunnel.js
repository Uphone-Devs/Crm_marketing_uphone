/**
 * tunnel.js — Wrapper para cloudflared quick tunnel.
 * PM2 lo gestiona como proceso Node.js, capturando stdout/stderr.
 * Extrae y loguea la URL del tunnel al arrancar.
 */
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
