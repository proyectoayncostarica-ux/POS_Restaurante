# v4.2.1 · Modelo persistente `sesiones_usuario`

## 1. Objetivo

Construir el registro persistente y auditable de sesiones de usuario que servirá como base para el ciclo de vida, concurrencia, presencia, revocación, transferencia, administración e informes de fases posteriores. Esta subfase crea únicamente el esquema y un repositorio mínimo; no modifica el comportamiento de autenticación.

## 2. Diferencia entre los dos modelos

### Sesión técnica HTTP

`data/sessions.db` contiene `express_sessions`, el store técnico de `express-session`. Su identidad es el SID de la cookie `pos.sid`, aplica TTL de 24 horas y puede eliminar filas expiradas. Su función es autenticar peticiones y recuperar `req.session` después de reiniciar Node.

### Registro persistente y auditable

`sesiones_usuario` pertenece a la base principal `data/restaurant.db`. Cada fila representa una instancia histórica de sesión de usuario mediante un UUID propio. Conserva la correlación interna con el SID técnico, pero no usa ni expone ese SID como identidad pública. Cambiar el estado de una fila no la elimina y la limpieza de `sessions.db` no afecta este historial.

Ambas bases continúan locales, ignoradas y no trackeadas. No se incorporó ninguna base real al repositorio.

## 3. Auditoría previa

- La base principal se resuelve en `server/db/database.js`; por defecto usa `data/restaurant.db` y admite `DB_PATH` para entornos controlados y pruebas.
- `initializeDatabase()` conecta SQLite, configura WAL y `busy_timeout`, desactiva temporalmente foreign keys durante compatibilidad legacy, ejecuta `createTables()`, `migrateSchema()`, `createIndexes()`, datos iniciales/consistencia y reactiva foreign keys.
- Las tablas nuevas se declaran mediante `CREATE TABLE IF NOT EXISTS` en `createTables()`; las columnas legacy se evolucionan con `ensureColumn()` y las reconstrucciones especializadas viven en métodos `ensure*`/`migrate*`.
- Los índices siguen la convención `CREATE INDEX IF NOT EXISTS` en `createIndexes()` o en migraciones especializadas cuando dependen de columnas reconstruidas.
- Las relaciones usan foreign keys SQLite explícitas con una acción `ON DELETE` elegida por contrato.
- Las fechas se representan como `TEXT`, usando `CURRENT_TIMESTAMP` en esquema y fechas ISO 8601 desde servicios cuando el evento aporta su instante.
- Los estados cerrados se protegen habitualmente con `CHECK(... IN (...))`.
- `usuarios.id` es la PK canónica del usuario: `INTEGER PRIMARY KEY AUTOINCREMENT`.
- Los servicios consultan mediante `database.get/all/run` y suelen permitir inyección de `db` para pruebas.
- `historial_transacciones` ya registra eventos textuales de login/logout. Se conserva intacto; v4.2.1 no lo elimina ni lo sustituye.

Para una tabla nueva sin datos legacy ni transformación necesaria, la convención idempotente adecuada es incorporarla a `createTables()` y sus índices a `createIndexes()`. No se creó un sistema de migraciones paralelo.

## 4. Diseño final

### Tabla y columnas

| Columna | Contrato |
|---|---|
| `id` | PK SQLite interna autoincremental. |
| `session_uuid` | Identidad propia, estable y única de la sesión registrada. |
| `usuario_id` | Referencia obligatoria a `usuarios.id`. |
| `express_session_id` | SID técnico interno para correlación/destrucción futura; no es PK ni `UNIQUE`. |
| `client_id` | Identificador lógico opcional recibido en el futuro desde `X-MundiPOS-Client`. |
| `estado` | Estado histórico: `activa`, `cerrada`, `revocada`, `reemplazada` o `expirada`. |
| `iniciada_en` | Instante de inicio, obligatorio. |
| `ultima_actividad_en` | Campo nullable previsto por el roadmap; v4.2.1 no implementa heartbeat ni actualizaciones automáticas. |
| `finalizada_en` | Instante de finalización, nullable mientras la sesión siga activa. |
| `motivo_finalizacion` | Motivo auditable, preparado para valores como `logout`, `expirada`, `revocada` o `reemplazada`. |
| `actualizado_en` | Instante de la última modificación persistida del registro. |

### Identidad y SID técnico

