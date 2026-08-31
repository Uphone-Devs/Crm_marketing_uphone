# Ranking Líderes por Apertura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en el AsesorPanel dos tarjetas con el líder actual en monto recaudado y en unidades (ya_pago count) para la apertura activa, actualizándose cada vez que llega un `PAGO_VALIDADO` por WS.

**Architecture:** Nuevo endpoint REST `GET /api/ranking-apertura/:campanaId` en `supervisor.routes.js` que agrega datos desde `cdrs` y `contactos`. Nuevo componente `RankingLideres.jsx` en el AsesorPanel que fetchea al montar y al recibir `PAGO_VALIDADO` via WS (ya escuchado en AsesorPanel línea 1009).

**Tech Stack:** Express + Prisma raw SQL (PostgreSQL), React + useState/useEffect, CSS existente del proyecto.

---

## File Map

| Acción | Archivo | Qué cambia |
|--------|---------|------------|
| Modify | `backend/src/routes/supervisor.routes.js` | Agregar endpoint `GET /api/ranking-apertura/:campanaId` |
| Create | `src/renderer/asesor/RankingLideres.jsx` | Componente con dos tarjetas líder |
| Modify | `src/renderer/asesor/AsesorPanel.jsx` | Import + render + trigger re-fetch en PAGO_VALIDADO |

---

