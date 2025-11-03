@echo off
title Iniciando Servidor POS
cd /d C:\restaurant-app

:: Archivo temporal para errores
set LOGFILE=%TEMP%\pos-error.log
del "%LOGFILE%" >nul 2>&1

:: Ejecutar el servidor y capturar error en log
echo Iniciando servidor en modo desarrollo...
npm run dev 2> "%LOGFILE%"

:: Revisar si hubo error
if %ERRORLEVEL% NEQ 0 (
    echo Hubo un error al iniciar el servidor. Código: %ERRORLEVEL%
    echo Detalles guardados en: %LOGFILE%
    exit /b 1
)

exit /b 0
