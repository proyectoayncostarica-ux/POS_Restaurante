# MundiPOS

MundiPOS es un sistema POS web local para restaurante/bar. El backend corre con Node.js + Express y usa SQLite como base de datos local. La app está pensada para operar primero en PC/red local y evolucionar luego hacia PWA, móvil con Capacitor o sincronización cloud si el negocio lo requiere.

## Identidad y versión actual

- **Nombre oficial de la app:** MundiPOS
- **Versión visible/funcional de la app:** 2.0
- **Estado de producto:** versión funcional operativa en proceso de estabilización
- **Línea de trabajo actual:** v2.2.4 · Zonas dinámicas, roles de trabajo y permisos

La versión visible para usuarios, configuración pública y metadata base de la app debe mantenerse como **2.0** hasta que se decida publicar una nueva versión funcional mayor. Las líneas internas **v2.1** y **v2.2** no representan todavía una versión visible para usuarios finales; representan etapas trazables de estabilización.

## Control de versionado del proyecto

Este proyecto se trabajará con versionado trazable por etapa, fase y fix.

### Etapas

| Etapa | Nombre | Descripción |
|---|---|---|
| v1 | Prototipo | Primera versión experimental del POS. |
| v2.0 | Operativa | Versión funcional con módulos, permisos y operatividad base. |
| v2.1 | Estabilidad | Etapa cerrada: estabilidad visual, navegación, PWA y base técnica. |
| v2.2 | Estabilización de Dashboard | Etapa actual: consolidar el Dashboard como panel operativo real para restaurante/bar. |

### Fases de estabilidad

Durante las etapas de estabilidad se usará el formato:

```text
v2.x.x
```

Ejemplos:

```text
v2.1.5 Preparación PWA para PC y móvil
v2.2.1 Estabilización base del Dashboard
v2.2.2 Dashboard operativo por zonas
v2.2.3 Indicadores y acciones rápidas
v2.2.4.0 Roadmap de Zonas dinámicas, roles de trabajo y permisos
```

### Fixes derivados

Si una fase introduce o revela un bug derivado, se documentará como fix:

```text
v2.1.1 fix1
v2.1.1 fix2
v2.1.2 fix1
```

Cada fix debe indicar:

```text
- Qué bug corrige.
- Qué archivo(s) toca.
- Qué flujo debe probarse.
- Qué riesgo queda pendiente, si existe.
```

## Documentación técnica de arquitectura

La fase **v2.2.4** cuenta con un roadmap técnico separado para guiar la transición hacia zonas dinámicas, puestos dinámicos, roles de trabajo, permisos por acción, sesión operativa activa y servicio 10% configurable por zona/puesto.

Documentos canónicos de esta arquitectura:

```text
docs/roadmap-v2.2.4-zonas-roles-permisos.md
docs/auditoria-v2.2.4.1-mapa-impacto.md
```

El roadmap define el orden seguro de implementación. La auditoría técnica y mapa de impacto identifica dónde vive la lógica actual y qué archivos/módulos se verán afectados antes de escribir código funcional.

Estos documentos deben revisarse antes de implementar cualquier cambio funcional relacionado con `Zonas`, `Usuarios`, `Dashboard`, `Pedidos`, `Cuentas`, `Header`, permisos, roles de trabajo o servicio 10%.

Regla principal de implementación para v2.2.4:

```text
No se continúa con la siguiente subfase hasta que la subfase actual esté comprobada como funcional, documentada en README y subida mediante commit/push seguro.
```

## Registro de cambios canónico

### v2.2.4.1 · Auditoría técnica y mapa de impacto

- **Objetivo:** estudiar el código actual antes de implementar la arquitectura de zonas dinámicas, roles de trabajo, permisos por acción, sesión operativa activa y servicio 10% configurable.
- **Alcance:** esta subfase es documental y de auditoría; no modifica lógica funcional, base de datos, permisos reales, Dashboard, Zonas, Usuarios, Pedidos ni Cuentas.
- **Mapa de impacto:** se identifican los módulos y archivos donde viven actualmente login, usuarios, zonas rígidas, mesas/bancos, pedidos, cuentas, Dashboard, header, subnavegación móvil, realtime y PWA.
- **Hallazgos principales:** la app todavía depende de `salon`, `bar`, `bar-mesa` y `bar-banco`; la tabla `mesas` funciona en la práctica como `puestos`; no existen tablas reales de zonas, tipos de puesto, roles de trabajo ni sesión operativa activa.
- **Riesgos documentados:** no se debe renombrar `mesas` de golpe, no se deben activar restricciones por zona antes de tener sesión operativa, no se deben crear roles de trabajo con zonas inexistentes y no se debe mover el servicio 10% sin persistir la regla en el pedido.
- **Recomendación técnica:** iniciar la siguiente subfase funcional con `v2.2.4.2 · Bootstrap de administrador inicial`, antes de rediseñar Zonas o activar restricciones operativas.
- **Documento creado:** `docs/auditoria-v2.2.4.1-mapa-impacto.md`.
- **Validación realizada:** revisión estática y `node --check` sobre backend/frontend principales relacionados con auth, usuarios, zonas, pedidos, Dashboard, realtime y service worker.
- **Archivos modificados:** `README.md` y `docs/auditoria-v2.2.4.1-mapa-impacto.md`.
- **Siguiente subfase:** `v2.2.4.2 · Bootstrap de administrador inicial`.

### v2.2.4.0 · Roadmap de Zonas dinámicas, roles de trabajo y permisos

- **Objetivo:** dejar documentado el camino seguro para convertir `Zonas` en una arquitectura dinámica sin romper la operación actual de Dashboard, Zonas, Pedidos, Cuentas, Usuarios, Header y sincronización PC/móvil.
- **Contexto:** se define que las zonas ya no deben ser valores fijos como `Salón`, `Bar` y `Barra`; deben ser locaciones configurables del local. Los puestos tampoco deben limitarse a mesa/banco, sino evolucionar a tipos dinámicos como mesa, banco, sillón, cabina o mesa alta.
- **Roles:** se separan dos conceptos: `rol de sistema` (`Admin` / `Estándar`) y `rol de trabajo` (`Bartender`, `Salonero`, `Terraza`, `Apoyo`, etc.). El rol de sistema controla permisos administrativos; el rol de trabajo define las zonas visibles y operables durante la sesión activa.
- **Usuarios y zonas:** se documenta que no se deben crear usuarios estándar operativos sin zonas y roles de trabajo válidos. Los roles de trabajo deben seleccionar zonas reales existentes, no escribir nombres de zonas como texto libre.
- **Registro inicial:** se define la necesidad de un flujo de bootstrap donde, si no existe ningún administrador, la app muestre registro inicial en lugar de login normal. El usuario demo debe ser configurable para desarrollo/producción.
- **Servicio 10%:** se establece que cada zona puede definir si aplica servicio 10%, y cada puesto puede heredar o sobrescribir esa regla. Al abrir un pedido se deberá guardar si aplica servicio y el porcentaje correspondiente.
- **Regla de seguridad:** no se deben bloquear módulos completos para usuarios estándar; los permisos deben ser por acción y por zona permitida. Un usuario estándar puede no administrar Zonas, pero sí operar puestos asignados.
- **Documento creado:** `docs/roadmap-v2.2.4-zonas-roles-permisos.md`.
- **Alcance:** esta subfase es documental; no modifica lógica funcional, base de datos, login, Dashboard, Zonas ni permisos reales.
- **Siguiente subfase:** `v2.2.4.1 · Auditoría técnica y mapa de impacto`.
- **Archivos modificados:** `README.md` y `docs/roadmap-v2.2.4-zonas-roles-permisos.md`.
- **Prueba recomendada:** confirmar que ambos documentos existen, que el README referencia el roadmap y que no hay cambios funcionales pendientes asociados a esta subfase.

### v2.2.3 fix1 · Liberación de mesa/banco desde Nuevo pedido

