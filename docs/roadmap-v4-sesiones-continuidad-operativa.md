# ROADMAP MUNDIPOS v4 — SESIONES, CONTINUIDAD OPERATIVA Y RESPONSABILIDAD DE USUARIO

## 1. Propósito

Este roadmap define la implementación incremental del nuevo modelo de sesiones de MundiPOS dentro de la línea v4.

El objetivo es mejorar la continuidad operativa y el control de acceso sin romper el sistema de autenticación existente ni alterar los contratos financieros y operativos consolidados en MundiPOS 3.0.

La implementación debe resolver progresivamente:

- persistencia real de sesiones;
- continuidad después de refrescar, cerrar o reiniciar un dispositivo;
- continuidad después de reiniciar el servidor;
- bloqueo de cierre de sesión cuando un usuario conserva responsabilidades operativas;
- límites de sesiones y ocupaciones por usuario/contexto según su política;
- tratamiento especial de administradores;
- identidad lógica acreditada de Terminal, conservando clientId para correlación;
- detección razonable de presencia y desconexión;
- continuidad del mismo usuario mediante takeover en las políticas autorizadas y recuperación administrativa específica pendiente para Cocina/Cajero;
- revocación segura de la sesión anterior;
- cierre efectivo de sesiones revocadas cuando el dispositivo anterior vuelva a conectarse;
- trazabilidad completa de inicios, cierres, reemplazos y revocaciones;
- integración posterior de estos datos en Reportería.

Este roadmap no autoriza refactors generales de autenticación ni cambios ajenos a los objetivos anteriores.

**Revisión contractual del 22 de octubre de 2026:** las secciones 5.2–5.4 contienen el contrato vigente y las dependencias futuras revisadas, incluida la ampliación de identidad de instalación/servidor y migración. Definición documental aprobada no significa implementación ni validación completa. v4.1–v4.3 conservan su cierre histórico; el control de concurrencia y Session Takeover posterior está integrado de forma incompleta.

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

## 5.2 Contrato revisado de Terminal, concurrencia y continuidad

### 5.2.1 Alcance, evidencia histórica y sustituciones

Esta revisión consolida decisiones posteriores a la arqueología y al análisis de diseño; no afirma que fueran parte del contrato original. Es la referencia para revisar futuras modificaciones. No fija nombres nuevos de tablas, columnas, clases, servicios, APIs, cookies ni estados de implementación.

| Documento o etapa | Naturaleza y alcance que se preservan |
|---|---|
| Avances publicados v4.1.1–v4.1.2 | Persistencia técnica y recuperación SPA/PWA; sin política de exclusividad por usuario. |
| Avances publicados v4.2.1–v4.2.2 | UserSession, historia, lifecycle y reconciliación por SID; todavía sin límites por usuario. |
| Avances publicados v4.3.1–v4.3.3 | Responsabilidades persistidas y bloqueo de logout backend/frontend; cierre de v4.3 preservado. |
| Avance v4.3.2-fix1 | Registro técnico posterior; su validación manual/publicación documentadas como pendientes no se declaran resueltas aquí. Git contiene el commit 2928828; eso no acredita por sí solo esos pasos. |
| README.md | Resumen canónico de estado; sus entradas de fases anteriores describen su momento histórico. |
| Este roadmap | Contrato y planificación futuros; sus fases revisadas no se declaran completadas. |

Los commits 8092c8a (20 de octubre, «Multiples dispositivos incompleto») y 6a9dcc8 (22 de octubre, «Cierre y autorizacion de inicio de sesion en multiples dispositivos») introdujeron control entre dispositivos y takeover sin completar el contrato aquí exigido. Sus títulos no prueban cierre funcional ni validación completa.

Se sustituyen explícitamente estas previsiones del roadmap original:

- **v4.4.1:** el bloqueo sin transferencia era una etapa prevista. Ahora Salonero/Mesero y Bartender sujetos a continuidad pueden usar takeover, conservando el límite de una sesión externa operativamente válida.
- **v4.4.2:** dos clientes Admin cualesquiera ya no son una combinación válida. La excepción es una sesión en consola acreditada del servidor más una externa.
- **v4.4.3:** se concreta Cocina y se separa Cajero de la clase departamental; no se deduce la política de otros roles solo por su nombre o clase de cuenta.
- **v4.6.2:** se preveía rechazar transferencia con A ONLINE y solicitar autorización Admin con A OFFLINE. Para transferencia del MISMO usuario en políticas con takeover, se adopta negociación con A y autorización manual o por timeout, sin autorización Admin adicional.

La revisión de v4.6.2 se justifica porque B presenta credenciales válidas del mismo usuario, A puede rechazar dentro del plazo y el backend debe revocar efectivamente A antes de habilitar B. Se permite continuidad sin respuesta del equipo anterior, sin renunciar a exclusividad. Esto no aprueba recuperación implícita por takeover para Cocina/Cajero.

Los avances cerrados no se reescriben. El texto de planificación original v4.4–v4.6 se conserva más abajo como histórico sustituido, no como instrucciones vigentes contradictorias.

### 5.2.2 Dimensiones independientes e invariante

| Dimensión existente | Significado |
|---|---|
| Tipo/nivel: administrador o basico | Privilegios generales; Admin no es un rol operativo. |
| Rol operativo | Salonero/Mesero, Bartender, Cajero, Cocina u otros configurables; Cajero no es un tipo de usuario. |
| Clase: humana o departamental | Naturaleza de la cuenta; Cocina no es sinónimo genérico de cuenta departamental. |
| Roles disponibles | Asignaciones al usuario; no equivalen a los roles actualmente ejercidos. |
| Roles/contexto activos | Selección propia de cada sesión Express; distintas sesiones pueden tener contextos diferentes. |
| Capacidades | Permisos de acciones; cash.collect por sí sola no demuestra ejercicio de Cajero. |

