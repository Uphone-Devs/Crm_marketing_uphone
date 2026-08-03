# Runbook de despliegue — backend CRM Marketing Uphone

**Destino:** VM de Azure con **Windows Server 2022 Datacenter** · **PostgreSQL 16** en la misma VM · exposición por **Cloudflare tunnel** (servicio `cloudflared` ya activo) · **base de datos ya poblada**.

**Qué se despliega:** únicamente `backend/`. El cliente Electron se distribuye aparte y no cambia en esta entrega — los parches son todos del lado servidor.

**Estado actual de la VM (relevado el 2026-08-03):**

- El backend **se arranca a mano**: no hay servicio ni tarea programada. Si se cierra la sesión de Bastion, la API cae. Este runbook lo convierte en servicio.
- Los asesores entran **solo por el túnel**, así que el backend puede escuchar en loopback.
- Puerto `3001` escuchando hoy en `0.0.0.0`; `5432` también.
- Conviven dos Node: `C:\Program Files\nodejs` (v20.18.0) y `F:\node22`.
- Espacio en `C:` reducido (~4 GB libres): los respaldos van a `F:`.

> **La base tiene datos productivos.** Nada de este runbook se ejecuta sin haber completado el paso 1 (respaldo verificado). El paso 4 puede obligar a detener el despliegue.

Todos los comandos son de **PowerShell como administrador**, salvo donde se indique.

---

## 0. Obtener este código

La rama `fix/migracion-mensajes-broadcast` ya está mergeada. Desplegar desde `main`.

```powershell
git clone https://github.com/Uphone-Devs/Crm_marketing_uphone.git C:\crm
Set-Location C:\crm
git log --oneline -3
```

Si el repositorio ya está en la VM, basta con actualizar (paso 3).

---

## 0.1 Prerrequisitos

| Requisito | Comprobación | Nota |
|---|---|---|
| Node ≥ 20.19 | `& "F:\node22\node.exe" -v` | **v20.18.0 de `C:\Program Files\nodejs` NO sirve**: Prisma 7 exige `^20.19 \|\| ^22.12 \|\| >=24` |
| PostgreSQL 16 | `Get-Service postgresql-x64-16` | Running / Automatic |
| NSSM | `Test-Path C:\nssm\nssm.exe` | Descargar de nssm.cc si falta |
| cloudflared | `Get-Service cloudflared` | Ya activo |
| Espacio en `F:` | `Get-PSDrive F` | Debe superar 2× el tamaño de la base |

**Sobre las dos versiones de Node:** confirma cuál usa el proceso actual antes de seguir.

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, ExecutablePath,
    @{n='Cmd';e={ $_.CommandLine.Substring(0, [Math]::Min(120, $_.CommandLine.Length)) }} |
  Format-Table -Wrap -AutoSize
```

El servicio se registrará con el binario que cumpla la versión mínima. Si `F:\node22` resulta ser < 20.19, hay que actualizar Node antes de continuar.

---

## 1. Respaldo (obligatorio, antes de todo)

Primero, medir. Con solo ~4 GB libres en `C:`, el destino del dump es `F:`.

```powershell
$env:PGPASSWORD = 'PASSWORD_DE_POSTGRES'
$PG = 'C:\Program Files\PostgreSQL\16\bin'

& "$PG\psql.exe" -U postgres -h 127.0.0.1 -c `
  "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE datname NOT IN ('template0','template1');"
```

Anota el nombre y el tamaño. El restore de prueba **duplica** la base: necesitas espacio para el dump más una copia completa.

```powershell
$DB    = 'crm_marketing'          # ajustar al nombre real
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
New-Item -ItemType Directory -Force -Path F:\backups | Out-Null
$dump  = "F:\backups\${DB}_$stamp.dump"

& "$PG\pg_dump.exe" -U postgres -h 127.0.0.1 -F c -d $DB -f $dump
Get-Item $dump | Select-Object FullName, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
```

**Probar que restaura.** Un `.dump` que nadie verificó no es un respaldo.

```powershell
& "$PG\createdb.exe" -U postgres -h 127.0.0.1 crm_restore_test
& "$PG\pg_restore.exe" -U postgres -h 127.0.0.1 -d crm_restore_test $dump

& "$PG\psql.exe" -U postgres -h 127.0.0.1 -d crm_restore_test -c "SELECT count(*) FROM usuarios;"
& "$PG\psql.exe" -U postgres -h 127.0.0.1 -d crm_restore_test -c "SELECT count(*) FROM contactos;"

& "$PG\dropdb.exe" -U postgres -h 127.0.0.1 crm_restore_test
```

