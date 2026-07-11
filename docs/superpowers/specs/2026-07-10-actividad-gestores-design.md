# Panel "Actividad Gestores" — Supervisión en tiempo real por tipificación

**Fecha:** 2026-07-10
**Estado:** Aprobado

## Objetivo

Nuevo apartado en la consola del Jefe de Área para supervisar en tiempo real la
actividad de los gestores: gestiones y tiempo al aire del día, desglosados por
tipificación. Ubicado en el menú lateral entre "Métricas" y "Compromisos".
No modifica la lógica existente — solo lee datos ya generados (CDRs) y reutiliza
la infraestructura WS actual.

## Decisiones tomadas

- **Contenido:** gestiones por tipificación, con tiempo al aire acumulado por tipificación.
- **Layout:** matriz gestores × categorías (3 columnas: Contacto Exitoso / Contacto
  Neutro / No Contactado) + columna Total. Clic en celda/fila abre desglose por
  código de tipificación (PMP, PAGO_REAL, NC, etc.).
- **Período:** hoy por defecto, con selector de fecha para días anteriores.
- **Tiempo real:** solo cuando fecha = hoy (badge "EN VIVO"); fechas pasadas son
  consulta estática.
- **Arquitectura:** Enfoque A — endpoint agregado en backend + refetch disparado
  por evento WS `TIPIFICACION_REALIZADA` con debounce. Se descartó acumulación en
  cliente (histórico de bugs de desincronización) y snapshot periódico del servidor
  (carga fija innecesaria, riesgo al tocar wsServer.js).

## Backend

Archivo: `backend/src/routes/supervisor.routes.js` (producción = backend/ con
Prisma/PostgreSQL — NO apiServer.js).

### Endpoint nuevo

`GET /api/supervisor/actividad-tipificacion?fecha=YYYY-MM-DD`

- `fecha` opcional, default = hoy (zona horaria del servidor).
- Registrar la ruta literal ANTES de cualquier ruta `/:id` del mismo prefijo
  (regla de orden de rutas Express del proyecto).
- Implementación: agregación sobre tabla `cdr` filtrada por día, solo CDRs con
  `tipificacionId` no nulo. Agrupar por `usuarioId` × tipificación:
  `COUNT(*)` y `SUM(duracionSeg)` (tratar null como 0). Join con `tipificaciones`
  para código, descripción y categoría, y con `usuarios` para nombre del gestor.
- Un solo query con groupBy fino (asesor × código); las categorías se agregan en
  JS a partir del detalle. Evita dos queries y garantiza consistencia
  categoría = suma de sus códigos.

### Respuesta

```json
{
  "fecha": "2026-07-10",
  "asesores": [{
    "asesor_id": 5,
    "nombre": "Evelyn Q.",
    "categorias": {
      "CONTACTO EXITOSO": { "count": 12, "tiempo_seg": 2700 },
      "CONTACTO NEUTRO":  { "count": 8,  "tiempo_seg": 900 },
      "NO CONTACTADO":    { "count": 4,  "tiempo_seg": 120 }
    },
    "detalle": [
      { "codigo": "PMP", "descripcion": "Compromiso de pago",
        "categoria": "CONTACTO EXITOSO", "count": 12, "tiempo_seg": 2700 }
    ],
    "total_count": 24,
    "total_tiempo_seg": 3720
  }]
}
```

- Incluir todos los asesores activos del equipo aunque tengan 0 gestiones ese día
  (fila con ceros), para que el jefe vea quién no ha gestionado.
- Normalizar variantes de categoría existentes en datos
  (`CONTACTO_EFECTIVO`/`CONTACTO EXITOSO`, `CONTACTO_NEUTRO`/`CONTACTO NEUTRO`,
  `NO_CONTACTADO`/`NO CONTACTADO`) a las tres etiquetas canónicas con espacio.
- Auth: mismo middleware de supervisor que las demás rutas del archivo.

## Frontend

### Navegación

`src/renderer/shared/NavigationDrawer.jsx` — insertar en el array de supervisor,
entre `metricas` y `compromisos`:

```js
{ id: 'actividad', icon: 'monitor_heart', label: 'Actividad Gestores' },
```

### Componente nuevo

`src/renderer/supervisor/ActividadGestores.jsx`

- Props: `apiBase`, `authToken`, `refreshSignal` (número), `estadosAsesores`
  (para punto verde/gris de conexión por gestor).
- Tabla: una fila por gestor. Columnas: Gestor (con indicador de conexión),
  Contacto Exitoso, Contacto Neutro, No Contactado, Total.
  Formato de celda: `12 · 45m` (conteo · tiempo legible; <60s → `45s`,
  ≥60m → `1h 12m`).
- Clic en fila → panel/modal con desglose por código de tipificación del gestor
  (tabla: código, descripción, categoría, gestiones, tiempo).
- Header: selector de fecha (default hoy) + badge "EN VIVO" visible solo cuando
  fecha = hoy.
- Orden: por total_count descendente por defecto.

### Integración en JefePanel

`src/renderer/supervisor/JefePanel.jsx`

- Tab liviana (mount/unmount normal): `{activePage === 'actividad' && <ActividadGestores ... />}`.
- Estado nuevo `actividadRefresh` (contador). En el handler WS existente, al
  recibir `TIPIFICACION_REALIZADA`, incrementarlo. No tocar el resto del handler.
- `ActividadGestores` hace fetch inicial al montar y refetch cuando cambia
  `refreshSignal`, con debounce de 2 s. Si la fecha seleccionada no es hoy,
  ignora la señal.

### Errores y vacíos

- Fetch falla: conservar datos previos en pantalla + aviso discreto de
  desconexión; reintento en el siguiente refreshSignal o cambio de fecha.
- Sin gestiones en la fecha: estado vacío con mensaje.

## Qué NO se toca

- `backend/src/wsServer.js` — sin cambios.
- Flujo del asesor (AsesorPanel, tipificación) — sin cambios.
- Lógica existente de métricas/fusión WS+DB en JefePanel — sin cambios; solo se
  añade un contador en el handler WS.

## Verificación

1. Endpoint: curl con token de supervisor; validar conteos y sumas contra SQL
   directo en Postgres para un día con datos.
2. UI: tipificar desde un panel de asesor y verificar que la matriz se actualiza
   sola (≤ ~3 s) con fecha = hoy.
3. Fecha pasada: datos correctos y sin refetch al tipificar.
4. Gestor sin gestiones aparece con fila en ceros.
