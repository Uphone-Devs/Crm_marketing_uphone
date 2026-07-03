# Estado del Proyecto — CRM Marketing Uphone
**Fecha:** 2026-07-03  
**Rama:** main  
**Responsable técnico:** jhonguamansanmartin-max

---

## Resumen ejecutivo

Sistema CRM de cobranza multi-canal (llamadas, WhatsApp, RCS, Email) con arquitectura dual-mode:
- **Modo local**: Electron + SQLite (better-sqlite3), sin red, un solo PC.
- **Modo VM**: Electron conectado a servidor PostgreSQL remoto vía REST API + Socket.io.

Todo el backend PostgreSQL está **operativo y sin errores conocidos** al 2026-07-03.  
El AdminPanel compila correctamente (bug de curly quotes resuelto).

---

## Arquitectura del sistema

```
┌────────────────────────────────────────────────────────────┐
│                    ELECTRON APP                             │
│  ┌───────────┐  ┌──────────┐  ┌────────┐  ┌───────────┐  │
│  │ LoginPage │  │AsesorPanel│  │JefePanel│  │AdminPanel │  │
│  └─────┬─────┘  └────┬─────┘  └───┬────┘  └─────┬─────┘  │
│        │             │             │              │         │
│        └─────────────┴─────────────┴──────────────┘        │
│                           │                                 │
│              buildApiBase() — lee localStorage.uphone_ws_ip │
│                  ┌────────┴─────────┐                       │
│            IP local/vacía        IP remota                  │
│                  │                   │                       │
│         IPC + apiServer.js      REST → backend/             │
│         (SQLite, puerto 3001)   (PostgreSQL, puerto 3001)   │
└────────────────────────────────────────────────────────────┘
```

**Regla crítica:** Ambos servidores usan puerto 3001. Nunca corren simultáneamente.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Desktop shell | Electron 35 + Vite |
| Frontend | React 19, Recharts, Material Design components |
| Backend VM | Node.js + Express 5, Prisma 7 + @prisma/adapter-pg |
| Base de datos VM | PostgreSQL (probado con PG 18.4) |
| Base de datos local | SQLite via better-sqlite3 |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Real-time | Socket.io (marcación softphone) + WebSocket nativo (monitor) |
| Almacenamiento media | AWS S3 compatible (grabaciones) |

---

## Credenciales de desarrollo

| Cuenta | Email | Password | Rol |
|---|---|---|---|
| Admin sistema (SQLite local) | admin@sistema.local | Admin2026! | admin |
| Admin app (PostgreSQL VM) | admin@uphone.local | Uphone@2026 | admin |
| Jefe área (PostgreSQL VM) | jefe1@uphone.local | uphone2026 | jefe_area |
| Asesores (PostgreSQL VM) | asesor1…asesor9@uphone.local | uphone2026 | asesor |

**Base de datos PostgreSQL local dev:**
```
postgresql://[user]:[password]@localhost:5432/crm_marketing?schema=public
```
Credenciales completas en `backend/.env` (no commitear).

---

## Comandos para arrancar

```bash
# Backend PostgreSQL (modo VM)
cd backend
npm run dev          # puerto 3001

# App Electron (modo local — también en 3001 internamente)
npm run dev          # desde raíz del proyecto

# Seed de base de datos PostgreSQL
cd backend
npm run seed

# Generar Prisma client tras cambios de schema
cd backend
npx prisma generate
npx prisma migrate dev --name nombre_migracion
```

---

## Estructura de archivos clave

