# Runbook de despliegue — backend CRM Marketing Uphone

**Destino:** VM de Azure con **Windows Server 2022 Datacenter** · **PostgreSQL 16** en la misma VM · backend en el puerto **3002** · exposición por **Cloudflare tunnel** (servicio `cloudflared` ya activo) · **base de datos ya poblada**.

**Qué se despliega:** únicamente `backend/`. El cliente Electron se distribuye aparte y no cambia en esta entrega — los parches son todos del lado servidor.

**Estado actual de la VM (relevado el 2026-08-03):**

- El backend **se arranca a mano**: no hay servicio ni tarea programada. Si se cierra la sesión de Bastion, la API cae. Este runbook lo convierte en servicio.
- Los asesores entran **solo por el túnel**, así que el backend puede escuchar en loopback.
- El backend usa el puerto **3002**. El `3001` lo ocupa **otro CRM en producción en esta misma VM** (ver aviso de convivencia). `5432` escucha en `0.0.0.0`.
- El backend corre hoy con `F:\node22\node.exe` sobre `F:\crm-backend\app\backend\src\index.js`, ya en `127.0.0.1:3002`. La otra instalación, `C:\Program Files\nodejs` (v20.18.0), **no sirve** para Prisma 7.
- Espacio en `C:` reducido (~4 GB libres). **`F:` aloja los dos CRMs**, el proyecto y los respaldos: medir su margen antes de volcar nada (paso 1).

> **La base tiene datos productivos.** Nada de este runbook se ejecuta sin haber completado el paso 1 (respaldo verificado). El paso 4 puede obligar a detener el despliegue.

Todos los comandos son de **PowerShell como administrador**, salvo donde se indique.

---

## AVISO — esta VM aloja otro CRM en producción

El **CRM de flujo** corre en la misma máquina y ocupa el puerto **3001**. Cuatro consecuencias que hay que respetar durante todo el despliegue:

1. **`PORT=3002` es obligatorio en `backend\.env`.** Si falta, el código cae a 3001 por defecto: o falla con `EADDRINUSE`, o —si el otro CRM estuviera detenido en ese instante— le roba el puerto y lo deja sin poder arrancar, con NSSM reintentando cada 5 segundos. `instalar-servicio-windows.ps1` aborta si `PORT` no está definido o si el puerto ya está ocupado.

2. **No sobrescribir la configuración de `cloudflared`.** El servicio activo casi con seguridad sirve también al otro CRM. `deploy\cloudflared-config.yml` es una **plantilla de referencia**: hay que **añadir** una regla de `ingress` al archivo existente, nunca reemplazarlo. Copiarlo encima tumbaría el túnel del CRM de flujo.

3. **Reiniciar la VM afecta a ambos sistemas.** La verificación 15 (arranque automático) requiere su propia ventana, coordinada con quien opere el otro CRM.

4. **Cuidado con las reglas de firewall y PostgreSQL.** Si el CRM de flujo usa la misma instancia de PostgreSQL, restringir `listen_addresses` o bloquear el 5432 puede dejarlo sin base. Verificar antes de aplicar el paso 11.

5. **El CRM de flujo se gestiona con PM2** (`node_modules\pm2\lib\ProcessContainerFork.js`, bajo el perfil `CLIENT_ADMIN`). **No registres crm_marketing en esa misma instancia de PM2.** Un `pm2 restart all`, `pm2 kill` o `pm2 update` afectaría a los dos sistemas a la vez. Por eso este runbook usa NSSM: deja cada aplicación con su propio ciclo de vida y su propio gestor.

Mapa confirmado de la VM:

| Puerto | Sistema | Binario | Gestor | Bind |
|---|---|---|---|---|
| 3002 | **crm_marketing** (este) | `F:\node22\node.exe` | manual → **NSSM** | `127.0.0.1` |
| 3001 | CRM de flujo | `C:\Program Files\nodejs\node.exe` | PM2 | `0.0.0.0` |

Antes de empezar, identifica qué corre en cada puerto:

```powershell
Get-NetTCPConnection -LocalPort 3001,3002 -State Listen |
  ForEach-Object {
    $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    [PSCustomObject]@{
      Puerto = $_.LocalPort
      PID    = $_.OwningProcess
      Exe    = $p.Path
      Cmd    = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)").CommandLine
    }
  } | Format-List
```

---

## 0. Obtener este código

La rama `fix/migracion-mensajes-broadcast` ya está mergeada. Desplegar desde `main`.