**Principio contractual:** una cuenta o contexto operativo nunca debe superar el número de sesiones u ocupaciones operativamente válidas permitido por su política de concurrencia. Una sesión revocada o reemplazada no debe conservar capacidad operativa.

No existe una fórmula universal basada únicamente en `activeSessions >= maxSessions`. La decisión considera tipo Admin/Básico, rol/contexto activo, clase cuando corresponda, Terminal acreditada, autorizaciones de Terminal y sesiones/ocupaciones existentes. Takeover es una capacidad de determinadas políticas, no la respuesta universal a un conflicto.

### 5.2.3 Terminal y acreditación

Terminal representa una identidad lógica acreditada de navegador/perfil reconocida por MundiPOS; no una demostración absoluta del hardware físico. Usuario, sesión técnica, Terminal, equipo físico, estación operativa y clientId son conceptos distintos.

Debe contar conceptualmente con identidad persistente, registro backend, estado, acreditación verificable, credencial revocable, autorizaciones especiales concedidas por backend, asociación a sesiones y trazabilidad administrativa. Su identidad pública no constituye prueba suficiente.

La credencial es persistente, revocable, independiente de pos.sid y emitida/controlada por backend. El backend conserva un verificador adecuado sin necesitar secreto reutilizable en texto claro. El navegador conserva la prueba local mediante un mecanismo seguro. No se transportan secretos por URL ni se recomienda localStorage para la credencial secreta. El mecanismo y los nombres definitivos siguen pendientes.

No acreditan Terminal por sí solos: clientId, IP, loopback, localhost, hostname, serverInstanceId ni un nombre enviado libremente por frontend. La acreditación debe sobrevivir a reinicios normales sin depender de la identidad efímera del proceso Node.

### 5.2.4 Consola acreditada del servidor

Para esta política, «dispositivo servidor» significa **consola lógica acreditada del servidor**. No demuestra criptográficamente de forma permanente que el navegador siga en el mismo hardware de Node.

Cada instalación tiene como máximo UNA Terminal con esa condición especial. El backend la concede/controla; persiste a reinicios normales, puede revocarse y sustituirse mediante procedimiento controlado. El frontend no puede autodeclararla.

Al cambiar navegador/perfil debe acreditarse la nueva consola y la anterior debe perder la condición especial mediante sustitución/revocación controlada; su historia puede conservarse. Chrome, Edge, PWA y perfiles distintos no se agrupan automáticamente en una Terminal. Consola servidor no implica automáticamente autorización como estación Caja.

### 5.2.5 Políticas de sesiones y ocupaciones

**Admin:** un mismo usuario administrador tiene máximo una sesión externa simultánea. Una sesión asociada a la consola acreditada del servidor es una excepción adicional protegida: máximo conceptual **1 consola + 1 externa**. No se permiten dos externas ni consola + dos externas.

| Situación Admin | Resultado contractual |
|---|---|
| Solo consola; llega externo | Permitir externo sin takeover de consola. |
| Consola + externo A; llega externo B | Conservar consola; conflicto/takeover exclusivamente sobre externo A si el contexto permite takeover. |
| Solo externo A; llega externo B | No coexistencia operativa; takeover sobre A solo si el contexto lo permite. |
| Externo A + externo B | La excepción Admin nunca autoriza ambas sesiones externas. |

La sesión Admin de consola nunca es objetivo de takeover, nunca se selecciona como externa a reemplazar y no se pierde automáticamente para satisfacer otro ingreso.

**Salonero/Mesero y Bartender:** en políticas móviles sujetas a continuidad, máximo una sesión externa operativamente válida del usuario; takeover permitido y sin autorización Admin adicional. El usuario puede ser Admin o Básico. Admin conserva su excepción de consola, no un permiso para dos externas.

**Cocina:** máximo una sesión operativamente válida, sin takeover y sin combinación con Admin. Se conserva la cuenta departamental Cocina existente. Cuenta departamental Cocina, rol Cocina y capacidad kitchen.operate no son equivalentes. La prohibición global Cocina + Admin está incompletamente impuesta por backend y queda como deuda; no se corrige documentalmente ni se declara implementada. La recuperación administrativa de una sesión Cocina inutilizable permanece PENDIENTE, sin usar takeover implícito.

La exclusión de takeover es una decisión de política para Cocina: la negociación de continuidad móvil no sustituye la recuperación administrativa pendiente de su sesión exclusiva.

**Cajero:** es rol/contexto operativo y puede corresponder a Admin o Básico. La operación requiere Terminal autorizada como estación Caja. Máximo una ocupación Caja vigente del mismo usuario, sin takeover para resolver conflicto de Caja. Otra operación simultánea de cajero exige otro usuario y otra ocupación válida; no se liga permanentemente una persona a una PC. La autorización de estación permanece aunque cambie su ocupante.

El conflicto de Caja implica exclusividad de ocupación del usuario y de la estación; una transferencia de sesión no puede eludir esas restricciones. Su recuperación administrativa permanece PENDIENTE, separada del takeover móvil.

**Ocupación Caja:** una Terminal Caja tiene máximo un ocupante operativo vigente; un usuario tiene máximo una ocupación Caja vigente; Admin no evade ninguno de los límites. El ejercicio comienza al activar conceptualmente el CONTEXTO OPERATIVO Cajero, no por tener el rol disponible, cash.collect, privilegio Admin o navegar visualmente a Caja. Selección inicial automática y cambio posterior de contexto pasan por la misma política. No se introducen turnos financieros, arqueos ni apertura/cierre de caja.

