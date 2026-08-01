# Apertura Revisión Solo Lectura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cuando asesor selecciona apertura diferente a la activa, cartera se recarga con contactos de esa apertura en modo solo lectura (banner + botones deshabilitados).

**Architecture:** Un solo archivo (`AsesorPanel.jsx`). `modoRevision` derivado de estado existente. `cargarCartera` usa `campVista`. Banner antes de tabla. Botones deshabilitados con `modoRevision` guard.

**Tech Stack:** React hooks, JSX inline styles.

---

### Task 1: modoRevision + cargarCartera

**Files:**
- Modify: `src/renderer/asesor/AsesorPanel.jsx:1416` (add modoRevision)
- Modify: `src/renderer/asesor/AsesorPanel.jsx:1600,1664` (cargarCartera)

- [ ] Después de línea `const campVista = ...` (L1416), agregar:
  ```js
  const modoRevision = !!(revisionCampanaId && revisionCampanaId !== (campana?.id || null));
  ```

- [ ] En `cargarCartera` cambiar `campana?.id` → `campVista` en la llamada API (L1600)

- [ ] Después de `setTipifSelects(initSel)` y antes de la lógica canal, agregar guard:
  ```js
  if (modoRevision) { setCarteraLoading(false); return; }
  ```
  (dentro del try, antes del bloque `const rcs = ...`)

- [ ] Actualizar deps de `useCallback` (L1664):
  ```js
  }, [usuario?.id, campVista, modoRevision, callApi]);
  ```

- [ ] Commit: `feat(asesor): cargarCartera uses campVista for revision mode`

---

### Task 2: Banner de revisión

**Files:**
- Modify: `src/renderer/asesor/AsesorPanel.jsx` ~L3062 (before cartera.length === 0 check)

- [ ] Insertar banner justo antes del bloque `if (cartera.length === 0)`:
  ```jsx
  {modoRevision && (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 16px', marginBottom: 12, borderRadius: 8,
      background: 'rgba(255,179,0,0.10)', border: '1px solid rgba(255,179,0,0.35)',
    }}>
      <span style={{ fontSize: 13, color: '#ffb300', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>info</span>
        Revisando apertura: <b>{campStats?.campanaNombre || '...'}</b> — solo lectura
      </span>
      <button type="button"
        onClick={() => setRevisionCampanaId(null)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
          borderRadius: 6, border: '1px solid rgba(255,179,0,0.5)',
          background: 'rgba(255,179,0,0.15)', color: '#ffb300',
          fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>undo</span>
        Volver a mi cartera
      </button>
    </div>
  )}
  ```

- [ ] Commit: `feat(asesor): banner modo revisión apertura`

---

### Task 3: Deshabilitar botones de acción

**Files:**
- Modify: `src/renderer/asesor/AsesorPanel.jsx` — botones canal WSP/RCS/Correo, ADB cel1/cel2, select tipif, botón PMP, botón "Ya pagó"

- [ ] **Canal WSP/RCS/Correo** (~L3428): cambiar `onClick` para retornar temprano si `modoRevision`:
  ```js
  onClick={async () => {
    if (modoRevision || bloqueado) return;
    // ... resto igual
  ```
  Y en `style.opacity`: `opacity: modoRevision ? 0.35 : bloqueado ? 0.45 : 1`
  Y en `style.cursor`: `cursor: modoRevision || bloqueado ? 'not-allowed' : 'pointer'`

- [ ] **ADB Cel 1** (~L3643): agregar `disabled={modoRevision}` y `onClick={(e) => { e.stopPropagation(); if (!modoRevision) handleAdbMarcar(c, idx0); }}`

- [ ] **ADB Cel 2** (~L3678): mismo patrón que Cel 1 con `idx1`

- [ ] **Select tipificación** (~L3570): agregar `disabled={modoRevision}` al `<select>`

- [ ] **Botón PMP** (~L3603): agregar `disabled={modoRevision}`

- [ ] **Botón "Ya pagó"** (~L3617): agregar `disabled={modoRevision}`

- [ ] Commit: `feat(asesor): disable action buttons in revision mode`
