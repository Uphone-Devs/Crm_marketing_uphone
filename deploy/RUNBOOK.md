# Runbook de despliegue — backend CRM Marketing Uphone

> **Reescrito 2026-08-03.** La versión anterior describía un despliegue Linux
> (`/opt/crm`, systemd, `sudo -u crm`) que **no corresponde a la VM real**. Si un agente
> te cita pasos con `systemctl`, está leyendo la versión vieja de este archivo.

**Destino:** una sola VM de Azure con **Windows Server**. PostgreSQL en la misma VM.
Proceso administrado por **PM2** corriendo como servicio de Windows.

**Qué se despliega:** únicamente `backend/`. El cliente Electron se distribuye aparte.

---

## 0. Contexto crítico — esta VM aloja DOS CRMs

| | terminal-cobranza | CRM Marketing (este repo) |
|---|---|---|
| Repo | `tonyrecaldeuph/Terminal-cobranza-Uphone` | `Uphone-Devs/Crm_marketing_uphone` |
| Código en la VM | `F:\cobranza\app` | *(determinar — paso 2)* |
| Base | SQLite `F:\cobranza\data\terminal.db` | PostgreSQL |
| Proceso | PM2 (servicio de Windows) | PM2 |
| Puerto por defecto | `PORT \|\| 3001` | `PORT \|\| 3001` ← **mismo** |

CRM Marketing es un **fork** de terminal-cobranza. Comparten estructura, nombres de
archivo y puerto por defecto. Es fácil confundir uno con otro: verificá siempre en qué
directorio estás parado.

**Reglas que no se negocian:**

1. **Nunca** ejecutar `npm ci` ni `npm install` en la raíz de ningún repo de la VM. Solo
   dentro de `backend/`. La raíz arrastra `better-sqlite3` (módulo nativo) y recompilarlo
   puede dejar a terminal-cobranza sin poder arrancar.
2. **Nunca** cambiar la versión de Node instalada globalmente sin avisar. `better-sqlite3`
   está compilado contra el ABI actual; al subir Node, terminal-cobranza revienta con
   `NODE_MODULE_VERSION mismatch` en su próximo reinicio — que puede ser horas después.
3. Antes de levantar este backend, confirmar que su `PORT` **no** es el que ya usa
   terminal-cobranza.
4. Si PostgreSQL es un cluster compartido, cualquier cambio en `postgresql.conf` que
   exija reiniciar el motor (p. ej. `shared_preload_libraries`) **baja los dos CRMs**.
   Ese reinicio se agenda, no se improvisa.

---

## 1. Estado real de las ramas (verificado 2026-08-03)

- `fix/predeploy-hardening` → **ya está mergeada en `main`**. No hay nada pendiente ahí.
  (La versión anterior de este runbook decía lo contrario. Era falso.)
- `hotfix/cdrs-indexes` → **no desplegar**. Es el enfoque descartado de `cartera-equipo`;
  `main` se quedó con `559f59c`. Además su carpeta `20260729000001_add_cdrs_indexes`
  colisiona en prefijo con `20260729000001_metricas_diarias_asesor`.
- `fix/campana-empresa-y-backfill` → contiene la migración `20260729000002` y el script
  de backfill. **Debe estar mergeada en `main` antes de desplegar** (ver pasos 7 y 8).
- Ramas de dependabot → ninguna es requisito de este despliegue.

Confirmá antes de empezar que lo que vas a desplegar incluye la migración
`20260729000002_add_campana_empresa`:

```powershell
git log --oneline -3
Test-Path backend\prisma\migrations\20260729000002_add_campana_empresa\migration.sql
```

Si devuelve `False`, **detené el despliegue**: sin esa columna, `POST /api/campanas`,
`POST /api/campanas/:id/contactos` y `GET /api/campanas/dashboard` fallan para cualquier
campaña, no solo CREDI_TV.

---

## 2. Descubrimiento del entorno (hacer siempre, anotar la salida)

Nada de lo que sigue asume rutas. Sacalas de acá:

```powershell
# Qué corre hoy bajo PM2 y desde dónde
pm2 list
pm2 describe <nombre-app>        # anotar: cwd, script, interpreter, exec_mode

# Puertos ocupados
netstat -ano | findstr ":3001 :3002 :5432"

# PostgreSQL: ¿un cluster o varios?
Get-Service -Name "postgresql*"
psql -U postgres -c "\l"

# Versión de Node (no tocarla)
node -v
```

Guardá esta salida antes de cambiar nada. Es tu punto de comparación si algo se rompe.

---

## 3. Respaldo — obligatorio, antes de todo

**Las dos bases**, no solo la de este CRM. El runbook anterior ignoraba que existe una
segunda.

