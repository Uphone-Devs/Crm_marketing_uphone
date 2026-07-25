# backend/ — Servidor de producción

> **Este es el backend que corre en la VM de Azure.** Express 5 + Prisma 7 + PostgreSQL 15, puerto 3001.

La versión anterior de este archivo decía lo contrario ("Servidor Standalone (DEUDA TÉCNICA) — NO INTEGRADO") y afirmaba que faltaban `/api/jefe/*`, validación de pagos y agendamientos. Era información obsoleta: todo eso existe en `src/routes/supervisor.routes.js` y en `prisma/schema.prisma`. `src/main/apiServer.js`, que ese texto señalaba como el servidor activo, es **código muerto**: `initApiServer` solo se invoca desde `src/main/server.js`, un entry que ningún script ni build referencia. Lo que arranca en producción es este directorio, lanzado como proceso hijo desde `src/main/index.js`.

## Arranque

```bash
cp .env.example .env      # completar DATABASE_URL, JWT_SECRET, CORS_ORIGIN
npm ci
npx prisma generate
npx prisma migrate deploy
npm start
```

## Estructura

```
backend/
├── prisma/
│   ├── schema.prisma        ← modelos, provider postgresql
│   ├── migrations/          ← historial versionado del esquema
│   ├── seed-catalogo.js     ← tipificaciones (producción, idempotente)
│   └── seed.js              ← DEMO: usuarios de prueba, bloqueado en producción
└── src/
    ├── index.js             ← entry: middleware, rutas, WS, ciclo de vida
    ├── config/db.js         ← PrismaClient singleton (@prisma/adapter-pg)
    ├── middleware/auth.middleware.js
    ├── wsServer.js          ← monitoreo en vivo (ws nativo)
    ├── sockets/             ← flujo de llamadas, sin montar (ver más abajo)
    └── routes/              ← auth, campanas, contactos, cdrs, admin, supervisor
```

## Seguridad

- **WebSocket autenticado**: todo mensaje distinto de `IDENTIFICAR` y `PING` exige sesión establecida; `IDENTIFICAR` verifica el JWT y toma de ahí el rol y el id, nunca del cliente.
- **Rate-limit de login** por cuenta, no por IP: detrás del túnel todos comparten IP.
- **CORS por lista blanca** desde `CORS_ORIGIN`, con respaldo a localhost y LAN si no se define.
- **Cuentas admin protegidas**: solo un admin puede editar o desactivar a otro admin. `ROLES_ASIGNABLES` limita además qué rol puede asignar cada quien.
- **Errores 5xx sanitizados**: no se devuelve `err.message` al cliente.
- **`/uploads` con JWT**: las grabaciones no son accesibles por URL directa.
- **`HOST=127.0.0.1` por defecto**: el acceso externo entra por el túnel de Cloudflare, en la misma VM.

## Scripts

| Script | Uso |
|---|---|
| `npm start` | Arranca el servidor |
| `npm run seed:catalogo` | Siembra tipificaciones (seguro en producción) |
| `npm run seed:demo` | Datos de prueba — bloqueado con `NODE_ENV=production` |
| `npm run migrate:deploy` | Aplica migraciones pendientes |
| `npm run migrate:status` | Estado del esquema |

## Deuda técnica abierta

- [ ] `sockets/call.socket.js` y `services/call.service.js` quedaron sin montar: el namespace `/calls` no autenticaba el handshake y ningún cliente lo consumía. Retomar el flujo exige autenticarlo primero.
- [ ] Aislamiento por equipo a medias en el WS: se aplica a `AUDIO_CHUNK`, pero `ESTADO_ASESOR` y `METRICAS_ASESOR` siguen difundiéndose a todos los supervisores.
- [ ] `MARCAR_CLIENTE` y `REMOTE_DIAL` no comprueban que el asesor destino sea del equipo del supervisor.
- [ ] `TIPIFICACION_REALIZADA` no verifica rol: un asesor autenticado puede difundir eventos arbitrarios al panel del supervisor.
- [ ] Vulnerabilidades npm arrastradas por `exceljs@3`; subir a `exceljs@4` requiere QA de los reportes xlsx.
- [ ] CI no instala, audita ni prueba este directorio. `npm test` sigue en `exit 1`.
- [ ] Logging por `console`, sin niveles ni rotación; el login registra el email en claro.
- [ ] Rutas de supervisor sin verificación de pertenencia (IDOR): `supervisor.routes.js:384`, `/cartera*`, `/bitacora`.
- [ ] Estado del WS en memoria del proceso: no sobrevive a un reinicio ni admite una segunda instancia.
- [ ] `CREATE TABLE IF NOT EXISTS sub_gestiones` sigue ejecutándose en cada arranque, fuera del control de migraciones.

## Despliegue

Ver [`deploy/RUNBOOK.md`](../deploy/RUNBOOK.md).
