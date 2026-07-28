# Auto-update con ventana horaria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a la app Electron auto-update que descarga en background y avisa para reiniciar, solo dentro de una ventana horaria configurable por el admin.

**Architecture:** `electron-updater` (provider `generic` tras cloudflare tunnel). La política de ventana vive en Postgres (backend), editable desde el Panel Admin. `autoUpdater` corre en el main process; el renderer le pasa el `apiBase` tras login y el main hace polling de la política, evalúa la ventana (TZ América/Guayaquil) y solo entonces chequea updates. Al terminar la descarga muestra un toast "Reiniciar ahora".

**Tech Stack:** Electron 42, electron-updater, electron-builder (NSIS), Express + Prisma (Postgres), React 19, Vitest.

---

## Decisiones (del spec `2026-07-28-auto-update-ventana-horaria-design.md`)

- Hosting: `generic` HTTP tras cloudflare tunnel + VPN.
- UX: auto-descarga background + aviso "Reiniciar ahora"; el usuario elige.
- Ventana: Panel Admin → Postgres → leída por clientes. Gating opción A (solo chequea dentro de la ventana).
- TZ Guayaquil, intervalo 30 min default, días configurables.
- Refinamiento de implementación (semántica idéntica al spec): el polling + evaluación de ventana ocurre en el **main process** (donde vive `autoUpdater`). El renderer pasa `apiBase` al main una vez tras login. `GET /update-policy` es público (schedule no es secreto); `PUT` sigue admin-only.

## File Structure

- Create: `src/main/updateWindow.js` — funciones puras: `isDentroDeVentana(now, policy)`, `validatePolicyInput(body)`. Sin Electron/Node-net → testeable con Vitest.
- Create: `src/main/updater.js` — wiring de `autoUpdater`: timer de polling, fetch de política, eventos, `restartNow()`.
- Modify: `electron-builder.yml` — bloque `publish`.
- Modify: `package.json` — dep `electron-updater`.
- Modify: `backend/prisma/schema.prisma` — modelo `UpdatePolicy`.
- Modify: `backend/src/routes/admin.routes.js` — rutas GET/PUT `/update-policy`.
- Modify: `src/main/preload.js` — canales IPC nuevos.
- Modify: `src/main/ipcHandlers.js` — handlers `updater:start`, `updater:restartNow`.
- Modify: `src/renderer/login/LoginPage.jsx` — llamar `updater:start` tras login.
- Create: `src/renderer/shared/UpdaterListener.jsx` — componente que escucha `updater:downloaded` y muestra toast.
- Modify: `src/renderer/asesor/AsesorPanel.jsx`, `src/renderer/supervisor/SupervisorPanel.jsx`, `src/renderer/admin/AdminPanel.jsx` — montar `<UpdaterListener/>`.
- Modify: `src/renderer/admin/AdminPanel.jsx` — sección UI "Actualizaciones".
- Create: `tests/unit/updater-window.test.js` — tests de `updateWindow.js`.

---

### Task 1: Instalar electron-updater y configurar publish

**Files:**
- Modify: `package.json`
- Modify: `electron-builder.yml:36`

- [ ] **Step 1: Instalar dependencia**

Run: `npm install electron-updater@^6`
Expected: `electron-updater` añadido a `dependencies` en `package.json`.

- [ ] **Step 2: Configurar publish en electron-builder.yml**

Reemplazar la línea final `publish: null` por:

```yaml
publish:
  provider: generic
  url: https://REEMPLAZAR-CON-TU-TUNNEL/updates/
```

(La URL apunta a la carpeta servida por el cloudflare tunnel donde electron-builder subirá `latest.yml` + el `.exe`.)

- [ ] **Step 3: Verificar que el build sigue compilando**

Run: `npm run build:app`
Expected: build de electron-vite OK, sin errores de config.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json electron-builder.yml
git commit -m "feat(update): add electron-updater and generic publish config"
```

---

### Task 2: Funciones puras de ventana + validación (TDD)

**Files:**
- Create: `src/main/updateWindow.js`
- Test: `tests/unit/updater-window.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/updater-window.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { isDentroDeVentana, validatePolicyInput } from '../../src/main/updateWindow.js';

