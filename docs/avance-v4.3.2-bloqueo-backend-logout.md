# Avance v4.3.2 — Bloqueo backend del logout

## 1. Base

La intervención parte exclusivamente de la consolidación documental publicada de v4.3.1:

`0e55b8d0b3665fa7cfcc331bc8970531b6965547`

La base se verificó sobre la rama `main` con árbol de trabajo inicialmente limpio.

La implementación funcional de v4.3.2 fue publicada en:

`a8c54d6fe54b88ce05362a36584254abd2f7d4ae`

Después del push funcional se confirmó `main == origin/main` y working tree limpio.

## 2. Objetivo

Impedir que un usuario autenticado cierre sesión cuando el evaluador canónico confirme que conserva responsabilidad operacional activa. El bloqueo debe preservar íntegramente la sesión y devolver evidencia estructurada reutilizable por la futura UX de v4.3.3.

## 3. Auditoría previa

El usuario autenticado se obtiene de `req.session.userId`; el nombre, el UUID histórico y el identificador técnico provienen de la misma sesión autoritativa.

Antes de v4.3.2, `POST /api/auth/logout` seguía este orden para una sesión autenticada:

1. capturaba `userId`, `userName`, `req.sessionID` y `userSessionUuid`;
2. abría una transacción en la base operacional;
3. cerraba la fila activa de `sesiones_usuario`, primero por identificador técnico y UUID y luego mediante el fallback por identificador técnico;
4. insertaba el evento textual `logout` en `historial_transacciones`;
5. destruía la sesión de Express;
6. al completar la transacción, limpiaba la cookie `pos.sid` y devolvía éxito.

El cierre histórico y el evento textual eran transaccionales. Si alguno fallaba, la transacción revertía y el logout no devolvía éxito. Si `req.session.destroy()` fallaba, la transacción también revertía y la respuesta era un error servidor; si una confirmación de transacción fallaba después de destruir la sesión técnica, se mantenía la reconciliación ya documentada por v4.2.2.

Una solicitud sin usuario autenticado destruía de forma idempotente cualquier sesión técnica disponible, limpiaba la cookie y devolvía la misma respuesta exitosa. Este contrato se conserva.

Las respuestas JSON existentes usan `error` para el mensaje y, en conflictos operativos estables, agregan un `code` legible por máquina y evidencia específica. Ya existe el uso de HTTP `409 Conflict` para una operación válida impedida por estado de dominio.

## 4. Integración

La ruta consume exclusivamente:

`operationalResponsibilityService.getUserResponsibilities(userId)`

La llamada ocurre después de comprobar la autenticación y antes de calcular la hora de cierre, abrir la transacción, cerrar `sesiones_usuario`, insertar historial, destruir `express_sessions` o invalidar la cookie.

La ruta valida que el evaluador entregue un objeto con `tiene_responsabilidad` booleano y `responsabilidades` como arreglo. No duplica consultas sobre mesas, responsables o pedidos y no crea una segunda definición de responsabilidad.

## 5. Contrato de bloqueo

Cuando `tiene_responsabilidad === true`, el backend responde:

- HTTP `409 Conflict`;
- `success: false`;
- `code: "OPERATIONAL_RESPONSIBILITY_ACTIVE"`;
- `error` y `message` con el mensaje estable para el usuario;
- `tiene_responsabilidad: true`;
- `total`;
- `responsabilidades`, con la evidencia canónica producida por v4.3.1.

La evidencia puede identificar mesa, zona, causas operativas, asignación y cuentas operativas relacionadas sin agregar información sensible ni una API paralela.

El rechazo retorna antes de cualquier mutación: no cierra historial, no destruye la sesión técnica, no limpia la cookie, no registra un logout exitoso y no altera entidades operativas. La misma cookie continúa siendo reconocida por `/api/auth/verify`.

## 6. Logout permitido

Cuando `tiene_responsabilidad === false`, la ruta entra sin cambios al lifecycle publicado en v4.2.2:

- `sesiones_usuario` pasa de `activa` a `cerrada`;
- se registra `finalizada_en`;
- `motivo_finalizacion` queda en `logout`;
- `historial_transacciones` recibe el evento `logout`;
- se destruye la fila correspondiente de `express_sessions`;
- se invalida la cookie conforme al flujo existente;
- se devuelve la respuesta exitosa existente.

El logout no autenticado también conserva su comportamiento idempotente anterior.

## 7. Error técnico del evaluador

Si el evaluador lanza un error o devuelve una estructura inválida, la ruta aplica fail-closed y responde HTTP `500` con:

- `success: false`;
- `code: "OPERATIONAL_RESPONSIBILITY_CHECK_FAILED"`;
- `error` y `message` indicando que no fue posible verificar responsabilidades y que la sesión permanece activa.

Este error no incluye `tiene_responsabilidad: true`, porque no afirma una responsabilidad que no pudo confirmarse. Tampoco cierra `sesiones_usuario`, destruye `express_sessions`, limpia la cookie ni registra un logout exitoso.

## 8. Contratos preservados

