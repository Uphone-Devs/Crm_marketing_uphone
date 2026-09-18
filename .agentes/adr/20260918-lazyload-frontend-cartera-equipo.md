# ADR 20260918 — Frontend lazy-load de Carteras del Equipo

## Contexto

Continuación de [`20260917-limite-cartera-equipo.md`](./20260917-limite-cartera-equipo.md).
Ese cambio dejó el backend listo (`GET /cartera-equipo/resumen` + `GET
/cartera-equipo?asesor_id=`) pero explícitamente marcó el rework de
`CarterasEquipo.jsx` como deuda pendiente — el stopgap
(`CARTERA_EQUIPO_MAX_POR_ASESOR = 2000`) seguía sirviendo hasta ~32K filas
de un tirón cada vez que un supervisor abría el módulo, sin necesitarlas
todas.

Al retomar esta tarea se encontró además una regresión introducida en el
propio cambio del 2026-09-17: el `SELECT` de la CTE `ranked` en
`/cartera-equipo` perdía la columna `ct.metadata`, que el frontend usa para
Mora, Días Mora, Nº Contrato y Empresa — esas columnas quedaban en blanco
para cualquier fila servida por el endpoint reescrito. Se corrige en este
mismo cambio por ser el mismo bloque de código.

Se detectó también que el checkout local de `CRM_marketing_uphone` (rama
`main`) no tiene ancestro común con `origin/main` (mismo síntoma de
"historias no relacionadas" ya visto en la VM el 2026-09-17). Este trabajo
se hizo en una rama nueva creada directo desde `origin/main`
(`feat/cartera-equipo-lazyload`), sin tocar la rama `main` local — esa
divergencia queda sin resolver, fuera de alcance de este cambio.

## Decisión

1. **`CarterasEquipo.jsx`** pasa de "cargar todo el equipo en un array
   plano" a:
   - Al montar: pide `/cartera-equipo/resumen` (16 filas, conteos por
     asesor) — siempre completo, nunca se omite.
   - Cada grupo de asesor arranca colapsado, mostrando sus conteos reales
     desde `/resumen` (chips de estado, total) sin haber pedido una sola
     fila de cliente.
   - Al expandir un asesor (o seleccionarlo en el filtro "Asesor"), recién
     ahí se pide `GET /cartera-equipo?asesor_id=` y se cachea en memoria
     por asesor (`detalle[asesorId]`).
   - Filtro de texto/estado/fecha sin asesor seleccionado: opera solo
     sobre los asesores ya cargados, con un aviso visible ("Buscando solo
     en N de M asesores cargados…") — nunca dispara una carga completa
     implícita.
   - Botón nuevo, explícito, "Cargar equipo completo": opt-in para
     recuperar el comportamiento de búsqueda global anterior, a costa de
     traer todo (mismo peso que el stopgap del 2026-09-17, pero ahora es
     una acción deliberada del supervisor, no el comportamiento por
     defecto en cada apertura del módulo).
   - Polling de 30s y `refreshSignal` (tras validar pago / tipificar)
     refrescan `/resumen` siempre, y solo los asesores ya cargados/
     visibles — no el equipo completo.
2. Lógica de filtrado/agregación (`aplicarFiltrosFila`, `sumarResumen`,
   `estaEnCola`) se extrajo a `carterasEquipoUtils.js` (módulo plano, sin
   JSX) para poder testearla con vitest sin necesitar un entorno DOM —
   este repo no tiene React Testing Library/jsdom configurado y agregar
   ese stack completo para un solo componente era desproporcionado al
   alcance de este cambio. Tests en
   `tests/unit/carterasEquipoUtils.test.js` (15 casos).
3. `preload.js` suma el canal `db:getCarteraEquipoResumen` a la whitelist
   IPC (modo local, sin implementación de handler — mismo estado que el
   canal `db:getCarteraEquipo` local, que tampoco tiene handler; no se
   improvisa esa capa local en este cambio, fuera de alcance).
4. Fix de la regresión de `metadata` en `/cartera-equipo` (una línea,
   restaura `ct.metadata::text AS metadata` en el `SELECT` de `ranked`).

## Consecuencias

- **Carga al abrir el módulo:** de hasta ~32K filas (stopgap 2026-09-17) a
  16 filas (`/resumen`). El detalle por asesor solo se paga cuando el
  supervisor efectivamente lo pide.
- **UX:** un supervisor que solo mira 2-3 asesores por turno ya no paga el
  costo de cargar los otros 13-14. Uno que necesita buscar en todo el
  equipo sigue pudiendo hacerlo con "Cargar equipo completo", de forma
  explícita.
- **Sin cambio de contrato en el backend:** no se tocó la firma de
  `/cartera-equipo` ni `/resumen`, ya definidas en el ADR anterior — este
  cambio es puramente de consumo.
- **Deuda que sigue abierta:** un asesor individual puede tener hasta
  ~46K contactos (dato de producción, ver ADR anterior); `?asesor_id=` no
  tiene tope, así que expandir a ESE asesor específico puede seguir
  siendo pesado para el render de React (miles de `<tr>`). No se agregó
  virtualización de tabla ni paginación por asesor en este cambio — está
  fuera del alcance pedido ("el fix del frontend" ya documentado en el ADR
  anterior); si se vuelve a ver lentitud de UI al expandir un asesor
  puntual con cartera muy grande, ese es el siguiente paso.
- **Divergencia de historia git local:** documentada arriba, no resuelta
  acá — requiere una sesión separada, sin presión de incidente, para
  decidir cómo reconciliar `main` local vs `origin/main` sin perder los
  223 commits locales.
- **Cobertura de pruebas:** la lógica pura de filtrado/agregación tiene
  tests (vitest, sin DOM). El componente React en sí (fetch, efectos,
  render condicional por grupo) no tiene test automatizado — este repo no
  tiene infraestructura de testing de componentes React; se verificó por
  lectura cuidadosa + compilación con `esbuild` (sintaxis) en vez de
  ejecución real en Electron, que no fue posible en esta sesión. Queda
  como hueco de cobertura conocido, igual que otros endpoints
  documentados en ADRs previos.