```powershell
git clone https://github.com/Uphone-Devs/Crm_marketing_uphone.git F:\crm-backend\app
Set-Location F:\crm-backend\app
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
| Espacio en `F:` | `Get-PSDrive F` | Compartido con el CRM de flujo. Ver la regla de decision del paso 1 |

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

> **`F:` es disco compartido: ahí viven los dos CRMs.** Llenarlo no es una molestia, es un incidente. Si el data directory de PostgreSQL también está en `F:`, quedarse sin espacio **detiene la base y tumba ambos sistemas**. El restore de prueba duplica la base, así que este paso puede pedir varios GB. Medir antes de escribir nada.

**Primero medir: espacio, tamaño de la base y dónde vive PostgreSQL.**

```powershell
$env:PGPASSWORD = 'PASSWORD_DE_POSTGRES'
$PG = 'C:\Program Files\PostgreSQL\16\bin'

# Espacio libre por unidad
Get-PSDrive -PSProvider FileSystem |
  Select-Object Name, @{n='LibreGB';e={[math]::Round($_.Free/1GB,2)}},
                      @{n='UsadoGB';e={[math]::Round($_.Used/1GB,2)}} | Format-Table -AutoSize

# Tamano de cada base
& "$PG\psql.exe" -U postgres -h 127.0.0.1 -c `
  "SELECT datname, pg_size_pretty(pg_database_size(datname)) AS tam, pg_database_size(datname) AS bytes FROM pg_database WHERE datname NOT IN ('template0','template1') ORDER BY bytes DESC;"

# Donde guarda los datos PostgreSQL: si es F:, el margen es critico
& "$PG\psql.exe" -U postgres -h 127.0.0.1 -c "SHOW data_directory;"
```

**Regla de decisión antes de continuar:**

| Situación | Acción |
|---|---|
| Libre en `F:` > 3× el tamaño de la base | Continuar con el dump en `F:` |
| Libre en `F:` entre 1× y 3× | Hacer el dump, **omitir el restore de prueba en esta VM** y verificarlo en otra máquina |
| Libre en `F:` < 1× | **Detener.** Liberar espacio o volcar a un recurso de red antes de seguir |
| `data_directory` en `F:` y margen ajustado | **Detener.** Ampliar el disco antes de tocar nada |

No sirve de nada respaldar si el propio respaldo provoca la caída que intentabas prevenir.

```powershell
$DB    = 'crm_marketing'          # ajustar al nombre real
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
New-Item -ItemType Directory -Force -Path F:\backups | Out-Null
$dump  = "F:\backups\${DB}_$stamp.dump"

& "$PG\pg_dump.exe" -U postgres -h 127.0.0.1 -F c -Z 9 -d $DB -f $dump
Get-Item $dump | Select-Object FullName, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}

# Margen restante tras el volcado
Get-PSDrive F | Select-Object @{n='LibreGB';e={[math]::Round($_.Free/1GB,2)}}
```

`-Z 9` aplica compresión máxima: en una base de cobranza, mayormente texto, reduce bastante el volcado. Cuesta CPU, que aquí importa menos que el espacio.

**Probar que restaura.** Un `.dump` que nadie verifico no es un respaldo.

> Las consultas usan `count(1)` y no `count(*)` a proposito: PowerShell expande el `*` al pasar argumentos a ejecutables nativos, y psql recibe `count()`, que falla.

> Omitir este bloque si la regla de decision anterior lo indica: `crm_restore_test` ocupa **otra copia completa** de la base en la misma unidad que usan ambos CRMs. Si el margen es ajustado, verificar el dump en otra maquina.

```powershell
& "$PG\createdb.exe" -U postgres -h 127.0.0.1 crm_restore_test
& "$PG\pg_restore.exe" -U postgres -h 127.0.0.1 -d crm_restore_test $dump

& "$PG\psql.exe" -U postgres -h 127.0.0.1 -d crm_restore_test -c "SELECT count(1) FROM usuarios;"
& "$PG\psql.exe" -U postgres -h 127.0.0.1 -d crm_restore_test -c "SELECT count(1) FROM contactos;"

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

Parar primero el proceso manual, si sigue corriendo. Identificalo por su linea de comando (la del paso 0.1) y deten **solo** ese PID.

> **Confirma que el PID escucha en 3002, no en 3001.** El 3001 es el CRM de flujo: detenerlo deja a otro equipo sin sistema. Hay once procesos `node` en la maquina.

```powershell
Stop-Process -Id <PID_DEL_BACKEND> -Force

Set-Location F:\crm-backend\app
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

