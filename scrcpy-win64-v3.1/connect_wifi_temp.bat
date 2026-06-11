@echo off
title Sistema de Monitoreo - Gestion de Cobranza (WIFI)
color 0b

echo ======================================================
echo    INICIANDO TERMINAL DE COBRANZA - UPHONE TEC SAS
echo ======================================================
echo.
echo [+] Configurando conexion para el dispositivo: 10.170.85.110
echo [+] Configurando el puerto 5555 en el dispositivo...
echo.

:: Se requiere que el dispositivo este temporalmente conectado por USB 
:: para configurar el puerto antes de pasar a modo inalambrico.
adb tcpip 5555

echo.
echo [+] Esperando reinicio del servicio ADB en modo TCP/IP...
timeout /t 3 /nobreak >nul

echo [+] Conectando por via inalambrica...
adb connect 10.170.85.110:5555

echo.
echo ------------------------------------------------------
echo [+] ESTADO: Conectando a Celular...
echo [+] Optimizando transmision para Red Wi-Fi...
echo ------------------------------------------------------
echo.

scrcpy -s 10.170.85.110:5555 --video-bit-rate 2M --max-size 1024 --max-fps 30 --window-title "Terminal de Cobranza - 10.170.85.110"

echo.
echo [!] La sesion ha finalizado o se ha perdido la conexion.
echo.
pause