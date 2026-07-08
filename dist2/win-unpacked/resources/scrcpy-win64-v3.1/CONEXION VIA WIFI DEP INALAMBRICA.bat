@echo off
title Sistema de Monitoreo - Gestion de Cobranza
color 0b

:: --- CONFIGURACIÓN DE RED ---
:: La IP suele mantenerse, pero el puerto cambia en cada sesión de Android
set IP_CELULAR=192.168.100.97
:: ----------------------------

echo ======================================================
echo     INICIANDO TERMINAL DE COBRANZA - UPHONE TEC SAS
echo ======================================================
echo.
echo [+] IP Configurada: %IP_CELULAR%
echo.
echo [!] PASO OBLIGATORIO:
echo     En su celular vaya a: Opciones de desarrollador 
echo     ^> Depuracion inalambrica.
echo.
set /p PUERTO="[?] Ingrese el PUERTO que aparece en su celular: "

echo.
echo ------------------------------------------------------
echo [+] ESTADO: Intentando conectar a %IP_CELULAR%:%PUERTO%...
echo [+] Optimizando transmision para Red Wi-Fi...
echo ------------------------------------------------------
echo.

:: Matamos procesos previos de ADB para evitar conflictos de colas
adb disconnect >nul 2>&1

:: Intentamos la conexion con el puerto dinámico
adb connect %IP_CELULAR%:%PUERTO%

echo.
echo [!] ATENCION: No cierre esta ventana. 
echo [!] Las metricas de llamada se estan grabando en el servidor.
echo.

:: Lanzamos scrcpy con los parametros de rendimiento ajustados
:: Se eliminó el flag -s para mayor compatibilidad si solo hay un equipo
scrcpy --video-bit-rate 2M --max-size 1024 --max-fps 30 --window-title "Terminal de Cobranza - %IP_CELULAR%" --tcpip=%IP_CELULAR%:%PUERTO%

echo.
echo [!] La sesion ha finalizado o se ha perdido la conexion.
echo.
pause