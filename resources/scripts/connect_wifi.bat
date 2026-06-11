@echo off
:: Script de conexión WiFi para Terminal de Cobranza
:: Uso: connect_wifi.bat [IP_DISPOSITIVO]
:: Generado por ANTIGRAVITY

if "%1"=="" (
  echo ERROR: Debes especificar la IP del dispositivo
  echo Uso: connect_wifi.bat 192.168.1.100
  exit /b 1
)

echo [Terminal Cobranza] Activando ADB TCP en el dispositivo...
adb tcpip 5555

echo [Terminal Cobranza] Esperando 2 segundos...
timeout /t 2 /nobreak >nul

echo [Terminal Cobranza] Conectando a %1:5555 ...
adb connect %1:5555

echo [Terminal Cobranza] Lanzando mirror de pantalla...
scrcpy --serial %1:5555 --window-title "Terminal Cobranza - WiFi" --max-fps 30 --stay-awake
