@echo off
REM Lanzador del backend de produccion (PostgreSQL crm_marketing).
REM Siempre entra a backend/ sin importar desde donde se ejecute.
cd /d "%~dp0backend"
echo ============================================
echo  Backend UPHONE - PostgreSQL crm_marketing
echo  Verifique en el arranque: "crm_marketing"
echo ============================================
npm run dev
pause