**Admin + Cajero:** consola con contexto no-Cajero + sesión externa del mismo Admin ejerciendo Cajero en Terminal Caja es conceptualmente válido. Solo una de sus sesiones puede ejercer Cajero. Caja A + Caja B con el mismo Admin ejerciendo Cajero no es válido. El límite de ocupación no se convierte en una prohibición general de conservar la sesión no-Cajero protegida; la condición consola tampoco multiplica el cupo de Caja.

### 5.2.6 Session Takeover, deadline y revocación efectiva

A conserva una sesión operativa vigente. B presenta credenciales válidas del mismo usuario desde otra Terminal. El backend crea una negociación identificable y correlacionada, con identidad única equivalente a takeoverId. B espera sin obtener capacidad operativa. Toda decisión debe corresponder a la negociación vigente y al destinatario autorizado; decisiones tardías o de negociaciones anteriores no modifican la actual.

Si A rechaza válidamente dentro del plazo, conserva capacidad operativa, B no la obtiene y la negociación termina rechazada.

Aceptar significa **transferencia autorizada**, no que B ya pueda entrar. El servidor debe: (1) iniciar revocación/finalización de A; (2) retirar efectivamente su capacidad operativa; (3) finalizar y hacer coherente su lifecycle; (4) confirmar la revocación; (5) solo entonces habilitar/completar B. Si falla la revocación efectiva, B no obtiene capacidad concurrente y la transferencia termina o permanece en fallo recuperable.

El timeout resuelve falta de respuesta por dispositivo apagado, conectividad perdida, navegador suspendido, equipo abandonado o ausencia del operador. Autoriza automáticamente el MISMO procedimiento autoritativo; no equivale a login aceptado ni a habilitación automática de B.

**Flujo común:** aceptación manual o timeout → transferencia autorizada → revocación efectiva de A → confirmación → habilitación de B. Ante fallo: transferencia fallida/bloqueada y B sin capacidad operativa.

El backend es autoridad del deadline. El countdown frontend solo lo representa; cerrar, suspender o perder el navegador A no detiene el timer del servidor. La duración definitiva es PENDIENTE: los 10 segundos del código actual no son un valor contractual aprobado.

| Estado conceptual, no nombre obligatorio | Significado |
|---|---|
| pending | Negociación vigente a la espera de decisión/deadline. |
| rejected | Rechazo válido; A permanece y B no se habilita. |
| transfer_authorized | Autorización manual o por timeout; todavía sin habilitar B. |
| revoking | Retirada efectiva de capacidad y coherencia de lifecycle de A. |
| completed | Revocación confirmada y B habilitado conforme a política. |
| failed | No se completó la transferencia; B no recibe capacidad concurrente. |

El mecanismo técnico para impedir carreras con operaciones de A ya admitidas permanece PENDIENTE. El requisito de exclusividad sí está aprobado: una Promise resuelta, una fila histórica modificada o un evento realtime no bastan para demostrar revocación efectiva.

### 5.2.7 Continuidad y separación de responsabilidades

Takeover no transfiere SID, cookie pos.sid, identidad técnica ni session_uuid de A. A finaliza/revoca su sesión y B obtiene su propia sesión técnica e histórica. Permanece la continuidad del trabajo persistido del usuario: mesas, cuentas, asignaciones y responsabilidades. No modifica ni libera automáticamente mesa_responsables, cuenta global, prefacturas, pagos, créditos o comandas.

Takeover no equivale a logout voluntario. Se preservan el bloqueo de logout y las reglas de responsabilidad de v4.3: transferir acceso no finaliza el servicio ni libera trabajo operativo.

| Componente | Contrato vigente |
|---|---|
| Express Session / SID | Autenticación técnica y contexto recuperable. |
| Terminal | Identidad/acreditación del puesto y condiciones especiales de procedencia. |
| UserSession / sesiones_usuario / session_uuid | Lifecycle, historia y auditoría; una fila histórica nunca es una credencial ni concede acceso por sí sola. |
| clientId | Correlación lógica, realtime, destino de eventos y coordinación frontend; no prueba Terminal, consola o Caja ni es credencial de seguridad. |

La asociación con Terminal debe estar disponible en sesión técnica para operación y en lifecycle/historia para auditoría. Las autorizaciones vigentes de Terminal se comprueban desde su autoridad correspondiente; no quedan congeladas indefinidamente en Express. No se convierte UserSession en autoridad general de autenticación.

Realtime debe vincularse a sesión/Terminal validadas por backend; un clientId declarado no puede apropiarse de privilegios. ONLINE, TRANSITORIO y OFFLINE siguen siendo útiles para presencia, UX, recuperación y diagnóstico. Ausencia de SSE no demuestra revocación ni concede capacidad a B: falta de respuesta → deadline backend → autorización de transferencia → revocación formal → habilitación.

### 5.2.8 Legado, revocación de Terminal y seguridad proporcional

Una sesión heredada sin Terminal acreditada tiene procedencia desconocida. No se infiere retroactivamente Terminal mediante IP, clientId, localhost, historial SSE o hostname; tampoco obtiene privilegio de consola o estación Caja por inferencia. Su transición/migración permanece PENDIENTE. La compatibilidad histórica de v4.2 no prueba cumplimiento de las nuevas políticas.

