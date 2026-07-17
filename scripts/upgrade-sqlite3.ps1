#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$SkipFullTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if (-not (Test-Path '.\package.json')) {
    throw "No se encontro package.json en $ProjectRoot"
}

$nodeCommand = Get-Command node -ErrorAction Stop
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction Stop
}

$nodeVersionText = (& $nodeCommand.Source -p "process.versions.node").Trim()
$nodeVersion = [version](($nodeVersionText -split '-')[0])
$minimumNode = [version]'20.17.0'

if ($nodeVersion -lt $minimumNode) {
    throw "sqlite3 6.0.1 requiere Node.js 20.17.0 o superior. Version detectada: $nodeVersionText"
}

$platform = (& $nodeCommand.Source -p "process.platform").Trim()
$architecture = (& $nodeCommand.Source -p "process.arch").Trim()

if ($platform -eq 'win32' -and $architecture -ne 'x64') {
    throw "El binario precompilado para Windows se publica para x64. Plataforma detectada: $platform-$architecture"
}

if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($listener) {
        throw "El puerto 3000 esta ocupado por el PID $($listener.OwningProcess). Deten MundiPOS antes de actualizar SQLite."
    }
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $env:TEMP "mundipos-sqlite3-upgrade-$timestamp"
New-Item -ItemType Directory -Force $backupDir | Out-Null
Copy-Item '.\package.json' (Join-Path $backupDir 'package.json') -Force
if (Test-Path '.\package-lock.json') {
    Copy-Item '.\package-lock.json' (Join-Path $backupDir 'package-lock.json') -Force
}

function Invoke-Npm {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & $npmCommand.Source @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Fallo: npm $($Arguments -join ' ')"
    }
}

function Update-PackageJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TemporaryDirectory
    )

    # npm.cmd pasa por cmd.exe en Windows PowerShell 5.1. Los caracteres > de
    # engines.node pueden reinterpretarse como redireccion. Editamos JSON con
    # Node para evitar por completo el problema de quoting.
    $patchPath = Join-Path $TemporaryDirectory 'patch-package-json.cjs'
    $patchSource = @'
const fs = require('fs');
const path = require('path');

const packagePath = path.resolve(process.cwd(), 'package.json');
const raw = fs.readFileSync(packagePath, 'utf8').replace(/^\uFEFF/, '');
const pkg = JSON.parse(raw);

pkg.engines = pkg.engines || {};
pkg.engines.node = '>=20.17.0';

pkg.scripts = pkg.scripts || {};
pkg.scripts['test:sqlite-driver'] = 'node --test --test-concurrency=1 tests/sqliteDriverCompatibility.test.js';
pkg.scripts['security:audit'] = 'npm audit --omit=dev';

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
'@

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($patchPath, $patchSource, $utf8NoBom)

    & $nodeCommand.Source $patchPath
    if ($LASTEXITCODE -ne 0) {
        throw 'No se pudo actualizar package.json de forma segura.'
    }
}

try {
    Write-Host "Node.js: $nodeVersionText"
    Write-Host "Plataforma: $platform-$architecture"
    Write-Host "Respaldo temporal: $backupDir"
    Write-Host ""

    Update-PackageJson -TemporaryDirectory $backupDir

    # Version exacta para impedir cambios silenciosos del driver nativo.
    Invoke-Npm -Arguments @('install', 'sqlite3@6.0.1', '--save-exact')

    # Comprueba que el lockfile reproduce una instalacion limpia.
    Invoke-Npm -Arguments @('ci')
    Invoke-Npm -Arguments @('ls', 'sqlite3', '--depth=0')
    Invoke-Npm -Arguments @('run', 'test:sqlite-driver')

    if (-not $SkipFullTests) {
        Invoke-Npm -Arguments @('test')
    }

    # El comando falla solo si queda una vulnerabilidad alta o critica.
    Invoke-Npm -Arguments @('audit', '--omit=dev', '--audit-level=high')

    Write-Host ""
    Write-Host "Actualizacion controlada completada." -ForegroundColor Green
    Write-Host "Ejecuta npm start y valida HTTPS, login, Cuentas, prefacturas, Caja y persistencia tras reiniciar."
    Write-Host "Despues revisa git diff -- package.json package-lock.json."
} catch {
    Write-Warning "La actualizacion no termino correctamente. Se restauraran package.json y package-lock.json."
    Copy-Item (Join-Path $backupDir 'package.json') '.\package.json' -Force
    if (Test-Path (Join-Path $backupDir 'package-lock.json')) {
        Copy-Item (Join-Path $backupDir 'package-lock.json') '.\package-lock.json' -Force
    }
    Write-Warning "Ejecuta npm ci para restaurar node_modules conforme al lockfile anterior."
    throw
}
