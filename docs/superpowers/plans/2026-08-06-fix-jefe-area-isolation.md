# Jefe de Área Isolation Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aislar completamente los mensajes broadcast y los estados de asesores en tiempo real por área, de modo que jefe-área-1 y jefe-área-2 no vean ni reciban datos del equipo del otro.

**Architecture:** Dos puntos de mezcla independientes: (A) la capa REST GET `/mensajes-broadcast` devuelve todos los mensajes sin filtrar por supervisor — se corrige con un WHERE condicional según el rol del token. (B) el WebSocket `broadcastToAll` / `broadcastToSupervisors` emite a todos los clientes conectados sin respetar la relación `usuarios.supervisor_id` — se corrige convirtiendo `supervisores` Map a `{ ws, rol }` y añadiendo funciones de broadcast acotado por área.

**Tech Stack:** Node.js + Express + Prisma (PostgreSQL) + ws (WebSocket nativo). Sin dependencias nuevas.

---

## Contexto de negocio

La tabla `usuarios` tiene columna `supervisor_id` (FK a sí misma): cada asesor apunta al `id` del jefe de área que lo supervisa. La tabla `mensajes_broadcast` tiene `supervisor_id` que identifica qué jefe creó el mensaje.

Relaciones clave:
- `asesor.supervisor_id → jefe.id` (un asesor pertenece a un jefe)
- `mensajes_broadcast.supervisor_id → jefe.id` (un mensaje pertenece a un jefe)

Invariante deseado: un asesor solo debe ver mensajes de SU jefe. Un jefe solo debe ver asesores de SU equipo en tiempo real.

---

## Diagnóstico — Puntos de mezcla encontrados

| # | Archivo | Línea | Problema |
|---|---------|-------|---------|
| 1 | `supervisor.routes.js` | 2402 | GET `/mensajes-broadcast` sin WHERE — retorna mensajes de todos los jefes |
| 2 | `supervisor.routes.js` | 2450 | `broadcastToAll(NUEVO_MENSAJE_BROADCAST)` — notifica a asesores de otras áreas |
| 3 | `supervisor.routes.js` | 2459 | `broadcastToAll(MENSAJE_BROADCAST_DESACTIVADO)` — ídem |
| 4 | `wsServer.js` | 95 | `supervisores.set(id, ws)` — no guarda el rol del jefe, imposibilita filtrar por admin vs jefe_area |
| 5 | `wsServer.js` | 89–92 | Notificación de asesor conectado → `broadcastToSupervisors` (todos los jefes) |
| 6 | `wsServer.js` | 99–107 | `SNAPSHOT_ESTADOS` incluye asesores de otras áreas |
| 7 | `wsServer.js` | 127/134/140/148 | ESTADO_ASESOR, METRICAS, TIPIFICACION, RITMO → todos los jefes |
| 8 | `wsServer.js` | 230–233 | `broadcastToSupervisors` itera el Map sin verificar área |
| 9 | `wsServer.js` | 193–210 | `close` handler: desconexión de asesor notifica a todos los jefes |

**Correctamente aislado ya (no tocar):**
- `cartera-equipo` REST (línea 1057): filtra por `supervisorId = req.user.id` ✓
- `AUDIO_CHUNK` WS (línea 158–163): enruta solo al supervisor asignado ✓
- `MARCAR_CLIENTE`/`REMOTE_DIAL` WS (línea 176–181): verifica `target.supervisorId === clientInfo.id` ✓

---

## Archivos a modificar

| Archivo | Tipo | Cambios |
|---------|------|---------|
| `backend/src/wsServer.js` | Modify | Cambiar `supervisores` Map a `{ ws, rol }`, añadir `broadcastToJefeOf()` y `broadcastToJefeTeam()`, filtrar SNAPSHOT, escopar eventos de asesor al jefe correcto |
| `backend/src/routes/supervisor.routes.js` | Modify | Añadir WHERE condicional en GET mensajes-broadcast, reemplazar `broadcastToAll` por `broadcastToJefeTeam` en POST/DELETE mensajes-broadcast |

No se crean archivos nuevos. No se modifica el schema de Prisma. No hay migraciones.

---

## Task 1: Refactorizar `supervisores` Map y funciones de broadcast en wsServer.js

**Files:**
- Modify: `backend/src/wsServer.js`

Este task convierte el Map de supervisores para almacenar `{ ws, rol }` en lugar de solo `ws`, y agrega las dos funciones de broadcast acotado. Todos los usos existentes del Map se actualizan en este mismo task para que el archivo quede consistente.

