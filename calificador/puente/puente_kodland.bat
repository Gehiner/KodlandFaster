@echo off
REM Envoltorio que Chrome ejecuta como host de Native Messaging.
REM IMPORTANTE: no debe imprimir NADA en pantalla (stdout es el canal binario
REM con Chrome). Por eso todo va con @echo off y las comprobaciones a nul.
setlocal
set "PY=py -3"
%PY% -c "1" >nul 2>nul || set "PY=python"
%PY% "%~dp0puente_kodland.py"
