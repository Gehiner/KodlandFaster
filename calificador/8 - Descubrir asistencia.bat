@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% -c "1" >nul 2>nul || (echo No se encontro Python. Instalalo desde https://python.org y vuelve a intentar. & pause & exit /b 1)
echo.
echo DESCUBRIR ASISTENCIA (no se califica nada).
echo Se abrira Chrome con tu sesion. Entra a un grupo, abre la seccion de
echo ASISTENCIA, y cuando la veas cargada vuelve a esta ventana y pulsa ENTER.
echo.
%PY% calificador_kodland.py --descubrir-asistencia
echo.
pause
