# Panel "Actividad Gestores" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nuevo apartado de supervisión en tiempo real en la consola del Jefe de Área: matriz gestores × categoría de tipificación (conteo + tiempo al aire), con desglose por código al clic, ubicado entre Métricas y Compromisos.

**Architecture:** Endpoint agregado nuevo en `backend/src/routes/supervisor.routes.js` (Prisma/PostgreSQL, producción). Componente React nuevo `ActividadGestores.jsx` que hace fetch inicial y refetch con debounce cuando JefePanel recibe el evento WS `TIPIFICACION_REALIZADA` (ya existente). No se toca `wsServer.js` ni el flujo del asesor.

**Tech Stack:** Express + Prisma (PostgreSQL), React (sin framework de tests en el repo — verificación vía curl y UI manual, como el resto del proyecto).

**Spec:** `docs/superpowers/specs/2026-07-10-actividad-gestores-design.md`

**Contexto clave del repo (verificado):**
- Router supervisor montado en `/api` (`backend/src/index.js:37`); todas sus rutas ya pasan `authMiddleware` (línea 14). Helper `isSupervisor(rol)` en línea 16 y `getAsesorIdsDelEquipo(user)` en línea 76 ya existen.
- Patrón de rango de día existente: `timestampInicio: { gte: inicio, lte: fin }` con `setHours(0,0,0,0)` / `setHours(23,59,59,999)`.
- OJO fecha: `new Date('YYYY-MM-DD')` parsea UTC (corre el día en tz local). Usar sufijo `'T00:00:00'` para parseo local.
- Prisma models: `Cdr` (`usuarioId`, `tipificacionId Int?`, `timestampInicio`, `duracionSeg Int @default(0)`), `Tipificacion` (`codigo`, `descripcion`, `categoria String`), `Usuario` (`rol`, `estado`, `supervisorId`).
- Categorías en datos tienen variantes con guion bajo y con espacio → normalizar.
- Frontend: `JefePanel.jsx` tiene `apiBase`/`authToken` (líneas 143-145), handler WS `TIPIFICACION_REALIZADA` (línea 305), estado `estadosWS` para conexión de asesores, y helper module-scope `vmFetch(apiBase, token, path)`.
- Nav: `NAV_ITEMS_SUPERVISOR` en `src/renderer/shared/NavigationDrawer.jsx:16-27`.
- Producción backend = `backend/` con `node src/index.js`. NO tocar `src/main/apiServer.js` (SQLite legacy).

---

