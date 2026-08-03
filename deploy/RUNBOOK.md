# Runbook de despliegue — backend CRM Marketing Uphone

**Destino:** VM de Azure (Linux) · PostgreSQL 15 en la misma VM · exposición por Cloudflare named tunnel · **base de datos ya poblada**.

**Qué se despliega:** únicamente `backend/`. El cliente Electron se distribuye aparte y no cambia en esta entrega — los parches de seguridad de esta rama son todos del lado servidor.

> **La base tiene datos productivos.** Ningún paso de este runbook debe ejecutarse sin haber completado antes el paso 1 (respaldo verificado). El paso 4 incluye una comprobación de deriva que puede obligar a detener el despliegue.

---

## 0. Obtener este código

El endurecimiento vive en la rama `fix/predeploy-hardening` (`a536c8b`), que **todavía no está mergeada a `main`**. El PR no se ha abierto.

En la máquina desde la que operes:

```bash
git clone https://github.com/Uphone-Devs/Crm_marketing_uphone.git
cd Crm_marketing_uphone
git checkout fix/predeploy-hardening
git log --oneline -4
```

Deben aparecer estos cuatro commits:

```
a536c8b Documenta cuál es el backend real y añade los artefactos de despliegue
033d665 Separa el seed de demo del catálogo de producción
d39c1ab Prepara el ciclo de vida del backend para systemd y retira socket.io
1e1eaac Protege las cuentas admin de modificación por jefe_area
```

Abrir el PR (opcional antes de desplegar, obligatorio antes de mergear):

```bash
gh pr create --base main --head fix/predeploy-hardening \
  --title "Endurece el backend para el despliegue en la VM" \
  --body-file deploy/PR-BODY.md
```

O por navegador: `https://github.com/Uphone-Devs/Crm_marketing_uphone/pull/new/fix/predeploy-hardening`

Se puede desplegar la rama sin mergear —el paso 3 hace `checkout` de ella en la VM— pero conviene mergear antes de dar el despliegue por cerrado, para que `main` refleje lo que está en producción.

---

## 0.1 Prerrequisitos

| Requisito | Comprobación |
|---|---|
| Node.js ≥ 22 | `node -v` |
| PostgreSQL 15 activo | `systemctl is-active postgresql` |
| Usuario de sistema `crm` | `id crm` |
| `cloudflared` instalado | `cloudflared --version` |
| Código en `/opt/crm` | `git -C /opt/crm log --oneline -1` |

Valores que necesitas a mano antes de empezar:

- `DATABASE_URL` del usuario de aplicación (debe ser dueño del esquema para aplicar migraciones)
- `JWT_SECRET` nuevo — `openssl rand -hex 64`
- Hostname del túnel, p. ej. `crm.tu-dominio.com`

---

## 1. Respaldo (obligatorio, antes de todo)

```bash
sudo -u postgres pg_dump -Fc crm_marketing > ~/crm_marketing_$(date +%F_%H%M).dump
ls -lh ~/crm_marketing_*.dump
```

Verificar que el respaldo **restaura**, no solo que el archivo existe:

```bash
sudo -u postgres createdb crm_restore_test
sudo -u postgres pg_restore -d crm_restore_test ~/crm_marketing_*.dump
sudo -u postgres psql -d crm_restore_test -c "SELECT count(*) FROM usuarios;"
sudo -u postgres dropdb crm_restore_test
```

Si el restore falla, **detener el despliegue**.

---

## 2. Ventana y aviso

El paso 6 rota `JWT_SECRET`, lo que **invalida todas las sesiones activas**: los asesores conectados verán "sesión expirada" y deberán volver a entrar. Ejecutar fuera de horario de gestión y avisar a la operación.

---

## 3. Traer el código

```bash
sudo -u crm git -C /opt/crm fetch origin
sudo -u crm git -C /opt/crm checkout fix/predeploy-hardening
sudo -u crm git -C /opt/crm log --oneline -1
```

---

## 4. Estado de las migraciones (paso más delicado del despliegue)

