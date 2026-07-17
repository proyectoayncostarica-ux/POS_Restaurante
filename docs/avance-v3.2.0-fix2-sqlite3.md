# v3.2.0 fix2 · Actualización controlada del driver SQLite

## Objetivo

Eliminar la cadena vulnerable heredada de `sqlite3 5.1.7` sin ejecutar `npm audit fix --force` de forma ciega y sin cambiar el contrato de persistencia de MundiPOS.

La fase actualiza de manera explícita:

```text
sqlite3 5.1.7 → sqlite3 6.0.1
```

La versión se fija exactamente en `6.0.1`. Cualquier actualización posterior del driver deberá pasar nuevamente por pruebas de instalación, migración, transacciones, concurrencia e integridad.

## Compatibilidad mínima

```text
Node.js >= 20.17.0
Windows x64 para usar el binario precompilado oficial
```

El equipo servidor validado por el proyecto utiliza Node.js `24.16.0`, por lo que cumple el requisito.

## Alcance

Esta corrección:

- actualiza el driver nativo SQLite;
- regenera `package-lock.json` desde el lockfile protegido por `v3.2.0 fix1`;
- comprueba una instalación reproducible con `npm ci`;
- agrega una prueba que usa el binario real, no el fallback de pruebas;
- valida WAL, claves foráneas, commit, rollback e `integrity_check`;
- conserva las APIs de `sqlite3` usadas por `server/db/database.js`;
- mantiene la versión funcional de MundiPOS en `3.2.0`;
- no altera rutas, UI, Payments, Caja ni el esquema de negocio.

## Generación del lockfile

El ZIP no reemplaza `package-lock.json` con una copia creada en otro entorno. Esto es intencional: el repositorio local ya contiene el lockfile corregido y comprometido en `v3.2.0 fix1`.

El script parte de ese estado exacto y deja que npm regenere únicamente la resolución necesaria para `sqlite3 6.0.1` en el equipo servidor. Después, `npm ci` demuestra que el nuevo lockfile es reproducible.

## Instalación controlada

Después de extraer el paquete sobre la raíz del proyecto:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Set-Location C:\Repos\POS_Restaurante

powershell -ExecutionPolicy Bypass -File .\scripts\upgrade-sqlite3.ps1
```

El script:

1. valida la versión de Node y la arquitectura;
2. impide actualizar mientras el puerto 3000 esté ocupado;
3. respalda temporalmente `package.json` y `package-lock.json`;
4. fija `sqlite3@6.0.1`;
5. registra el requisito `Node >=20.17.0`;
6. ejecuta `npm ci`;
7. ejecuta la prueba nativa y la suite completa;
8. ejecuta auditoría de dependencias de producción;
9. restaura los manifests si la actualización falla.

## Prueba nativa incorporada

```text
tests/sqliteDriverCompatibility.test.js
```

La prueba verifica:

- paquete exacto `sqlite3 6.0.1`;
- carga correcta del addon nativo;
- creación de una base temporal;
- modo WAL;
- `busy_timeout`;
- commit y rollback;
- cumplimiento de claves foráneas;
- opciones de compilación disponibles;
- `PRAGMA integrity_check = ok`.

Las pruebas existentes continúan validando `withTransaction`, savepoints, concurrencia, migraciones, cuentas, prefacturas y Payments.

## Validación operativa obligatoria

Después del script:

```powershell
npm start
```

Confirmar:

- inicio por HTTPS con los certificados locales;
- conexión a `data/restaurant.db`;
- migraciones sin errores;
- login;
- Dashboard;
- apertura y lectura de cuentas;
- emisión de prefacturas;
- Caja;
- reinicio del servidor conservando la información;
- `PRAGMA integrity_check` correcto sobre una copia de la base operativa.

El servidor debe detenerse antes de ejecutar Git.

## Auditoría

Ejecutar:

```powershell
npm audit --omit=dev
npm ls sqlite3 --depth=0
```

No debe ejecutarse `npm audit fix --force`. Si npm reporta una vulnerabilidad nueva, se conserva el reporte y se analiza antes de modificar otra dependencia mayor.

## Riesgo residual y deuda técnica

`sqlite3 6.0.1` corrige la cadena vulnerable que motivó esta fase y conserva la API existente. Sin embargo, el repositorio upstream está marcado como deprecado y sin mantenimiento activo.

Por eso se registra una deuda técnica para evaluar un driver mantenido en una fase posterior. Ese reemplazo no se mezcla con Payments porque implicaría cambiar la capa completa de persistencia y requeriría una migración independiente.

## Rollback

El script restaura automáticamente los manifests ante un fallo. También puede revertirse mediante Git:

```powershell
git restore package.json package-lock.json
npm ci
```

La base operativa no debe restaurarse ni incluirse en Git para revertir una dependencia.

## Commit

```powershell
git commit -m "v3.2.0 fix2: actualiza driver SQLite de forma controlada"
```
