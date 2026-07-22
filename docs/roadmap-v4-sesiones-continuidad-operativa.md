# ROADMAP MUNDIPOS v4 — SESIONES, CONTINUIDAD OPERATIVA Y RESPONSABILIDAD DE USUARIO

## 1. Propósito

Este roadmap define la implementación incremental del nuevo modelo de sesiones de MundiPOS dentro de la línea v4.

El objetivo es mejorar la continuidad operativa y el control de acceso sin romper el sistema de autenticación existente ni alterar los contratos financieros y operativos consolidados en MundiPOS 3.0.

La implementación debe resolver progresivamente:

- persistencia real de sesiones;
- continuidad después de refrescar, cerrar o reiniciar un dispositivo;
- continuidad después de reiniciar el servidor;
- bloqueo de cierre de sesión cuando un usuario conserva responsabilidades operativas;
- control del número máximo de dispositivos por usuario;
- tratamiento especial de administradores;
- identificación lógica del dispositivo mediante el cliente MundiPOS existente;
- detección razonable de presencia y desconexión;
- recuperación de sesión desde otro dispositivo mediante autorización administrativa;
- revocación segura de la sesión anterior;
- cierre efectivo de sesiones revocadas cuando el dispositivo anterior vuelva a conectarse;
- trazabilidad completa de inicios, cierres, reemplazos y revocaciones;
- integración posterior de estos datos en Reportería.

Este roadmap no autoriza refactors generales de autenticación ni cambios ajenos a los objetivos anteriores.

---

## 2. Regla general de versionado

La línea de trabajo utiliza como base MundiPOS v4.

Las fases principales se numeran:

- v4.1
- v4.2
- v4.3
- v4.4
- etc.

Cuando una fase necesite dividirse en trabajos independientes:

- v4.1.1
- v4.1.2
- v4.1.3

Cuando una fase cerrada presente una regresión o bug:

- v4.1-fix1
- v4.1-fix2

Cuando el bug pertenezca específicamente a una subfase:

- v4.1.1-fix1
- v4.1.1-fix2

Un fix nunca debe ocultarse dentro de la siguiente fase.

El bug debe repararse, probarse, documentarse y publicarse dentro de su propia línea `fix` antes de continuar.

Los identificadores v4.x de este roadmap representan fases técnicas de trabajo. Cualquier modificación de la versión visible, `package.json`, `APP_VERSION`, `STABILITY_TRACK` u otros identificadores globales de versión se realizará únicamente cuando la política canónica del proyecto y el cierre correspondiente lo indiquen expresamente.

---

## 3. Regla absoluta de avance

No se inicia una fase mientras la fase anterior no esté:

1. implementada;
2. probada específicamente;
3. sometida a las pruebas de regresión correspondientes;
4. validada operativamente cuando aplique;
5. documentada;
6. resumida en el `README.md` canónico;
7. staged mediante rutas explícitas;
8. incluida en un commit identificado;
9. publicada mediante push seguro;
10. confirmada con `main == origin/main`;
11. confirmada con working tree limpio.

Si durante una fase aparece un bug:

**SE DETIENE EL ROADMAP.**

Se crea el correspondiente:

`vX.Y-fixN`

o:

`vX.Y.Z-fixN`

No se continúa con la siguiente fase hasta que el fix quede cerrado y publicado.

---

## 4. Documentación obligatoria por fase

Cada fase, subfase y fix debe tener su propio documento dentro de `docs/`.

Formato recomendado:

`docs/avance-v4.1-<descripcion>.md`

`docs/avance-v4.1.1-<descripcion>.md`

`docs/avance-v4.1-fix1-<descripcion>.md`

Cada documento debe contener obligatoriamente:

### Qué se está haciendo

Descripción funcional exacta de la fase.

### Dónde se está haciendo

Archivos, servicios, rutas, tablas, componentes o dominios afectados.

### Por qué se está haciendo

Problema operativo o técnico que justifica el cambio.

### Qué no se debe modificar

Límites explícitos del alcance.

### Contratos que deben preservarse

Reglas heredadas de MundiPOS 3.0 y fases anteriores.

### Resultado esperado

Comportamiento verificable que debe existir al terminar.

### Pruebas previstas

Pruebas automáticas, consultas, auditorías y pruebas manuales necesarias.

