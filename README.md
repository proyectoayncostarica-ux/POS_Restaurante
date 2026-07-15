# MundiPOS

MundiPOS es un sistema POS web local para restaurante/bar. El backend corre con Node.js + Express y usa SQLite como base de datos local. La app estÃ¡ pensada para operar primero en PC/red local y evolucionar luego hacia PWA, mÃ³vil con Capacitor o sincronizaciÃ³n cloud si el negocio lo requiere.

## Identidad y versiÃ³n actual

- **Nombre oficial de la app:** MundiPOS
- **VersiÃ³n visible/funcional de la app:** 2.0
- **Estado de producto:** versiÃ³n funcional operativa en proceso de estabilizaciÃ³n
- **LÃ­nea de trabajo actual:** v2.2.5M.6 Â· Tipos/Grupos de presentaciÃ³n

La versiÃ³n visible para usuarios, configuraciÃ³n pÃºblica y metadata base de la app debe mantenerse como **2.0** hasta que se decida publicar una nueva versiÃ³n funcional mayor. Las lÃ­neas internas **v2.1** y **v2.2** no representan todavÃ­a una versiÃ³n visible para usuarios finales; representan etapas trazables de estabilizaciÃ³n.

## Control de versionado del proyecto

Este proyecto se trabajarÃ¡ con versionado trazable por etapa, fase y fix.

### Etapas

| Etapa | Nombre | DescripciÃ³n |
|---|---|---|
| v1 | Prototipo | Primera versiÃ³n experimental del POS. |
| v2.0 | Operativa | VersiÃ³n funcional con mÃ³dulos, permisos y operatividad base. |
| v2.1 | Estabilidad | Etapa cerrada: estabilidad visual, navegaciÃ³n, PWA y base tÃ©cnica. |
| v2.2 | EstabilizaciÃ³n de Dashboard | Etapa actual: consolidar el Dashboard como panel operativo real para restaurante/bar. |

### Fases de estabilidad

Durante las etapas de estabilidad se usarÃ¡ el formato:

```text
v2.x.x
```

Ejemplos:

```text
v2.1.5 PreparaciÃ³n PWA para PC y mÃ³vil
v2.2.1 EstabilizaciÃ³n base del Dashboard
v2.2.2 Dashboard operativo por zonas
v2.2.3 Indicadores y acciones rÃ¡pidas
v2.2.4.0 Roadmap de Zonas dinÃ¡micas, roles de trabajo y permisos
```

### Fixes derivados

Si una fase introduce o revela un bug derivado, se documentarÃ¡ como fix:

```text
v2.1.1 fix1
v2.1.1 fix2
v2.1.2 fix1
```

Cada fix debe indicar:

```text
- QuÃ© bug corrige.
- QuÃ© archivo(s) toca.
- QuÃ© flujo debe probarse.
- QuÃ© riesgo queda pendiente, si existe.
```

## DocumentaciÃ³n tÃ©cnica de arquitectura

La fase **v2.2.4** cuenta con un roadmap tÃ©cnico separado para guiar la transiciÃ³n hacia zonas dinÃ¡micas, puestos dinÃ¡micos, roles de trabajo, permisos por acciÃ³n, sesiÃ³n operativa activa y servicio 10% configurable por zona/puesto.

Documentos canÃ³nicos de esta arquitectura:

```text
docs/roadmap-v2.2.4-zonas-roles-permisos.md
docs/auditoria-v2.2.4.1-mapa-impacto.md
```

El roadmap define el orden seguro de implementaciÃ³n. La auditorÃ­a tÃ©cnica y mapa de impacto identifica dÃ³nde vive la lÃ³gica actual y quÃ© archivos/mÃ³dulos se verÃ¡n afectados antes de escribir cÃ³digo funcional.

Estos documentos deben revisarse antes de implementar cualquier cambio funcional relacionado con `Zonas`, `Usuarios`, `Dashboard`, `Pedidos`, `Cuentas`, `Header`, permisos, roles de trabajo o servicio 10%.

Regla principal de implementaciÃ³n para v2.2.4:

```text
No se continÃºa con la siguiente subfase hasta que la subfase actual estÃ© comprobada como funcional, documentada en README y subida mediante commit/push seguro.
```

## Registro de cambios canÃ³nico

### v2.2.4.1 Â· AuditorÃ­a tÃ©cnica y mapa de impacto

- **Objetivo:** estudiar el cÃ³digo actual antes de implementar la arquitectura de zonas dinÃ¡micas, roles de trabajo, permisos por acciÃ³n, sesiÃ³n operativa activa y servicio 10% configurable.
- **Alcance:** esta subfase es documental y de auditorÃ­a; no modifica lÃ³gica funcional, base de datos, permisos reales, Dashboard, Zonas, Usuarios, Pedidos ni Cuentas.
- **Mapa de impacto:** se identifican los mÃ³dulos y archivos donde viven actualmente login, usuarios, zonas rÃ­gidas, mesas/bancos, pedidos, cuentas, Dashboard, header, subnavegaciÃ³n mÃ³vil, realtime y PWA.
- **Hallazgos principales:** la app todavÃ­a depende de `salon`, `bar`, `bar-mesa` y `bar-banco`; la tabla `mesas` funciona en la prÃ¡ctica como `puestos`; no existen tablas reales de zonas, tipos de puesto, roles de trabajo ni sesiÃ³n operativa activa.
- **Riesgos documentados:** no se debe renombrar `mesas` de golpe, no se deben activar restricciones por zona antes de tener sesiÃ³n operativa, no se deben crear roles de trabajo con zonas inexistentes y no se debe mover el servicio 10% sin persistir la regla en el pedido.
- **RecomendaciÃ³n tÃ©cnica:** iniciar la siguiente subfase funcional con `v2.2.4.2 Â· Bootstrap de administrador inicial`, antes de rediseÃ±ar Zonas o activar restricciones operativas.
- **Documento creado:** `docs/auditoria-v2.2.4.1-mapa-impacto.md`.
- **ValidaciÃ³n realizada:** revisiÃ³n estÃ¡tica y `node --check` sobre backend/frontend principales relacionados con auth, usuarios, zonas, pedidos, Dashboard, realtime y service worker.
- **Archivos modificados:** `README.md` y `docs/auditoria-v2.2.4.1-mapa-impacto.md`.
- **Siguiente subfase:** `v2.2.4.2 Â· Bootstrap de administrador inicial`.

### v2.2.4.0 Â· Roadmap de Zonas dinÃ¡micas, roles de trabajo y permisos

- **Objetivo:** dejar documentado el camino seguro para convertir `Zonas` en una arquitectura dinÃ¡mica sin romper la operaciÃ³n actual de Dashboard, Zonas, Pedidos, Cuentas, Usuarios, Header y sincronizaciÃ³n PC/mÃ³vil.
- **Contexto:** se define que las zonas ya no deben ser valores fijos como `SalÃ³n`, `Bar` y `Barra`; deben ser locaciones configurables del local. Los puestos tampoco deben limitarse a mesa/banco, sino evolucionar a tipos dinÃ¡micos como mesa, banco, sillÃ³n, cabina o mesa alta.
- **Roles:** se separan dos conceptos: `rol de sistema` (`Admin` / `EstÃ¡ndar`) y `rol de trabajo` (`Bartender`, `Salonero`, `Terraza`, `Apoyo`, etc.). El rol de sistema controla permisos administrativos; el rol de trabajo define las zonas visibles y operables durante la sesiÃ³n activa.
- **Usuarios y zonas:** se documenta que no se deben crear usuarios estÃ¡ndar operativos sin zonas y roles de trabajo vÃ¡lidos. Los roles de trabajo deben seleccionar zonas reales existentes, no escribir nombres de zonas como texto libre.
- **Registro inicial:** se define la necesidad de un flujo de bootstrap donde, si no existe ningÃºn administrador, la app muestre registro inicial en lugar de login normal. El usuario demo debe ser configurable para desarrollo/producciÃ³n.
- **Servicio 10%:** se establece que cada zona puede definir si aplica servicio 10%, y cada puesto puede heredar o sobrescribir esa regla. Al abrir un pedido se deberÃ¡ guardar si aplica servicio y el porcentaje correspondiente.
- **Regla de seguridad:** no se deben bloquear mÃ³dulos completos para usuarios estÃ¡ndar; los permisos deben ser por acciÃ³n y por zona permitida. Un usuario estÃ¡ndar puede no administrar Zonas, pero sÃ­ operar puestos asignados.
- **Documento creado:** `docs/roadmap-v2.2.4-zonas-roles-permisos.md`.
- **Alcance:** esta subfase es documental; no modifica lÃ³gica funcional, base de datos, login, Dashboard, Zonas ni permisos reales.
- **Siguiente subfase:** `v2.2.4.1 Â· AuditorÃ­a tÃ©cnica y mapa de impacto`.
- **Archivos modificados:** `README.md` y `docs/roadmap-v2.2.4-zonas-roles-permisos.md`.
- **Prueba recomendada:** confirmar que ambos documentos existen, que el README referencia el roadmap y que no hay cambios funcionales pendientes asociados a esta subfase.

### v2.2.3 fix1 Â· LiberaciÃ³n de mesa/banco desde Nuevo pedido