El repositorio ya trae `backend/prisma/migrations/` con el historial del esquema. **El riesgo no es que falten: es que la base productiva no tenga registro de haberlas aplicado.** Si `_prisma_migrations` está vacía o no existe, `migrate deploy` intentará ejecutarlas todas desde cero contra datos reales.

Primero, comprobar qué sabe la base:

```bash
cd /opt/crm/backend
export DATABASE_URL="postgresql://..."

psql "$DATABASE_URL" -c \
  "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;" \
  2>/dev/null || echo "SIN TABLA _prisma_migrations"
```

Tres desenlaces:

**A) La tabla lista todas las migraciones del repo.** Estado normal. Continuar al paso 5.

**B) No existe la tabla, o está incompleta.** La base se construyó fuera de Prisma. **No ejecutar `migrate deploy`.** Hay que adoptar el historial marcando como aplicada cada migración que la base ya refleja, sin ejecutar su SQL:

```bash
npx prisma migrate resolve --applied 20260629200721_init
npx prisma migrate resolve --applied 20260703000001_add_missing_columns
npx prisma migrate resolve --applied 20260708000001_add_meta_diaria_campanas
npx prisma migrate resolve --applied 20260708000002_add_scheduled_datetime_to_cdrs
npx prisma migrate resolve --applied 20260709140000_remove_supervisor_role
npx prisma migrate resolve --applied 20260725000000_llave_empresa
```

La lista completa de migraciones está en `backend/prisma/migrations/`; usar los nombres de directorio tal cual. Marcar solo las que la base **realmente** refleja, verificando antes con `\d` sobre las tablas que toca cada una.

> Ya no quedan archivos `.sql` sueltos en `migrations/`. Los tres que había (`add_validacion_tables.sql`, `add_canal_mensajes_broadcast.sql`, `add_asunto_imagen_mensajes_broadcast.sql`) no los ejecutaba `migrate deploy` por no seguir el formato de directorio. El primero estaba cubierto por `20260725000001_add_missing_tables`; los otros dos se reemplazaron por la migración `20260801000001_mensajes_broadcast_canal_asunto_imagen`, que es idempotente.

**C) La tabla existe pero falta alguna migración reciente.** Aplicar solo las pendientes con `migrate deploy` (paso 5), tras confirmar en el SQL de cada una que no reescribe datos.

Comprobar además la deriva entre el schema y la base:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

Salida vacía significa que coinciden. Si aparecen `ALTER`/`CREATE`, **detener** y revisar cada sentencia con el equipo antes de seguir.

Y verificar la tabla que se crea sola en cada arranque, fuera de migraciones:

```bash
psql "$DATABASE_URL" -c "\d sub_gestiones"
```

---

## 5. Aplicar migraciones pendientes

Solo después de que el paso 4 haya dejado el historial consistente:

```bash
cd /opt/crm/backend
npx prisma migrate status    # debe listar el estado real, sin sorpresas
npx prisma migrate deploy
npx prisma migrate status    # debe decir: Database schema is up to date
```

Si `migrate status` anuncia que va a aplicar migraciones que creías ya reflejadas, volver al paso 4.

Comprobar que las columnas del módulo de mensajes quedaron en su sitio — es lo que rompía antes, porque `schema.prisma` las declaraba y ninguna migración formal las creaba:

```bash
psql "$DATABASE_URL" -c "\d mensajes_broadcast" | grep -E 'canal|asunto|imagen_url'
```

Deben aparecer las tres. Si falta alguna, el módulo de mensajes broadcast falla entero: Prisma hace `SELECT` explícito de todas las columnas del modelo.

> **No usar `POST /api/admin/run-migrations`.** Esa ruta se retiró: aplicaba índices y creaba `metricas_diarias_asesor` con `$executeRawUnsafe` por HTTP, duplicando lo que ya hacen `20260729000000_perf_indexes` y `20260729000001_metricas_diarias_asesor`, y dejando la base fuera del control del historial de Prisma. El único camino para el esquema es `migrate deploy`.

---

## 6. Configurar el entorno

