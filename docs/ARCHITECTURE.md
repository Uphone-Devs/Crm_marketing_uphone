# Arquitectura — CRM Marketing Uphone

> Documento de referencia para mantenimiento del desarrollo original y para el equipo que migrará a webapp.
> Versión 3.0.

---

## 1. Visión general

Aplicación **Electron** (escritorio Windows) con un backend embebido (Express + WebSocket) que opera en **dos modos** sin recompilar:

```
┌─────────────────────────── MODO LOCAL (LAN) ───────────────────────────┐
│  PC Asesor/Supervisor                                                   │
│  React (renderer) ──IPC──> main process ──> SQLite local (better-sqlite3)│
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────── MODO REMOTO (VM) ──────────────────────────┐
│  PCs cliente (Electron)                 VM Azure (Windows + PM2)        │
│  React ──fetch/WS──────────────────────> apiServer (Express+WS :3001)   │
│      (HTTP REST + ws://…?token=JWT)               │                     │
│                                                   └──> SQLite (terminal.db)│
└─────────────────────────────────────────────────────────────────────────┘
```

La decisión local/remoto se basa en `localStorage.uphone_ws_ip`: si apunta a `localhost` → IPC local; si apunta a una IP/URL → REST/WS contra la VM.

## 2. Componentes

| Componente | Archivo | Rol |
|-----------|---------|-----|
| API REST + WS | `src/main/apiServer.js` | ~40 endpoints REST + servidor WebSocket en el puerto 3001 |
| WebSocket | `src/main/wsServer.js` | Estados de asesores, métricas en vivo, modo de marcación, audio |
| Filtro de grupo WS | `src/main/wsGroupFilter.js` | Aísla broadcasts por equipo (supervisor solo ve su grupo) |
| IPC | `src/main/ipcHandlers.js` | Puente renderer↔main en modo local (canales `db:*`, `adb:*`, etc.) |
| Acceso a datos | `src/main/database/queries.js` | Una función por query (better-sqlite3, síncrono) |
| Esquema + migraciones | `src/main/database/db.js`, `schema.sql` | DDL idempotente + migraciones M-001…M-038 al arrancar |
| Dispositivo | `src/main/adbManager.js` | ADB/scrcpy, marcación, control de llamada |
| Renderer | `src/renderer/{asesor,supervisor,admin}` | Paneles React por rol |
| Cliente API | `src/renderer/shared/apiClient.js` | Traducción canal→REST y manejo de sesión (401) en modo remoto |

## 3. Flujo de datos (modo remoto)

1. **Login:** `POST /api/auth/login` → `{ token, usuario }`. El token (JWT HS256) se guarda en `localStorage`.
2. **Operación:** el renderer llama `callApi(canal)` / `vmFetch(...)`:
   - Canales de **datos** (`db:*`, `validacion:*`, …) → endpoint REST en la VM.
   - Canales de **dispositivo/SO** (`adb:*`, `audio:*`, `recorder:*`, `shell:*`, `app:*`) → IPC local (controlan hardware de la PC del asesor, no van a la VM).
3. **Tiempo real:** WebSocket `ws://host:3001?token=JWT`. El asesor envía `IDENTIFICAR`, `CAMBIO_ESTADO`, `METRICAS_ASESOR`; el servidor retransmite a los supervisores **de su grupo**.

## 4. Autenticación y autorización

- JWT HS256 firmado con `JWT_SECRET` (env). Expiración configurable (default 12h). Sin refresh token (re-login al expirar).
- Roles: `admin`, `supervisor`, `asesor`. Middleware `requireAuth`, `requireSupervisor`, `requireAdmin`, `requireSupervisorOrAdmin`.
- Rate-limit de login **por cuenta (email)**, no por IP — evita bloquear a todo el equipo detrás de un mismo origen.

## 5. Modelo de datos (resumen)

SQLite. Tablas núcleo: `usuarios`, `campanas`, `contactos`, `cdrs`, `tipificaciones`, `sub_gestiones`, `agendamientos`, `validaciones_pago`, `sesiones_validacion`, `metas_asesores`, `eventos`, `config`. Detalle e invariantes en [`DATA-MODEL.md`](DATA-MODEL.md) y [`DOMAIN-RULES.md`](DOMAIN-RULES.md).

- Metadatos del deudor (días en mora, valor en mora, contrato, empresa) se guardan como JSON en `contactos.metadata` y se consultan con `json_extract`.
- Migraciones versionadas (M-NNN) corren al iniciar; idempotentes (verifican columna/tabla antes de alterar).

## 6. Aislamiento multi-equipo (v3.0)

Cada asesor tiene `usuarios.supervisor_id`. El supervisor ve **solo** su equipo:
- REST: `getAsesores({supervisorId})`, `getMetricasEquipo`, `getCompromisosEquipo` filtran por el `supervisor_id` del token; el admin ve todo.
- WebSocket: `wsGroupFilter.shouldDeliverToSupervisor` entrega eventos solo al supervisor del grupo del asesor (admin recibe todo).
- Gestión de usuarios: exclusiva del panel Admin (el supervisor no administra usuarios).

## 7. Topología de despliegue

```
Sucursal/Equipo (×7)            Azure
┌────────────────┐   HTTPS/WS   ┌─────────────────────────────┐
│ Electron (thin)│ ───────────> │ VM Windows                  │
│ - UI React     │              │  PM2 → apiServer (:3001)    │
│ - ADB/scrcpy   │              │  cloudflared (túnel)        │
│ - .env BACKEND │              │  SQLite F:\cobranza\data    │
└────────────────┘              └─────────────────────────────┘
```

Topología **estrella**: los clientes solo hablan con el backend; la BD nunca se expone.

## 8. Decisiones y limitaciones conocidas

- **Proceso único + SQLite local** → escala **vertical** (más vCPU), no horizontal. El autoescalado horizontal requiere migrar a PostgreSQL + backend stateless + estado WS compartido.
- **Túnel quick de Cloudflare** rota la URL al reiniciar → se recomienda IP pública estática o named tunnel.
- **SQLite sin cifrado** en disco → ver decisión de cifrado en reposo.
- Pendientes y ADRs: [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md) y `Conocimiento/ADR/` (registro de decisiones).

## 9. Roadmap de migración (Fase 2 — webapp)

La reescritura a webapp **debe preservar las reglas de negocio** de [`DOMAIN-RULES.md`](DOMAIN-RULES.md) (el activo crítico). Prerrequisito técnico para elasticidad: **PostgreSQL** (referencia T-003). El contrato funcional entre ambos desarrollos es esta documentación, no el código.
