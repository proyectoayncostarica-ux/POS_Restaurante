# v3.2.0 fix2 hotfix · Corrección del script de actualización SQLite

## Problema corregido

El script anterior ejecutaba:

```powershell
npm pkg set engines.node=>=20.17.0
```

En Windows PowerShell 5.1, `npm.cmd` se ejecuta mediante la capa de comandos de Windows y los caracteres `>` pueden reinterpretarse como redirección. npm terminaba recibiendo un argumento inválido y respondía que `npm pkg set` esperaba pares `key=value`.

## Solución

El nuevo script ya no usa `npm pkg set` para valores con metacaracteres. Modifica `package.json` mediante un pequeño proceso Node temporal, preservando el resto del archivo y escribiendo UTF-8 sin BOM.

También utiliza mensajes ASCII dentro del `.ps1` para evitar texto dañado como `actualizaciÃ³n` al ejecutarlo con Windows PowerShell 5.1.

## Alcance

- No cambia lógica de negocio.
- No modifica bases SQLite operativas.
- No incluye certificados ni `.env`.
- Mantiene respaldo temporal de `package.json` y `package-lock.json`.
- Instala exactamente `sqlite3@6.0.1`.
- Ejecuta `npm ci`, prueba nativa, suite completa y auditoría de producción.

## Ejecución

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Set-Location C:\Repos\POS_Restaurante
powershell -ExecutionPolicy Bypass -File .\scripts\upgrade-sqlite3.ps1
```