Revocar una sesión no necesariamente revoca su Terminal. Revocar Terminal/credencial debe retirar sus autorizaciones efectivas aunque sobreviva Express. Ninguna revocación de Terminal libera automáticamente mesas, cuentas o responsabilidades de negocio.

La base aprobada es HTTPS, credenciales revocables, acreditación controlada, auditoría y protección administrativa, proporcional a un POS web/LAN. Se reconocen riesgos residuales de clonación completa de perfil, robo simultáneo de sesión y credencial, compromiso del SO y restauración/clonación de backup; no se promete demostrar hardware ante compromiso completo.

No se introducen inicialmente fingerprinting invasivo, MAC como identidad, agentes nativos, WebAuthn obligatorio, certificados cliente obligatorios, jerarquía compleja de hardware ni JWT innecesario para sustituir estado revocable.

### 5.2.9 Decisiones expresamente PENDIENTES

1. Duración contractual definitiva del timeout.
2. Detalle técnico del procedimiento de acreditación inicial de consola servidor; flujo conceptual aprobado en 5.4.
3. Detalle técnico del procedimiento de sustitución/reacreditación de Terminal; contrato de reemplazo de servidor ampliado en 5.4.
4. Recuperación administrativa de sesión Cocina inutilizable.
5. Recuperación administrativa de ocupación/sesión Cajero inutilizable.
6. Transición de sesiones heredadas sin Terminal.
7. Detalles técnicos de restauración/migración de acreditaciones; política conceptual aprobada en 5.4, con pendientes específicos en 5.4.10.
8. UX exacta de administración de Terminales.
9. UX exacta del takeover.
10. Nombres definitivos de tablas, columnas, endpoints, servicios, cookies y estados.
11. Alcance exacto de acciones de Caja que exigirán ocupación; las mutaciones financieras deberán quedar protegidas.
12. Mecanismo técnico definitivo contra carreras entre revocación de A y operaciones concurrentes ya admitidas.

No se inventan decisiones para cerrar estos puntos. Tampoco se considera aprobada una semántica de cancelación por conservar el resultado cancelled del código actual.

### 5.2.10 Deudas del código actual, no requisitos implementados

- Prohibición global Cocina + Admin incompleta en los caminos generales de asignación backend.
- SessionTakeover valida insuficientemente takeoverId, clientId y destinatario.
- El timeout puede resolver aceptación antes de confirmar revocación.
- Login puede continuar después de cancelled.
- clientId no acredita dispositivo ni Terminal.
- La selección del objetivo de takeover no conoce Terminal ni protege la consola acreditada.
- Revocación histórica y operativa no forman todavía una frontera suficientemente fuerte.
- Realtime no es autoridad de presencia definitiva.
- Posibles listeners frontend duplicados.
- La política actual no distingue correctamente todos los tipos/contextos.
- Al corregirlas, no convertir accidentalmente UserSession en autoridad general de autenticación.

Esta consolidación no corrige esas deudas ni autoriza implementación, cambios de tests, migraciones o bases. No acredita pruebas nuevas ni cierres funcionales.

## 5.3 Dependencias futuras revisadas

Se preservan numeración, avances y cierres de v4.1–v4.3. Se reorganiza solo la planificación futura: v4.4 incorpora identidades de instalación/servidor, Terminal y el núcleo de migración/recuperación/reacreditación como dependencias; contexto/Caja pasa a v4.5; presencia originalmente prevista en v4.5 se integra con administración/realtime en v4.7; v4.6 sustituye transferencia administrativa offline por revocación efectiva y takeover según política. No se renumeran fases publicadas ni se atribuye esta organización a los avances antiguos.

| Fase futura | Alcance revisado | Dependencia y estado |
|---|---|---|
| v4.4 | Identidad persistente de instalación, servidor acreditable reemplazable, primera instalación, Terminal/consola única, asociación con sesiones, backup/migración, recuperación, reacreditación y detección de servidor reemplazado. | Contrato conceptual ampliado en 5.4; implementación y validación pendientes; mecanismos y procedimientos técnicos pendientes. |
| v4.5 | Políticas por tipo/contexto, integración con selección automática/cambio de contexto y ocupación de estación Caja. | Requiere Terminal; implementación y validación pendientes. |
| v4.6 | Frontera de revocación efectiva, correlación de negociación y Session Takeover manual/timeout. | Requiere identidad/políticas; la frontera debe validarse antes de habilitar transferencias; integración actual incompleta. |
| v4.7 | Administración de Terminales/sesiones, presencia, realtime validado, recuperación Cocina/Cajero y transición de sesiones heredadas; visibilidad administrativa de la conciliación definida en v4.4. | Requiere el núcleo de migración/reacreditación de v4.4 y resolver los pendientes aplicables; sin cierre. |
| v4.8 | Historia y Reportería con Terminal, sesiones, transferencias y ocupaciones. | Requiere lifecycle integrado; sin cierre. |
| v4.9 | Pruebas de concurrencia, fallos, recuperación y regresiones operativas. | Requiere integración previa; sin cierre. |
| v4.10 | Validación contractual final y publicación con evidencia. | Requiere cerrar fases y pendientes aplicables; no completada. |

El transporte realtime existente puede reutilizarse antes de v4.7, siempre ligado a sesión validada; perfeccionar presencia no autoriza omitir la revocación. Las pruebas específicas y regresiones acompañan cada fase: v4.9 no posterga su obligación. Esta tabla no inicia implementación ni es una secuencia de commits; los detalles de futuras subfases aún deben concretarse.

## 5.4 Ampliación contractual: instalación, servidor y migración verificable