```bash
cd /opt/crm/backend
sudo -u crm cp .env.example .env
sudo -u crm nano .env          # completar DATABASE_URL, JWT_SECRET, CORS_ORIGIN
sudo chmod 600 .env
sudo chown crm:crm .env
```

`CORS_ORIGIN` debe ser el hostname del túnel: `https://crm.tu-dominio.com`.
`HOST` se queda en `127.0.0.1`: el único acceso externo es el túnel, que corre en esta misma VM.

El proceso **no arranca** si falta `DATABASE_URL`, `JWT_SECRET`, o `CORS_ORIGIN` con `NODE_ENV=production`. Es intencional.

---

## 7. Instalar dependencias

```bash
cd /opt/crm/backend
sudo -u crm npm ci --omit=dev
sudo -u crm npx prisma generate
```

Ya no hay módulos nativos: se eliminaron `better-sqlite3`, `@prisma/adapter-better-sqlite3`, `@aws-sdk/*` y `socket.io`, que estaban declarados y sin uso. La instalación no requiere toolchain de compilación.

---

## 8. Catálogo de tipificaciones

Idempotente, seguro de repetir:

```bash
cd /opt/crm/backend
sudo -u crm npm run seed:catalogo
```

**Nunca** ejecutar `npm run seed:demo` en la VM: crea 10 cuentas con contraseña pública y 50 deudores ficticios. El script se niega a correr con `NODE_ENV=production`, pero conviene no invocarlo igualmente.

---

## 9. Servicio systemd

```bash
sudo cp /opt/crm/deploy/crm-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now crm-backend
sudo systemctl status crm-backend
journalctl -u crm-backend -n 40 --no-pager
```

Esperado en el log: `🚀 API + WebSocket escuchando en 127.0.0.1:3001 (NODE_ENV=production)`.

---

## 10. Túnel Cloudflare

```bash
cloudflared tunnel login
cloudflared tunnel create crm-uphone
cloudflared tunnel route dns crm-uphone crm.tu-dominio.com

sudo cp /opt/crm/deploy/cloudflared-config.yml /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml     # pegar UUID y hostname reales

sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

---

## 11. Red

Con named tunnel la VM **no necesita puerto público**:

```bash
# El backend solo escucha en loopback
ss -ltnp | grep 3001        # debe mostrar 127.0.0.1:3001, no 0.0.0.0:3001

# PostgreSQL solo local
ss -ltnp | grep 5432
```

En el NSG de Azure: sin reglas de entrada para 3001 ni 5432. Dejar solo el acceso administrativo (SSH) restringido por IP de origen.

---

## 12. Verificación post-deploy

Ejecutar en orden. Cualquier fallo detiene la puesta en producción.

```bash
HOST_PUB=https://crm.tu-dominio.com
```

| # | Comprobación | Comando | Esperado |
|---|---|---|---|
| 1 | Liveness | `curl -s $HOST_PUB/live` | `{"status":"OK",...}` |
| 2 | Readiness con base | `curl -s $HOST_PUB/health` | `{"status":"OK","db":"up",...}` |
| 3 | CORS rechaza origen ajeno | `curl -si -H 'Origin: https://atacante.example' $HOST_PUB/live \| grep -i access-control-allow-origin` | sin cabecera |
| 4 | Login funciona | `curl -s -X POST $HOST_PUB/api/auth/login -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}'` | `200` con `token` |
| 5 | Rate-limit de login | 25 intentos fallidos seguidos con el mismo email | `429` a partir del intento 21 |
| 6 | WS sin autenticar | `npx wscat -c "wss://crm.tu-dominio.com/"` y enviar `{"tipo":"ESTADO_ASESOR"}` | responde `{"tipo":"ERROR","mensaje":"No autenticado"}` |
| 7 | WS con token válido | conectar y enviar `{"tipo":"IDENTIFICAR","rol":"ASESOR","token":"$TOKEN"}` | no cierra la conexión |
| 8 | Migraciones al día | `npx prisma migrate status` | `Database schema is up to date` |
| 9 | Apagado ordenado | `sudo systemctl restart crm-backend` | log `[APP] SIGTERM recibido` y `[APP] Cierre limpio`, sin `Cierre forzado` |
| 10 | Sin conexiones colgadas | `psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_stat_activity WHERE datname='crm_marketing';"` | vuelve al valor previo tras el reinicio |
| 11 | Puerto no expuesto | `ss -ltnp \| grep 3001` | solo `127.0.0.1` |
| 12 | Escalada de privilegios cerrada | con token de `jefe_area`: `POST /api/admin/users` con `"rol":"admin"`, y `PUT /api/admin/users/<id-de-un-admin>` con `"rol":"asesor"` | `403` en ambos |
| 13 | Auto-update apagado | `psql "$DATABASE_URL" -c "SELECT enabled, start_time, end_time, days FROM update_policy;"` | `enabled = f` |
| 14 | Columnas de mensajería presentes | `psql "$DATABASE_URL" -c "\d mensajes_broadcast" \| grep -cE 'canal\|asunto\|imagen_url'` | `3` |

