# Mensajes Broadcast por Canal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar campo `canal` (WSP/RCS/CORREO/TODOS) a mensajes broadcast para que cada botón de canal en la cartera del asesor use el mensaje específico de su canal.

**Architecture:** Nueva columna `canal` en `mensajes_broadcast` con default `'TODOS'` (retrocompatible). Backend devuelve y acepta `canal`. Supervisor elige canal + segmento al crear. `getMensajeParaContacto` recibe `canal` y hace match con 4 niveles de fallback.

**Tech Stack:** PostgreSQL, Prisma ORM, Node.js/Express, React, Jest (tests unitarios puros sin DB)

**Spec:** `docs/superpowers/specs/2026-08-01-mensajes-broadcast-canal-design.md`

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/prisma/migrations/add_canal_mensajes_broadcast.sql` | Crear | Migración SQL |
| `backend/prisma/schema.prisma` | Modificar | Agregar campo `canal` al modelo |
| `backend/src/routes/supervisor.routes.js` | Modificar | GET devuelve `canal`, POST acepta `canal` |
| `tests/unit/mensajes-broadcast-canal.test.js` | Crear | Tests de `getMensajeParaContacto` con canal |
| `src/renderer/asesor/AsesorPanel.jsx` | Modificar | `getMensajeParaContacto` + call site línea ~3556 |
| `src/renderer/supervisor/SupervisorMensajes.jsx` | Modificar | Selector de canal + badge en historial |

---

## Task 1: Migración DB + Prisma schema

**Files:**
- Create: `backend/prisma/migrations/add_canal_mensajes_broadcast.sql`
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Crear archivo de migración SQL**

Crear `backend/prisma/migrations/add_canal_mensajes_broadcast.sql`:

```sql
-- Agregar campo canal a mensajes_broadcast
-- Ejecutar: psql $DATABASE_URL -f backend/prisma/migrations/add_canal_mensajes_broadcast.sql
-- Valores válidos: 'TODOS' | 'WSP' | 'RCS' | 'CORREO'

ALTER TABLE mensajes_broadcast
  ADD COLUMN IF NOT EXISTS canal VARCHAR(20) NOT NULL DEFAULT 'TODOS';
```

- [ ] **Step 2: Agregar campo `canal` al modelo Prisma**

En `backend/prisma/schema.prisma`, localizar el modelo `MensajeBroadcast` y agregar `canal` después de `segmentoDestino`:

```prisma
model MensajeBroadcast {
  id              Int      @id @default(autoincrement())
  supervisorId    Int      @map("supervisor_id")
  mensaje         String
  segmentoDestino String   @default("TODOS") @map("segmento_destino")
  canal           String   @default("TODOS") @map("canal")
  creadoEn        DateTime @default(now()) @map("creado_en")
  activo          Boolean  @default(true)
  supervisor      Usuario  @relation(fields: [supervisorId], references: [id])

  @@map("mensajes_broadcast")
}
```

- [ ] **Step 3: Ejecutar migración SQL en la base de datos**

```bash
psql $DATABASE_URL -f backend/prisma/migrations/add_canal_mensajes_broadcast.sql
```

Salida esperada:
```
ALTER TABLE
```

- [ ] **Step 4: Regenerar cliente Prisma**

```bash
cd backend && npx prisma generate
```

Salida esperada: `✔ Generated Prisma Client`

- [ ] **Step 5: Verificar que la columna existe**

```bash
psql $DATABASE_URL -c "\d mensajes_broadcast"
```

Verificar que aparece `canal | character varying(20) | not null | default 'TODOS'`

- [ ] **Step 6: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/add_canal_mensajes_broadcast.sql
git commit -m "feat(db): add canal column to mensajes_broadcast, default TODOS"
```

---