- pago no equivale a finalización del servicio;
- saldo cero no equivale a liberación de mesa;
- conciliación financiera no equivale a cierre operacional;
- sesión técnica no equivale a responsabilidad operacional;
- `mesa_responsables` sigue siendo la fuente autoritativa de asignación actual;
- `cuenta_responsables` permanece como historia, no como fuente primaria actual;
- logout bloqueado no libera mesas, cierra pedidos, modifica cuentas ni transfiere responsabilidades;
- no existe excepción para administradores.

Por ello, una cuenta pagada y conciliada con `estado_operativo = abierta` sigue bloqueando cuando conserva la asignación actual, mientras que una mesa libre con servicio cerrado no bloquea solamente por su historial.

## 9. Tests preparados y ejecutados

Se preparó y ejecutó cobertura HTTP aislada para:

1. logout exitoso sin responsabilidad, incluido el cierre histórico y técnico de v4.2.2;
2. bloqueo por mesa propia activa;
3. preservación de `sesiones_usuario`, `express_sessions`, cookie y autenticación posterior;
4. código estable, total y evidencia correspondiente al usuario autenticado;
5. ausencia de bloqueo por responsabilidad asignada a otro usuario;
6. bloqueo de una cuenta pagada y conciliada cuyo servicio continúa abierto;
7. logout permitido con mesa libre, servicio cerrado y snapshot histórico;
8. fallo controlado del evaluador con comportamiento fail-closed;
9. ausencia de efectos secundarios sobre mesas, asignaciones y pedidos durante intentos bloqueados;
10. ausencia de evento textual de logout cuando el intento se bloquea;
11. compatibilidad idempotente del logout no autenticado.

También se ajustó la prueba estática del lifecycle para exigir el uso del evaluador canónico y prohibir consultas operativas duplicadas dentro de la ruta.

### Resultados automáticos

- Pruebas específicas (`tests/logoutOperationalResponsibility.test.js` y `tests/userSessionLifecycle.test.js`): **11/11**.
- Regresiones dirigidas (`tests/operationalResponsibilityService.test.js`, `tests/userSessionModel.test.js`, `tests/persistentSessionStore.test.js`, `tests/sessionRecoveryUi.test.js` y `tests/realtimeRecovery.test.js`): **24/24**.
- Suite completa: **221/221**.
- Fallos: **0**.
- Cancelados: **0**.
- Omitidos: **0**.
- Pendientes: **0**.
- `node --check server/routes/auth.js`: **APROBADA**.
- `node --check tests/userSessionLifecycle.test.js`: **APROBADA**.
- `node --check tests/logoutOperationalResponsibility.test.js`: **APROBADA**.
- `git diff --check`: **OK**. Los avisos LF→CRLF fueron informativos y no representaron errores.

### Validación manual

**APROBADA**, utilizando un usuario de tipo Estándar.

Escenario 1 — logout bloqueado:

- con responsabilidad operacional activa, `POST /api/auth/logout` respondió HTTP `409`, `code = OPERATIONAL_RESPONSIBILITY_ACTIVE`, `tiene_responsabilidad = true`, `total > 0`, total coherente con `responsabilidades.length` y evidencia estructurada real;
- `GET /api/auth/verify` respondió HTTP `200` con `authenticated = true`;
- un segundo intento volvió a bloquearse sin dañar la sesión.

Resultado: **APROBADO — logout bloqueado y sesión preservada**.

Escenario 2 — logout permitido:

- sin reautenticar al usuario, el servicio se finalizó mediante el flujo operacional normal y la mesa se liberó realmente;
- el nuevo `POST /api/auth/logout` respondió HTTP `200`, `ok = true` y sin código de conflicto;
- `GET /api/auth/verify` respondió `authenticated = false`.

Resultado: **APROBADO — responsabilidad finalizada y logout completado**.

El escenario de error técnico del evaluador quedó cubierto automáticamente y no se provocó manualmente sobre la base operativa.

### Interpretación de los 401 posteriores

Después del logout exitoso, las solicitudes repetidas `GET /api/dashboard → 401 Unauthorized` no representan un fallo del backend: confirman que la sesión ya fue destruida. Aparecieron porque el logout manual se ejecutó directamente con `fetch()` desde la consola mientras la interfaz abierta continuaba refrescando el dashboard. La transición visual y la detención de actualizaciones corresponden a v4.3.3.

El mensaje `Promise fulfilled → undefined` es el resultado normal del bloque asíncrono ejecutado desde la consola y no constituye una incidencia funcional de v4.3.2.

## 10. Fuera de alcance

No se implementa:

- v4.3.3 ni cambios de frontend, UX, modales, botón de logout o service worker;
- v4.4 ni límites de sesiones concurrentes;
- v4.5 ni heartbeat, presencia u online/offline;
- v4.6 ni takeover, transferencia o revocación;
- cambios de schema, tablas, columnas o migraciones;
- eventos Realtime nuevos.

## 11. Estado

**PUBLICADA.**

Commit funcional/publicado:

`a8c54d6fe54b88ce05362a36584254abd2f7d4ae`
