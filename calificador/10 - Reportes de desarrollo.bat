@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% -c "1" >nul 2>nul || (echo No se encontro Python. Instalalo desde https://python.org y vuelve a intentar. & pause & exit /b 1)
echo.
echo REPORTE COMPLETO por alumno (desarrollo + calificaciones + asistencia
echo   + mensaje personalizado). Un PDF por alumno. No califica nada.
echo Necesita el contenido del curso en:  reportes\curso_^<curso^>.json
echo Se guardan en:  reportes\salida\^<grupo^>_desarrollo\
echo NOTA: consulta las tareas leccion por leccion, puede tardar un poco.
echo.
set /p GRUPO="Codigo del grupo (o parte). Enter = solo el mas reciente: "
echo.
if "%GRUPO%"=="" (
  %PY% calificador_kodland.py --reporte --max-grupos 1
) else (
  %PY% calificador_kodland.py --reporte --grupo "%GRUPO%"
)
echo.
pause
