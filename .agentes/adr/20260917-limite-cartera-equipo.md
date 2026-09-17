# ADR 20260917 — Tope por asesor en GET /api/cartera-equipo + /resumen

## Contexto

Incidente en producción 2026-09-17: heap de `crm-backend` al 96%+ en minutos,
event loop bloqueado (p95 hasta 4.1s), tormenta de `prisma:error timeout
exceeded when trying to connect` / `Connection terminated unexpectedly`,
gestiones sin registrarse y HTTP 502. Postgres descartado como causa (24/100
conexiones, CPU bajo en el momento del pico).

Causa raíz identificada: `GET /api/cartera-equipo` (llamado sin parámetros
por `JefePanel.jsx` y `SupervisorPanel.jsx` vía el canal IPC
`db:getCarteraEquipo`, al abrir el módulo Carteras) trae **toda la cartera
del equipo sin límite**. El propio comentario del código decía "128K→1
query". Con el volumen actual (`SELECT asignado_a, count(*) ... GROUP BY`
verificado en producción: 16 asesores activos, de 178 a 46,328 contactos
cada uno, ~370K filas combinadas), cada apertura del módulo — o cada
reconexión masiva de supervisores por WS — dispara la construcción y
serialización JSON de cientos de miles de objetos en el proceso Node de un
solo hilo, bloqueando el event loop y saturando el heap. Esto explica tanto
el 502 (proceso sin responder) como "se reinicia la data del dashboard"
(heartbeat WS de 30s se pierde por el bloqueo → `ws.terminate()` → el
cliente reconecta y recibe un `SNAPSHOT_ESTADOS` fresco).

Existe una rama abandonada (`hotfix/cdrs-indexes`, autor
jhonguamansanmartin) con el diagnóstico correcto y un rediseño "resumen +
carga lazy por asesor" para este mismo endpoint — pero la rama está
desactualizada respecto a `main` (no tiene el módulo de cache que ya
previene el agotamiento de pool en `/metricas-equipo` y
`/metricas-asesores-bulk`, ni `primera_gestion_ts` que usa el cálculo de
gest/hora del frontend actual) y en otra sección reemplaza `Prisma.sql`
parametrizado por `$queryRawUnsafe` con interpolación de string manual — un
paso atrás en seguridad. No se mergea tal cual; se retoma solo el diseño.

## Decisión

**Ahora (este cambio):**
1. Nuevo `GET /api/cartera-equipo/resumen` — una fila por asesor con
   conteos por estado (`total`, `pendientes`, `en_intentos`, `agendados`,
   `gestionados`, `ya_pago`), sin filas de cliente ni metadata. Cache 30s
   (mismo patrón que `/metricas-equipo`).
2. `GET /api/cartera-equipo` sigue existiendo con el mismo contrato (sin
   parámetros = equipo completo, compatible con el frontend actual) pero
   ahora limita cada asesor a **2000 filas** (por prioridad: `EN_INTENTOS` →
   `PENDIENTE` → `AGENDADO` → `GESTIONADO` → `YA_PAGO`, vía `ROW_NUMBER()
   OVER (PARTITION BY asignado_a ...)`) en vez de recortar el total combinado
   de forma pareja. Acepta también `?asesor_id=` (sin límite en ese caso)
   para el futuro consumo lazy del frontend.

Ambas queries se verificaron con `SELECT`/`EXPLAIN` de solo lectura contra la
base de producción (sin Docker local disponible en esta sesión): el resumen
devuelve 16 filas coherentes: la versión topeada devuelve 16 filas, ninguna
en cero, topeadas en 2000 los asesores que superan ese número y con su total
real los que tienen menos.

**Pendiente, fuera de este cambio (requiere trabajo de frontend, no se
improvisa en caliente):** reescribir `CarterasEquipo.jsx` +
`JefePanel.jsx`/`SupervisorPanel.jsx` para cargar `/resumen` al abrir el
módulo y pedir el detalle completo un asesor a la vez vía `?asesor_id=` al
hacer clic — diseño ya prototipado en la rama abandonada, a adaptar sobre
`main` actual. Hasta que eso exista, `/cartera-equipo` seguirá devolviendo
como máximo 2000×16 ≈ 32,000 filas en el peor caso — muy por debajo del
~370K actual, pero no es la solución final.

Alternativas descartadas:
- **Mergear `hotfix/cdrs-indexes` tal cual:** regresa el cache anti-pool-
  exhaustion y `primera_gestion_ts`, e introduce SQL sin parametrizar en
  otra sección del mismo archivo.
- **Límite plano al total combinado** (ej. `LIMIT 20000` sin `ROW_NUMBER`):
  más simple, pero deja en cero a la mayoría de asesores (el orden es por
  nombre de asesor primero) — un supervisor vería cartera completa de 1-2
  asesores y nada del resto. El `ROW_NUMBER() PARTITION BY` cuesta poco más
  y evita eso, confirmado con datos reales de producción.
- **Aumentar el heap de Node en vez de tocar la query:** ya aplicado como
  paliativo (`--max-old-space-size=6144`) durante el incidente — reduce el
  riesgo de crash pero no la latencia por bloqueo del event loop al
  serializar cientos de miles de filas; no ataca la causa.

## Consecuencias

- **Rendimiento:** de servir potencialmente ~370K filas a un máximo de
  ~32K (16 asesores × 2000) — reduce el peor caso en más de 10x. El
  `/resumen` nuevo es la carga real que necesita el módulo al abrir (16
  filas), sin costo de payload de contactos.
- **UX temporal:** un asesor con más de 2000 contactos en un estado no verá
  el 100% de su cartera en la vista de equipo hasta que exista el
  detalle lazy por asesor. Es una degradación aceptada y documentada, no
  silenciosa — el código deja el comentario STOPGAP con la fecha y el
  ADR.
- **Compatibilidad:** `GET /cartera-equipo` sin parámetros sigue respondiendo
  con el mismo shape que hoy consume el frontend — cero cambios requeridos
  en `JefePanel.jsx`/`SupervisorPanel.jsx`/`CarterasEquipo.jsx` para este
  despliegue.
- **Deuda pendiente:** el rediseño frontend lazy-load queda como tarea
  aparte, con su propio ciclo de pruebas — no se debe tratar
  `CARTERA_EQUIPO_MAX_POR_ASESOR = 2000` como una solución permanente.
- **Cobertura de pruebas:** sin Docker/Postgres local disponible en esta
  sesión, no hay test automatizado (vitest) para esta ruta — mismo
  problema estructural que en `.agentes/adr/20260917-cache-actividad-
  tipificacion.md` (el router no puede importarse en pruebas sin
  `DATABASE_URL` real). La verificación real se hizo por `SELECT` directo
  contra producción (solo lectura) — ver evidencia arriba. Sigue pendiente
  extraer los handlers a funciones inyectables para permitir tests de
  integración reales.
