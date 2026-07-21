# v4.1.2 · Recuperación de sesión SPA/PWA

## Qué se está haciendo

Se audita y estabiliza la recuperación de la sesión autenticada en la SPA/PWA. La identidad debe reconstruirse desde `/api/auth/verify` después de F5, reapertura, reinicio de Node/PWA y recuperación de conectividad, siempre que `pos.sid` y la sesión persistida sigan vigentes.

## Por qué se está haciendo

v4.1.1 permite recuperar una sesión no expirada desde `data/sessions.db`, pero la continuidad visible requiere que el frontend distinga entre sesión pendiente, sesión válida, pérdida temporal de comunicación y sesión definitivamente inexistente. Una caída de red no equivale a logout ni autoriza mostrar otro formulario de acceso.

## Archivos modificados

- `public/index.html`: estado inicial `VERIFYING`, credenciales ocultas/deshabilitadas y header de desconexión.
- `public/css/style.css`: presentación de verificación/reconexión, sustitución del header y bloqueo visual de acciones.
- `public/js/main.js`: modelo de estados, reintentos, conservación de vista y recuperación automática.
- `public/service-worker.js`: fallback al shell cacheado también ante navegaciones con respuesta 5xx.
- `tests/sessionRecoveryUi.test.js`: contratos A-G fortalecidos.
- `README.md`: evidencia inicial, bugs manuales, corrección y estado abierto.
- `docs/avance-v4.1.2-recuperacion-sesion-spa-pwa.md`: registro actualizado de fase.

## Archivos revisados sin modificar

- `public/js/services/operational-access.js`.
- `server/app.js`.
- `server/routes/auth.js`.
- `server/services/sqliteSessionStore.js`.
- `tests/persistentSessionStore.test.js`.
- `tests/realtimeRecovery.test.js`.
- `docs/roadmap-v4-sesiones-continuidad-operativa.md`.
- `docs/avance-v4.1.1-store-persistente-sesiones.md`.
- `docs/avance-v3.0.3-acceso-operativo-realtime.md`.
- `docs/avance-v3.1.4-continuidad-consumo.md`.
- `docs/avance-v3.5.1-realtime-recuperacion-operativa.md`.

## Qué no se modifica

No se implementan límites de sesiones, políticas de administradores/cuentas departamentales, heartbeat persistente, presencia definitiva, transferencia, revocación, bloqueo de logout, colas offline ni operaciones de negocio sin backend. No cambian backend, `restaurant.db`, `data/sessions.db`, cookie, TTL, login/logout, paquetes, versión visible, `APP_VERSION`, `STABILITY_TRACK` ni versión PWA.

## Contratos preservados

- `/api/auth/verify` es la autoridad para confirmar o rechazar la sesión.
- Solo `authenticated: false` conduce a `UNAUTHENTICATED` y habilita credenciales.
- Errores de red y 5xx conservan la sesión potencial y activan reintentos.
- `/api/*` permanece `network-only`; no se usan datos API cacheados como fuente de verdad.
- Realtime continúa como señal y las APIs persistidas reconstruyen la vista.
- No existe modo transaccional offline.

## Primera evidencia automática

Resultado confirmado por el usuario antes de la validación manual:

```text
194/194
0 fallos
```

La suite verde no cerró la fase porque no comprobaba los estados visuales intermedios ni la pérdida real de conectividad.

## Bugs encontrados durante la primera validación manual

1. Durante F5 aparecía brevemente el formulario de login antes de completar `verify`.
2. Durante una caída temporal seguían visibles Usuario, Contraseña e Iniciar sesión.
3. Un usuario ya autenticado podía perder su contexto visual y terminar frente al login.
4. El retorno de red/Node no garantizaba regreso automático a la aplicación.
5. El formulario permitía intentar otro login mientras la sesión anterior seguía potencialmente válida.
6. Un dispositivo previamente utilizado podía llegar a mostrar la página nativa “No se puede acceder a este sitio” si la navegación no obtenía shell.

## Causa raíz

### Flash del login