// Helper: construye un Date que, en TZ America/Guayaquil (UTC-5, sin DST),
// cae en el día/hora deseados. Guayaquil = UTC-5 → sumamos 5h al armar el UTC.
function gyeDate(weekday0Sun, hh, mm) {
  // 2026-07-05 es domingo. Sumamos 'weekday0Sun' días para elegir el día.
  const day = 5 + weekday0Sun; // 5=domingo ... 11=sábado (julio 2026)
  return new Date(Date.UTC(2026, 6, day, hh + 5, mm, 0));
}

describe('isDentroDeVentana', () => {
  const base = { enabled: true, startTime: '13:00', endTime: '14:00', days: [1, 2, 3, 4, 5] };

  it('false si enabled=false', () => {
    expect(isDentroDeVentana(gyeDate(1, 13, 30), { ...base, enabled: false })).toBe(false);
  });

  it('true dentro de ventana mismo día y día permitido (martes 13:30)', () => {
    expect(isDentroDeVentana(gyeDate(2, 13, 30), base)).toBe(true);
  });

  it('false fuera de ventana (martes 15:00)', () => {
    expect(isDentroDeVentana(gyeDate(2, 15, 0), base)).toBe(false);
  });

  it('false si el día no está en days (domingo 13:30)', () => {
    expect(isDentroDeVentana(gyeDate(0, 13, 30), base)).toBe(false);
  });

  it('ventana que cruza medianoche: true a las 23:00', () => {
    const nocturna = { enabled: true, startTime: '20:00', endTime: '08:00', days: [0, 1, 2, 3, 4, 5, 6] };
    expect(isDentroDeVentana(gyeDate(3, 23, 0), nocturna)).toBe(true);
  });

  it('ventana que cruza medianoche: true a las 02:00', () => {
    const nocturna = { enabled: true, startTime: '20:00', endTime: '08:00', days: [0, 1, 2, 3, 4, 5, 6] };
    expect(isDentroDeVentana(gyeDate(3, 2, 0), nocturna)).toBe(true);
  });

  it('ventana nula start==end → false', () => {
    expect(isDentroDeVentana(gyeDate(2, 13, 0), { ...base, startTime: '13:00', endTime: '13:00' })).toBe(false);
  });
});