- **Problema detectado:** en el modal `Nuevo Pedido`, cuando una mesa/banco ocupada no tenía pedido activo, el botón `Liberar` no ejecutaba el cierre si el módulo `Zonas` todavía no había cargado su propia lista interna de mesas/bancos.
- **Causa:** `Tables.cerrarMesa()` dependía de `Tables.data`; al abrir el flujo desde `Pedidos`, esa colección podía estar vacía aunque `Orders.tables` sí tuviera la mesa/banco correcta. Por eso el botón parecía no funcionar hasta abrir primero el modal de zona.
- **Corrección aplicada:** el cierre operativo ahora busca la mesa/banco en `Tables.data`, luego en `Orders.tables` y, si aún no existe, consulta `/api/tables` antes de mostrar la confirmación.
- **Nuevo flujo:** el botón `Liberar` del modal `Nuevo Pedido` usa una acción dedicada que reutiliza el modal premium de confirmación y refresca `Pedidos`, `Zonas` y `Dashboard` cuando la liberación termina correctamente.
- **Compatibilidad:** no cambia la lógica del backend ni permite cerrar mesas/bancos con pedidos pendientes; conserva la validación existente del endpoint `/api/tables/:id/close`.
- **Cache/PWA:** se actualizó la versión del service worker para forzar la carga de los cambios en móvil/PWA.
- **Archivos modificados:** `public/js/components/orders.js`, `public/js/components/tables.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** abrir una mesa/banco, entrar al módulo `Pedidos`, abrir `Nuevo Pedido` para esa zona sin agregar productos y tocar `Liberar`; debe abrir el modal de confirmación y liberar la zona sin necesidad de visitar primero el módulo `Zonas`.

### v2.2.3 · Modales operativos premium: Abrir zona y Confirmar cierre

- **Objetivo:** profesionalizar los modales operativos de `Abrir Zona` y `Confirmar Cierre de Mesa/Banco` para que mantengan la identidad premium de MundiPOS sin alterar la lógica de apertura, reserva o cierre.
- **Abrir zona:** el modal ahora incluye encabezado visual compacto con icono, zona, tipo y capacidad; los campos se muestran con menor separación en PC para que el footer quede visible dentro del viewport sin depender del scroll.
- **Confirmar cierre:** el modal de cierre ahora usa una tarjeta de confirmación con resumen de zona, número y cliente, facilitando la validación visual antes de liberar la mesa/banco.
- **PC:** se reducen paddings, alturas de campos y espacios verticales únicamente para estos modales operativos, evitando que los botones del footer queden fuera de vista en pantallas estándar.
- **Móvil:** se conserva el flujo actual, pero con aspecto más moderno: tarjeta premium, mejor jerarquía, iconografía, bordes suaves, fondo degradado y botones cómodos para tap.
- **Compatibilidad:** `Utils.confirm` acepta opciones opcionales de presentación sin romper las confirmaciones existentes.
- **Cache/PWA:** se actualizó la versión de `style.css` y del service worker para forzar la carga de los estilos nuevos en móvil.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/js/components/tables.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** desde PC abrir una mesa/banco y confirmar que el footer sea visible sin scroll; luego probar en móvil que el modal mantenga el flujo anterior pero con diseño premium. Cerrar una mesa/banco y confirmar que el modal muestre el resumen operativo antes de confirmar.

### v2.2.2 fix3 · Corrección de ventas y cuentas pagadas del día

- **Problema detectado:** `Ventas del día` y `Cuentas pagadas del día` podían mostrarse en cero aunque existieran pagos reales, porque el Dashboard filtraba usando la fecha original del pedido (`pedidos.fecha`) en lugar de la fecha real del pago (`pagos.fecha`).
- **Corrección aplicada:** el Dashboard ahora calcula ventas, cuentas pagadas recientes y detalle de ventas usando `pagos.fecha`; así una cuenta abierta antes pero pagada hoy se registra correctamente en la operación del día.
- **Fecha operativa:** se usa el día local de Costa Rica para evitar desfases por UTC cuando el servidor guarda fechas en formato ISO.
- **Ventas del día:** el total de ventas de contado/tarjeta ahora suma `pagos.monto`, que representa el monto realmente cobrado, en lugar de depender del total base del pedido.
- **Cuentas pagadas del día:** la lista de actividad reciente se ordena por la fecha real de pago y muestra las últimas cuentas pagadas dentro del día operativo.
- **Detalle de ventas:** el modal de `Ventas del día` también usa la fecha y monto del pago real.
- **Alcance:** se modifica únicamente la lógica del backend del Dashboard; no cambia la base de datos ni la presentación visual de las cards.
- **Archivos modificados:** `server/routes/dashboard.js` y `README.md`.
- **Prueba recomendada:** pagar una cuenta desde PC o móvil, volver al Dashboard y confirmar que `Ventas del día`, `Cuentas pagadas del día` y el modal de detalle reflejen el pago sin esperar al siguiente día ni depender de la fecha de apertura del pedido.


### v2.2.2 fix2 · Mayor visibilidad de mesa/banco en cards ocupadas

- **Objetivo del fix:** mejorar la lectura operativa de mesas/bancos ocupados para que el usuario identifique rápidamente el cliente y el número de ubicación sin perder el estado de la card.
- **Jerarquía ocupada:** el nombre del cliente se mantiene como título principal. El número de mesa/banco pasa al espacio del badge de estado con fondo negro, borde rojo, texto blanco y mayúscula (`MESA 2` / `BANCO 1`).
- **Estado operativo:** el texto `OCUPADA` pasa al espacio del detalle donde antes estaba el número de mesa/banco; usa badge transparente, borde rojo y texto negro en mayúscula.
- **Monto:** el monto consumido aumenta de tamaño para ganar protagonismo sin romper la simetría de la card en PC ni móvil.
- **Alcance:** solo se modifica la presentación de cards ocupadas en Dashboard. Las cards libres y reservadas mantienen la dinámica definida en `v2.2.2`.
- **Cache/PWA:** se actualizó la versión de `style.css` y del service worker para forzar la carga del ajuste en móvil.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** abrir Dashboard con una mesa ocupada en PC y móvil; confirmar que el título siga siendo el cliente, que el badge negro muestre `MESA/BANCO #`, que `OCUPADA` aparezca abajo como badge transparente y que el monto tenga más protagonismo.

### v2.2.2 fix1 · Sincronización operativa en tiempo real entre PC y móvil

- **Objetivo del fix:** corregir que los cambios realizados desde una estación/dispositivo no se reflejaran inmediatamente en las demás vistas abiertas, reduciendo el riesgo de operar dos veces sobre la misma mesa/banco.
- **Sincronización:** se agrega un canal Server-Sent Events en `/api/realtime/events` para avisar a los clientes activos cuando ocurre una mutación operativa en zonas, pedidos, cuentas o créditos.
- **Frontend:** cada cliente genera un identificador local y lo envía en las peticiones; al recibir un evento operativo, la vista activa se refresca automáticamente. El Dashboard actualiza mesas/bancos, métricas y cuentas pagadas sin esperar al intervalo normal.
- **Protección adicional:** al crear un pedido se valida si la mesa/banco ya tiene una cuenta pendiente; si existe, se responde con conflicto `409` para evitar doble escritura sobre la misma zona.
- **Compatibilidad PWA:** el service worker mantiene `/api/*` como `network-only`, por lo que el canal en tiempo real no se sirve desde caché. Se actualizó la versión del service worker para forzar refresco.
- **Archivos modificados:** `server/app.js`, `server/routes/orders.js`, `server/utils/realtime.js`, `public/js/main.js`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** abrir MundiPOS en PC y móvil con la misma red; ocupar/liberar/reservar una mesa desde un dispositivo y confirmar que el otro actualiza el Dashboard sin recargar manualmente. Luego intentar crear dos pedidos simultáneos para la misma mesa y confirmar que el segundo intento se bloquea.
- **Pendientes o riesgos:** si el navegador móvil suspende la pestaña/PWA en segundo plano, la actualización llegará al volver al primer plano o con el autorefresco del Dashboard.

### v2.2.2 · Cards de mesas

- **Objetivo:** ajustar la jerarquía visual de las cards de mesas/bancos para que el dato principal cambie según el estado operativo sin alterar el comportamiento actual de apertura, reserva o pedido.
- **Libre:** se mantiene la dinámica actual: zona/tipo, número de mesa/banco, estado libre y capacidad.
- **Reservada:** el título principal de la card ahora muestra directamente el nombre del cliente, sin el prefijo `Cliente:`; el número de mesa/banco se traslada al detalle como badge transparente, en mayúscula, negrita y con borde anaranjado coherente con el estado reservado. Hora y personas se mantienen igual.
- **Ocupada:** el título principal de la card ahora muestra directamente el nombre del cliente, sin el prefijo `Cliente:`; el número de mesa/banco se traslada al detalle como badge transparente, en mayúscula, negrita y con borde rojo coherente con el estado ocupado.
- **Monto:** el monto consumido en cards ocupadas aumenta ligeramente de tamaño, manteniendo simetría en PC y móvil.
- **Seguridad visual:** si una mesa/banco ocupada o reservada no tiene cliente registrado, el título usa el nombre de la zona (`Mesa 2`, `Banco 1`) como respaldo para evitar cards sin encabezado.
- **Cache/PWA:** se actualizó la versión de `style.css` y del service worker para forzar la carga de la nueva jerarquía visual en móvil.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** validar en Dashboard una mesa libre, una reservada y una ocupada en PC y móvil; confirmar que libre no cambia, que reservada/ocupada muestran cliente como título, que el badge `MESA/BANCO #` respeta el color del estado y que el monto no rompe la altura de la card.