**El punto 9 solo puede verificarse en la VM.** El manejo de `SIGTERM` se implementó y se revisó, pero Windows no emite SIGTERM real, así que no pudo probarse en el entorno de desarrollo.

**Si el punto 13 devuelve `enabled = t`, detener y revisar.** Significa que alguien activó el auto-update: con un instalador publicado, la flota entera se actualizaría sola dentro de la ventana. Ver §13.1 antes de dejarlo encendido.

**Si el punto 14 no devuelve 3**, el módulo de mensajería fallará entero. Volver al paso 5.

---

## 13. Cliente Electron

No requiere reinstalación por estos cambios. Sí requiere reconfigurar la URL del servidor una vez:

1. Panel Admin → campo de URL de la VM → `https://crm.tu-dominio.com`
2. El cliente deriva solo el WebSocket a `wss://crm.tu-dominio.com/?token=...` (`src/renderer/shared/apiClient.js`, `AsesorPanel.jsx:928`).

Ningún cambio de esta entrega toca el protocolo cliente↔servidor: el WebSocket sigue autenticándose en el mensaje `IDENTIFICAR`, tal como ya hacía `main`.

### 13.1 Auto-update: qué se despliega y qué no

**Este despliegue no actualiza ningún cliente.** Instala el mecanismo, apagado.

Lo que entra: la tabla `update_policy` (migración `20260728000000_add_update_policy`) y los endpoints `GET`/`PUT /api/admin/update-policy`.

Lo que **no** ocurre, por dos cortes independientes:

1. `enabled` es `false` por defecto en el schema. El `GET` crea la fila con los valores por defecto (ventana 13:00–14:00, lunes a viernes, chequeo cada 30 min, hora de Guayaquil) y `isDentroDeVentana` corta en seco cuando `enabled` es falso (`src/main/updateWindow.js:37`).
2. El binario no sale de este backend. `electron-builder.yml` publica contra `https://crm.anomalydevs.qzz.io/updates/`, otro host. Sin un `latest.yml` y un `.exe` de versión superior ahí, `checkForUpdates()` no encuentra nada.

Flujo completo, para referencia: `LoginPage.jsx:74` invoca `updater:start` tras el login → `src/main/updater.js` consulta la política cada `checkIntervalMin` → si está habilitada y dentro de la ventana, llama a `autoUpdater.checkForUpdates()`.

**Antes de poner `enabled: true`, resolver tres cosas:**

- **Los instaladores no están firmados.** El script de build fija `CSC_IDENTITY_AUTO_DISCOVERY=false` y `publish.provider` es `generic`. Con auto-update activo, quien controle ese dominio o su DNS puede empujar un ejecutable a todas las PCs de cobranza, y `electron-updater` lo instalará sin verificar firma. Firmar los instaladores cierra este vector.
- **Alinear el versionado.** `package.json` está en `3.0.0` y la documentación habla de "Versión 4.0". El updater compara versiones: si la publicada no supera a la instalada, no pasa nada y el fallo es silencioso.
- **Probar con una sola máquina primero.** Activar la política con una ventana corta, verificar la actualización en un equipo, y solo entonces abrir la ventana a la flota.