- [ ] **Step 1: Leer el archivo actual completo**

```bash
cat -n backend/src/wsServer.js
```

Verifica que las líneas coincidan con las descritas en el plan antes de editar.

- [ ] **Step 2: Cambiar la declaración del Map (línea 13)**

Ubicar:
```javascript
const supervisores = new Map(); // supervisorUserId -> ws
```

Reemplazar por:
```javascript
const supervisores = new Map(); // supervisorUserId -> { ws, rol }
```

- [ ] **Step 3: Añadir `rolJwt` al objeto `clientInfo` inicial (línea 31)**

Ubicar:
```javascript
let clientInfo = { rol: null, id: null, nombre: null, autenticado: false };
```

Reemplazar por:
```javascript
let clientInfo = { rol: null, rolJwt: null, id: null, nombre: null, autenticado: false };
```

- [ ] **Step 4: En IDENTIFICAR — guardar `rolJwt` y cambiar `supervisores.set` (líneas 57–95)**

Ubicar el bloque completo del case IDENTIFICAR para el rol SUPERVISOR. El bloque empieza en:
```javascript
                        } else { // SUPERVISOR (jefe_area o admin)
                            supervisores.set(clientInfo.id, ws);
                            console.log(`[WS] Jefe de Área conectado: ${clientInfo.nombre}`);

                            ws.send(JSON.stringify({
                                tipo: 'SNAPSHOT_ESTADOS',
                                estados: Object.keys(estadosAsesores).reduce((acc, id) => {
                                    const { socket, ...data } = estadosAsesores[id];
                                    acc[id] = data;
                                    return acc;
                                }, {}),
                                metricas: metricasAsesores,
                                dialing_mode: dialingMode
                            }));
                        }
```

Reemplazar por:
```javascript
                        } else { // SUPERVISOR (jefe_area o admin)
                            clientInfo.rolJwt = rolJwt;
                            supervisores.set(clientInfo.id, { ws, rol: rolJwt });
                            console.log(`[WS] Jefe de Área conectado: ${clientInfo.nombre}`);

                            const isAdmin = rolJwt === 'admin';
                            const jefeId  = clientInfo.id;
                            const estadosFiltrados = Object.keys(estadosAsesores).reduce((acc, id) => {
                                const { socket, ...data } = estadosAsesores[id];
                                if (isAdmin || data.supervisorId === jefeId) acc[id] = data;
                                return acc;
                            }, {});
                            const metricasFiltradas = isAdmin
                                ? metricasAsesores
                                : Object.fromEntries(
                                    Object.entries(metricasAsesores).filter(
                                        ([id]) => estadosAsesores[id]?.supervisorId === jefeId
                                    )
                                );
                            ws.send(JSON.stringify({
                                tipo: 'SNAPSHOT_ESTADOS',
                                estados: estadosFiltrados,
                                metricas: metricasFiltradas,
                                dialing_mode: dialingMode
                            }));
                        }
```

- [ ] **Step 5: Escopar notificación de asesor recién conectado (línea 89–92)**

Ubicar:
```javascript
                            // Notificar a supervisores de la nueva conexión
                            broadcastToSupervisors({
                                tipo: 'ESTADO_ASESOR',
                                ...estadosAsesores[clientInfo.id]
                            });
```

Reemplazar por:
```javascript
                            // Notificar solo al jefe del asesor (o a admins)
                            broadcastToJefeOf(clientInfo.id, {
                                tipo: 'ESTADO_ASESOR',
                                ...estadosAsesores[clientInfo.id]
                            });
```

- [ ] **Step 6: Escopar ESTADO_ASESOR (línea 127)**

Ubicar:
```javascript
                            broadcastToSupervisors(msg);
                        }
                        break;

                    case 'METRICAS_ASESOR':
```

Reemplazar por:
```javascript
                            broadcastToJefeOf(clientInfo.id, msg);
                        }
                        break;

                    case 'METRICAS_ASESOR':
```

- [ ] **Step 7: Escopar METRICAS_ASESOR (línea 134)**

Ubicar:
```javascript
                            metricasAsesores[clientInfo.id] = msg;
                            broadcastToSupervisors(msg);
```

Reemplazar por:
```javascript
                            metricasAsesores[clientInfo.id] = msg;
                            broadcastToJefeOf(clientInfo.id, msg);
```

- [ ] **Step 8: Escopar TIPIFICACION_REALIZADA (línea 140)**

