@echo off
cd /d "%~dp0data"
if not exist restaurant.db (
    echo No existe data\restaurant.db. Inicia el servidor para crearla automaticamente.
    pause
    exit /b 1
)
sqlite3 restaurant.db
