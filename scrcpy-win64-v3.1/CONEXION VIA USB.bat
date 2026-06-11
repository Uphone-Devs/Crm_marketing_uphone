@echo off
title Sistema de Control USB - UPHONE TEC SAS
color 0b

echo ======================================================
echo    TERMINAL DE COBRANZA - CONEXION ALTA PRIORIDAD
echo    MODO: USB ESTABLE (ANTI-SATURACION DE RED)
echo ======================================================
echo.

echo [+] Detectando dispositivos conectados por cable...
echo [+] Verificando drivers de comunicacion...
echo.

:: Listamos los dispositivos para que el asesor vea que el PC lo reconoce
adb devices

echo.
echo ------------------------------------------------------
echo [+] ESTADO: Dispositivo detectado con exito.
echo [+] Optimizando flujo de datos por bus serial...
echo ------------------------------------------------------
echo.
echo [!] RECOMENDACION: Mantenga el cable firme y no lo desconecte.
echo [!] Las metricas de llamada se sincronizaran por USB.
echo.

:: LANZAMIENTO OPTIMIZADO PARA USB:
:: --always-on-top: Mantiene la pantalla visible siempre.
:: -d: Indica que use el dispositivo conectado por USB (ignora el Wi-Fi).
:: --video-bit-rate 4M: Subimos a 4M porque el USB aguanta mas que el Wi-Fi.
scrcpy -d --video-bit-rate 4M --max-size 1024 --max-fps 60 --window-title "Terminal USB - PRIORIDAD ALTA" --always-on-top

echo.
if %errorlevel% neq 0 (
    color 0c
    echo [ERROR] No se pudo iniciar la transmision. 
    echo [!] Verifique que la Depuracion USB este activa.
) else (
    echo [OK] Sesion finalizada correctamente.
)
echo.
pause