Ubicar:
```javascript
                            broadcastToSupervisors({ ...msg, asesor_id: clientInfo.id });
```

Reemplazar por:
```javascript
                            broadcastToJefeOf(clientInfo.id, { ...msg, asesor_id: clientInfo.id });
```

- [ ] **Step 9: Escopar RITMO_BAJO / RITMO_OK (línea 148)**

Ubicar:
```javascript
                            broadcastToSupervisors({
                                ...msg,
                                asesor_id: clientInfo.id,
                                nombre: clientInfo.nombre,
                                timestamp: new Date().toISOString(),
                            });
```

Reemplazar por:
```javascript
                            broadcastToJefeOf(clientInfo.id, {
                                ...msg,
                                asesor_id: clientInfo.id,
                                nombre: clientInfo.nombre,
                                timestamp: new Date().toISOString(),
                            });
```

- [ ] **Step 10: Actualizar AUDIO_CHUNK para leer `.ws` del nuevo Map (línea 161)**

Ubicar:
```javascript
                        const asesorEntry = estadosAsesores[clientInfo.id];
                        if (asesorEntry?.supervisorId) {
                            const supWs = supervisores.get(asesorEntry.supervisorId);
                            if (supWs) safeSend(supWs, JSON.stringify({ ...msg, asesor_id: clientInfo.id }));
                        }
```

Reemplazar por:
```javascript
                        const asesorEntry = estadosAsesores[clientInfo.id];
                        if (asesorEntry?.supervisorId) {
                            const supEntry = supervisores.get(asesorEntry.supervisorId);
                            if (supEntry) safeSend(supEntry.ws, JSON.stringify({ ...msg, asesor_id: clientInfo.id }));
                        }
```

- [ ] **Step 11: Actualizar `ws.on('close')` — verificación de supervisor y desconexión de asesor**

Ubicar el bloque completo del close handler:
```javascript
        ws.on('close', () => {
            if (clientInfo.rol === 'SUPERVISOR') {
                // Solo eliminar si este socket sigue siendo el registrado (evita race condition en reconexión)
                if (supervisores.get(clientInfo.id) === ws) {
                    supervisores.delete(clientInfo.id);
                    console.log(`[WS] Jefe de Área desconectado: ${clientInfo.nombre}`);
                }
            } else if (clientInfo.rol === 'ASESOR' && clientInfo.id) {
                if (estadosAsesores[clientInfo.id]?.socket === ws) {
                    delete estadosAsesores[clientInfo.id];
                    console.log(`[WS] Asesor desconectado: ${clientInfo.nombre}`);
                }
                broadcastToSupervisors({
                    tipo: 'ASESOR_DESCONECTADO',
                    asesor_id: clientInfo.id,
                    nombre: clientInfo.nombre
                });
            }
        });
```

Reemplazar por:
```javascript
        ws.on('close', () => {
            if (clientInfo.rol === 'SUPERVISOR') {
                // Solo eliminar si este socket sigue siendo el registrado (evita race condition en reconexión)
                if (supervisores.get(clientInfo.id)?.ws === ws) {
                    supervisores.delete(clientInfo.id);
                    console.log(`[WS] Jefe de Área desconectado: ${clientInfo.nombre}`);
                }
            } else if (clientInfo.rol === 'ASESOR' && clientInfo.id) {
                const asesorEntry = estadosAsesores[clientInfo.id];
                const savedSupId  = asesorEntry?.supervisorId; // guardar antes de borrar
                if (asesorEntry?.socket === ws) {
                    delete estadosAsesores[clientInfo.id];
                    console.log(`[WS] Asesor desconectado: ${clientInfo.nombre}`);
                }
                // Notificar solo al jefe del asesor (y admins)
                const disconnectPayload = JSON.stringify({
                    tipo: 'ASESOR_DESCONECTADO',
                    asesor_id: clientInfo.id,
                    nombre: clientInfo.nombre
                });
                supervisores.forEach(({ ws: supWs, rol }, supervisorId) => {
                    if (rol === 'admin' || supervisorId === savedSupId) safeSend(supWs, disconnectPayload);
                });
            }
        });
```

- [ ] **Step 12: Actualizar `broadcastToSupervisors` para leer `.ws` del nuevo Map (línea 230–233)**

Ubicar:
```javascript
function broadcastToSupervisors(data) {
    const payload = JSON.stringify(data);
    supervisores.forEach(ws => safeSend(ws, payload));
}
```