```
Crm_marketing_uphone/
├── backend/                          ← Servidor VM PostgreSQL
│   ├── src/
│   │   ├── index.js                  ← Entry point, monta todas las rutas
│   │   ├── config/db.js              ← PrismaClient singleton (PostgreSQL)
│   │   ├── middleware/
│   │   │   └── auth.middleware.js    ← JWT verify + requireRole()
│   │   ├── routes/
│   │   │   ├── auth.routes.js        ← POST /api/auth/login
│   │   │   ├── admin.routes.js       ← CRUD usuarios + sysinfo + connected
│   │   │   ├── campanas.routes.js    ← Campañas + dashboard (orden crítico)
│   │   │   ├── contactos.routes.js   ← Cartera + asignación
│   │   │   ├── cdrs.routes.js        ← Call Detail Records
│   │   │   └── supervisor.routes.js  ← 17+ endpoints JefePanel VM mode
│   │   ├── services/
│   │   │   └── auth.service.js       ← generateToken + verificarToken
│   │   ├── sockets/
│   │   │   └── call.socket.js        ← Socket.io eventos de llamada
│   │   └── wsServer.js               ← WebSocket monitor nativo
│   └── prisma/
│       ├── schema.prisma             ← Modelos Prisma (source of truth)
│       ├── seed.js                   ← Datos iniciales
│       └── migrations/               ← Historial de migraciones SQL
│
├── src/
│   ├── main/
│   │   ├── index.js                  ← Proceso principal Electron
│   │   ├── apiServer.js              ← Servidor Express SQLite (modo local)
│   │   ├── ipcHandlers.js            ← Todos los handlers IPC
│   │   ├── preload.js                ← Bridge renderer ↔ main
│   │   ├── scheduler.js              ← Jobs periódicos
│   │   └── database/
│   │       ├── db.js                 ← SQLite + migraciones M-001→M-041
│   │       ├── queries.js            ← Queries SQLite
│   │       └── schema.sql            ← Schema inicial SQLite
│   └── renderer/
│       ├── login/LoginPage.jsx       ← Login dual-mode
│       ├── asesor/AsesorPanel.jsx    ← Panel marcación asesor
│       ├── supervisor/
│       │   ├── main.jsx              ← Entry point supervisor → carga JefePanel
│       │   ├── JefePanel.jsx         ← Panel activo del jefe/supervisor
│       │   └── SupervisorPanel.jsx   ← DEAD CODE (no montado)
│       └── admin/AdminPanel.jsx      ← Panel administración sistema
│
└── docs/                             ← Documentación del proyecto
    └── ESTADO_PROYECTO_2026-07-03.md ← Este archivo
```

---

## Modelos de base de datos (PostgreSQL — Prisma)

| Modelo | Tabla | Descripción |
|---|---|---|
| Usuario | usuarios | Usuarios del sistema (admin/jefe_area/asesor/supervisor) |
| Campana | campanas | Campañas de cobranza |
| Contacto | contactos | Deudores con estado de marcación |
| Tipificacion | tipificaciones | Códigos de resultado de llamada |
| Cdr | cdrs | Call Detail Records (log de llamadas) |
| Sesion | sesiones | Sesiones de usuario |
| Evento | eventos | Eventos de sesión (conexión, estado, etc.) |
| Config | config | Configuración clave/valor del sistema |
| Agendamiento | agendamientos | Compromisos de pago (PMP/VOL_CALL) |
| MensajeBroadcast | mensajes_broadcast | Mensajes del supervisor a asesores |
| IndicadorDato | indicadores_datos | KPIs por asesor/fecha/segmento |

**Enums:**
- `Rol`: admin | jefe_area | supervisor | asesor
- `EstadoUsuario`: activo | inactivo
- `EstadoCampana`: activa | pausada | finalizada
- `EstadoMarcacion`: PENDIENTE | CONTACTADO | NO_CONTACTADO | ENVIADO | GESTIONADO | EN_INTENTOS | AGENDADO | YA_PAGO
- `Canal`: llamada | whatsapp | rcs | gmail
- `TipoAgendamiento`: PMP | VOL_CALL
- `EstadoAgendamiento`: pendiente | ejecutado | cancelado

---

## API REST Backend PostgreSQL — Rutas completas

### Autenticación
```
POST /api/auth/login          body: { email, password } → { token, user }
```

### Admin (requiere rol: admin)
```
GET  /api/admin/users                  Listar usuarios (incluye supervisor_id snake_case)
POST /api/admin/users                  Crear usuario (hash bcrypt automático)
PUT  /api/admin/users/:id              Editar (nombre/email/rol/estado/supervisor_id)
POST /api/admin/users/:id/toggle       Alternar estado activo/inactivo
POST /api/admin/users/:id/password     Reset contraseña (mínimo 6 chars)
GET  /api/admin/sysinfo                CPU/RAM/uptime (rol: admin|supervisor|jefe_area)
GET  /api/admin/connected              Clientes WS conectados (rol: admin|supervisor|jefe_area)
```

### Campañas (requiere auth)
```
GET  /api/campanas                     Listar todas
GET  /api/campanas/dashboard           Métricas por campaña activa ⚠️ ANTES de /:id
GET  /api/campanas/:id                 Detalle + contactos (100 primeros)
GET  /api/campanas/:id/siguiente       Siguiente contacto pendiente ?asesorId=
GET  /api/campanas/:id/progreso        Total vs gestionados
```