### v2.2.1 fix6 · Acciones del Dashboard, header móvil y cuentas pagadas

- **Objetivo del fix:** corregir las acciones rápidas del Dashboard, ajustar nuevamente el header móvil y simplificar el Dashboard eliminando tarjetas redundantes.
- **Navegación corregida:** el badge `Cuentas pendientes` ahora dirige correctamente al módulo `Cuentas` y la card `Créditos abiertos` dirige al módulo `Créditos`.
- **Header móvil:** se reincorpora el día y se muestran segundos; la fecha queda arriba y el reloj abajo, centrados verticalmente para aprovechar el espacio disponible.
- **Cierre diario:** se crea el botón `Cierre diario` en el header. En PC muestra icono y texto; en móvil queda solo como icono entre el usuario y el botón de cierre de sesión. Por ahora no ejecuta lógica funcional.
- **Dashboard simplificado:** se eliminan las tarjetas redundantes de `Cuentas`, `Ventas` y `Zonas` para mantener protagonismo en mesas/bancos, sticky operativo, créditos abiertos y actividad reciente.
- **Cuentas pagadas del día:** se reemplaza la tabla simple por cards compactas con mejor jerarquía visual, monto destacado y acceso directo al detalle de la cuenta.
- **Cache/PWA:** se actualizó la versión de `style.css` y del service worker para forzar estilos nuevos en móvil.
- **Archivos modificados:** `server/routes/dashboard.js`, `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** en móvil validar header con día/fecha/hora con segundos, tocar `Cuentas pendientes`, tocar `Créditos abiertos`, revisar que ya no aparezcan las tarjetas redundantes y confirmar que las cuentas pagadas se vean como cards.

### v2.2.1 fix5 · Header móvil con usuario visible y subheader Dashboard no fijo en PC

- **Objetivo del fix:** ajustar únicamente el comportamiento solicitado para móvil y PC sin tocar la lógica operativa del Dashboard.
- **Móvil:** el header principal deja de mostrar el día de la semana y conserva solo fecha y hora en formato compacto para liberar espacio.
- **Usuario en móvil:** se vuelve visible el bloque de usuario junto a la fecha; arriba muestra `Admin` para administradores o `Estándar` para usuarios básicos, y abajo muestra el nombre del usuario centrado.
- **PC:** el subheader operativo del Dashboard deja de ser sticky y vuelve a desplazarse con el contenido al hacer scroll.
- **Cache/PWA:** se actualizó la versión de `style.css` y del service worker para evitar que móvil conserve estilos anteriores.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** en móvil confirmar que el header muestra fecha/hora + tipo/nombre de usuario sin el día; en PC hacer scroll en Dashboard y confirmar que el subheader no queda fijo.

### v2.2.1 fix4 · Sticky operativo y filtros por estado en Dashboard

- **Objetivo del fix:** ajustar el sticky operativo del Dashboard para que `Vista actual`, `Cuentas pendientes` y `Ventas del día` tengan más espacio, especialmente en móvil, y convertir los badges de estado en filtros rápidos.
- **Sticky:** se retiró `Créditos abiertos` del subheader fijo y se trasladó a una card operativa debajo del bloque de mesas/bancos, evitando que el badge de `Vista actual` se corte en PC y móvil.
- **Móvil:** el sticky queda pegado al header, usa tres badges más altos y vuelve a mostrar los títulos `Vista actual`, `Cuentas pendientes` y `Ventas del día` dentro de cada badge.
- **PC:** el texto secundario de `Vista actual` queda en blanco para mantener contraste sobre el degradado oscuro.
- **Filtros por estado:** los badges `Libres`, `Ocupadas` y `Reservadas` ahora son clicables y filtran las tarjetas visibles según el estado dentro de la zona activa.
- **Reset inteligente:** si se cambia de zona y el filtro de estado activo no tiene resultados en la nueva zona, el Dashboard limpia automáticamente ese filtro para no dejar la pantalla vacía.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** en Dashboard, seleccionar Salón y tocar `Ocupadas` para ver solo las mesas ocupadas; cambiar a Bar o Barra y confirmar que el filtro se conserva solo si hay coincidencias, o se reinicia si no existen.

### v2.2.1 fix1 · Corrección visual operativa del Dashboard móvil y prioridad de zonas

- **Objetivo del fix:** corregir la primera estabilización del Dashboard para que respete la función real de la pantalla: las zonas, mesas y bancos deben ser el elemento protagonista tanto en PC como en móvil.
- **Problema detectado:** las tarjetas grandes de resumen (`Vista actual`, `Cuentas pendientes`, `Ventas del día` y `Créditos abiertos`) ocupaban demasiado espacio antes del control de zonas, especialmente en móvil, y algunos estilos nuevos podían competir con los bordes de estado de mesas/bancos.
- **Cambios visuales:** esos indicadores se transformaron en un subheader compacto y fijo dentro del Dashboard, con estilo de badges operativos, para que no desplacen las cards de zonas.
- **Prioridad operativa:** las cards de Salón, Bar y Barra quedan como primer bloque funcional visible después del subheader compacto; el encabezado descriptivo se oculta en móvil para reducir ruido.
- **Estados restaurados:** los bordes de las cards del Dashboard vuelven a depender del estado real de la mesa/banco: verde para libre, rojo para ocupada y amarillo/naranja para reservada; la zona se identifica mediante badge, no mediante el borde principal.
- **Móvil:** se agregaron estilos específicos para una vista más compacta y elegante: subheader sticky, cards en dos columnas, métricas internas compactas, jerarquía visual reducida y mejor aprovechamiento del espacio vertical.
- **Archivos modificados:** `public/index.html`, `public/css/style.css` y `README.md`.
- **Pruebas recomendadas:** revisar Dashboard en PC y celular, validar que los filtros Todos/Salón/Bar/Barra sigan funcionando, confirmar que las cards de mesas/bancos mantengan borde por estado y que al hacer scroll el subheader de indicadores permanezca visible sin tapar la barra inferior móvil.
- **Resultado esperado:** Dashboard más operativo, más móvil-first y coherente con el uso real del POS durante servicio, sin cambios backend ni persistencia SQLite.

### v2.2.1 fix3 · Micro ajuste móvil del subheader sticky y corrección de métricas del Dashboard

- **Objetivo del fix:** ajustar el Dashboard móvil para que el subheader operativo quede pegado visualmente al header principal y corregir los contadores superiores que podían quedarse en cero aunque existieran mesas/bancos activos.
- **Problema visual detectado:** al hacer scroll en móvil quedaba una separación entre el header y el subheader sticky, dejando ver contenido pasar por detrás; además los badges de `Libres`, `Ocupadas`, `Reservadas` y `Consumo activo` se percibían planos.
- **Cambios visuales:** el subheader sticky del Dashboard ahora ocupa el ancho horizontal completo bajo el header móvil, usa fondo sólido y una franja superior de cobertura para evitar transparencias durante el scroll.
- **Badges operativos:** los indicadores de `Libres`, `Ocupadas`, `Reservadas` y `Consumo activo` ahora tienen icono, profundidad, color contextual y estructura compacta para móvil.
- **Corrección de datos:** el frontend recalcula el resumen operativo desde `mesasDetalle` como fuente visible de verdad, evitando que `Vista actual`, libres, ocupadas, reservadas y consumo activo muestren cero cuando sí hay mesas/bancos en pantalla.
- **Backend:** `/api/dashboard` construye `zonasResumen` desde el mismo detalle de mesas/bancos que renderiza el Dashboard y evita duplicar una mesa si existieran varios pedidos pendientes asociados.
- **PWA/cache:** se actualizó la versión de `style.css` y del service worker para que el celular tome el nuevo CSS/JS.
- **Archivos modificados:** `server/routes/dashboard.js`, `public/index.html`, `public/css/style.css`, `public/js/components/dashboard.js`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** abrir una mesa/banco, volver al Dashboard en móvil, confirmar que `Vista actual` y los badges inferiores reflejen los datos reales; luego hacer scroll y validar que el subheader quede pegado al header sin dejar ver contenido por detrás.

### v2.2.1 fix2 · Aplicación real de estilos móviles del Dashboard

- **Objetivo del fix:** corregir que los estilos móviles del Dashboard no se reflejaran en celular después de los cambios PWA/cache y de reglas heredadas de `.mesa-card`.
- **Problema detectado:** el navegador móvil podía conservar `style.css` anterior mediante service worker y, además, reglas antiguas de tarjetas podían ganar prioridad sobre el layout operativo del Dashboard.
- **Cambios aplicados:** se versionó la carga de `style.css`, se subió la versión del service worker, los assets CSS/JS ahora usan estrategia `network-first` y se agregó un bloque móvil final de alta especificidad para el Dashboard.
- **Jerarquía visual recuperada:** las zonas/mesas/bancos quedan como contenido principal; los indicadores de Vista actual, Cuentas pendientes, Ventas del día y Créditos abiertos se mantienen como subheader compacto sticky.
- **Estados visuales conservados:** verde para libre, rojo para ocupada y amarillo/naranja para reservada; la zona Salón/Bar/Barra se muestra como badge y no reemplaza el color del estado.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/service-worker.js` y `README.md`.
- **Prueba recomendada:** abrir en móvil, borrar datos del sitio si aún aparece CSS viejo, entrar a `/POS/`, ir al Dashboard y comprobar que el subheader sea compacto y que las cards de zonas aparezcan en dos columnas con bordes por estado.

