# CRM Marketing Uphone

> Plataforma de cobranza telefónica con monitoreo en tiempo real (Asesor / Supervisor / Admin).
> Aplicación de escritorio (Electron) conectada a un backend central PostgreSQL vía HTTP/WebSocket.

**Versión:** 4.0 · **Plataforma:** Windows 10/11 64-bit · **Estado:** Producción

---

## 1. Descripción

Reemplaza funciones de ISSABEL para la gestión de cobranza: marcación asistida vía Android (ADB/scrcpy), tipificación de gestiones, compromisos de pago, validación de pagos, métricas en tiempo real y reportería.

Todas las PCs (Electron) se conectan por HTTP/WebSocket a un **backend central Express + PostgreSQL** en el servidor LAN. No hay modo SQLite local en producción.

Detalle completo en **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**.

## 2. Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Electron 29 + Node.js |
| Frontend | React 18 + Vite 5 |
| Backend | Express 4 + WebSocket (`ws`) — puerto 3001 |
| ORM | Prisma 5 + `@prisma/adapter-pg` |
| DB | PostgreSQL 15 (`crm_marketing`) |
| Auth | bcryptjs + JSON Web Tokens (HS256) |
| Mobile | ADB + scrcpy v3.1 (control Android) |
| Audio | FFmpeg (captura opcional) |
| Build | electron-vite + electron-builder (NSIS) |
| Tests | Vitest |

## 3. Estructura

```
crm-marketing-uphone/
├── backend/                       ← Servidor de producción (Express + Prisma + PostgreSQL)
│   ├── src/
│   │   ├── index.js               ← Entry point (puerto 3001)
│   │   ├── config/db.js           ← PrismaClient singleton (@prisma/adapter-pg)
│   │   ├── middleware/auth.middleware.js
│   │   ├── wsServer.js            ← WebSocket (broadcastToAll / broadcastToSupervisors)
│   │   └── routes/
│   │       ├── auth.routes.js
│   │       ├── admin.routes.js
│   │       ├── campanas.routes.js
│   │       ├── contactos.routes.js
│   │       ├── cdrs.routes.js
│   │       └── supervisor.routes.js
│   └── prisma/
│       ├── schema.prisma
│       └── migrations/
├── src/
│   ├── main/                      ← Proceso principal Electron
│   │   ├── index.js               ← Entry point
│   │   ├── ipcHandlers.js         ← Puente IPC → backend HTTP
│   │   ├── adbManager.js          ← Control ADB + scrcpy
│   │   ├── audioManager.js        ← Captura FFmpeg
│   │   └── security/
│   └── renderer/
│       ├── asesor/                ← Panel del Asesor (React)
│       ├── supervisor/            ← Panel del Supervisor (React)
│       ├── admin/                 ← Panel del Admin (React)
│       └── shared/                ← Design system + apiClient + componentes
├── tests/                         ← Vitest (unit + helpers)
├── docs/                          ← Documentación técnica (ver §9)
├── scripts/                       ← Utilidades y pruebas de carga (k6)
└── resources/                     ← ADB / scrcpy / FFmpeg bundleados
```

## 4. Prerrequisitos

- Node.js 18+ (probado en 22)
- Windows 10/11 64-bit
- PostgreSQL 15 corriendo en el servidor LAN
- Binarios en `resources/` (ver §8)

## 5. Instalación y desarrollo

```bash
# Dependencias frontend / Electron
npm install

# Dependencias backend
cd backend && npm install && cd ..

# Variables de entorno
cp backend/.env.example backend/.env   # completar DATABASE_URL y JWT_SECRET

# Aplicar migraciones Prisma
cd backend && npx prisma migrate deploy && cd ..

# Desarrollo (backend + Electron en paralelo)
cd backend && node src/index.js        # terminal 1 — backend en :3001
npm run dev                            # terminal 2 — Electron
```

## 6. Configuración (`backend/.env`)

```env
DATABASE_URL="postgresql://usuario:password@localhost:5432/crm_marketing"
JWT_SECRET="cadena-secreta-larga"
PORT=3001
```

El `.env` está en `.gitignore` y **nunca** debe commitearse.

## 7. Build / Deploy

```bash
# Build Electron (instalador NSIS para PCs cliente)
npm run build

# Reconstruir módulos nativos si cambia el ABI de Node/Electron
npm rebuild better-sqlite3
```

**Servidor (backend):**
```bash
cd backend
node src/index.js          # o PM2: pm2 start src/index.js --name crm-backend
```

**PCs cliente:** distribuir el instalador NSIS de `dist/`. Configurar la IP del servidor en el login.

### Binarios requeridos en `resources/`

| Carpeta | Contenido |
|---------|-----------|
| `resources/adb/` | `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` |
| `resources/scrcpy/` | `scrcpy.exe`, `scrcpy-server`, `SDL2.dll` |
| `resources/ffmpeg/` | `ffmpeg.exe` (opcional, audio) |

## 8. Testing

```bash
npm test                    # suite Vitest
```

Las pruebas de queries corren contra una BD real. Pruebas de carga: `scripts/load/` (k6).

## 9. Documentación

| Documento | Contenido |
|-----------|-----------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitectura, flujo de datos, WS, topología |
| [`docs/DOMAIN-RULES.md`](docs/DOMAIN-RULES.md) | Reglas de negocio (tipificaciones, métricas, compromisos) |
| [`docs/API-REFERENCE.md`](docs/API-REFERENCE.md) | Endpoints REST + WebSocket |
| [`docs/DATA-MODEL.md`](docs/DATA-MODEL.md) | Esquema Prisma y migraciones |
| [`SECURITY.md`](SECURITY.md) | Política de seguridad |

## 10. Compatibilidad INFINIX/MediaTek

Detección automática: aplica flags ADB específicos (`--no-audio`, `--window-borderless`, `--stay-awake`), guía de Modo Desarrollador y fallback sin audio.

## 11. Seguridad

- `contextIsolation: true`, `nodeIntegration: false`
- JWT con expiración · rate-limit de login por cuenta
- Dependabot + CI de seguridad (`.github/`)
- Pendientes documentados en [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md)

---

© 2026 — Uso interno del holding. Ver nota de propiedad/licencia en el repositorio.