Reemplazar por:
```javascript
function broadcastToSupervisors(data) {
    const payload = JSON.stringify(data);
    supervisores.forEach(({ ws }) => safeSend(ws, payload));
}
```

- [ ] **Step 13: Añadir las dos nuevas funciones de broadcast justo después de `broadcastToSupervisors`**

Ubicar la línea que comienza `function broadcastToAll(data) {` y añadir ANTES de ella:

```javascript
// Envía solo al jefe asignado al asesor (+ admins conectados)
function broadcastToJefeOf(asesorId, data) {
    const supId  = estadosAsesores[asesorId]?.supervisorId;
    const payload = JSON.stringify(data);
    supervisores.forEach(({ ws, rol }, supervisorId) => {
        if (rol === 'admin' || supervisorId === supId) safeSend(ws, payload);
    });
}

// Envía al jefe y a todos sus asesores conectados
function broadcastToJefeTeam(jefeId, data) {
    const payload = JSON.stringify(data);
    const supEntry = supervisores.get(jefeId);
    if (supEntry) safeSend(supEntry.ws, payload);
    Object.values(estadosAsesores).forEach(a => {
        if (a.supervisorId === jefeId) safeSend(a.socket, payload);
    });
}

```

- [ ] **Step 14: Actualizar `broadcastToAll` para leer `.ws` del nuevo Map (línea 235–239)**

Ubicar:
```javascript
function broadcastToAll(data) {
    const payload = JSON.stringify(data);
    supervisores.forEach(ws => safeSend(ws, payload));
    Object.values(estadosAsesores).forEach(a => safeSend(a.socket, payload));
}
```

Reemplazar por:
```javascript
function broadcastToAll(data) {
    const payload = JSON.stringify(data);
    supervisores.forEach(({ ws }) => safeSend(ws, payload));
    Object.values(estadosAsesores).forEach(a => safeSend(a.socket, payload));
}
```

- [ ] **Step 15: Exportar `broadcastToJefeTeam` al final del archivo**

Ubicar:
```javascript
module.exports = setupWsServer;
module.exports.getConnectedStats = getConnectedStats;
module.exports.broadcastToAll = broadcastToAll;
```

Reemplazar por:
```javascript
module.exports = setupWsServer;
module.exports.getConnectedStats     = getConnectedStats;
module.exports.broadcastToAll        = broadcastToAll;
module.exports.broadcastToJefeTeam   = broadcastToJefeTeam;
```

- [ ] **Step 16: Verificar que el servidor arranca sin errores**

```bash
cd backend && node src/index.js
```

Esperado: servidor inicia en puerto 3001/3002 sin crash. Ctrl+C para detener.

- [ ] **Step 17: Commit**

```bash
git add backend/src/wsServer.js
git commit -m "fix(ws): scope broadcasts to jefe's own team, not all supervisors"
```

---