- **Problema detectado:** en el modal `Nuevo Pedido`, cuando una mesa/banco ocupada no tenÃ­a pedido activo, el botÃ³n `Liberar` no ejecutaba el cierre si el mÃ³dulo `Zonas` todavÃ­a no habÃ­a cargado su propia lista interna de mesas/bancos.
- **Causa:** `Tables.cerrarMesa()` dependÃ­a de `Tables.data`; al abrir el flujo desde `Pedidos`, esa colecciÃ³n podÃ­a estar vacÃ­a aunque `Orders.tables` sÃ­ tuviera la mesa/banco correcta. Por eso el botÃ³n parecÃ­a no funcionar hasta abrir primero el modal de zona.
- **CorrecciÃ³n aplicada:** el cierre operativo ahora busca la mesa/banco en `Tables.data`, luego en `Orders.tables` y, si aÃºn no existe, consulta `/api/tables` antes de mostrar la confirmaciÃ³n.
- **Nuevo flujo:** el botÃ³n `Liberar` del modal `Nuevo Pedido` usa una acciÃ³n dedicada que reutiliza el modal premium de confirmaciÃ³n y refresca `Pedidos`, `Zonas` y `Dashboard` cuando la liberaciÃ³n termina correctamente.
- **Compatibilidad:** no cambia la lÃ³gica del backend ni permite cerrar mesas/bancos con pedidos pendientes; conserva la validaciÃ³n existente del endpoint `/api/tables/:id/close`.
- **Cache/PWA:** se actualizÃ³ la versiÃ³n del service worker para forzar la carga de los cambios en mÃ³vil/PWA.
- **Archivos modificados:** `public/js/components/orders.js`, `public/js/components/tables.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** abrir una mesa/banco, entrar al mÃ³dulo `Pedidos`, abrir `Nuevo Pedido` para esa zona sin agregar productos y tocar `Liberar`; debe abrir el modal de confirmaciÃ³n y liberar la zona sin necesidad de visitar primero el mÃ³dulo `Zonas`.

### v2.2.3 Â· Modales operativos premium: Abrir zona y Confirmar cierre

- **Objetivo:** profesionalizar los modales operativos de `Abrir Zona` y `Confirmar Cierre de Mesa/Banco` para que mantengan la identidad premium de MundiPOS sin alterar la lÃ³gica de apertura, reserva o cierre.
- **Abrir zona:** el modal ahora incluye encabezado visual compacto con icono, zona, tipo y capacidad; los campos se muestran con menor separaciÃ³n en PC para que el footer quede visible dentro del viewport sin depender del scroll.
- **Confirmar cierre:** el modal de cierre ahora usa una tarjeta de confirmaciÃ³n con resumen de zona, nÃºmero y cliente, facilitando la validaciÃ³n visual antes de liberar la mesa/banco.
- **PC:** se reducen paddings, alturas de campos y espacios verticales Ãºnicamente para estos modales operativos, evitando que los botones del footer queden fuera de vista en pantallas estÃ¡ndar.
- **MÃ³vil:** se conserva el flujo actual, pero con aspecto mÃ¡s moderno: tarjeta premium, mejor jerarquÃ­a, iconografÃ­a, bordes suaves, fondo degradado y botones cÃ³modos para tap.
- **Compatibilidad:** `Utils.confirm` acepta opciones opcionales de presentaciÃ³n sin romper las confirmaciones existentes.
- **Cache/PWA:** se actualizÃ³ la versiÃ³n de `style.css` y del service worker para forzar la carga de los estilos nuevos en mÃ³vil.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/js/components/tables.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** desde PC abrir una mesa/banco y confirmar que el footer sea visible sin scroll; luego probar en mÃ³vil que el modal mantenga el flujo anterior pero con diseÃ±o premium. Cerrar una mesa/banco y confirmar que el modal muestre el resumen operativo antes de confirmar.

### v2.2.2 fix3 Â· CorrecciÃ³n de ventas y cuentas pagadas del dÃ­a

- **Problema detectado:** `Ventas del dÃ­a` y `Cuentas pagadas del dÃ­a` podÃ­an mostrarse en cero aunque existieran pagos reales, porque el Dashboard filtraba usando la fecha original del pedido (`pedidos.fecha`) en lugar de la fecha real del pago (`pagos.fecha`).
- **CorrecciÃ³n aplicada:** el Dashboard ahora calcula ventas, cuentas pagadas recientes y detalle de ventas usando `pagos.fecha`; asÃ­ una cuenta abierta antes pero pagada hoy se registra correctamente en la operaciÃ³n del dÃ­a.
- **Fecha operativa:** se usa el dÃ­a local de Costa Rica para evitar desfases por UTC cuando el servidor guarda fechas en formato ISO.
- **Ventas del dÃ­a:** el total de ventas de contado/tarjeta ahora suma `pagos.monto`, que representa el monto realmente cobrado, en lugar de depender del total base del pedido.
- **Cuentas pagadas del dÃ­a:** la lista de actividad reciente se ordena por la fecha real de pago y muestra las Ãºltimas cuentas pagadas dentro del dÃ­a operativo.
- **Detalle de ventas:** el modal de `Ventas del dÃ­a` tambiÃ©n usa la fecha y monto del pago real.
- **Alcance:** se modifica Ãºnicamente la lÃ³gica del backend del Dashboard; no cambia la base de datos ni la presentaciÃ³n visual de las cards.
- **Archivos modificados:** `server/routes/dashboard.js` y `README.md`.
- **Prueba recomendada:** pagar una cuenta desde PC o mÃ³vil, volver al Dashboard y confirmar que `Ventas del dÃ­a`, `Cuentas pagadas del dÃ­a` y el modal de detalle reflejen el pago sin esperar al siguiente dÃ­a ni depender de la fecha de apertura del pedido.


### v2.2.2 fix2 Â· Mayor visibilidad de mesa/banco en cards ocupadas

- **Objetivo del fix:** mejorar la lectura operativa de mesas/bancos ocupados para que el usuario identifique rÃ¡pidamente el cliente y el nÃºmero de ubicaciÃ³n sin perder el estado de la card.
- **JerarquÃ­a ocupada:** el nombre del cliente se mantiene como tÃ­tulo principal. El nÃºmero de mesa/banco pasa al espacio del badge de estado con fondo negro, borde rojo, texto blanco y mayÃºscula (`MESA 2` / `BANCO 1`).
- **Estado operativo:** el texto `OCUPADA` pasa al espacio del detalle donde antes estaba el nÃºmero de mesa/banco; usa badge transparente, borde rojo y texto negro en mayÃºscula.
- **Monto:** el monto consumido aumenta de tamaÃ±o para ganar protagonismo sin romper la simetrÃ­a de la card en PC ni mÃ³vil.
- **Alcance:** solo se modifica la presentaciÃ³n de cards ocupadas en Dashboard. Las cards libres y reservadas mantienen la dinÃ¡mica definida en `v2.2.2`.
- **Cache/PWA:** se actualizÃ³ la versiÃ³n de `style.css` y del service worker para forzar la carga del ajuste en mÃ³vil.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** abrir Dashboard con una mesa ocupada en PC y mÃ³vil; confirmar que el tÃ­tulo siga siendo el cliente, que el badge negro muestre `MESA/BANCO #`, que `OCUPADA` aparezca abajo como badge transparente y que el monto tenga mÃ¡s protagonismo.

### v2.2.2 fix1 Â· SincronizaciÃ³n operativa en tiempo real entre PC y mÃ³vil

- **Objetivo del fix:** corregir que los cambios realizados desde una estaciÃ³n/dispositivo no se reflejaran inmediatamente en las demÃ¡s vistas abiertas, reduciendo el riesgo de operar dos veces sobre la misma mesa/banco.
- **SincronizaciÃ³n:** se agrega un canal Server-Sent Events en `/api/realtime/events` para avisar a los clientes activos cuando ocurre una mutaciÃ³n operativa en zonas, pedidos, cuentas o crÃ©ditos.
- **Frontend:** cada cliente genera un identificador local y lo envÃ­a en las peticiones; al recibir un evento operativo, la vista activa se refresca automÃ¡ticamente. El Dashboard actualiza mesas/bancos, mÃ©tricas y cuentas pagadas sin esperar al intervalo normal.
- **ProtecciÃ³n adicional:** al crear un pedido se valida si la mesa/banco ya tiene una cuenta pendiente; si existe, se responde con conflicto `409` para evitar doble escritura sobre la misma zona.
- **Compatibilidad PWA:** el service worker mantiene `/api/*` como `network-only`, por lo que el canal en tiempo real no se sirve desde cachÃ©. Se actualizÃ³ la versiÃ³n del service worker para forzar refresco.
- **Archivos modificados:** `server/app.js`, `server/routes/orders.js`, `server/utils/realtime.js`, `public/js/main.js`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** abrir MundiPOS en PC y mÃ³vil con la misma red; ocupar/liberar/reservar una mesa desde un dispositivo y confirmar que el otro actualiza el Dashboard sin recargar manualmente. Luego intentar crear dos pedidos simultÃ¡neos para la misma mesa y confirmar que el segundo intento se bloquea.
- **Pendientes o riesgos:** si el navegador mÃ³vil suspende la pestaÃ±a/PWA en segundo plano, la actualizaciÃ³n llegarÃ¡ al volver al primer plano o con el autorefresco del Dashboard.

### v2.2.2 Â· Cards de mesas