### Contactos (requiere auth)
```
GET  /api/contactos                    Listar con filtros (campana_id, asesor_id, estado, sin_asignar)
GET  /api/contactos/asesores/lista     Asesores activos (para selector asignación)
GET  /api/contactos/asesor/:id         Cartera de un asesor
POST /api/contactos/asignar            Asignar lote: { contacto_ids[], asesor_id }
POST /api/contactos/asignar/campana    Round-robin campaña: { campana_id, asesor_ids[] }
PUT  /api/contactos/:id/estado         Cambiar estado marcación
```

### CDRs (requiere auth)
```
GET  /api/cdrs                         Listar con filtros (usuarioId, contactoId, desde, hasta)
GET  /api/cdrs/metricas                Métricas equipo hoy (rol: supervisor|jefe_area|admin)
```

### Supervisor / JefePanel (requiere auth)
```
GET  /api/asesores                     Asesores activos (filtrado por equipo si no es admin)
GET  /api/metricas/:usuario_id         Métricas diarias asesor (marcaciones, agendados, gestionados)
GET  /api/metricas-equipo              Métricas agregadas del equipo
GET  /api/config                       Configuración sistema (tabla Config real)
POST /api/config                       Guardar configuración (upsert por clave)
GET  /api/cartera-equipo               Cartera completa del equipo (todos los asesores + contactos)
POST /api/cartera/reordenar            Drag&drop orden: { asesorId, contactoIdsEnOrden[] }
GET  /api/asesores/:id/progreso        Total vs gestionados de un asesor
GET  /api/cartera/analisis             Contadores globales de cartera
GET  /api/cartera/gestiones-asesores   Gestiones por asesor (real Prisma)
GET  /api/cartera/rotacion             Stub [] (sin histórico de asignaciones en DB)
GET  /api/cartera/refinanciada         Stub []
GET  /api/cartera/detalle-contactabilidad Stub []
POST /api/cartera/meta-asesor          Stub ok (sin tabla metas)
GET  /api/validacion/historial         Contactos con validadoPago=true
GET  /api/validacion/sesiones          Stub []
GET  /api/validacion/metricas          Contadores: total/validados/pagados
POST /api/validacion/correlacionar     Cruzar pagos por cédula → matches/no_encontrados
POST /api/validacion/confirmar         Marcar validadoPago=true yaPago=true en lote
GET  /api/pagos-verificados            Contactos validados del equipo
GET  /api/compromisos-equipo           Agendamientos pendientes del equipo (Prisma real)
GET  /api/indicadores/config           Stub []
POST /api/indicadores/config           Stub ok
```

---

## Bugs resueltos en esta sesión

### Bug #1 — 500 en GET /api/campanas/dashboard
**Causa:** Express registraba `/:id` antes de `/dashboard`. `req.params.id = 'dashboard'` → `parseInt('dashboard') = NaN` → Prisma `findUnique({ where: { id: NaN } })` lanzaba `Invalid invocation`.  
**Fix:** Mover ruta `/dashboard` ANTES de `/:id` en `campanas.routes.js`.  
**Regla:** En Express, rutas con segmento literal SIEMPRE antes que rutas con parámetro dinámico (`:id`) en el mismo prefijo.

### Bug #2 — AdminPanel.jsx falla compilación Babel (curly quotes)
**Causa:** 525 curly quotes Unicode (U+201C `"` y U+201D `"`) en atributos JSX. Babel no acepta comillas tipográficas en atributos JSX — solo ASCII `"`.  
**Fix:** PowerShell `[System.IO.File]::ReadAllText` + `.Replace('"', '"')` para ambos tipos.  
**Efecto secundario:** Doble-encoding de caracteres `ñ`, `é`, `á`, `—`, `•` también corregido.

### Bug #3 — jefe_area sin acceso a sysinfo/connected/metricas
**Causa:** `requireRole('admin', 'supervisor')` excluía `jefe_area`.  
**Fix:** Agregado `'jefe_area'` en los 3 endpoints afectados.

---

## Cambios al AdminPanel (src/renderer/admin/AdminPanel.jsx)

| Cambio | Detalle |
|---|---|
| Rol `jefe_area` | Color `#ffab40`, opción en select de rol, aparece en filtros de supervisor |
| Tarjeta PostgreSQL | Título: "PostgreSQL + Prisma — Activo" (antes: "Fase 2 futura") |
| Topbar | "VM SQLite:" → "VM PostgreSQL:" |
| Texto migraciones | M-001 → M-041 |
| Chips estado | "Estado: Operativo", "ORM: Prisma Client v7", "Motor: PostgreSQL 18.4" |
| Curly quotes | 525 reemplazadas por ASCII `"` (bug de compilación resuelto) |
| Mojibake | `ñ`, `é`, `á`, `—`, `•` corregidos (doble-encoding) |

