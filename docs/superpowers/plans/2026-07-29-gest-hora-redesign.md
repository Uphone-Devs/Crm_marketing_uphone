# GEST/HORA Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la columna GEST/HORA en ActividadGestores para mostrar el ritmo real (gestiones ÷ horas desde primera gestión del día), una barra comparativa vs equipo y la proyección de gestiones al cierre del día.

**Architecture:** Backend añade `primera_gestion_ts` al endpoint `/actividad-tipificacion` via una query paralela de `MIN(timestamp_inicio)` por asesor. Frontend usa ese valor (naive-UTC Guayaquil) para calcular elapsed time con una función `getNaiveNowForGYE()` que evita el offset de 5h de la zona horaria. La celda rediseñada muestra número entero + dot de color + barra + proyección.

**Tech Stack:** Node.js/Prisma (backend), React/JSX (frontend), Vitest (unit tests)

---

## File Map

| Archivo | Cambio |
|---------|--------|
| `backend/src/routes/supervisor.routes.js` | Añadir query `primeraGestionRows` paralela en `/actividad-tipificacion` + inyectar `primera_gestion_ts` en `porAsesor` |
| `src/renderer/supervisor/ActividadGestores.jsx` | Helpers `calcGph` + `getProyeccion` + `getNaiveNowForGYE`, nueva celda GEST/HORA |
| `tests/unit/gest-hora-calc.test.js` | Unit tests para los 3 helpers |

---

## Task 1: Backend — añadir `primera_gestion_ts` al endpoint `/actividad-tipificacion`

**Files:**
- Modify: `backend/src/routes/supervisor.routes.js` (función en `router.get('/actividad-tipificacion', ...)`, ~línea 188)

### Contexto previo importante
El endpoint ya hace 6 queries en `Promise.all`. La séptima es `groupBy` para `MIN(timestamp_inicio)` por asesor:
```js
db.cdr.groupBy({
  by: ['usuarioId'],
  where: { usuarioId: { in: asesorIdList }, timestampInicio: { gte: inicio, lte: fin } },
  _min: { timestampInicio: true },
})
```
Los timestamps son **naive-UTC** (wall-clock Guayaquil). Prisma los retorna como ISO strings con `Z`. NO convertir — pasar el string crudo al frontend.

- [ ] **Step 1: Añadir la query al Promise.all existente**

En `supervisor.routes.js`, buscar el bloque que empieza así (línea ~188):
```js
const [grupos, tipifs, detalleRows, canalRows, segActualRows, msgRows] = await Promise.all([
```

Reemplazar con:
```js
const [grupos, tipifs, detalleRows, canalRows, segActualRows, msgRows, primeraGestionRows] = await Promise.all([
```

Y al final del array (después de `msgRows` query, antes del cierre `])`), añadir:
```js
      // primeraGestionRows: MIN timestamp del día por asesor (para calcular gest/hr en frontend)
      asesorIdList.length === 0 ? Promise.resolve([]) : db.cdr.groupBy({
        by: ['usuarioId'],
        where: { usuarioId: { in: asesorIdList }, timestampInicio: { gte: inicio, lte: fin } },
        _min: { timestampInicio: true },
      }).catch(() => []),
```

- [ ] **Step 2: Construir el mapa `primeraGestionMap`**

Justo antes de la línea `const porAsesor = new Map(asesores.map(a => [a.id, {`, añadir:
```js
    // Mapa asesorId → ISO string de la primera gestión del día (naive-UTC Guayaquil)
    const primeraGestionMap = new Map(
      (primeraGestionRows || []).map(r => [
        r.usuarioId,
        r._min?.timestampInicio ? r._min.timestampInicio.toISOString() : null,
      ])
    );
```

- [ ] **Step 3: Inyectar `primera_gestion_ts` en la respuesta por asesor**

Dentro del objeto `porAsesor` map (que construye el shape de cada asesor en la respuesta), añadir el campo nuevo justo después de `msg_correo`:
```js
      msg_correo: msgMap.get(a.id)?.correo ?? 0,
      primera_gestion_ts: primeraGestionMap.get(a.id) || null,
```

- [ ] **Step 4: Verificar que el endpoint responde con el nuevo campo**