> **`CORS_ORIGIN` es obligatorio y hoy falta en el `.env` de la VM.** Sin esa variable, con `NODE_ENV=production` el proceso **no arranca**: `exigirVariablesDeEntorno()` aborta a proposito para evitar desplegar con CORS abierto. Verificado el 2026-08-03: el `.env` tiene `DATABASE_URL`, `PORT=3002`, `HOST=127.0.0.1` y `NODE_ENV=production`, pero no `CORS_ORIGIN`. Anadirla antes del paso 9.

Completar `DATABASE_URL`, `JWT_SECRET` (`openssl rand -hex 64`, o `[Convert]::ToHexString((New-Object byte[] 64 | % { (New-Object Random).NextBytes($_); $_ }))`) y `CORS_ORIGIN` con el hostname del túnel.

**Dejar `HOST=127.0.0.1`.** Los asesores entran por el túnel, que corre en esta misma VM y conecta a loopback. Esto además cierra la exposición actual del 3001 en `0.0.0.0`.

Restringir permisos del archivo, que contiene la contraseña de la base:

```powershell
icacls .env /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(R)"
```

El proceso **no arranca** si falta `DATABASE_URL`, `JWT_SECRET`, o `CORS_ORIGIN` con `NODE_ENV=production`. Es intencional.

---

## 7. Instalar dependencias

> **Los cuatro comandos son una sola unidad. Nunca los corras sueltos.** El 2026-08-04 esta secuencia incompleta tumbó la API dos veces seguidas, con asesores trabajando.

```powershell
# 1. F:\node22 AL FRENTE DEL PATH — sin esto npm usa C:\Program Files\nodejs (v20.18.0)
$env:PATH = "F:\node22;$env:PATH"
Set-Location F:\crm-backend\app\backend

node -v                              # debe decir v22.x, NO v20.18.0

# 2. Instalar
npm ci --omit=dev

# 3. Regenerar el cliente Prisma — npm ci lo borró
& "F:\node22\node.exe" node_modules\prisma\build\index.js generate

# 4. Recién ahora, reiniciar
pm2 restart crm-backend --update-env
```

**Por qué cada paso importa:**

- **Sin el `$env:PATH`**, `npm` resuelve al Node v20.18.0 de `C:\Program Files\nodejs`. Prisma 7.9 exige `^20.19 || ^22.12 || >=24` y su script de *preinstall* aborta — pero `npm ci` **ya borró `node_modules` antes de fallar**, y el backend queda sin poder rearrancar. Verificar `node -v` no alcanza si después se invoca `npm` del PATH: comprobá la versión **después** de ajustar el PATH.
- **Sin `prisma generate`**, el proceso muere al arrancar con `MODULE_NOT_FOUND` en `@prisma/client/default.js`. El cliente es código generado y `npm ci` lo elimina al recrear `node_modules`. Se invoca con el binario de `F:\node22` por el mismo motivo del punto anterior.
- **El reinicio va último.** El proceso que corre bajo PM2 sobrevive a todo lo anterior porque ya tiene los módulos en memoria: la caída aparece recién al reiniciar. Terminá la instalación completa antes de tocar PM2.

Comprobación antes de reiniciar:

```powershell
Test-Path node_modules\@prisma\client     # True
Test-Path node_modules\express            # True
```

Si algo falló a mitad, el arreglo es **completar la secuencia**, no volver a la rama anterior: el problema es `node_modules`, no el código.

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

## 9. Arranque — PM2, y solo PM2

> **El backend ya corre bajo PM2.** Verificado por PID el 2026-08-04. La versión anterior de este paso decía que se arrancaba a mano y proponía convertirlo en servicio con NSSM: eso no refleja la VM.

```
┌────┬───────────────────┬──────┬────────────┬─────────┐
│ id │ name              │ mode │ interpreter│ puerto  │
├────┼───────────────────┼──────┼────────────┼─────────┤
│ 0  │ cobranza-api      │ fork │ nodejs v20 │ 3001    │  ← el otro CRM
│ 1  │ cloudflare-tunnel │ fork │ —          │ —       │
│ 2  │ crm-backend       │ fork │ F:\node22  │ 3002    │  ← este
└────┴───────────────────┴──────┴────────────┴─────────┘
```

`exec cwd` de `crm-backend`: `F:\crm-backend\app\backend`. Logs en `F:\cobranza\pm2\logs\crm-backend-{out,error}.log`.

```powershell
pm2 restart crm-backend --update-env
pm2 list
pm2 logs crm-backend --lines 20 --nostream
```

Esperado: `🚀 API + WebSocket escuchando en 127.0.0.1:3002 (NODE_ENV=production)`.

### 9.1 Nunca arranques el backend a mano

