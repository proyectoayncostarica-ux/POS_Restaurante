# v4.2.2 · Ciclo de vida login / logout / expiración

## 1. Objetivo

Integrar el modelo persistente `sesiones_usuario` con el ciclo real de autenticación, conservando separadas sus responsabilidades:

```text
LOGIN exitoso → ACTIVA
LOGOUT exitoso → CERRADA
TTL técnico → EXPIRADA
```

La sesión técnica continúa en `data/sessions.db`, bajo `express-session`, la cookie `pos.sid` y su TTL de 24 horas. El historial auditable continúa en `data/restaurant.db`, con `session_uuid` propio. Ninguna finalización elimina filas de `sesiones_usuario`.

## 2. Auditoría del flujo previo

- `POST /api/auth/login` validaba usuario, contraseña y acceso operativo, escribía campos en `req.session` y agregaba el evento textual `login` a `historial_transacciones`. No creaba `sesiones_usuario`, no forzaba `req.session.save()` antes de responder y no ejecutaba `req.session.regenerate()`.
- La creación inicial mediante `POST /api/auth/bootstrap-admin` también dejaba una sesión autenticada y el evento `bootstrap_admin`, pero no tenía fila histórica de sesión.
- `POST /api/auth/logout` insertaba el evento textual `logout` y luego destruía `req.session`; no cerraba una fila de `sesiones_usuario`.
- `GET /api/auth/verify` reconocía la sesión recuperada y reconstruía la respuesta operativa. No escribía en `sesiones_usuario`.
- El store técnico consideraba vencida una fila en `get()` mediante el filtro de TTL, y eliminaba vencidas al inicializarse y mediante una limpieza periódica. `all()` y `length()` las excluían. Ninguna vía notificaba el fin a la base histórica.
- `historial_transacciones` ya conservaba eventos textuales de bootstrap, login y logout. Este mecanismo es complementario al ciclo estructurado y no fue eliminado ni reemplazado.

## 3. Ciclo implementado

### Login

Una autenticación aceptada guarda primero la sesión técnica, incluyendo un nuevo `userSessionUuid` interno y el `client_id` recibido desde `X-MundiPOS-Client`. Luego, dentro de una transacción de `restaurant.db`, crea la fila `activa` en `sesiones_usuario` y conserva el evento correspondiente en `historial_transacciones`.

La fila registra:

- UUID histórico propio;
- usuario autenticado;
- SID técnico actual;
- cliente lógico nullable;
- estado `activa`;
- instante de inicio;
- finalización y motivo nulos.

Las credenciales inválidas y los rechazos existentes anteriores a la aceptación no crean filas. No se modificaron las reglas de credenciales ni se introdujo una política de dispositivos.

### Logout

Un logout autenticado:

1. captura SID, UUID histórico, usuario e instante;
2. dentro de una transacción de `restaurant.db`, cambia únicamente la fila `activa` correlacionada a `cerrada`, con `finalizada_en` y motivo `logout`;
3. conserva el evento textual `logout`;
4. destruye la sesión técnica antes de confirmar la transacción histórica;
5. responde éxito solo si completó el proceso.

La fila histórica permanece. Un logout sin usuario autenticado solo destruye la sesión técnica, como operación idempotente.

### Expiración

Cuando el store detecta el TTL real de un SID, invoca un hook desacoplado. La capa de lifecycle cambia únicamente filas todavía `activas` a:

```text
estado = expirada
finalizada_en = instante de vencimiento técnico
motivo_finalizacion = expiracion_ttl
```

Los eventos repetidos no vuelven a modificar filas ya finalizadas.

## 4. Manejo del SID reutilizado

No se agregó `req.session.regenerate()`; se conserva la política publicada del SID.

Si un nuevo login exitoso reutiliza un SID que ya tiene una fila activa, la transacción histórica:

1. cambia la fila anterior a `reemplazada`;
2. registra `finalizada_en`;
3. usa el motivo `reauthenticacion_mismo_sid`;
4. crea una fila nueva `activa` con otro `session_uuid`.

Así se conserva quién estuvo autenticado y no quedan dos filas activas normales para el mismo SID. Esto resuelve integridad del lifecycle, no concurrencia entre dispositivos.

## 5. Estrategia de consistencia entre databases

`sessions.db` y `restaurant.db` son bases SQLite distintas y no admiten una transacción atómica común.

En login se eligió este orden:

1. construir y guardar explícitamente `req.session` en el store técnico;
2. abrir una transacción en `restaurant.db`;
3. reemplazar, si aplica, la fila activa previa del mismo SID;
4. crear la nueva fila activa y el evento textual;
5. responder éxito.

Si falla el guardado técnico, no se registra historia ni se responde éxito. Si falla la transacción histórica, se intenta destruir la sesión técnica como compensación, se limpia la cookie y no se responde éxito. De esta forma no se acepta silenciosamente un login utilizable sin respaldo auditable.

En logout, la transición histórica y el evento textual permanecen sin confirmar mientras se destruye la sesión técnica. Si la destrucción falla, la transacción histórica se revierte y el logout no se declara exitoso. Si la destrucción técnica alcanza a completarse y luego falla excepcionalmente el commit histórico, no existe rollback entre bases: el logout tampoco se declara exitoso y la reconciliación de arranque termina la fila activa huérfana.

## 6. Expiración

Las vías auditadas e integradas son:

- `get()`: consulta también el vencimiento, notifica el SID expirado y elimina la fila técnica;
- inicialización: la eliminación inicial se difiere hasta que `restaurant.db` y el hook estén disponibles; el primer listado/reconciliación procesa los TTL vencidos;
- limpieza periódica: `deleteExpired()` notifica cada SID antes de eliminarlo;
- `touch()`: si encuentra una fila ya vencida, procesa su expiración en vez de renovarla;
- `all()`, `length()` y `listActiveSessions()`: ejecutan primero la misma limpieza integrada.

El store solo informa `sid`, sesión serializada e instante de expiración. No conoce ni consulta `sesiones_usuario`. Si el hook histórico falla, la fila técnica vencida se conserva para reintento, se emite `expirationError` y sigue sin considerarse una sesión válida.

`destroy()` continúa representando destrucción explícita y no se confunde con TTL; el logout controla su propia transición a `cerrada`.

## 7. Reconciliación

Se ejecuta al arrancar el servidor, después de:

1. inicializar `restaurant.db`;
2. esperar que el store técnico esté listo;
3. instalar el hook de expiración;
4. limpiar/listar únicamente sesiones técnicas todavía válidas.

El algoritmo transaccional compara las filas históricas `activas` con los SID técnicos válidos:

- histórica activa sin SID técnico válido → `expirada`, motivo `reconciliacion_sin_sesion_tecnica`;
- SID técnico autenticado con su fila activa correlacionada → permanece `activa`;
- SID técnico autenticado heredado sin fila activa → crea una fila activa de compatibilidad;
- varias filas activas para un SID → conserva la que coincide con UUID/usuario o la más reciente y marca las demás `reemplazada`;
- SID técnico sin usuario autenticado → finaliza cualquier fila activa correlacionada.

La reconciliación solo transiciona filas `activas`; no toca cerradas, revocadas, reemplazadas ni expiradas. Es idempotente. Un reinicio de Node no expira una sesión técnica válida ni crea una fila duplicada.

## 8. Compatibilidad histórica

`historial_transacciones` se conserva para los eventos textuales `bootstrap_admin`, `login` y `logout`. `sesiones_usuario` aporta el ciclo estructurado y correlacionable; no sustituye los logs existentes.

También se preservan:

- cookie `pos.sid` y TTL de 24 horas;
- persistencia y recuperación de v4.1.1;
- estados y recuperación SPA/PWA de v4.1.2;
- contrato de `req.session` y `req.sessionStore.all()`;
- comportamiento de `GET /api/auth/verify`, sin creación de filas;
- `ultima_actividad_en` nullable, sin heartbeat ni actualización por navegación;
- separación entre `express_sessions` y `sesiones_usuario`.

## 9. Decisiones diferidas

- v4.3 → responsabilidades operativas, bloqueo de logout y corrección completa del logout frontend.
- v4.4 → concurrencia y límites por usuario, cuenta o dispositivo.
- v4.5 → presencia, heartbeat y última actividad operacional.
- v4.6 → transferencia y revocación remota.
- v4.7 → administración de sesiones.
- v4.8 → reportería consolidada.

No se agregaron límites de sesiones, bloqueo de segundo dispositivo, consultas de mesas/cuentas, regeneración de SID, heartbeat, transferencia, revocación remota ni cambios de frontend.

## 10. Pruebas y validación

### Cobertura específica

`tests/userSessionLifecycle.test.js` valida:

