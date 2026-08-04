@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% -c "1" >nul 2>nul || (echo No se encontro Python. Instalalo desde https://python.org y vuelve a intentar. & pause & exit /b 1)
%PY% -c "import playwright" >nul 2>nul || (echo Instalando Playwright, solo la primera vez... & %PY% -m pip install playwright)
echo.
echo MODO DIAGNOSTICO: no califica nada. Guarda capturas y HTML de las
echo paginas clave en la carpeta "depuracion" para diagnosticar el problema.
echo.
%PY% calificador_kodland.py --diagnostico
echo.
pause
