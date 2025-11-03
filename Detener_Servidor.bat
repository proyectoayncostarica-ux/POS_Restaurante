@echo off
title Detener Servidor POS
echo ==========================
echo  DETENER SERVIDOR POS
echo ==========================
echo.
echo Buscando procesos del POS...
taskkill /F /IM node.exe >nul 2>&1

if %ERRORLEVEL%==0 (
    echo Servidor detenido correctamente.
) else (
    echo No se encontraron procesos del servidor en ejecucion.
)

echo.
pause
