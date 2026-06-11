@echo off
:: Script de conexión USB para Terminal de Cobranza
:: Generado por ANTIGRAVITY

echo [Terminal Cobranza] Iniciando conexión USB...
adb kill-server
adb start-server
adb devices

echo [Terminal Cobranza] Lanzando mirror de pantalla...
scrcpy --window-title "Terminal Cobranza - Asesor" --max-fps 30 --stay-awake