Si `pg_restore` da errores o los conteos salen en cero, **detener el despliegue**.

```powershell
Remove-Item Env:\PGPASSWORD
```

---

## 2. Ventana y aviso

El paso 6 rota `JWT_SECRET`, lo que **invalida todas las sesiones activas**: los asesores conectados verán "sesión expirada" y deberán volver a entrar. Ejecutar fuera de horario de gestión y avisar a la operación.

---

## 3. Traer el código

Parar primero el proceso manual, si sigue corriendo. Identifícalo por su línea de comando (la del paso 0.1) y detén **solo** ese PID: hay otros procesos `node` en la máquina.

```powershell
Stop-Process -Id <PID_DEL_BACKEND> -Force

Set-Location C:\crm
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -3
```

---

## 4. Estado de las migraciones (paso más delicado)

El repositorio trae `backend\prisma\migrations\` con el historial completo. **El riesgo no es que falten: es que la base productiva no tenga registro de haberlas aplicado.** Si `_prisma_migrations` está vacía o no existe, `migrate deploy` intentará ejecutarlas todas sobre datos reales.

```powershell
$env:PGPASSWORD = 'PASSWORD_DE_POSTGRES'
$PG = 'C:\Program Files\PostgreSQL\16\bin'

& "$PG\psql.exe" -U postgres -h 127.0.0.1 -d $DB -c `
  "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;"
```

Tres desenlaces:

**A) Lista las 13 migraciones.** Estado normal. Continuar al paso 5.

**B) Error `relation does not exist`, o lista incompleta.** La base se construyó fuera de Prisma. **No ejecutar `migrate deploy`.** Hay que adoptar el historial marcando como aplicada cada migración que la base ya refleja, sin ejecutar su SQL:

```powershell
Set-Location C:\crm\backend
$env:DATABASE_URL = 'postgresql://usuario:password@127.0.0.1:5432/crm_marketing?schema=public'

npx prisma migrate resolve --applied 20260629200721_init
npx prisma migrate resolve --applied 20260703000001_add_missing_columns
# ...continuar con el resto, en orden
```

