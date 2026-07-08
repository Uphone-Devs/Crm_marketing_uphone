# Configuración UPHONE TEC SAS - MODO HOTSPOT
# Detectamos la IP de la zona Wi-Fi (Hotspot de Windows)
$ip_hotspot = (Get-NetIPAddress -InterfaceAlias "*Wi-Fi*" | Where-Object { $_.IPv4Address -like "192.168.137.*" }).IPv4Address
if (!$ip_hotspot) { $ip_hotspot = "192.168.137.1" } # IP por defecto de Hotspot Windows

$puerto_pair = "5555"
$codigo_vincular = "123456"

Clear-Host
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "   VINCULACION DIRECTA (HOTSPOT) - UPHONE TEC SAS    " -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[!] PASO 1: Conecte el Infinix al Wi-Fi de esta Laptop."
Write-Host "[!] PASO 2: Escanee el QR que se abrira en el navegador."
Write-Host ""

# Generamos el QR para conexión directa
$datos_qr = "WIFI:T:ADB;S:ADB_HOTSPOT;P:$codigo_vincular;;"
Start-Process "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=$datos_qr"

Write-Host "[+] IP de la Laptop (Puente): $ip_hotspot" -ForegroundColor Yellow
Write-Host "[+] Esperando que el Infinix escanee..." -ForegroundColor Green

# Reiniciamos ADB para limpiar puertos
.\adb.exe kill-server
.\adb.exe start-server

# Escuchamos la vinculacion
.\adb.exe pair "$($ip_hotspot):$puerto_pair" $codigo_vincular

Write-Host ""
Write-Host "[+] VINCULACION EXITOSA" -ForegroundColor Green
Write-Host "[!] Ya puedes abrir el espejo con el .bat"
pause