`public/index.html` entregaba `#login-screen` y `#login-form` visibles. JavaScript ejecutaba `PWA.init()`, esperaba branding y solo después iniciaba `Auth.checkSession()`. El navegador podía pintar credenciales antes de que `verify` respondiera.

### Login durante caída temporal

La recuperación reutilizaba visualmente la tarjeta de login. Aunque el código posterior intentaba cambiar de modo, el HTML inicial no ocultaba ni deshabilitaba los controles y no existía un estado de sesión declarativo desde el primer render.

### Pérdida de contexto y falta de retorno automático

Los reintentos estaban concentrados en el arranque de `checkSession()`. Los errores de otras APIs y `EventSource.onerror` no activaban un estado autenticado global. Al recuperarse, el flujo normal podía llamar `showApp()` y escoger de nuevo la sección inicial en vez de conservar la sección válida que el usuario estaba observando.

### Shell PWA

El service worker ya precacheaba `/POS/`, `/POS/index.html`, recursos JavaScript/CSS y `offline.html`; las excepciones de navegación ya consultaban ese caché. Sin embargo, una respuesta HTTP 5xx válida se devolvía directamente y no utilizaba `navigationFallback()`.

## Modelo implementado

### VERIFYING

Es el estado inicial del propio HTML. Solo muestra “Verificando sesión...”. El formulario está `hidden`, `aria-hidden` y sus campos/botón están `disabled` antes de ejecutar JavaScript.

### AUTHENTICATED_ONLINE

`verify` devolvió una sesión válida. Se reconstruyen `currentUser`, sesión operativa, capacidades, navegación, header y Realtime.

### AUTHENTICATED_RECONNECTING

El usuario ya estaba autenticado y falla una API, llega un 5xx recuperable o se cae Realtime. La sección actual permanece visible. El header operativo se oculta y aparece:

```text
Sin conexión al servidor
Esperando recuperación de la red…
```

Sidebar, contenido principal, subnavegación, overlay y modal quedan `inert`, con `aria-disabled` y sin eventos de puntero. No se ofrecen credenciales ni se permite operar contra datos locales.

### UNAUTHENTICATED

Solo se activa cuando bootstrap exige configuración o `/api/auth/verify` responde válidamente `authenticated: false`. Se cancelan reintentos, se limpia `currentUser` y se habilita el formulario.

## Reintentos y recuperación

- Esperas progresivas: 1.5, 3, 6, 12 y máximo 15 segundos.
- `online` adelanta el siguiente intento, pero no confirma disponibilidad.
- La prueba real sigue siendo `/api/auth/verify`.
- Al recuperar una sesión válida se restaura el header, se quita `inert`, se mantiene `currentSection` si continúa autorizada, se reconecta Realtime y se solicita recuperación de la vista desde APIs persistidas.
- Si la sección dejó de estar autorizada por el payload actualizado, se usa el destino inicial autorizado.

## Auditoría de POST /api/auth/login

`server/routes/auth.js` no llama `req.session.regenerate()`, no destruye una sesión previa antes de autenticar y escribe directamente los campos del usuario sobre `req.session`.

Consecuencias:

- en el mismo navegador, si llega una cookie válida, el login reutiliza el SID actual y reemplaza los datos de usuario dentro de esa misma sesión técnica; no crea una segunda fila para ese SID;
- si no llega una cookie/sesión recuperable, Express crea una sesión con otro SID y sí puede coexistir con la sesión del dispositivo anterior;
- el endpoint no aplica todavía límites de concurrencia ni verifica sesiones de otros dispositivos.

v4.1.2 elimina el camino visual accidental mientras la sesión previa está pendiente. La política formal de máximo de sesiones y protección concurrente permanece en v4.4.

## Auditoría y cambio del service worker

- Las navegaciones usan red y almacenan respuestas válidas en el runtime cache.
- Ante excepción consultan `/POS/`, luego `/POS/index.html` y después `offline.html`.
- Ahora una navegación con HTTP 5xx también usa el mismo fallback.
- `/api/*` continúa llamando únicamente a `networkOnly()` y devuelve JSON 503 si el backend no responde.
- Una PWA/dispositivo previamente cacheado puede abrir el shell y entrar en recuperación aunque Node esté temporalmente fuera.
- No es posible prometer shell en la primera visita absoluta de un dispositivo sin caché/control previo del service worker.