```powershell
$fecha = Get-Date -Format "yyyy-MM-dd_HHmm"

# PostgreSQL (CRM Marketing)
pg_dump -U postgres -Fc crm_marketing -f "F:\backups\crm_marketing_$fecha.dump"

# SQLite (terminal-cobranza) — copia con el API detenido o vía sqlite3 .backup
Copy-Item F:\cobranza\data\terminal.db "F:\backups\terminal_$fecha.db"
```

Verificar que el dump de Postgres **restaura**, no solo que el archivo pesa:

```powershell
psql -U postgres -c "CREATE DATABASE crm_restore_test;"
pg_restore -U postgres -d crm_restore_test "F:\backups\crm_marketing_$fecha.dump"
psql -U postgres -d crm_restore_test -c "SELECT count(*) FROM usuarios;"
psql -U postgres -c "DROP DATABASE crm_restore_test;"
```

Si el restore falla, **detener el despliegue**.

---

## 4. Ventana y aviso

Este despliegue **no requiere ventana de caída** si el paso 7 se hace como está escrito.

Sí requiere aviso si vas a rotar `JWT_SECRET`: eso invalida todas las sesiones activas y
los asesores verán "sesión expirada". Rotarlo es opcional en un despliegue de rutina.

---

## 5. Traer el código

```powershell
cd <ruta-del-repo-marketing-en-la-VM>     # del paso 2
git fetch origin
git status                                 # el árbol debe estar limpio
git checkout main
git pull --ff-only origin main
git log --oneline -1
```

Si `git status` muestra cambios locales, **pará y averiguá qué son** antes de pisarlos.

---

## 6. Dependencias

```powershell
cd <repo>\backend
npm ci --omit=dev
npx prisma generate
```

`prisma generate` es **obligatorio** en este despliegue: `schema.prisma` cambió (campo
`Campana.empresa`). Si lo salteás, el cliente Prisma no conoce la columna y las rutas de
campañas siguen fallando aunque la migración haya corrido.

Recordatorio del paso 0: `npm ci` acá dentro, nunca en la raíz.

---

## 7. Migraciones — el paso delicado

### 7.1 Qué sabe la base

```powershell
$env:DATABASE_URL = "postgresql://..."
psql "$env:DATABASE_URL" -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;"
```

Si la tabla no existe o está incompleta, la base se construyó fuera de Prisma. **No
ejecutes `migrate deploy` todavía**: adoptá el historial marcando como aplicada cada
migración que la base ya refleja, verificando antes con `\d` que sus tablas/columnas
existan de verdad:

```
20260629200721_init
20260703000001_add_missing_columns
20260708000001_add_meta_diaria_campanas
20260708000002_add_scheduled_datetime_to_cdrs
20260709140000_remove_supervisor_role
20260725000000_llave_empresa
20260725000001_add_missing_tables
20260725000002_empresa_credi_tv
20260728000000_add_update_policy
```

```powershell
npx prisma migrate resolve --applied <nombre>
```

`add_validacion_tables.sql` está suelto, fuera del formato de directorio de Prisma:
revisá a mano si sus tablas existen.

### 7.2 ⚠️ Trampa de los índices — leer antes de correr `migrate deploy`

`20260729000000_perf_indexes` crea índices con `CREATE INDEX` **sin `CONCURRENTLY`**.
Sobre `cdrs` (90k+ filas) eso toma un lock que **bloquea escrituras**: los asesores no
pueden guardar gestiones mientras se construye. Es el síntoma exacto del incidente del
29-07.

Peor: `IF NOT EXISTS` compara por **nombre**, no por columnas. Si la base ya tiene
`idx_cdrs_usuario_timestamp` / `idx_cdrs_contacto_id` (los nombres del hotfix del 29-07),
la migración igual va a construir `idx_cdrs_usuario_ts` / `idx_cdrs_contacto` sobre las
**mismas columnas** — bloqueo de escrituras ahora, y dos índices redundantes por columna
para siempre, con doble overhead en cada `INSERT` a `cdrs`.

**Averiguá qué hay realmente:**

```powershell
psql "$env:DATABASE_URL" -c "SELECT tablename, indexname FROM pg_indexes WHERE tablename IN ('cdrs','contactos','eventos','validacion_pagos','usuarios') ORDER BY tablename, indexname;"
```

**En cualquiera de los dos casos, el procedimiento es el mismo:** creá a mano solo los
índices que falten, uno por comando y con `CONCURRENTLY` (no admite transacción), y
después marcá la migración como aplicada sin ejecutarla:

```powershell
psql "$env:DATABASE_URL" -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ct_telefono ON contactos (telefono);"
# ...repetir solo para los que falten, según la lista de la migración
npx prisma migrate resolve --applied 20260729000000_perf_indexes
```