describe('validatePolicyInput', () => {
  it('acepta payload válido', () => {
    const r = validatePolicyInput({ enabled: true, startTime: '13:00', endTime: '14:00', days: [1, 2], checkIntervalMin: 30 });
    expect(r.ok).toBe(true);
  });

  it('rechaza HH:MM inválido', () => {
    const r = validatePolicyInput({ enabled: true, startTime: '25:00', endTime: '14:00', days: [1], checkIntervalMin: 30 });
    expect(r.ok).toBe(false);
  });

  it('rechaza día fuera de rango', () => {
    const r = validatePolicyInput({ enabled: true, startTime: '13:00', endTime: '14:00', days: [7], checkIntervalMin: 30 });
    expect(r.ok).toBe(false);
  });

  it('rechaza checkIntervalMin <= 0', () => {
    const r = validatePolicyInput({ enabled: true, startTime: '13:00', endTime: '14:00', days: [1], checkIntervalMin: 0 });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/unit/updater-window.test.js`
Expected: FAIL — `Failed to resolve import '../../src/main/updateWindow.js'`.

- [ ] **Step 3: Implementar `updateWindow.js`**

Crear `src/main/updateWindow.js`:

```js
/**
 * updateWindow.js — Lógica pura de la ventana horaria de auto-update.
 * Sin dependencias de Electron ni red → testeable con Vitest en node.
 * La hora se evalúa en América/Guayaquil (UTC-5, sin DST).
 */

const DAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Devuelve { day: 0-6, minutes: 0-1439 } en hora local de Guayaquil. */
function partesGuayaquil(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guayaquil',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // algunos runtimes devuelven '24' a medianoche
  const minutes = hour * 60 + parseInt(parts.minute, 10);
  return { day: DAY_MAP[parts.weekday], minutes };
}

function aMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * ¿La fecha `now` cae dentro de la ventana de update definida por `policy`?
 * @param {Date} now
 * @param {{enabled:boolean,startTime:string,endTime:string,days:number[]}} policy
 */
export function isDentroDeVentana(now, policy) {
  if (!policy || !policy.enabled) return false;
  if (!HHMM_RE.test(policy.startTime) || !HHMM_RE.test(policy.endTime)) return false;

  const { day, minutes } = partesGuayaquil(now);
  if (Array.isArray(policy.days) && policy.days.length && !policy.days.includes(day)) return false;

  const start = aMinutos(policy.startTime);
  const end = aMinutos(policy.endTime);
  if (start === end) return false; // ventana nula

  if (start < end) return minutes >= start && minutes < end; // mismo día
  return minutes >= start || minutes < end; // cruza medianoche
}

/** Valida el payload que llega al PUT de la política. */
export function validatePolicyInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'payload requerido' };
  if (typeof body.enabled !== 'boolean') return { ok: false, error: 'enabled debe ser boolean' };
  if (!HHMM_RE.test(body.startTime)) return { ok: false, error: 'startTime formato HH:MM' };
  if (!HHMM_RE.test(body.endTime)) return { ok: false, error: 'endTime formato HH:MM' };
  if (!Array.isArray(body.days) || body.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { ok: false, error: 'days debe ser array de enteros 0-6' };
  }
  if (!Number.isInteger(body.checkIntervalMin) || body.checkIntervalMin <= 0) {
    return { ok: false, error: 'checkIntervalMin debe ser entero > 0' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/unit/updater-window.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/updateWindow.js tests/unit/updater-window.test.js
git commit -m "feat(update): pure window/validation logic with tests"
```

---

### Task 3: Modelo Prisma UpdatePolicy + migración

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Añadir el modelo al schema**

Agregar al final de `backend/prisma/schema.prisma` (antes de los enums, siguiendo el estilo del archivo):

```prisma
model UpdatePolicy {
  id               Int      @id @default(1)
  enabled          Boolean  @default(false)
  startTime        String   @default("13:00") @map("start_time")
  endTime          String   @default("14:00") @map("end_time")
  days             Int[]    @default([1, 2, 3, 4, 5])
  checkIntervalMin Int      @default(30) @map("check_interval_min")
  updatedAt        DateTime @updatedAt @map("updated_at")

  @@map("update_policy")
}
```

- [ ] **Step 2: Crear la migración**

Run: `cd backend && npx prisma migrate dev --name add_update_policy`
Expected: crea `backend/prisma/migrations/*_add_update_policy/` y aplica la tabla. Prisma Client regenerado.

- [ ] **Step 3: Sembrar la fila singleton (id=1)**

Run:
```bash
cd backend && node -e "const p=require('./src/config/db');p.updatePolicy.upsert({where:{id:1},update:{},create:{id:1}}).then(()=>{console.log('seed ok');process.exit(0)})"
```
Expected: `seed ok`. Fila id=1 con defaults.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(update): UpdatePolicy prisma model + migration"
```

---

### Task 4: Rutas backend GET/PUT /update-policy

**Files:**
- Modify: `backend/src/routes/admin.routes.js:320` (antes de `module.exports = router;`)

- [ ] **Step 1: Añadir helper de validación al inicio del archivo**

Debajo de los `require` existentes en `backend/src/routes/admin.routes.js`, agregar:

```js
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function validarPolicy(b) {
  if (!b || typeof b !== 'object') return 'payload requerido';
  if (typeof b.enabled !== 'boolean') return 'enabled debe ser boolean';
  if (!HHMM_RE.test(b.startTime)) return 'startTime formato HH:MM';
  if (!HHMM_RE.test(b.endTime)) return 'endTime formato HH:MM';
  if (!Array.isArray(b.days) || b.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    return 'days debe ser array de enteros 0-6';
  if (!Number.isInteger(b.checkIntervalMin) || b.checkIntervalMin <= 0)
    return 'checkIntervalMin debe ser entero > 0';
  return null;
}
```

- [ ] **Step 2: Añadir las rutas antes de `module.exports = router;`**

```js
// ── Auto-update: política de ventana horaria ───────────────────────────────
// GET público: el main process de cada cliente lo lee sin token (schedule no es secreto).
router.get('/update-policy', async (req, res) => {
  try {
    const policy = await prisma.updatePolicy.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    res.json(policy);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo política de update' });
  }
});

// PUT admin-only: editar la ventana.
router.put('/update-policy', authMiddleware, requireRole('admin'), async (req, res) => {
  const errorMsg = validarPolicy(req.body);
  if (errorMsg) return res.status(400).json({ error: errorMsg });
  try {
    const { enabled, startTime, endTime, days, checkIntervalMin } = req.body;
    const policy = await prisma.updatePolicy.upsert({
      where: { id: 1 },
      update: { enabled, startTime, endTime, days, checkIntervalMin },
      create: { id: 1, enabled, startTime, endTime, days, checkIntervalMin },
    });
    res.json(policy);
  } catch (err) {
    res.status(500).json({ error: 'Error guardando política de update' });
  }
});
```

- [ ] **Step 3: Verificación manual del endpoint**

Arrancar backend (`cd backend && node src/index.js`) y en otra terminal:
```bash
curl http://127.0.0.1:3001/api/admin/update-policy
```
Expected: JSON con `enabled:false, startTime:"13:00", ...`. El PUT sin token debe dar 401.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/admin.routes.js
git commit -m "feat(update): GET(public)/PUT(admin) update-policy routes"
```

---

### Task 5: Módulo updater.js (main process)

**Files:**
- Create: `src/main/updater.js`

- [ ] **Step 1: Implementar `updater.js`**

Crear `src/main/updater.js`:

```js
/**
 * updater.js — Auto-update con electron-updater, restringido a ventana horaria.
 * Solo activo en app empaquetada. El renderer pasa `apiBase` tras login (startUpdater).
 * Cada ciclo lee la política del backend y, si estamos dentro de la ventana,
 * dispara checkForUpdates(). Al descargar, avisa al renderer (updater:downloaded).
 */
const { app, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const { isDentroDeVentana } = require('./updateWindow');

let apiBase = null;      // ej. http://127.0.0.1:3001/api
let timer = null;
let intervalMin = 30;

function log(...args) {
  console.log('[UPDATER]', ...args);
}

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  });
}

async function fetchPolicy() {
  const res = await fetch(`${apiBase}/admin/update-policy`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function tick() {
  try {
    const policy = await fetchPolicy();
    if (Number.isInteger(policy.checkIntervalMin) && policy.checkIntervalMin > 0) {
      // Reprograma el timer si cambió el intervalo.
      if (policy.checkIntervalMin !== intervalMin) {
        intervalMin = policy.checkIntervalMin;
        reschedule();
      }
    }
    if (isDentroDeVentana(new Date(), policy)) {
      log('Dentro de ventana → checkForUpdates');
      autoUpdater.checkForUpdates().catch((e) => log('checkForUpdates error:', e.message));
    } else {
      log('Fuera de ventana → skip');
    }
  } catch (err) {
    log('tick error (skip ciclo):', err.message);
  }
}

function reschedule() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, intervalMin * 60 * 1000);
}

/** Llamado vía IPC desde el renderer tras login. */
function startUpdater(base) {
  if (!app.isPackaged) {
    log('Dev mode → updater desactivado');
    return;
  }
  apiBase = base;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // el usuario controla el reinicio

  autoUpdater.removeAllListeners();
  autoUpdater.on('update-downloaded', (info) => {
    log('update-downloaded', info.version);
    broadcast('updater:downloaded', { version: info.version });
  });
  autoUpdater.on('error', (err) => log('autoUpdater error:', err.message));

  reschedule();
  tick(); // primer chequeo inmediato
}

function restartNow() {
  autoUpdater.quitAndInstall();
}

function stopUpdater() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startUpdater, restartNow, stopUpdater };
```

- [ ] **Step 2: Verificar que no rompe el arranque en dev**

Run: `npm run dev`
Expected: la app arranca; consola muestra `[UPDATER] Dev mode → updater desactivado` cuando el renderer llame startUpdater (tras login). Cerrar.

- [ ] **Step 3: Commit**

```bash
git add src/main/updater.js
git commit -m "feat(update): main-process updater module with window gating"
```

---

### Task 6: Canales IPC (preload + ipcHandlers) + cleanup en index.js

**Files:**
- Modify: `src/main/preload.js:67` (bloque Admin de `allowedChannels`)
- Modify: `src/main/preload.js:76` (allowedChannels de `on` y `removeAllListeners`)
- Modify: `src/main/ipcHandlers.js` (junto a los handlers `admin:*`)
- Modify: `src/main/index.js:135` (`will-quit`)

- [ ] **Step 1: Añadir canales invoke en preload.js**

En `src/main/preload.js`, dentro del array `allowedChannels` de `invoke`, tras la línea de canales `admin:*` (línea 67), agregar:

```js
      // Auto-update
      'updater:start', 'updater:restartNow',
```

- [ ] **Step 2: Añadir canal `on` en preload.js**

En `src/main/preload.js`, en los DOS arrays `allowedChannels` de `on` (línea 76) y `removeAllListeners` (línea 87), añadir `'updater:downloaded'`:

```js
    const allowedChannels = ['audio:chunk', 'audio:error', 'agendamiento:aviso', 'agendamiento:ejecutar', 'agendamiento:aviso_pmp', 'promesa:aviso_supervisor', 'ws:message', 'updater:downloaded'];
```

- [ ] **Step 3: Añadir handlers en ipcHandlers.js**

En `src/main/ipcHandlers.js`, cerca de los handlers `admin:*` (tras la línea ~869), añadir:

```js
  // ── Auto-update ────────────────────────────────────────────────
  const { startUpdater, restartNow } = require('./updater');
  ipcMain.handle('updater:start', (_, { apiBase } = {}) => {
    try { startUpdater(apiBase); return { ok: true }; }
    catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('updater:restartNow', () => {
    try { restartNow(); return { ok: true }; }
    catch (err) { return { error: err.message }; }
  });
```

- [ ] **Step 4: Detener el timer al cerrar en index.js**

En `src/main/index.js`, en el handler `app.on('will-quit', ...)` (línea ~135), añadir tras `stopScheduler();`:

```js
  try { require('./updater').stopUpdater(); } catch {}
```

- [ ] **Step 5: Verificar arranque**

Run: `npm run dev`
Expected: app arranca sin errores de "Canal IPC no permitido". Cerrar.

- [ ] **Step 6: Commit**

```bash
git add src/main/preload.js src/main/ipcHandlers.js src/main/index.js
git commit -m "feat(update): IPC channels + timer cleanup on quit"
```

---

### Task 7: Renderer — arrancar updater tras login

**Files:**
- Modify: `src/renderer/login/LoginPage.jsx:71`

- [ ] **Step 1: Llamar updater:start tras guardar credenciales**

En `src/renderer/login/LoginPage.jsx`, dentro del bloque `if (result?.usuario)` (tras la línea 71 `localStorage.setItem('uphone_ws_ip', serverIp);`), agregar:

```js
        // Arranca el auto-updater en el main con la URL del servidor central.
        const apiBase = (serverIp.startsWith('http') ? serverIp.replace(/\/$/, '') : `http://${serverIp}:3001`) + '/api';
        window.api.invoke('updater:start', { apiBase }).catch(() => {});
```

- [ ] **Step 2: Verificar en dev**

Run: `npm run dev` → login.
Expected: consola main muestra `[UPDATER] Dev mode → updater desactivado` (confirma que el IPC llegó). Cerrar.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/login/LoginPage.jsx
git commit -m "feat(update): start updater from renderer after login"
```

---

### Task 8: Toast de reinicio (UpdaterListener)

**Files:**
- Create: `src/renderer/shared/UpdaterListener.jsx`
- Modify: `src/renderer/asesor/AsesorPanel.jsx`
- Modify: `src/renderer/supervisor/SupervisorPanel.jsx`
- Modify: `src/renderer/admin/AdminPanel.jsx`

- [ ] **Step 1: Crear el componente**

Crear `src/renderer/shared/UpdaterListener.jsx`:

```jsx
import React, { useEffect, useState } from 'react';

/**
 * Escucha 'updater:downloaded' del main y muestra un aviso persistente
 * con botón "Reiniciar ahora" → updater:restartNow (quitAndInstall).
 */
export default function UpdaterListener() {
  const [version, setVersion] = useState(null);

  useEffect(() => {
    const off = window.api.on('updater:downloaded', ({ version }) => setVersion(version));
    return off;
  }, []);

  if (!version) return null;

  const restart = () => window.api.invoke('updater:restartNow').catch(() => {});

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      background: '#1e1e1e', color: '#fff', padding: '14px 18px',
      borderRadius: 10, boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', gap: 14, maxWidth: 360,
    }}>
      <span>Actualización {version} lista.</span>
      <button
        onClick={restart}
        style={{
          background: '#00e676', color: '#000', border: 'none',
          borderRadius: 6, padding: '8px 12px', fontWeight: 700, cursor: 'pointer',
        }}
      >
        Reiniciar ahora
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Montar en AsesorPanel**

En `src/renderer/asesor/AsesorPanel.jsx`, añadir el import arriba:
```jsx
import UpdaterListener from '../shared/UpdaterListener';
```
Y renderizar `<UpdaterListener />` como primer hijo del JSX raíz del componente (dentro del contenedor top-level que retorna).

- [ ] **Step 3: Montar en SupervisorPanel**

En `src/renderer/supervisor/SupervisorPanel.jsx`: mismo import y montar `<UpdaterListener />` como primer hijo del JSX raíz.

- [ ] **Step 4: Montar en AdminPanel**

En `src/renderer/admin/AdminPanel.jsx`: mismo import y montar `<UpdaterListener />` como primer hijo del JSX raíz.

- [ ] **Step 5: Verificar que compila**

Run: `npm run build:app`
Expected: build OK, sin errores de import.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/shared/UpdaterListener.jsx src/renderer/asesor/AsesorPanel.jsx src/renderer/supervisor/SupervisorPanel.jsx src/renderer/admin/AdminPanel.jsx
git commit -m "feat(update): restart toast listener in all panels"
```

---

### Task 9: Admin UI — sección "Actualizaciones"

**Files:**
- Modify: `src/renderer/admin/AdminPanel.jsx`

- [ ] **Step 1: Añadir helper de fetch al backend (reusa patrón local)**

En `src/renderer/admin/AdminPanel.jsx`, cerca de `vmApiFetch` (línea ~25), añadir:

```js
function crmApiBase() {
  const wsIp = localStorage.getItem('uphone_ws_ip') || '127.0.0.1';
  return (wsIp.startsWith('http') ? wsIp.replace(/\/$/, '') : `http://${wsIp}:3001`) + '/api';
}
async function crmFetch(path, options = {}) {
  const token = localStorage.getItem('auth_token') || '';
  const res = await fetch(`${crmApiBase()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Añadir el componente de la sección**

En `src/renderer/admin/AdminPanel.jsx`, antes del `export default`, añadir:

```jsx
const DIAS = [['Dom', 0], ['Lun', 1], ['Mar', 2], ['Mié', 3], ['Jue', 4], ['Vie', 5], ['Sáb', 6]];

function UpdatePolicySection() {
  const [p, setP] = React.useState(null);
  const [msg, setMsg] = React.useState('');

  React.useEffect(() => {
    crmFetch('/admin/update-policy').then(setP).catch((e) => setMsg('Error: ' + e.message));
  }, []);

  if (!p) return <div className="admin-card"><h3>Actualizaciones</h3><p>{msg || 'Cargando…'}</p></div>;

  const toggleDay = (d) =>
    setP({ ...p, days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d].sort() });

  const save = async () => {
    setMsg('Guardando…');
    try {
      const body = {
        enabled: p.enabled,
        startTime: p.startTime,
        endTime: p.endTime,
        days: p.days,
        checkIntervalMin: Number(p.checkIntervalMin),
      };
      const saved = await crmFetch('/admin/update-policy', { method: 'PUT', body: JSON.stringify(body) });
      setP(saved);
      setMsg('Guardado ✓');
    } catch (e) {
      setMsg('Error: ' + e.message);
    }
  };

  return (
    <div className="admin-card">
      <h3>Actualizaciones — ventana horaria</h3>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} />
        Habilitar auto-update
      </label>
      <div style={{ display: 'flex', gap: 12, margin: '10px 0' }}>
        <label>Desde <input type="time" value={p.startTime} onChange={(e) => setP({ ...p, startTime: e.target.value })} /></label>
        <label>Hasta <input type="time" value={p.endTime} onChange={(e) => setP({ ...p, endTime: e.target.value })} /></label>
        <label>Chequear cada (min) <input type="number" min="1" value={p.checkIntervalMin} onChange={(e) => setP({ ...p, checkIntervalMin: e.target.value })} style={{ width: 70 }} /></label>
      </div>
      <div style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
        {DIAS.map(([label, d]) => (
          <button key={d} type="button" onClick={() => toggleDay(d)}
            style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                     background: p.days.includes(d) ? '#00e676' : '#333',
                     color: p.days.includes(d) ? '#000' : '#ccc', border: 'none' }}>
            {label}
          </button>
        ))}
      </div>
      <button onClick={save} style={{ padding: '8px 16px', fontWeight: 700, cursor: 'pointer' }}>Guardar</button>
      {msg && <span style={{ marginLeft: 12 }}>{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Renderizar la sección en el panel**

En el JSX del `AdminPanel` (junto a las otras `admin-card` de configuración), añadir `<UpdatePolicySection />`.

- [ ] **Step 4: Verificar compila**

Run: `npm run build:app`
Expected: build OK.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/admin/AdminPanel.jsx
git commit -m "feat(update): admin UI to edit update window policy"
```

---

### Task 10: Verificación E2E manual

**Files:** ninguno (verificación).

- [ ] **Step 1: Correr toda la suite unit**

Run: `npm test`
Expected: PASS, incluye `tests/unit/updater-window.test.js`.

- [ ] **Step 2: Build v3.0.1 y publicar**

Subir `version` a `3.0.1` en `package.json`, luego:
Run: `npm run build`
Expected: `dist/latest.yml` + `dist/CRM Marketing Uphone Setup 3.0.1.exe` generados y publicados (o copiados) a la carpeta del túnel `/updates/`.

- [ ] **Step 3: Instalar v3.0.0 en una PC de prueba**

Instalar el `.exe` de v3.0.0 (versión previa). Login. En Admin, poner la ventana para incluir la hora actual (Guayaquil) y `enabled=true`, día de hoy marcado, intervalo 1 min (para probar rápido).

- [ ] **Step 4: Verificar detección DENTRO de ventana**

Expected: en ~1 min el cliente descarga v3.0.1 y aparece el toast "Actualización 3.0.1 lista". Clic "Reiniciar ahora" → la app se reinicia en v3.0.1.

- [ ] **Step 5: Verificar NO detección FUERA de ventana**

Reinstalar v3.0.0, poner la ventana en un horario que NO incluya el momento actual. Esperar > intervalo.
Expected: consola main muestra `[UPDATER] Fuera de ventana → skip`; NO aparece toast.

- [ ] **Step 6: Commit del bump de versión**

```bash
git add package.json
git commit -m "chore(update): bump version to 3.0.1 for update test"
```

---

## Notas de riesgo

- El reloj que manda es el del cliente (Guayaquil). PCs con hora mal → ventana corrida. Aceptable (dominio/NTP).
- `autoInstallOnAppQuit=false`: un usuario que nunca reinicia queda desactualizado hasta cerrar la app. Aceptable (decisión de UX).
- Múltiples ventanas Electron: `startUpdater` puede llamarse por cada login/ventana; `reschedule()` limpia el timer previo, así que no se acumulan timers.
- Firma de código deshabilitada → updates sin firma; aceptable solo en red privada + VPN.