### Task 1: Endpoint backend `GET /api/actividad-tipificacion`

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js` (insertar después del endpoint `GET /asesores`, ~línea 99, antes de `GET /metricas/:usuario_id`)

- [ ] **Step 1: Agregar el endpoint**

Insertar entre el cierre de `router.get('/asesores', ...)` y el comentario de `/metricas/:usuario_id`:

```js
// ── GET /api/actividad-tipificacion — Matriz gestores × tipificación (día) ───
// Panel "Actividad Gestores": conteo + tiempo al aire por categoría y por
// código de tipificación, para todos los asesores activos del equipo
// (incluidos los que tienen 0 gestiones ese día).
router.get('/actividad-tipificacion', async (req, res, next) => {
  try {
    if (!isSupervisor(req.user.rol)) {
      return res.status(403).json({ error: 'Acceso denegado' });
    }

    // 'T00:00:00' fuerza parseo en tz local (sin sufijo, Date parsea UTC y corre el día)
    const base = req.query.fecha ? new Date(`${req.query.fecha}T00:00:00`) : new Date();
    if (isNaN(base.getTime())) {
      return res.status(400).json({ error: 'Fecha inválida' });
    }
    const inicio = new Date(base); inicio.setHours(0, 0, 0, 0);
    const fin    = new Date(base); fin.setHours(23, 59, 59, 999);

    const asesorIds = await getAsesorIdsDelEquipo(req.user); // null = admin (todos)
    const usuarioWhere = { estado: 'activo', rol: 'asesor' };
    if (asesorIds) usuarioWhere.id = { in: asesorIds };
    const asesores = await db.usuario.findMany({
      where: usuarioWhere,
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });

    const [grupos, tipifs] = await Promise.all([
      db.cdr.groupBy({
        by: ['usuarioId', 'tipificacionId'],
        where: {
          usuarioId: { in: asesores.map(a => a.id) },
          timestampInicio: { gte: inicio, lte: fin },
          tipificacionId: { not: null },
        },
        _count: { _all: true },
        _sum: { duracionSeg: true },
      }),
      db.tipificacion.findMany({
        select: { id: true, codigo: true, descripcion: true, categoria: true },
      }),
    ]);

    const tipMap = new Map(tipifs.map(t => [t.id, t]));
    const CAT_CANON = {
      'CONTACTO_EFECTIVO': 'CONTACTO EXITOSO',
      'CONTACTO EXITOSO':  'CONTACTO EXITOSO',
      'CONTACTO_NEUTRO':   'CONTACTO NEUTRO',
      'CONTACTO NEUTRO':   'CONTACTO NEUTRO',
      'NO_CONTACTADO':     'NO CONTACTADO',
      'NO CONTACTADO':     'NO CONTACTADO',
    };
    const categoriasVacias = () => ({
      'CONTACTO EXITOSO': { count: 0, tiempo_seg: 0 },
      'CONTACTO NEUTRO':  { count: 0, tiempo_seg: 0 },
      'NO CONTACTADO':    { count: 0, tiempo_seg: 0 },
    });

    const porAsesor = new Map(asesores.map(a => [a.id, {
      asesor_id: a.id,
      nombre: a.nombre,
      categorias: categoriasVacias(),
      detalle: [],
      total_count: 0,
      total_tiempo_seg: 0,
    }]));

    for (const g of grupos) {
      const entry = porAsesor.get(g.usuarioId);
      const tip = tipMap.get(g.tipificacionId);
      if (!entry || !tip) continue;
      const count  = g._count._all;
      const tiempo = Number(g._sum.duracionSeg || 0);
      const cat = CAT_CANON[tip.categoria] || 'NO CONTACTADO';
      entry.categorias[cat].count      += count;
      entry.categorias[cat].tiempo_seg += tiempo;
      entry.detalle.push({
        codigo: tip.codigo,
        descripcion: tip.descripcion,
        categoria: cat,
        count,
        tiempo_seg: tiempo,
      });
      entry.total_count      += count;
      entry.total_tiempo_seg += tiempo;
    }

    const salida = [...porAsesor.values()];
    salida.forEach(a => a.detalle.sort((x, y) => y.count - x.count));

    const y = inicio.getFullYear();
    const m = String(inicio.getMonth() + 1).padStart(2, '0');
    const d = String(inicio.getDate()).padStart(2, '0');
    res.json({ fecha: `${y}-${m}-${d}`, asesores: salida });
  } catch (err) { next(err); }
});
```

Nota: ruta literal, no colisiona con `/metricas/:usuario_id` ni ninguna `/:id` del archivo. `db`, `isSupervisor`, `getAsesorIdsDelEquipo` ya están en scope.

- [ ] **Step 2: Verificar sintaxis**

Run (PowerShell, desde raíz del repo): `node -c` no existe para JS; usar:
```powershell
node -e "require('./backend/src/routes/supervisor.routes.js')"
```
Expected: sin errores de sintaxis (puede fallar por conexión DB/env — aceptable si el error NO es `SyntaxError`).

- [ ] **Step 3: Verificar endpoint contra backend corriendo**

Con el backend de producción corriendo y un token de supervisor válido (obtener vía login o de localStorage de una sesión de jefe):

```powershell
$token = "<TOKEN_SUPERVISOR>"
Invoke-RestMethod -Uri "http://127.0.0.1:3001/api/actividad-tipificacion" -Headers @{ Authorization = "Bearer $token" } | ConvertTo-Json -Depth 6
```

Expected: JSON con `fecha` = hoy y `asesores[]`; cada asesor con `categorias` (3 llaves canónicas), `detalle[]`, `total_count`, `total_tiempo_seg`. Asesores sin gestiones aparecen con ceros.

Validar conteo contra SQL directo (psql o herramienta equivalente):

```sql
SELECT usuario_id, COUNT(*), SUM(duracion_seg)
FROM cdrs
WHERE tipificacion_id IS NOT NULL
  AND timestamp_inicio >= CURRENT_DATE
  AND timestamp_inicio < CURRENT_DATE + INTERVAL '1 day'
