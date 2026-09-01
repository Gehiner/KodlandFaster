@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% -c "1" >nul 2>nul || (echo No se encontro Python. Instalalo desde https://python.org y vuelve a intentar. & pause & exit /b 1)
echo.
echo BOLETINES DE PROGRESO (un PDF por alumno). No califica nada.
echo Se guardan en la carpeta  reportes\salida\
echo.
set /p GRUPO="Codigo del grupo (o parte). Enter = solo el mas reciente: "
set /p CORTE="Alcance [actual / curso / numero de modulo] (Enter = actual): "
if "%CORTE%"=="" set "CORTE=actual"
echo.
if "%GRUPO%"=="" (
  %PY% calificador_kodland.py --boletin --corte %CORTE% --max-grupos 1
) else (
  %PY% calificador_kodland.py --boletin --corte %CORTE% --grupo "%GRUPO%"
)
echo.
pause
