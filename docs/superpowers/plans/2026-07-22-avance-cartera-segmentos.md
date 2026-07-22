# Avance Cartera por Segmentos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir el cálculo de avance de cartera y agregar desglose por segmentos (S0/S1/S2) con selector de campaña.

**Architecture:** Se extiende el endpoint `/api/actividad-tipificacion` con parámetro `campanaId` y un campo `avance_global` con desglose por segmento. El componente `ActividadGestores` recibe el selector de campaña en su header y expande la card AVANCE CARTERA con 3 mini-barras de segmento.

**Tech Stack:** Node.js/Express, Prisma, PostgreSQL (raw queries), React, CSS tokens existentes.

---

## Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `backend/src/routes/supervisor.routes.js` | Agregar `campanaId` filter + query segmentos en `/actividad-tipificacion` |
| `src/renderer/supervisor/ActividadGestores.jsx` | Selector campaña + avance_global en card AVANCE + rediseño card LLAMADAS |

---

### Task 1: Backend — filtrar avance por campaña y agregar segmentos

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js:118-218`

**Root cause del bug:** En línea 158-163, `total_asignados` y `gestionados` se calculan sobre **todos** los contactos asignados al asesor, sin filtro de campaña. Al asignar nueva cartera, los contactos nuevos (PENDIENTE) suman al total pero los gestionados históricos de campañas anteriores persisten → ratio siempre ~49%.

- [ ] **Step 1: Agregar extracción de `campanaId` y construir el avance con filtro de campaña**

En `backend/src/routes/supervisor.routes.js`, localizar la línea `router.get('/actividad-tipificacion', async (req, res, next) => {` (línea 122) y modificar la sección de `avanceRows` (líneas 158-163):

```javascript
// Después de línea 132 (_gyeDayBounds), agregar:
const campanaId = req.query.campanaId ? parseInt(req.query.campanaId) : null;
```

Luego reemplazar el `Promise.all` de `avanceRows` (líneas 158-163) con:

```javascript
Promise.all(asesorIdList.map(id => {
  const baseWhere = campanaId
    ? { asignadoA: id, campanaId }
    : { asignadoA: id };
  return Promise.all([
    db.contacto.count({ where: baseWhere }),
    db.contacto.count({ where: { ...baseWhere, estadoMarcacion: { in: ['GESTIONADO', 'YA_PAGO'] } } }),
  ]).then(([asignados, gestionados]) => ({ id, asignados, gestionados }));
})),
```

- [ ] **Step 2: Agregar query de desglose por segmento**

En el mismo `Promise.all` de `[grupos, tipifs, avanceRows]` (línea 144), agregar un cuarto elemento `segRows`:

```javascript
const [grupos, tipifs, avanceRows, segRows] = await Promise.all([
  // ... los tres existentes ...
  (() => {
    if (asesorIdList.length === 0) return Promise.resolve([]);
    const campFiltro = campanaId
      ? Prisma.sql`AND campana_id = ${campanaId}`
      : Prisma.sql``;
    const idsJoin = Prisma.join(asesorIdList.map(id => Prisma.sql`${id}`));
    return db.$queryRaw(Prisma.sql`
      SELECT
        COALESCE(metadata->>'segmento', metadata->>'SEGMENTO', 'sin_seg') AS seg,
        COUNT(*)::int                                                       AS total,
        COUNT(CASE WHEN estado_marcacion IN ('GESTIONADO','YA_PAGO') THEN 1 END)::int AS gestionados
      FROM contactos
      WHERE asignado_a IN (${idsJoin})
        ${campFiltro}
      GROUP BY COALESCE(metadata->>'segmento', metadata->>'SEGMENTO', 'sin_seg')
    `);
  })(),
]);
```

- [ ] **Step 3: Calcular avance_global y estructurar segmentos en la respuesta**

Antes de `res.json(...)` (línea 213), agregar:

```javascript
// Calcular totales globales del equipo
const avanceArr = [...avanceMap.values()];
const globalTotal      = avanceArr.reduce((s, x) => s + x.asignados,   0);
const globalGestionados = avanceArr.reduce((s, x) => s + x.gestionados, 0);

// Estructurar segmentos
const SEG_VALIDOS = ['0', '1', '2'];
const segmentos = {};
for (const row of segRows) {
  const seg = String(row.seg ?? '').trim();
  if (!SEG_VALIDOS.includes(seg)) continue;
  const total      = Number(row.total);
  const gestionados = Number(row.gestionados);
  segmentos[seg] = { total, gestionados, pct: total > 0 ? Math.round((gestionados / total) * 10000) / 100 : 0 };
}

const avance_global = {
  total:      globalTotal,
  gestionados: globalGestionados,
  pct:        globalTotal > 0 ? Math.round((globalGestionados / globalTotal) * 10000) / 100 : 0,
  segmentos,
};
```

Luego cambiar `res.json(...)` a:

```javascript
res.json({ fecha: _gyeDayBounds(req.query.fecha).ymd, asesores: salida, avance_global });
```

- [ ] **Step 4: Verificar manualmente con curl (no reiniciar aún)**

```bash
# Verificar que el archivo tiene los cambios correctos
grep -n "campanaId\|avance_global\|segmentos\|segRows" backend/src/routes/supervisor.routes.js
```

Resultado esperado: líneas con `campanaId`, `avance_global`, `segmentos`, `segRows` presentes.

---

### Task 2: Frontend — selector de campaña en ActividadGestores

**Files:**
- Modify: `src/renderer/supervisor/ActividadGestores.jsx:56-97`

- [ ] **Step 1: Agregar estado `campanaId` y `campanas`, y props para recibirlas**

En la firma del componente (línea 56), agregar prop `campanas`:

```javascript
export default function ActividadGestores({ apiBase, authToken, refreshSignal, estadosWS, metricasCanales, campanas = [] }) {
```

Dentro del componente (después de `const [error, setError] = useState(null);`), agregar:

```javascript
const [campanaId, setCampanaId] = useState('');
const campanaIdRef = useRef(campanaId);
campanaIdRef.current = campanaId;
```

- [ ] **Step 2: Pasar `campanaId` al fetch**

Reemplazar la función `cargar` (líneas 67-87):

```javascript
const cargar = useCallback(async (f, cid) => {
  if (!apiBase) return;
  setCargando(true);
  try {
    const qs = new URLSearchParams({ fecha: f });
    if (cid) qs.set('campanaId', cid);
    const res = await fetch(`${apiBase}/actividad-tipificacion?${qs}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (fechaRef.current === f && campanaIdRef.current === cid) {
      setData(json);
      setError(null);
    }
  } catch (err) {
    console.error('[ActividadGestores] Error cargando:', err);
    setError('Sin conexión — mostrando últimos datos');
  } finally {
    setCargando(false);
  }
}, [apiBase, authToken]);
```

- [ ] **Step 3: Actualizar los useEffect para pasar campanaId**

Reemplazar los dos useEffect (líneas 90-97):

```javascript
useEffect(() => { cargar(fecha, campanaId); }, [fecha, campanaId, cargar]);

useEffect(() => {
  if (!refreshSignal || !esHoy) return;
  const t = setTimeout(() => cargar(fechaRef.current, campanaIdRef.current), 2000);
  return () => clearTimeout(t);
}, [refreshSignal, esHoy, cargar]);
```

- [ ] **Step 4: Agregar el selector de campaña en el header**

En el bloque del header (dentro de `<div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)'...}}`), añadir el selector ANTES del `<input type="date">`:

```jsx
<select
  className="input"
  value={campanaId}
  onChange={e => setCampanaId(e.target.value)}
  style={{ marginLeft: 'auto', width: 'auto', padding: '10px 14px', fontSize: 13 }}
>
  <option value="">Todas las campañas</option>
  {[...campanas]
    .sort((a, b) => new Date(b.fechaInicio || b.createdAt || 0) - new Date(a.fechaInicio || a.createdAt || 0))
    .map(c => (
      <option key={c.id} value={c.id}>{c.nombre}</option>
    ))
  }
</select>
```

Y quitar el `marginLeft: 'auto'` del `<input type="date">` ya que ahora el select ocupa ese rol:

```jsx
<input
  type="date"
  className="input"
  value={fecha}
  max={hoyStr()}
  onChange={e => { if (e.target.value) setFecha(e.target.value); }}
  style={{ width: 'auto', padding: '10px 14px', fontSize: 13 }}
/>
```

---

### Task 3: Frontend — expandir card AVANCE CARTERA con segmentos

**Files:**
- Modify: `src/renderer/supervisor/ActividadGestores.jsx` (sección cards resumen ~línea 198)

- [ ] **Step 1: Reemplazar la card AVANCE CARTERA con versión expandida**

Localizar la card de Avance Cartera (líneas 213-226) y reemplazarla completa:

```jsx
<div className="card" style={{ padding: 'var(--space-md) var(--space-lg)', borderLeft: '3px solid #00e676' }}>
  <div className="text-label" style={{ color: '#00e676', display: 'flex', alignItems: 'center', gap: 6 }}>
    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>trending_up</span>
    Avance Cartera {campanaId ? '' : '(global)'}
  </div>
  {/* Barra global */}
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
    <span className="text-mono" style={{ fontSize: 26, fontWeight: 800, color: '#00e676' }}>
      {(data?.avance_global?.gestionados ?? totalGestionados).toLocaleString()}
    </span>
    <span style={{ fontSize: 12, opacity: 0.6 }}>
      / {(data?.avance_global?.total ?? totalAsignados).toLocaleString()}
    </span>
    <span style={{ fontSize: 14, fontWeight: 700, color: '#00e676' }}>
      {data?.avance_global?.pct ?? pctAvanceEquipo}%
    </span>
  </div>
  <div style={{ marginTop: 6, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
    <div style={{
      height: '100%',
      width: `${Math.min(data?.avance_global?.pct ?? pctAvanceEquipo, 100)}%`,
      background: '#00e676', borderRadius: 99, transition: 'width 0.4s ease',
    }} />
  </div>
  {/* Barras por segmento */}
  {data?.avance_global?.segmentos && (() => {
    const SEG_COLORS = { '0': '#00E5FF', '1': '#FFD740', '2': '#F50057' };
    const SEG_LABELS = { '0': 'S0', '1': 'S1', '2': 'S2' };
    return ['0', '1', '2'].map(seg => {
      const s = data.avance_global.segmentos[seg];
      if (!s || s.total === 0) return null;
      return (
        <div key={seg} style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
            <span style={{ opacity: 0.65 }}>
              {SEG_LABELS[seg]} — {s.gestionados.toLocaleString()} / {s.total.toLocaleString()}
            </span>
            <span style={{ color: SEG_COLORS[seg], fontWeight: 700 }}>{s.pct}%</span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.min(s.pct, 100)}%`,
              background: SEG_COLORS[seg], borderRadius: 99, transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      );
    });
  })()}
</div>
```

---

### Task 4: Frontend — rediseño card LLAMADAS TIPIFICADAS HOY

**Files:**
- Modify: `src/renderer/supervisor/ActividadGestores.jsx` (card 1 ~línea 199)

- [ ] **Step 1: Agregar borderLeft e icono a la card LLAMADAS**

Localizar la primera card del bento-grid (línea 199):
```jsx
<div className="card" style={{ padding: 'var(--space-md) var(--space-lg)' }}>
  <div className="text-label" style={{ color: 'var(--color-on-surface-variant)', opacity: 0.7 }}>
    Llamadas tipificadas hoy
  </div>
```

Reemplazar con:
```jsx
<div className="card" style={{ padding: 'var(--space-md) var(--space-lg)', borderLeft: '3px solid #00E5FF' }}>
  <div className="text-label" style={{ color: '#00E5FF', display: 'flex', alignItems: 'center', gap: 6 }}>
    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>call</span>
    Llamadas tipificadas hoy
  </div>
```

---

### Task 5: Pasar prop `campanas` al componente desde el padre

**Files:**
- Modify: buscar dónde se usa `<ActividadGestores` en el codebase

- [ ] **Step 1: Localizar el padre de ActividadGestores**

```bash
grep -rn "ActividadGestores" src/renderer --include="*.jsx" --include="*.js"
```

- [ ] **Step 2: Pasar la prop campanas**

En el componente padre donde se renderiza `<ActividadGestores`, agregar la prop `campanas`:

```jsx
<ActividadGestores
  apiBase={apiBase}
  authToken={authToken}
  refreshSignal={refreshSignal}
  estadosWS={estadosWS}
  metricasCanales={metricasCanales}
  campanas={campanas}   {/* ← agregar: array de campañas ya cargado en el padre */}
/>
```

Si el padre no tiene `campanas` en estado, agregar el fetch (igual al que ya existe en `DashboardDirectivo.jsx:127-134`):

```javascript
const [campanas, setCampanas] = useState([]);
useEffect(() => {
  if (!apiBase) return;
  fetch(`${apiBase}/campanas`, { headers: { Authorization: `Bearer ${authToken}` } })
    .then(r => r.ok ? r.json() : [])
    .then(data => setCampanas(Array.isArray(data) ? data : []))
    .catch(() => {});
}, [apiBase, authToken]);
```

---

### Task 6: Reiniciar backend y verificar

**IMPORTANTE: Ejecutar este task solo cuando el usuario lo autorice.**

- [ ] **Step 1: Reiniciar el proceso backend (cuando el usuario lo autorice)**

```bash
# El usuario debe ejecutar esto en su terminal donde corre el backend:
# Ctrl+C para detener, luego:
node src/index.js
```

- [ ] **Step 2: Probar endpoint con campaña específica**

```bash
# Reemplazar TOKEN y CAMPANA_ID con valores reales
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:3001/api/actividad-tipificacion?fecha=2026-07-22&campanaId=CAMPANA_ID" | \
  python -m json.tool | grep -A 20 "avance_global"
```

Resultado esperado: `avance_global` con `total`, `gestionados`, `pct`, y `segmentos` con keys `"0"`, `"1"`, `"2"`.

- [ ] **Step 3: Verificar en el panel**

1. Abrir ActividadGestores en la app
2. Sin campaña seleccionada → "Todas las campañas" → avance global histórico
3. Seleccionar campaña nueva → avance debe mostrar 0% o valor real de esa campaña
4. Las 3 barras de segmento S0/S1/S2 deben aparecer si los contactos tienen campo `segmento` en metadata

---

## Notas de implementación

- El campo `segmento` en metadata puede venir como `'segmento'` o `'SEGMENTO'` según el Excel. El `COALESCE` en SQL los cubre.
- Si los contactos no tienen campo `segmento` en metadata, las barras de segmento no aparecen (condición `s.total === 0` las oculta). Esto es correcto.
- No reiniciar el backend hasta que el usuario lo autorice (Task 6).
- El `campanaIdRef` es necesario para evitar race conditions cuando el usuario cambia campaña mientras hay un fetch en vuelo.
