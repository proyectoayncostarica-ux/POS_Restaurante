# MundiPOS v4.3.2-fix1 · Login rechazado sobre una sesión autenticada

## Estado

- **Estado técnico:** IMPLEMENTADO Y VALIDADO EN PRUEBAS ESPECÍFICAS Y REGRESIONES DIRIGIDAS.
- **Validación manual:** PENDIENTE.
- **Publicación:** PENDIENTE; no existe commit funcional ni SHA publicado para este fix.
- **Base canónica de trabajo:** `fbcca71476ddca5beee40b81c823e29437cd3927` sobre `main`, confirmada limpia, sincronizada y sin divergencia antes de editar.
- **v4.4:** NO INICIADA.

## Defecto corregido

`POST /api/auth/login` admitía credenciales aun cuando la cookie recibida ya correspondía a una sesión autenticada. Como el flujo reutilizaba el SID técnico, podía sobrescribir la identidad de `req.session`, finalizar la fila histórica vigente como `reemplazada`, crear otra fila activa y permitir eludir el contrato de responsabilidad operativa que protege el logout desde v4.3.

## Contrato implementado

El backend rechaza el login inmediatamente cuando `req.session.userId` ya existe, antes de leer el cuerpo, consultar usuarios, validar credenciales o ejecutar cualquier mutación.

- **HTTP:** `409 Conflict`.
- **Código estable:** `SESSION_ALREADY_AUTHENTICATED`.
- **Respuesta:** `success: false`, con `error` y `message` legibles.
- **Alcance:** mismo usuario, otra identidad y usuarios Admin reciben exactamente el mismo rechazo.
- **Continuidad:** se conservan SID, cookie, identidad, `userSessionUuid`, sesión histórica activa, roles/capacidades derivadas, operación, responsabilidades y Realtime.
- **Auditoría:** el intento rechazado no crea ni reemplaza sesiones históricas y no agrega una transacción de login/logout.

El login sin sesión autenticada mantiene su comportamiento previo, tanto para credenciales válidas como inválidas.

## Implementación

- `server/routes/auth.js`: guardia autoritativa al inicio de `POST /api/auth/login`.
- `tests/loginAuthenticatedSessionGuard.test.js`: seis escenarios HTTP integrados con las bases SQLite histórica y técnica.
- `tests/userSessionLifecycle.test.js`: el contrato heredado deja de esperar una reautenticación exitosa sobre el mismo SID y comprueba que la fila activa original permanece intacta.
- No se modificaron frontend, PWA, versiones visibles, `package.json`, service worker ni metadata de estabilidad.

## Validación automatizada

- **Prueba específica:** **6/6**, 0 fallos.
  1. Mismo usuario sobre sesión autenticada.
  2. Otra identidad sobre sesión autenticada.
  3. Responsabilidad operacional vigente sin bypass.
  4. Admin autenticado sin excepción.
  5. Login normal sin sesión autenticada.
  6. Credenciales inválidas sin sesión autenticada.
- **Regresiones dirigidas:** **59/59**, 0 fallos, cubriendo lifecycle/store persistente, responsabilidad operacional, logout backend/UI, recuperación de sesión, acceso operacional y Realtime.
- **Suite completa:** **243/243**, 0 fallos.

## Criterio de cierre y publicación

Este documento registra el estado técnico local. El fix no debe declararse publicado hasta completar la suite, la validación manual requerida y el flujo separado de commit/push. El README deberá incorporar el SHA únicamente después de una publicación real.
