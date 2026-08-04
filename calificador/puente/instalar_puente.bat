@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% -c "1" >nul 2>nul || (echo No se encontro Python. Instalalo desde https://python.org y vuelve a intentar. & pause & exit /b 1)
echo.
echo ================================================================
echo   INSTALAR PUENTE (conecta la extension de Chrome con el
echo   calificador de Python).
echo.
echo   Necesitas el ID de tu extension:
echo    1. Abre  chrome://extensions
echo    2. Activa "Modo de desarrollador" (arriba a la derecha)
echo    3. Copia el ID (32 letras) que aparece bajo la extension
echo ================================================================
echo.
%PY% instalar_puente.py
echo.
pause
