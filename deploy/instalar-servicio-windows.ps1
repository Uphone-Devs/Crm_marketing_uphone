<#
    instalar-servicio-windows.ps1 - Registra el backend como servicio de Windows con NSSM.

    Por que NSSM y no sc.exe: al detener el servicio, NSSM puede enviar Ctrl+C al
    proceso, lo que Node traduce a SIGINT y dispara el cierre ordenado de src/index.js
    (cierra el servidor HTTP y drena el pool de Prisma). sc.exe mata el proceso sin
    aviso: conexiones colgadas en pg_stat_activity tras cada reinicio.

    Windows no emite SIGTERM: el handler de SIGTERM del codigo solo aplica en Linux.
    El que actua aqui es el de SIGINT.

    Sin caracteres no-ASCII a proposito: PowerShell 5.1 lee los .ps1 sin BOM como ANSI
    y un acento o un guion largo puede romper el parseo en la VM.

    Ejecutar como administrador. Idempotente: si el servicio existe, lo reconfigura.
#>

[CmdletBinding()]
param(
    [string]$Nombre      = 'crm-backend',
    [string]$RutaBackend = 'F:\crm-backend\app\backend',
    [string]$NodeExe     = 'F:\node22\node.exe',
    [string]$NssmExe     = 'C:\nssm\nssm.exe',
    [string]$RutaLogs    = 'F:\logs\crm-backend',
    [string]$ServicioPg  = 'postgresql-x64-16'
)

$ErrorActionPreference = 'Stop'

function Requerir($ruta, $que) {
    if (-not (Test-Path $ruta)) { throw "$que no encontrado en: $ruta" }
}

Requerir $NssmExe 'nssm.exe'
Requerir $NodeExe 'node.exe'
Requerir (Join-Path $RutaBackend 'src\index.js') 'src\index.js'
Requerir (Join-Path $RutaBackend '.env') 'backend\.env'

# Node debe ser >= 20.19: Prisma 7 no soporta versiones anteriores.
$version = (& $NodeExe -v).TrimStart('v')
$partes  = $version.Split('.')
$mayor   = [int]$partes[0]
$menor   = [int]$partes[1]
if ($mayor -lt 20 -or ($mayor -eq 20 -and $menor -lt 19)) {
    throw "Node $version no cumple el requisito de Prisma 7 (^20.19, ^22.12 o >=24)."
}
Write-Host "Node $version en $NodeExe - OK"

# PORT es obligatorio y se valida, no se avisa. En esta VM convive otro CRM que ya
# ocupa el 3001, que es justo el valor al que cae el codigo si la variable falta.
# Arrancar sin PORT provocaria EADDRINUSE o, si el otro CRM estuviera parado en ese
# momento, este servicio le robaria el puerto y lo dejaria sin arrancar despues.
$rutaEnv = Join-Path $RutaBackend '.env'
$lineaPort = (Select-String -Path $rutaEnv -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue |
              Select-Object -First 1)
if (-not $lineaPort) {
    throw "PORT no esta definido en $rutaEnv. Es obligatorio: el 3001 por defecto ya lo usa otro CRM en esta VM."
}
$Puerto = [int]$lineaPort.Matches[0].Groups[1].Value
Write-Host "Puerto declarado en .env: $Puerto"

# El puerto no puede estar ocupado por un proceso ajeno al servicio que instalamos.
$enUso = Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue
if ($enUso) {
    $duenos = $enUso.OwningProcess | Sort-Object -Unique | ForEach-Object {
        $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
        "PID $_ ($($p.ProcessName))"
    }
    $svc = Get-Service -Name $Nombre -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') {
        Write-Host "Puerto $Puerto en uso por el propio servicio '$Nombre' - se reconfigurara."
    }
    else {
        throw "Puerto $Puerto ya ocupado por: $($duenos -join ', '). Detener ese proceso o cambiar PORT antes de instalar."
    }
}

New-Item -ItemType Directory -Force -Path $RutaLogs | Out-Null

$existe = Get-Service -Name $Nombre -ErrorAction SilentlyContinue
if ($existe) {
    Write-Host "Servicio '$Nombre' ya existe - deteniendo para reconfigurar"
    if ($existe.Status -ne 'Stopped') { & $NssmExe stop $Nombre | Out-Null }
}
else {
    & $NssmExe install $Nombre $NodeExe 'src\index.js'
}

& $NssmExe set $Nombre Application   $NodeExe
& $NssmExe set $Nombre AppParameters 'src\index.js'
& $NssmExe set $Nombre AppDirectory  $RutaBackend
& $NssmExe set $Nombre DisplayName   'CRM Marketing Uphone - Backend'
& $NssmExe set $Nombre Description   'API REST + WebSocket (Express + Prisma + PostgreSQL)'
& $NssmExe set $Nombre Start         SERVICE_AUTO_START

# NODE_ENV tambien por servicio: no depende de que el .env este completo.
& $NssmExe set $Nombre AppEnvironmentExtra 'NODE_ENV=production'

# Cierre ordenado: Ctrl+C -> SIGINT, con 15s antes de matar el proceso.
& $NssmExe set $Nombre AppStopMethodSkip    0
& $NssmExe set $Nombre AppStopMethodConsole 15000
& $NssmExe set $Nombre AppStopMethodWindow  0
& $NssmExe set $Nombre AppStopMethodThreads 0

# Reinicio automatico con espera, para no entrar en bucle si la base no responde.
& $NssmExe set $Nombre AppExit Default Restart
& $NssmExe set $Nombre AppRestartDelay 5000
& $NssmExe set $Nombre AppThrottle     10000

# Logs con rotacion (10 MB por archivo).
& $NssmExe set $Nombre AppStdout       (Join-Path $RutaLogs 'salida.log')
& $NssmExe set $Nombre AppStderr       (Join-Path $RutaLogs 'error.log')
& $NssmExe set $Nombre AppRotateFiles  1
& $NssmExe set $Nombre AppRotateOnline 1
& $NssmExe set $Nombre AppRotateBytes  10485760

# Espera a PostgreSQL: sin esto el servicio arranca antes que la base tras reiniciar.
& $NssmExe set $Nombre DependOnService $ServicioPg

Write-Host ''
Write-Host "Servicio '$Nombre' configurado. Arrancar con:"
Write-Host "  Start-Service $Nombre"
Write-Host "  Get-Content '$RutaLogs\salida.log' -Tail 20 -Wait"
