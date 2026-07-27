## Qué hace

Cierra lo que quedaba abierto para desplegar el backend en la VM de Azure, sobre lo ya resuelto en `main`. No toca el protocolo cliente↔servidor: los clientes Electron instalados no requieren reinstalación.

## Cambios

- **Cuentas admin protegidas.** `rolPermitido` validaba el rol solicitado, no el de la cuenta objetivo: un `jefe_area` podía hacer `PUT` sobre la cuenta de un admin pidiendo rol `asesor` —asignación permitida para él— y degradarla, o desactivarla con `toggle`.
- **SIGTERM.** systemd lo envía en cada `restart`; sin handler el proceso moría sin cerrar el servidor HTTP ni drenar el pool de Prisma.
- **Health real.** `/health` consulta la base y responde 503 si no contesta; `/live` queda como chequeo de proceso. Un health que no toca la base deja al túnel enrutando tráfico a un backend inservible.
- **Bind a loopback.** `HOST` por defecto pasa a `127.0.0.1`: el acceso externo entra por el túnel, que corre en la misma VM.
- **socket.io retirado.** El namespace `/calls` no autenticaba el handshake y ningún cliente lo consumía —el renderer usa el WS nativo y no incluye `socket.io-client`. Los archivos quedan en el árbol; volver a montarlo exige autenticarlo.
- **Dependencias muertas fuera.** `@aws-sdk/*`, `better-sqlite3` y su adapter estaban declarados sin una sola referencia en `backend/src`. La instalación en la VM ya no compila módulos nativos.
- **Seed partido.** `seed:catalogo` siembra tipificaciones y es idempotente; `seed:demo` se niega a correr con `NODE_ENV=production` — crea diez cuentas con una contraseña publicada en este repositorio.
- **`.gitignore` anclado.** El patrón `prisma/` sin barra inicial ignoraba `backend/prisma/`. Las migraciones entraron porque se forzaron; cualquier archivo nuevo ahí quedaba fuera sin aviso.
- **`deploy/`.** Runbook, unidad systemd y configuración de named tunnel.
- **Docs corregidas.** `backend/README.md` se declaraba deuda técnica no integrada y `KNOWN-ISSUES.md` señalaba `src/main/apiServer.js` como el backend real. Es código muerto: `initApiServer` solo se invoca desde `src/main/server.js`, un entry que ningún script ni build referencia.

## Verificación

Servidor arrancado contra una base inexistente:

```
PASS  /live responde 200 sin tocar la base — status=200
PASS  /health devuelve 503 con la base caida — {"status":"DEGRADED","db":"down"}
PASS  socket.io ya no responde en /socket.io — status=404
PASS  WS rechaza mensajes sin IDENTIFICAR — {"tipo":"ERROR","mensaje":"No autenticado"}
PASS  WS rechaza IDENTIFICAR con token invalido — {"tipo":"ERROR","mensaje":"Token inválido"}
```

SIGTERM no es verificable en Windows: queda como comprobación 9 del runbook, a hacer en la VM.

## Antes de desplegar

Leer `deploy/RUNBOOK.md` §4. El repositorio ya trae las migraciones, pero si la base productiva no tiene registro en `_prisma_migrations`, un `migrate deploy` las ejecutaría todas sobre datos reales. El paso diagnostica esa tabla primero y, según el caso, adopta el historial con `migrate resolve --applied` sin ejecutar SQL.

## Revisado y no modificado

El WS de `main` se auditó antes de tocarlo: la guarda de `autenticado` cubre todos los `case`, así que no hay ventana previa a `IDENTIFICAR`. Se deja intacto.

Sí quedan anotados en `backend/README.md` tres puntos para backlog:

- El aislamiento por equipo se aplica a `AUDIO_CHUNK`, pero `ESTADO_ASESOR` y `METRICAS_ASESOR` siguen difundiéndose a todos los supervisores.
- `MARCAR_CLIENTE` y `REMOTE_DIAL` no comprueban que el asesor destino sea del equipo del supervisor.
- `TIPIFICACION_REALIZADA` no verifica rol.
