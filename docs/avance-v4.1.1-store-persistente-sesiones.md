# v4.1.1 · Store persistente de sesiones

## Qué se está haciendo

Se sustituye `MemoryStore` como almacenamiento técnico de `express-session` por un store SQLite local y persistente. La sesión HTTP conserva el contrato existente de MundiPOS y puede recuperarse después de reiniciar el proceso Node mientras la cookie y la fila persistida sigan vigentes.

## Dónde se está haciendo

Archivos de esta fase:

- `server/app.js`: crea y conecta el store persistente a `express-session`.
- `server/services/sqliteSessionStore.js`: implementa el contrato del store sobre SQLite.
- `tests/persistentSessionStore.test.js`: cubre persistencia, expiración, sesión inexistente, login, verify, reinicio y logout.
- `docs/avance-v4.1.1-store-persistente-sesiones.md`: registra diseño, alcance y evidencia.

No se modificaron `package.json`, `package-lock.json`, `.gitignore`, rutas de autenticación ni archivos frontend. Durante el cierre documental se actualiza únicamente el resumen canónico de `README.md`.

## Por qué se está haciendo

`server/app.js` configuraba `express-session` sin `store`, por lo que Express utilizaba `MemoryStore`. La cookie `pos.sid` podía permanecer en el navegador durante 24 horas, pero la sesión asociada desaparecía al reiniciar Node y `/api/auth/verify` dejaba de reconocer al usuario.

La auditoría también confirmó que `server/routes/auth.js` y `server/routes/tables.js` consultan `req.sessionStore.all()` para reconstruir roles operativos activos. El reemplazo debe preservar esa operación además de `get`, `set`, `destroy` y `touch`.

## Qué no se modifica

Esta fase no implementa:

- sesiones únicas ni límites de dispositivos;
- políticas distintas para usuarios, administradores o cuentas departamentales;
- bloqueo de logout por responsabilidades;
- transferencia administrativa, presencia, revocación o reportería;
- cambios en login, logout o `/api/auth/verify`;
- cambios en SPA/PWA;
- cambios en permisos funcionales;
- cambios en Mesas, Cuentas, Payments, Créditos, Kitchen, Printing, Dashboard o Reportería;
- cambios de versión visible, `APP_VERSION` o `STABILITY_TRACK`.

## Contratos preservados

- Login y bootstrap siguen escribiendo los mismos campos en `req.session`.
- Logout sigue usando `req.session.destroy()` y limpiando `pos.sid`.
- `/api/auth/verify` sigue siendo la recuperación autenticada existente.
- `req.session`, `req.sessionStore` y `req.sessionID` conservan el contrato de `express-session`.
- `resave: false`, `saveUninitialized: false`, el nombre `pos.sid` y `maxAge` de 24 horas no cambian.
- La PWA continúa enviando las APIs por red y no cachea respuestas de autenticación.
- Realtime sigue siendo señal de invalidación; los read models persistidos continúan siendo fuente de verdad.
- Se preservan todos los contratos financieros y operativos de MundiPOS 3.0.

## Diseño elegido

### Store

Se implementó `SQLiteSessionStore` sobre el `sqlite3@6.0.1` ya fijado por el proyecto. Implementa:

- `get`;
- `set`;
- `destroy`;
- `touch`;
- `all`;
- `length`;
- `clear`.

El store espera a que su esquema esté listo antes de atender operaciones. El arranque principal también espera `sessionStore.ready()` antes de abrir el servidor.

### Ubicación

La ubicación predeterminada es:

`data/sessions.db`

Puede sustituirse para pruebas o instalaciones especiales mediante `SESSION_DB_PATH`. La base es independiente de `data/restaurant.db`; no contiene datos financieros ni se integra en `createTables()` o `migrateSchema()`.

### Esquema técnico

El archivo de sesiones crea de forma idempotente una tabla técnica separada:

```sql
CREATE TABLE IF NOT EXISTS express_sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
```

Existe un índice por `expires_at`. SQLite utiliza WAL y `busy_timeout = 5000` para mantener el comportamiento local concurrente consistente con el resto del proyecto.

### Expiración y limpieza

- `expires_at` se calcula desde `cookie.expires` o `cookie.maxAge`.
- Si la sesión no trae expiración explícita, se aplica el mismo TTL predeterminado de 24 horas.
- `get`, `all` y `length` excluyen filas expiradas.
- Las filas expiradas se eliminan al iniciar el store.
- Una limpieza periódica se ejecuta cada 15 minutos y su temporizador no mantiene vivo el proceso.
- Logout destruye inmediatamente la fila mediante el contrato normal de `express-session`.

