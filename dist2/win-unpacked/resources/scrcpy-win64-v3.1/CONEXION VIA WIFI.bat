@echo off
title Sistema de Monitoreo - Gestion de Cobranza
color 0b

:: --- CONFIGURACIÓN DE RED ---
:: Asegúrate de que no haya espacios después del signo igual
set IP_CELULAR=192.168.100.66
:: ----------------------------

echo ======================================================
echo    INICIANDO TERMINAL DE COBRANZA - UPHONE TEC SAS
echo ======================================================
echo.
echo [+] Configurando conexion para el dispositivo: %IP_CELULAR%
echo [+] Verificando estado del puerto 5555...
echo.

:: Intentamos la conexion usando la variable correctamente
adb connect %IP_CELULAR%:5555

echo.
echo ------------------------------------------------------
echo [+] ESTADO: Conectando a Celular...
echo [+] Optimizando transmision para Red Wi-Fi...
echo ------------------------------------------------------
echo.
echo [!] ATENCION: No cierre esta ventana. 
echo [!] Las metricas de llamada se estan grabando en el servidor.
echo.

:: Lanzamos scrcpy con los parametros de rendimiento que acordamos
scrcpy -s %IP_CELULAR%:5555 --video-bit-rate 2M --max-size 1024 --max-fps 30 --window-title "Terminal de Cobranza - %IP_CELULAR%"

echo.
echo [!] La sesion ha finalizado o se ha perdido la conexion.
echo.
pause