@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% -c "1" >nul 2>nul || (echo No se encontro Python. Instalalo desde https://python.org y vuelve a intentar. & pause & exit /b 1)
%PY% -c "import playwright" >nul 2>nul || (echo Instalando Playwright, solo la primera vez... & %PY% -m pip install playwright)
echo.
echo Va a CALIFICAR (Nota Max.) todas las tareas amarillas/naranjas y a ENVIAR
echo un comentario al chat de cada alumno. Cierra esta ventana si no quieres.
echo Para usar la IA de Kodland en vez de plantillas: cambia "plantillas" por "ia".
echo.
pause
%PY% calificador_kodland.py --comentar plantillas --enviar-comentarios
echo.
pause
