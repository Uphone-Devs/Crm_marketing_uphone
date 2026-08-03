<#
    instalar-servicio-windows.ps1 — Registra el backend como servicio de Windows con NSSM.

    Por qué NSSM y no `sc.exe`: al detener el servicio, NSSM puede enviar Ctrl+C al
    proceso, lo que Node traduce a SIGINT y dispara el cierre ordenado de src/index.js
    (cierra el servidor HTTP y drena el pool de Prisma). `sc.exe` mata el proceso sin
    aviso: conexiones colgadas en pg_stat_activity tras cada reinicio.

    Windows no emite SIGTERM: el handler de SIGTERM del código solo aplica en Linux.
    El que actúa aquí es el de SIGINT.

    Ejecutar como administrador. Idempotente: si el servicio existe, lo reconfigura.
#>

[CmdletBinding()]
param(
    [string]$Nombre      = 'crm-backend',
    [string]$RutaBackend = 'C:\crm\backend',
    [string]$NodeExe     = 'F:\node22\node.exe',
    [string]$NssmExe     = 'C:\nssm\nssm.exe',
    [string]$RutaLogs    = 'F:\logs\crm-backend'
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
$mayor   = [int]$partes[0]; $menor = [int]$partes[1]
if ($mayor -lt 20 -or ($mayor -eq 20 -and $menor -lt 19)) {
    throw "Node $version no cumple el requisito de Prisma 7 (^20.19 || ^22.12 || >=24)."
}
Write-Host "Node $version en $NodeExe — OK"

New-Item -ItemType Directory -Force -Path $RutaLogs | Out-Null

$existe = Get-Service -Name $Nombre -ErrorAction SilentlyContinue
if ($existe) {
    Write-Host "Servicio '$Nombre' ya existe — deteniendo para reconfigurar"
    if ($existe.Status -ne 'Stopped') { & $NssmExe stop $Nombre | Out-Null }
} else {
    & $NssmExe install $Nombre $NodeExe 'src\index.js'
}

& $NssmExe set $Nombre Application        $NodeExe
& $NssmExe set $Nombre AppParameters      'src\index.js'
& $NssmExe set $Nombre AppDirectory       $RutaBackend
& $NssmExe set $Nombre DisplayName        'CRM Marketing Uphone - Backend'
& $NssmExe set $Nombre Description        'API REST + WebSocket (Express + Prisma + PostgreSQL), puerto 3001'
& $NssmExe set $Nombre Start              SERVICE_AUTO_START

# NODE_ENV tambien por servicio: no depende de que el .env este completo.
& $NssmExe set $Nombre AppEnvironmentExtra 'NODE_ENV=production'

# Cierre ordenado: Ctrl+C -> SIGINT, con 15s antes de matar el proceso.
& $NssmExe set $Nombre AppStopMethodSkip     0
& $NssmExe set $Nombre AppStopMethodConsole  15000
& $NssmExe set $Nombre AppStopMethodWindow   0
& $NssmExe set $Nombre AppStopMethodThreads  0

# Reinicio automatico con espera creciente, para no entrar en bucle si la base no responde.
& $NssmExe set $Nombre AppExit Default Restart
& $NssmExe set $Nombre AppRestartDelay 5000
& $NssmExe set $Nombre AppThrottle     10000

# Logs con rotacion diaria (10 MB por archivo).
& $NssmExe set $Nombre AppStdout          (Join-Path $RutaLogs 'salida.log')
& $NssmExe set $Nombre AppStderr          (Join-Path $RutaLogs 'error.log')
& $NssmExe set $Nombre AppRotateFiles     1
& $NssmExe set $Nombre AppRotateOnline    1
& $NssmExe set $Nombre AppRotateBytes     10485760

# Espera a PostgreSQL: sin esto el servicio arranca antes que la base tras un reinicio.
& $NssmExe set $Nombre DependOnService 'postgresql-x64-16'

Write-Host ''
Write-Host "Servicio '$Nombre' configurado. Arrancar con:"
Write-Host "  Start-Service $Nombre"
Write-Host "  Get-Content '$RutaLogs\salida.log' -Tail 20 -Wait"