GROUP BY usuario_id;
```

Expected: `total_count`/`total_tiempo_seg` por asesor coinciden.

Probar fecha pasada: `...?fecha=2026-07-09` → datos de ese día. Fecha inválida `?fecha=abc` → 400.

- [ ] **Step 4: Commit**

```powershell
git add backend/src/routes/supervisor.routes.js
git commit -m @'
feat(backend): endpoint actividad-tipificacion para panel Actividad Gestores

Matriz asesor x tipificacion (conteo + tiempo al aire) del dia, con
desglose por codigo y categorias normalizadas. Incluye asesores en cero.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Componente `ActividadGestores.jsx`

**Files:**
- Create: `src/renderer/supervisor/ActividadGestores.jsx`

- [ ] **Step 1: Crear el componente completo**

```jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * ActividadGestores – Supervisión en tiempo real de gestores por tipificación.
 * Matriz: fila por gestor, columnas por categoría (Exitoso/Neutro/No Contactado)
 * con conteo + tiempo al aire. Clic en fila → desglose por código.
 *
 * Live solo cuando fecha = hoy: el padre incrementa refreshSignal al recibir
 * TIPIFICACION_REALIZADA por WS y aquí se refetchea con debounce de 2s.
 * Fuente de verdad = DB (endpoint agregado); nunca se acumula en cliente.
 */

const CATEGORIAS = ['CONTACTO EXITOSO', 'CONTACTO NEUTRO', 'NO CONTACTADO'];
const CAT_LABELS = {
  'CONTACTO EXITOSO': 'Contacto Exitoso',
  'CONTACTO NEUTRO':  'Contacto Neutro',
  'NO CONTACTADO':    'No Contactado',
};
const CAT_COLORS = {
  'CONTACTO EXITOSO': '#22c55e',
  'CONTACTO NEUTRO':  '#eab308',
  'NO CONTACTADO':    '#94a3b8',
};

function hoyStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTiempo(seg) {
  if (!seg) return '0s';
  if (seg < 60) return `${seg}s`;
  const m = Math.floor(seg / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function ActividadGestores({ apiBase, authToken, refreshSignal, estadosWS }) {
  const [fecha, setFecha] = useState(hoyStr());
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [detalleAsesor, setDetalleAsesor] = useState(null); // asesor seleccionado para modal
  const fechaRef = useRef(fecha);
  fechaRef.current = fecha;

  const esHoy = fecha === hoyStr();

  const cargar = useCallback(async (f) => {
    if (!apiBase) return;
    setCargando(true);
    try {
      const res = await fetch(`${apiBase}/actividad-tipificacion?fecha=${f}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Evitar pisar datos si el usuario cambió de fecha mientras cargaba
      if (fechaRef.current === f) {
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

  // Carga inicial y al cambiar fecha
  useEffect(() => { cargar(fecha); }, [fecha, cargar]);

  // Refetch live con debounce 2s — solo si la fecha visible es hoy
  useEffect(() => {
    if (!refreshSignal || !esHoy) return;
    const t = setTimeout(() => cargar(fechaRef.current), 2000);
    return () => clearTimeout(t);
  }, [refreshSignal, esHoy, cargar]);

  if (!apiBase) {
    return (
      <div style={{ padding: 24, opacity: 0.6 }}>
        Panel disponible solo en modo remoto (servidor VM).
      </div>
    );
  }

  const asesores = [...(data?.asesores || [])].sort((a, b) => b.total_count - a.total_count);
  const hayDatos = asesores.some(a => a.total_count > 0);

  const celda = (c) => (
    <span>
      <strong>{c.count}</strong>
      <span style={{ opacity: 0.55, fontSize: 12 }}> · {fmtTiempo(c.tiempo_seg)}</span>
    </span>
  );

  return (
    <div style={{ padding: '16px 8px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Actividad Gestores</h2>
        {esHoy && (
          <span style={{
            background: 'rgba(34,197,94,0.15)', color: '#22c55e',
            padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
            EN VIVO
          </span>
        )}
        <input
          type="date"
          value={fecha}
          max={hoyStr()}
          onChange={e => { if (e.target.value) setFecha(e.target.value); }}
          style={{ marginLeft: 'auto', padding: '4px 8px', borderRadius: 6 }}
        />
        {cargando && <span style={{ fontSize: 12, opacity: 0.5 }}>Actualizando…</span>}
        {error && <span style={{ fontSize: 12, color: '#f59e0b' }}>{error}</span>}
      </div>

      {/* Matriz */}
      <div className="stats-table">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 12, opacity: 0.7 }}>
              <th style={{ padding: '8px 12px' }}>Gestor</th>
              {CATEGORIAS.map(cat => (
                <th key={cat} style={{ padding: '8px 12px', color: CAT_COLORS[cat] }}>
                  {CAT_LABELS[cat]}
                </th>
              ))}
              <th style={{ padding: '8px 12px' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {asesores.map(a => {
              const conectado = !!(estadosWS && estadosWS[a.asesor_id]);
              return (
                <tr
                  key={a.asesor_id}
                  onClick={() => setDetalleAsesor(a)}
                  style={{ cursor: 'pointer', borderTop: '1px solid rgba(255,255,255,0.06)' }}
                  title="Ver desglose por tipificación"
                >
                  <td style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: conectado ? '#22c55e' : '#64748b',
                      flexShrink: 0,
                    }} />
                    {a.nombre}
                  </td>
                  {CATEGORIAS.map(cat => (
                    <td key={cat} style={{ padding: '10px 12px' }}>
                      {celda(a.categorias[cat] || { count: 0, tiempo_seg: 0 })}
                    </td>
                  ))}
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                    {a.total_count}
                    <span style={{ opacity: 0.55, fontSize: 12, fontWeight: 400 }}> · {fmtTiempo(a.total_tiempo_seg)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && !hayDatos && (
          <div style={{ padding: 24, textAlign: 'center', opacity: 0.5 }}>
            Sin gestiones tipificadas el {data.fecha}.
          </div>
        )}
      </div>

      {/* Modal desglose por código */}
      {detalleAsesor && (
        <div
          onClick={() => setDetalleAsesor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--surface, #1e1e2e)', borderRadius: 12,
              padding: 20, minWidth: 480, maxHeight: '80vh', overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>
                {detalleAsesor.nombre} — desglose por tipificación
              </h3>
              <button
                type="button"
                onClick={() => setDetalleAsesor(null)}
                style={{ background: 'none', border: 'none', color: 'inherit', fontSize: 18, cursor: 'pointer' }}
              >✕</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', opacity: 0.7, fontSize: 12 }}>
                  <th style={{ padding: '6px 10px' }}>Código</th>
                  <th style={{ padding: '6px 10px' }}>Descripción</th>
                  <th style={{ padding: '6px 10px' }}>Categoría</th>
                  <th style={{ padding: '6px 10px' }}>Gestiones</th>
                  <th style={{ padding: '6px 10px' }}>Tiempo</th>
                </tr>
              </thead>
              <tbody>
                {detalleAsesor.detalle.map(d => (
                  <tr key={d.codigo} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{d.codigo}</td>
                    <td style={{ padding: '8px 10px' }}>{d.descripcion}</td>
                    <td style={{ padding: '8px 10px', color: CAT_COLORS[d.categoria] || 'inherit', fontSize: 12 }}>
                      {CAT_LABELS[d.categoria] || d.categoria}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{d.count}</td>
                    <td style={{ padding: '8px 10px' }}>{fmtTiempo(d.tiempo_seg)}</td>
                  </tr>
                ))}
                {detalleAsesor.detalle.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', opacity: 0.5 }}>
                    Sin gestiones tipificadas.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

Cuidado: comillas rectas ASCII en todo el JSX — nunca comillas tipográficas U+201C/U+201D (rompen Babel).

- [ ] **Step 2: Commit**

```powershell
git add src/renderer/supervisor/ActividadGestores.jsx
git commit -m @'
feat(supervisor): componente ActividadGestores (matriz por tipificacion)

Tabla gestor x categoria con conteo + tiempo al aire, badge EN VIVO,
selector de fecha, modal de desglose por codigo e indicador de conexion.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: Navegación + integración en JefePanel

**Files:**
- Modify: `src/renderer/shared/NavigationDrawer.jsx:21-22` (insertar item)
- Modify: `src/renderer/supervisor/JefePanel.jsx` (import, estado, handler WS, render)

- [ ] **Step 1: Item de navegación**

En `NAV_ITEMS_SUPERVISOR`, entre `metricas` y `compromisos`:

```js
  { id: 'metricas',    icon: 'analytics',     label: 'Métricas' },
  { id: 'actividad',   icon: 'monitor_heart', label: 'Actividad Gestores' },
  { id: 'compromisos', icon: 'handshake',     label: 'Compromisos' },
```

- [ ] **Step 2: Import en JefePanel**

Junto a los demás imports de componentes supervisor (cerca de la línea 29 donde está `import Compromisos from './Compromisos';`):

```js
import ActividadGestores from './ActividadGestores';
```

- [ ] **Step 3: Estado de refresh**

Junto a los demás `useState` del componente (buscar `setDashDirectivoRefresh` para ubicar la zona de estados):

```js
const [actividadRefresh, setActividadRefresh] = useState(0);
```

- [ ] **Step 4: Incrementar en el handler WS existente**

En `socket.onmessage`, bloque `TIPIFICACION_REALIZADA` (línea ~305), agregar UNA línea sin tocar lo demás:

```js
        if (msg.tipo === 'TIPIFICACION_REALIZADA') {
          agregarEvento('LLAMADA_TIPIFICADA', `${msg.nombre} tipificó contacto como: ${msg.tipificacion}`);
          showToast(`Nueva tipificación de ${msg.nombre}`, 'info');
          setActividadRefresh(p => p + 1);
        }
```

- [ ] **Step 5: Render de la tab**

En el bloque "TABS LIVIANAS" (línea ~1603), antes de `{activePage === 'compromisos' && (`:

```jsx
          {activePage === 'actividad' && (
            <ActividadGestores
              apiBase={apiBase}
              authToken={authToken}
              refreshSignal={actividadRefresh}
              estadosWS={estadosWS}
            />
          )}
```

Nota: `estadosWS` es el estado existente de JefePanel poblado por `SNAPSHOT_ESTADOS`/`ESTADO_ASESOR`/`ASESOR_DESCONECTADO`. Tab liviana: mount/unmount normal, sin charts.

- [ ] **Step 6: Verificar build del renderer**

Run: `npm run build` (o el script de build de vite del proyecto — revisar `package.json`; si el dev server ya corre con HMR, basta verificar que compila sin errores en consola).
Expected: sin errores de compilación/Babel.

- [ ] **Step 7: Commit**

```powershell
git add src/renderer/shared/NavigationDrawer.jsx src/renderer/supervisor/JefePanel.jsx
git commit -m @'
feat(supervisor): tab Actividad Gestores entre Metricas y Compromisos

Item de navegacion nuevo + integracion en JefePanel: refetch live via
contador incrementado en TIPIFICACION_REALIZADA (debounce en componente).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: Verificación end-to-end

**Files:** ninguno (solo verificación manual).

- [ ] **Step 1: Reiniciar backend de producción**

Reiniciar el proceso `node src/index.js` en `backend/` para cargar el endpoint nuevo (regla del proyecto: editar path correcto + reiniciar proceso).

- [ ] **Step 2: Flujo en vivo**

1. Login como jefe de área → abrir "Actividad Gestores" (debe aparecer entre Métricas y Compromisos).
2. Verificar matriz con asesores del equipo, badge EN VIVO, punto verde en conectados.
3. Desde un panel de asesor, tipificar una llamada.
4. Expected: matriz se actualiza sola en ≤ ~3 s (2 s debounce + fetch) sin recargar.
5. Clic en fila → modal con desglose por código, cifras coherentes con las celdas.

- [ ] **Step 3: Fecha pasada**

Seleccionar día anterior: badge EN VIVO desaparece, datos del día correcto, y una tipificación en vivo NO dispara refetch (verificar en Network tab).

- [ ] **Step 4: Casos borde**

- Gestor sin gestiones → fila en ceros presente.
- Backend caído → aviso "Sin conexión — mostrando últimos datos", tabla conserva datos previos.
- Fecha sin datos → mensaje vacío.

- [ ] **Step 5: Confirmar con el usuario antes de cerrar la rama/push**