Esta ampliación del 22 de octubre de 2026 extiende el contrato aprobado en 5.2. Define producto y dependencias futuras de v4.4; no describe funciones ya implementadas. Conserva las políticas Admin, Cocina, Cajero, ocupación Caja, takeover y revocación efectiva. Los identificadores y estados siguientes son conceptuales, sin fijar tablas, columnas, APIs, algoritmos ni subversiones.

### 5.4.1 Tres identidades separadas

| Identidad conceptual | Qué representa y qué conserva |
|---|---|
| Instalación MundiPOS, equivalente a installationId | Continuidad lógica del sistema/restaurante. Persiste a reinicios, cambio de PC servidor, restauración y migración planificada; no representa una PC física. Su nombre técnico definitivo queda pendiente. |
| Identidad de servidor, equivalente a serverIdentity | Instancia actualmente autorizada para representar esa instalación. Es reemplazable: I1 puede conservar historia de K1 reemplazada, K2 vigente y futuros servidores. No equivale a installationId, IP ni identidad efímera del proceso Node. |
| Terminal cliente | Navegador/perfil acreditado de tablet, móvil, Caja, consola u otro cliente. Pertenece a una instalación y conserva relación/confianza con la identidad de servidor vigente que haya aceptado. |

installationId responde «¿a qué instalación lógica/restaurante pertenece este sistema?»; serverIdentity responde «¿qué servidor está autorizado para representarla?»; Terminal responde «¿qué cliente está acreditado para utilizarla?». I1, K1, K2 y T01 son ejemplos, no claves elegidas por una persona ni nombres obligatorios de implementación.

La identidad del servidor debe usar material seguro generado automáticamente, sin claves humanas simples. Términos como serverCredential o serverKeyId son ilustrativos; no fijan formato ni algoritmo. Un reinicio normal conserva la identidad vigente; un reemplazo autorizado crea otra identidad dentro de la misma instalación.

### 5.4.2 Primera instalación y autoridad inicial

Flujo aprobado: MundiPOS detecta estado inicial/no configurado → solicita crear el primer Admin → el Admin define contraseña → se crea identidad persistente de instalación → se crea identidad inicial de servidor → la Terminal actual se acredita como única consola servidor → el sistema queda inicializado.

El primer Admin participa como autoridad inicial, pero no se convierte en propietario permanente de la consola. Instalación, servidor y consola no dependen permanentemente de ese usuario; la consola queda ligada a la instalación y asociada a su servidor vigente. La auditoría puede conservar quién autorizó/acreditó inicialmente la consola. Este flujo amplía contractualmente el registro inicial existente; no afirma que este ya cree identidades o acreditaciones.

### 5.4.3 Backup normal, migración planificada y recuperación

| Operación | Efecto contractual |
|---|---|
| Backup normal | Busca recuperación ante daños, restauración de información y continuidad de negocio. Crearlo no revoca el servidor actual, no desactiva PC1 ni cambia automáticamente su identidad. |
| Migración planificada PC1 → PC2 | Operación administrativa explícita con PC1 disponible. Registra intención y sustitución, genera paquete apto para migración, retira la autorización de PC1 y exige continuar en PC2. |
| Recuperación por daño | PC1 no está disponible para migrar. PC2 usa backup normal válido y autoridad de un Admin restaurado para autorizar un nuevo servidor de la misma instalación. |

La futura acción administrativa equivalente a «Migrar servidor» se ubicará en Configuración/Administración. Debe registrar quién la inició, cuándo y cuál era el servidor vigente; registrar la intención de sustitución; generar el paquete/backup apto; retirar/revocar en PC1 su condición de servidor vigente y obligar a completar la restauración en PC2. Debe advertir claramente: «Una vez iniciada esta migración, este equipo deja de estar autorizado como servidor y la migración debe completarse inmediatamente en el nuevo equipo». No se diseña ni implementa UI aquí; rollback y recuperación ante errores siguen pendientes.

**Migración planificada:** PC1 tiene I1/K1. Al iniciarla, registra K1 como reemplazada/en sustitución y deja de actuar como servidor vigente. PC2 restaura el paquete y un Admin valida sus credenciales; conserva I1, no hereda K1 como identidad operativa y genera nueva identidad K2. Se acredita una nueva Terminal como consola. La historia queda I1 → K1 reemplazada / K2 activa: PC2 no finge ser PC1.

**Recuperación por daño:** PC2 inicia sin configuración activa y ofrece conceptualmente comenzar desde cero o restaurar instalación existente. Restaurar exige cargar un backup válido, reconocer I1, restaurar datos, detectar K1 y solicitar/validar credenciales de un Admin de esa instalación restaurada. Tras autorizarse, crea K2, marca K1 reemplazada por recuperación y acredita nueva consola. La copia física del backup no concede por sí sola condición de servidor vigente.

Backup válido + credenciales administrativas válidas constituyen doble control operativo (posesión del backup y conocimiento de credenciales); no se presenta como 2FA formal ni se fija todavía el protocolo de autenticación.

### 5.4.4 Confianza verificable y contenido del backup

Los clientes deben poder verificar que K2 está autorizado para I1; no basta que un servidor declare «soy K2». El mecanismo futuro podrá usar clave asimétrica, token firmado o equivalente, sin adoptar ahora PKI ni algoritmo. Se debe evitar que los clientes almacenen un secreto reutilizable que les permita suplantar al servidor. La validación exacta, almacenamiento de claves/credenciales y cadena de autorización siguen pendientes.

