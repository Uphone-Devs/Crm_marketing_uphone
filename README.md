# CRM Marketing Uphone

> Plataforma de cobranza telefónica con monitoreo en tiempo real (Asesor / Supervisor / Admin).
> Aplicación de escritorio (Electron) con modo **local (LAN)** y modo **remoto (VM central)**.

**Versión:** 3.0 · **Plataforma:** Windows 10/11 64-bit · **Estado:** Producción

---

## 1. Descripción

Reemplaza funciones de ISSABEL para la gestión de cobranza: marcación asistida vía Android (ADB/scrcpy), tipificación de gestiones, compromisos de pago, validación de pagos, métricas en tiempo real y reportería. Opera en dos modos sin cambiar de binario:

- **Local (LAN):** cada PC con su SQLite; un supervisor actúa de servidor en la red local.
- **Remoto (VM):** todas las PCs (Electron) hablan por HTTP/WebSocket con un backend central en una VM de Azure.

Detalle completo en **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## 2. Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Electron 29 + Node.js |
| Frontend | React 18 + Vite 5 |
| Backend | Express 4 + WebSocket (`ws`) — **unificados en puerto 3001** |
| DB | better-sqlite3 (SQLite) — síncrono |
| Auth | bcryptjs + JSON Web Tokens (HS256) |
| Mobile | ADB + scrcpy v3.1 (control Android) |
| Audio | FFmpeg (captura opcional) |
| Build | electron-vite + electron-builder (NSIS) |
| Tests | Vitest |

## 3. Estructura

```
crm-marketing-uphone/
├── src/
│   ├── main/                  ← Proceso principal Electron / backend
│   │   ├── index.js           ← Entry point
│   │   ├── apiServer.js       ← API REST + WebSocket (puerto 3001)
│   │   ├── wsServer.js        ← Lógica WebSocket (estados, métricas)
│   │   ├── wsGroupFilter.js   ← Aislamiento de broadcasts por equipo
│   │   ├── ipcHandlers.js     ← Puente IPC (modo local)
│   │   ├── adbManager.js      ← Control ADB + scrcpy
│   │   ├── audioManager.js    ← Captura FFmpeg
│   │   ├── security/          ← Helpers de seguridad (rate-limit keys)
│   │   ├── database/          ← schema.sql + queries.js + migraciones (db.js)
│   │   └── reports/           ← Generador XLSX/PDF/CSV
│   └── renderer/
│       ├── asesor/            ← Panel del Asesor (React)
│       ├── supervisor/        ← Panel del Supervisor (React)
│       ├── admin/             ← Panel del Admin del sistema (React)
│       └── shared/            ← Design system + apiClient + componentes
├── tests/                     ← Vitest (unit + helpers de BD real)
├── docs/                      ← Documentación técnica (ver §8)
├── scripts/load/              ← Pruebas de carga (k6) + análisis de índices
└── resources/                 ← ADB / scrcpy / FFmpeg bundleados
```

## 4. Prerrequisitos

- Node.js 18+ (probado en 22)
- Windows 10/11 64-bit
- Binarios en `resources/` (ver §7)

## 5. Instalación y desarrollo

```bash
npm install
cp .env.example .env        # completar JWT_SECRET, etc. (ver §6)
npm run dev                 # modo desarrollo
```

## 6. Configuración (`.env`)

Copiar `.env.example` → `.env` y completar. Variable crítica: **`JWT_SECRET`** (obligatoria en producción; si falta, el servidor no arranca). El `.env` está en `.gitignore` y **nunca** debe commitearse.

## 7. Build / Deploy

```bash
npm run build:app           # build de la app (out/) — usado por la VM backend
npm run build               # build + instalador NSIS (dist/) — para PCs cliente
npm rebuild better-sqlite3  # si cambia el ABI de Node/Electron
```

- **VM (backend):** correr `apiServer` desde `out/` bajo PM2.**.
- **PCs cliente:** distribuir el instalador NSIS de `dist/`.
- Binarios requeridos en `resources/`:

| Carpeta | Contenido |
|---------|-----------|
| `resources/adb/` | `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` |
| `resources/scrcpy/` | `scrcpy.exe`, `scrcpy-server`, `SDL2.dll` |
| `resources/ffmpeg/` | `ffmpeg.exe` (opcional, audio) |

## 8. Testing

```bash
npm test                    # suite Vitest
```
Las pruebas de queries corren contra una BD SQLite real (ver `tests/helpers/realDb.js`), no copias inline. Pruebas de carga: `scripts/load/` (k6).

## 9. Documentación

| Documento | Contenido |
|-----------|-----------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitectura dual-mode, flujo de datos, WS, topología, roadmap de migración |
| [`docs/DOMAIN-RULES.md`](docs/DOMAIN-RULES.md) | Reglas de negocio (tipificaciones, métricas, compromisos, no-doble-conteo, aislamiento) |
| [`docs/API-REFERENCE.md`](docs/API-REFERENCE.md) | Endpoints REST + WebSocket |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Esquema y migraciones |
| [`docs/governance/CLAUSULA-IP-CONFIDENCIALIDAD.template.md`](docs/governance/CLAUSULA-IP-CONFIDENCIALIDAD.template.md) | Cláusula IP + confidencialidad de reglas de negocio (anexo SOW) |
| [`SECURITY.md`](SECURITY.md) | Política de seguridad |

## 10. Compatibilidad INFINIX/MediaTek

Detección automática: aplica flags ADB específicos (`--no-audio`, `--window-borderless`, `--stay-awake`), guía de Modo Desarrollador y fallback sin audio.

## 11. Seguridad

- `contextIsolation: true`, `nodeIntegration: false`
- JWT con expiración · rate-limit de login por cuenta
- Dependabot + CI de seguridad (`.github/`)
- Pendientes documentados en [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md) (cifrado en reposo, URL estable, autoescalado)

---

© 2026 — Uso interno del holding. Ver nota de propiedad/licencia en el repositorio.