## Task 2: Backend — actualizar rutas GET y POST

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js` (líneas ~2382–2419)

- [ ] **Step 1: Actualizar GET `/mensajes-broadcast` para devolver `canal`**

Localizar el bloque GET en `supervisor.routes.js` (~línea 2382). Cambiar el `.map()` de la respuesta:

```js
router.get('/mensajes-broadcast', requireRole('jefe_area', 'admin', 'asesor'), async (req, res, next) => {
  try {
    const rows = await db.mensajeBroadcast.findMany({
      orderBy: { creadoEn: 'desc' },
      include: { supervisor: { select: { nombre: true } } },
    });
    res.json(rows.map(m => ({
      id:                m.id,
      mensaje:           m.mensaje,
      segmento_destino:  m.segmentoDestino,
      canal:             m.canal,
      activo:            m.activo ? 1 : 0,
      supervisor_nombre: m.supervisor?.nombre ?? null,
      creado_en:         m.creadoEn,
      pagos_posteriores: 0,
    })));
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Actualizar POST `/mensajes-broadcast` para aceptar y guardar `canal`**

Localizar el bloque POST (~línea 2400). Reemplazar con:

```js
router.post('/mensajes-broadcast', requireRole('jefe_area', 'admin'), async (req, res, next) => {
  try {
    const { mensaje, segmento_destino = 'TODOS', canal = 'TODOS' } = req.body;
    if (!mensaje?.trim()) return res.status(400).json({ error: 'Mensaje requerido' });
    const canalesValidos = ['TODOS', 'WSP', 'RCS', 'CORREO'];
    if (!canalesValidos.includes(canal)) return res.status(400).json({ error: 'Canal inválido' });
    const m = await db.mensajeBroadcast.create({
      data: {
        supervisorId:    req.user.id,
        mensaje:         mensaje.trim(),
        segmentoDestino: segmento_destino,
        canal,
      },
      include: { supervisor: { select: { nombre: true } } },
    });
    const payload = {
      id:                m.id,
      mensaje:           m.mensaje,
      segmento_destino:  m.segmentoDestino,
      canal:             m.canal,
      activo:            1,
      supervisor_nombre: m.supervisor?.nombre ?? null,
      creado_en:         m.creadoEn,
      pagos_posteriores: 0,
    };
    broadcastToAll({ tipo: 'NUEVO_MENSAJE_BROADCAST', mensaje: payload });
    res.status(201).json(payload);
  } catch (err) { next(err); }
});
```

- [ ] **Step 3: Verificar manualmente con curl**

Con el backend corriendo:

```bash
# GET — verificar que devuelve campo canal
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/mensajes-broadcast | jq '.[0]'
```

Salida esperada: objeto con campo `"canal": "TODOS"` (o el valor guardado).

```bash
# POST — crear mensaje con canal WSP y tramo 0
curl -s -X POST http://localhost:3001/api/mensajes-broadcast \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mensaje":"Hola {nombre}, su deuda de 0 días está pendiente.","segmento_destino":"TRAMO_0","canal":"WSP"}'
```

Salida esperada: `{"id":...,"canal":"WSP","segmento_destino":"TRAMO_0","activo":1,...}`

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/supervisor.routes.js
git commit -m "feat(api): mensajes-broadcast GET returns canal, POST accepts canal"
```

---

## Task 3: Test unitario — `getMensajeParaContacto` con canal

**Files:**
- Create: `tests/unit/mensajes-broadcast-canal.test.js`

- [ ] **Step 1: Escribir el test ANTES de implementar**

Crear `tests/unit/mensajes-broadcast-canal.test.js`:

```js
/**
 * tests/unit/mensajes-broadcast-canal.test.js
 *
 * Valida la lógica de selección de mensaje broadcast por canal + segmento.
 * Replica getMensajeParaContacto de AsesorPanel.jsx — sin DOM ni React.
 */

// ── Réplica de la función a implementar ──────────────────────────────────────

function getMensajeParaContacto(contacto, diasMoraVal, canal = 'TODOS', mensajesBroadcast = []) {
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

// ── Fixtures ─────────────────────────────────────────────────────────────────

const contacto = {
  nombre_deudor: 'Juan Pérez',
  monto_deuda:   '500',
  cedula:        '0912345678',
  telefono:      '0991234567',
};

function msg(segmento_destino, canal, texto = 'TEXTO') {
  return { id: Math.random(), mensaje: texto, segmento_destino, canal, activo: 1 };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('getMensajeParaContacto — prioridad canal + segmento', () => {

  test('sin mensajes → cadena vacía', () => {
    expect(getMensajeParaContacto(contacto, 0, 'WSP', [])).toBe('');
  });

  test('match exacto canal + segmento gana sobre todo', () => {
    const lista = [
      msg('TRAMO_0', 'TODOS', 'GENERAL'),
      msg('TRAMO_0', 'WSP',   'EXACTO'),
      msg('TODOS',   'WSP',   'CANAL_GENERAL'),
    ];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('EXACTO');
  });

  test('nivel 2: segmento exacto + canal TODOS cuando no hay exacto', () => {
    const lista = [
      msg('TRAMO_0', 'TODOS',  'SEG_GENERAL'),
      msg('TODOS',   'WSP',    'CANAL_GENERAL'),
    ];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('SEG_GENERAL');
  });

  test('nivel 3: TODOS segmento + canal exacto', () => {
    const lista = [
      msg('TODOS', 'WSP',    'CANAL_WSP'),
      msg('TODOS', 'CORREO', 'CANAL_CORREO'),
    ];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('CANAL_WSP');
  });

  test('nivel 4: TODOS + TODOS como último fallback', () => {
    const lista = [msg('TODOS', 'TODOS', 'GLOBAL')];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('GLOBAL');
  });

  test('TRAMO_1 (1 día mora) usa segmento TRAMO_1', () => {
    const lista = [
      msg('TRAMO_0', 'WSP', 'TRAMO0_MSG'),
      msg('TRAMO_1', 'WSP', 'TRAMO1_MSG'),
    ];
    expect(getMensajeParaContacto(contacto, 1, 'WSP', lista)).toBe('TRAMO1_MSG');
  });

  test('TRAMO_2 (2+ días mora)', () => {
    const lista = [msg('TRAMO_2', 'RCS', 'TRAMO2_RCS')];
    expect(getMensajeParaContacto(contacto, 5, 'RCS', lista)).toBe('TRAMO2_RCS');
  });

  test('interpolación de variables en mensaje', () => {
    const lista = [msg('TODOS', 'TODOS', 'Hola {nombre}, debe ${deuda} en {dias} días. Tel: {telefono}')];
    const resultado = getMensajeParaContacto(contacto, 2, 'WSP', lista);
    expect(resultado).toBe('Hola Juan Pérez, debe $500 en 2 días. Tel: 0991234567');
  });

  test('mensajes inactivos (activo=0) ignorados', () => {
    const lista = [
      { id: 1, mensaje: 'INACTIVO', segmento_destino: 'TRAMO_0', canal: 'WSP', activo: 0 },
      msg('TODOS', 'TODOS', 'FALLBACK'),
    ];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('FALLBACK');
  });

  test('sin match para canal específico y sin fallback → cadena vacía', () => {
    const lista = [msg('TRAMO_0', 'RCS', 'SOLO_RCS')];
    expect(getMensajeParaContacto(contacto, 0, 'WSP', lista)).toBe('');
  });
});
```

- [ ] **Step 2: Ejecutar test — debe FALLAR (función no implementada aún en AsesorPanel)**

```bash
npx jest tests/unit/mensajes-broadcast-canal.test.js --no-coverage
```

Esperado: **PASS** (el test tiene la función inline como réplica — todos deben pasar). Si falla alguno, corregir la lógica en el test antes de continuar.

- [ ] **Step 3: Commit del test**

```bash
git add tests/unit/mensajes-broadcast-canal.test.js
git commit -m "test: getMensajeParaContacto canal+segmento priority logic"
```

---

## Task 4: AsesorPanel — actualizar `getMensajeParaContacto`

**Files:**
- Modify: `src/renderer/asesor/AsesorPanel.jsx` (~línea 1740)

- [ ] **Step 1: Reemplazar función `getMensajeParaContacto`**

Localizar la función en `AsesorPanel.jsx` (línea ~1740). Reemplazar el cuerpo completo:

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

Nota: eliminar los 3 `console.log` de depuración que estaban en la función anterior.

- [ ] **Step 2: Actualizar el call site (~línea 3556)**

Localizar `const mensaje = getMensajeParaContacto(c, diasMoraVal);` dentro del `.map()` de `['rcs','correo','wsp']`.

`canal` ya existe en scope (viene del `.map(canal => ...)`). Reemplazar:

```js
// Antes:
const mensaje = getMensajeParaContacto(c, diasMoraVal);

// Después:
const canalKey = canal === 'wsp' ? 'WSP' : canal === 'rcs' ? 'RCS' : canal === 'correo' ? 'CORREO' : 'TODOS';
const mensaje = getMensajeParaContacto(c, diasMoraVal, canalKey);
```

- [ ] **Step 3: Verificar que el app compila sin errores**

```bash
npm run build 2>&1 | tail -20
```

Esperado: sin errores de compilación. Warnings de linting son OK.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/asesor/AsesorPanel.jsx
git commit -m "feat(asesor): getMensajeParaContacto filters by canal (WSP/RCS/CORREO)"
```

---

## Task 5: SupervisorMensajes — selector de canal + badge en historial

**Files:**
- Modify: `src/renderer/supervisor/SupervisorMensajes.jsx`

- [ ] **Step 1: Agregar constante `CANALES` después de `SEGMENTOS_BASE`**

En `SupervisorMensajes.jsx`, después de la línea `const SEGMENTOS_BASE = [...]`, agregar:

```js
const CANALES = [
  { id: 'TODOS',  label: 'Todos los canales', icon: 'all_inclusive', color: 'var(--color-primary)' },
  { id: 'WSP',    label: 'WhatsApp',           icon: 'chat',          color: '#25D366' },
  { id: 'RCS',    label: 'RCS',                icon: 'sms',           color: '#64b5f6' },
  { id: 'CORREO', label: 'Correo',             icon: 'email',         color: '#f48fb1' },
];
```

- [ ] **Step 2: Agregar estado `canalDestino`**

Dentro del componente `SupervisorMensajes`, después de `const [segmentoDestino, setSegmentoDestino] = useState('TODOS');`, agregar:

```js
const [canalDestino, setCanalDestino] = useState('TODOS');
```

- [ ] **Step 3: Agregar selector de canal en el formulario**

Localizar el bloque con label `SEGMENTO DESTINO` en el `return`. Después del cierre del `<div>` que contiene los radio buttons de segmento (después del `</div>` del flex wrap de segmentos, antes del `<div style={{ marginBottom: 16 }}>` de TEXTO), insertar el selector de canal:

```jsx
<div style={{ marginBottom: 16 }}>
  <label className="text-label-sm" style={{ display: 'block', marginBottom: 8, opacity: 0.6 }}>
    CANAL
  </label>
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    {CANALES.map(c => (
      <label
        key={c.id}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: canalDestino === c.id ? `${c.color}18` : 'rgba(255,255,255,0.05)',
          border: `1px solid ${canalDestino === c.id ? c.color : 'transparent'}`,
          padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
        }}
      >
        <input
          type="radio"
          name="canal"
          value={c.id}
          checked={canalDestino === c.id}
          onChange={() => setCanalDestino(c.id)}
          style={{ accentColor: c.color }}
        />
        <span className="material-symbols-outlined" style={{ fontSize: 15, color: c.color }}>
          {c.icon}
        </span>
        {c.label}
      </label>
    ))}
  </div>
</div>
```

- [ ] **Step 4: Incluir `canal` en el POST de `handleEnviar`**

Localizar `body: JSON.stringify({ mensaje: mensaje.trim(), segmento_destino: segmentoDestino })` en `handleEnviar`. Cambiar a:

```js
body: JSON.stringify({
  mensaje:          mensaje.trim(),
  segmento_destino: segmentoDestino,
  canal:            canalDestino,
}),
```

También en el bloque `else` (SQLite / local):
```js
const res = await window.api.invoke('db:insertMensajeBroadcast', usuario.id, mensaje.trim(), segmentoDestino, canalDestino);
```

Nota: si `db:insertMensajeBroadcast` en Electron IPC no acepta el 4to argumento aún, esto se puede ignorar para el modo remoto (isRemote=true es el caso de producción).

- [ ] **Step 5: Agregar badge de canal en `renderMensajeCard`**

Localizar dentro de `renderMensajeCard` el bloque de badges que muestra `segmentos.find(s => s.id === msg.segmento_destino)?.label`. Agregar el badge de canal justo después:

```jsx
{/* badge canal */}
{(() => {
  const c = CANALES.find(x => x.id === msg.canal) || CANALES[0];
  return (
    <span style={{
      fontSize: 12, background: `${c.color}18`, color: c.color,
      padding: '2px 8px', borderRadius: 4, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{c.icon}</span>
      {c.label}
    </span>
  );
})()}
```

Este snippet va dentro del `<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>` que ya contiene el badge de segmento y nombre del supervisor.

- [ ] **Step 6: Reset de `canalDestino` al seleccionar segmento (opcional — no requerido)**

El canal y el segmento son independientes, no se resetean entre sí. No se necesita acción.

- [ ] **Step 7: Verificar compilación**

```bash
npm run build 2>&1 | tail -20
```

Esperado: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/supervisor/SupervisorMensajes.jsx
git commit -m "feat(supervisor): mensajes-broadcast canal selector + canal badge in history"
```

---

## Task 6: Verificación end-to-end

- [ ] **Step 1: Levantar backend y frontend**

```bash
# Terminal 1 — backend
cd backend && node src/index.js

# Terminal 2 — frontend (dev server)
npm run dev
```

- [ ] **Step 2: Verificar flujo Jefe de Área**

1. Iniciar sesión como Jefe de Área.
2. Ir a **Mensajes**.
3. Crear mensaje: segmento `Tramo 0`, canal `WhatsApp`, texto `"WSP T0: Hola {nombre}"`.
4. Crear mensaje: segmento `Tramo 0`, canal `RCS`, texto `"RCS T0: Hola {nombre}"`.
5. Crear mensaje: segmento `TODOS`, canal `Correo`, texto `"CORREO GENERAL: Hola {nombre}"`.
6. Verificar que cada card del historial muestra el badge de canal correspondiente.

- [ ] **Step 3: Verificar flujo Asesor**

1. Iniciar sesión como Asesor.
2. Ir a **Cartera Asignada**.
3. Tomar un contacto con 0 días de mora.
4. Hacer clic en botón **WSP** → WhatsApp/celular debe abrir con texto `"WSP T0: Hola [nombre del contacto]"`.
5. Hacer clic en botón **RCS** → Google Messages debe abrir con texto `"RCS T0: Hola [nombre del contacto]"`.
6. Hacer clic en botón **Correo** → Gmail debe abrir con texto `"CORREO GENERAL: Hola [nombre del contacto]"` (fallback nivel 3: TODOS+CORREO).

- [ ] **Step 4: Verificar retrocompatibilidad**

Confirmar que mensajes creados ANTES de esta feature (con `canal = 'TODOS'` en DB) siguen apareciendo en todos los canales como antes.

- [ ] **Step 5: Ejecutar tests unitarios**

```bash
npx jest tests/unit/mensajes-broadcast-canal.test.js --no-coverage
```

Esperado: `Tests: 9 passed`

- [ ] **Step 6: Commit final si hay cambios pendientes**

```bash
git status
git add -p  # revisar cambios menores
git commit -m "feat: mensajes broadcast canal+segmento — e2e verified"
```

---

## Resumen de prioridad de match (referencia rápida)

```
Dado canal='WSP', segmento='TRAMO_0':

1. segmento_destino='TRAMO_0' AND canal='WSP'    ← match exacto
2. segmento_destino='TRAMO_0' AND canal='TODOS'  ← mismo tramo, cualquier canal
3. segmento_destino='TODOS'   AND canal='WSP'    ← cualquier tramo, canal exacto
4. segmento_destino='TODOS'   AND canal='TODOS'  ← fallback global
→ Si ninguno: retorna ''
```
