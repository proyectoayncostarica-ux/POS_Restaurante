# v3.0.1 · Infraestructura transaccional y pruebas base

## Objetivo

Crear la base técnica común antes de modificar cuentas, prefacturas, pagos, saldos, documentos o liberación de mesas. Esta subfase no cambia la operación visible del POS.

## Implementación

### Transacciones SQLite reutilizables

`server/db/database.js` incorpora:

- `database.withTransaction(work, options)`;
- modos `DEFERRED`, `IMMEDIATE` y `EXCLUSIVE`;
- conexión SQLite aislada por transacción;
- cola local para serializar mutaciones críticas dentro del proceso;
- rollback centralizado;
- savepoints para transacciones anidadas;
- callbacks `afterCommit()` y `afterRollback()`;
- resolución automática de `database.run/get/all` hacia la conexión transaccional activa;
- constructor configurable para bases temporales de prueba.

El uso previsto para mutaciones financieras es:

```js
await database.withTransaction(async tx => {
    await tx.run('...');
    await tx.run('...');
    tx.afterCommit(() => realtime.emit(...));
}, { mode: 'IMMEDIATE' });
```

Los eventos realtime o efectos externos deben registrarse con `afterCommit` para no anunciar cambios que finalmente fueron revertidos.

### Servicio transaccional

Se agrega `server/services/transactionService.js` como fachada común para los futuros servicios de dominio:

- `run()`;
- `immediate()`;
- `deferred()`;
- `exclusive()`.

### Errores de dominio

Se agrega `server/errors/domainError.js` con códigos y estados HTTP estables:

- `DomainError`;
- `ValidationError`;
- `UnauthorizedError`;
- `ForbiddenError`;
- `NotFoundError`;
- `ConflictError`;
- `IdempotencyConflictError`;
- `InvariantError`.

Todavía no se reemplaza el manejo de errores de las rutas existentes. Los nuevos servicios v3 deberán usar estos errores gradualmente.

### Utilidades monetarias

`server/utils/money.js` centraliza:

- conversión a unidades menores;
- redondeo determinista a dos decimales;
- suma y resta monetaria;
- multiplicación por cantidad;
- cálculo porcentual;
- validación de montos no negativos.

Esto evita repetir operaciones monetarias directas con flotantes en Payments, prefacturas y reportes.

### Base de idempotencia

`server/utils/idempotency.js` incorpora:

- generación de claves;
- validación y normalización;
- serialización estable de payloads;
- fingerprint SHA-256 de solicitudes.

La persistencia de claves se implementará cuando se cree el núcleo de Payments; esta subfase establece el contrato utilitario.

## Pruebas automáticas

Se crea una suite con `node:test` y SQLite temporal.

Cobertura inicial:

1. commit de varias escrituras;
2. rollback completo ante una falla intermedia;
3. transacciones anidadas con savepoints;
4. ejecución de `afterCommit` después de confirmar;
5. dos débitos concurrentes sin saldo negativo;
6. operaciones monetarias deterministas;
7. claves y fingerprints de idempotencia;
8. fixture mínimo de usuarios, roles, zonas, mesas, productos y pedidos.

La suite usa el driver `sqlite3` real cuando está disponible. En entornos de validación donde el binding nativo no puede cargarse, los tests usan una capa compatible basada en `node:sqlite`; esto no modifica el runtime productivo.

Resultado de validación:

```text
11 pruebas aprobadas
0 fallos
```

## Scripts

```powershell
npm test
npm run test:transactions
npm run test:domain
```

## Versionado

- Versión visible: `3.0`.
- Versión de paquete: `3.0.1`.
- Seguimiento interno: `3.0.1`.

## Alcance excluido

Esta fase no:

- cambia Dashboard, Cuentas o Caja;
- migra rutas existentes a servicios;
- crea tablas de prefacturas o pagos;
- crea capacidades de Cajero;
- modifica el comportamiento de cobro;
- cambia PWA o UI.

## Archivos modificados o creados

- `README.md`
- `docs/README-v3.0.md`
- `docs/roadmap-v3.0-arquitectura-modular.md`
- `docs/avance-v3.0.1-infraestructura-transaccional-pruebas.md`
- `package.json`
- `package-lock.json`
- `server/config/appInfo.js`
- `server/db/database.js`
- `server/services/transactionService.js`
- `server/errors/domainError.js`
- `server/utils/money.js`
- `server/utils/idempotency.js`
- `tests/helpers/testDatabase.js`
- `tests/helpers/sqlite3Fallback.js`
- `tests/fixtures/baseFixture.js`
- `tests/transactionService.test.js`
- `tests/money.test.js`
- `tests/idempotency.test.js`
- `tests/baseFixture.test.js`

## Criterio de cierre

La subfase se considera aprobada cuando:

- `npm test` pasa;
- rollback y concurrencia están comprobados;
- la aplicación inicia sin cambios visibles;
- los archivos sensibles no entran al staging;
- commit y push quedan completos.
