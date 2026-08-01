# Spec: Mensajes Broadcast por Canal y Segmento

**Fecha:** 2026-08-01  
**Estado:** Aprobado  
**Alcance:** `backend/prisma/schema.prisma`, `backend/src/routes/supervisor.routes.js`, `src/renderer/supervisor/SupervisorMensajes.jsx`, `src/renderer/asesor/AsesorPanel.jsx`

---

## Problema

El sistema actual de mensajes broadcast no diferencia por canal de comunicación. Cuando el Jefe de Área envía un mensaje, el mismo texto se usa para WhatsApp, RCS y Correo. Los botones RCS/WSP/CORREO en la cartera del asesor usan `getMensajeParaContacto` que ignora el canal.

---

## Solución

Agregar campo `canal` a `MensajeBroadcast`. El Jefe elige **canal** (WSP / RCS / CORREO / TODOS) **y** **segmento** (TRAMO_0 / TRAMO_1 / TRAMO_2 / TODOS) al crear cada mensaje. El asesor al presionar un botón de canal recibe el mensaje específico para ese canal y el tramo de mora del contacto.

---

## Base de datos

### Migración

```sql
ALTER TABLE mensajes_broadcast
  ADD COLUMN IF NOT EXISTS canal VARCHAR(20) NOT NULL DEFAULT 'TODOS';
```

### Prisma schema

```prisma
model MensajeBroadcast {
  id              Int      @id @default(autoincrement())
  supervisorId    Int      @map("supervisor_id")
  mensaje         String
  segmentoDestino String   @default("TODOS") @map("segmento_destino")
  canal           String   @default("TODOS") @map("canal")   // ← NUEVO
  creadoEn        DateTime @default(now()) @map("creado_en")
  activo          Boolean  @default(true)
  supervisor      Usuario  @relation(fields: [supervisorId], references: [id])

  @@map("mensajes_broadcast")
}
```

### Valores válidos

| Campo            | Valores                              |
|------------------|--------------------------------------|
| `canal`          | `'WSP'` `'RCS'` `'CORREO'` `'TODOS'`|
| `segmentoDestino`| `'TRAMO_0'` `'TRAMO_1'` `'TRAMO_2'` `'TODOS'` + custom |

---

## Backend — `supervisor.routes.js`

### GET `/mensajes-broadcast`

Agrega `canal` al objeto de respuesta:

```js
res.json(rows.map(m => ({
  id:               m.id,
  mensaje:          m.mensaje,
  segmento_destino: m.segmentoDestino,
  canal:            m.canal,            // ← NUEVO
  activo:           m.activo ? 1 : 0,
  supervisor_nombre: m.supervisor?.nombre ?? null,
  creado_en:        m.creadoEn,
  pagos_posteriores: 0,
})));
```

### POST `/mensajes-broadcast`

Acepta `canal` del body:

```js
const { mensaje, segmento_destino = 'TODOS', canal = 'TODOS' } = req.body;
// validar canal
const canalesValidos = ['TODOS', 'WSP', 'RCS', 'CORREO'];
if (!canalesValidos.includes(canal)) return res.status(400).json({ error: 'Canal inválido' });

const m = await db.mensajeBroadcast.create({
  data: {
    supervisorId: req.user.id,
    mensaje: mensaje.trim(),
    segmentoDestino: segmento_destino,
    canal,   // ← NUEVO
  },
  include: { supervisor: { select: { nombre: true } } },
});
// payload incluye canal
const payload = { ..., canal: m.canal };
broadcastToAll({ tipo: 'NUEVO_MENSAJE_BROADCAST', mensaje: payload });
```

### DELETE `/mensajes-broadcast/:id`

Sin cambios.

---

## Frontend — Supervisor (`SupervisorMensajes.jsx`)

### Formulario "Nuevo Mensaje"

Dos filas de selectores independientes:

```
SEGMENTO DESTINO
[ Todos ] [T0 · 0 días] [T1 · 1 día] [T2 · 2 días] + tramos custom

CANAL
[ Todos ] [ WhatsApp ] [ RCS ] [ Correo ]
```

Estado nuevo: `const [canalDestino, setCanalDestino] = useState('TODOS');`