No fue necesario cambiar el identificador de versión PWA.

## Problemas corregidos

- Se eliminó el flash del login durante F5 y durante la verificación inicial.
- Las credenciales permanecen ocultas e inhabilitadas mientras el estado de autenticación no esté resuelto.
- Una caída temporal de red o del proceso Node ya no se interpreta como logout ni destruye el contexto visual autenticado.
- El header comunica claramente `Sin conexión al servidor` y `Esperando recuperación de la red…`.
- Las acciones operativas quedan inertes mientras no existe conexión verificable con el backend.
- La aplicación reintenta la verificación y también reacciona al evento `online`, sin exigir F5 ni nuevas credenciales.
- La recuperación conserva la sección actual cuando el usuario sigue autorizado y restablece Realtime y los datos persistentes.
- El shell PWA puede recuperarse desde caché ante navegación fallida o respuesta 5xx, mientras `/api/*` permanece estrictamente `network-only`.

## Solución final confirmada

- El arranque usa cuatro estados explícitos: `VERIFYING`, `AUTHENTICATED_ONLINE`, `AUTHENTICATED_RECONNECTING` y `UNAUTHENTICATED`.
- El login solo se muestra y habilita cuando `/api/auth/verify` responde de forma autoritativa con `authenticated: false`.
- Una sesión autenticada que pierde temporalmente el servidor pasa a reconexión, conserva la vista y bloquea operaciones hasta recuperar autoridad del backend.
- La recuperación automática restaura el header y la interacción, reconecta Realtime, recarga desde APIs persistidas y mantiene la sección actual si continúa autorizada.
- No se habilitan operaciones offline ni se cachean respuestas de API.

## Pruebas fortalecidas

`tests/sessionRecoveryUi.test.js` valida siete contratos:

- A: HTML inicia en VERIFYING, sin credenciales utilizables.
- B: sesión válida reconstruye usuario y muestra la aplicación.
- C: `authenticated: false` cancela recuperación, limpia usuario y muestra login.
- D: fallo temporal conserva login oculto y programa reintento.
- E: desconexión autenticada conserva vista, sustituye header y bloquea acciones.
- F: recuperación restaura header/interacción, sesión, Realtime y datos sin reiniciar una sección válida.
- G: APIs siguen network-only y el shell tiene fallback para navegación caída/5xx.

## Resultado real

- Pruebas específicas de v4.1.2: **7/7**, 0 fallos.
- Regresión v4.1.1 + Realtime: **5/5**, 0 fallos.
- Suite completa: **198/198**, 0 fallos, 0 canceladas, 0 omitidas y 0 pendientes.
- Validación manual: **APROBADA**.

La validación manual confirmó que F5 no muestra el login; la sesión persiste tras reiniciar Node; una pérdida de Wi-Fi o del servidor conserva la vista y muestra el estado de desconexión; las operaciones quedan bloqueadas; el retorno de Node o de la red recupera automáticamente la sesión, Realtime, los datos y la sección autorizada sin F5 ni credenciales; la PWA cacheada conserva el shell; y una sesión realmente inválida sí muestra el login.

La fase quedó validada técnica y manualmente y posteriormente fue publicada.

## Riesgo de concurrencia de sesiones

- El mismo navegador con una cookie válida reutiliza la sesión persistida.
- Si no existe una cookie recuperable, el login puede crear otro identificador de sesión para el mismo usuario.
- v4.1.2 no introduce límites formales de concurrencia ni revocación por usuario.
- Ese control pertenece al alcance diferido de v4.4.

## Riesgos diferidos

- v4.3.3: logout frontend que fuerza limpieza local si falla `/logout`.
- v4.4: límites de sesiones, concurrencia, administradores y cuentas departamentales.
- v4.5: presencia definitiva y heartbeat persistente.
- v4.6: transferencia y revocación remota.

## Estado

**Publicada.**

## Commit funcional/publicado de la subfase

`1830711fea951b3c5a43eb041e927c5073de1b14`
