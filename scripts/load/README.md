# Prueba de carga — 80 asesores simultáneos

Valida si la terminal sostiene 80 asesores concurrentes. Herramienta: **k6** (HTTP + WebSocket).

## 1. Instalar k6

```powershell
winget install k6 --source winget
# o:  choco install k6
k6 version
```

## 2. Escenarios

| SCENARIO | Qué mide | Bloqueador que expone |
|----------|----------|------------------------|
| `capacity` (default) | 80 sesiones WS + REST concurrentes a ritmo humano | proceso único / SQLite / túnel / VM |
| `login_storm` | 80 logins en ráfaga | **C4** (rate limit 10/15min por IP) |

> `capacity` usa **un** token y varía `asesor_id` sintético por VU → no lo frena C4, así aísla la capacidad real del servidor. `login_storm` sí dispara C4 a propósito para medirlo.

## 3. Ejecutar

```powershell
# Variables (ajusta IP/URL del túnel o IP pública según el deploy)
$env:BASE_URL = "http://127.0.0.1:3001"      # o https://xxxx.trycloudflare.com
$env:EMAIL    = "asesor@uphone.local"
$env:PASSWORD = "asesor123"

# A) Capacidad — 80 asesores, 3 min sostenido
k6 run scripts/load/k6-asesores.js

# B) Verificar C4 (rate limit de login)
$env:SCENARIO = "login_storm"
k6 run scripts/load/k6-asesores.js
Remove-Item Env:\SCENARIO

# Opcional: incluir ciclo de "siguiente contacto" + apertura de CDR
$env:CAMPANA_ID = "1"
k6 run scripts/load/k6-asesores.js
```

Parámetros (env): `BASE_URL`, `WS_URL` (si difiere), `EMAIL`, `PASSWORD`, `VUS` (def 80), `DURATION` (def 3m), `RAMP` (def 30s), `CAMPANA_ID`.

## 4. Cómo leer los resultados

**capacity** — umbrales (k6 marca ✓/✗):
- `rest_errors rate < 5%`
- `rest_latency_ms p(95) < 800ms`
- `ws_connection_errors rate < 2%`

Si fallan → el deploy NO sostiene 80. Sospechosos por orden: túnel quick (C3), event loop bloqueado por queries de métricas/cartera (falta de índices), specs de VM.

**login_storm** — mira `login_rate_limited_429`:
- `> 0` → **C4 CONFIRMADO**: con 80 logins simultáneos, parte del equipo no entra.

## 5. Importante / caveats

- **Desde dónde correr:** idealmente desde un cliente con red a la VM (mide túnel incluido). Correrlo *en* la VM (`127.0.0.1`) mide solo CPU/SQLite/proceso, **sin** el túnel — útil para aislar.
- **`capacity` no necesita 80 usuarios reales:** reusa un token válido y simula 80 identidades WS. Las operaciones de datos corren como el mismo asesor (mismo costo de query), suficiente para medir concurrencia.
- **`login_storm` sí golpea C4:** tras correrlo, ese login queda bloqueado ~15 min para esa IP. Espera o reinicia el contador antes de otra prueba de login.
- **No es destructivo en lecturas;** con `CAMPANA_ID` abre CDRs reales (escritura) → úsalo en entorno de prueba, no sobre cartera de producción viva.
- Mide en paralelo en la VM: `Get-Counter '\Processor(_Total)\% Processor Time'` y RAM, para correlacionar latencia con saturación.