### v2.2.1 · Estabilización base del Dashboard operativo

- **Objetivo:** iniciar la etapa v2.2 convirtiendo el Dashboard en un panel operativo real para restaurante/bar: primero zonas/mesas, cuentas activas, ventas del día y estado inmediato de la operación.
- **Función real del Dashboard:** no debe comportarse como un reporte administrativo pesado; debe funcionar como centro de control rápido para ver Salón, Bar y Barra, abrir zonas libres, continuar pedidos en zonas ocupadas y revisar el pulso del día.
- **Backend:** `/api/dashboard` ahora devuelve un resumen operativo por filtro (`todos`, `salon`, `bar-mesa`, `bar-banco`), totales separados de mesas y bancos, consumo activo por zona, ventas calculadas desde pagos y últimas cuentas pagadas con información de zona.
- **Frontend:** se reorganizó el Dashboard con encabezado operativo, tarjetas de comando, panel de control por zona, métricas del filtro activo, estados vacíos/carga/error y actualización de bancos libres/ocupados que antes no se reflejaban.
- **Interacción:** las tarjetas de zona del Dashboard conservan acciones operativas: abrir zona libre, ver reserva, crear pedido si está ocupada sin pedido y agregar productos si tiene pedido activo.
- **Autoactualización:** se evita duplicar intervalos de refresco y el Dashboard vuelve a activar autorefresco al entrar con sesión existente, manteniendo actualización periódica mientras el módulo está activo.
- **Archivos modificados:** `server/routes/dashboard.js`, `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/js/components/dashboard.js` y `README.md`.
- **Pruebas recomendadas:** entrar al Dashboard en PC y móvil, cambiar filtros Todos/Salón/Bar/Barra, abrir una zona libre, crear/agregar productos a un pedido, pagar una cuenta y confirmar que los contadores, consumo activo, ventas y últimas cuentas se actualizan.
- **Resultado esperado:** Dashboard más claro, útil y estable para operación diaria, sin modificar la base de datos ni subir datos locales de prueba.
- **Pendientes v2.2:** refinar indicadores por hora/turno, acciones rápidas adicionales, alertas operativas y posibles datos semilla versionables para demo sin commitear `data/restaurant.db`.

### v2.1.5 · Preparación PWA para PC y móvil

- **Objetivo:** agregar la base técnica necesaria para que MundiPOS pueda instalarse como PWA en PC, tablet y móvil, manteniendo el enfoque local-first del POS.
- **Alcance:** se creó el manifiesto web, service worker, página offline, set completo de iconos instalables y lógica frontend de registro/actualización/instalación.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js`, `server/app.js` y `README.md`.
- **Archivos nuevos:** `public/manifest.webmanifest`, `public/service-worker.js`, `public/offline.html` y los iconos PWA dentro de `public/assets/icons/`.
- **Comportamiento en PC:** el navegador compatible puede ofrecer instalación de MundiPOS como app independiente usando `display: standalone`, con accesos directos hacia Dashboard, Zonas y Cuentas.
- **Comportamiento en móvil:** la app queda preparada para instalación desde navegador compatible, usa iconos dedicados, respeta `theme_color`, safe areas y mantiene la navegación responsive existente.
- **Service worker:** cachea el app shell local bajo `/POS/`, evita cachear rutas `/api/` con sesión/datos operativos, limpia caches antiguos y muestra una página offline cuando el servidor local o la red no están disponibles.
- **Lógica de instalación:** se agregó manejo de `beforeinstallprompt`, botón contextual `Instalar` en el header cuando el navegador lo permite y aviso de actualización cuando hay un nuevo service worker listo.
- **Backend:** `server/app.js` sirve `service-worker.js` y `manifest.webmanifest` con headers explícitos para evitar caché agresivo del navegador.
- **Pruebas realizadas/recomendadas:** validar sintaxis de `public/js/main.js`, `server/app.js` y `public/service-worker.js`; revisar que `/POS/manifest.webmanifest`, `/POS/service-worker.js` y `/POS/offline.html` respondan correctamente; probar instalación PWA en Chrome/Edge de PC y Android.
- **Resultado esperado:** MundiPOS queda instalable como PWA y puede cargar su shell visual desde caché, pero las operaciones reales siguen requiriendo el servidor local y SQLite disponibles.
- **Riesgos o pendientes:** Font Awesome sigue viniendo de CDN y podría no mostrar iconos si no existe caché externa; para una PWA completamente offline conviene migrar iconografía crítica a assets locales en una fase posterior.

### v2.1.5 fix1 · Corrección de instalabilidad PWA y soporte HTTPS local

- **Problema detectado:** la PWA no ofrecía instalación de forma confiable en PC/móvil. Se reforzó la configuración porque Chrome/Edge solo muestran instalación cuando la app cumple manifest + service worker y se sirve desde un origen permitido: HTTPS o localhost/127.0.0.1. En móviles conectados a la IP local de la PC, HTTP no es suficiente.
- **Objetivo del fix:** hacer más robusta la instalabilidad PWA, evitar rutas ambiguas bajo `/POS`, mejorar el registro del service worker, agregar ayuda contextual cuando el navegador no permite instalar y preparar modo HTTPS local opcional.
- **Archivos modificados:** `public/index.html`, `public/manifest.webmanifest`, `public/service-worker.js`, `public/js/main.js`, `public/css/style.css`, `server/app.js`, `.env.example` y `README.md`.
- **Cambios realizados:** se normalizaron rutas absolutas del manifest/assets bajo `/POS/`, se registró el service worker con scope explícito `/POS/`, se agregó header `Service-Worker-Allowed`, se hizo más tolerante el precache del app shell, se redirige `/POS` a `/POS/`, se agregó soporte opcional HTTPS con `HTTPS_ENABLED`, `HTTPS_KEY_PATH` y `HTTPS_CERT_PATH`, y el botón de instalación ahora muestra ayuda si el origen no permite PWA o si el navegador requiere instalación manual.
- **Comportamiento esperado en PC:** usando `http://localhost:3000/POS/` o `http://127.0.0.1:3000/POS/`, Chrome/Edge deben poder registrar el service worker y ofrecer instalación cuando se cumplan los criterios del navegador.
- **Comportamiento esperado en móvil:** si se accede por `http://IP_LOCAL:3000/POS/`, el navegador puede bloquear la instalación por no ser HTTPS. Para instalación real desde móvil por red local debe usarse HTTPS con certificado confiable instalado en el dispositivo o un túnel HTTPS.
- **Pruebas realizadas/recomendadas:** validar sintaxis de `public/js/main.js`, `server/app.js` y `public/service-worker.js`; validar JSON de `public/manifest.webmanifest`; probar en PC con `http://localhost:3000/POS/`; si se prueba desde móvil por IP local, configurar HTTPS confiable antes de esperar instalación PWA.
- **Resultado esperado:** PWA más robusta y clara: instala en contexto permitido, muestra ayuda cuando el navegador bloquea la instalación y deja documentado el requisito de HTTPS para móvil en red local.
- **Riesgos o pendientes:** falta generar/instalar certificados confiables para cada entorno real; si el local no quiere gestionar HTTPS, la alternativa futura será empaquetar con Capacitor/Electron/Tauri o usar un túnel HTTPS.