Nunca dejes que `migrate deploy` construya estos índices en horario de gestión.

### 7.3 Aplicar el resto

Las dos migraciones restantes son seguras en caliente:

- `20260729000001_metricas_diarias_asesor` → `CREATE TABLE IF NOT EXISTS` sobre tabla
  nueva. Sin impacto.
- `20260729000002_add_campana_empresa` → `ADD COLUMN IF NOT EXISTS` nullable sin default:
  instantáneo en PG 11+, no reescribe la tabla. El índice va sobre `campanas`, que es
  chica.

```powershell
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status    # debe decir: Database schema is up to date
```

Comprobación de deriva final:

```powershell
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

Salida vacía = coinciden. Si aparecen `ALTER`/`CREATE`, **detener** y revisar.

---

## 8. Backfill de métricas diarias

`metricas_diarias_asesor` nace vacía. El upsert incremental (`PATCH /api/cdrs/:id`) solo
suma hacia adelante, así que `/jefe/tendencia-semanal` mostraría **$0 en los últimos 6
días** hasta acumular datos nuevos.

```powershell
cd <repo>
node backend\scripts\backfill-metricas-diarias.js
```

Idempotente (`ON CONFLICT DO UPDATE` recalcula, no suma) — se puede repetir sin duplicar.

**Qué esperar:** el backfill agrega el estado *actual* de cada CDR; el upsert en vivo
suma +1 por cada PATCH con `tipificacionId`. Si hubo re-tipificaciones históricas, los
números no cuadran centavo a centavo con lo que el incremental habría acumulado. El
backfill refleja el estado real de `cdrs` y es el punto de partida más confiable.

**Nota:** si en algún momento se usó `POST /api/admin/run-migrations`, ese endpoint corrió
un backfill con `ON CONFLICT DO NOTHING` y sin filtrar por `tipificacion_id`, dejando
filas en cero. Correr este script las corrige.

---

## 9. Configuración

```powershell
cd <repo>\backend
Copy-Item .env.example .env
notepad .env
```

Completar:

| Variable | Nota |
|---|---|
| `DATABASE_URL` | El usuario debe ser dueño del esquema para aplicar migraciones |
| `JWT_SECRET` | Mínimo 32 chars. Rotarlo invalida las sesiones activas |
| `PORT` | **Verificar que no choque con terminal-cobranza** (paso 2) |
| `HOST` | `.env.example` sugiere `0.0.0.0`; el default del código es `127.0.0.1`. Usar loopback salvo que el acceso externo lo exija explícitamente |
| `CORS_ORIGIN` | El origen real desde el que entran los clientes |

El proceso **no arranca** si falta `DATABASE_URL`, `JWT_SECRET` o `CORS_ORIGIN` con
`NODE_ENV=production`. Es intencional.

---

## 10. Catálogo de tipificaciones

Idempotente, seguro de repetir:

```powershell
cd <repo>\backend
npm run seed:catalogo
```

**Nunca** ejecutar `npm run seed:demo` en la VM: crea 10 cuentas con contraseña pública y
50 deudores ficticios. El script se niega a correr con `NODE_ENV=production`, pero no lo
invoques igual.

---

## 11. Arranque bajo PM2

```powershell
cd <repo>\backend
pm2 start src/index.js --name crm-marketing-api
pm2 save
pm2 logs crm-marketing-api --lines 40
```

Esperado en el log:
`🚀 API + WebSocket escuchando en <HOST>:<PORT> (NODE_ENV=production)`

Si la app ya existía: `pm2 restart crm-marketing-api --update-env`.

`pm2 save` es lo que hace que sobreviva al reinicio de la VM. Sin eso, el servicio de
Windows levanta PM2 vacío.

---

## 12. Verificación post-deploy

Cualquier fallo detiene la puesta en producción.

| # | Comprobación | Esperado |
|---|---|---|
| 1 | `curl http://127.0.0.1:<PORT>/live` | `{"status":"OK",...}` |
| 2 | `curl http://127.0.0.1:<PORT>/health` | `{"status":"OK","db":"up",...}` |
| 3 | `POST /api/auth/login` con credencial real | `200` con `token` |
| 4 | **`POST /api/campanas`** con `empresa: "CREDI_TV"` | `201` — es lo que arreglaba este despliegue |
| 5 | `GET /api/campanas/dashboard` | `200`, sin `column c.empresa does not exist` |
| 6 | `GET /jefe/tendencia-semanal` | montos reales, no `$0` en los últimos 6 días |
| 7 | `npx prisma migrate status` | `Database schema is up to date` |
| 8 | CORS rechaza origen ajeno | sin cabecera `access-control-allow-origin` |
| 9 | Rate-limit de login: 25 intentos fallidos seguidos | `429` a partir del intento 21 |
| 10 | WS sin autenticar | `{"tipo":"ERROR","mensaje":"No autenticado"}` |
| 11 | **terminal-cobranza sigue arriba** | `pm2 list` lo muestra `online` y responde en su puerto |
| 12 | **Apagado ordenado bajo PM2.** `pm2 restart crm-marketing-api`, luego `pm2 logs` | `[APP] shutdown (PM2) recibido — cerrando...` seguido de `[APP] Cierre limpio`. **Nunca** `Cierre forzado tras 10s` |
| 13 | **PostgreSQL sin conexiones colgadas** | `SELECT count(*) FROM pg_stat_activity` vuelve al valor del paso 2 |