- **Objetivo:** ajustar la jerarquÃ­a visual de las cards de mesas/bancos para que el dato principal cambie segÃºn el estado operativo sin alterar el comportamiento actual de apertura, reserva o pedido.
- **Libre:** se mantiene la dinÃ¡mica actual: zona/tipo, nÃºmero de mesa/banco, estado libre y capacidad.
- **Reservada:** el tÃ­tulo principal de la card ahora muestra directamente el nombre del cliente, sin el prefijo `Cliente:`; el nÃºmero de mesa/banco se traslada al detalle como badge transparente, en mayÃºscula, negrita y con borde anaranjado coherente con el estado reservado. Hora y personas se mantienen igual.
- **Ocupada:** el tÃ­tulo principal de la card ahora muestra directamente el nombre del cliente, sin el prefijo `Cliente:`; el nÃºmero de mesa/banco se traslada al detalle como badge transparente, en mayÃºscula, negrita y con borde rojo coherente con el estado ocupado.
- **Monto:** el monto consumido en cards ocupadas aumenta ligeramente de tamaÃ±o, manteniendo simetrÃ­a en PC y mÃ³vil.
- **Seguridad visual:** si una mesa/banco ocupada o reservada no tiene cliente registrado, el tÃ­tulo usa el nombre de la zona (`Mesa 2`, `Banco 1`) como respaldo para evitar cards sin encabezado.
- **Cache/PWA:** se actualizÃ³ la versiÃ³n de `style.css` y del service worker para forzar la carga de la nueva jerarquÃ­a visual en mÃ³vil.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** validar en Dashboard una mesa libre, una reservada y una ocupada en PC y mÃ³vil; confirmar que libre no cambia, que reservada/ocupada muestran cliente como tÃ­tulo, que el badge `MESA/BANCO #` respeta el color del estado y que el monto no rompe la altura de la card.

### v2.2.1 fix6 Â· Acciones del Dashboard, header mÃ³vil y cuentas pagadas

- **Objetivo del fix:** corregir las acciones rÃ¡pidas del Dashboard, ajustar nuevamente el header mÃ³vil y simplificar el Dashboard eliminando tarjetas redundantes.
- **NavegaciÃ³n corregida:** el badge `Cuentas pendientes` ahora dirige correctamente al mÃ³dulo `Cuentas` y la card `CrÃ©ditos abiertos` dirige al mÃ³dulo `CrÃ©ditos`.
- **Header mÃ³vil:** se reincorpora el dÃ­a y se muestran segundos; la fecha queda arriba y el reloj abajo, centrados verticalmente para aprovechar el espacio disponible.
- **Cierre diario:** se crea el botÃ³n `Cierre diario` en el header. En PC muestra icono y texto; en mÃ³vil queda solo como icono entre el usuario y el botÃ³n de cierre de sesiÃ³n. Por ahora no ejecuta lÃ³gica funcional.
- **Dashboard simplificado:** se eliminan las tarjetas redundantes de `Cuentas`, `Ventas` y `Zonas` para mantener protagonismo en mesas/bancos, sticky operativo, crÃ©ditos abiertos y actividad reciente.
- **Cuentas pagadas del dÃ­a:** se reemplaza la tabla simple por cards compactas con mejor jerarquÃ­a visual, monto destacado y acceso directo al detalle de la cuenta.
- **Cache/PWA:** se actualizÃ³ la versiÃ³n de `style.css` y del service worker para forzar estilos nuevos en mÃ³vil.
- **Archivos modificados:** `server/routes/dashboard.js`, `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** en mÃ³vil validar header con dÃ­a/fecha/hora con segundos, tocar `Cuentas pendientes`, tocar `CrÃ©ditos abiertos`, revisar que ya no aparezcan las tarjetas redundantes y confirmar que las cuentas pagadas se vean como cards.

### v2.2.1 fix5 Â· Header mÃ³vil con usuario visible y subheader Dashboard no fijo en PC

- **Objetivo del fix:** ajustar Ãºnicamente el comportamiento solicitado para mÃ³vil y PC sin tocar la lÃ³gica operativa del Dashboard.
- **MÃ³vil:** el header principal deja de mostrar el dÃ­a de la semana y conserva solo fecha y hora en formato compacto para liberar espacio.
- **Usuario en mÃ³vil:** se vuelve visible el bloque de usuario junto a la fecha; arriba muestra `Admin` para administradores o `EstÃ¡ndar` para usuarios bÃ¡sicos, y abajo muestra el nombre del usuario centrado.
- **PC:** el subheader operativo del Dashboard deja de ser sticky y vuelve a desplazarse con el contenido al hacer scroll.
- **Cache/PWA:** se actualizÃ³ la versiÃ³n de `style.css` y del service worker para evitar que mÃ³vil conserve estilos anteriores.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** en mÃ³vil confirmar que el header muestra fecha/hora + tipo/nombre de usuario sin el dÃ­a; en PC hacer scroll en Dashboard y confirmar que el subheader no queda fijo.

### v2.2.1 fix4 Â· Sticky operativo y filtros por estado en Dashboard

- **Objetivo del fix:** ajustar el sticky operativo del Dashboard para que `Vista actual`, `Cuentas pendientes` y `Ventas del dÃ­a` tengan mÃ¡s espacio, especialmente en mÃ³vil, y convertir los badges de estado en filtros rÃ¡pidos.
- **Sticky:** se retirÃ³ `CrÃ©ditos abiertos` del subheader fijo y se trasladÃ³ a una card operativa debajo del bloque de mesas/bancos, evitando que el badge de `Vista actual` se corte en PC y mÃ³vil.
- **MÃ³vil:** el sticky queda pegado al header, usa tres badges mÃ¡s altos y vuelve a mostrar los tÃ­tulos `Vista actual`, `Cuentas pendientes` y `Ventas del dÃ­a` dentro de cada badge.
- **PC:** el texto secundario de `Vista actual` queda en blanco para mantener contraste sobre el degradado oscuro.
- **Filtros por estado:** los badges `Libres`, `Ocupadas` y `Reservadas` ahora son clicables y filtran las tarjetas visibles segÃºn el estado dentro de la zona activa.
- **Reset inteligente:** si se cambia de zona y el filtro de estado activo no tiene resultados en la nueva zona, el Dashboard limpia automÃ¡ticamente ese filtro para no dejar la pantalla vacÃ­a.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** en Dashboard, seleccionar SalÃ³n y tocar `Ocupadas` para ver solo las mesas ocupadas; cambiar a Bar o Barra y confirmar que el filtro se conserva solo si hay coincidencias, o se reinicia si no existen.

### v2.2.1 fix1 Â· CorrecciÃ³n visual operativa del Dashboard mÃ³vil y prioridad de zonas

- **Objetivo del fix:** corregir la primera estabilizaciÃ³n del Dashboard para que respete la funciÃ³n real de la pantalla: las zonas, mesas y bancos deben ser el elemento protagonista tanto en PC como en mÃ³vil.
- **Problema detectado:** las tarjetas grandes de resumen (`Vista actual`, `Cuentas pendientes`, `Ventas del dÃ­a` y `CrÃ©ditos abiertos`) ocupaban demasiado espacio antes del control de zonas, especialmente en mÃ³vil, y algunos estilos nuevos podÃ­an competir con los bordes de estado de mesas/bancos.
- **Cambios visuales:** esos indicadores se transformaron en un subheader compacto y fijo dentro del Dashboard, con estilo de badges operativos, para que no desplacen las cards de zonas.
- **Prioridad operativa:** las cards de SalÃ³n, Bar y Barra quedan como primer bloque funcional visible despuÃ©s del subheader compacto; el encabezado descriptivo se oculta en mÃ³vil para reducir ruido.
- **Estados restaurados:** los bordes de las cards del Dashboard vuelven a depender del estado real de la mesa/banco: verde para libre, rojo para ocupada y amarillo/naranja para reservada; la zona se identifica mediante badge, no mediante el borde principal.
- **MÃ³vil:** se agregaron estilos especÃ­ficos para una vista mÃ¡s compacta y elegante: subheader sticky, cards en dos columnas, mÃ©tricas internas compactas, jerarquÃ­a visual reducida y mejor aprovechamiento del espacio vertical.
- **Archivos modificados:** `public/index.html`, `public/css/style.css` y `README.md`.
- **Pruebas recomendadas:** revisar Dashboard en PC y celular, validar que los filtros Todos/SalÃ³n/Bar/Barra sigan funcionando, confirmar que las cards de mesas/bancos mantengan borde por estado y que al hacer scroll el subheader de indicadores permanezca visible sin tapar la barra inferior mÃ³vil.
- **Resultado esperado:** Dashboard mÃ¡s operativo, mÃ¡s mÃ³vil-first y coherente con el uso real del POS durante servicio, sin cambios backend ni persistencia SQLite.

### v2.2.1 fix3 Â· Micro ajuste mÃ³vil del subheader sticky y correcciÃ³n de mÃ©tricas del Dashboard

- **Objetivo del fix:** ajustar el Dashboard mÃ³vil para que el subheader operativo quede pegado visualmente al header principal y corregir los contadores superiores que podÃ­an quedarse en cero aunque existieran mesas/bancos activos.
- **Problema visual detectado:** al hacer scroll en mÃ³vil quedaba una separaciÃ³n entre el header y el subheader sticky, dejando ver contenido pasar por detrÃ¡s; ademÃ¡s los badges de `Libres`, `Ocupadas`, `Reservadas` y `Consumo activo` se percibÃ­an planos.
- **Cambios visuales:** el subheader sticky del Dashboard ahora ocupa el ancho horizontal completo bajo el header mÃ³vil, usa fondo sÃ³lido y una franja superior de cobertura para evitar transparencias durante el scroll.
- **Badges operativos:** los indicadores de `Libres`, `Ocupadas`, `Reservadas` y `Consumo activo` ahora tienen icono, profundidad, color contextual y estructura compacta para mÃ³vil.
- **CorrecciÃ³n de datos:** el frontend recalcula el resumen operativo desde `mesasDetalle` como fuente visible de verdad, evitando que `Vista actual`, libres, ocupadas, reservadas y consumo activo muestren cero cuando sÃ­ hay mesas/bancos en pantalla.
- **Backend:** `/api/dashboard` construye `zonasResumen` desde el mismo detalle de mesas/bancos que renderiza el Dashboard y evita duplicar una mesa si existieran varios pedidos pendientes asociados.
- **PWA/cache:** se actualizÃ³ la versiÃ³n de `style.css` y del service worker para que el celular tome el nuevo CSS/JS.
- **Archivos modificados:** `server/routes/dashboard.js`, `public/index.html`, `public/css/style.css`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** abrir una mesa/banco, volver al Dashboard en mÃ³vil, confirmar que `Vista actual` y los badges inferiores reflejen los datos reales; luego hacer scroll y validar que el subheader quede pegado al header sin dejar ver contenido por detrÃ¡s.

### v2.2.1 fix2 Â· AplicaciÃ³n real de estilos mÃ³viles del Dashboard

- **Objetivo del fix:** corregir que los estilos mÃ³viles del Dashboard no se reflejaran en celular despuÃ©s de los cambios PWA/cache y de reglas heredadas de `.mesa-card`.
- **Problema detectado:** el navegador mÃ³vil podÃ­a conservar `style.css` anterior mediante service worker y, ademÃ¡s, reglas antiguas de tarjetas podÃ­an ganar prioridad sobre el layout operativo del Dashboard.
- **Cambios aplicados:** se versionÃ³ la carga de `style.css`, se subiÃ³ la versiÃ³n del service worker, los assets CSS/JS ahora usan estrategia `network-first` y se agregÃ³ un bloque mÃ³vil final de alta especificidad para el Dashboard.
- **JerarquÃ­a visual recuperada:** las zonas/mesas/bancos quedan como contenido principal; los indicadores de Vista actual, Cuentas pendientes, Ventas del dÃ­a y CrÃ©ditos abiertos se mantienen como subheader compacto sticky.
- **Estados visuales conservados:** verde para libre, rojo para ocupada y amarillo/naranja para reservada; la zona SalÃ³n/Bar/Barra se muestra como badge y no reemplaza el color del estado.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** abrir en mÃ³vil, borrar datos del sitio si aÃºn aparece CSS viejo, entrar a `/POS/`, ir al Dashboard y comprobar que el subheader sea compacto y que las cards de zonas aparezcan en dos columnas con bordes por estado.

### v2.2.1 Â· EstabilizaciÃ³n base del Dashboard operativo

- **Objetivo:** iniciar la etapa v2.2 convirtiendo el Dashboard en un panel operativo real para restaurante/bar: primero zonas/mesas, cuentas activas, ventas del dÃ­a y estado inmediato de la operaciÃ³n.
- **FunciÃ³n real del Dashboard:** no debe comportarse como un reporte administrativo pesado; debe funcionar como centro de control rÃ¡pido para ver SalÃ³n, Bar y Barra, abrir zonas libres, continuar pedidos en zonas ocupadas y revisar el pulso del dÃ­a.
- **Backend:** `/api/dashboard` ahora devuelve un resumen operativo por filtro (`todos`, `salon`, `bar-mesa`, `bar-banco`), totales separados de mesas y bancos, consumo activo por zona, ventas calculadas desde pagos y Ãºltimas cuentas pagadas con informaciÃ³n de zona.
- **Frontend:** se reorganizÃ³ el Dashboard con encabezado operativo, tarjetas de comando, panel de control por zona, mÃ©tricas del filtro activo, estados vacÃ­os/carga/error y actualizaciÃ³n de bancos libres/ocupados que antes no se reflejaban.
- **InteracciÃ³n:** las tarjetas de zona del Dashboard conservan acciones operativas: abrir zona libre, ver reserva, crear pedido si estÃ¡ ocupada sin pedido y agregar productos si tiene pedido activo.
- **AutoactualizaciÃ³n:** se evita duplicar intervalos de refresco y el Dashboard vuelve a activar autorefresco al entrar con sesiÃ³n existente, manteniendo actualizaciÃ³n periÃ³dica mientras el mÃ³dulo estÃ¡ activo.
- **Archivos modificados:** `server/routes/dashboard.js`, `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/js/components/dashboard.js` y `README.md`.
- **Pruebas recomendadas:** entrar al Dashboard en PC y mÃ³vil, cambiar filtros Todos/SalÃ³n/Bar/Barra, abrir una zona libre, crear/agregar productos a un pedido, pagar una cuenta y confirmar que los contadores, consumo activo, ventas y Ãºltimas cuentas se actualizan.
- **Resultado esperado:** Dashboard mÃ¡s claro, Ãºtil y estable para operaciÃ³n diaria, sin modificar la base de datos ni subir datos locales de prueba.
- **Pendientes v2.2:** refinar indicadores por hora/turno, acciones rÃ¡pidas adicionales, alertas operativas y posibles datos semilla versionables para demo sin commitear `data/restaurant.db`.

### v2.1.5 Â· PreparaciÃ³n PWA para PC y mÃ³vil

- **Objetivo:** agregar la base tÃ©cnica necesaria para que MundiPOS pueda instalarse como PWA en PC, tablet y mÃ³vil, manteniendo el enfoque local-first del POS.
- **Alcance:** se creÃ³ el manifiesto web, service worker, pÃ¡gina offline, set completo de iconos instalables y lÃ³gica frontend de registro/actualizaciÃ³n/instalaciÃ³n.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js`, `server/app.js` y `README.md`.
- **Archivos nuevos:** `public/manifest.webmanifest`, `public/service-worker.js`, `public/offline.html` y los iconos PWA dentro de `public/assets/icons/`.
- **Comportamiento en PC:** el navegador compatible puede ofrecer instalaciÃ³n de MundiPOS como app independiente usando `display: standalone`, con accesos directos hacia Dashboard, Zonas y Cuentas.
- **Comportamiento en mÃ³vil:** la app queda preparada para instalaciÃ³n desde navegador compatible, usa iconos dedicados, respeta `theme_color`, safe areas y mantiene la navegaciÃ³n responsive existente.
- **Service worker:** cachea el app shell local bajo `/POS/`, evita cachear rutas `/api/` con sesiÃ³n/datos operativos, limpia caches antiguos y muestra una pÃ¡gina offline cuando el servidor local o la red no estÃ¡n disponibles.
- **LÃ³gica de instalaciÃ³n:** se agregÃ³ manejo de `beforeinstallprompt`, botÃ³n contextual `Instalar` en el header cuando el navegador lo permite y aviso de actualizaciÃ³n cuando hay un nuevo service worker listo.
- **Backend:** `server/app.js` sirve `service-worker.js` y `manifest.webmanifest` con headers explÃ­citos para evitar cachÃ© agresivo del navegador.
- **Pruebas realizadas/recomendadas:** validar sintaxis de `public/js/main.js`, `server/app.js` y `public/service-worker.js`; revisar que `/POS/manifest.webmanifest`, `/POS/service-worker.js` y `/POS/offline.html` respondan correctamente; probar instalaciÃ³n PWA en Chrome/Edge de PC y Android.
- **Resultado esperado:** MundiPOS queda instalable como PWA y puede cargar su shell visual desde cachÃ©, pero las operaciones reales siguen requiriendo el servidor local y SQLite disponibles.
- **Riesgos o pendientes:** Font Awesome sigue viniendo de CDN y podrÃ­a no mostrar iconos si no existe cachÃ© externa; para una PWA completamente offline conviene migrar iconografÃ­a crÃ­tica a assets locales en una fase posterior.

