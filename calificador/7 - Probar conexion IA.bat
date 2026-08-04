@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% -c "1" >nul 2>nul || (echo No se encontro Python. Instalalo desde https://python.org y vuelve a intentar. & pause & exit /b 1)
echo.
echo PRUEBA DE CONEXION CON LA IA (Groq).
echo Antes de usar esto: abre "ia_config.json" y pega tu clave gratis de
echo https://console.groq.com/keys en el campo api_key.
echo.
%PY% calificador_kodland.py --probar-ia
echo.
pause
