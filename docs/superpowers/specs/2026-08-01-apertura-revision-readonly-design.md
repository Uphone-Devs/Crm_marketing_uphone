# Spec: Cartera en Modo Revisión de Apertura

**Fecha:** 2026-08-01  
**Archivo afectado:** `src/renderer/asesor/AsesorPanel.jsx`

## Problema

El selector de apertura en la `TopAppBar` del asesor actualiza las métricas del header (campStats) pero NO recarga la cartera (lista de contactos). El asesor no puede ver los contactos de aperturas anteriores.

## Solución

Cuando el asesor selecciona una apertura diferente a la activa, la cartera se recarga con los contactos de esa apertura en **modo solo lectura**. Un banner ámbar indica el estado. Al volver a la apertura activa, todo regresa a modo interactivo normal.

## Diseño

### `modoRevision` (valor derivado)

```js
const modoRevision = !!(revisionCampanaId && revisionCampanaId !== (campana?.id || null));
```

No requiere nuevo estado. Se recalcula en cada render.

### `cargarCartera` — cambios

1. Pasar `campVista` (ya definido: `revisionCampanaId || campana?.id`) como campanaId en lugar de `campana?.id`:
   ```js
   const data = await callApi('db:getCarteraAsesor', usuario.id, campVista);
   ```

2. Cuando `modoRevision === true`: solo ejecutar `setCartera(arr)` y `setTipifSelects(initSel)`. **Omitir** toda la lógica de sincronización de canales (`setSmsDetalle`, `setWspDetalle`, `setEmailDetalle`, `setSmsEnviados`, `setWspEnviados`, `setCorreosEnviados`, `_ssSave`) — esos contadores son de la campaña activa y no deben ser sobreescritos por datos de revisión.

3. Actualizar deps de `useCallback`:
   ```js
   }, [usuario?.id, campVista, modoRevision, callApi]);
   ```

### Banner de revisión

Renderizado justo antes de la lista de contactos (encima de las tarjetas). Visible solo cuando `modoRevision`.

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠ Revisando apertura: "apertura 30-07-2026 AAA" — solo lectura │  [↩ Volver a mi cartera]
└─────────────────────────────────────────────────────────────────┘
```

- Fondo: `rgba(255,179,0,0.10)` | Borde: `rgba(255,179,0,0.35)` | Color texto: `#ffb300`
- Nombre de campaña: de `campStats?.campanaNombre` (ya disponible en scope)
- Botón "Volver a mi cartera" → `setRevisionCampanaId(null)`

### Botones deshabilitados cuando `modoRevision`

| Elemento | Guard |
|---|---|
| Botón Llamar / Marcar por contacto | `disabled={modoRevision || ...condiciones_existentes}` |
| Selects de tipificación por fila | `disabled={modoRevision}` |
| Botón WSP por contacto | `disabled={modoRevision || ...}` |
| Botón RCS por contacto | `disabled={modoRevision || ...}` |
| Botón Correo por contacto | `disabled={modoRevision || ...}` |

No se necesita ocultar — deshabilitar es suficiente y es consistente con otros estados de bloqueo (CDR activo, lote en curso).

## Comportamiento edge cases

- **Asesor sin campaña activa** (`campana = null`): `modoRevision` siempre `false`, selector no aparece (ya manejado por `campanasLista.length > 0`).
- **Volver a activa**: `setRevisionCampanaId(null)` → `campVista = campana?.id` → `cargarCartera` recarga activa con sync canal completo.
- **WS `CARTERA_ASIGNADA`**: siempre llama `cargarCartera()` independiente del modo — al recargar, si `revisionCampanaId` sigue seteado, muestra la revisión; si se limpió, muestra la activa. Comportamiento correcto sin cambio adicional.
- **Canal sync en revisión**: omitido para no corromper contadores WSP/RCS/CORREO del día actual.

## Archivos a modificar

- `src/renderer/asesor/AsesorPanel.jsx` — único archivo