### v2.1.5 fix1 Â· CorrecciÃ³n de instalabilidad PWA y soporte HTTPS local

- **Problema detectado:** la PWA no ofrecÃ­a instalaciÃ³n de forma confiable en PC/mÃ³vil. Se reforzÃ³ la configuraciÃ³n porque Chrome/Edge solo muestran instalaciÃ³n cuando la app cumple manifest + service worker y se sirve desde un origen permitido: HTTPS o localhost/127.0.0.1. En mÃ³viles conectados a la IP local de la PC, HTTP no es suficiente.
- **Objetivo del fix:** hacer mÃ¡s robusta la instalabilidad PWA, evitar rutas ambiguas bajo `/POS`, mejorar el registro del service worker, agregar ayuda contextual cuando el navegador no permite instalar y preparar modo HTTPS local opcional.
- **Archivos modificados:** `public/index.html`, `public/manifest.webmanifest`, `public/service-worker.js`, `public/js/main.js`, `public/css/style.css`, `server/app.js`, `.env.example` y `README.md`.
- **Cambios realizados:** se normalizaron rutas absolutas del manifest/assets bajo `/POS/`, se registrÃ³ el service worker con scope explÃ­cito `/POS/`, se agregÃ³ header `Service-Worker-Allowed`, se hizo mÃ¡s tolerante el precache del app shell, se redirige `/POS` a `/POS/`, se agregÃ³ soporte opcional HTTPS con `HTTPS_ENABLED`, `HTTPS_KEY_PATH` y `HTTPS_CERT_PATH`, y el botÃ³n de instalaciÃ³n ahora muestra ayuda si el origen no permite PWA o si el navegador requiere instalaciÃ³n manual.
- **Comportamiento esperado en PC:** usando `http://localhost:3000/POS/` o `http://127.0.0.1:3000/POS/`, Chrome/Edge deben poder registrar el service worker y ofrecer instalaciÃ³n cuando se cumplan los criterios del navegador.
- **Comportamiento esperado en mÃ³vil:** si se accede por `http://IP_LOCAL:3000/POS/`, el navegador puede bloquear la instalaciÃ³n por no ser HTTPS. Para instalaciÃ³n real desde mÃ³vil por red local debe usarse HTTPS con certificado confiable instalado en el dispositivo o un tÃºnel HTTPS.
- **Pruebas realizadas/recomendadas:** validar sintaxis de `public/js/main.js`, `server/app.js` y `public/service-worker.js`; validar JSON de `public/manifest.webmanifest`; probar en PC con `http://localhost:3000/POS/`; si se prueba desde mÃ³vil por IP local, configurar HTTPS confiable antes de esperar instalaciÃ³n PWA.
- **Resultado esperado:** PWA mÃ¡s robusta y clara: instala en contexto permitido, muestra ayuda cuando el navegador bloquea la instalaciÃ³n y deja documentado el requisito de HTTPS para mÃ³vil en red local.
- **Riesgos o pendientes:** falta generar/instalar certificados confiables para cada entorno real; si el local no quiere gestionar HTTPS, la alternativa futura serÃ¡ empaquetar con Capacitor/Electron/Tauri o usar un tÃºnel HTTPS.

