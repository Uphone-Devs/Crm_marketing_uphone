# ADR 20260917 — Cache TTL en GET /api/actividad-tipificacion

## Contexto

El panel "Actividad Gestores" (`ActividadGestores.jsx`) se refetchea vía
`GET /api/actividad-tipificacion` cada vez que llega un evento WS
`TIPIFICACION_REALIZADA` (debounce 2s), disparado por cualquier asesor del
equipo al registrar una gestión. Con varios supervisores viendo el mismo
equipo en simultáneo, cada refetch ejecuta ~7 queries agregadas (varias raw
SQL con subqueries `EXISTS` sobre `contactos`/`cdrs`) contra el pool de
Prisma (`pg.Pool` con `max: 30`, ver `backend/src/config/db.js`).

Éste es el mismo patrón ya diagnosticado y corregido por el autor anterior en
dos endpoints hermanos del mismo archivo — `/metricas-equipo` (commit
`7481bac`) y `/metricas-asesores-bulk` (commit `c192ae2`) — con el mensaje:
"pg pool (max 30) was exhausted — subsequent requests timed out at
connection acquire ... timeout ... → crash → EADDRINUSE". El proceso cae,
PM2 lo reinicia (ver runbook VM), y durante la ventana de caída/reinicio el
frontend recibe `HTTP 502` desde Cloudflare Tunnel y el panel de gestiones
no muestra datos — el síntoma reportado ("no muestra las gestiones que
registra el usuario" + error 502).

`/actividad-tipificacion` quedó fuera de esa corrección: es la única de las
tres rutas "en vivo" de ese archivo sin cache, pese a ser la más pesada (7
queries vs 1-3 de las otras) y la más frecuentemente disparada (cada
tipificación de cualquier asesor la refetchea en todos los supervisores
conectados al equipo).

## Decisión

Envolver el handler con el mismo mecanismo ya en producción en
`backend/src/utils/cache.js` (TTL en memoria, sin dependencias): clave
`actividad-tipif:${req.user.id}:${fecha}:${campanaId}`, TTL 30s — idéntico
al de `/metricas-equipo` y `/metricas-asesores-bulk`. Sin invalidación activa
en escritura (mismo criterio que esos dos endpoints: se acepta hasta 30s de
staleness a cambio de no volver a instrumentar cada punto de escritura).

Alternativas descartadas:
- **Invalidar por prefijo en el PATCH de CDR** (como hace `mensajes:`):
  más preciso, pero introduce acoplamiento del endpoint de escritura hacia
  éste y no sigue el precedente ya validado en producción para este mismo
  tipo de panel.
- **Backpressure/rate-limit del lado del cliente** (aumentar el debounce):
  no ataca la causa — con 2+ supervisores igual se dispara la ráfaga.
- **Aumentar `max` del pool de PostgreSQL**: sólo eleva el techo, no elimina
  el trabajo redundante; además el pool es compartido con `cobranza-api` en
  la misma VM (ver runbook de despliegue).

## Consecuencias

- **Rendimiento:** de 1 ejecución de ~7 queries por refetch a máximo 1 cada
  30s por (supervisor, fecha, campaña) — Big O de queries pasa de O(N) por
  ráfaga de tipificaciones a O(1) por ventana de 30s. Big I (pasos de
  interacción humana) sin cambio — el supervisor no nota diferencia salvo
  hasta 30s de latencia en el peor caso.
- **Staleness aceptada:** el panel puede tardar hasta 30s en reflejar la
  última gestión cuando el hit de cache absorbe el refetch. Mismo trade-off
  ya aceptado en los dos endpoints hermanos sin quejas reportadas.
- **Aislamiento:** la clave incluye `req.user.id`, así que dos supervisores
  de equipos distintos nunca comparten entrada de cache (cubierto por test).
- **Deuda pendiente (fuera de este cambio):** `backend/src/routes/
  supervisor.routes.js` (4600+ líneas) no puede importarse en pruebas sin
  una `DATABASE_URL` real — `config/db.js` aborta el proceso a propósito si
  falta. Por eso la prueba (`tests/unit/actividad-tipificacion-cache.test.js`)
  ejerce el mecanismo de cache real contra el shape exacto del handler, sin
  poder ejecutar red/green contra el archivo de producción. Extraer los
  handlers a funciones inyectables (DI del cliente Prisma) resolvería esto,
  pero es un refactor propio, no parte de este hotfix.
- **Verificación pendiente en VM:** confirmar el commit desplegado en
  `F:\crm-backend\app` incluye `7481bac`/`c192ae2` — si la VM está desactualizada,
  este fix por sí solo no basta; se necesita `git pull` + reinstalación completa
  siguiendo la secuencia atómica del runbook (PATH → `npm ci --omit=dev` →
  `prisma generate` → `pm2 restart crm-backend --update-env`).