## Task 1: Endpoint backend `GET /api/ranking-apertura/:campanaId`

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js` (agregar al final antes del `module.exports`)

- [ ] **Step 1: Agregar el endpoint al final de supervisor.routes.js, antes del `module.exports`**

Buscar la línea con `module.exports = router;` al final del archivo y agregar ANTES de ella:

```js
// ── GET /api/ranking-apertura/:campanaId — Líder recaudado y unidades del día ──
router.get('/ranking-apertura/:campanaId', async (req, res, next) => {
  try {
    const campanaId = parseInt(req.params.campanaId, 10);
    if (!campanaId || isNaN(campanaId)) return res.status(400).json({ error: 'campanaId inválido' });

    // Líder en monto recaudado: suma de cdrs.monto_acordado con resultado PAGO_REAL o COMP_CUM
    const recaudadoRows = await db.$queryRaw`
      SELECT u.nombre, SUM(cd.monto_acordado)::float AS monto
      FROM cdrs cd
      JOIN contactos c ON c.id = cd.contacto_id
      JOIN usuarios u ON u.id = cd.usuario_id
      WHERE c.campana_id = ${campanaId}
        AND cd.resultado IN ('PAGO_REAL', 'COMP_CUM')
        AND cd.monto_acordado IS NOT NULL
        AND cd.monto_acordado > 0
      GROUP BY u.id, u.nombre
      ORDER BY monto DESC
      LIMIT 1
    `;

    // Líder en unidades: count de contactos con ya_pago=true por asesor asignado
    const unidadesRows = await db.$queryRaw`
      SELECT u.nombre, COUNT(*)::int AS count
      FROM contactos c
      JOIN usuarios u ON u.id = c.asignado_a
      WHERE c.campana_id = ${campanaId}
        AND c.ya_pago = true
      GROUP BY u.id, u.nombre
      ORDER BY count DESC
      LIMIT 1
    `;

    res.json({
      recaudado: recaudadoRows[0]
        ? { nombre: recaudadoRows[0].nombre, monto: Number(recaudadoRows[0].monto) }
        : null,
      unidades: unidadesRows[0]
        ? { nombre: unidadesRows[0].nombre, count: Number(unidadesRows[0].count) }
        : null,
    });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Verificar endpoint manualmente en la VM**

```powershell
# Reemplaza <campanaId> con un ID real de apertura activa
Invoke-WebRequest "http://localhost:3002/api/ranking-apertura/1" -UseBasicParsing -Headers @{ Authorization = "Bearer <token>" }
```

Respuesta esperada: `{"recaudado":{"nombre":"APELLIDO NOMBRE","monto":1500},"unidades":{"nombre":"APELLIDO NOMBRE","count":3}}` o con `null` si no hay datos.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/supervisor.routes.js
git commit -m "feat(api): add ranking-apertura endpoint — top recaudado and unidades"
```

---

## Task 2: Componente `RankingLideres.jsx`

**Files:**
- Create: `src/renderer/asesor/RankingLideres.jsx`

- [ ] **Step 1: Crear el archivo**

```jsx
import { useState, useEffect, useCallback } from 'react';

/**
 * Muestra el líder en monto recaudado y en unidades (ya_pago)
 * para la apertura activa. Se re-fetches externamente via refreshSignal.
 */
export default function RankingLideres({ campanaId, callApi, refreshSignal }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!campanaId) return;
    setLoading(true);
    try {
      const result = await callApi('db:query', `ranking-apertura/${campanaId}`);
      setData(result);
    } catch {
      // silencio — no romper el panel si falla
    } finally {
      setLoading(false);
    }
  }, [campanaId, callApi]);

  useEffect(() => { fetch(); }, [fetch, refreshSignal]);

  if (!campanaId) return null;

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '10px 0',
    }}>
      <LiderCard
        titulo="🥇 Mayor Recaudo"
        nombre={data?.recaudado?.nombre}
        valor={data?.recaudado?.monto != null
          ? `$${Number(data.recaudado.monto).toLocaleString('es-EC', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
          : null}
        loading={loading}
      />
      <LiderCard
        titulo="🥇 Mayor Unidades"
        nombre={data?.unidades?.nombre}
        valor={data?.unidades?.count != null
          ? `${data.unidades.count} pago${data.unidades.count !== 1 ? 's' : ''}`
          : null}
        loading={loading}
      />
    </div>
  );
}

function LiderCard({ titulo, nombre, valor, loading }) {
  return (
    <div style={{
      flex: 1,
      background: 'var(--color-surface, #1e1e2e)',
      border: '1px solid var(--color-border, #2a2a3e)',
      borderRadius: 8,
      padding: '10px 14px',
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, opacity: 0.5, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
        {titulo}
      </div>
      {loading ? (
        <div style={{ fontSize: 12, opacity: 0.4 }}>...</div>
      ) : nombre ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-primary, #7c6af7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {nombre}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', marginTop: 2 }}>
            {valor}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.3 }}>Sin datos</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Confirmar que `callApi` usa `db:getRankingApertura`**

El componente llama `callApi('db:getRankingApertura', campanaId)`. Ese case se agrega en Task 3 Step 2. No hay nada que cambiar aquí — solo recordar que el case debe existir antes de probar.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/asesor/RankingLideres.jsx
git commit -m "feat(ui): add RankingLideres component for top recaudado and unidades"
```

---

## Task 3: Integrar `RankingLideres` en `AsesorPanel.jsx`

**Files:**
- Modify: `src/renderer/asesor/AsesorPanel.jsx`

- [ ] **Step 1: Agregar case `db:getRankingApertura` al switch de `callApi` en `AsesorPanel.jsx`**

Buscar la línea `case 'db:getRankingGeneralAsesores':` (línea ~557) y agregar DESPUÉS:

```jsx
case 'db:getRankingApertura':
  url = `${apiBase}/ranking-apertura/${args[0]}`;
  break;
```

- [ ] **Step 2: Agregar import al inicio del archivo (junto a los otros imports de asesor)**

En la línea donde están los imports de `DashboardProductividad` e `IndicadoresPanel` (líneas ~13-14), agregar:

```jsx
import RankingLideres from './RankingLideres';
```

- [ ] **Step 2: Agregar estado `rankingRefresh`**

Cerca de la línea 201 donde están los otros `useState`, agregar:

```jsx
const [rankingRefresh, setRankingRefresh] = useState(0);
```

- [ ] **Step 3: Disparar refresh en `PAGO_VALIDADO`**

En el bloque `if (msg.tipo === 'PAGO_VALIDADO')` (línea ~1009), agregar UNA línea al final del bloque:

```jsx
if (msg.tipo === 'PAGO_VALIDADO') {
  // ... código existente ...
  fetchMetricasRef.current?.();
  setDashRefreshTrigger(p => p + 1);
  setCompromisoRefresh(p => p + 1);
  setRankingRefresh(p => p + 1);   // ← agregar esta línea
}
```

- [ ] **Step 4: Renderizar `RankingLideres` en el dashboard**

En la zona del dashboard (alrededor de línea 4197), dentro del `activePage === 'dashboard'`, ANTES del `<DashboardProductividad`:

```jsx
{!contactoActual && campana?.id && (
  <RankingLideres
    campanaId={campana.id}
    callApi={callApi}
    refreshSignal={rankingRefresh}
  />
)}
<DashboardProductividad
  {/* ... props existentes ... */}
/>
```

- [ ] **Step 5: Verificar que el componente aparece en pantalla**

Arrancar el renderer en dev, hacer login como asesor con apertura activa. Confirmar que aparecen las dos tarjetas debajo de la barra de métricas.

- [ ] **Step 6: Verificar que el callApi routing es correcto**

Abrir DevTools → Network, confirmar que se hace un request a `/api/ranking-apertura/<campanaId>` y retorna 200.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/asesor/AsesorPanel.jsx
git commit -m "feat(asesor): integrate RankingLideres — refresh on PAGO_VALIDADO"
```

---

## Task 4: Deploy a VM

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Pull y restart en la VM**

```powershell
cd F:\crm-backend\app
git pull
pm2 restart crm-backend
```

- [ ] **Step 3: Verificar endpoint en VM**

```powershell
Invoke-WebRequest "http://localhost:3002/api/ranking-apertura/1" -UseBasicParsing
```

Esperar 200. Si falla con 404, verificar que el `git pull` incluyó el nuevo endpoint.

- [ ] **Step 4: Build y distribuir nuevo cliente Electron si hay cambios de renderer**

```bash
npm run build
```

Subir nuevo `.exe`, `.blockmap`, `latest.yml` a `F:\crm-backend\app\backend\updates\` en la VM.