### v2.1.4 · Estabilización de subnavegación interna por módulo

- **Objetivo:** modernizar la navegación interna de los módulos para diferenciar claramente la navegación principal entre módulos de la subnavegación contextual dentro de cada módulo.
- **Diferencia de navegación:** el sidebar/hamburguesa mantiene la navegación principal entre Dashboard, Zonas, Menú, Cuentas, Créditos, Usuarios y Configuración; la nueva subnavegación controla solo vistas internas del módulo activo.
- **Comportamiento en móvil/tablet:** se agregó una barra inferior fija `mobile-subnav`, visible solo cuando el módulo activo tiene subpáginas internas, con iconos, texto, estado activo claro y padding inferior en el contenido para evitar solapes.
- **Comportamiento en PC/web:** los controles internos se convierten en tabs premium dentro del contenido, sin barra inferior fija, usando la paleta azul profundo/dorado, bordes redondeados, sombras suaves, hover/focus y estado activo claro.
- **Módulos afectados:** Dashboard, Zonas, Menú, Cuentas/Pedidos y Configuración. Créditos y Usuarios no muestran barra inferior porque no tienen subpáginas internas reales.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/js/components/dashboard.js`, `public/js/components/tables.js`, `public/js/components/menu.js`, `public/js/components/orders.js`, `public/js/components/settings.js` y `README.md`.
- **Cambios realizados:** se centralizó la definición de subpáginas en `INTERNAL_SUBNAV`, se agregó `Navigation.selectInternal()`, `renderInternalSubnav()` y sincronización de estados activos, reutilizando las funciones actuales de filtros y `switchView()`.
- **Transiciones implementadas:** se agregó transición corta con clase `internal-switching` para cambios internos y se respeta `prefers-reduced-motion`; la navegación global previa se mantiene sin cambios funcionales.
- **Pruebas realizadas/recomendadas:** validar sintaxis de `main.js` y componentes afectados, revisar `git diff`/`git status` y probar manualmente PC/móvil para confirmar barra inferior, tabs, cambios de subpágina y ausencia de barra en Créditos/Usuarios.
- **Resultado esperado:** navegación interna más cercana a una app profesional, cómoda en móvil y consistente en PC, sin cambiar rutas backend, autenticación, permisos ni lógica operativa.
- **Riesgos o pendientes:** queda pendiente validación visual en navegador/dispositivos físicos para ajustar tamaños de texto, espacios inferiores y comportamiento con formularios largos.

### v2.1.3 · Estabilización visual del sidebar y transiciones globales

- **Objetivo:** modernizar el sidebar, el menú hamburguesa móvil y las transiciones entre módulos para que la app autenticada se sienta más fluida y coherente con el login/header actual.
- **Problema visual/UX detectado:** el sidebar mantenía una apariencia plana, el menú móvil abría/cerraba de forma brusca, los módulos cambiaban de golpe y el footer interno repetía autor/versión ya presentes en el login.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js` y `README.md`.
- **Cambios realizados en sidebar PC:** se aplicó fondo premium con degradado, profundidad, bordes sutiles, mejor espaciado, estados hover/active más claros, iconografía resaltada y microinteracción rápida al seleccionar módulos.
- **Cambios realizados en menú móvil:** se agregó overlay moderno con fade/blur, apertura y cierre por desplazamiento suave, cierre al tocar fuera, cierre al seleccionar módulo y áreas táctiles más cómodas.
- **Cambios realizados en transiciones entre módulos:** `Navigation.showSection()` ahora centraliza una transición de salida/entrada entre secciones, evita estados corruptos con `navigationTransitionId` y respeta `prefers-reduced-motion` con animaciones mínimas.
- **Elementos eliminados del sidebar/footer interno:** se retiró el bloque `Creado by Andrey Acuña` y la versión visible del sidebar, porque esa información quedó centralizada en el login institucional.
- **Pruebas realizadas/recomendadas:** validar sintaxis de `public/js/main.js`, revisar `git diff`/`git status` y probar manualmente sidebar PC, menú móvil, navegación entre Dashboard, Zonas, Menú, Cuentas, Créditos, Usuarios y Configuración.
- **Resultado esperado:** navegación lateral más profesional y compacta, menú móvil fluido, módulos con transición suave y sin cambios en rutas, sesión, permisos ni lógica backend.
- **Riesgos o pendientes:** queda pendiente validación visual en navegador/dispositivo físico para ajustar tiempos o espaciados finos si el uso real en pantallas pequeñas lo requiere.

### v2.1.2 · Estabilización visual del header principal

- **Objetivo:** mejorar la presentación del header autenticado de MundiPOS sin cambiar la lógica funcional de los módulos.
- **Problema visual/técnico detectado:** el header se veía plano, no mostraba logo, ocultaba la fecha/hora en móvil y el reloj se actualizaba con un `setInterval` global sin ciclo explícito de inicio/parada.
- **Archivos modificados:** `public/index.html`, `public/css/style.css`, `public/js/main.js` y `README.md`.
- **Cambios realizados:** se integró el logo oficial de MundiPOS, se reorganizó la jerarquía de marca/restaurante/usuario/reloj/logout y se agregó profundidad visual con fondo, bordes, sombras suaves y mejor espaciado.
- **Integración del logo oficial:** se agregó el archivo `public/assets/brand/mundipos-mark.jpg` y se usa como identidad principal en la tarjeta de login y en el header autenticado.
- **Comportamiento en PC:** el header muestra logo, nombre MundiPOS, nombre del restaurante, usuario, tipo de usuario, fecha/hora completa y botón de cierre con icono + texto.
- **Comportamiento en móvil:** el header queda compacto, muestra menú, solo el logo oficial, fecha/hora compacta en el área de contexto y botón de cierre reducido a icono; se ocultan el texto MundiPOS, el nombre del restaurante y el texto del botón.
- **Revisión del reloj/fecha/hora:** se reemplazó el intervalo global por `startHeaderClock()` y `stopHeaderClock()`, con guard contra timers duplicados, limpieza al volver al login y actualización limitada a los nodos de escritorio/móvil cuando cambia el texto.
- **Archivos modificados por integración del logo:** `public/index.html`, `public/css/style.css`, `public/assets/brand/mundipos-mark.jpg` y `README.md`.
- **Validaciones realizadas por integración del logo:** revisión de rutas/referencias del asset, validación de sintaxis JS y revisión de `git diff`/`git status`.
- **Pruebas visuales:** no se realizaron pruebas en navegador, login ni flujo visual por instrucción expresa del usuario para evitar consumo adicional.
- **Pruebas realizadas/recomendadas:** iniciar sesión, verificar header en Dashboard, cambiar entre módulos, abrir/cerrar menú móvil, cerrar sesión y repetir login/logout validando que el reloj no duplique timers. Revisar en PC y viewport móvil.
- **Resultado esperado:** header profesional, legible y responsive, con fecha/hora siempre visible en app autenticada y sin acumulación de intervalos tras login/logout.
- **Pendientes o riesgos:** queda pendiente validación visual en navegador/dispositivos físicos; conviene revisar el recorte final del logo oficial en pantallas pequeñas y con nombres de restaurante muy largos.

### v2.1.1 fix1 · Corrección de estado del botón de login al cerrar sesión

- **Objetivo:** dejar el formulario de acceso limpio y listo para una nueva autenticación después de cerrar sesión.
- **Problema corregido:** el botón permanecía deshabilitado y mostraba `Preparando panel...` al volver al login porque el estado de carga aplicado durante el ingreso exitoso no se restablecía.
- **Archivos modificados:** `public/js/main.js`, `public/index.html`, `public/css/style.css` y `README.md`.
- **Cambio realizado:** `showLogin()` restablece campos, mensajes, estado visual y contenido del botón. Además, se agregó el bloque institucional inferior del login y su versión se sincroniza con `version_app` mediante `/api/public/branding`.
- **Prueba realizada/recomendada:** iniciar sesión, confirmar la carga del Dashboard, cerrar sesión y verificar que los campos queden vacíos, el botón habilitado con el texto `Iniciar sesión` y sin la clase de carga. Repetir en vista móvil y confirmar el texto institucional con `v2.0`.
- **Resultado esperado:** el usuario puede volver a iniciar sesión inmediatamente y el bloque institucional permanece centrado, legible y fuera de la tarjeta de acceso.
- **Riesgos o pendientes:** validar posteriormente el bloque institucional en dispositivos físicos con pantallas de poca altura; no se modificaron autenticación, sesiones ni persistencia SQLite.