Para encender o apagar la política:

```bash
# consultar
curl -s $HOST_PUB/api/admin/update-policy

# apagar (requiere token admin)
curl -X PUT $HOST_PUB/api/admin/update-policy \
  -H "Authorization: Bearer $TOKEN_ADMIN" -H 'Content-Type: application/json' \
  -d '{"enabled":false,"startTime":"13:00","endTime":"14:00","days":[1,2,3,4,5],"checkIntervalMin":30}'
```

---

## 14. Rollback

```bash
sudo systemctl stop crm-backend
sudo -u crm git -C /opt/crm checkout main
cd /opt/crm/backend && sudo -u crm npm ci --omit=dev && sudo -u crm npx prisma generate
sudo systemctl start crm-backend
```

Restaurar la base solo si el paso 4 o 5 alteró el esquema:

```bash
sudo systemctl stop crm-backend
sudo -u postgres dropdb crm_marketing
sudo -u postgres createdb crm_marketing
sudo -u postgres pg_restore -d crm_marketing ~/crm_marketing_<fecha>.dump
sudo systemctl start crm-backend
```

Al volver a `main` se pierden los parches de seguridad: el WebSocket vuelve a aceptar conexiones sin autenticación. Un rollback debe ir acompañado de cerrar el túnel (`sudo systemctl stop cloudflared`) hasta reponer la versión corregida.

---

## 15. Pendientes que este despliegue NO resuelve

Quedan fuera de esta entrega y siguen abiertos:

- **`GET /api/admin/backup.dump`** descarga el dump completo de la base con una sola credencial admin, a través del túnel público. Es exfiltración de los datos de todos los deudores en una petición. Conviene rate-limit, registro de auditoría de cada descarga, o restringirlo a origen de red interna.
- **`GET /api/admin/update-policy` es público y además escribe**: hace `upsert`, así que cualquiera sin credenciales puede crear la fila `id=1`. La lectura pública es deliberada (el cliente consulta la ventana sin token), pero debería separarse en una lectura sin efectos secundarios.
- **`hotfix/cdrs-indexes` sin mergear** (índices en `cdrs` y reescritura de `cartera-equipo` con carga lazy). Revisar si se solapa con `20260801000000_cdrs_index_optimize` antes de integrarlo.
- **Instaladores sin firmar con auto-update por `provider: generic`** (ver §13.1). Mientras `update_policy.enabled` siga en `false` no hay exposición, pero es la condición a resolver antes de activarlo.

- **Aislamiento por equipo a medias en el WebSocket**: se aplica a `AUDIO_CHUNK`, pero `ESTADO_ASESOR` y `METRICAS_ASESOR` siguen difundiéndose a todos los supervisores conectados.
- **`MARCAR_CLIENTE` y `REMOTE_DIAL`** no comprueban que el asesor destino pertenezca al equipo del supervisor que emite el comando.
- **`TIPIFICACION_REALIZADA`** no verifica rol: un asesor autenticado puede difundir eventos arbitrarios al panel del supervisor.
- **Vulnerabilidades npm** arrastradas por `exceljs@3` (`rimraf`, `glob`, `fstream`, `uuid` antiguos). Subir a `exceljs@4` requiere QA de los reportes xlsx.
- **CI no cubre `backend/`**: sigue sin instalar, auditar ni probar el código que corre en la VM.
- **Sin logging estructurado ni rotación**; `journald` recoge la salida, pero el login sigue registrando el email en claro.
- **IDOR en rutas de supervisor** (`supervisor.routes.js:384`, `/cartera*`, `/bitacora`): autenticadas pero sin verificación de pertenencia.
- **Estado del WebSocket en memoria del proceso**: no sobrevive a un reinicio ni admite una segunda instancia.
- **`CREATE TABLE IF NOT EXISTS sub_gestiones`** sigue ejecutándose en cada arranque, fuera del control de migraciones.
- **`pg_dump` programado**: el respaldo del paso 1 es manual y puntual; falta la tarea recurrente y la definición de RPO/RTO.