### Resultado real

Debe completarse después de ejecutar las pruebas.

Nunca debe escribirse como aprobado antes de tener evidencia.

Debe incluir:

- pruebas ejecutadas;
- cantidad de pruebas aprobadas;
- fallos encontrados;
- bugs derivados;
- resultado de validación manual;
- resultado de auditorías aplicables.

### Estado

Uno de:

- En preparación.
- En implementación.
- Pendiente de pruebas.
- Pendiente de validación manual.
- Bloqueada por bug.
- Cerrada.
- Publicada.

### Commit de cierre

SHA exacto después de publicar la fase.

---

## 5. README canónico

Al cerrar cada fase debe agregarse un resumen al `README.md` canónico.

El resumen debe indicar como mínimo:

- versión/fase;
- objetivo;
- cambios realizados;
- resultado funcional;
- pruebas ejecutadas;
- bugs o fixes asociados;
- estado final;
- SHA publicado.

El README canónico refleja únicamente resultados confirmados.

No debe declarar cerrada una fase pendiente de validación.
## 5.1 Regla canónica de consolidación post-publicación

Antes de iniciar cualquier nueva subfase debe verificarse que el `README.md` canónico y el documento de avance de la subfase inmediatamente anterior reflejen su estado real de publicación y el SHA del commit funcional publicado.

Ninguna nueva subfase puede comenzar mientras la anterior permanezca documentalmente marcada como “pendiente de publicación Git” si el commit ya fue publicado y se confirmó `main == origin/main`.

El procedimiento distingue dos estados:

### Cierre técnico previo al commit

```text
Cerrada técnicamente — pendiente de publicación Git
```

Este estado solo corresponde al intervalo posterior a la validación y anterior al commit/push.

### Consolidación posterior al push

```text
Publicada
Commit funcional/publicado de la subfase: <SHA>
```

El SHA registrado identifica el commit funcional de la subfase. Una corrección documental post-publicación puede pertenecer a otro commit y no debe sustituirlo ni presentarse como el commit funcional original.

---

# v4.1 — Persistencia técnica de sesiones

## Objetivo

Eliminar la dependencia de MemoryStore como única fuente de las sesiones HTTP y conseguir que una sesión autenticada pueda sobrevivir correctamente a reinicios normales del entorno.

Esta fase no introduce todavía límites de dispositivos, transferencia administrativa ni bloqueo por responsabilidades.

Su único objetivo es estabilizar la persistencia base.
## Estado consolidado

**COMPLETADA Y PUBLICADA.**

Subfases publicadas:

- v4.1.1 → `a8525e0f8110935b2cad20326313c9c73745b677`.
- v4.1.2 → `1830711fea951b3c5a43eb041e927c5073de1b14`.

---

## v4.1.1 — Store persistente de express-session

### Qué

Incorporar un store persistente compatible con `express-session`.

### Dónde

Principalmente:

- `server/app.js`;
- configuración del nuevo store;
- archivo de persistencia local correspondiente;
- `.gitignore`, únicamente si fuera necesario proteger el nuevo archivo local.

### Por qué

Actualmente MemoryStore pierde todas las sesiones cuando Node reinicia.

La cookie puede sobrevivir, pero el servidor deja de reconocerla.

### Criterios

El store debe:

- ser persistente;
- ser local;
- no formar parte de Git;
- no formar parte de ZIP de actualización;
- no mezclarse innecesariamente con los datos financieros;
- conservar compatibilidad con `req.session`;
- permitir destrucción/revocación posterior.

### Resultado esperado

Una sesión iniciada correctamente continúa siendo válida después de reiniciar el proceso Node, mientras no haya expirado o sido revocada.

### Pruebas mínimas

- login normal;
- logout normal;
- F5;
- cerrar/reabrir navegador;
- reiniciar dispositivo simulado cuando sea posible;
- reiniciar servidor;
- expiración;
- sesión inválida;
- suite de autenticación existente.

---

## v4.1.2 — Recuperación de sesión SPA/PWA

### Qué

Validar y, solo si es necesario, ajustar la recuperación de sesión existente mediante `/api/auth/verify`.

### Por qué

La persistencia del backend no es suficiente si la SPA no reconstruye correctamente `currentUser`.

### Resultado esperado

Después de una recarga o reinicio:

- la aplicación consulta la sesión;
- recupera el usuario válido;
- restaura correctamente su contexto;
- no muestra login si la sesión sigue autorizada.

### Pruebas mínimas

PC y móvil/PWA:

- F5;
- cierre y reapertura;
- reinicio servidor;
- cookie expirada;
- sesión inexistente.

### Cierre de v4.1

Solo se cierra cuando la persistencia técnica funciona sin introducir cambios todavía en la política de sesiones concurrentes.

Estado actual: **v4.1 está COMPLETADA Y PUBLICADA** mediante los commits funcionales de v4.1.1 y v4.1.2 registrados arriba.

---

# v4.2 — Registro persistente y ciclo de vida de sesiones

## Objetivo

Crear una representación estructurada de las sesiones de usuario para control operativo y auditoría.

La sesión de Express seguirá autenticando peticiones.

El nuevo registro permitirá conocer y controlar el ciclo de vida de cada sesión.

## Estado consolidado

**COMPLETADA Y PUBLICADA.**

Subfases publicadas:

- v4.2.1 → `16822fb0be1fa2938737fb59f8d73982bc9f3e4a`.
- v4.2.2 → `832be2673d540cd34b2701a0d00cf699c4120936`.

---

## v4.2.1 — Modelo `sesiones_usuario`
### Estado consolidado

**PUBLICADA.**

Commit funcional/publicado de la subfase: `16822fb0be1fa2938737fb59f8d73982bc9f3e4a`.

### Qué

Crear la estructura persistente necesaria para registrar sesiones.

### Información mínima prevista

- identificador interno de sesión;
- usuario;
- cliente MundiPOS;
- estado;
- fecha de inicio;
- última actividad;
- fecha de finalización;
- motivo de finalización;
- metadatos no sensibles necesarios para auditoría.

### Regla

No exponer el SID real de Express al frontend.

Debe utilizarse un identificador interno independiente.

### Estados conceptuales

- activa;
- cerrada;
- revocada;
- reemplazada;
- expirada.

### Pruebas

- migración sobre base existente;
- migración idempotente;
- integridad SQLite;
- foreign keys;
- creación correcta de sesión registrada.

---

## v4.2.2 — Ciclo login/logout/expiración

### Estado consolidado

**PUBLICADA.**

Commit funcional/publicado de la subfase: `832be2673d540cd34b2701a0d00cf699c4120936`.

### Qué

Integrar el registro con:

- login exitoso;
- logout normal;
- expiración;
- revocaciones futuras.

### Resultado esperado

Cada sesión puede reconstruirse históricamente desde su inicio hasta su terminación.

### Regla

Esta fase todavía no limita cuántos dispositivos puede utilizar un usuario.

---

# v4.3 — Responsabilidad operativa y bloqueo de logout

## Estado actual

**NO INICIADA.**

Subfases pendientes:

- v4.3.1 → **NO INICIADA**.
- v4.3.2 → **NO INICIADA**.
- v4.3.3 → **NO INICIADA**.

## Objetivo

Impedir que un usuario abandone voluntariamente MundiPOS mientras conserve responsabilidades operativas activas.

---

## v4.3.1 — Servicio canónico de responsabilidades activas

### Qué

Crear una única lógica de dominio capaz de responder:

> ¿Este usuario conserva actualmente alguna responsabilidad operativa que le impida cerrar sesión?

### Fuente principal

`mesa_responsables`.

Debe utilizar los contratos modernos de MundiPOS 3.0.

Debe considerar correctamente:

- estado de la mesa;
- cuenta global;
- estado operativo;
- saldo pendiente cuando corresponda;
- finalización explícita del servicio.

### Regla

No utilizar `cuenta_responsables` como responsabilidad actual porque representa snapshots históricos.

### Resultado esperado

Un servicio reutilizable devuelve de forma consistente las responsabilidades activas del usuario.

---

## v4.3.2 — Bloqueo backend de logout

### Qué

Antes de destruir una sesión:

1. comprobar responsabilidades;
2. si existen, rechazar el logout;
3. devolver código y mensaje estables;
4. conservar completamente la sesión.

### Resultado esperado

Juan no puede cerrar sesión mientras:

