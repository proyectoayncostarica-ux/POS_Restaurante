# Avance v4.3.3 — Corrección frontend del logout bloqueado

## 1. Base de trabajo

- **Commit base exacto:** `be2c3660ae1c07c69c900f6b1895eb64ba900907`.
- **Rama:** `main`.
- **Estado inicial:** limpio.
- La base ya contenía v4.3.1 y v4.3.2 publicadas. Esta subfase no modifica sus contratos backend ni sus commits funcionales.

## 2. Objetivo

Corregir el frontend para que un rechazo del logout por responsabilidad operativa no fuerce un cierre local. Solo una respuesta exitosa del backend puede limpiar la sesión local y llevar al usuario al login.

## 3. Auditoría del flujo anterior

- `Utils.request()` interpretaba la respuesta JSON y exponía `status`, `code` y `details`, pero descartaba el payload completo y la evidencia `responsabilidades`.
- Todos los errores HTTP producían el mismo log genérico, aunque fueran conflictos operativos esperados.
- `Auth.logout()` ejecutaba `POST /auth/logout`; ante cualquier error limpiaba `currentUser`, detenía el refresco de Dashboard y Realtime y llamaba a `showLogin()`.
- El estado autenticado combina `currentUser` y `Auth.sessionState`; la salida exitosa ya detenía Dashboard, Realtime y los temporizadores asociados mediante el flujo de login.
- Los tres puntos de salida auditados fueron el botón de cabecera, la pantalla operativa por rol y el botón dinámico de Cocina. Todos convergen en `Auth.logout()`.
- La aplicación usa un único modal global. Antes no declaraba semántica de diálogo, restauración de foco, cierre con Escape ni trampa de Tab.
- Las notificaciones existentes no diferenciaban el conflicto operativo del fallo del evaluador.
- Dashboard mantiene auto-refresco y Cocina/Realtime mantienen temporizadores y conexión; conservarlos es necesario cuando el backend rechaza el logout.
- La PWA cargaba CSS y JavaScript con el identificador anterior y los precargaba en el service worker.

## 4. Contrato estructurado de error

`Utils.request()` conserva ahora, para respuestas no exitosas, `status`, `code`, `message`, `details` y el payload JSON completo en `error.payload` y `error.body`. De esta forma `Auth.logout()` puede consumir `responsabilidades` y `total` sin reconstruir ni reinterpretar el contrato backend.

Los códigos esperados del flujo se declaran explícitamente al realizar la solicitud. Esto evita que un conflicto de dominio conocido dispare recuperación global o ruido de consola genérico, sin silenciar errores inesperados de otras solicitudes.

## 5. Logout bloqueado por responsabilidad operativa

El manejo específico requiere simultáneamente HTTP `409` y el código estable `OPERATIONAL_RESPONSIBILITY_ACTIVE`. En ese caso:

- se conserva `currentUser` y el estado autenticado;
- no se llama a `showLogin()`;
- no se detienen Dashboard, Realtime ni los temporizadores operativos;
- no se recarga ni redirige la aplicación;
- se presenta la evidencia recibida del backend;
- los controles de logout vuelven a quedar disponibles cuando termina el intento.

No existe excepción por rol o por administrador.

## 6. Modal de responsabilidades

El diálogo usa el título **“No se puede cerrar sesión”**, explica que todavía existen responsabilidades activas y presenta el total y una lista de todas las responsabilidades recibidas. Cada elemento muestra únicamente datos disponibles y comprensibles: mesa, zona, estado, cantidad de cuentas y causas conocidas.

La única acción es **“Entendido”** y cierra solamente el modal. El contenido proveniente del backend se crea con nodos DOM y `textContent`; no se inyecta como HTML ni se imprime JSON crudo. Los valores nulos o ausentes se omiten o reciben una etiqueta segura.

El modal declara `role="dialog"`, `aria-modal`, título asociado, foco inicial, cierre con Escape, ciclo de foco con Tab y restauración del foco anterior. Su cuerpo es desplazable, la cabecera y el pie permanecen visibles y los estilos evitan desbordamiento horizontal tanto en escritorio como en móvil.

## 7. Fallo del evaluador de responsabilidades

HTTP `500` con `OPERATIONAL_RESPONSIBILITY_CHECK_FAILED` se trata de forma distinta: no se afirma que existan responsabilidades y no se muestra el modal de conflicto confirmado. Se informa que no fue posible verificar el cierre, se conserva íntegra la sesión y se registra una advertencia controlada sin volcar el payload.

## 8. Logout exitoso y expiración normal

La respuesta exitosa de `/auth/logout` conserva el comportamiento previo: limpia `currentUser`, detiene el auto-refresco de Dashboard, desconecta Realtime, muestra el login y notifica el cierre. La recuperación o expiración autenticada existente, incluido el manejo normal de `401`, no cambia.

