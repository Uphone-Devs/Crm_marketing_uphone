# Instrumentar el pool para separar agotamiento de bloqueo del event loop

Fecha: 2026-09-24
Estado: aceptado

## Contexto

Los asesores ven un 500 intermitente al tipificar. El log muestra:

```
Invalid `prisma.cdr.update()` invocation:
Transaction API error: Unable to start a transaction in the given time.
```

Ese mensaje corresponde al `maxWait` de Prisma (2000 ms por defecto, sin
configurar en este proyecto): la transacción no logró **arrancar**. Es distinto
del `timeout` de 5000 ms que se corrigió el mismo día pasando la transacción de
interactiva a por lotes — ése ya no aparece.

Dos causas producen este mensaje y no se pueden distinguir por el mensaje:

- **(a) el pool llegó a su techo** (`max: 30`) y no hay conexión que entregar;
- **(b) el event loop estuvo bloqueado más de 2 s** y el temporizador venció
  aunque hubiera conexiones libres. Con `@prisma/adapter-pg` el driver es JS:
  despacho y deserialización de filas corren en el loop.

Lo medido el 2026-09-24 ~21:15 con `pg_stat_activity` muestreado cada 5 s:

- consulta `active` más larga en todo el muestreo: **1,63 s**, casi siempre 0;
  nunca más de 8 simultáneas → **Postgres no es el cuello de botella**;
- **27 conexiones (26 `idle` + 1 `active`) con la jornada terminada**, contra un
  techo de 30 → en pico es plausible que toque el límite;
- `idle in transaction`: 2 conexiones a 0,93 s → JS sí retiene transacciones.

La evidencia es compatible con ambas hipótesis. `pg_stat_activity` no puede
zanjarlo: sus conexiones `idle` pueden estar tomadas por el pool o solo
abiertas. `pg_stat_statements` no está instalado y cargarla exige reiniciar
Postgres.

## Decisión

No corregir todavía. Instrumentar primero, porque los dos arreglos posibles son
opuestos: si es (a) hay que bajar la concurrencia por request o subir el techo;
si es (b) hay que desbloquear el loop, y subir el techo lo empeora.

El dato que zanja está del lado de Node: el `Pool` de `pg` expone `totalCount`,
`idleCount` y `waitingCount`. **`waitingCount > 0` es (a)**; si el fallo ocurre
con `waitingCount` en 0 y conexiones libres, es (b).

Implementación:

1. `backend/src/config/pool.js` — el pool sale de `db.js` a su propio módulo,
   para poder leerlo sin importar el cliente de Prisma. `db.js` sigue exportando
   el cliente, así que ningún consumidor cambia.
2. `backend/src/infra/poolMetrics.js` — `snapshotPool`, `veredicto`,
   `esMaxWaitVencido`, `formatearSnapshot`. Puro, sin importar `pg` ni Prisma.
   Devuelve el caso especial `SIN_DATOS` en vez de null.
3. `cdrs.routes.js` — snapshot **antes** de la transacción y otro al fallar, y una
   línea `[TIPIFICAR_MAXWAIT]` con ambos y el veredicto, solo en este fallo.

El snapshot previo es indispensable: en los 2 s de espera el pool se drena y
leerlo recién en el `catch` lo muestra holgado.

## Consecuencias

**A favor:** el veredicto queda escrito en el log, por fallo, sin muestreo que
pueda no caer en el momento. Costo en régimen normal nulo — tres lecturas de
enteros por request, y log solo cuando ya hay un error. Sin dependencias nuevas.

**En contra:** no arregla nada todavía; el asesor sigue viendo el 500. Se
descartó el paliativo de subir el `maxWait` porque enmascara la señal justo
cuando se la está midiendo. Se aceptó esperar un día de operación para tener
datos, a cambio de no adivinar el arreglo.

**Riesgo asumido:** extraer el pool toca el módulo que usan todas las rutas. Se
verificó con smoke test de carga (`pool`, `db`, `cdrs.routes`) además de las
pruebas unitarias; la configuración del pool se copió literal, sin cambios de
valores.

**Deuda que este ADR no cierra:** los logs de PM2 no llevan timestamp, así que
la línea nueva no se puede correlacionar con picos de CPU ni con reportes de
asesores. Se arregla con `--log-date-format` en el próximo reinicio.

## Métricas

**Big O:** `snapshotPool` es O(1) — lee tres enteros que el pool ya mantiene, no
recorre conexiones. Sin cambio en la complejidad del endpoint.

**Big I:** de I(n) a I(1) para este diagnóstico. Hoy exige que una persona abra
`psql`, muestree `pg_stat_activity` a mano y adivine si el momento coincide con
un error. Después, el veredicto lo escribe el propio fallo y basta un `grep` del
log. El objetivo I(0) queda fuera de alcance: hace falta que un humano lea el
veredicto y decida el arreglo.
