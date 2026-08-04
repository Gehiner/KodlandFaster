@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% -c "1" >nul 2>nul || (echo No se encontro Python. Instalalo desde https://python.org y vuelve a intentar. & pause & exit /b 1)
%PY% -c "import playwright" >nul 2>nul || (echo Instalando Playwright, solo la primera vez... & %PY% -m pip install playwright)
echo.
echo COMENTAR UN GRUPO: para las tareas SIN calificar (amarillas/naranjas) del
echo grupo, deja la nota y ENVIA un comentario. NO toca las ya calificadas (verdes).
echo Las tareas que ya recibieron comentario antes se omiten automaticamente.
echo.
set /p GRUPO=Codigo del grupo (ej: COL12345):
if "%GRUPO%"=="" (echo No escribiste ningun codigo. & pause & exit /b 1)
set /p LECCION=Solo una leccion? (ej: M2L3, o Enter para todas):
set "EXTRA="
if not "%LECCION%"=="" set "EXTRA=--leccion %LECCION%"
echo.
echo Se procesara el grupo %GRUPO% %EXTRA% enviando comentarios. Cierra la ventana si no quieres.
pause
%PY% calificador_kodland.py --grupo %GRUPO% %EXTRA% --comentar ia --enviar-comentarios
echo.
pause
