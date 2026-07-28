# Diseño: Auto-update con ventana horaria administrable

**Fecha:** 2026-07-28
**Estado:** Aprobado (pendiente de plan de implementación)
**App:** CRM Marketing Uphone (Electron + NSIS, v3.0.0)

## Objetivo

Dar a la app de escritorio Electron actualización automática que descarga en
segundo plano y avisa al usuario para reiniciar, restringida a una ventana
horaria definida por el administrador para no interrumpir el día laboral del
call center.

## Decisiones bloqueadas

| Tema | Decisión |
|------|----------|
| Hosting de artefactos | Provider `generic` (HTTP) detrás de cloudflare tunnel + VPN |
| UX de update | Auto-descarga en background + aviso "Reiniciar ahora"; el usuario elige el momento del reinicio |
| Configuración de ventana | Panel Admin en la app → guardada en Postgres central → leída por todos los clientes |
| Publicación | electron-builder auto-publish (`generic`) al hacer build |
| Gating | Opción A: solo se chequea/descarga/avisa **dentro** de la ventana |
| Zona horaria | Hora local del cliente, América/Guayaquil |
| Intervalo de chequeo | 30 min por defecto (configurable) |
| Días de la semana | Configurables (`days[]`, 0=domingo … 6=sábado) |

## Contexto de arquitectura existente

- App Electron. Cada instalación corre SQLite local + `apiServer` Express en
  puerto 3001 (REST + WS). Una PC "Supervisor" hace de servidor central; las PC
  Asesor se conectan por LAN.
- `index.js` (main) además arranca automáticamente el backend PostgreSQL
  (`backend/src/index.js`) como proceso hijo.
- Backend central: Express + Prisma. Auth vía `authMiddleware` + `requireRole`.
  Rutas admin en `backend/src/routes/admin.routes.js`.
- Renderer Admin: `src/renderer/admin/AdminPanel.jsx`. IPC vía
  `window.api.invoke` con lista blanca de canales en `src/main/preload.js`.
- `electron-builder.yml` tiene hoy `publish: null`. NSIS `oneClick: false`
  (instalador completo, compatible con electron-updater). Firma de código
  deshabilitada (`CSC_IDENTITY_AUTO_DISCOVERY=false`).

## Componentes

### 1. Dependencia
- Añadir `electron-updater` (dependencia de producción).

### 2. `electron-builder.yml`
Reemplazar `publish: null` por:
```yaml
publish:
  provider: generic
  url: https://<tunnel>/updates/
```
El build genera `latest.yml` + `CRM-Setup-x.y.z.exe` en `dist/` y publica
automáticamente al servidor detrás del túnel.

### 3. `src/main/updater.js` (nuevo módulo del main process)
- Usa `autoUpdater` de `electron-updater`.
- Config: `autoDownload = true`, `autoInstallOnAppQuit = false` (el usuario
  controla el reinicio).
- Timer `setInterval` (intervalo tomado de la política): pide la política al
  backend → si `enabled` y la hora/día local está dentro de la ventana →
  `autoUpdater.checkForUpdates()`.
- Eventos:
  - `update-downloaded` → IPC al renderer (`updater:downloaded`) para mostrar
    el toast.
  - `error` → log silencioso, reintenta en el próximo ciclo.
- Se inicializa desde `index.js` tras el arranque, solo si `app.isPackaged`
  (en dev el updater queda desactivado).
- Expone `restartNow()` → `autoUpdater.quitAndInstall()`.

### 4. Backend — política de ventana (Postgres)
- Nuevo modelo Prisma `UpdatePolicy` (fila singleton):
  - `id` (PK)
  - `enabled` bool
  - `startTime` string `"HH:MM"`
  - `endTime` string `"HH:MM"`
  - `days` int[] (0–6)
  - `checkIntervalMin` int (default 30)
  - `updatedAt` datetime
- Rutas en `admin.routes.js`:
  - `GET /api/admin/update-policy` — `authMiddleware` (cualquier usuario
    logueado; los clientes la leen para gate).
  - `PUT /api/admin/update-policy` — `authMiddleware` + `requireRole('admin')`.
    Valida formato `HH:MM`, rango de `days`, `checkIntervalMin > 0`.

### 5. IPC + preload
- Nuevos canales `invoke` en `preload.js`: `updater:getPolicy`,
  `updater:setPolicy`, `updater:restartNow`.
- Nuevo canal `on`: `updater:downloaded`.
- Handlers en `ipcHandlers.js` que proxean al backend REST (mismo patrón que
  los canales `admin:*` existentes).

### 6. Admin UI — `AdminPanel.jsx`
- Nueva sección "Actualizaciones":
  - Toggle habilitado.
  - Inputs hora inicio / hora fin.
  - Selector de días.
  - Input intervalo de chequeo (min).
  - Botón guardar → `updater:setPolicy`.

### 7. Aviso de reinicio (renderer)
- Listener `updater:downloaded` → toast persistente (usa `Toast.jsx` existente)
  con botón "Reiniciar ahora" → `updater:restartNow`.

## Flujo de datos de la ventana

1. Cliente arranca → inicia timer.
2. Cada intervalo: `GET /api/admin/update-policy` → `{enabled, startTime,
   endTime, days, checkIntervalMin}`.
3. Si `enabled` y `now` (hora local Guayaquil) ∈ ventana y día ∈ `days` →
   `autoUpdater.checkForUpdates()`.
4. Si hay versión nueva → descarga en background → `update-downloaded` → toast.
5. Usuario clic "Reiniciar ahora" → `quitAndInstall`. Si lo ignora, la
   instalación ocurre en el próximo cierre manual; la siguiente ventana vuelve
   a avisar.

## Lógica de ventana (`isDentroDeVentana`)

Función pura, testeable:
```
isDentroDeVentana(now, policy) -> bool
```
- Respeta `enabled=false` → siempre false.
- Compara hora local Guayaquil contra `startTime`/`endTime`.
- Soporta ventana que cruza medianoche (ej. 20:00–08:00).
- Verifica día de la semana contra `days[]`.

## Manejo de errores

- Backend inalcanzable al pedir política → se omite el chequeo ese ciclo (no
  rompe la app). Fallback conservador: tratar como `enabled=false`.
- `latest.yml` 404 / red caída → `autoUpdater` emite `error` → log, reintenta
  próximo ciclo.
- Dev mode (`!app.isPackaged`) → updater desactivado.

## Testing

- **Unit (Vitest):** `isDentroDeVentana(now, policy)` — casos borde: ventana
  cruza medianoche, filtro de días, `enabled=false`, límites exactos.
- **Unit (supertest):** rutas `GET`/`PUT /update-policy` — auth, rol, validación
  de `HH:MM` y `days`.
- **Manual:** build v3.0.1, publicar; verificar que cliente v3.0.0 detecta,
  descarga y avisa **dentro** de la ventana y **no** fuera de ella.

## Fuera de alcance (YAGNI)

- Rollback automático de versión.
- Updates diferenciales / delta.
- Multi-canal (beta/stable).
- Firma de código (ya deshabilitada; updates sin firma, aceptable en red
  privada + VPN).

## Riesgos / notas

- El reloj que manda es el del cliente. Si una PC tiene la hora mal, su ventana
  se corre. Aceptable; las PC del call center sincronizan por dominio/NTP.
- `autoInstallOnAppQuit = false` significa que un usuario que nunca reinicia se
  queda desactualizado hasta que cierre la app manualmente. Aceptable según la
  decisión de UX (opción 3).
