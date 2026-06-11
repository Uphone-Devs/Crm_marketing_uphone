/**
 * k6-asesores.js — Prueba de carga: ¿la terminal aguanta 80 asesores en simultáneo?
 *
 * Modela la sesión REAL de un asesor (protocolo verificado en wsServer.js / apiServer.js):
 *   1. POST /api/auth/login            → token JWT
 *   2. WS ws://IP:3001?token=JWT       → IDENTIFICAR (rol ASESOR)
 *   3. Periódico: METRICAS_ASESOR + CAMBIO_ESTADO (como el panel real)
 *   4. Ciclo REST a ritmo humano: siguiente contacto → CDR → métricas → cartera
 *
 * DOS escenarios (elige con SCENARIO=...):
 *   - capacity   (default): 80 sesiones WS+REST concurrentes a ritmo humano.
 *                Usa UN token y varía asesor_id sintético → no lo bloquea C4.
 *                Mide si el proceso/SQLite/túnel sostienen 80 conexiones.
 *   - login_storm: 80 logins en ráfaga → MIDE C4 (rate limit). Cuenta los 429.
 *
 * Uso (PowerShell en la VM o en un cliente con red a la VM):
 *   $env:BASE_URL="http://127.0.0.1:3001"; $env:EMAIL="asesor@uphone.local"; $env:PASSWORD="asesor123"
 *   k6 run scripts/load/k6-asesores.js                      # capacity, 80 VUs
 *   $env:SCENARIO="login_storm"; k6 run scripts/load/k6-asesores.js   # verifica C4
 *
 * Parámetros (env): BASE_URL, WS_URL(opcional), EMAIL, PASSWORD, VUS, DURATION, RAMP, CAMPANA_ID
 * Ver README.md en esta carpeta.
 */

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ── Configuración ──────────────────────────────────────────────
const BASE_URL  = __ENV.BASE_URL  || 'http://127.0.0.1:3001';
const EMAIL     = __ENV.EMAIL     || 'asesor@uphone.local';
const PASSWORD  = __ENV.PASSWORD  || 'asesor123';
const VUS       = parseInt(__ENV.VUS || '80', 10);
const DURATION  = __ENV.DURATION  || '3m';
const RAMP      = __ENV.RAMP      || '30s';
const SCENARIO  = __ENV.SCENARIO  || 'capacity';
const CAMPANA   = __ENV.CAMPANA_ID ? parseInt(__ENV.CAMPANA_ID, 10) : null;
// ws://host:port derivado del BASE_URL si no se pasa WS_URL explícito.
const WS_URL = __ENV.WS_URL || BASE_URL.replace(/^http(s?):/, 'ws$1:');

// ── Métricas custom ────────────────────────────────────────────
const wsConnErrors  = new Rate('ws_connection_errors');
const wsSessionTime = new Trend('ws_session_ms', true);
const restErrors    = new Rate('rest_errors');
const restLatency   = new Trend('rest_latency_ms', true);
const login429      = new Counter('login_rate_limited_429');   // ← C4
const loginOk       = new Counter('login_ok');
const loginFail     = new Counter('login_failed_otro');

// ── Escenarios ─────────────────────────────────────────────────
const scenarios = {
  capacity: {
    executor: 'ramping-vus',
    exec: 'advisorSession',
    startVUs: 0,
    stages: [
      { duration: RAMP, target: VUS },
      { duration: DURATION, target: VUS },
      { duration: '15s', target: 0 },
    ],
    gracefulRampDown: '10s',
  },
  login_storm: {
    executor: 'per-vu-iterations',
    exec: 'loginStorm',
    vus: VUS,
    iterations: 1,            // cada VU intenta 1 login → ráfaga de 80 logins
    maxDuration: '60s',
  },
};

export const options = {
  scenarios: { [SCENARIO]: scenarios[SCENARIO] },
  thresholds: {
    rest_errors:          ['rate<0.05'],   // <5% de REST fallidos
    rest_latency_ms:      ['p(95)<800'],   // p95 < 800ms
    ws_connection_errors: ['rate<0.02'],   // <2% de WS que no abren
    http_req_duration:    ['p(95)<1000'],
  },
};

