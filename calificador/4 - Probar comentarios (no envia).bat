@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% -c "1" >nul 2>nul || (echo No se encontro Python. Instalalo desde https://python.org y vuelve a intentar. & pause & exit /b 1)
%PY% -c "import playwright" >nul 2>nul || (echo Instalando Playwright, solo la primera vez... & %PY% -m pip install playwright)
echo.
echo PRUEBA DE COMENTARIO: abre tareas SIN calificar (amarillas/naranjas) y
echo muestra la NOTA que pondria y el COMENTARIO. No guarda ni envia nada.
echo Usa la IA si esta configurada (ia_config.json); si no, usa plantillas.
echo.
set /p GRUPO=Codigo del grupo (ej: COL12345, o Enter para los mas recientes):
set /p CUANTAS=Cuantas tareas quieres ver? (Enter = 3):
if "%CUANTAS%"=="" set "CUANTAS=3"
set "FILTRO="
if not "%GRUPO%"=="" set "FILTRO=--grupo %GRUPO%"
echo.
%PY% calificador_kodland.py --probar-comentario %CUANTAS% --comentar ia %FILTRO%
echo.
pause