### v2.1.4 Â· EstabilizaciÃ³n de subnavegaciÃ³n interna por mÃ³dulo

- **Objetivo:** modernizar la navegaciÃ³n interna de los mÃ³dulos para diferenciar claramente la navegaciÃ³n principal entre mÃ³dulos de la subnavegaciÃ³n contextual dentro de cada mÃ³dulo.
- **Diferencia de navegaciÃ³n:** el sidebar/hamburguesa mantiene la navegaciÃ³n principal entre Dashboard, Zonas, MenÃº, Cuentas, CrÃ©ditos, Usuarios y ConfiguraciÃ³n; la nueva subnavegaciÃ³n controla solo vistas internas del mÃ³dulo activo.
- **Comportamiento en mÃ³vil/tablet:** se agregÃ³ una barra inferior fija `mobile-subnav`, visible solo cuando el mÃ³dulo activo tiene subpÃ¡ginas internas, con iconos, texto, estado activo claro y padding inferior en el contenido para evitar solapes.
- **Comportamiento en PC/web:** los controles internos se convierten en tabs premium dentro del contenido, sin barra inferior fija, usando la paleta azul profundo/dorado, bordes redondeados, sombras suaves, hover/focus y estado activo claro.
- **MÃ³dulos afectados:** Dashboard, Zonas, MenÃº, Cuentas/Pedidos y ConfiguraciÃ³n. CrÃ©ditos y Usuarios no muestran barra inferior porque no tienen subpÃ¡ginas internas reales.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/js/components/dashboard.js`, `public/js/components/tables.js`, `public/js/components/menu.js`, `public/js/components/orders.js`, `public/js/components/settings.js` y `README.md`.
- **Cambios realizados:** se centralizÃ³ la definiciÃ³n de subpÃ¡ginas en `INTERNAL_SUBNAV`, se agregÃ³ `Navigation.selectInternal()`, `renderInternalSubnav()` y sincronizaciÃ³n de estados activos, reutilizando las funciones actuales de filtros y `switchView()`.
- **Transiciones implementadas:** se agregÃ³ transiciÃ³n corta con clase `internal-switching` para cambios internos y se respeta `prefers-reduced-motion`; la navegaciÃ³n global previa se mantiene sin cambios funcionales.
- **Pruebas realizadas/recomendadas:** validar sintaxis de `main.js` y componentes afectados, revisar `git diff`/`git status` y probar manualmente PC/mÃ³vil para confirmar barra inferior, tabs, cambios de subpÃ¡gina y ausencia de barra en CrÃ©ditos/Usuarios.
- **Resultado esperado:** navegaciÃ³n interna mÃ¡s cercana a una app profesional, cÃ³moda en mÃ³vil y consistente en PC, sin cambiar rutas backend, autenticaciÃ³n, permisos ni lÃ³gica operativa.
- **Riesgos o pendientes:** queda pendiente validaciÃ³n visual en navegador/dispositivos fÃ­sicos para ajustar tamaÃ±os de texto, espacios inferiores y comportamiento con formularios largos.

### v2.1.3 Â· EstabilizaciÃ³n visual del sidebar y transiciones globales

- **Objetivo:** modernizar el sidebar, el menÃº hamburguesa mÃ³vil y las transiciones entre mÃ³dulos para que la app autenticada se sienta mÃ¡s fluida y coherente con el login/header actual.
- **Problema visual/UX detectado:** el sidebar mantenÃ­a una apariencia plana, el menÃº mÃ³vil abrÃ­a/cerraba de forma brusca, los mÃ³dulos cambiaban de golpe y el footer interno repetÃ­a autor/versiÃ³n ya presentes en el login.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js` y `README.md`.
- **Cambios realizados en sidebar PC:** se aplicÃ³ fondo premium con degradado, profundidad, bordes sutiles, mejor espaciado, estados hover/active mÃ¡s claros, iconografÃ­a resaltada y microinteracciÃ³n rÃ¡pida al seleccionar mÃ³dulos.
- **Cambios realizados en menÃº mÃ³vil:** se agregÃ³ overlay moderno con fade/blur, apertura y cierre por desplazamiento suave, cierre al tocar fuera, cierre al seleccionar mÃ³dulo y Ã¡reas tÃ¡ctiles mÃ¡s cÃ³modas.
- **Cambios realizados en transiciones entre mÃ³dulos:** `Navigation.showSection()` ahora centraliza una transiciÃ³n de salida/entrada entre secciones, evita estados corruptos con `navigationTransitionId` y respeta `prefers-reduced-motion` con animaciones mÃ­nimas.
- **Elementos eliminados del sidebar/footer interno:** se retirÃ³ el bloque `Creado by Andrey AcuÃ±a` y la versiÃ³n visible del sidebar, porque esa informaciÃ³n quedÃ³ centralizada en el login institucional.
- **Pruebas realizadas/recomendadas:** validar sintaxis de `public/js/main.js`, revisar `git diff`/`git status` y probar manualmente sidebar PC, menÃº mÃ³vil, navegaciÃ³n entre Dashboard, Zonas, MenÃº, Cuentas, CrÃ©ditos, Usuarios y ConfiguraciÃ³n.
- **Resultado esperado:** navegaciÃ³n lateral mÃ¡s profesional y compacta, menÃº mÃ³vil fluido, mÃ³dulos con transiciÃ³n suave y sin cambios en rutas, sesiÃ³n, permisos ni lÃ³gica backend.
- **Riesgos o pendientes:** queda pendiente validaciÃ³n visual en navegador/dispositivo fÃ­sico para ajustar tiempos o espaciados finos si el uso real en pantallas pequeÃ±as lo requiere.

### v2.1.2 Â· EstabilizaciÃ³n visual del header principal