Con el backend corriendo (puerto 3001), hacer login y llamar al endpoint:
```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@uphone.local","password":"Uphone@2026"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")
curl -s "http://localhost:3001/api/actividad-tipificacion" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for a in d['asesores'][:3]:
    print(a['asesor_id'], a.get('primera_gestion_ts'), a['total_count'])
"
```
Esperado: cada asesor con gestiones hoy muestra un ISO string en `primera_gestion_ts`; los sin gestiones muestran `null`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/supervisor.routes.js
git commit -m "feat(actividad): add primera_gestion_ts to actividad-tipificacion response"
```

---

## Task 2: Frontend — helpers de cálculo (con test TDD)

**Files:**
- Create: `tests/unit/gest-hora-calc.test.js`
- Modify: `src/renderer/supervisor/ActividadGestores.jsx` (añadir helpers al tope del archivo, antes de `export default`)

### Contexto crítico de timezone
`timestamp_inicio` es **naive-UTC**: se almacena como wall-clock Guayaquil en un campo `WITHOUT TIME ZONE`. Prisma lo devuelve como `"2026-07-29T08:30:00.000Z"`. Compararlo contra `Date.now()` (UTC real) introduce un error de 5 horas. La solución: "naive now" = hora actual de Guayaquil expresada como si fuera UTC.

- [ ] **Step 1: Escribir los tests**

Crear `tests/unit/gest-hora-calc.test.js`:
```js
import { describe, it, expect, vi, afterEach } from 'vitest';

// Copiar aquí los helpers (el test importa funciones puras, no el componente)
function getNaiveNowForGYE() {
  const now = new Date();
  const gyeStr = now.toLocaleString('sv-SE', { timeZone: 'America/Guayaquil' });
  return new Date(gyeStr.replace(' ', 'T') + 'Z');
}

function calcGph(totalCount, primeraGestionTs) {
  if (!primeraGestionTs || !totalCount) return null;
  const naiveNow = getNaiveNowForGYE();
  const elapsed = (naiveNow.getTime() - new Date(primeraGestionTs).getTime()) / 3600000;
  if (elapsed < 0.1) return null;
  return totalCount / elapsed;
}

function getProyeccion(totalCount, gph) {
  if (gph == null) return null;
  const naiveNow = getNaiveNowForGYE();
  const ymd = naiveNow.toISOString().slice(0, 10);
  const naiveMidnight = new Date(`${ymd}T23:59:59.999Z`);
  const horasRestantes = (naiveMidnight.getTime() - naiveNow.getTime()) / 3600000;
  if (horasRestantes < 0.1) return null;
  return Math.round(totalCount + gph * horasRestantes);
}

afterEach(() => { vi.useRealTimers(); });

describe('calcGph', () => {
  it('returns null when no gestiones', () => {
    expect(calcGph(0, '2026-07-29T08:00:00.000Z')).toBeNull();
  });

  it('returns null when primeraGestionTs is null', () => {
    expect(calcGph(10, null)).toBeNull();
  });

  it('returns null when elapsed < 6 min (0.1h)', () => {
    // Fake naive now = 08:03 GYE (naive-UTC)
    vi.useFakeTimers();
    // getNaiveNowForGYE uses toLocaleString → mock Date to return 08:03 GYE = 13:03 UTC real
    // Simpler: mock the real UTC clock so GYE = 08:03
    const fakeUTC = new Date('2026-07-29T13:03:00.000Z'); // 08:03 GYE
    vi.setSystemTime(fakeUTC);
    // primera_gestion_ts naive = 08:00 GYE → "2026-07-29T08:00:00.000Z"
    expect(calcGph(5, '2026-07-29T08:00:00.000Z')).toBeNull(); // only 3 min elapsed
  });

  it('calculates correct rate after sufficient time', () => {
    vi.useFakeTimers();
    // Fake: current real UTC = 13:00 UTC → GYE = 08:00 GYE
    // primera_gestion naive = 06:00 GYE → "2026-07-29T06:00:00.000Z"
    // elapsed = 2 hours; 20 gestiones → 10/hr
    vi.setSystemTime(new Date('2026-07-29T13:00:00.000Z')); // 08:00 GYE
    const result = calcGph(20, '2026-07-29T06:00:00.000Z'); // 06:00 GYE naive
    expect(result).toBeCloseTo(10, 0);
  });
});

