@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% -c "1" >nul 2>nul || (echo No se encontro Python. Instalalo desde https://python.org y vuelve a intentar. & pause & exit /b 1)
%PY% -c "import playwright" >nul 2>nul || (echo Instalando Playwright, solo la primera vez... & %PY% -m pip install playwright)
echo.
echo ATENCION: se pulsara "Nota Max." en todas las tareas amarillas y naranjas
echo de todos tus grupos activos. Pulsa Ctrl+C para cancelar en cualquier momento.
echo.
%PY% calificador_kodland.py
echo.
pause