El punto 11 es el que la versión anterior de este runbook no tenía. Verificalo siempre.

**El punto 12 solo puede probarse en la VM.** Windows no tiene señales POSIX, así que los
handlers `SIGTERM`/`SIGINT` no se ejecutan ahí; el apagado ordenado depende del mensaje
IPC `shutdown` que manda PM2 (`backend/src/index.js:141`). Si en el log aparece
`Cierre forzado` o no aparece ninguna línea `[APP]`, el canal IPC no está llegando:
revisá que la app se haya arrancado con `pm2 start` (no con `node` suelto bajo un
envoltorio) y que `--kill-timeout` sea mayor que los 10s del temporizador de respaldo.

---

## 13. Rollback

```powershell
pm2 stop crm-marketing-api
cd <repo>
git checkout <commit-anterior>
cd backend
npm ci --omit=dev
npx prisma generate
pm2 restart crm-marketing-api
```

Restaurar la base **solo** si el paso 7 alteró el esquema y algo salió mal:

```powershell
pm2 stop crm-marketing-api
psql -U postgres -c "DROP DATABASE crm_marketing;"
psql -U postgres -c "CREATE DATABASE crm_marketing;"
pg_restore -U postgres -d crm_marketing "F:\backups\crm_marketing_<fecha>.dump"
pm2 start crm-marketing-api
```

Volver atrás pierde los parches de seguridad del hardening (el WebSocket vuelve a aceptar
conexiones sin autenticar). Si el rollback se sostiene en el tiempo, cerrá el acceso
externo hasta reponer la versión corregida.

---

## 14. Limpieza post-despliegue

- [ ] **Borrar `POST /api/admin/run-migrations`** (`backend/src/routes/admin.routes.js:368`).
      Está marcado como temporal desde el commit `7a9ea8a`. Ejecuta DDL crudo y corre un
      backfill con semántica distinta a la del script oficial.
- [ ] Decidir sobre los índices redundantes de `cdrs` (ver 7.2). `DROP INDEX CONCURRENTLY`
      del par sobrante, fuera de horario de gestión.
- [ ] Cerrar o borrar la rama `hotfix/cdrs-indexes`.
- [x] ~~Borrar `deploy/crm-backend.service` y `deploy/cloudflared-config.yml`~~ — hecho
      2026-08-03. Eran artefactos de un despliegue Linux que no existe.

---

## 15. Pendientes que este despliegue NO resuelve

- **Aislamiento por equipo a medias en el WebSocket**: se aplica a `AUDIO_CHUNK`, pero
  `ESTADO_ASESOR` y `METRICAS_ASESOR` siguen difundiéndose a todos los supervisores.
- **`MARCAR_CLIENTE` y `REMOTE_DIAL`** no comprueban que el asesor destino pertenezca al
  equipo del supervisor que emite el comando.
- **`TIPIFICACION_REALIZADA`** no verifica rol: un asesor autenticado puede difundir
  eventos arbitrarios al panel del supervisor.
- **IDOR en rutas de supervisor** (`supervisor.routes.js:384`, `/cartera*`, `/bitacora`):
  autenticadas pero sin verificación de pertenencia.
- **Cambio semántico en `gestiones_count`** (`559f59c`): pasó de contar histórico completo
  a contar solo el día de hoy. Confirmar si es intencional.
- **CI no cubre `backend/`**: sigue sin instalar, auditar ni probar el código de la VM.
- **`CREATE TABLE IF NOT EXISTS sub_gestiones`** se ejecuta en cada arranque, fuera del
  control de migraciones.
- **Vulnerabilidades npm** arrastradas por `exceljs@3` en el histórico de dependencias.
- **Sin logging estructurado ni rotación**; el login sigue registrando el email en claro.
- **`pg_dump` programado**: el respaldo del paso 3 es manual y puntual. Falta la tarea
  recurrente y la definición de RPO/RTO.
- **Estado del WebSocket en memoria del proceso**: no sobrevive a un reinicio ni admite
  una segunda instancia.