### v2.1.0 · Base de estabilidad inicial

- Se saneó el arranque del proyecto.
- Se retiró `node_modules` del repositorio.
- Se agregó `.gitignore` y `.env.example`.
- Se verificó el arranque con SQLite y sesión.
- Se agregó identidad visual inicial de MundiPOS.
- Se agregó endpoint público seguro para branding: `/api/public/branding`.
- Se normalizó la versión visible/funcional de la app a **2.0**.
- Se creó una referencia central de nombre y versión en `server/config/appInfo.js`.

## Regla obligatoria para futuros cambios

Todo cambio hecho en Codex o manualmente debe actualizar este README cuando altere cualquiera de estos puntos:

```text
- versión, etapa, fase o fix
- módulos funcionales
- flujo operativo
- base de datos o migraciones
- seguridad o permisos
- instalación, arranque o dependencias
- bugs corregidos o pendientes conocidos
```

Antes de cerrar cada fase o fix se debe agregar una entrada al registro de cambios.

## Requisitos

- Node.js 18 o superior
- npm
- SQLite CLI recomendado para auditoría y revisión manual de datos

## Instalación limpia

```bash
npm install
cp .env.example .env
npm start
```

Abrir la app en:

```text
http://localhost:3000/POS
```

Usuario inicial cuando la base está vacía:

```text
Usuario: admin
Contraseña: admin123
```

Cambia esa contraseña desde la sección de usuarios/configuración antes de usar el sistema en producción.

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

`CORS_ORIGINS` puede quedar vacío para uso local. Si se publica la API detrás de un dominio, agregar los orígenes separados por coma.

## Base de datos

La base se guarda por defecto en:

```text
data/restaurant.db
```

El inicializador crea el schema completo si la base no existe. También aplica migraciones básicas sobre bases viejas, incluyendo columnas faltantes y reparación de claves foráneas heredadas.

Antes de hacer cambios grandes o usar una base vieja, crear respaldo:

```bash
cp data/restaurant.db data/backups/restaurant-$(date +%Y%m%d-%H%M%S).db
```

## Estructura principal

```text
server/app.js              # entrada del servidor
server/config/appInfo.js   # nombre oficial, versión visible y línea de estabilidad
server/db/database.js      # conexión, schema y migraciones
server/routes/             # endpoints API
public/index.html          # frontend
public/css/style.css       # estilos globales
public/js/main.js          # utilidades globales y sesión
public/js/components/      # pantallas del POS
public/uploads/            # imágenes subidas
```

## Scripts

```bash
npm start       # iniciar servidor
npm run dev     # iniciar con nodemon
```

En Windows también puedes usar `Inicio_Servidor.bat`. En Linux/macOS puedes usar `Inicio_Servidor.sh` o `start_dev.sh`.

## Flujo de trabajo recomendado

```text
1. Crear o confirmar fase/fix de trabajo.
2. Hacer cambios pequeños y trazables.
3. Probar flujo afectado desde la app.
4. Revisar consola del navegador y terminal del servidor.
5. Revisar datos SQLite si el cambio afecta persistencia.
6. Actualizar este README.
7. Hacer commit con mensaje claro.
```

## Notas de mantenimiento

- No subir `node_modules` al repositorio.
- No subir `.env` ni copias reales de producción.
- No subir archivos temporales de SQLite: `*.db-wal`, `*.db-shm`, `*.db-journal`.
- Mantener `data/backups/` fuera del repositorio si contiene datos reales.
- La app actual es web local; para PC puede empaquetarse después con Electron/Tauri y para móvil conviene evolucionarla primero como PWA/responsive.

## Registro de cambios reciente

### v2.2.4.3 fix2 · Selector de hora móvil para reservas
- Se reemplazó el uso problemático del reloj nativo en móvil dentro del modal **Abrir Zona** por un selector de hora móvil propio, evitando recortes visuales dentro del modal de reserva.
- En PC se mantiene el campo de hora nativo, que ya funcionaba correctamente.
- Se actualizó el versionado de `style.css` y `service-worker.js` para invalidar caché móvil/PWA.

### v2.2.4.3 fix3 · Visibilidad del selector de hora en móvil
- Se corrigió la prioridad CSS que mantenía oculto el selector premium de hora en móvil dentro del modal **Abrir Zona**.
- El control móvil de hora queda forzado al final del stylesheet para no ser sobrescrito por reglas previas.
- En PC se mantiene el campo nativo de hora que ya funcionaba correctamente.
- Se actualizó el versionado de `style.css` y `service-worker.js` para invalidar caché móvil/PWA.


### v2.2.4.5 · Administración de zonas y tipos de puesto

- **Objetivo:** iniciar la administración real de la estructura dinámica del local sin romper la operación actual ni activar aún roles de trabajo, permisos por acción o Dashboard dinámico.
- **Backend:** se agregaron endpoints administrativos para crear/actualizar zonas dinámicas y tipos de puesto: `POST /api/tables/zones`, `PUT /api/tables/zones/:id`, `POST /api/tables/seat-types` y `PUT /api/tables/seat-types/:id`.
- **Restricción temporal:** estos endpoints requieren usuario administrador; los usuarios estándar mantienen la vista operativa sin herramientas de administración estructural.
- **Puestos dinámicos:** el endpoint `POST /api/tables` ahora acepta `zona_id` y `tipo_puesto_id`, manteniendo compatibilidad con `tipo_zona` y `tipo_asiento` legacy.
- **Numeración:** `GET /api/tables/next-numero` ahora soporta numeración dinámica por `zona_id` + `tipo_puesto_id`, conservando compatibilidad con la numeración legacy.
- **Frontend Zonas:** el módulo muestra un panel administrativo para zonas y tipos de puesto, además de un modal dinámico para crear nuevos puestos seleccionando zona/tipo reales.
- **Reglas operativas:** no se permite desactivar una zona con puestos ocupados/reservados ni desactivar un tipo de puesto que aún tenga puestos activos.
- **Compatibilidad:** Salón, Bar, Barra, Mesa y Banco siguen funcionando como antes; las nuevas zonas/tipos personalizados quedan visibles al menos en la vista “Todos” hasta que se active navegación dinámica en fases posteriores.
- **PWA/cache:** se actualizó el versionado de `style.css` y `service-worker.js` para evitar estilos o JS antiguos en móvil.
- **Pendiente:** roles de trabajo, asignación de zonas a usuarios, navegación inferior dinámica y Dashboard dinámico se mantienen para subfases posteriores según roadmap.

### v2.2.4.6 · Roles de trabajo vinculados a zonas existentes

- **Objetivo:** crear la base de roles de trabajo operativos sin permitir asignaciones a zonas inexistentes o inactivas.
- **Backend:** se agregaron las tablas `roles_trabajo` y `rol_trabajo_zonas` para separar el rol operativo del usuario de su rol de sistema.
- **Validación central:** un rol de trabajo solo puede crearse o editarse seleccionando zonas activas existentes en `zonas`; no se aceptan zonas escritas manualmente como texto libre.
- **Endpoints:** se agregaron `GET /api/tables/work-roles`, `POST /api/tables/work-roles` y `PUT /api/tables/work-roles/:id` para administrar roles de trabajo desde el módulo Zonas.
- **Estructura dinámica:** `GET /api/tables/structure` ahora devuelve `roles_trabajo` con sus zonas asociadas, preparando la futura asignación a usuarios.
- **Protección de consistencia:** no se permite desactivar una zona que esté vinculada a roles de trabajo activos.
- **Frontend Zonas:** el panel administrativo ahora incluye la columna Roles de trabajo, con creación/edición mediante selector de zonas reales activas.
- **Restricción temporal:** solo administradores pueden crear o editar roles de trabajo; todavía no se asignan usuarios ni se filtran Dashboard/Zonas por rol activo.
- **Compatibilidad:** la operación actual de abrir/reservar/cerrar puestos no cambia en esta subfase.
- **Pendiente:** asignar roles de trabajo a usuarios, seleccionar rol operativo al iniciar sesión y filtrar Dashboard/Zonas según zonas permitidas queda para subfases posteriores.

### v2.2.4.6 fix1 · Corrección visual del panel administrativo de Zonas