- tenga una mesa ocupada bajo su responsabilidad;
- mantenga una responsabilidad operativa todavía activa;
- exista una cuenta/servicio que contractualmente impida abandonar la operación.

Pagar una cuenta no debe equivaler automáticamente a poder cerrar sesión si el servicio continúa activo.

---

## v4.3.3 — Corrección del logout frontend

### Qué

Eliminar el comportamiento por el cual un error de `/logout` provoca un logout local forzado.

### Resultado esperado

Solo un logout confirmado por el backend limpia la sesión local.

Si ocurre:

- bloqueo por responsabilidad;
- error de red;
- error de servidor;

la aplicación mantiene al usuario autenticado y muestra el motivo correspondiente.

### Pruebas críticas

- logout sin responsabilidad;
- logout con mesa activa;
- logout con saldo;
- cuenta pagada pero servicio todavía activo;
- servicio finalizado;
- pérdida de red durante logout.

---

# v4.4 — Política de sesiones concurrentes

## Objetivo

Definir y aplicar cuántos dispositivos simultáneos puede utilizar cada tipo de usuario.

---

## v4.4.1 — Usuarios humanos normales

### Política

Máximo:

**1 sesión activa autorizada.**

### Resultado esperado

Si existe otra sesión activa:

- el segundo login no crea una sesión adicional;
- devuelve un código estable;
- informa que existe otra sesión.

Todavía no se realizará transferencia automática.

### Protección adicional

Debe probarse login concurrente para evitar que dos solicitudes simultáneas creen dos sesiones.

---

## v4.4.2 — Usuarios administradores

### Política

Máximo:

**2 sesiones activas autorizadas.**

Casos válidos:

- PC + dispositivo móvil;
- dos clientes distintos autorizados.

Un tercer cliente debe ser rechazado hasta liberar o reemplazar una sesión existente.

### Pruebas

- primera sesión;
- segunda sesión;
- tercer intento;
- logout de una;
- nuevo ingreso.

---

## v4.4.3 — Política de cuentas departamentales

### Decisión contractual requerida

Las cuentas departamentales, como Cocina, no deben asumir automáticamente la misma política que los usuarios humanos.

La recomendación inicial es:

- `humana` normal: máximo 1;
- `humana` Admin: máximo 2;
- `departamental`: política independiente.

Antes de implementar esta subfase debe quedar documentada la decisión canónica sobre cuentas departamentales.

No se continúa a v4.5 sin cerrar esta decisión.

---

# v4.5 — Presencia y estado de dispositivos

## Objetivo

Distinguir una sesión autorizada de un dispositivo realmente conectado.

---

## v4.5.1 — Registro de cliente y última actividad

### Qué

Reutilizar:

`X-MundiPOS-Client`

como identificador lógico del cliente.

Registrar de forma segura:

- cliente;
- última actividad;
- versión del cliente si corresponde;
- metadatos mínimos útiles.

### Regla

No implementar fingerprinting invasivo del hardware.

---

## v4.5.2 — Estado online/transitorio/offline

### Qué

Combinar:

- conexión realtime;
- última actividad autenticada;
- periodo de gracia.

### Estados

- ONLINE;
- TRANSITORIO;
- OFFLINE.

### Regla

Una interrupción breve de Wi-Fi no debe convertir inmediatamente una sesión en transferible.

### Pruebas

- conexión normal;
- desconexión SSE;
- reconexión rápida;
- dispositivo apagado;
- periodo de gracia;
- recuperación de red.

---

# v4.6 — Transferencia administrativa y revocación

## Objetivo

Permitir continuar trabajando desde otro dispositivo cuando el dispositivo original quedó realmente desconectado.

---

## v4.6.1 — Revocación persistente

### Qué

Permitir marcar una sesión como:

- revocada;
- reemplazada.

Toda petición posterior de esa sesión debe ser rechazada.

### Resultado esperado

Una cookie antigua no basta para recuperar acceso después de una revocación.

---

## v4.6.2 — Transferencia administrativa de sesión

### Flujo esperado

1. Usuario intenta entrar desde dispositivo B.
2. Existe sesión en dispositivo A.
3. A está ONLINE:
   - transferencia rechazada.
4. A está OFFLINE:
   - se solicita autorización Admin.
5. Admin valida su identidad.
6. Sesión A se marca reemplazada/revocada.
7. Se crea o autoriza sesión B.
8. Las responsabilidades del usuario permanecen intactas.