## 9. Prevención de duplicados

`Auth.logoutInFlight` impide solicitudes simultáneas y los controles de salida se deshabilitan durante el intento. Mientras el modal de responsabilidad esté abierto tampoco puede iniciarse otro logout. Al cerrar el modal, un nuevo intento explícito vuelve a estar permitido.

## 10. Cobertura y validaciones dirigidas

`tests/logoutBlockedUi.test.js` cubre el contrato estructurado de errores, el reconocimiento exacto del bloqueo, la preservación de sesión y servicios operativos, el modal accesible, el renderizado DOM seguro, los controles de duplicados, el logout exitoso y la separación entre namespace global PWA y revisión de assets.

### Prueba específica

- **Resultado:** 16 pruebas; 16 aprobadas; 0 fallidas; 0 canceladas; 0 omitidas; 0 pendientes.
- **Resultado canónico:** **PRUEBA ESPECÍFICA: 16/16**.

### Regresiones dirigidas

- **Resultado:** 27 pruebas; 27 aprobadas; 0 fallidas; 0 canceladas; 0 omitidas; 0 pendientes.
- **Resultado canónico:** **REGRESIONES DIRIGIDAS: 27/27**.

## 11. Primera suite completa y regresión detectada

- **Resultado:** 237 pruebas; 233 aprobadas; 4 fallidas; 0 canceladas; 0 omitidas; 0 pendientes.
- **Tests fallidos:** `tests/cashUiWorkflow.test.js`, `tests/creditUiWorkflow.test.js`, `tests/legacyCleanupContract.test.js` y `tests/mundiPos3ClosureContract.test.js`.
- **Causa raíz:** la revisión `v4.3.3-logout-blocked-ui` se utilizó incorrectamente como `MUNDIPOS_SW_VERSION`, sustituyendo el namespace técnico global `v3.7.0-cross-domain-closure`.

La primera suite detectó correctamente una regresión contractual de PWA antes de la publicación. Este resultado **233/237, con 4 fallos**, se conserva como historial de diagnóstico y no representa un fallo funcional final.

## 12. Corrección del contrato PWA

Se restauró exactamente:

```text
MUNDIPOS_SW_VERSION = 'v3.7.0-cross-domain-closure'
```

Se preservaron:

- `package.json` → `3.7.0`;
- `package-lock.json` → `3.7.0`;
- `STABILITY_TRACK` → `3.7.0`;
- namespace global PWA → `v3.7.0-cross-domain-closure`.

La revisión `v4.3.3-logout-blocked-ui` se utiliza únicamente para el cache busting de los dos assets modificados:

- `style.css?v=v4.3.3-logout-blocked-ui`;
- `main.js?v=v4.3.3-logout-blocked-ui`.

El **namespace técnico global PWA no es la revisión específica de assets**. Los demás módulos conservan la revisión canónica `v3.7.0-cross-domain-closure`.

## 13. Validación del fix PWA

Se validaron conjuntamente `tests/logoutBlockedUi.test.js`, `tests/cashUiWorkflow.test.js`, `tests/creditUiWorkflow.test.js`, `tests/legacyCleanupContract.test.js` y `tests/mundiPos3ClosureContract.test.js`.

- **Resultado:** 40 pruebas; 40 aprobadas; 0 fallidas; 0 canceladas; 0 omitidas; 0 pendientes.
- **Resultado canónico:** **VALIDACIÓN FIX PWA: 40/40**.

La validación confirmó el namespace técnico global, las revisiones específicas de assets y la preservación de Caja, Créditos, limpieza legacy y el contrato de cierre MundiPOS 3.0.

## 14. Suite completa definitiva

Después del fix PWA y de las validaciones manuales se repitió la suite completa.

- **Resultado:** 237 pruebas; 237 aprobadas; 0 fallidas; 0 canceladas; 0 omitidas; 0 pendientes.
- **Resultado final autoritativo:** **SUITE COMPLETA DEFINITIVA: 237/237**.

La primera ejecución 233/237 permanece documentada como historial de diagnóstico; 237/237 es el resultado final.

## 15. Validación manual

**VALIDACIÓN MANUAL: APROBADA.**

### 15.1 PC — logout bloqueado

Con un usuario Estándar y una responsabilidad operativa activa, `POST /api/auth/logout` respondió HTTP `409` con `code = OPERATIONAL_RESPONSIBILITY_ACTIVE`.

La evidencia real confirmó `total = 1` y `responsabilidades.length = 1`: Mesa 1, Zona Barra, estado Ocupada, una cuenta operativa relacionada y causas Mesa ocupada y Servicio activo. El backend entregó información estructurada de mesa, zona, estado, causas, asignación y `cuentas_operativas`.