Constante de canales:
```js
const CANALES = [
  { id: 'TODOS',   label: 'Todos los canales', icon: 'all_inclusive' },
  { id: 'WSP',     label: 'WhatsApp',           icon: 'chat',         color: '#25D366' },
  { id: 'RCS',     label: 'RCS',                icon: 'sms',          color: '#64b5f6' },
  { id: 'CORREO',  label: 'Correo',             icon: 'email',        color: '#f48fb1' },
];
```

El body del POST incluye `canal: canalDestino`.

### Historial — agrupación

Cards de historial muestran badge adicional de canal con color:
- WSP → verde `#25D366`
- RCS → azul `#64b5f6`
- Correo → rosa `#f48fb1`
- TODOS → color primario

Secciones de acordeón existentes (Activos / Efectivos / No Efectivos) se mantienen. Dentro, cada card muestra `canal` + `segmento_destino`.

---

## Frontend — Asesor (`AsesorPanel.jsx`)

### `getMensajeParaContacto(contacto, diasMoraVal, canal)`

Agrega parámetro `canal`. Prioridad de match (de mayor a menor):

1. `segmento === segmento_destino` AND `canal === m.canal`
2. `segmento === segmento_destino` AND `m.canal === 'TODOS'`
3. `m.segmento_destino === 'TODOS'` AND `canal === m.canal`
4. `m.segmento_destino === 'TODOS'` AND `m.canal === 'TODOS'`

```js
function getMensajeParaContacto(contacto, diasMoraVal, canal = 'TODOS') {
  const dias = parseInt(diasMoraVal, 10) || 0;
  const segmento = dias === 0 ? 'TRAMO_0' : dias === 1 ? 'TRAMO_1' : 'TRAMO_2';
  if (!mensajesBroadcast.length) return '';
  const activos = mensajesBroadcast.filter(m => m.activo === 1 || m.activo === true);
  const match =
    activos.find(m => m.segmento_destino === segmento  && m.canal === canal)   ||
    activos.find(m => m.segmento_destino === segmento  && m.canal === 'TODOS') ||
    activos.find(m => m.segmento_destino === 'TODOS'   && m.canal === canal)   ||
    activos.find(m => m.segmento_destino === 'TODOS'   && m.canal === 'TODOS');
  if (!match) return '';
  return match.mensaje
    .replace(/\{nombre\}/gi, contacto.nombre_deudor || '')
    .replace(/\{deuda\}/gi,  contacto.monto_deuda   || '')
    .replace(/\{cedula\}/gi, contacto.cedula         || '')
    .replace(/\{dias\}/gi,   String(dias))
    .replace(/\{telefono\}/gi, contacto.telefono     || '');
}
```

### Llamada en cartera (línea 3556)

```js
// Antes:
const mensaje = getMensajeParaContacto(c, diasMoraVal);
// Después:
const canalKey = canal === 'wsp' ? 'WSP' : canal === 'rcs' ? 'RCS' : canal === 'correo' ? 'CORREO' : 'TODOS';
const mensaje = getMensajeParaContacto(c, diasMoraVal, canalKey);
```

`canal` ya existe en scope del `.map()` con valores `'wsp'`, `'rcs'`, `'correo'`.

---

## Compatibilidad retroactiva

- Mensajes existentes en DB tienen `canal = 'TODOS'` (default de la migración).
- Fallback nivel 4 (`TODOS + TODOS`) garantiza que mensajes viejos sin canal sigan funcionando.
- `AsesorMensajes.jsx` (pestaña de mensajes del asesor) no requiere cambios — muestra todos los activos igualmente.

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `backend/prisma/schema.prisma` | Agregar campo `canal` a `MensajeBroadcast` |
| `backend/prisma/migrations/` | Nueva migración SQL `ADD COLUMN canal` |
| `backend/src/routes/supervisor.routes.js` | GET devuelve `canal`, POST acepta y guarda `canal` |
| `src/renderer/supervisor/SupervisorMensajes.jsx` | Selector de canal, envío de `canal`, badge en historial |
| `src/renderer/asesor/AsesorPanel.jsx` | `getMensajeParaContacto` + `canal` param, llamada en línea 3556 |

**Total: 5 archivos. Sin nuevo endpoint. Sin romper datos existentes.**

---

## Capacidad máxima de mensajes activos simultáneos

```
3 canales × 3 tramos = 9 específicos
+3 generales por canal (TRAMO=TODOS)
+1 global (TODOS+TODOS)
= 13 mensajes activos máximos
```