- login correcto y login fallido;
- UUID, usuario, SID, `client_id`, inicio y estado activo;
- `verify` repetido sin duplicación;
- reautenticación sobre el mismo SID;
- persistencia tras reinicio de Node;
- logout, retención histórica y destrucción técnica;
- expiración por acceso, startup y limpieza;
- reconciliación de SID ausente/válido y reconstrucción idempotente de sesiones heredadas;
- coexistencia con `historial_transacciones`;
- separación técnica y ausencia de políticas de fases posteriores.

`tests/userSessionModel.test.js` fue actualizado porque la ausencia de integración con auth era una expectativa válida de v4.2.1, pero quedó legítimamente obsoleta en v4.2.2. La separación del store técnico y la ausencia de heartbeat, transferencia, revocación automática y límites continúan protegidas.

### Incidencia de la primera ejecución

La primera ejecución específica produjo **3/4**. El único fallo fue `undefined !== null` después de un logout exitoso. La prueba consultaba directamente `express_sessions` mediante `Database.get()`: al no existir ya la fila técnica, `sqlite3` devolvió correctamente `undefined`. La expectativa `null` era incorrecta porque SQL NULL representa una columna nula dentro de una fila existente.

Se corrigió únicamente:

```js
assert.equal(destroyedTechnical, undefined);
```

Era un bug de prueba, no un fallo del logout. La ausencia de fila demostraba que la sesión técnica había sido destruida correctamente. La revalidación posterior fue **4/4**.

### Resultados automáticos confirmados

```text
Lifecycle específico v4.2.2: 4/4
Modelo v4.2.1: 4/4
Store persistente: 2/2
SPA/PWA + Realtime: 10/10
Suite completa: 206/206
Fallos: 0
Canceladas: 0
Omitidas: 0
todo: 0
```

### Validación manual sobre la base operativa real

**APROBADA.**

El usuario validó `data/restaurant.db` y `data/sessions.db`:

1. Tras reiniciar con `npm start`, la inicialización canónica creó/verificó `sesiones_usuario` mediante `createTables()` y las migraciones existentes. No se ejecutó SQL manual ni se borraron bases.
2. Las sesiones técnicas válidas heredadas de v4.1 se reconstruyeron idempotentemente. `client_id = null` en registros heredados se confirmó como compatible.
3. Un login nuevo creó una fila `activa`, sin finalización ni motivo, con UUID, usuario, SID, inicio y `client_id = 43cc8566-4093-4eae-b665-0cc48eb40151`.
4. Cuatro refresh/verify conservaron la misma fila, UUID, SID y cliente, sin duplicados.
5. Un reinicio completo de Node recuperó la sesión y mantuvo la misma fila `activa`; reiniciar Node no se interpretó como expiración.
6. El logout cambió la fila a `cerrada`, con timestamp y motivo `logout`, sin eliminar el historial.
7. Después del logout, el SID dejó de existir en `express_sessions`; la fila histórica permaneció almacenada.

El ciclo final validado es:

```text
LOGIN          → ACTIVA
VERIFY / F5    → MISMA ACTIVA
REINICIO NODE  → MISMA ACTIVA
LOGOUT         → CERRADA
TTL            → EXPIRADA

ACTIVA anterior + nuevo login sobre el mismo SID
→ anterior REEMPLAZADA y finalizada
→ nueva ACTIVA
```

La expiración mediante hook desacoplado quedó cubierta para `get()`, `touch()`, startup, limpieza periódica, `all()`, `length()` y listados técnicos relevantes. La reconciliación conserva filas activas con SID válido, expira huérfanas, reconstruye sesiones heredadas y normaliza duplicados activos del mismo SID.

Esta integridad por `express_session_id` no constituye una política de concurrencia. v4.2.2 no limita sesiones por usuario ni aplica máximos para administradores; esas reglas permanecen diferidas a v4.4.
## 11. Archivos de implementación

- `server/routes/auth.js`.
- `server/app.js`.
- `server/services/sqliteSessionStore.js`.
- `server/services/userSessionService.js`.
- `tests/userSessionLifecycle.test.js`.
- `tests/userSessionModel.test.js`.
- `docs/avance-v4.2.2-ciclo-vida-sesiones.md`.
- `README.md`.

No se modificaron `server/db/database.js`, frontend, dependencias, versión visible ni dominios funcionales.

## 12. Estado

**Cerrada técnicamente — pendiente únicamente de publicación Git.**