La interfaz mostró **“No se puede cerrar sesión”** y el mensaje **“Tienes responsabilidades operativas activas. Finaliza correctamente estos servicios antes de cerrar sesión.”**

Se validaron: modal único; título, total y lista correctos; contenido legible sin `null`, `undefined` ni JSON crudo; footer accesible; botones Entendido y ×; Escape; focus trap con Tab; restauración del foco; sesión, vista, Dashboard y Realtime preservados; ausencia de redirección, 401 posteriores y logging técnico duplicado; nuevo intento permitido.

**PC — LOGOUT BLOQUEADO: APROBADO.**

### 15.2 Móvil — logout bloqueado

Con responsabilidad operativa activa se validaron: modal único; título y cierre visibles; contenido legible; ausencia de overflow horizontal; scroll vertical; footer y botón Entendido accesibles; doble toque controlado; botones × y Entendido funcionales; sesión, vista y Realtime preservados; ausencia de 401; nuevo intento permitido.

**MÓVIL — LOGOUT BLOQUEADO: APROBADO.**

### 15.3 PC — logout permitido

Después de finalizar correctamente el servicio y liberar realmente la mesa, `POST /api/auth/logout` respondió HTTP `200`.

Se validaron: mesa liberada; ausencia del modal de bloqueo; login visible; vista operativa cerrada; Dashboard detenido; Realtime desconectado; ausencia de 401 posteriores y logging duplicado; nuevo login permitido.

**PC — LOGOUT PERMITIDO: APROBADO.**

### 15.4 Móvil — logout permitido

Después de finalizar correctamente el servicio, `POST /api/auth/logout` respondió HTTP `200`.

Se validaron: mesa liberada; modal ausente; login responsive; vista operativa cerrada; Dashboard y Cocina detenidos; Realtime desconectado; ausencia de 401 posteriores y logging duplicado; nuevo login permitido.

**MÓVIL — LOGOUT PERMITIDO: APROBADO.**

## 16. Contrato frontend final

`POST /api/auth/logout` consulta directamente al backend, que decide autoritativamente. No existe preflight frontend de responsabilidad.

- Para HTTP `409` + `OPERATIONAL_RESPONSIBILITY_ACTIVE`, se preservan `currentUser`, sesión, navegación, Dashboard, Cocina, timers, Realtime y vista actual, y se muestra el modal operativo.
- Para HTTP `500` + `OPERATIONAL_RESPONSIBILITY_CHECK_FAILED`, se conserva la sesión y se presenta un error técnico distinto sin afirmar que existen responsabilidades.
- Para HTTP `200`, se conserva el logout normal: limpieza del usuario, detención de Dashboard y Cocina cuando aplica, desconexión de Realtime y navegación al login.

## 17. Contrato de errores estructurados

`Utils.request()` conserva `status`, `code`, `message`, `details` y el payload completo en `payload/body`. Así no se pierden `tiene_responsabilidad`, `total` ni `responsabilidades`.

## 18. Accesibilidad y seguridad

El modal conserva ARIA, focus trap, Escape, restauración del foco, body desplazable, footer accesible y comportamiento responsive. El contenido se crea mediante DOM seguro y `textContent`, sin interpretación HTML. La prueba con contenido potencialmente malicioso quedó aprobada.

## 19. Control de duplicados

`logoutInFlight` y `logoutBlockedModalOpen` garantizan una sola petición simultánea, un solo modal, doble clic o doble toque controlado y reintento permitido después de cerrar el modal.

## 20. Versionado PWA final

- **MUNDIPOS_SW_VERSION:** `v3.7.0-cross-domain-closure`.
- **Revisión de style.css:** `v4.3.3-logout-blocked-ui`.
- **Revisión de main.js:** `v4.3.3-logout-blocked-ui`.

v4.3.3 no cambia toda la PWA a una versión v4 ni modifica la versión visible, package, lockfile o `STABILITY_TRACK`.

## 21. Fuera de alcance

No se modificaron backend, esquema, bases de datos, dependencias ni contratos de v4.3.1/v4.3.2. Tampoco se inició trabajo de v4.4 ni de fases posteriores.

## 22. Estado

**CERRADA TÉCNICAMENTE — PENDIENTE ÚNICAMENTE DE PUBLICACIÓN GIT.**

v4.3.3 está implementada, probada específicamente, sometida a regresiones dirigidas, corregida y revalidada tras la regresión PWA, validada manualmente en PC y móvil y aprobada por la suite completa definitiva.

No se asigna SHA funcional ni se marca como publicada. La fase v4.3 permanece **EN CURSO** hasta completar el commit funcional, push y consolidación documental post-publicación.