- **Problema detectado:** en móvil, las columnas administrativas de Zonas, Tipos de puesto y Roles de trabajo podían sobreponerse porque una regla posterior restauraba el grid de tres columnas. Además, los botones de acción quedaban visualmente desordenados entre PC y móvil.
- **Corrección aplicada:** el panel administrativo ahora usa una columna en móvil, tarjetas compactas sin desbordes y los botones **Nueva zona**, **Nuevo tipo** y **Nuevo rol** quedan en una sola línea horizontal.
- **PC:** los botones administrativos quedan alineados de forma uniforme y las tres columnas mantienen un layout ordenado.
- **Móvil:** se evita la superposición de columnas, se reduce el tamaño de tarjetas/badges y se mantiene la operación sin cambios.
- **Alcance:** ajuste visual únicamente; no cambia endpoints, base de datos, permisos ni lógica operativa.

### v2.2.4.7 · Usuarios con rol de sistema y roles de trabajo

- Se agrega el vínculo entre usuarios y roles de trabajo mediante la tabla `usuario_roles_trabajo`.
- El rol de sistema sigue usando el campo compatible `usuarios.tipo`:
  - `administrador` para acceso administrativo completo.
  - `basico` como usuario estándar operativo.
- El módulo **Usuarios** ahora permite asignar uno o varios roles de trabajo existentes a cada usuario.
- Los usuarios estándar deben tener al menos un rol de trabajo activo con zonas activas.
- Los administradores pueden existir sin roles de trabajo, manteniendo el bootstrap inicial y la administración general del sistema.
- Los endpoints de usuarios devuelven `roles_trabajo` asociados a cada usuario.
- `POST /api/users` y `PUT /api/users/:id` aceptan `roles_trabajo_ids`.
- Nuevo endpoint administrativo: `GET /api/users/work-roles` para listar roles disponibles para asignación.
- `POST /api/auth/login` y `GET /api/auth/verify` ahora incluyen los roles de trabajo asignados en el usuario autenticado.
- No se activa todavía selección de rol activo al iniciar sesión, filtro operativo por rol, Dashboard dinámico ni restricciones backend por zona. Eso queda para las siguientes subfases.

### v2.2.4.7 fix1 · Footer visible en modal Nuevo Rol de trabajo

- **Problema detectado:** en PC, el modal **Nuevo Rol de trabajo** podía superar el alto visible de la pantalla y dejar fuera del viewport los botones **Cancelar** y **Crear rol**.
- **Corrección aplicada:** los modales de estructura ahora usan layout vertical con alto máximo, cuerpo desplazable y footer fijo dentro del modal.
- **Resultado esperado:** los botones del footer permanecen visibles en PC y móvil, incluso cuando hay varias zonas disponibles para seleccionar.
- **Alcance:** corrección visual únicamente; no cambia base de datos, endpoints, validaciones ni permisos.

### v2.2.4.8 · Sesión operativa activa

- **Objetivo:** preparar la sesión operativa real separando el usuario autenticado del rol de trabajo activo elegido para trabajar en el turno o dispositivo actual.
- **Backend Auth:** `POST /api/auth/login` y `GET /api/auth/verify` ahora devuelven el bloque `sesion_operativa` con estado, modo, rol activo y roles disponibles.
- **Selección de rol:** si un usuario tiene más de un rol de trabajo activo con zonas activas, la app muestra una pantalla intermedia para seleccionar el rol operativo antes de entrar al POS.
- **Auto-selección:** si el usuario tiene un único rol de trabajo activo con zonas activas, ese rol se activa automáticamente en la sesión.
- **Administradores:** un administrador puede operar sin rol de trabajo asignado; si tiene varios roles disponibles, puede elegir el rol con el que trabajará.
- **Usuarios estándar:** un usuario estándar sin rol de trabajo activo con zonas activas no puede iniciar operación y recibe un mensaje para solicitar asignación administrativa.
- **Nuevo endpoint:** `GET /api/auth/operational-session` permite consultar la sesión operativa actual.
- **Nuevo endpoint:** `POST /api/auth/operational-session` permite seleccionar el rol de trabajo activo de la sesión actual.
- **Frontend:** se agrega una pantalla premium de selección de rol operativo con botón para cambiar de usuario.
- **Alcance:** todavía no filtra Dashboard/Zonas por zonas permitidas ni muestra el rol activo en Header; eso queda para v2.2.4.9/v2.2.4.10.
- **PWA/cache:** se actualizó el versionado de `style.css`, `main.js` y `service-worker.js` para evitar caché antigua.

### v2.2.4.9 · Header con rol de sistema y rol de trabajo activo

- El header principal ahora muestra el rol de sistema del usuario autenticado: **Admin** o **Estándar**.
- El header también muestra el rol de trabajo activo de la sesión operativa, cuando existe.
- Si un administrador ingresa sin rol de trabajo, el header indica **Sin rol operativo** sin bloquear la administración.
- En PC se muestran usuario, rol de sistema, rol de trabajo activo y fecha/hora.
- En móvil se priorizan los roles activos en un bloque compacto para evitar romper el layout del header.
- No se activan todavía filtros por zonas permitidas ni restricciones backend por zona; eso corresponde a subfases posteriores.

### v2.2.4.9 fix1 · Cambio de rol operativo desde Header

- **Ajuste no previsto en roadmap:** se permite cambiar el rol de trabajo activo sin cerrar sesión.
- **Móvil:** el badge compacto de rol sistema / rol trabajo activo del Header abre el selector de cambio de rol.
- **PC:** se agrega un nuevo badge **Cambio de Rol** dentro del Header con la misma función.
- **Regla operativa crítica:** no se permite cambiar de rol si el rol actual tiene cuentas pendientes o consumos activos en sus zonas.
- **Backend Auth:** se agrega `GET /api/auth/operational-session/change-status` para consultar si el cambio está permitido y se endurece `POST /api/auth/operational-session` para bloquear el cambio con HTTP 409 cuando existan cuentas pendientes o puestos ocupados del rol actual.
- **Frontend:** se agrega modal premium de cambio de rol con estado bloqueado, roles disponibles y mensajes operativos claros.
- **Alcance:** no activa todavía filtros por zonas permitidas ni restricciones globales por zona; mantiene intacta la lógica de apertura/cierre de cuentas.

### v2.2.4.9 fix2 · Corrección de consulta para cambio de rol desde Header

- **Problema detectado:** el botón/badge de cambio de rol podía consultar `GET /api/auth/operational-session/change-status` y recibir 404 si el backend no exponía la ruta cargada en el proceso activo o si había una desincronización temporal entre frontend y backend.
- **Corrección aplicada:** el frontend ahora consulta el estado especializado cuando está disponible y usa `GET /api/auth/operational-session` como respaldo compatible para abrir el modal sin romper la experiencia.
- **Regla crítica conservada:** el backend mantiene el bloqueo en `POST /api/auth/operational-session` con HTTP 409 cuando el rol actual tiene cuentas pendientes o puestos ocupados.
- **Alcance:** no cambia base de datos ni permisos; solo estabiliza el flujo de consulta y conserva el endpoint especializado.

### v2.2.4.10 · Dashboard dinámico por zonas permitidas

- **Objetivo:** hacer que el Dashboard lea zonas dinámicas reales y respete las zonas permitidas por el rol de trabajo activo.
- **Backend Dashboard:** `GET /api/dashboard` ahora determina el alcance operativo desde la sesión actual:
  - usuario con rol de trabajo activo: solo zonas activas/visibles asignadas a ese rol;
  - administrador sin rol operativo: todas las zonas activas/visibles en Dashboard;
  - usuario sin rol operativo válido: no expone puestos operativos.
- **Filtros dinámicos:** el Dashboard devuelve `dashboardZonas`, `dashboardScope` y `zonasResumen` con claves dinámicas `zona-{id}` para reemplazar la lógica fija Salón/Bar/Barra.
- **Cards operativas:** las tarjetas del Dashboard muestran `zona_nombre`, `tipo_puesto_nombre` y `nombre_visible` cuando existen; por ejemplo, **Terraza / Sillón 1** ya no se normaliza visualmente como **Salón / Mesa 1**.
- **Métricas por alcance:** cuentas pendientes, cuentas pagadas del día, ventas de contado y últimas cuentas pagadas se calculan sobre las zonas permitidas del Dashboard.
- **Subnavegación Dashboard:** los filtros superiores de PC y la subnavegación móvil del Dashboard se alimentan de las zonas permitidas/visibles para el rol activo.
- **Compatibilidad:** se conserva respaldo para claves legacy `salon`, `bar-mesa` y `bar-banco` cuando falte metadata dinámica.
- **Alcance pendiente:** Zonas, Pedidos, Cuentas y restricciones backend globales por zona se mantienen para fases posteriores; esta subfase se concentra en el Dashboard.

### v2.2.4.10 fix1 · Responsabilidad compartida y cambio de rol seguro