### Protección Git y ZIP

No fue necesario modificar `.gitignore`; sus reglas existentes ya cubren:

- `data/*.db`;
- `data/*.db-wal`;
- `data/*.db-shm`;
- `data/*.db-journal`.

`git check-ignore -v` confirmó que `data/sessions.db` y sus archivos WAL/SHM están ignorados. Por vivir bajo `data/` y estar ignorados, no forman parte del repositorio ni del ZIP mínimo de actualización. `data/restaurant.db` conserva la misma protección.

### Decisión de dependencias

No se agregó una dependencia nueva. Se evaluó `connect-sqlite3`, pero su versión actual declara un peer dependency `sqlite3 ^5.0.0`, incompatible con el `sqlite3 6.0.1` fijado en MundiPOS. Instalarlo obligaría a duplicar el módulo nativo o ignorar la resolución de peers. El store acotado usa la dependencia ya instalada, evita ese riesgo y permite probar directamente el contrato requerido por el código actual, incluido `all()`.

## Resultado esperado

Después de un login válido:

1. Express guarda la sesión en `data/sessions.db`.
2. El navegador conserva `pos.sid`.
3. Node puede detenerse y volver a iniciar.
4. El store vuelve a abrir la misma base y recupera la sesión no expirada.
5. `/api/auth/verify` reconoce al usuario sin un nuevo login.
6. Logout elimina la sesión y la cookie anterior deja de autenticar.

## Pruebas previstas

- Sintaxis de los archivos modificados/nuevos.
- Contrato directo del store y compatibilidad de `all()`.
- Sesión activa persistida después de cerrar y reabrir SQLite.
- Sesión expirada no recuperable después de reabrir el store.
- SID inexistente no autenticado.
- Login/bootstrap normal y `/api/auth/verify`.
- Reinicio real de un proceso Node conservando la cookie.
- Logout y verificación posterior no autenticada.
- Regresión contractual y suite completa.
- Validación manual en la instalación operativa.

## Resultado real

Evidencia final confirmada por el usuario el 21 de julio de 2026:

### Implementación resultante

`MemoryStore` fue sustituido por un store SQLite persistente cuyo archivo runtime es `data/sessions.db`.
No se agregó ninguna dependencia; se utilizó directamente la dependencia SQLite existente en MundiPOS.

Se conservaron:

- `pos.sid`;
- TTL de 24 horas;
- login actual;
- logout actual;
- `/api/auth/verify`;
- contrato `req.session`;
- compatibilidad de `req.sessionStore.all()`.

El store implementa:

- `get`;
- `set`;
- `destroy`;
- `touch`;
- `all`;
- `length`;
- `clear`.

Existe limpieza de sesiones expiradas.
`data/sessions.db` permanece local, ignorada y no trackeada.
`data/restaurant.db` no fue manipulada.

### Validación automática final

- Pruebas específicas de persistencia: aprobadas.
- Contrato de cierre: **5/5**.
- Suite completa: **191/191**.
- Fallos: **0**.

Durante la primera ejecución global apareció una expectativa documental preexistente obsoleta en `tests/mundiPos3ClosureContract.test.js`.
La expectativa fue actualizada para distinguir el estado histórico previo al cierre conservado en `docs/PROMPT-CONTINUIDAD-MUNDIPOS-3.0.md` del estado canónico final del `README.md`, que declara MundiPOS 3.0 cerrado, validado y publicado en `v3.7.0-fix1`. La corrección no modificó funcionalidad.

## Validación manual

**APROBADA.**

El usuario confirmó:

1. Login normal.
2. F5 conserva la sesión.
3. Reinicio completo de Node.
4. Recuperación de la sesión sin volver a solicitar credenciales.
5. Creación correcta de `data/sessions.db`.
6. `data/sessions.db` no aparece en `git status`.
7. Logout normal.
8. Después del logout la aplicación vuelve al login.
9. Reiniciar Node después del logout no revive la sesión eliminada.

La persistencia, destrucción y no reaparición de sesiones quedaron validadas en navegador y servidor real.

## Estado

**Publicada.**

v4.1.1 está implementada, probada, validada manualmente y consolidada en el repositorio remoto.

## Commit funcional/publicado de la subfase

`a8525e0f8110935b2cad20326313c9c73745b677`