// ── Helpers ────────────────────────────────────────────────────
function login() {
  const res = http.post(`${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } });
  return res;
}

// setup(): un único login para el escenario capacity (no lo bloquea C4).
export function setup() {
  if (SCENARIO === 'login_storm') return {};
  const res = login();
  check(res, { 'setup login 200': (r) => r.status === 200 });
  const token = res.json('token');
  if (!token) throw new Error(`Setup login falló (status ${res.status}): ${res.body}`);
  return { token };
}

// ── Escenario CAPACITY: sesión completa de asesor ──────────────
export function advisorSession(data) {
  const token = data.token;
  const asesorId = 100000 + __VU;             // id sintético único por VU
  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const start = Date.now();

  const url = `${WS_URL}/?token=${encodeURIComponent(token)}`;
  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      socket.send(JSON.stringify({ tipo: 'IDENTIFICAR', rol: 'ASESOR', asesor_id: asesorId, nombre: `LoadVU${__VU}` }));

      // Métricas cada 3s (como el panel real empuja al supervisor)
      socket.setInterval(() => {
        socket.send(JSON.stringify({
          tipo: 'METRICAS_ASESOR', marcaciones: 5, total_gestiones: 3, total_compromisos: 1,
          eficiencia: 60, tiempo_productivo: 120, tiempo_improductivo: 40, estado_actual_id: 1,
          tiempos_acumulados: {},
        }));
      }, 3000);

      // Cambio de estado cada 12s
      socket.setInterval(() => {
        socket.send(JSON.stringify({ tipo: 'CAMBIO_ESTADO', estado_id: 1, nombre_estado: 'En Gestión' }));
      }, 12000);

      // Ciclo REST cada ~8s (ritmo humano de gestión)
      socket.setInterval(() => { restCycle(asesorId, authHeaders); }, 8000);

      // Cierra la sesión a los ~60s → el VU reconecta (rotación realista)
      socket.setTimeout(() => socket.close(), 60000);
    });

    socket.on('ping', () => socket.pong());
    socket.on('error', () => wsConnErrors.add(1));
    socket.on('close', () => { wsConnErrors.add(0); wsSessionTime.add(Date.now() - start); });
  });

  check(res, { 'WS status 101': (r) => r && r.status === 101 }) || wsConnErrors.add(1);
  sleep(1);
}

function restCycle(asesorId, headers) {
  // 1. Campañas del asesor
  timed('GET /campanas/asesor', () =>
    http.get(`${BASE_URL}/api/campanas/asesor/${asesorId}`, { headers, tags: { name: 'campanas_asesor' } }));

  // 2. Métricas del día
  timed('GET /metricas', () =>
    http.get(`${BASE_URL}/api/metricas/${asesorId}`, { headers, tags: { name: 'metricas_dia' } }));

  // 3. Cartera del asesor
  timed('GET /cartera', () =>
    http.get(`${BASE_URL}/api/cartera`, { headers, tags: { name: 'cartera' } }));

  // 4. Siguiente contacto + (best-effort) abrir CDR
  if (CAMPANA) {
    const sig = timed('GET /siguiente', () =>
      http.get(`${BASE_URL}/api/campanas/${CAMPANA}/siguiente`, { headers, tags: { name: 'siguiente' } }));
    let contactoId = null;
    try { contactoId = sig.json('id'); } catch (_) { /* sin contacto */ }
    if (contactoId) {
      const ins = http.post(`${BASE_URL}/api/cdrs`,
        JSON.stringify({ contactoId, timestampInicio: new Date().toISOString() }),
        { headers, tags: { name: 'insert_cdr' } });
      restLatency.add(ins.timings.duration);
    }
  }
}

function timed(name, fn) {
  const res = fn();
  restLatency.add(res.timings.duration);
  restErrors.add(res.status >= 400 || res.status === 0);
  return res;
}

// ── Escenario LOGIN_STORM: verifica C4 (rate limit) ────────────
export function loginStorm() {
  const res = login();
  if (res.status === 200)      loginOk.add(1);
  else if (res.status === 429) login429.add(1);   // "Demasiados intentos" → C4
  else                         loginFail.add(1);
  check(res, { 'login no 5xx': (r) => r.status < 500 });
}

// ── Resumen legible al final ───────────────────────────────────
export function handleSummary(data) {
  const m = data.metrics;
  const get = (k, f = 'count') => (m[k] && m[k].values ? m[k].values[f] : undefined);
  const lines = [
    '',
    '════════ RESUMEN PRUEBA DE CARGA ════════',
    `Escenario: ${SCENARIO}   VUs objetivo: ${VUS}   Target: ${BASE_URL}`,
  ];
  if (SCENARIO === 'login_storm') {
    lines.push(
      `Logins OK:            ${get('login_ok') || 0}`,
      `Logins 429 (C4):      ${get('login_rate_limited_429') || 0}  ← si >0, C4 CONFIRMADO`,
      `Logins fallo (otro):  ${get('login_failed_otro') || 0}`,
    );
  } else {
    lines.push(
      `WS errores conexión:  ${(get('ws_connection_errors', 'rate') * 100 || 0).toFixed(2)}%`,
      `REST errores:         ${(get('rest_errors', 'rate') * 100 || 0).toFixed(2)}%`,
      `REST latencia p95:    ${(get('rest_latency_ms', 'p(95)') || 0).toFixed(0)} ms`,
      `WS sesión media:      ${(get('ws_session_ms', 'avg') || 0).toFixed(0)} ms`,
    );
  }
  lines.push('═════════════════════════════════════════', '');
  return { stdout: lines.join('\n') };
}
