@echo off
chcp 65001 >nul
echo Quitando el puente del registro de Windows...
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.kodland.puente" /f >nul 2>nul && echo   - Chrome: quitado || echo   - Chrome: no estaba
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.kodland.puente" /f >nul 2>nul && echo   - Edge: quitado || echo   - Edge: no estaba
echo.
echo Listo. La extension ya no podra lanzar el calificador
echo (los archivos del puente siguen en su carpeta; puedes reinstalarlo cuando quieras).
echo.
pause