Marcar solo las que la base **realmente** refleja, verificando antes con `\d` sobre las tablas que toca cada una. Los nombres exactos están en `backend\prisma\migrations\`.

**C) Faltan solo las recientes.** Aplicar únicamente las pendientes (paso 5), tras revisar su SQL.

Comprobar además la deriva entre schema y base:

```powershell
Set-Location C:\crm\backend
npx prisma migrate diff --from-url $env:DATABASE_URL --to-schema-datamodel prisma\schema.prisma --script
```

Salida vacía significa que coinciden. Si aparecen `ALTER`/`CREATE`, **detener** y revisar cada sentencia antes de seguir.

Y la tabla que se crea sola en cada arranque, fuera de migraciones:

```powershell
& "$PG\psql.exe" -U postgres -h 127.0.0.1 -d $DB -c "\d sub_gestiones"
```

> Ya no quedan archivos `.sql` sueltos en `migrations\`. Los tres que había no los ejecutaba `migrate deploy` por no seguir el formato de directorio. `add_validacion_tables.sql` estaba cubierto por `20260725000001_add_missing_tables`; los otros dos se reemplazaron por `20260801000001_mensajes_broadcast_canal_asunto_imagen`, que es idempotente.

---

## 5. Aplicar migraciones pendientes

Solo después de que el paso 4 haya dejado el historial consistente.

```powershell
Set-Location C:\crm\backend
npx prisma migrate status
npx prisma migrate deploy
npx prisma migrate status    # debe decir: Database schema is up to date
```

Comprobar las columnas del módulo de mensajes — es lo que rompía antes, porque `schema.prisma` las declaraba y ninguna migración formal las creaba:

```powershell
& "$PG\psql.exe" -U postgres -h 127.0.0.1 -d $DB -c "\d mensajes_broadcast"
```

Deben aparecer `canal`, `asunto` e `imagen_url`. Si falta alguna, el módulo de mensajería falla entero: Prisma hace `SELECT` explícito de todas las columnas del modelo.

> **No existe `POST /api/admin/run-migrations`.** Esa ruta se retiró: aplicaba DDL por HTTP, duplicando `20260729000000_perf_indexes` y `20260729000001_metricas_diarias_asesor` y dejando la base fuera del historial de Prisma. El único camino para el esquema es `migrate deploy`.

---

## 6. Configurar el entorno

```powershell
Set-Location C:\crm\backend
Copy-Item .env.example .env
notepad .env
```

Completar `DATABASE_URL`, `JWT_SECRET` (`openssl rand -hex 64`, o `[Convert]::ToHexString((New-Object byte[] 64 | % { (New-Object Random).NextBytes($_); $_ }))`) y `CORS_ORIGIN` con el hostname del túnel.

**Dejar `HOST=127.0.0.1`.** Los asesores entran por el túnel, que corre en esta misma VM y conecta a loopback. Esto además cierra la exposición actual del 3001 en `0.0.0.0`.

Restringir permisos del archivo, que contiene la contraseña de la base:

```powershell
icacls .env /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(R)"
```

El proceso **no arranca** si falta `DATABASE_URL`, `JWT_SECRET`, o `CORS_ORIGIN` con `NODE_ENV=production`. Es intencional.

---

## 7. Instalar dependencias

```powershell
Set-Location C:\crm\backend
& "F:\node22\node.exe" --version     # confirmar >= 20.19
npm ci --omit=dev
npx prisma generate
```

Ya no hay módulos nativos: se eliminaron `better-sqlite3`, su adapter, `@aws-sdk/*` y `socket.io`, que estaban declarados sin uso. No hace falta toolchain de compilación.

---

## 8. Catálogo de tipificaciones

Idempotente, seguro de repetir:

```powershell
Set-Location C:\crm\backend
npm run seed:catalogo
```

**Nunca** ejecutar `npm run seed:demo` en la VM: crea diez cuentas con contraseña pública y 50 deudores ficticios. El script se niega a correr con `NODE_ENV=production`, pero conviene no invocarlo igualmente.

---

## 9. Servicio de Windows

Hoy el backend se arranca a mano y muere al cerrar la sesión. Este paso lo convierte en servicio con arranque automático.

```powershell
Set-Location C:\crm
.\deploy\instalar-servicio-windows.ps1 `
  -RutaBackend 'C:\crm\backend' `
  -NodeExe     'F:\node22\node.exe' `
  -NssmExe     'C:\nssm\nssm.exe' `
  -RutaLogs    'F:\logs\crm-backend'

Start-Service crm-backend
Get-Service crm-backend
Get-Content F:\logs\crm-backend\salida.log -Tail 20
```

Esperado: `🚀 API + WebSocket escuchando en 127.0.0.1:3001 (NODE_ENV=production)`.

**Por qué NSSM y no `sc.exe`:** al detener, NSSM envía Ctrl+C, que Node traduce a **SIGINT** y dispara el cierre ordenado (cierra el servidor HTTP y drena el pool de Prisma). `sc.exe` mata el proceso sin aviso y deja conexiones colgadas en `pg_stat_activity`.

> **Windows no emite SIGTERM.** El handler de `SIGTERM` del código solo actúa en Linux; aquí el que se ejecuta es el de `SIGINT`. Por eso `AppStopMethodConsole` es obligatorio en la configuración del servicio.

El servicio depende de `postgresql-x64-16`, así que tras reiniciar la VM arranca en el orden correcto.

---

## 10. Túnel Cloudflare

`cloudflared` ya corre como servicio automático. Verificar que sea un **named tunnel** y no un quick tunnel, cuya URL rota en cada reinicio (issue C3 de `docs/KNOWN-ISSUES.md`):

```powershell
Get-Service cloudflared
Get-Content "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml" -ErrorAction SilentlyContinue
Get-ChildItem "$env:USERPROFILE\.cloudflared" -ErrorAction SilentlyContinue
```

Si el `ingress` no apunta a `http://127.0.0.1:3001`, corregirlo y reiniciar el servicio. `deploy\cloudflared-config.yml` sirve de plantilla.

Tras cambiar `HOST` a `127.0.0.1`, confirmar que el túnel sigue alcanzando el backend (verificación 1 del paso 12).

---

## 11. Red

Con el túnel, la VM **no necesita puertos públicos**.

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3001,5432 } |
  Select-Object LocalAddress, LocalPort | Format-Table -AutoSize
```

Tras el paso 9, el `3001` debe aparecer solo en `127.0.0.1`. El `5432` sigue en `0.0.0.0`: restringirlo en `postgresql.conf` (`listen_addresses = 'localhost'`) o, como mínimo, con regla de firewall.

```powershell
New-NetFirewallRule -DisplayName "Bloquear PostgreSQL externo" `
  -Direction Inbound -LocalPort 5432 -Protocol TCP -Action Block -Profile Any
```

En el NSG de Azure: sin reglas de entrada para 3001 ni 5432. Dejar solo el acceso administrativo restringido por IP.

---

## 12. Verificación post-deploy

Ejecutar en orden. Cualquier fallo detiene la puesta en producción.

```powershell
$HOST_PUB = 'https://crm.tu-dominio.com'
```

| # | Comprobación | Comando | Esperado |
|---|---|---|---|
| 1 | Liveness por el túnel | `Invoke-RestMethod "$HOST_PUB/live"` | `status = OK` |
| 2 | Readiness con base | `Invoke-RestMethod "$HOST_PUB/health"` | `db = up` |
| 3 | CORS rechaza origen ajeno | `(Invoke-WebRequest "$HOST_PUB/live" -Headers @{Origin='https://atacante.example'}).Headers['Access-Control-Allow-Origin']` | vacío |
| 4 | Login funciona | `Invoke-RestMethod "$HOST_PUB/api/auth/login" -Method POST -ContentType 'application/json' -Body '{"email":"...","password":"..."}'` | devuelve `token` |
| 5 | Rate-limit de login | 25 intentos fallidos con el mismo email | `429` desde el intento 21 |
| 6 | WS sin autenticar | conectar y enviar `{"tipo":"ESTADO_ASESOR"}` | `{"tipo":"ERROR","mensaje":"No autenticado"}` |
| 7 | WS con token válido | enviar `{"tipo":"IDENTIFICAR","rol":"ASESOR","token":"..."}` | no cierra la conexión |
| 8 | Migraciones al día | `npx prisma migrate status` | `Database schema is up to date` |
| 9 | Cierre ordenado | `Restart-Service crm-backend` y revisar el log | `[APP] SIGINT recibido` y `[APP] Cierre limpio`, sin `Cierre forzado` |
| 10 | Sin conexiones colgadas | `psql -c "SELECT count(*) FROM pg_stat_activity WHERE datname='crm_marketing';"` | vuelve al valor previo |
| 11 | Puerto no expuesto | `Get-NetTCPConnection -LocalPort 3001 -State Listen` | solo `127.0.0.1` |
| 12 | Escalada de privilegios cerrada | con token `jefe_area`: `POST /api/admin/users` con `"rol":"admin"`, y `PUT /api/admin/users/<id-admin>` con `"rol":"asesor"` | `403` en ambos |
| 13 | Auto-update apagado | `psql -c "SELECT enabled, start_time, end_time, days FROM update_policy;"` | `enabled = f` |
| 14 | Columnas de mensajería | `psql -c "\d mensajes_broadcast"` | aparecen `canal`, `asunto`, `imagen_url` |
| 15 | Arranque automático | `Restart-Computer`, y al volver `Get-Service crm-backend` | `Running` sin intervención |

**El punto 9 no se había podido probar hasta ahora**: el entorno de desarrollo es Windows y no emite SIGTERM. Aquí se verifica el camino real, que es SIGINT vía NSSM.

**Si el punto 13 devuelve `enabled = t`, detener y revisar §13.1** antes de dejarlo encendido.

**Si el punto 14 no muestra las tres columnas**, el módulo de mensajería fallará entero. Volver al paso 5.

---

## 13. Cliente Electron

No requiere reinstalación por estos cambios. Sí requiere que la URL del servidor apunte al túnel:

1. Panel Admin → campo de URL de la VM → `https://crm.tu-dominio.com`
2. El cliente deriva solo el WebSocket a `wss://crm.tu-dominio.com/?token=...` (`src/renderer/shared/apiClient.js`, `AsesorPanel.jsx:928`).

Ningún cambio de esta entrega toca el protocolo cliente↔servidor: el WebSocket sigue autenticándose en el mensaje `IDENTIFICAR`.

### 13.1 Auto-update: qué se despliega y qué no

**Este despliegue no actualiza ningún cliente.** Instala el mecanismo, apagado.

Lo que entra: la tabla `update_policy` (migración `20260728000000_add_update_policy`) y los endpoints `GET`/`PUT /api/admin/update-policy`.

Lo que **no** ocurre, por dos cortes independientes:

1. `enabled` es `false` por defecto en el schema. El `GET` crea la fila con los valores por defecto (ventana 13:00–14:00, lunes a viernes, cada 30 min, hora de Guayaquil) y `isDentroDeVentana` corta en seco cuando `enabled` es falso (`src/main/updateWindow.js:37`).
2. El binario no sale de este backend. `electron-builder.yml` publica contra `https://crm.anomalydevs.qzz.io/updates/`, otro host. Sin un `latest.yml` y un `.exe` de versión superior ahí, `checkForUpdates()` no encuentra nada.

Flujo completo: `LoginPage.jsx:74` invoca `updater:start` tras el login → `src/main/updater.js` consulta la política cada `checkIntervalMin` → si está habilitada y dentro de la ventana, llama a `autoUpdater.checkForUpdates()`.

**Antes de poner `enabled: true`, resolver tres cosas:**

- **Los instaladores no están firmados.** El script de build fija `CSC_IDENTITY_AUTO_DISCOVERY=false` y `publish.provider` es `generic`. Con auto-update activo, quien controle ese dominio o su DNS puede empujar un ejecutable a todas las PCs de cobranza, y `electron-updater` lo instalará sin verificar firma.
- **Alinear el versionado.** `package.json` está en `3.0.0` y la documentación habla de "Versión 4.0". Si la versión publicada no supera a la instalada, no pasa nada y el fallo es silencioso.
- **Probar con una sola máquina primero**, con una ventana corta, antes de abrirla a la flota.

---

## 14. Rollback

```powershell
Stop-Service crm-backend
Set-Location C:\crm
git checkout <commit-anterior>
Set-Location C:\crm\backend
npm ci --omit=dev
npx prisma generate
Start-Service crm-backend
```

Restaurar la base **solo** si el paso 4 o 5 alteró el esquema:

```powershell
Stop-Service crm-backend
$env:PGPASSWORD = 'PASSWORD_DE_POSTGRES'
$PG = 'C:\Program Files\PostgreSQL\16\bin'
& "$PG\dropdb.exe"   -U postgres -h 127.0.0.1 $DB
& "$PG\createdb.exe" -U postgres -h 127.0.0.1 $DB
& "$PG\pg_restore.exe" -U postgres -h 127.0.0.1 -d $DB F:\backups\<archivo>.dump
Start-Service crm-backend
```

Volver a un commit anterior al endurecimiento reabre agujeros ya cerrados (rutas de admin, DDL por HTTP). Si hace falta, detener también `cloudflared` hasta reponer la versión corregida.

---

## 15. Pendientes que este despliegue NO resuelve

- **`GET /api/admin/backup.dump`** descarga el dump completo de la base con una sola credencial admin, por el túnel público. Es exfiltración de los datos de todos los deudores en una petición. Conviene rate-limit, auditoría de cada descarga, o restricción por red.
- **`GET /api/admin/update-policy` es público y además escribe**: hace `upsert`, así que cualquiera sin credenciales puede crear la fila `id=1`.
- **Instaladores sin firmar con auto-update por `provider: generic`** (§13.1). Mientras `update_policy.enabled` siga en `false` no hay exposición, pero es la condición a resolver antes de activarlo.
- **`hotfix/cdrs-indexes` sin mergear** (índices en `cdrs`, reescritura de `cartera-equipo` con carga lazy). Revisar solape con `20260801000000_cdrs_index_optimize`.
- **Aislamiento por equipo a medias en el WebSocket**: se aplica a `AUDIO_CHUNK`, pero `ESTADO_ASESOR` y `METRICAS_ASESOR` van a todos los supervisores. `MARCAR_CLIENTE` y `REMOTE_DIAL` no comprueban el equipo del asesor destino. `TIPIFICACION_REALIZADA` no verifica rol.
- **Dos instalaciones de Node conviviendo** (`C:\Program Files\nodejs` v20.18.0 y `F:\node22`). La primera no cumple el mínimo de Prisma 7. Conviene unificar para que nadie arranque el backend con la equivocada.
- **`5432` escuchando en `0.0.0.0`**: restringir `listen_addresses` en `postgresql.conf`.
- **Espacio en `C:` (~4 GB)**: vigilar; los respaldos y logs se dirigen a `F:` por eso.
- **Vulnerabilidades npm** arrastradas por `exceljs@3`; subir a `exceljs@4` requiere QA de los reportes xlsx.
- **CI no cubre `backend/`**: sigue sin instalar, auditar ni probar el código que corre en la VM.
- **`pg_dump` programado**: el respaldo del paso 1 es manual y puntual; falta la tarea recurrente y la definición de RPO/RTO.
