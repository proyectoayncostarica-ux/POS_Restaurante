@echo off
setlocal
cd /d "%~dp0"
title Iniciando Servidor POS

set LOGFILE=%TEMP%\pos-error.log
if exist "%LOGFILE%" del "%LOGFILE%" >nul 2>&1

if not exist node_modules (
    echo Instalando dependencias...
    npm install
    if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
)

echo Iniciando servidor en modo desarrollo...
npm run dev 2> "%LOGFILE%"

if %ERRORLEVEL% NEQ 0 (
    echo Hubo un error al iniciar el servidor. Codigo: %ERRORLEVEL%
    echo Detalles guardados en: %LOGFILE%
    exit /b %ERRORLEVEL%
)

endlocal