---

## Migraciones SQLite (modo local)

Archivo: `src/main/database/db.js` — Migraciones M-001 a M-041.  
Son idempotentes (`ALTER TABLE IF NOT EXISTS`), ejecutan al iniciar la app Electron.

## Migraciones PostgreSQL

| Migración Prisma | Contenido |
|---|---|
| (inicial, M-001 conceptual) | Schema base: usuarios, campanas, contactos, tipificaciones, cdrs, sesiones, eventos |
| `20260703000001_add_missing_columns` | Enums `EN_INTENTOS`, `AGENDADO`, `YA_PAGO`; columna `supervisor_id` en usuarios; 8 cols en contactos; 5 cols en cdrs; `activo` en mensajes_broadcast |

---

## Pendientes conocidos

| Prioridad | Tarea | Archivo |
|---|---|---|
| Alta | Verificar asignación de cartera end-to-end desde UI supervisor en VM | JefePanel.jsx → POST /api/contactos/asignar |
| Media | Implementar metas por asesor (tabla no existe aún) | supervisor.routes.js → POST /cartera/meta-asesor |
| Media | Implementar rotación de cartera real (requiere histórico de asignaciones) | supervisor.routes.js → GET /cartera/rotacion |
| Baja | IndicadorDato: implementar GET/POST /indicadores/config con queries reales | supervisor.routes.js |
| Baja | ValidacionPagos — correlación por monto además de cédula | supervisor.routes.js → POST /validacion/correlacionar |
| Info | SupervisorPanel.jsx es DEAD CODE — no se monta | src/renderer/supervisor/SupervisorPanel.jsx:1 |

---

## Roles y permisos

| Endpoint | admin | jefe_area | supervisor | asesor |
|---|:---:|:---:|:---:|:---:|
| /api/admin/users (CRUD) | ✅ | ❌ | ❌ | ❌ |
| /api/admin/sysinfo | ✅ | ✅ | ✅ | ❌ |
| /api/admin/connected | ✅ | ✅ | ✅ | ❌ |
| /api/cdrs/metricas | ✅ | ✅ | ✅ | ❌ |
| /api/campanas | ✅ | ✅ | ✅ | ✅ |
| /api/contactos/asignar | ✅ | ✅ | ✅ | ❌ |
| /api/cartera-equipo | ✅ | ✅ | ✅ | ❌ |
| /api/compromisos-equipo | ✅ | ✅ | ✅ | ❌ |
| /api/validacion/* | ✅ | ✅ | ✅ | ❌ |
| /api/metricas/:id | ✅ | ✅ | ✅ | propio |

---

## Lecciones aprendidas / Reglas críticas

1. **Express route ordering**: rutas literales (`/dashboard`) ANTES de rutas dinámicas (`/:id`) en el mismo router.
2. **EstadoUsuario es enum string**: `'activo'|'inactivo'`, NO booleano. Toggle: `current.estado === 'activo' ? 'inactivo' : 'activo'`.
3. **Prisma camelCase vs snake_case**: Prisma retorna `supervisorId` (camelCase). UI espera `supervisor_id`. Mapear en la respuesta: `.map(u => ({ ...u, supervisor_id: u.supervisorId }))`.
4. **JefePanel es el panel activo**: `main.jsx` monta `JefePanel`, NO `SupervisorPanel`. No editar `SupervisorPanel.jsx`.
5. **buildApiBase()**: Lee `localStorage.uphone_ws_ip`. Si `127.0.0.1` o vacío → modo local (IPC). Si IP remota → modo VM (REST).
6. **vmFetch**: Llama a `${apiBase}${path}` donde `apiBase` ya termina en `/api`. No duplicar el prefijo.
7. **Curly quotes en JSX**: Babel falla silenciosamente con U+201C/U+201D en atributos. Reemplazar con ASCII `"`.
8. **Puerto 3001**: Ambos servidores (SQLite local y PostgreSQL VM) usan 3001. Nunca correr simultáneamente. Para reiniciar: `Stop-Process -Name node -Force`.

---

## Estado final al 2026-07-03

```
Backend PostgreSQL:     OPERATIVO  (npm run dev en backend/)
AdminPanel.jsx:         COMPILANDO (curly quotes + mojibake resueltos)
API completa VM mode:   OPERATIVO  (17+ endpoints supervisor + CRUD admin)
Permisos jefe_area:     CORREGIDOS (sysinfo, connected, cdrs/metricas)
Stubs críticos:         IMPLEMENTADOS (compromisos, pagos, validacion, config)
```