**Prohibido** `node src\index.js` y `& "F:\node22\node.exe" src\index.js`, incluso "solo para probar". El proceso manual **no muere** al terminar el despliegue: queda ocupando `127.0.0.1:3002`, y a partir de ahí el proceso de PM2 no puede bindear, muere con `EADDRINUSE` y PM2 lo reintenta en bucle.

Lo insidioso es que **la API sigue respondiendo** —la atiende el proceso huérfano, con el código viejo—, así que el despliegue parece aplicado y no lo está. El 2026-08-04 esto costó 132 reinicios y una medición de rendimiento entera hecha sobre el código anterior.

### 9.2 Detectar un crash loop

En `pm2 list`, la columna **`↺` subiendo entre dos invocaciones es un crash loop**, aunque el estado diga `online` — ese `online` es la ventana entre dos caídas. El `uptime` en `0s` o `1s` de forma persistente es la otra señal.

```powershell
pm2 list
Start-Sleep -Seconds 10
pm2 list     # si ↺ subio, esta reiniciando en bucle
```

Recuperación:

```powershell
pm2 stop crm-backend

$ocupantes = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue
foreach ($o in $ocupantes) {
  $pidOcup = $o.OwningProcess
  $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$pidOcup").CommandLine
  "PID $pidOcup -> $cmd"
  if ($cmd -like "*crm-backend*index.js*") { Stop-Process -Id $pidOcup -Force }
  else { "  NO SE TOCA: no es crm-backend" }
}

pm2 start crm-backend
pm2 reset crm-backend      # deja ↺ en 0 para que vuelva a servir de señal
```

**Nunca mates un PID sin ver antes su `CommandLine`.** El del 3001 es `cobranza-api` y detenerlo deja a otro equipo sin sistema.

### 9.3 Apagado ordenado — pendiente

PM2 en Windows corre en modo fork y **no emite señales POSIX**: `process.kill()` equivale a SIGKILL, así que los handlers de `SIGTERM`/`SIGINT` de `src/index.js:134-135` no se ejecutan. El camino real es el mensaje IPC `shutdown` (`src/index.js:141`), que PM2 solo envía si la app se arrancó con **`--shutdown-with-message`**.

Hoy no está puesto, así que cada `pm2 restart` mata el proceso sin drenar el pool de Prisma y deja conexiones colgadas en `pg_stat_activity`. Para corregirlo hay que rearrancar la app con el flag —`pm2 restart` **conserva los flags viejos**, no alcanza—:

```powershell
pm2 delete crm-backend
Set-Location F:\crm-backend\app\backend
pm2 start src/index.js --name crm-backend --shutdown-with-message --kill-timeout 15000
pm2 save
```

`--kill-timeout 15000` le da margen al temporizador de respaldo de 10 s del propio código (`src/index.js:113`); el default de PM2 es 1,6 s y lo corta antes.

**`pm2 save` es obligatorio** tras cualquier `pm2 delete`/`start`: es lo que hace que la app sobreviva al reinicio de la VM. Sin eso, PM2 levanta vacío y el backend no vuelve.

### 9.4 NSSM: no aplicado

`deploy\instalar-servicio-windows.ps1` sigue en el repo y registra el backend como servicio con NSSM (que al detener envía Ctrl+C → SIGINT → cierre ordenado, a diferencia de `sc.exe`). **No se usó.** Migrar de PM2 a NSSM daría a este backend un ciclo de vida propio, independiente del otro CRM, pero es una decisión abierta: hoy conviven los tres en la misma instancia de PM2 y el riesgo se gestiona con la regla de operar siempre por nombre.

---

## 10. Túnel Cloudflare

`cloudflared` ya corre como servicio automático. Verificar que sea un **named tunnel** y no un quick tunnel, cuya URL rota en cada reinicio (issue C3 de `docs/KNOWN-ISSUES.md`):

```powershell
Get-Service cloudflared
Get-Content "C:\Windows\System32\config\systemprofile\.cloudflared\config.yml" -ErrorAction SilentlyContinue
Get-ChildItem "$env:USERPROFILE\.cloudflared" -ErrorAction SilentlyContinue
```

**No reemplaces el archivo de configuracion.** Ese tunel sirve tambien al CRM de flujo. Abre el `config.yml` existente y **anade** una regla de `ingress` antes de la regla final `http_status:404`:

```yaml
ingress:
  # ... reglas existentes del otro CRM, sin tocar ...

  - hostname: crm.tu-dominio.com
    service: http://127.0.0.1:3002

  - service: http_status:404   # debe quedar siempre al final
```

Tras editar: `Restart-Service cloudflared` y comprobar que **ambos** sistemas responden. `deploy\cloudflared-config.yml` es solo una plantilla de referencia.

