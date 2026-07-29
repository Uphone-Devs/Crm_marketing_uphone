# GEST/HORA Redesign

## Context

The GEST/HORA column in the `ActividadGestores` supervisor table showed values like 155/hr, 158/hr — unrealistically high because the denominator was `total_tiempo_seg` (air/session time), which is very small early in the day, inflating the rate. The column was also visually hard to read (small number, thin bar, confusing "% del máx equipo" label).

Goals: show current pace (like a speedometer), allow projection of day-end total, enable asesor comparison.

## Calculation Fix

**Before:** `gph = total_count / (total_tiempo_seg / 3600)`
**After:** `gph = total_count / hours_since_first_gestion_today`

- Denominator = `(now - primera_gestion_ts) / 3600000` — grows naturally as the day progresses
- Minimum observation window: if `primera_gestion_ts` was < 6 minutes ago, show `—` (avoids 500/hr artifacts from first few calls)
- If no gestiones yet: show `—`

**Projection:** `projected = Math.round(total_count + gph * hours_until_midnight_GYE)`
- `hours_until_midnight_GYE` = ms until `23:59:59` in Guayaquil timezone ÷ 3600000
- If past 23:54 (< 6 min remaining): omit projection

## Backend Change

**File:** `backend/src/routes/supervisor.routes.js` — endpoint `GET /actividad-tipificacion`

Add `primera_gestion_ts` to each asesor's row in the response. This is the `MIN(timestamp_inicio)` of CDRs for that asesor today. If no CDRs yet, `null`.

The query already groups by `asesor_id` for the day — add `MIN(cr.timestamp_inicio)::text AS primera_gestion_ts` to the SELECT.

## Frontend Change

**File:** `src/renderer/supervisor/ActividadGestores.jsx`

### Calculation (replace `maxGph` block)

```js
// t0 = primera gestión del día (timestamp ISO del backend)
// gph calculado solo si hay ≥ 6 min de observación
function calcGph(totalCount, primeraGestionTs) {
  if (!primeraGestionTs || !totalCount) return null;
  const elapsed = (Date.now() - new Date(primeraGestionTs).getTime()) / 3600000;
  if (elapsed < 0.1) return null; // < 6 min → insuficiente
  return totalCount / elapsed;
}

function proyeccion(totalCount, gph) {
  if (gph == null) return null;
  const now = new Date();
  const medianoche = new Date(now);
  medianoche.setHours(23, 59, 59, 999);
  const horasRestantes = (medianoche - now) / 3600000;
  if (horasRestantes < 0.1) return null;
  return Math.round(totalCount + gph * horasRestantes);
}
```

### Cell Design

```
┌──────────────────────┐
│  ⚡ 14 /hr  ● verde  │
│  ████████░░  80%     │
│  → ~86 hoy           │
└──────────────────────┘
```

- **Row 1:** `speed` Material Symbol icon + integer number + `/hr` label + colored status dot
  - Number: `Math.round(gph)` (integer, not `14.2`)
  - Dot color: `≥18` → `#00e676`, `≥12` → `#ffd54f`, `<12` → `#ff5252`
- **Row 2:** Progress bar, height 6px (was 4px), vs `maxGph` of team
- **Row 3:** `→ ~N hoy` in `rgba(255,255,255,0.35)` — omitted if projection null

### `maxGph` update

Recalculate using the new `calcGph()` function (same array map, just different inputs).

## Thresholds (unchanged)

| Rate | Color |
|------|-------|
| ≥ 18 gest/hr | `#00e676` (green) |
| ≥ 12 gest/hr | `#ffd54f` (yellow) |
| < 12 gest/hr | `#ff5252` (red) |
| null / insufficient | `rgba(229,226,225,0.2)` — show `—` |

## Files Modified

1. `backend/src/routes/supervisor.routes.js` — add `primera_gestion_ts` to `/actividad-tipificacion` SELECT
2. `src/renderer/supervisor/ActividadGestores.jsx` — new calc helpers + new cell JSX

## Out of Scope

- No changes to thresholds
- No changes to other columns
- No changes to how `total_tiempo_seg` is used elsewhere (Total Llamadas column still shows it)