El backup debe poder preservar identidad de instalación, identidad/historia de servidores, Terminales conocidas, estados históricos, datos del negocio, usuarios, roles, configuraciones y relaciones necesarias. Esto no autoriza copiar automáticamente secretos reutilizables de servidor o Terminal. La inclusión/exclusión exacta de credenciales sensibles exige estudiar el sistema real de backup y permanece pendiente.

Un backup restaurado debe poder validarse para detectar corrupción, incompatibilidad de versión, estructura inválida y manipulación accidental. No se fija ni implementa firma, hash o algoritmo. La instrucción de respaldo de datos del README no constituye por sí misma un paquete de migración ni el futuro procedimiento de acreditación; no se encontró un contrato canónico específico de backup/restore que sustituir.

### 5.4.5 Conciliación y reacreditación de Terminales

PC2 conoce desde el backup las Terminales históricas, pero no las considera automáticamente migradas. Su clasificación inicial conceptual es PENDIENTE_DE_REACREDITACION. Debe disponer de conciliación visible: servidor anterior K1, actual K2 y Terminales migradas, pendientes o revocadas; el Admin debe poder identificar cuáles faltan.

PC2 intenta contactar/notificar clientes disponibles. Cada cliente recibe conceptualmente un aviso/modal de cambio de servidor con opciones de aceptar migración o rechazar/no aceptar. No se fija texto UI definitivo. La decisión de confianza exige identidad/evidencia validada; un aviso o clic aislado no acredita al servidor.

Si T01 acepta válidamente, conserva I1 y su identidad histórica, cambia explícitamente trustedServer de K1 a K2 y considera K1 reemplazada. Desde entonces no vuelve automáticamente a confiar en K1. Si rechaza/no acepta, no se registra como migrada ni se le asigna automáticamente confianza en K2.

Si T04 no responde o está apagada, no se elimina ni se vincula automáticamente a K2: permanece pendiente. Cuando reaparece, PC2 reconoce que pertenecía a I1 y que aún requiere decisión. El Admin podrá autorizar su migración o revocarla mediante el procedimiento que se defina.

| Estado conceptual de Terminal, no enum obligatorio | Significado durante migración |
|---|---|
| MIGRATED | Completó válidamente la migración de confianza hacia el servidor vigente. |
| PENDING | Conocida, pendiente de decisión/reacreditación; no se presume migrada. |
| REVOKED | Su acreditación/autorización fue retirada; no habilita operación por figurar históricamente. |

Arrancar PC2 no significa que la migración esté conciliada. Las Terminales no reconciliadas deben permanecer visibles. Las condiciones exactas para declarar «migración completada» y el timeout de reconciliación siguen pendientes; no se adopta por analogía el timeout de Session Takeover.

### 5.4.6 Evidencia transportada por clientes y propagación

Una Terminal migrada puede actuar como testigo verificable del reemplazo. Debe poder conservar conceptualmente evidencia que relacione I1, servidor anterior K1, servidor actual K2, migración M1 y Terminal T01, con prueba verificable. No se fija formato ni nombre técnico obligatorio para esa evidencia.

Propagación aprobada: PC2/K2 migra T01 → T01 contacta posteriormente PC1/K1 → presenta evidencia de K1 → K2 → PC1 valida esa evidencia → PC1 se autoinvalida como servidor reemplazado y bloquea la relación operativa antigua de sus clientes. El canal puede ser realtime, pero el evento no constituye por sí mismo prueba de autenticidad.

Un mensaje frontend no autenticado, «existe PC2» o «el cliente dice que hay un servidor nuevo» no puede provocar autoinvalidación. La transición ACTIVE → SUPERSEDED exige evidencia verificable de migración/reemplazo. La forma de demostrar autorización de K2 y de verificar esa evidencia en K1 queda pendiente; este contrato no la da por resuelta mediante una afirmación del cliente.

### 5.4.7 Servidor antiguo que reaparece y clientes huérfanos

En recuperación, PC1/K1 pudo estar desconectada y desconocer su sustitución. Cuando recibe y valida evidencia de reemplazo, debe pasar conceptualmente de ACTIVE a SUPERSEDED.

| Estado conceptual de servidor, no enum obligatorio | Contrato |
|---|---|
| ACTIVE | Instancia autorizada para operar por la instalación. |
| SUPERSEDED | Existe evidencia válida de reemplazo; no puede prestar operación normal. |
| RECOVERY | Estado excepcional administrativo/diagnóstico; no implica autorización de operación normal. |

SUPERSEDED debe impedir nuevos logins operativos, pagos, comandas, mutaciones de cuentas, uso de sesiones normales, nuevas asociaciones de Terminales y otras operaciones que generen divergencia. No basta bloquear nuevos logins mientras sesiones antiguas conservan capacidad de mutar.

Debe conservar datos, historial, configuración y evidencia de reemplazo; podrá tener capacidad administrativa limitada de diagnóstico/recuperación cuando corresponda. Las operaciones exactas de RECOVERY quedan pendientes. No borra automáticamente la base ni destruye historial.

Si T04 nunca migró y aún estaba vinculada a K1, al pasar PC1 a SUPERSEDED se bloquean nuevas mutaciones y se invalida esa relación operativa antigua. No se elimina T04: se marca pendiente de migración/reacreditación y se le informa conceptualmente que su servidor fue reemplazado. Deberá migrar a PC2/K2 o ser revocada. Ninguna revocación libera automáticamente responsabilidades de negocio.

### 5.4.8 Límite local y relación con los contratos anteriores