## Task 2: Filtrar GET `/mensajes-broadcast` por área en supervisor.routes.js

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js` (líneas 2398–2422)

Añade un WHERE condicional al query SQL según el rol del token: asesor → mensajes de su supervisor; jefe_area → solo sus propios mensajes; admin → todo.

- [ ] **Step 1: Localizar el endpoint GET `/mensajes-broadcast` (línea 2400)**

```bash
grep -n "mensajes-broadcast" backend/src/routes/supervisor.routes.js
```

Confirmar líneas: GET ~2400, POST ~2424, DELETE ~2455.

- [ ] **Step 2: Reemplazar el handler GET completo**

Ubicar el bloque completo:
```javascript
router.get('/mensajes-broadcast', requireRole('jefe_area', 'admin', 'asesor'), async (req, res, next) => {
  try {
    const rows = await db.$queryRaw`
      SELECT mb.id, mb.mensaje, mb.segmento_destino, mb.canal, mb.asunto, mb.imagen_url,
             mb.activo, mb.creado_en, u.nombre AS supervisor_nombre
      FROM mensajes_broadcast mb
      LEFT JOIN usuarios u ON u.id = mb.supervisor_id
      ORDER BY mb.creado_en DESC
    `;
    res.json(rows.map(m => ({
      id:                Number(m.id),
      mensaje:           m.mensaje,
      segmento_destino:  m.segmento_destino,
      canal:             m.canal ?? null,
      asunto:            m.asunto ?? null,
      imagen_url:        m.imagen_url ?? null,
      activo:            m.activo ? 1 : 0,
      supervisor_nombre: m.supervisor_nombre ?? null,
      creado_en:         m.creado_en,
      pagos_posteriores: 0,
    })));
  } catch (err) { next(err); }
});
```

Reemplazar por:
```javascript
router.get('/mensajes-broadcast', requireRole('jefe_area', 'admin', 'asesor'), async (req, res, next) => {
  try {
    let rows;
    if (req.user.rol === 'asesor') {
      // Solo mensajes del jefe asignado al asesor
      rows = await db.$queryRaw`
        SELECT mb.id, mb.mensaje, mb.segmento_destino, mb.canal, mb.asunto, mb.imagen_url,
               mb.activo, mb.creado_en, u.nombre AS supervisor_nombre
        FROM mensajes_broadcast mb
        LEFT JOIN usuarios u ON u.id = mb.supervisor_id
        WHERE mb.supervisor_id = (SELECT supervisor_id FROM usuarios WHERE id = ${req.user.id})
        ORDER BY mb.creado_en DESC
      `;
    } else if (req.user.rol === 'jefe_area') {
      // Solo los mensajes del propio jefe (MessagesConfig solo muestra los suyos)
      rows = await db.$queryRaw`
        SELECT mb.id, mb.mensaje, mb.segmento_destino, mb.canal, mb.asunto, mb.imagen_url,
               mb.activo, mb.creado_en, u.nombre AS supervisor_nombre
        FROM mensajes_broadcast mb
        LEFT JOIN usuarios u ON u.id = mb.supervisor_id
        WHERE mb.supervisor_id = ${req.user.id}
        ORDER BY mb.creado_en DESC
      `;
    } else {
      // admin: ver todos
      rows = await db.$queryRaw`
        SELECT mb.id, mb.mensaje, mb.segmento_destino, mb.canal, mb.asunto, mb.imagen_url,
               mb.activo, mb.creado_en, u.nombre AS supervisor_nombre
        FROM mensajes_broadcast mb
        LEFT JOIN usuarios u ON u.id = mb.supervisor_id
        ORDER BY mb.creado_en DESC
      `;
    }
    res.json(rows.map(m => ({
      id:                Number(m.id),
      mensaje:           m.mensaje,
      segmento_destino:  m.segmento_destino,
      canal:             m.canal ?? null,
      asunto:            m.asunto ?? null,
      imagen_url:        m.imagen_url ?? null,
      activo:            m.activo ? 1 : 0,
      supervisor_nombre: m.supervisor_nombre ?? null,
      creado_en:         m.creado_en,
      pagos_posteriores: 0,
    })));
  } catch (err) { next(err); }
});
```

- [ ] **Step 3: Verificar el cambio con grep**

```bash
grep -n "supervisor_id FROM usuarios" backend/src/routes/supervisor.routes.js
```

Esperado: una línea con el subquery del caso `asesor`.

- [ ] **Step 4: Commit parcial**

```bash
git add backend/src/routes/supervisor.routes.js
git commit -m "fix(api): filter mensajes-broadcast by jefe area per rol"
```

---

## Task 3: Escopar broadcast WS al crear/desactivar mensaje broadcast

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js` (líneas 2424–2462)

Reemplaza `broadcastToAll` por `broadcastToJefeTeam` en POST y DELETE de mensajes-broadcast, para que solo el jefe y SUS asesores reciban el evento WS.

- [ ] **Step 1: Actualizar el import de wsServer.js en supervisor.routes.js (línea 12)**

Ubicar:
```javascript
const { broadcastToAll, getConnectedStats } = require('../wsServer');
```

Reemplazar por:
```javascript
const { broadcastToAll, broadcastToJefeTeam, getConnectedStats } = require('../wsServer');
```

- [ ] **Step 2: Escopar `NUEVO_MENSAJE_BROADCAST` en POST (línea 2450)**

Ubicar:
```javascript
    broadcastToAll({ tipo: 'NUEVO_MENSAJE_BROADCAST', mensaje: payload });
```

Reemplazar por:
```javascript
    broadcastToJefeTeam(req.user.id, { tipo: 'NUEVO_MENSAJE_BROADCAST', mensaje: payload });
```

- [ ] **Step 3: Escopar `MENSAJE_BROADCAST_DESACTIVADO` en DELETE (línea 2459)**

Ubicar:
```javascript
    broadcastToAll({ tipo: 'MENSAJE_BROADCAST_DESACTIVADO', id });
```

