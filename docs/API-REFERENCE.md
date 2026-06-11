# API Reference — CRM Marketing Uphone

> Backend Express + WebSocket en el puerto **3001** (modo remoto/VM). Todas las rutas REST
> (excepto `/api/health` y `/api/auth/login`) requieren header `Authorization: Bearer <JWT>`.
> Roles: `admin`, `supervisor`, `asesor`. Versión 3.0.

---

## Autenticación

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/api/health` | — | Estado del servidor (`{ ok, timestamp, engine }`) |
| POST | `/api/auth/login` | — | Login `{ email, password }` → `{ token, usuario }`. Rate-limit por cuenta. |

## Asesores / Equipo

| Método | Ruta | Rol | Notas |
|--------|------|-----|-------|
| GET | `/api/asesores` | auth | Supervisor → solo su equipo; admin → todos (**Bug 4**) |
| GET | `/api/asesores/:asesorId/progreso` | auth | Progreso filtrado (fecha/campaña) |

## Campañas y contactos

| Método | Ruta | Rol |
|--------|------|-----|
| GET/POST | `/api/campanas` | auth / supervisor+admin |
| GET | `/api/campanas/dashboard` | supervisor+admin |
| GET | `/api/campanas/:id` · `/:id/summary` · `/:id/progreso` · `/:id/siguiente` | auth |
| GET | `/api/campanas/asesor/:id` | auth |
| POST | `/api/campanas/:id/contactos` | supervisor+admin |
| DELETE | `/api/campanas/:campanaId/asesores/:asesorId` | supervisor+admin |
| GET | `/api/contactos/:id` · `/:id/cdrs` · `/:id/referencias` | auth |
| GET | `/api/contactos/search?cedula=` | auth |
| PATCH | `/api/contactos/:id/gestionar` · `/:id/intentar` · `/:id/resetear-intentos` | auth |

## CDRs y gestiones

| Método | Ruta | Rol |
|--------|------|-----|
| GET/POST | `/api/cdrs` | auth |
| GET | `/api/cdrs/all` | supervisor+admin |
| PATCH | `/api/cdrs/:id` | auth |
| GET/POST | `/api/sub-gestiones` | auth |
| GET | `/api/bitacora` · `/api/bitacora/refs` | auth |
| GET | `/api/referencias` | auth |
| POST | `/api/eventos` | auth (comunicación omnicanal: WSP/SMS/correo) |
| GET | `/api/tipificaciones` | auth |
| POST | `/api/agendamientos` | auth |

## Compromisos

| Método | Ruta | Rol | Notas |
|--------|------|-----|-------|
| GET | `/api/mis-compromisos` | auth | Solo del asesor del token |
| GET | `/api/compromisos-equipo` | supervisor | Solo su equipo (**Bug 4**) |
| DELETE | `/api/compromisos/:id` | supervisor |
| POST | `/api/confirmar-pago-compromiso` | auth | Actualiza CDR a PAGO_REAL (evita doble conteo) |
| POST | `/api/reagendar-compromiso` · `/api/marcar-compromiso-incumplido` | auth |
| GET | `/api/pagos-verificados` | supervisor | Recaudación sin doble conteo |

## Cartera y métricas

| Método | Ruta | Rol |
|--------|------|-----|
| GET | `/api/cartera` | auth (asesor) |
| GET | `/api/cartera-equipo` | supervisor |
| POST | `/api/cartera/reordenar` · `/api/cartera/meta-asesor` | supervisor / auth |
| GET | `/api/cartera/analisis` · `/rotacion` · `/refinanciada` · `/gestiones-asesores` · `/detalle-contactabilidad` | auth |
| GET | `/api/metricas/:usuario_id` | auth |
| GET | `/api/metricas-equipo` | supervisor+admin | Supervisor → solo su equipo (**Bug 4**) |

## Validación de pagos (supervisor+admin)

| Método | Ruta |
|--------|------|
| POST | `/api/validacion/correlacionar` · `/api/validacion/confirmar` |
| GET | `/api/validacion/metricas` · `/historial` · `/sesiones` |
| POST | `/api/validacion/revertir/:contactoId` |
| DELETE | `/api/validacion/sesiones/:id` |

## Configuración y reportes

| Método | Ruta | Rol |
|--------|------|-----|
| GET/POST | `/api/config` | auth / supervisor |
| GET | `/api/reports/:tipo` | auth (descarga xlsx) |

## Admin (gestión de usuarios)

| Método | Ruta | Rol | Notas |
|--------|------|-----|-------|
| GET | `/api/admin/users` | supervisor+admin | Admin ve cuenta admin; supervisor NO (**Bug 3**) |
| POST | `/api/admin/users` | supervisor+admin | Asigna `supervisor_id` (supervisor→sí mismo; admin→body) |
| PUT | `/api/admin/users/:id` | supervisor+admin | Solo admin reasigna `supervisor_id` |
| POST | `/api/admin/users/:id/toggle` | supervisor+admin |
| POST | `/api/admin/users/:id/password` | admin |
| GET | `/api/admin/sysinfo` · `/api/admin/connected` | supervisor+admin |

---

## WebSocket (`ws://host:3001?token=<JWT>`)

Mensajes cliente→servidor: `IDENTIFICAR` (rol ASESOR/SUPERVISOR; el supervisor envía `supervisor_id`/`es_admin`), `CAMBIO_ESTADO`, `METRICAS_ASESOR`, `SET_DIALING_MODE` (supervisor), `FORCE_OFFLINE` (supervisor), `ping`.

Servidor→cliente: `SNAPSHOT_ESTADOS`, `ESTADO_ASESOR`, `METRICAS_ASESOR`, `ASESOR_DESCONECTADO`, `SET_DIALING_MODE`, `TIPIFICACION_REALIZADA`, `pong`.

**Aislamiento (Bug 4):** los eventos de un asesor solo llegan al supervisor de su grupo (`supervisor_id`); el admin recibe todos.

---

> Nota de mantenimiento: la fuente de verdad es `src/main/apiServer.js`. Regenerar esta tabla si cambian rutas.