Si T99 estuvo aislada durante toda la migración y K1 reaparece antes de que T99 conozca K2, T99 no puede adivinar el reemplazo. Sin autoridad externa común no puede garantizarse detección perfecta de una copia antigua totalmente aislada; K1 podría operar temporalmente hasta recibir evidencia. No se introduce cloud obligatorio. La estrategia proporcional combina migración explícita, nueva identidad servidor, reacreditación, evidencia verificable, propagación, autoinvalidación y recuperación administrativa.

**Consola:** sigue siendo Terminal, ligada a I1 y asociada al servidor vigente. TS1/K1 se reemplazan por TS2/K2; TS1 no se reasigna automáticamente a PC2 ni conserva la condición especial de consola vigente. Se mantiene máximo una consola acreditada por instalación; la limitación de copias aisladas no autoriza una segunda consola legítima. El primer Admin no es dueño permanente de ninguna de estas identidades.

**Session Takeover:** mantiene el mismo servidor vigente y usuario, cambia Terminal operativa y transfiere continuidad mediante sesión propia de B y revocación efectiva de A. Migración cambia el servidor autorizado, reacredita clientes y puede afectar toda la instalación. No transfiere SID/session_uuid ni constituye un takeover global. Se preservan las políticas Admin, Cocina y Cajero de 5.2.

**Caja:** la Terminal conserva identidad histórica y requiere reacreditación hacia K2 antes de volver a ejercer Caja conforme a política. La autorización histórica de Caja no basta mientras solo confíe en K1. Siguen vigentes un ocupante por Terminal y una ocupación por usuario como máximos, incluso Admin; no se introducen turnos financieros ni se libera negocio por migrar.

**Realtime/clientId:** realtime transporta avisos, solicitudes de aceptación y eventos; la confianza descansa en identidad/evidencia validada. clientId conserva correlación, destino lógico y realtime; no se convierte en serverIdentity, credencial ni prueba de reemplazo. Express y UserSession conservan las responsabilidades definidas en 5.2.7.

### 5.4.9 Secuencia conceptual de v4.4, sin subversiones definitivas

1. Identidad persistente de instalación.
2. Identidad acreditable y reemplazable de servidor; modelo de confianza/evidencia.
3. Terminal, acreditación, asociación con sesiones/historia y consola única vinculada al servidor vigente.
4. Primera instalación con autoridad inicial del Admin.
5. Integración estudiada con backup, migración planificada y recuperación por daño.
6. Conciliación/reacreditación, propagación verificable, autoinvalidación del servidor antiguo y tratamiento de clientes huérfanos.
7. Pruebas de primera instalación, reinicios, backup sin revocación, migración y recuperación, evidencia falsa/válida, rechazo/no respuesta, Caja pendiente, servidor reaparecido, clientes aislados y conservación de datos/historia.

Es una secuencia de dependencias conceptual; no fija identificadores v4.4.x, commits ni cierres. Las verificaciones acompañan cada área, sin esperar al último punto. La administración posterior de v4.7 usa este núcleo; no posterga a v4.7 las garantías de reemplazo y reacreditación de v4.4.

### 5.4.10 Decisiones técnicas y operativas que siguen PENDIENTES

1. Nombre técnico de installationId.
2. Formato exacto de identidad de servidor.
3. Mecanismo criptográfico.
4. Almacenamiento de clave privada/credencial.
5. Procedimiento exacto de validación entre cliente y servidor.
6. Contenido/formato exacto de evidencia de migración.
7. Formato exacto del paquete de migración.
8. Integración real con el backup existente.
9. Secretos que entran/no entran al backup.
10. Descubrimiento de la nueva dirección/IP del servidor; la dirección no acredita identidad.
11. UI final.
12. Timeout de reconciliación.
13. Condiciones exactas para declarar migración completada.
14. Operaciones permitidas en RECOVERY.
15. Tratamiento de clientes aislados.
16. Proceso manual de recuperación ante migración errónea.
17. Rollback seguro.
18. Resolución de conflicto si dos servidores intentan declararse vigentes simultáneamente.
19. Interoperabilidad entre versiones diferentes de MundiPOS.

Esta ampliación concreta flujos antes pendientes en 5.2.9, sin cerrar sus detalles técnicos ni los demás pendientes de sesión. No se inventan algoritmos, custodia de claves, autoridades externas ni procedimientos de rollback para simular un diseño terminado.

### 5.4.11 Riesgos/deudas futuros del reemplazo de servidor

- Un servidor antiguo aislado puede operar temporalmente sin haber recibido evidencia de migración.
- Un backup clonado puede generar copias de la misma instalación.
- Un cliente antiguo puede desconocer el nuevo servidor.
- Un mensaje no autenticado no debe poder invalidar un servidor.
- La identidad de servidor no debe depender de IP.
- La migración no debe copiar automáticamente secretos peligrosos.
- PC1 revivida no debe fusionar automáticamente datos con PC2.
- La divergencia de datos tras el reemplazo es un conflicto, no sincronización implícita.

Estos riesgos son distintos de las deudas de sesiones de 5.2.10, que se conservan. No se afirma que las mitigaciones, el backup validable, la identidad verificable ni la autoinvalidación existan hoy. Esta actualización solo documenta el contrato; no implementa tablas, criptografía, backup/restore ni pruebas.

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

**COMPLETADA Y PUBLICADA.**

- **SHA de cierre funcional v4.3:** `930291c34981803bc56e2cb3360677e30357be36`.

Subfases publicadas:

- v4.3.1 → **PUBLICADA**. Commit funcional/publicado: `599893301c91fa7644c8e5fc7f73d8753b9a20b9`.
- v4.3.2 → **PUBLICADA**. Commit funcional/publicado: `a8c54d6fe54b88ce05362a36584254abd2f7d4ae`.
- v4.3.3 → **PUBLICADA**. Commit funcional/publicado: `930291c34981803bc56e2cb3360677e30357be36`.

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

<details>
<summary>Planificación original v4.4–v4.6 — histórica; sustituida por las secciones 5.2 y 5.3</summary>

El bloque siguiente conserva literalmente el plan anterior y su estado documental de entonces, incluido «NO INICIADA». Sus límites Admin genéricos, autorización administrativa offline y ubicación original de presencia no son el contrato vigente. No constituye evidencia de implementación; consultar la revisión fechada y la nueva tabla de dependencias.

# v4.4 — Política de sesiones concurrentes

## Estado actual

**NO INICIADA.**

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

</details>

# v4.7 — Administración, presencia, realtime y transición

## Estado y alcance revisado

**PLANIFICADA; SIN CIERRE.** Integra Terminal y las políticas de 5.2; los procedimientos y UX pendientes no se dan por aprobados aquí.

## Objetivo

Dar al administrador visibilidad y control sobre Terminales y sesiones autorizadas sin exponer información sensible; integrar presencia, recuperación y transición según 5.3.

### Funciones

Según la UI aprobada:

- consultar sesiones activas;
- ver usuario;
- identificar cliente/dispositivo;
- conocer estado online/offline;
- conocer fecha de inicio;
- revocar cuando corresponda;
- distinguir la sesión Admin de consola acreditada de su única sesión externa;
- administrar acreditación, sustitución y revocación de Terminal conforme al procedimiento que se defina;
- identificar ocupaciones Caja sin confundir estación y usuario.

### Presencia, realtime y transición

Combinar realtime, actividad y gracia para presencia/UX sin convertir SSE en autoridad de revocación. Vincular conexiones con sesión/Terminal validadas y conservar clientId como correlación.

Resolver antes de implementar los procedimientos pendientes de recuperación administrativa Cocina/Cajero y transición de legado sin Terminal. Para administración de migraciones, utilizar el núcleo y la conciliación de v4.4 definidos en 5.4; sus detalles técnicos pendientes no se consideran resueltos. No inferir privilegios especiales para sesiones de procedencia desconocida.

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

La revisión añade Terminal acreditada o procedencia desconocida, decisiones de negociación y ocupación Caja cuando corresponda. No registrar credenciales secretas ni sustituir la historia por la autorización técnica.

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

Añadir al contrato de pruebas: consola Admin protegida + externo; dos externos Admin; Cocina sin takeover y sin Admin; una ocupación por usuario y por Terminal Caja; Admin + Cajero con consola no-Cajero; selección automática y cambio multirrol; negociación duplicada/tardía; aceptación y timeout sin habilitación de B antes de revocación; fallo de revocación y operaciones de A ya admitidas.

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

Añadir acreditación revocada con Express superviviente, reinicio conservando Terminal, cambio/borrado de perfil, sesiones heredadas sin procedencia, copia de clientId sin privilegios, sustitución de consola, proxy/túnel y restauración/migración según el procedimiento que se apruebe. No se declaran ejecutadas estas pruebas por documentarlas.

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
- prueba Admin con dos dispositivos;
- validación de primera instalación, migración/recuperación, reacreditación y servidor reemplazado conforme a 5.4.

### Documentación

Actualizar:

- documento de cierre v4.10;
- roadmap;
- contratos correspondientes;
- README canónico.

### Resultado esperado

Un contrato documentado donde:

- las sesiones sobreviven a reinicios autorizados;
- la instalación conserva su identidad al reemplazar servidor, con nueva identidad verificable, reacreditación de Terminales y bloqueo del servidor anterior al validar evidencia de reemplazo;
- los usuarios no abandonan responsabilidades activas;
- Salonero/Mesero y Bartender sujetos a continuidad tienen máximo una sesión externa operativa;
- Admin tiene como máximo una sesión de consola acreditada protegida y una externa;
- Cocina tiene una sesión, sin takeover ni combinación Admin, conservando la cuenta departamental;
- cada Terminal Caja tiene como máximo un ocupante y cada usuario como máximo una ocupación Caja, incluso Admin;
- las transferencias del mismo usuario autorizadas manualmente o por timeout revocan efectivamente A antes de habilitar B;
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
Responsabilidad activa y bloqueo de logout — **COMPLETADA Y PUBLICADA** mediante `930291c34981803bc56e2cb3360677e30357be36`.

↓

Las etapas siguientes tienen contrato revisado en 5.2 y dependencias en 5.3; ninguna se declara completada por esta consolidación. El bloque original v4.4–v4.6 permanece archivado arriba.

`v4.4`
Identidad de instalación/servidor, Terminal/consola, primera instalación, migración/recuperación y reacreditación verificable — **IMPLEMENTACIÓN Y VALIDACIÓN PENDIENTES**; secuencia conceptual en 5.4.9.

↓

`v4.5`
Políticas de concurrencia, contexto operativo y ocupación Caja — **IMPLEMENTACIÓN Y VALIDACIÓN PENDIENTES**.

↓

`v4.6`
Revocación efectiva y Session Takeover — **INTEGRACIÓN INCOMPLETA; SIN CIERRE**.

↓

`v4.7`
Administración de Terminales/sesiones, presencia, realtime y transición — **PLANIFICADA; SIN CIERRE**.

↓

`v4.8`
Historial y Reportería.

↓

`v4.9`
Concurrencia, fallos y pruebas cruzadas.

↓

`v4.10`
Validación y cierre contractual.