Reemplazar por:
```javascript
    // jefe_area desactiva su propio mensaje; admin usa broadcastToAll para cubrir todas las áreas
    if (req.user.rol === 'admin') {
      broadcastToAll({ tipo: 'MENSAJE_BROADCAST_DESACTIVADO', id });
    } else {
      broadcastToJefeTeam(req.user.id, { tipo: 'MENSAJE_BROADCAST_DESACTIVADO', id });
    }
```

- [ ] **Step 4: Verificar sintaxis arrancando el servidor**

```bash
cd backend && node -e "require('./src/routes/supervisor.routes.js')"
```

Esperado: no hay error de sintaxis (el comando termina sin output de error).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/supervisor.routes.js
git commit -m "fix(ws): scope mensaje-broadcast WS events to jefe's own team"
```

---

## Task 4: Smoke test manual end-to-end

**Files:** ninguno (solo verificación)

Sin suite de tests automatizados para este módulo, la verificación es manual con dos sesiones de browser.

- [ ] **Step 1: Iniciar el backend**

```bash
cd backend && node src/index.js
```

Confirmar: `Server running on port 3001` (o 3002 en prod).

- [ ] **Step 2: Verificar aislamiento REST con curl**

Obtener token de jefe-1 (ajustar credenciales al entorno):

```bash
TOKEN_J1=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jefe1@test.com","password":"pass"}' | jq -r '.token')

TOKEN_J2=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jefe2@test.com","password":"pass"}' | jq -r '.token')

TOKEN_A1=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"asesor1@test.com","password":"pass"}' | jq -r '.token')
```

- [ ] **Step 3: Crear mensaje con jefe-1 y verificar que asesor-1 lo ve, asesor-2 NO**

```bash
# Crear mensaje con jefe-1
curl -s -X POST http://localhost:3001/api/mensajes-broadcast \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN_J1" \
  -d '{"mensaje":"Hola equipo 1","segmento_destino":"TODOS","canal":"WSP"}'

# Asesor-1 (de jefe-1) debe VER el mensaje
curl -s http://localhost:3001/api/mensajes-broadcast \
  -H "Authorization: Bearer $TOKEN_A1" | jq 'length'
# Esperado: >= 1

# Asesor-2 (de jefe-2) debe VER 0 mensajes de jefe-1
TOKEN_A2=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"asesor2@test.com","password":"pass"}' | jq -r '.token')
curl -s http://localhost:3001/api/mensajes-broadcast \
  -H "Authorization: Bearer $TOKEN_A2" | jq 'length'
# Esperado: 0 (o solo mensajes de jefe-2 si los hay)
```

- [ ] **Step 4: Verificar aislamiento WS (SNAPSHOT_ESTADOS)**

Abrir dos sesiones del panel jefe en el browser (jefe-1 y jefe-2). Confirmar que el panel de jefe-1 muestra SOLO los asesores de su equipo en la lista live, y viceversa.

Si el panel jefe no abre fácilmente, verificar en el log del servidor al conectar:
```
[WS] Jefe de Área conectado: NombreJefe1
```
y que el SNAPSHOT enviado en el log de red (DevTools → WS → frames) contiene solo los `asesor_id` del equipo de ese jefe.

- [ ] **Step 5: Commit final si todo pasa**

```bash
git tag fix/jefe-area-isolation
```

---

## Notas de riesgo

1. **Asesores sin `supervisor_id`**: El subquery `SELECT supervisor_id FROM usuarios WHERE id = X` devuelve `NULL` si el asesor no tiene jefe asignado. El WHERE `mb.supervisor_id = NULL` nunca matchea en SQL → asesor verá 0 mensajes. Comportamiento correcto (asesor huérfano no debería ver mensajes de nadie). No es un bug.

2. **Admin y SNAPSHOT_ESTADOS**: El admin conectado como jefe (rolJwt === 'admin') recibe TODOS los asesores en SNAPSHOT. Comportamiento deseado para monitoreo global.

3. **`broadcastToAll` para META_ACTUALIZADA y PAGO_VALIDADO**: Estos eventos siguen usando `broadcastToAll` — son eventos globales que afectan a todos los asesores de la plataforma. No se tocan en este plan.

4. **Race condition en broadcastToJefeOf**: Si el asesor se conecta antes de que se resuelva el `db.usuario.findUnique` para obtener su `supervisorId`, la entrada en `estadosAsesores` puede tener `supervisorId: null` temporalmente. Es un race condition pre-existente (no introducido por este fix). La consecuencia es que el jefe no recibe el primer ESTADO_ASESOR del asesor recién conectado — el estado se sincroniza en la siguiente actualización.