Tras cambiar `HOST` a `127.0.0.1`, confirmar que el túnel sigue alcanzando el backend (verificación 1 del paso 12).

---

## 11. Red

Con el túnel, la VM **no necesita puertos públicos**.

```powershell
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3002,5432 } |
  Select-Object LocalAddress, LocalPort | Format-Table -AutoSize
```

Tras el paso 9, el `3002` debe aparecer solo en `127.0.0.1`. El `5432` sigue en `0.0.0.0`: restringirlo en `postgresql.conf` (`listen_addresses = 'localhost'`) o, como minimo, con regla de firewall.

> **Antes de tocarlo, verifica si el CRM de flujo usa esta misma instancia de PostgreSQL.** Si se conecta desde otra maquina, restringir `listen_addresses` lo deja sin base. Comprobar con `SELECT DISTINCT client_addr FROM pg_stat_activity WHERE client_addr IS NOT NULL;`

```powershell
New-NetFirewallRule -DisplayName "Bloquear PostgreSQL externo" `
  -Direction Inbound -LocalPort 5432 -Protocol TCP -Action Block -Profile Any
```

En el NSG de Azure: sin reglas de entrada para 3002, 3001 ni 5432. Dejar solo el acceso administrativo restringido por IP.

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
| 9 | Cierre ordenado | `pm2 restart crm-backend` y revisar el log | `[APP] shutdown (PM2) recibido` y `[APP] Cierre limpio`. **Hoy falla**: requiere `--shutdown-with-message` (ver 9.3) |
| 10 | Sin conexiones colgadas | `psql -c "SELECT count(1) FROM pg_stat_activity WHERE datname='crm_marketing';"` | vuelve al valor previo |
| 11 | Puerto no expuesto | `Get-NetTCPConnection -LocalPort 3002 -State Listen` | solo `127.0.0.1` |
| 12 | Escalada de privilegios cerrada | con token `jefe_area`: `POST /api/admin/users` con `"rol":"admin"`, y `PUT /api/admin/users/<id-admin>` con `"rol":"asesor"` | `403` en ambos |
| 13 | Auto-update apagado | `psql -c "SELECT enabled, start_time, end_time, days FROM update_policy;"` | `enabled = f` |
| 14 | Columnas de mensajería | `psql -c "\d mensajes_broadcast"` | aparecen `canal`, `asunto`, `imagen_url` |
| 15 | Arranque automatico | `Restart-Computer`, y al volver `pm2 list` | los tres procesos en `online` sin intervencion |
| 16 | Sin crash loop | `pm2 list`, esperar 30s, `pm2 list` de nuevo | `↺` igual en ambas y `uptime` creciendo (ver 9.2) |

> La verificacion 15 **reinicia toda la VM y con ella el CRM de flujo**. Coordinar ventana con quien lo opere, y comprobar que ambos sistemas vuelven. Depende de que se haya corrido `pm2 save`: sin eso PM2 levanta vacio tras el reinicio.

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
$env:PATH = "F:\node22;$env:PATH"

Set-Location F:\crm-backend\app
git checkout <commit-anterior>

Set-Location F:\crm-backend\app\backend
npm ci --omit=dev
& "F:\node22\node.exe" node_modules\prisma\build\index.js generate

pm2 restart crm-backend --update-env
```

Mismas reglas del paso 7: el PATH primero, `prisma generate` después de `npm ci`, y el reinicio al final. Un rollback que salte cualquiera de los tres deja la API caída igual que un despliegue mal hecho.

> **El backend se gestiona con PM2, junto a `cobranza-api` y `cloudflare-tunnel`** (verificado 2026-08-04 por PID). Siempre por nombre: `pm2 restart crm-backend`. **Nunca `pm2 restart all`, `pm2 kill` ni `pm2 update`** — tumbarían el CRM de cobranza y el túnel a la vez.

Restaurar la base **solo** si el paso 4 o 5 alteró el esquema:

```powershell
pm2 stop crm-backend
$env:PGPASSWORD = 'PASSWORD_DE_POSTGRES'
$PG = 'C:\Program Files\PostgreSQL\16\bin'
& "$PG\dropdb.exe"   -U postgres -h 127.0.0.1 $DB
& "$PG\createdb.exe" -U postgres -h 127.0.0.1 $DB
& "$PG\pg_restore.exe" -U postgres -h 127.0.0.1 -d $DB F:\backups\<archivo>.dump
pm2 start crm-backend
```

`dropdb` falla si queda una sola conexión abierta contra la base — por eso el `pm2 stop` va primero y no un `restart`.

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