### Regla crítica

La transferencia afecta sesiones.

Nunca debe modificar:

- mesas;
- `mesa_responsables`;
- cuentas;
- cuenta global;
- prefacturas;
- pagos;
- créditos;
- comandas.

---

## v4.6.3 — Invalidación del dispositivo anterior

### Qué

Integrar revocación con:

- `/auth/verify`;
- peticiones protegidas;
- realtime.

### Resultado esperado

Cuando el dispositivo A vuelva a encender o recuperar red:

- detecta la sesión revocada;
- abandona el contexto autenticado;
- vuelve al login;
- no puede continuar operando.

Si existe conexión realtime activa, debe recibir la invalidación correspondiente cuando sea técnicamente posible.

---

# v4.7 — Administración de sesiones

## Objetivo

Dar al administrador visibilidad y control sobre sesiones autorizadas sin exponer información sensible.

### Funciones

Según la UI aprobada:

- consultar sesiones activas;
- ver usuario;
- identificar cliente/dispositivo;
- conocer estado online/offline;
- conocer fecha de inicio;
- revocar cuando corresponda;
- visualizar las dos sesiones permitidas de un administrador.

### Seguridad

Nunca mostrar:

- SID real;
- cookie;
- secreto;
- token reutilizable.

### Pruebas

- permisos;
- usuario no Admin;
- revocación;
- sesión inexistente;
- revocación concurrente;
- sesión propia del Admin.

---

# v4.8 — Historial y Reportería de sesiones

## Objetivo

Incorporar el ciclo de vida de sesiones a Reportería.

---

## v4.8.1 — Consultas estructuradas

### Datos previstos

- usuario;
- inicio;
- finalización;
- duración;
- cliente;
- estado final;
- cierre normal;
- expiración;
- revocación;
- reemplazo;
- administrador autorizante cuando aplique.

### Resultado esperado

La información no depende de interpretar textos libres de `historial_transacciones`.

---

## v4.8.2 — Integración visual con Reportería

### Qué

Agregar la consulta dentro de la estructura de reportes existente, respetando permisos.

### Pruebas

- filtros;
- rangos de fecha;
- usuarios;
- tipos de cierre;
- transferencia;
- revocación;
- permisos.

---

# v4.9 — Endurecimiento y pruebas cruzadas

## Objetivo

Probar el sistema completo como una unidad antes de declarar cerrado el nuevo contrato de sesiones.

---

## v4.9.1 — Concurrencia

Casos obligatorios:

- dos logins simultáneos de usuario normal;
- tres logins simultáneos de Admin;
- login durante revocación;
- transferencia concurrente;
- logout durante transferencia.

---

## v4.9.2 — Fallos y recuperación

Casos:

- caída de Wi-Fi;
- reinicio del navegador;
- apagado del dispositivo;
- reinicio de Node;
- recuperación del servidor;
- cookie vieja;
- sesión revocada;
- PWA obsoleta;
- realtime reconectando.

---

## v4.9.3 — Cruce con contratos MundiPOS 3.0

Confirmar que no se alteró:

- cuenta global;
- prefacturas;
- Payments;
- créditos;
- división documental;
- finalización explícita;
- Kitchen;
- Printing;
- Dashboard financiero;
- Realtime como señal;
- responsabilidades históricas;
- snapshots.

---

# v4.10 — Cierre contractual del nuevo modelo de sesiones

## Objetivo

Realizar la validación final y consolidar el nuevo contrato.

### Validaciones

- suite específica completa;
- suite global;
- auditoría SQLite;
- `PRAGMA integrity_check`;
- `PRAGMA foreign_key_check`;
- validación manual PC;
- validación manual móvil/PWA;
- prueba real de transferencia;
- prueba real de revocación;
- prueba de persistencia después de reinicio;
- prueba de bloqueo de logout;
- prueba Admin con dos dispositivos.

### Documentación

Actualizar:

- documento de cierre v4.10;
- roadmap;
- contratos correspondientes;
- README canónico.

### Resultado esperado

Un contrato documentado donde:

- las sesiones sobreviven a reinicios autorizados;
- los usuarios no abandonan responsabilidades activas;
- los usuarios normales tienen máximo una sesión;
- los Admin tienen máximo dos;
- las cuentas departamentales respetan su política definida;
- los dispositivos offline pueden ser reemplazados mediante autorización;
- las sesiones antiguas quedan efectivamente revocadas;
- existe historial estructurado;
- Reportería puede consultar el ciclo de vida de las sesiones.

Solo después de esta validación podrá declararse cerrado este bloque de trabajo dentro de MundiPOS v4.

---

## 6. Flujo Git obligatorio por fase/subfase/fix

Cada unidad de trabajo cerrada seguirá:

1. Confirmar rama `main`.
2. Confirmar working tree limpio antes de iniciar.
3. `fetch origin main`.
4. Confirmar `main == origin/main`.
5. Confirmar SHA base exacto.
6. Aplicar únicamente los archivos de la fase.
7. No hacer staging durante implementación.
8. Ejecutar pruebas específicas.
9. Corregir bugs encontrados.
10. Si existe regresión significativa, crear línea `fix`.
11. Ejecutar pruebas afectadas nuevamente.
12. Ejecutar suite completa cuando corresponda.
13. Ejecutar auditoría SQLite cuando corresponda.
14. Realizar validación manual.
15. Completar el README propio de la fase con resultados reales.
16. Actualizar el resumen de la fase en `README.md` canónico.
17. Ejecutar `git diff --check`.
18. Revisar lista exacta de archivos modificados.
19. Confirmar protección de `data/restaurant.db`.
20. Realizar staging mediante rutas explícitas.
21. Verificar contenido exacto de staging.
22. Crear commit.
23. Confirmar working tree limpio.
24. `fetch origin main`.
25. Confirmar divergencia esperada.
26. Push sin `--force`.
27. Nuevo `fetch`.
28. Confirmar `main == origin/main`.
29. Confirmar working tree limpio.
30. Registrar SHA final en documentación.
31. Consolidar el documento de avance y el README.md como Publicada, con el commit funcional/publicado, antes de iniciar la siguiente subfase.

Nunca utilizar:

- `git add .`
- `git add -A`
- `git reset --hard`
- `git clean`
- force push

salvo autorización excepcional y explícita.

---

## 7. Regla de bugs y fixes

Ejemplo:

Se cierra:

`v4.3.2`

Durante la validación operativa aparece un bug.

No se inicia:

`v4.3.3`

Se crea:

`v4.3.2-fix1`

El fix debe:

- tener documento propio;
- describir la regresión;
- identificar la causa raíz;
- limitar el alcance;
- incluir prueba de reproducción;
- incluir prueba del arreglo;
- repetir las pruebas afectadas;
- ejecutar regresión necesaria;
- actualizar README canónico;
- hacer staging;
- commit;
- push;
- confirmar repositorio limpio.

Solo entonces continúa:

`v4.3.3`

---

## 8. Principio rector del roadmap

Cada fase debe dejar el sistema en un estado:

**estable + comprobable + documentado + reversible mediante Git + publicado**

Nunca se utilizará una fase posterior para terminar una fase anterior.

Nunca se aceptará como cierre:

- “debería funcionar”;
- “el código parece correcto”;
- “el ZIP está preparado”;
- “Codex dice que pasó”.

El cierre requiere evidencia real de pruebas y, cuando el comportamiento sea operativo o visual, validación manual del usuario.

---

## 9. Secuencia resumida

`v4.1`
Persistencia técnica de sesiones — **COMPLETADA Y PUBLICADA**.

↓

`v4.2`
Registro persistente del ciclo de vida — **COMPLETADA Y PUBLICADA** mediante v4.2.1 (`16822fb0be1fa2938737fb59f8d73982bc9f3e4a`) y v4.2.2 (`832be2673d540cd34b2701a0d00cf699c4120936`).

↓

`v4.3`
Responsabilidad activa y bloqueo de logout — **NO INICIADA**.

↓

`v4.4`
Límites de dispositivos y política de cuentas.

↓

`v4.5`
Presencia online/offline.

↓

`v4.6`
Transferencia administrativa y revocación.

↓

`v4.7`
Administración de sesiones.

↓

`v4.8`
Historial y Reportería.

↓

`v4.9`
Concurrencia, fallos y pruebas cruzadas.

↓

`v4.10`
Validación y cierre contractual.