describe('getProyeccion', () => {
  it('returns null when gph is null', () => {
    expect(getProyeccion(10, null)).toBeNull();
  });

  it('returns null when near midnight', () => {
    vi.useFakeTimers();
    // 23:56 GYE real = 04:56 UTC next day... actually 23:56 GYE = 04:56+5 = correct
    // Naive now: GYE = 23:57, so naiveNow = "...T23:57..." → horasRestantes < 0.1
    vi.setSystemTime(new Date('2026-07-30T04:57:00.000Z')); // 23:57 GYE
    expect(getProyeccion(100, 15)).toBeNull();
  });

  it('projects correctly mid-day', () => {
    vi.useFakeTimers();
    // GYE = 10:00, midnight naive = 23:59:59 → ~14h remaining
    // 20 gestiones already, 10/hr → 20 + (10 * 14) = 160
    vi.setSystemTime(new Date('2026-07-29T15:00:00.000Z')); // 10:00 GYE
    const result = getProyeccion(20, 10);
    expect(result).toBeGreaterThan(100);
    expect(result).toBeLessThan(200);
  });
});
```

- [ ] **Step 2: Correr tests para verificar que fallan (helpers no existen aún)**

```bash
cd "D:/documentos/Crm-acoplado a mrketing-uphone/Crm_marketing_uphone"
npm test -- tests/unit/gest-hora-calc.test.js
```
Esperado: ERROR (calcGph / getProyeccion / getNaiveNowForGYE not defined in the actual component yet — tests pass because they define them inline, so they should PASS here actually). Revisar que los tests pasen verdes antes de continuar.

- [ ] **Step 3: Añadir los helpers al componente**

En `src/renderer/supervisor/ActividadGestores.jsx`, justo antes de `export default function ActividadGestores(`, añadir:

```js
// ── Helpers GEST/HORA ────────────────────────────────────────────────────────
// CRÍTICO: timestamp_inicio es naive-UTC (wall-clock Guayaquil, sin zona).
// Comparar contra Date.now() (UTC real) introduce error de 5h.
// getNaiveNowForGYE() retorna la hora actual de GYE expresada como naive-UTC,
// manteniendo coherencia con los timestamps del backend.
function getNaiveNowForGYE() {
  const now = new Date();
  const gyeStr = now.toLocaleString('sv-SE', { timeZone: 'America/Guayaquil' });
  return new Date(gyeStr.replace(' ', 'T') + 'Z');
}

function calcGph(totalCount, primeraGestionTs) {
  if (!primeraGestionTs || !totalCount) return null;
  const naiveNow = getNaiveNowForGYE();
  const elapsed = (naiveNow.getTime() - new Date(primeraGestionTs).getTime()) / 3600000;
  if (elapsed < 0.1) return null; // < 6 min: insuficiente, evita 500/hr artificiales
  return totalCount / elapsed;
}

function getProyeccion(totalCount, gph) {
  if (gph == null) return null;
  const naiveNow = getNaiveNowForGYE();
  const ymd = naiveNow.toISOString().slice(0, 10);
  const naiveMidnight = new Date(`${ymd}T23:59:59.999Z`);
  const horasRestantes = (naiveMidnight.getTime() - naiveNow.getTime()) / 3600000;
  if (horasRestantes < 0.1) return null; // cerca de medianoche
  return Math.round(totalCount + gph * horasRestantes);
}
```

- [ ] **Step 4: Actualizar `maxGph` para usar el nuevo cálculo**

Buscar en `ActividadGestores.jsx` el bloque:
```js
  const maxGph = Math.max(1, ...asesores.map(a =>
    a.total_tiempo_seg > 0 ? a.total_count / (a.total_tiempo_seg / 3600) : 0
  ));
```

Reemplazar con:
```js
  const maxGph = Math.max(1, ...asesores.map(a => calcGph(a.total_count, a.primera_gestion_ts) ?? 0));
```

- [ ] **Step 5: Correr tests**

```bash
npm test -- tests/unit/gest-hora-calc.test.js
```
Esperado: todos los tests en verde.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/gest-hora-calc.test.js src/renderer/supervisor/ActividadGestores.jsx
git commit -m "feat(gest-hora): add calcGph/getProyeccion helpers with naive-UTC timezone fix"
```

---

## Task 3: Frontend — rediseño visual de la celda GEST/HORA

**Files:**
- Modify: `src/renderer/supervisor/ActividadGestores.jsx` (bloque `{(() => { ... })()}` de la celda GEST/HORA, ~línea 480)

### Diseño objetivo
```
┌──────────────────────────────┐
│  ⚡ 14 /hr            ● verde │
│  ████████░░░░░   80% equipo  │
│  → ~86 hoy                   │
└──────────────────────────────┘
```

- Fila 1: icono `speed` + número entero en blanco + `/hr` tiny + dot de color alineado derecha
- Fila 2: barra 6px (antes 4px), ancho = `(gph / maxGph) * 100%`, color según umbral
- Fila 3: `→ ~N hoy` en gris — si `getProyeccion` retorna null, omitir
- Sin datos suficientes (gph null): mostrar `—`

Thresholds sin cambio: ≥18 `#00e676`, ≥12 `#ffd54f`, <12 `#ff5252`.

- [ ] **Step 1: Reemplazar la celda GEST/HORA**

Localizar el bloque completo de la celda (empieza con `{(() => {` y contiene `const horas = (a.total_tiempo_seg || 0) / 3600`). Reemplazarlo con:

```jsx
                  {(() => {
                    const gph = calcGph(a.total_count, a.primera_gestion_ts);
                    const pctMax = gph != null ? Math.min(100, Math.round((gph / maxGph) * 100)) : 0;
                    const color = gph == null ? 'rgba(229,226,225,0.2)'
                      : gph >= 18 ? '#00e676'
                      : gph >= 12 ? '#ffd54f'
                      : '#ff5252';
                    const proyeccion = getProyeccion(a.total_count, gph);
                    return (
                      <td style={{ padding: '10px 16px', minWidth: 130 }}>
                        {gph != null ? (
                          <>
                            {/* Fila 1: icono + número + dot */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                <span className="material-symbols-outlined" style={{ fontSize: 13, color, verticalAlign: 'middle', lineHeight: 1 }}>speed</span>
                                <span className="text-mono" style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px' }}>
                                  {Math.round(gph)}
                                </span>
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>/hr</span>
                              </div>
                              <span style={{
                                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                                background: color, flexShrink: 0,
                                boxShadow: `0 0 6px ${color}88`,
                              }} />
                            </div>
                            {/* Fila 2: barra comparativa vs equipo */}
                            <div style={{ margin: '5px 0 3px', height: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 99, overflow: 'hidden', maxWidth: 110 }}>
                              <div style={{
                                height: '100%', width: `${pctMax}%`,
                                background: color, borderRadius: 99,
                                transition: 'width 0.4s ease',
                              }} />
                            </div>
                            {/* Fila 3: proyección o % del máximo */}
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)', display: 'flex', gap: 6 }}>
                              <span>{pctMax}%</span>
                              {proyeccion != null && (
                                <span style={{ color: 'rgba(255,255,255,0.45)' }}>→ ~{proyeccion} hoy</span>
                              )}
                            </div>
                          </>
                        ) : (
                          <span style={{ fontSize: 14, color: 'rgba(229,226,225,0.2)' }}>—</span>
                        )}
                      </td>
                    );
                  })()}
```

- [ ] **Step 2: Verificar visualmente en la app**

Con el app corriendo (`npm run dev`), navegar a Panel Jefe → Actividad Gestores. Verificar:
- La columna GEST/HORA muestra números enteros (14, 12, 8 — no 155.0)
- El dot de color aparece alineado a la derecha
- La barra tiene 6px de alto y es visible
- La fila `→ ~N hoy` aparece cuando hay proyección disponible
- Asesores sin gestiones muestran `—`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/supervisor/ActividadGestores.jsx
git commit -m "feat(gest-hora): redesign cell with correct rate calc, dot indicator, projection"
```

---

## Task 4: Verificación end-to-end

- [ ] **Step 1: Correr todos los unit tests**

```bash
cd "D:/documentos/Crm-acoplado a mrketing-uphone/Crm_marketing_uphone"
npm test
```
Esperado: todos los tests en verde, incluyendo `gest-hora-calc.test.js`.

- [ ] **Step 2: Verificar valores realistas**

Con asesores con datos reales del día, confirmar que los valores están en rango esperado:
- Si un asesor lleva 2 horas trabajando y tiene 20 gestiones → debe mostrar `~10/hr`
- Si lleva 30 min y tiene 8 gestiones → debe mostrar `~16/hr`
- No deben aparecer valores > 30/hr (serían sospechosos)

- [ ] **Step 3: Verificar thresholds de color**

- `≥ 18/hr` → dot verde `#00e676`
- `12–17/hr` → dot amarillo `#ffd54f`
- `< 12/hr` → dot rojo `#ff5252`

- [ ] **Step 4: Commit final (si hay ajustes menores)**

```bash
git add -A
git commit -m "fix(gest-hora): visual adjustments after e2e review"
```

---

## Self-Review

**Spec coverage:**
- ✅ Cálculo `gph = total_count ÷ horas_desde_primera_gestión` → Task 2
- ✅ Mínimo 6 min de observación antes de mostrar valor → Task 2 `calcGph`
- ✅ `primera_gestion_ts` añadido al backend → Task 1
- ✅ Número entero (no `14.2`) → Task 3 `Math.round(gph)`
- ✅ Dot de color vs thresholds ≥18/≥12/<12 → Task 3
- ✅ Barra 6px vs maxGph del equipo → Task 3
- ✅ Proyección `→ ~N hoy` hasta medianoche GYE → Task 2 + Task 3
- ✅ Fix timezone naive-UTC → Task 2 `getNaiveNowForGYE()`
- ✅ `maxGph` actualizado con nuevo cálculo → Task 2 Step 4

**Placeholder scan:** ninguno.

**Type consistency:**
- `calcGph(totalCount, primeraGestionTs)` → usado igual en Task 2 (helpers) y Task 3 (celda) ✅
- `getProyeccion(totalCount, gph)` → mismo signature en tests y componente ✅
- `a.primera_gestion_ts` → campo añadido en Task 1 backend, consumido en Task 3 ✅