- **Objetivo:** evitar que las mesas/cuentas activas queden huérfanas al permitir múltiples responsables operativos por mesa y corregir el cambio de rol para que libere responsabilidades compartidas sin abandonar cuentas pendientes.
- **Base de datos:** se agrega la tabla `mesa_responsables` para vincular una mesa/cuenta activa con uno o varios usuarios responsables. También se agrega `pedidos.rol_trabajo_id` para guardar el rol operativo usado al crear el pedido.
- **Asignación por defecto:** al abrir o reservar una mesa, el usuario que realiza la acción queda asignado automáticamente como responsable inicial.
- **Responsabilidad compartida:** un administrador puede agregar o quitar responsables desde el módulo **Zonas**, usando el botón **Reasignar mesa** en el footer del modal de mesa ocupada/reservada.
- **Usuarios válidos:** la reasignación solo muestra usuarios activos compatibles con la zona del puesto: administradores activos o usuarios con un rol de trabajo activo vinculado a esa zona.
- **Dashboard:** se mantiene la operación rápida sin minimodales nuevos; el administrador puede operar cualquier mesa normalmente. Un usuario estándar no responsable no ve nombres de responsables y solo recibe el estado genérico **Responsable asignado**.
- **Zonas/Pedidos:** un usuario estándar solo puede operar, agregar productos, editar productos o cobrar mesas/cuentas donde esté asignado como responsable. El administrador conserva intervención operativa completa.
- **Cambio de rol:** los usuarios estándar deben contar con autorización por contraseña de administrador para cambiar de rol. Si el usuario está asignado a mesas compartidas, el cambio lo libera automáticamente de esas mesas y deja a los demás responsables activos.
- **Bloqueo sin excepción:** si el usuario es el único responsable activo de una mesa/cuenta pendiente, el cambio de rol se bloquea aunque se ingrese contraseña de administrador. Primero debe cerrarse la cuenta o agregarse otro responsable desde **Zonas**.
- **Auditoría:** los cambios de responsables, liberaciones automáticas por cambio de rol, autorizaciones, rechazos y bloqueos se registran en `historial_transacciones` para los reportes existentes.
- **Endpoints nuevos:** `GET /api/tables/:id/responsibles` lista usuarios asignables y responsables actuales; `PUT /api/tables/:id/responsibles` reemplaza la lista de responsables de una mesa/cuenta activa.
- **Compatibilidad:** las cuentas antiguas sin responsables se completan defensivamente con el usuario creador del pedido cuando exista información suficiente, sin borrar datos existentes.

### v2.2.4.10 fix2 · Corrección de migración de columna rol_trabajo_id

- **Problema detectado:** en bases existentes, el índice `idx_pedidos_rol_trabajo` podía intentar crearse antes de que la migración agregara la columna `pedidos.rol_trabajo_id`, provocando error de arranque `SQLITE_ERROR: no such column: rol_trabajo_id`.
- **Corrección aplicada:** el índice de `pedidos.rol_trabajo_id` se crea ahora después de verificar/agregar la columna correspondiente durante la migración de esquema.
- **Alcance:** corrección de arranque/migración únicamente; no cambia UI, permisos, endpoints ni lógica operativa.


### v2.2.4.11 · Navegación inferior móvil dinámica y sesión multirrol

- **Navegación inferior móvil del Dashboard:** se mantiene visible `Todos` más las primeras tres zonas operativas y, cuando hay más zonas, se muestra el botón **Más...** al lado derecho.
- **Dropdown hacia arriba:** el botón **Más...** despliega las zonas faltantes hacia arriba para mejorar la operabilidad en móvil.
- **Promoción dinámica de zonas:** cuando una zona se selecciona desde **Más...** o tiene actividad operativa/responsabilidad del usuario, se prioriza para aparecer entre las zonas visibles principales.
- **Sesión operativa multirrol:** la pantalla **Selecciona tu rol de trabajo** ahora permite escoger uno o varios roles mediante checkbox.
- **Opción Todos:** permite activar todos los roles de trabajo disponibles para el usuario.
- **Footer de sesión operativa:** se agregan los botones **Cambiar usuario** y **Entrar**.
- **Cambio de rol desde Header:** ahora permite seleccionar varios roles activos; usuarios estándar siguen requiriendo autorización de administrador cuando cambian su selección activa.
- **Responsabilidad segura:** si al cambiar roles el usuario deja zonas donde tenía mesas compartidas, se libera automáticamente de esas responsabilidades; si quedaría como responsable único fuera de sus nuevos roles, el cambio se bloquea.
- **Dashboard dinámico:** el alcance de zonas permitidas se calcula por la unión de todos los roles activos seleccionados.
- **Compatibilidad:** se mantiene `rol_trabajo` como primer rol activo para código legacy y se agrega `roles_trabajo_activos` para la nueva operación multirrol.

### v2.2.4.11 fix1 · Corrección de selección multirrol en sesión operativa

- **Problema detectado:** al entrar desde el modal **Selecciona tu Rol de trabajo**, el frontend enviaba la selección multirrol pero una ruta backend anterior podía interpretar la petición como si faltara `rol_trabajo_id`, provocando `400 Bad Request` con el mensaje `Debe seleccionar un rol de trabajo válido`.
- **Corrección aplicada:** la petición ahora envía los IDs en formato multirrol y también mantiene campos legacy compatibles (`rol_trabajo_id` / `roleId`) para evitar fallos de transición.
- **Backend:** la normalización de roles acepta arrays, valores únicos, strings JSON y listas separadas por coma.
- **Resultado esperado:** el botón **Entrar** permite seleccionar uno, varios o todos los roles disponibles sin error 400.
- **Alcance:** no cambia permisos, zonas, Dashboard ni reglas de responsabilidad; solo corrige la entrega/lectura de roles activos.

### v2.2.4.11 fix2 · Responsables reasignables solo con sesión operativa activa

- **Problema detectado:** el modal de reasignación de mesa en Zonas mostraba usuarios activos en base de datos aunque no tuvieran sesión iniciada ni rol de trabajo activo en ese momento.
- **Corrección aplicada:** ahora solo aparecen usuarios con sesión operativa activa y con al menos un rol activo que incluya la zona de la mesa/banco/sillón.
- **Regla por zona:** si un usuario tiene roles disponibles pero no tiene activo un rol que cubra la zona de la mesa, no aparece como asignable.
- **Regla por sesión:** usuarios sin sesión iniciada o sin selección operativa activa no aparecen como responsables asignables, aunque estén activos en la base de datos.
- **Seguridad adicional:** el cambio de rol ya considera si los otros responsables tienen sesión operativa activa en la zona antes de liberar al usuario que cambia de rol, evitando dejar mesas activas sin responsable operativo real.
- **Alcance:** no cambia la UI ni la base de datos; solo endurece la validación backend para reasignaciones y cambio seguro de rol.

### v2.2.4.12 · Restricciones backend por zona y responsabilidad

- **Objetivo:** endurecer las validaciones del backend para que las zonas permitidas y la responsabilidad compartida no dependan únicamente de la interfaz.
- **Zonas permitidas:** usuarios básicos/estándar solo pueden consultar y operar puestos dentro de las zonas cubiertas por sus roles de trabajo activos en la sesión operativa actual.
- **Administrador:** conserva operación global sobre las mesas/cuentas; las restricciones estrictas por zona aplican a usuarios estándar.
- **Módulo Zonas:** `GET /api/tables` y `GET /api/tables/:id` filtran/validan por zonas permitidas para usuarios estándar. La estructura pública para estándar solo expone zonas/tipos relacionados con sus zonas activas y no entrega roles de trabajo administrativos.
- **Operación de mesas:** abrir, reservar, pasar de reservada a ocupada, cerrar/liberar y consultar mesas específicas ahora validan backend por zona activa además de responsabilidad asignada cuando corresponde.
- **Pedidos/Cuentas activas:** crear pedido, agregar productos, editar productos, cobrar y consultar pedidos pendientes validan que el usuario estándar tenga zona activa compatible y esté asignado como responsable de la mesa/cuenta.
- **Listados de pedidos:** usuarios estándar solo reciben pedidos dentro de sus zonas activas; los pedidos pendientes además requieren responsabilidad asignada.
- **Errores operativos:** se agregan respuestas 403 con códigos `ZONE_NOT_ALLOWED`, `MESA_ASSIGNED_TO_OTHER_USER` u `ORDER_NOT_ALLOWED` según el caso.
- **Compatibilidad:** no cambia base de datos ni UI operativa; refuerza reglas backend sobre la estructura creada en fases anteriores.