`id` es la PK local y `session_uuid` es la identidad estable que podrán usar futuras APIs sin revelar el SID. `express_session_id` permanece como dato interno de servidor y deliberadamente no es único: un mismo SID puede correlacionarse con más de un registro histórico.

### Relación con usuarios

La foreign key `usuario_id → usuarios.id` usa `ON DELETE RESTRICT`. La decisión protege la trazabilidad: una cuenta con historial no puede desaparecer dejando una sesión sin identidad. v4.2.1 todavía no crea filas desde login, por lo que no cambia el comportamiento actual de eliminación de usuarios; el tratamiento operativo posterior deberá respetar esta retención histórica.

### Índices

- `idx_sesiones_usuario_usuario_inicio (usuario_id, iniciada_en DESC)`: historial por usuario.
- `idx_sesiones_usuario_estado_inicio (estado, iniciada_en DESC)`: consultas por estado y antigüedad.
- `idx_sesiones_usuario_cliente_inicio (client_id, iniciada_en DESC)`: correlación futura por cliente lógico.
- `idx_sesiones_usuario_express_sid (express_session_id)`: correlación interna con el store técnico.
- `idx_sesiones_usuario_inicio (iniciada_en)`: rangos temporales e informes futuros.
- La unicidad de `session_uuid` crea el índice único de identidad. No existe unicidad sobre el SID.

## 5. Repositorio mínimo

`server/services/userSessionService.js` sigue la convención de servicio inyectable y ofrece únicamente persistencia:

- `create()`;
- `findByUuid()`;
- `findByExpressSessionId()`;
- `listByUser()`;
- `updateStatus()`.

Genera UUID con `crypto.randomUUID()` cuando no se proporciona uno. Actualizar el estado conserva la fila. El servicio no está importado por rutas ni contiene límites de dispositivos, heartbeat, transferencia o revocación automática.

## 6. Decisiones deliberadamente diferidas

- v4.2.2 → creación en login, cierre en logout y transición por expiración.
- v4.3 → responsabilidad operativa y contrato de logout.
- v4.4 → concurrencia y límites por tipo de cuenta.
- v4.5 → presencia, heartbeat y actualización real de última actividad.
- v4.6 → transferencia y revocación.
- v4.7 → administración de sesiones.
- v4.8 → reportería e historial consultable.

No se modificaron `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/verify`, `server/app.js`, `sqliteSessionStore`, frontend ni PWA.

## 7. Archivos modificados

- `server/db/database.js`.
- `server/services/userSessionService.js`.
- `tests/userSessionModel.test.js`.
- `docs/avance-v4.2.1-modelo-sesiones-usuario.md`.
- `README.md`.

## 8. Archivos revisados pero no modificados

- `docs/roadmap-v4-sesiones-continuidad-operativa.md`.
- `docs/avance-v4.1.1-store-persistente-sesiones.md`.
- `docs/avance-v4.1.2-recuperacion-sesion-spa-pwa.md`.
- `server/app.js`.
- `server/routes/auth.js`.
- `server/routes/users.js`.
- `server/services/sqliteSessionStore.js`.
- `server/services/transactionService.js`.
- `tests/helpers/testDatabase.js`.
- `tests/printingMigration.test.js`.
- `tests/persistentSessionStore.test.js`.
- `package.json`.

## 9. Validación ejecutada

El usuario ejecutó las pruebas específicas, las regresiones del store técnico y del mecanismo de migraciones SQLite, y la suite completa. La cobertura específica confirmó creación idempotente, columnas, PK/UUID, foreign key, estados, índices, `client_id`, SID no único, persistencia histórica, integridad y ausencia de integración prematura con auth/store.

## 10. Resultado real

- Pruebas específicas v4.2.1: **4/4**.
- Regresión del store técnico v4.1.1: **2/2**.
- Regresión del mecanismo de migraciones SQLite: **2/2**.
- Suite completa: **202/202**.
- Fallos: **0**.
- Canceladas: **0**.
- Omitidas: **0**.
- `todo`: **0**.

La validación funcional manual adicional no fue requerida porque v4.2.1 es una subfase estructural sin integración de frontend o autenticación.

## 11. Estado

**Cerrada — pendiente únicamente de publicación Git.**

## 12. Commit de cierre

Pendiente. No se realizó staging, commit ni push.