- **Objetivo:** mejorar la presentaciÃ³n del header autenticado de MundiPOS sin cambiar la lÃ³gica funcional de los mÃ³dulos.
- **Problema visual/tÃ©cnico detectado:** el header se veÃ­a plano, no mostraba logo, ocultaba la fecha/hora en mÃ³vil y el reloj se actualizaba con un `setInterval` global sin ciclo explÃ­cito de inicio/parada.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js` y `README.md`.
- **Cambios realizados:** se integrÃ³ el logo oficial de MundiPOS, se reorganizÃ³ la jerarquÃ­a de marca/restaurante/usuario/reloj/logout y se agregÃ³ profundidad visual con fondo, bordes, sombras suaves y mejor espaciado.
- **IntegraciÃ³n del logo oficial:** se agregÃ³ el archivo `public/assets/brand/mundipos-mark.jpg` y se usa como identidad principal en la tarjeta de login y en el header autenticado.
- **Comportamiento en PC:** el header muestra logo, nombre MundiPOS, nombre del restaurante, usuario, tipo de usuario, fecha/hora completa y botÃ³n de cierre con icono + texto.
- **Comportamiento en mÃ³vil:** el header queda compacto, muestra menÃº, solo el logo oficial, fecha/hora compacta en el Ã¡rea de contexto y botÃ³n de cierre reducido a icono; se ocultan el texto MundiPOS, el nombre del restaurante y el texto del botÃ³n.
- **RevisiÃ³n del reloj/fecha/hora:** se reemplazÃ³ el intervalo global por `startHeaderClock()` y `stopHeaderClock()`, con guard contra timers duplicados, limpieza al volver al login y actualizaciÃ³n limitada a los nodos de escritorio/mÃ³vil cuando cambia el texto.
- **Archivos modificados por integraciÃ³n del logo:** `public/index.html`, `public/css/style.css`, `public/assets/brand/mundipos-mark.jpg` y `README.md`.
- **Validaciones realizadas por integraciÃ³n del logo:** revisiÃ³n de rutas/referencias del asset, validaciÃ³n de sintaxis JS y revisiÃ³n de `git diff`/`git status`.
- **Pruebas visuales:** no se realizaron pruebas en navegador, login ni flujo visual por instrucciÃ³n expresa del usuario para evitar consumo adicional.
- **Pruebas realizadas/recomendadas:** iniciar sesiÃ³n, verificar header en Dashboard, cambiar entre mÃ³dulos, abrir/cerrar menÃº mÃ³vil, cerrar sesiÃ³n y repetir login/logout validando que el reloj no duplique timers. Revisar en PC y viewport mÃ³vil.
- **Resultado esperado:** header profesional, legible y responsive, con fecha/hora siempre visible en app autenticada y sin acumulaciÃ³n de intervalos tras login/logout.
- **Pendientes o riesgos:** queda pendiente validaciÃ³n visual en navegador/dispositivos fÃ­sicos; conviene revisar el recorte final del logo oficial en pantallas pequeÃ±as y con nombres de restaurante muy largos.

### v2.1.1 fix1 Â· CorrecciÃ³n de estado del botÃ³n de login al cerrar sesiÃ³n

- **Objetivo:** dejar el formulario de acceso limpio y listo para una nueva autenticaciÃ³n despuÃ©s de cerrar sesiÃ³n.
- **Problema corregido:** el botÃ³n permanecÃ­a deshabilitado y mostraba `Preparando panel...` al volver al login porque el estado de carga aplicado durante el ingreso exitoso no se restablecÃ­a.
- **Archivos modificados:** `public/js/main.js`, `public/index.html`, `public/css/style.css` y `README.md`.
- **Cambio realizado:** `showLogin()` restablece campos, mensajes, estado visual y contenido del botÃ³n. AdemÃ¡s, se agregÃ³ el bloque institucional inferior del login y su versiÃ³n se sincroniza con `version_app` mediante `/api/public/branding`.
- **Prueba realizada/recomendada:** iniciar sesiÃ³n, confirmar la carga del Dashboard, cerrar sesiÃ³n y verificar que los campos queden vacÃ­os, el botÃ³n habilitado con el texto `Iniciar sesiÃ³n` y sin la clase de carga. Repetir en vista mÃ³vil y confirmar el texto institucional con `v2.0`.
- **Resultado esperado:** el usuario puede volver a iniciar sesiÃ³n inmediatamente y el bloque institucional permanece centrado, legible y fuera de la tarjeta de acceso.
- **Riesgos o pendientes:** validar posteriormente el bloque institucional en dispositivos fÃ­sicos con pantallas de poca altura; no se modificaron autenticaciÃ³n, sesiones ni persistencia SQLite.

### v2.1.0 Â· Base de estabilidad inicial

- Se saneÃ³ el arranque del proyecto.
- Se retirÃ³ `node_modules` del repositorio.
- Se agregÃ³ `.gitignore` y `.env.example`.
- Se verificÃ³ el arranque con SQLite y sesiÃ³n.
- Se agregÃ³ identidad visual inicial de MundiPOS.
- Se agregÃ³ endpoint pÃºblico seguro para branding: `/api/public/branding`.
- Se normalizÃ³ la versiÃ³n visible/funcional de la app a **2.0**.
- Se creÃ³ una referencia central de nombre y versiÃ³n en `server/config/appInfo.js`.

## Regla obligatoria para futuros cambios

Todo cambio hecho en Codex o manualmente debe actualizar este README cuando altere cualquiera de estos puntos:

```text
- versiÃ³n, etapa, fase o fix
- mÃ³dulos funcionales
- flujo operativo
- base de datos o migraciones
- seguridad o permisos
- instalaciÃ³n, arranque o dependencias
- bugs corregidos o pendientes conocidos
```

Antes de cerrar cada fase o fix se debe agregar una entrada al registro de cambios.

## Requisitos

- Node.js 18 o superior
- npm
- SQLite CLI recomendado para auditorÃ­a y revisiÃ³n manual de datos

## InstalaciÃ³n limpia

```bash
npm install
cp .env.example .env
npm start
```

Abrir la app en:

```text
http://localhost:3000/POS
```

Cuando la base estÃ¡ vacÃ­a y `SEED_DEMO_USER=false`, la app muestra el formulario de registro inicial del primer administrador.

Para desarrollo controlado, `SEED_DEMO_USER=true` puede crear el usuario demo `admin/admin123` solo si la tabla de usuarios estÃ¡ vacÃ­a. No usar ese modo en producciÃ³n.

## Variables de entorno

Copia `.env.example` como `.env` y ajusta lo necesario:

```text
PORT=3000
SESSION_SECRET=cambia-esta-clave
DB_PATH=./data/restaurant.db
CORS_ORIGINS=
NODE_ENV=development
COOKIE_SECURE=false
```

`CORS_ORIGINS` puede quedar vacÃ­o para uso local. Si se publica la API detrÃ¡s de un dominio, agregar los orÃ­genes separados por coma.

## Base de datos

La base se guarda por defecto en:

```text
data/restaurant.db
```

El inicializador crea el schema completo si la base no existe. TambiÃ©n aplica migraciones bÃ¡sicas sobre bases viejas, incluyendo columnas faltantes y reparaciÃ³n de claves forÃ¡neas heredadas.

Antes de hacer cambios grandes o usar una base vieja, crear respaldo:

```bash
cp data/restaurant.db data/backups/restaurant-$(date +%Y%m%d-%H%M%S).db
```

## Estructura principal

```text
server/app.js              # entrada del servidor
server/config/appInfo.js   # nombre oficial, versiÃ³n visible y lÃ­nea de estabilidad
server/db/database.js      # conexiÃ³n, schema y migraciones
server/routes/             # endpoints API
public/index.html          # frontend
public/css/style.css       # estilos globales
public/js/main.js          # utilidades globales y sesiÃ³n
public/js/components/      # pantallas del POS
public/uploads/            # imÃ¡genes subidas
```

## Scripts

```bash
npm start       # iniciar servidor
npm run dev     # iniciar con nodemon
```

En Windows tambiÃ©n puedes usar `Inicio_Servidor.bat`. En Linux/macOS puedes usar `Inicio_Servidor.sh` o `start_dev.sh`.

## Flujo de trabajo recomendado

```text
1. Crear o confirmar fase/fix de trabajo.
2. Hacer cambios pequeÃ±os y trazables.
3. Probar flujo afectado desde la app.
4. Revisar consola del navegador y terminal del servidor.
5. Revisar datos SQLite si el cambio afecta persistencia.
6. Actualizar este README.
7. Hacer commit con mensaje claro.
```

## Notas de mantenimiento

- No subir `node_modules` al repositorio.
- No subir `.env` ni copias reales de producciÃ³n.
- No subir archivos temporales de SQLite: `*.db-wal`, `*.db-shm`, `*.db-journal`.
- Mantener `data/backups/` fuera del repositorio si contiene datos reales.
- La app actual es web local; para PC puede empaquetarse despuÃ©s con Electron/Tauri y para mÃ³vil conviene evolucionarla primero como PWA/responsive.

## Registro de cambios reciente

### v2.2.4.3 fix2 Â· Selector de hora mÃ³vil para reservas
- Se reemplazÃ³ el uso problemÃ¡tico del reloj nativo en mÃ³vil dentro del modal **Abrir Zona** por un selector de hora mÃ³vil propio, evitando recortes visuales dentro del modal de reserva.
- En PC se mantiene el campo de hora nativo, que ya funcionaba correctamente.
- Se actualizÃ³ el versionado de `style.css` y `service-worker.js` para invalidar cachÃ© mÃ³vil/PWA.

### v2.2.4.3 fix3 Â· Visibilidad del selector de hora en mÃ³vil
- Se corrigiÃ³ la prioridad CSS que mantenÃ­a oculto el selector premium de hora en mÃ³vil dentro del modal **Abrir Zona**.
- El control mÃ³vil de hora queda forzado al final del stylesheet para no ser sobrescrito por reglas previas.
- En PC se mantiene el campo nativo de hora que ya funcionaba correctamente.
- Se actualizÃ³ el versionado de `style.css` y `service-worker.js` para invalidar cachÃ© mÃ³vil/PWA.


### v2.2.4.13 Â· Servicio 10% integrado a pedidos/cuentas

- **Servicio por configuraciÃ³n:** el servicio se calcula desde la configuraciÃ³n de la zona y del puesto, no desde una decisiÃ³n manual al momento de cobrar.
- **Snapshot por cuenta:** al crear un pedido/cuenta se guardan `aplica_servicio` y `porcentaje_servicio` dentro del pedido para que cambios futuros en la zona o puesto no alteren cuentas ya abiertas.
- **Totales persistidos:** se agregan campos de subtotal, servicio y total con servicio para pedidos y pagos.
- **Cobro:** el backend calcula el servicio real al pagar usando el snapshot guardado en el pedido. El frontend solo muestra el desglose.
- **CrÃ©dito:** las cuentas enviadas a crÃ©dito guardan el total incluyendo servicio cuando aplique.
- **Dashboard:** los montos de cuentas activas usan el total con servicio cuando la cuenta aplica servicio.
- **Compatibilidad:** cuentas antiguas sin snapshot se recalculan de forma defensiva y no se rompe la operaciÃ³n existente.
- **UI:** el modal de pago muestra el servicio aplicado automÃ¡ticamente y elimina la decisiÃ³n manual de aplicar/no aplicar servicio.

Archivos modificados en esta subfase:

- `README.md`
- `server/db/database.js`
- `server/routes/orders.js`
- `server/routes/dashboard.js`
- `public/js/components/orders.js`
- `public/css/style.css`
- `public/index.html`
- `public/service-worker.js`

### v2.2.4.13 fix1 Â· Respuesta segura del Service Worker/PWA

- **Problema detectado:** despuÃ©s del login, la PWA podÃ­a quedar en pantalla blanca con `TypeError: Failed to convert value to 'Response'` dentro de `service-worker.js`.
- **Causa:** algunos manejadores del Service Worker podÃ­an resolver `null` o `undefined` cuando una peticiÃ³n navegacional o de asset fallaba y no existÃ­a una respuesta cacheada disponible.
- **CorrecciÃ³n aplicada:** todos los flujos `navigation`, `networkFirstAsset`, `staleWhileRevalidate` y API devuelven siempre un objeto `Response` vÃ¡lido, incluso si el servidor local no responde temporalmente.
- **Alcance:** correcciÃ³n PWA/cache Ãºnicamente; no cambia servicio 10%, base de datos, pedidos, cuentas ni endpoints de negocio.
- **Versionado:** `service-worker.js` queda en `v2.2.4.13-fix1-pwa-response-fallback` para forzar actualizaciÃ³n de cachÃ©.

Archivos modificados en este fix:

- `README.md`
- `public/service-worker.js`

### v2.2.4.13 fix2 Â· Service Worker seguro y empaquetado en ruta correcta

- **Problema detectado:** la PWA seguÃ­a mostrando pantalla blanca con `Failed to convert value to 'Response'` durante la navegaciÃ³n `/POS/?source=pwa`.
- **Causa:** el Service Worker podÃ­a quedar activo con una versiÃ³n previa o no recibir el archivo en la ruta real `public/service-worker.js`, dejando una promesa de `FetchEvent` sin una `Response` vÃ¡lida.
- **CorrecciÃ³n aplicada:** se reemplazÃ³ el manejador `fetch` por una envoltura defensiva `respondSafely()` que siempre devuelve una instancia `Response` para navegaciÃ³n, assets y API.
- **Empaquetado:** este fix incluye el archivo en `public/service-worker.js` para que se sobrescriba la ruta servida por `/POS/service-worker.js`.
- **Alcance:** no cambia la lÃ³gica de servicio 10%, pedidos, cuentas, base de datos ni endpoints de negocio.

### v2.2.4.13 fix3 Â· RecuperaciÃ³n de markup operativo del index

- **Problema detectado:** despuÃ©s de iniciar sesiÃ³n la pantalla quedaba en blanco sin errores visibles de consola.
- **Causa:** el `public/index.html` incluido en la fase de servicio 10% habÃ­a quedado desactualizado y sobrescribÃ­a markup crÃ­tico de fases anteriores, incluyendo la pantalla de selecciÃ³n operativa multirrol y elementos del header de roles.
- **CorrecciÃ³n aplicada:** se recupera el `index.html` actualizado con sesiÃ³n operativa multirrol, header con rol activo y cambio de rol, manteniendo el versionado de la fase de servicio 10%.
- **Alcance:** no cambia base de datos, endpoints, pedidos, cuentas ni cÃ¡lculo del servicio; corrige la pantalla blanca causada por markup faltante.

### v2.2.4.13 fix4 Â· RecuperaciÃ³n visual y mezcla segura de esquema

- Corrige la regresiÃ³n visual causada por un CSS de v2.2.4.13 que no incluÃ­a los estilos acumulados de sesiÃ³n operativa multirrol, cambio de rol, navegaciÃ³n mÃ³vil dinÃ¡mica y responsabilidad compartida.
- Restaura `public/css/style.css` desde la base visual estable de v2.2.4.11 y conserva el bloque visual del servicio 10%.
- Corrige `server/db/database.js` para mantener las tablas/campos de roles, responsabilidad compartida y `mesa_responsables`, integrando ademÃ¡s los campos de servicio 10% para pedidos/pagos.
- Corrige el 500 en `GET /api/tables/structure` provocado por una mezcla incompleta de esquema.
- Mantiene el Service Worker defensivo y actualiza versionado para evitar cachÃ© vieja.

### v2.2.4.14 Â· Zonas premium operativo/administrativo

- **Objetivo:** separar visualmente el mÃ³dulo Zonas en dos capas claras: administraciÃ³n del local y operaciÃ³n diaria de puestos.
- **AdministraciÃ³n:** el usuario administrador mantiene el panel de zonas, tipos de puesto y roles de trabajo, con acceso a crear/editar estructura.
- **OperaciÃ³n:** se agrega un bloque operativo premium con filtros dinÃ¡micos por zonas reales, resumen de puestos y grilla de atenciÃ³n.
- **Filtros dinÃ¡micos:** Zonas ya no depende de filtros fijos SalÃ³n/Bar/Barra; ahora usa zonas reales permitidas y conserva compatibilidad con datos legacy.
- **SubnavegaciÃ³n mÃ³vil:** el mÃ³dulo Zonas se integra a la navegaciÃ³n mÃ³vil dinÃ¡mica con **Todos + primeras 3 zonas + MÃ¡s...**, igual que Dashboard.
- **Prioridad mÃ³vil:** las zonas con puestos activos/responsabilidad del usuario suben automÃ¡ticamente a las primeras posiciones visibles.
- **Cards operativas:** las tarjetas de puestos muestran zona/tipo reales, servicio, reservas, estado operativo y responsabilidad sin exponer nombres a usuarios bÃ¡sicos no responsables.
- **Permisos visuales:** usuarios estÃ¡ndar ven solo la operaciÃ³n permitida; administradores ven administraciÃ³n + operaciÃ³n global.
- **Alcance:** no cambia base de datos, reglas de responsabilidad, endpoints ni cÃ¡lculo de servicio 10%.

### v2.2.4.15 Â· Realtime adaptado

- **SincronizaciÃ³n segmentada:** los eventos SSE ahora incluyen contexto operativo de zona, mesa, pedido y usuarios afectados cuando el backend puede inferirlo.
- **Respeto de roles activos:** usuarios estÃ¡ndar solo reciben refrescos en tiempo real de zonas permitidas por sus roles de trabajo activos o de mesas/cuentas donde estÃ¡n involucrados como responsables.
- **Admin global:** usuarios administradores mantienen sincronizaciÃ³n global para poder supervisar y operar todo el local.
- **Responsabilidad compartida:** cambios en responsables de mesa, apertura/cierre de puestos y pedidos pendientes notifican a los usuarios relacionados sin exponer zonas ajenas a usuarios estÃ¡ndar.
- **SesiÃ³n multirrol:** al cambiar roles activos, el cliente reconecta el canal realtime para que el servidor actualice el contexto de zonas permitidas.
- **Recarga inteligente:** Dashboard, Zonas, Cuentas y CrÃ©ditos refrescan solo cuando el evento recibido es relevante para la vista actual.
- **Compatibilidad:** mantiene el mismo endpoint SSE `/api/realtime/events` y conserva compatibilidad con estaciones existentes.

### v2.2.4.15 fix1 Â· CorrecciÃ³n de responsabilidad y filtro por rol activo

- **Problema corregido:** despuÃ©s de adaptar Realtime, al abrir una mesa podÃ­an quedar responsables residuales de sesiones anteriores y la UI terminaba mostrando â€œResponsable asignadoâ€ incluso para quien abrÃ­a la mesa.
- **CorrecciÃ³n aplicada:** al abrir o reservar una mesa desde estado libre, se limpia cualquier responsabilidad residual y se asigna Ãºnicamente al usuario que realiza la apertura, respetando la regla operativa definida.
- **Admin:** se normaliza la detecciÃ³n de administrador tanto en frontend como backend para evitar bloqueos falsos si el tipo de usuario llega como `admin` o `administrador`.
- **Rol activo:** la lectura de roles activos de sesiÃ³n ahora normaliza arreglos, strings y valores legacy para mantener el filtro de zonas en usuarios bÃ¡sicos/estÃ¡ndar.
- **Realtime:** se conserva el refresco adaptado, pero sin afectar responsabilidad ni permisos operativos.

### v2.2.4.15 fix2 Â· RecuperaciÃ³n de Dashboard dinÃ¡mico y responsabilidad operativa

- **Problema detectado:** despuÃ©s de revisar las fases posteriores a v2.2.4.11, se encontrÃ³ que `server/routes/dashboard.js` habÃ­a quedado sobrescrito por una versiÃ³n anterior durante la integraciÃ³n de servicio 10%. Esa versiÃ³n no devolvÃ­a `puede_operar`, `soy_responsable`, `responsable_asignado` ni el alcance dinÃ¡mico multirrol del Dashboard.
- **Efecto:** al no recibir `puede_operar`, el frontend interpretaba cualquier mesa ocupada/reservada como bloqueada por responsable asignado, incluso para administradores o para el usuario que habÃ­a abierto la mesa. TambiÃ©n se perdÃ­a el filtro real por roles activos en Dashboard.
- **CorrecciÃ³n aplicada:** se recupera el Dashboard dinÃ¡mico/multirrol de v2.2.4.11, se conserva el cÃ¡lculo de servicio 10% de v2.2.4.13 y se mantiene la responsabilidad compartida.
- **Admin:** Dashboard vuelve a permitir operaciÃ³n global a administradores.
- **Usuario estÃ¡ndar:** Dashboard vuelve a filtrar por zonas de sus roles activos y solo permite operar mesas donde estÃ¡ asignado como responsable.
- **Servicio:** los montos activos y pagados siguen usando `total_con_servicio` cuando aplica.
- **Zonas:** se agrega una defensa visual para que el responsable real o admin no quede bloqueado si una respuesta anterior no trae `puede_operar` completo.
- **Alcance:** correcciÃ³n de regresiÃ³n en Dashboard y defensa visual en Zonas; no cambia base de datos ni reglas de Realtime.

### v2.2.4.16 Â· Limpieza final y cierre de estabilidad v2.2.4

- **Objetivo:** cerrar la reestructuraciÃ³n de zonas dinÃ¡micas, roles de trabajo, responsabilidad compartida, sesiÃ³n multirrol, Dashboard/Zonas dinÃ¡micos, restricciones backend, servicio 10% y Realtime adaptado.
- **Cache/PWA:** se sincronizÃ³ el versionado de `index.html` y `public/service-worker.js` en `v2.2.4.16-cierre-estabilidad` para evitar mezclas de assets viejos despuÃ©s de los fixes de servicio 10% y Realtime.
- **Service Worker:** se limpiÃ³ la lista de precachÃ© para eliminar duplicados y referencias a versiones intermedias, conservando los fallbacks defensivos que siempre devuelven una `Response` vÃ¡lida.
- **VersiÃ³n visible:** la app mantiene `APP_VERSION = 2.0` como versiÃ³n visible para usuarios; la lÃ­nea interna de estabilidad queda documentada como `2.2.4.16`.
- **DocumentaciÃ³n:** se agregÃ³ `docs/cierre-v2.2.4.16-estabilidad.md` con el resumen tÃ©cnico, checklist de verificaciÃ³n y criterios de cierre.
- **Alcance:** no cambia reglas de negocio, base de datos, endpoints ni UI funcional; es una fase de estabilizaciÃ³n, limpieza de cachÃ© y documentaciÃ³n de cierre.

Archivos modificados en esta subfase:

- `README.md`
- `docs/cierre-v2.2.4.16-estabilidad.md`
- `server/config/appInfo.js`
- `public/index.html`
- `public/service-worker.js`

### v2.2.4.17 Â· Dashboard PC modo pantalla completa operativa

- **Objetivo:** reducir ruido visual en el Dashboard de PC y dar protagonismo al control de zonas como centro operativo principal.
- **Header:** se agrega el botÃ³n **Pantalla completa** en el header principal. En modo activo el mismo botÃ³n permite salir del modo pantalla completa operativa.
- **Alcance PC:** el modo oculta el sidebar, conserva el header principal y usa todo el ancho disponible para el Dashboard.
- **Layout operativo:** la primera fila muestra compactos `Vista actual`, `Cuentas pendientes` y `Ventas del dÃ­a`; la segunda fila muestra los filtros dinÃ¡micos de zonas; debajo queda el panel **Control por zona** ocupando el Ã¡rea principal.
- **Limpieza visual:** en modo pantalla completa se ocultan el saludo contextual, el texto descriptivo del panel, el badge de estado operativo, crÃ©ditos abiertos y actividad reciente.
- **MÃ³vil:** no cambia la navegaciÃ³n mÃ³vil dinÃ¡mica ni la operaciÃ³n ya estabilizada.
- **Sin cambios de negocio:** no modifica backend, permisos, roles, responsabilidad compartida, servicio 10% ni reglas operativas.

### v2.2.4.17 fix1 Â· CompactaciÃ³n visual del modo pantalla completa en Dashboard PC

- **Problema detectado:** en modo pantalla completa de PC, la primera fila del Dashboard ocupaba demasiada altura y la fila de filtros de zonas quedaba parcialmente recortada.
- **CorrecciÃ³n aplicada:** la fila superior ahora muestra la informaciÃ³n en una sola lÃ­nea por card, con menor alto, iconos mÃ¡s compactos y badges reducidos.
- **Filtros de zonas:** la segunda fila queda visible y compacta, manteniendo la operaciÃ³n dinÃ¡mica por zonas.
- **Alcance:** ajuste visual exclusivo para PC en modo pantalla completa; no cambia backend, permisos, roles, responsabilidad compartida ni servicio 10%.

### v2.2.5M.2 Â· NormalizaciÃ³n backend de productos operativos

- **Objetivo:** preparar MenÃº como fuente backend confiable para Cuentas / Orders antes de migrar la lÃ³gica de productos en `orders.js`.
- **Endpoint agregado:** `GET /api/menu/operational-products`.
- **Contrato:** el endpoint entrega productos listos para operaciÃ³n con categorÃ­a, subcategorÃ­a, imagen, cocina/comanda, precio base, precio operativo, presentaciones y resumen de validez.
- **Precios:** productos sin presentaciÃ³n usan `productos.precio`; productos con presentaciÃ³n usan `presentaciones_producto.precio` por cada presentaciÃ³n vÃ¡lida.
- **Cocina:** `es_cocina` se normaliza tambiÃ©n como `requiere_comanda` para que Cuentas no tenga que inferirlo.
- **DiagnÃ³stico:** el endpoint puede incluir productos invÃ¡lidos con `?include_invalid=1`, mostrando `bloqueos_operativos`.
- **Alcance:** no cambia UI, no cambia Cuentas todavÃ­a, no cambia base de datos y no modifica el flujo operativo actual.

Archivos modificados en esta subfase:

- `README.md`
- `docs/avance-v2.2.5M.2-productos-operativos.md`
- `server/routes/menu.js`


### v2.2.5M.3 Â· NormalizaciÃ³n de presentaciones y precios

- **Objetivo:** dejar claro dÃ³nde vive el precio operativo de un producto antes de continuar con la normalizaciÃ³n de Cuentas / Orders.
- **Producto sin presentaciÃ³n:** usa `productos.precio` como precio operativo y debe ser mayor a cero.
- **Producto con presentaciÃ³n:** usa exclusivamente `presentaciones_producto.precio`; `productos.precio` queda en `0` para evitar ambigÃ¼edad.
- **Validaciones backend:** al crear o editar productos con presentaciones, el backend valida que las presentaciones existan, estÃ©n activas, no estÃ©n duplicadas y tengan precio mayor a cero.
- **VÃ­nculos seguros:** se centraliza la lÃ³gica de crear/reactivar/desactivar vÃ­nculos entre producto y presentaciÃ³n.
- **Endpoint operativo:** `GET /api/menu/operational-products` actualiza su contrato a `v2.2.5M.3` y distingue entre presentaciones configuradas, presentaciones operativas y diagnÃ³stico de presentaciones invÃ¡lidas.
- **Alcance:** no cambia UI, no cambia Cuentas, no cambia base de datos y no altera el flujo operativo actual.

Archivos modificados en esta subfase:

- `README.md`
- `docs/avance-v2.2.5M.3-presentaciones-precios.md`
- `server/routes/menu.js`

### v2.2.5M.4 Â· Estado activo/inactivo de productos, categorÃ­as y presentaciones

- Se normaliza MenÃº para ocultar elementos operativos sin borrarlos.
- Se agrega soporte compatible para `categorias.activa` y `productos.activo`.
- Productos, categorÃ­as, subcategorÃ­as y presentaciones pueden activarse/desactivarse desde MenÃº.
- Los elementos inactivos no aparecen en el flujo operativo ni en `GET /api/menu/operational-products` por defecto.
- Los elementos histÃ³ricos no se eliminan para proteger cuentas, pagos y reportes.
- El contrato de productos operativos avanza a `v2.2.5M.4`.
- Documento tÃ©cnico: `docs/avance-v2.2.5M.4-estados-activos-menu.md`.


### v2.2.5M.5 Â· ProtecciÃ³n backend administrativa del mÃ³dulo MenÃº

- **Objetivo:** separar la operaciÃ³n diaria del local de la administraciÃ³n del catÃ¡logo, precios y estructura del MenÃº.
- **Regla de seguridad:** usuarios estÃ¡ndar/bÃ¡sicos pueden consultar el menÃº operativo, pero no pueden crear, editar, cambiar precios, activar/desactivar ni eliminar/desactivar productos, categorÃ­as, subcategorÃ­as o presentaciones.
- **ProtecciÃ³n backend:** `server/routes/menu.js` incorpora `requireMenuAdmin` y lo aplica a todas las rutas mutantes de MenÃº.
- **Consultas operativas:** `GET /api/menu/products`, `GET /api/menu/categories`, `GET /api/menu/presentaciones-globales`, `GET /api/menu/products/:id/presentaciones`, `GET /api/menu/completo` y `GET /api/menu/operational-products` siguen disponibles para usuarios autenticados.
- **Datos inactivos/diagnÃ³stico:** usuarios no administradores no pueden forzar `include_inactive`, `include_invalid` ni diagnÃ³sticos administrativos mediante query string.
- **UI:** `public/js/components/menu.js` muestra MenÃº en modo consulta para usuarios estÃ¡ndar, oculta acciones administrativas y evita abrir acciones mutantes desde consola de UI.
- **Cache/PWA:** `index.html` y `service-worker.js` avanzan a `v2.2.5M.5-menu-admin-protection` para evitar mezcla de assets antiguos.
- **Alcance:** no cambia Cuentas / Orders todavÃ­a; no cambia base de datos; no cambia la versiÃ³n visible 2.0.

Archivos modificados en esta subfase:

- `README.md`
- `docs/avance-v2.2.5M.5-proteccion-backend-menu.md`
- `server/routes/menu.js`
- `public/js/components/menu.js`
- `public/index.html`
- `public/service-worker.js`

### v2.2.5M.6 Â· Tipos/Grupos de presentaciÃ³n

- **Objetivo:** reemplazar la lista global plana de presentaciones por una lÃ³gica contextual administrada desde MenÃº.
- **Nuevo modelo:** se agrega `tipos_presentacion` como capa intermedia entre categorÃ­a/subcategorÃ­a y presentaciones.
- **Flujo administrativo:** el administrador crea primero un tipo/grupo ligado a una categorÃ­a y opcionalmente a una subcategorÃ­a; luego crea presentaciones dentro de ese grupo.
- **CreaciÃ³n de productos:** al activar â€œÂ¿Tiene presentaciones?â€, el producto exige seleccionar un tipo/grupo y solo muestra las presentaciones asociadas a ese grupo.
- **Productos sin subcategorÃ­a:** pueden usar grupos ligados Ãºnicamente a la categorÃ­a.
- **Productos con subcategorÃ­a:** pueden usar grupos de la categorÃ­a o grupos especÃ­ficos de su subcategorÃ­a.
- **ValidaciÃ³n backend:** productos con presentaciÃ³n validan que el grupo exista, estÃ© activo, pertenezca al contexto del producto y que las presentaciones seleccionadas pertenezcan al grupo.
- **Compatibilidad:** Cuentas / Orders no se migra todavÃ­a; `GET /api/menu/products/:id/presentaciones` sigue disponible y conserva el contrato para el modal operativo, pero ahora puede devolver el contexto del grupo.
- **Base de datos:** se agrega `productos.tipo_presentacion_id`, `presentaciones.tipo_presentacion_id` y se migra `presentaciones` para permitir nombres repetidos en distintos grupos.
- **Cache/PWA:** `index.html` y `service-worker.js` avanzan a `v2.2.5M.6-presentation-types`.
- **Alcance:** no moderniza todavÃ­a todos los modales de MenÃº; esa normalizaciÃ³n visual queda para `v2.2.5M.7`.

Archivos modificados en esta subfase:

- `README.md`
- `docs/avance-v2.2.5M.6-tipos-grupos-presentacion.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `server/db/database.js`
- `server/routes/menu.js`
- `public/js/components/menu.js`
- `public/index.html`
- `public/service-worker.js`
