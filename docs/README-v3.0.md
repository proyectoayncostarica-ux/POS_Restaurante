# MundiPOS 3.0 · README del proceso de arquitectura modular

## 1. Propósito de la etapa 3.0

MundiPOS 3.0 reorganiza la arquitectura interna del POS para reflejar la operación real de un restaurante o bar sin obligar al usuario promedio a aprender una aplicación diferente.

La interfaz visible conserva los puntos de entrada conocidos siempre que sigan siendo correctos. La separación ocurre principalmente en el código, los servicios, las transacciones, los permisos y el modelo de datos.

La etapa 3.0 se apoya en esta regla:

```text
Orders administra la cuenta global, el consumo y la atención.
Prefacturas reservan cantidades y crean documentos operativos.
Caja es la interfaz autorizada para cobrar.
Payments registra transacciones y actualiza saldos.
Kitchen administra preparación y comandas.
Printing administra documentos, colas y dispositivos.
Settings administra parámetros, incluida la pestaña Impresoras.
Reporting consulta la cuenta global como fuente financiera única.
```

## 2. Principio de compatibilidad visible

La modernización no debe cambiar innecesariamente la forma de trabajo del personal.

Ejemplos:

- el mesero continúa abriendo mesas, agregando productos y enviando comandas;
- `Ver pedido` continúa siendo el lugar donde se revisa el consumo;
- el mesero emite prefacturas desde la cuenta;
- Caja se abre desde el botón `Caja` del header para usuarios autorizados;
- Payments no aparece como módulo técnico en la navegación;
- Printing no aparece como módulo técnico en la navegación;
- la configuración visual de impresoras vive en `Configuración → Impresoras`;
- el cajero cobra documentos, pero no administra el consumo de la mesa;
- Dashboard deja de procesar dinero directamente.

La compatibilidad visual no significa conservar reglas incorrectas. Cuando el flujo actual contradiga la operación aprobada, se mantendrá una transición controlada mediante fachadas y adaptadores.

## 3. Fuente de verdad financiera

La única fuente financiera y contable interna es la **cuenta global de la mesa o banco**.

Ejemplo:

```text
Cuenta global CTA-000125
Mesa: 1
Cliente principal: Juan
Responsable: Andrey
Total consumido: ₡5.000
Total pagado: ₡5.000
Saldo: ₡0
Estado financiero: conciliada
```

Una cuenta dividida puede producir documentos separados:

```text
PF-000125-01 · Pagador Pedro · ₡3.000
PF-000125-02 · Pagador Juan  · ₡2.000
```

Estos documentos sirven para asignar consumos, identificar pagadores, cobrar y entregar comprobantes. No crean dos ventas independientes en los reportes consolidados.

La regla obligatoria es:

```text
Venta financiera consolidada = total final de la cuenta global

Suma de pagos aplicados a documentos válidos
= total pagado de la cuenta global
```

Los nombres de los pagadores no reemplazan:

- el cliente principal registrado al abrir la mesa;
- el responsable de atención;
- la mesa o banco;
- la zona;
- el número de control de la cuenta global.

### Venta y movimiento de Caja no son lo mismo

Para evitar duplicación y mantener conciliación:

- **Reporte de ventas:** una fila consolidada por cuenta global cerrada o conciliada.
- **Reporte de Caja:** una fila por transacción real de pago, con fecha, método, cajero y documento.

Dos pagos de ₡3.000 y ₡2.000 representan:

- una venta consolidada de ₡5.000;
- dos movimientos de Caja que suman ₡5.000.

## 4. Cuenta principal y continuidad del consumo

Pagar una prefactura parcial no cierra la mesa.

Cuando un cliente se retira antes:

1. el personal de atención selecciona sus productos y cantidades;
2. emite una prefactura individual;
3. Caja cobra ese documento;
4. las cantidades pagadas dejan de aparecer en el consumo disponible;
5. la mesa continúa activa;
6. se pueden agregar nuevos productos;
7. la responsabilidad del personal permanece vigente.

La cuenta principal puede estar temporalmente con saldo cero y continuar abierta. La liberación depende de una acción explícita de `Finalizar servicio` y de las validaciones de cierre.

## 5. División de cuenta una subcuenta a la vez

La división se realiza en `Ver pedido` por el mesero, salonero o bartender.

Flujo obligatorio:

1. activar `Cuenta dividida`;
2. seleccionar los ítems de un solo cliente;
3. indicar cantidad cuando una línea tenga más de una unidad;
4. revisar el total parcial;
5. pulsar `Emitir prefactura`;
6. completar el nombre del cliente en un minimodal;
7. revisar ítems, cantidades y total;
8. usar `Volver` para corregir o `Imprimir y emitir` para confirmar;
9. regresar al consumo restante;
10. repetir el flujo para el siguiente cliente.

La cantidad disponible se calcula así:

```text
cantidad_disponible
= cantidad_consumida
- cantidad_asignada_a_prefacturas_no_anuladas
```

No se permite seleccionar dos subcuentas simultáneamente ni reutilizar la misma unidad en documentos distintos.

## 6. Roles y capacidades

`Cajero` será un rol o capacidad operativa, no un tercer tipo rígido de usuario.

Combinaciones válidas:

```text
Cajero exclusivo
Salonero
Bartender
Salonero + Cajero
Bartender + Cajero
Administrador
```

Capacidades iniciales previstas:

```text
orders.operate
orders.split
orders.issue_preinvoice
orders.finalize_service
cash.access
cash.collect
cash.reprint
cash.reverse
kitchen.operate
printing.configure
printing.retry
```

Un cajero exclusivo no debe requerir una zona operativa para cobrar. Un usuario mixto conserva la atención de mesas y puede abrir Caja desde el header.

## 7. Separación interna por dominios

### Orders / Cuentas

- cuenta global;
- cliente principal;
- mesa, zona y responsables;
- consumo activo;
- productos y cantidades;
- total consumido;
- estado operativo;
- emisión de prefacturas;
- finalización del servicio.

### Prefacturas

- número documental;
- pagador visible;
- ítems y cantidades reservadas;
- snapshots de precio y servicio;
- total del documento;
- saldo del documento;
- estado de emisión, pago, anulación e impresión.

### Caja

- búsqueda de documentos;
- cobro de prefacturas;
- efectivo, vuelto, tarjeta y pagos mixtos;
- historial y reimpresión autorizada;
- usuario cajero.

### Payments

- idempotencia;
- transacciones monetarias;
- métodos de pago;
- reversos;
- saldo por prefactura;
- total pagado consolidado en la cuenta global;
- nunca libera la mesa por sí solo.

### Kitchen

- productos que requieren preparación;
- destino cocina o bar;
- estados de preparación;
- reenvíos y anulaciones;
- contenido de la comanda.

### Printing

- plantillas;
- trabajos de impresión;
- intentos y errores;
- reimpresión;
- vista previa;
- drivers o adaptadores;
- no decide reglas de negocio de Payments o Kitchen.

### Settings

- pestaña `Impresoras`;
- impresora de Caja, cocina y bar;
- tamaño de papel;
- copias;
- autoimpresión;
- prueba de dispositivo.

## 8. Estados canónicos

### Cuenta global

Estado operativo:

```text
abierta
finalizando
cerrada
cancelada
```

Estado financiero:

```text
sin_documentos
pendiente
parcial
conciliada
credito
```

### Prefactura

```text
emitida
parcialmente_pagada
pagada
anulada
```

### Pago

```text
pendiente
confirmado
reversado
anulado
fallido
```

### Trabajo de impresión

```text
pendiente
imprimiendo
impreso
fallido
cancelado
```

## 9. Reglas de integridad no negociables

- Toda operación monetaria crítica usa transacción SQLite.
- Toda emisión valida cantidades disponibles dentro de la transacción.
- El backend no confía en totales enviados por frontend.
- Payments no libera mesas.
- Una prefactura pagada no equivale a mesa cerrada.
- Los documentos parciales no se suman como ventas independientes.
- La cuenta global conserva cliente principal y responsables originales.
- La impresión ocurre después de persistir el documento.
- Un fallo de impresora no duplica la prefactura ni el pago.
- Las rutas legacy solo pueden vivir como adaptadores temporales.
- La autorización real siempre se valida en backend.

## 10. Orden de implementación

La secuencia oficial está en:

```text
docs/roadmap-v3.0-arquitectura-modular.md
```

Resumen:

```text
v3.0.x  Fundaciones, pruebas, capacidades y acceso
v3.1.x  Cuenta global, líneas, prefacturas y continuidad
v3.2.x  Payments, Caja, métodos de pago y cierre
v3.3.x  Kitchen / Comandas
v3.4.x  Printing e Impresoras
v3.5.x  Dashboard, reportes, conciliación y realtime
v3.6.0  Limpieza legacy
v3.7.0  Pruebas cruzadas y cierre
```

## 11. Documentos canónicos de la etapa

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/contrato-v3.0-compatibilidad-ui.md
docs/contrato-v3.0-operacion-caja-prefacturas.md
docs/contrato-v3.0-cuenta-global-fuente-financiera.md
docs/auditoria-v3.0.0-arquitectura-modular.md
docs/auditoria-v3.0.0-fix1-caja-prefacturas-subcuentas.md
```

Antes de implementar una fase se deben revisar el roadmap, los contratos relacionados y el README canónico.

## 12. Regla de avance

No se comienza una subfase posterior hasta que la actual esté:

- implementada;
- probada operativamente;
- validada por sintaxis y pruebas automáticas disponibles;
- documentada;
- preparada mediante git seguro;
- subida a `origin/main`.

## 13. Git seguro

Nunca usar `git add .` en este proyecto.

Antes de cada commit:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
git status --short
```

Filtro obligatorio:

```powershell
git diff --cached --name-only | Select-String -Pattern "data/restaurant.db|\.env$|certs/|\.pem$|\.key$|rootCA|mundipos-rootCA|node_modules|cookies.txt|data/backups"
```

Si el filtro imprime algo, el commit debe detenerse.

## 14. Estado actual · v3.0.1

La infraestructura transaccional y la primera suite automática ya están disponibles.

Desde esta fase, las nuevas mutaciones críticas deben construirse sobre:

```text
database.withTransaction()
transactionService
DomainError
money.js
idempotency.js
```

Reglas para las siguientes fases:

- no emitir realtime antes del commit;
- no ejecutar varias escrituras financieras sin transacción;
- no calcular dinero con sumas flotantes dispersas;
- no registrar pagos sin clave/fingerprint de idempotencia cuando Payments sea implementado;
- ampliar fixtures y pruebas junto con cada dominio nuevo.

La interfaz visible continúa sin cambios en `v3.0.1`.

## 15. Estado actual · v3.0.2

La aplicación ya dispone de un modelo persistente de capacidades y de un rol operativo `Cajero` independiente de las zonas.

Reglas vigentes desde esta fase:

```text
usuarios.tipo = basico | administrador
Cajero = rol de trabajo con capacidades de Caja
Administrador = acceso completo
Capacidades efectivas = unión de roles activos
Autorización real = backend mediante requireCapability()
```

Capacidades registradas:

```text
orders.operate
orders.split
orders.issue_preinvoice
orders.finalize_service
cash.access
cash.collect
cash.reprint
cash.reverse
kitchen.operate
printing.configure
printing.retry
```

La navegación visible respeta estas reglas:

- un cajero exclusivo inicia directamente en Caja y no necesita zona;
- un usuario mixto conserva atención y puede abrir Caja desde el header;
- Caja permanece oculta para usuarios sin `cash.access`;
- ocultar un botón no sustituye la protección backend;
- el endpoint legacy de cobro requiere `cash.collect` mientras sea adaptador temporal.

La vista Caja de `v3.0.2` es una base de navegación y consulta. No implementa todavía el nuevo núcleo Payments ni el cobro por prefactura, que pertenecen a `v3.2.x`.

La suite automática cuenta con 15 pruebas aprobadas. Las próximas fases deben ampliar estas pruebas sin eliminar la cobertura transaccional y de capacidades existente.


## 16. Estado actual · v3.0.3

La autorización operativa ya no se resuelve mediante reglas aisladas en cada componente. Desde esta fase existe una política compartida para backend, frontend y realtime.

La sesión entrega un bloque `acceso_operativo` con:

```text
usuario y tipo
roles de trabajo activos
capacidades efectivas
zonas efectivas
secciones autorizadas
destino inicial
```

Reglas vigentes:

- el backend continúa siendo la fuente de autorización;
- el frontend solo adapta navegación y experiencia según la política recibida;
- Dashboard, Zonas, Menú y Cuentas requieren `orders.operate`;
- Caja requiere `cash.access` y el cobro requiere `cash.collect`;
- los pedidos se filtran por zonas efectivas del usuario;
- una mutación de mesa/pedido debe respetar zona y responsabilidad;
- un cajero exclusivo no recibe eventos operativos de mesas o pedidos;
- un usuario de atención no recibe eventos de otras zonas;
- los eventos dirigidos a un usuario solo llegan a ese usuario;
- al cambiar roles/capacidades, la sesión y la navegación se actualizan sin cerrar manualmente la aplicación.

La suite automática cuenta con 21 pruebas aprobadas. Incluye pruebas de paridad entre la política frontend/backend para evitar que ambas implementaciones evolucionen de forma contradictoria.

Esta fase todavía no introduce prefacturas, cuenta dividida persistente ni el núcleo Payments. Su propósito es asegurar que esos dominios se construyan sobre una autorización y sincronización coherentes.

## 17. Estado actual · v3.1.0

La cuenta principal ya se expresa como **cuenta global canónica** aunque la tabla `pedidos` se conserve temporalmente por compatibilidad.

Cada cuenta dispone de:

```text
numero_cuenta CTA-########
cliente principal
mesa/banco y zona en snapshot
responsables históricos
total consumido
total pagado
saldo pendiente
estado operativo
estado financiero
fechas de apertura, conciliación y cierre
```

`server/services/accountService.js` es propietario de la creación, acumulación de consumo, sincronización de totales y lectura del agregado. Las rutas `/api/orders` son adaptadores y no deben volver a incorporar reglas duplicadas.

Reglas vigentes desde esta fase:

- consultar una cuenta no escribe en SQLite;
- las mutaciones de cuenta usan transacciones;
- precios y servicio se calculan en backend;
- cliente y responsables se capturan históricamente;
- pagos aportan movimientos, pero la venta sigue perteneciendo a la cuenta global;
- un pago parcial puede dejar estado financiero `parcial` y estado operativo `abierta`;
- la numeración de cuenta es única y persistente;
- la tabla `cuenta_responsables` no sustituye a `mesa_responsables`: conserva el snapshot histórico.

La suite automática cuenta con 27 pruebas aprobadas. La siguiente fase normalizará líneas y cantidades disponibles para permitir asignación parcial sin borrar consumo.

## 18. Estado actual · v3.1.1

Cada fila de `pedido_productos` es ahora una **línea de consumo identificable y divisible por cantidades**.

El read model expone:

```text
cantidad_consumida
cantidad_asignada
cantidad_disponible
estado_asignacion
precio y servicio en snapshot
versión de concurrencia
```

Regla vigente:

```text
cantidad_disponible
= cantidad_consumida
- cantidad_asignada
```

Las asignaciones se ejecutan de manera transaccional. Selecciones repetidas de la misma línea se agrupan antes de validar, por lo que una línea de cantidad 3 admite `2 + 1`, pero rechaza `2 + 2` sin aplicar cambios parciales.

El nuevo consumo solo se consolida cuando coinciden producto, presentación, precio y servicio y la línea continúa totalmente disponible. Una línea parcialmente asignada permanece intacta y el consumo nuevo se registra por separado.

La cuenta entrega cuatro vistas compatibles:

```text
productos               historial completo
productos_disponibles   consumo activo
productos_asignados     cantidades reservadas
resumen_lineas           agregados de unidades y montos
```

Esta fase todavía no crea prefacturas. `cantidad_asignada` es la infraestructura que `v3.1.2` actualizará al emitir o anular documentos operativos.

La suite automática cuenta con 36 pruebas aprobadas. La siguiente fase implementará secuencias y persistencia documental de prefacturas.

## 19. Estado actual · v3.1.2

MundiPOS ya dispone de un modelo documental persistente para prefacturas, todavía sin exposición visual.

Entidades:

```text
secuencias_documentales
prefacturas
prefactura_items
historial_prefacturas
```

Cada prefactura recibe un número global `PF-########` y un ordinal dentro de la cuenta. Conserva el nombre del pagador, pero mantiene en snapshot el cliente principal, la mesa/banco, la zona y los responsables originales de la cuenta global.

La emisión interna es atómica:

```text
reservar cantidades
+ generar número
+ guardar documento
+ guardar ítems
+ guardar historial
+ actualizar estado de cuenta
```

Si falla cualquier escritura, se revierten también las cantidades y la numeración. Las claves de idempotencia permiten repetir una solicitud segura sin crear otra prefactura.

Una anulación sin pagos conserva el documento como historial y devuelve sus cantidades al consumo disponible. Los documentos pagados o con estado avanzado no pueden anularse mediante esta operación base.

La fuente financiera sigue siendo la cuenta global:

```text
una cuenta global = una venta
varias prefacturas = varias obligaciones operativas de cobro
```

La suite automática cuenta con 47 pruebas aprobadas. La siguiente fase expondrá este dominio en `Ver pedido` mediante la emisión guiada de una subcuenta a la vez.



## 20. Estado actual · v3.1.3

`Ver pedido` ya conecta el consumo disponible con el modelo persistente de prefacturas.

Con `Cuenta dividida` activa, el mesero, salonero o bartender selecciona las líneas correspondientes a un solo cliente. Cuando una línea tiene varias unidades, elige la cantidad exacta. El total parcial se actualiza antes de emitir.

El minimodal solicita el nombre del pagador y permite:

```text
Volver                   corregir sin reservar
Imprimir y emitir        persistir una prefactura y abrir impresión
```

Cada confirmación crea un único documento idempotente. Después, la cuenta se vuelve a consultar y las cantidades reservadas desaparecen del consumo activo, sin borrarse del historial global.

Con la división desactivada, la prefactura toma todo el consumo disponible. El backend exige coincidencia exacta para impedir que un documento marcado como completo contenga solo una parte.

La división legacy de pagos queda deshabilitada. Una cuenta con prefacturas activas deberá cobrarse posteriormente por documento desde Caja; no puede atravesar el endpoint antiguo de pago completo.

La impresión actual es un adaptador temporal del navegador y no confirma el estado físico del trabajo. Printing continuará siendo responsable de colas, dispositivos, reintentos y trazabilidad en `v3.4.x`.

La suite automática cuenta con 53 pruebas aprobadas. La siguiente fase formaliza la continuidad del consumo cuando ya existen documentos y, posteriormente, pagos.

## 21. Estado actual · v3.1.4

La cuenta global ya separa el estado del servicio de la liquidación de sus documentos. Una prefactura pagada no cierra la mesa y sus ítems no vuelven al consumo activo.

El read model distingue:

```text
productos_disponibles
productos_documentados_pendientes
productos_pagados
productos_reservados_sin_documento
resumen_documentos
continuidad_operativa
```

Una cuenta puede permanecer así:

```text
estado_operativo: abierta
estado_financiero: conciliada
saldo_pendiente: 0
```

Ese estado significa que el consumo actual fue liquidado, pero la mesa/banco continúa ocupado y puede recibir productos nuevos. Al agregarlos, el total global aumenta y el saldo vuelve a quedar pendiente sin crear una segunda cuenta financiera.

El adaptador de pago normal sin prefacturas ahora liquida solo el saldo vigente y no libera la mesa. El cobro por documento seguirá implementándose en Payments, por lo que esta fase no expone todavía el pago real de prefacturas desde Caja.

`Ver pedido` muestra consumo activo, consumo documentado pendiente e historial liquidado en secciones separadas. Las responsabilidades, el cliente principal y la trazabilidad de la cuenta global se conservan.

La suite automática cuenta con 57 pruebas aprobadas. La siguiente fase construirá el read model financiero consolidado para Dashboard, Caja, reportes y cierre.

## 22. Estado actual · v3.1.5

MundiPOS ya posee una lectura financiera única basada en la cuenta global. Dashboard, Caja y detalle dejan de interpretar cada pago o prefactura como una venta independiente.

La separación canónica es:

```text
cuenta global          fuente financiera y venta
prefacturas            documentos operativos por pagador
pagos                   movimientos individuales de Caja
```

Una cuenta dividida de ₡5.000, pagada mediante movimientos de ₡3.000 y ₡2.000, genera una sola venta global de ₡5.000. Los dos pagos permanecen visibles en Caja y las dos prefacturas conservan sus nombres de pagador.

El cliente principal y los responsables se leen desde los snapshots de la cuenta global. Los pagadores parciales no sustituyen al cliente registrado al ocupar la mesa ni trasladan la responsabilidad comercial.

Las ventas utilizan la fecha de conciliación; los movimientos de Caja utilizan la fecha individual de pago. Cuando ocurren en fechas diferentes, los totales diarios pueden no coincidir, pero el detalle mantiene la conciliación completa.

Dashboard presenta una fila por cuenta global, y su detalle separa consumo, documentos operativos y movimientos. Caja muestra métricas distintas para ventas globales y movimientos del día.

La tabla legacy `pagos` aún no identifica la prefactura exacta liquidada. Ese vínculo, junto con cajero, idempotencia y estados de pago, se incorporará en `v3.2.0`.

La suite automática cuenta con 62 pruebas aprobadas. La siguiente fase inicia Payments por prefactura.



## 23. Estado actual · v3.2.0

Payments ya dispone de un dominio backend transaccional por prefactura.

La relación canónica es:

```text
pago → prefactura → cuenta global
```

Cada pago nuevo recibe `PG-########`, conserva cajero, pagador, método, referencia, subtotal, servicio, monto, fecha y estado. Los estados monetarios reconocidos son `pendiente`, `confirmado` y `anulado`; únicamente los confirmados participan en saldos, ventas y movimientos de Caja.

El registro ejecuta en una sola transacción:

```text
validar idempotencia
→ validar saldo documental
→ generar número
→ guardar pago y componentes
→ actualizar prefactura
→ actualizar cuenta global
→ registrar historial
```

Los pagos parciales dejan la prefactura en `parcial`. Al completar el saldo queda `pagada`, pero la cuenta global mantiene su estado operativo abierto y la mesa continúa ocupada.

Los reversos conservan el movimiento original, crean un registro auditable y restauran los saldos sin borrar información. Los movimientos anulados quedan excluidos del read model financiero.

La migración preservó y numeró los pagos legacy disponibles y creó sus componentes de subtotal/servicio. El vínculo exacto con prefactura solo existe para movimientos creados por Payments; los registros antiguos permanecen identificados como `legacy_cuenta_global`.

La suite automática cuenta con 70 pruebas aprobadas. La siguiente fase expondrá el servicio mediante endpoints y búsquedas operativas de Caja.

## 24. Endurecimiento previo a Caja · v3.2.0 fix1 y fix2

La base de Payments se mantiene en `3.2.0`, pero antes de crear su API pública se corrigió la cadena de dependencias.

`fix1` aplicó las actualizaciones compatibles resueltas por npm. `fix2` reemplaza de manera explícita `sqlite3 5.1.7` por `sqlite3 6.0.1`, fija Node.js `>=20.17.0` y añade una prueba que carga el addon nativo y verifica WAL, transacciones, claves foráneas e integridad.

El procedimiento se ejecuta con:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\upgrade-sqlite3.ps1
```

El script no utiliza `--force`, respalda los manifests, genera el lockfile desde el estado actual, ejecuta `npm ci`, la suite completa y la auditoría de producción.

La actualización no cambia la cuenta global, prefacturas, Payments, Caja, Dashboard ni el esquema funcional. La siguiente fase continúa siendo `v3.2.1`.



## 25. Estado actual · v3.2.1

MundiPOS expone una API específica de Caja sobre el núcleo transaccional de Payments. El cajero puede consultar la cola de prefacturas, buscar documentos por número, cuenta, mesa/banco, zona, cliente principal, pagador o responsable, y abrir una lectura de cobro con ítems, pagos y contexto de cuenta global.

La cola agrupa las prefacturas bajo su cuenta principal:

```text
CTA-######## · cliente principal · responsable
├── PF-######## · pagador 1 · saldo
└── PF-######## · pagador 2 · saldo
```

Las lecturas requieren `cash.access`. Registrar cobros requiere `cash.collect`; solicitar reimpresión requiere `cash.reprint`; reversar pagos requiere `cash.reverse`. El usuario cajero se obtiene de la sesión autenticada y no del cuerpo de la solicitud.

Los cobros utilizan `Idempotency-Key`, conservan el vínculo `pago → prefactura → cuenta global` y publican realtime únicamente a sesiones autorizadas. Pagar un documento no libera la mesa ni finaliza el servicio.

La reimpresión queda auditada, pero no se marca como realizada mientras no exista el módulo Printing. La API informa explícitamente que todavía no se creó un trabajo físico de impresión.

No se modifica el esquema SQLite. La suite funcional cuenta con 76 pruebas aprobadas; en Windows, con el addon `sqlite3@6.0.1`, el total esperado es 78. La siguiente fase construirá la interfaz visual completa de Caja sobre este contrato.


## 26. Estado actual · v3.2.2

MundiPOS incorpora la interfaz operativa completa de Caja sobre la API de `v3.2.1`. La navegación continúa autorizada mediante `cash.access` y el cajero exclusivo entra directamente a esta sección desde el header.

La pantalla diferencia:

```text
resumen operativo
cola agrupada por cuenta global
documentos individuales por pagador
detalle de ítems y saldo
historial de pagos
movimientos de Caja del día
```

El cajero busca una prefactura, la selecciona y abre un modal para registrar un abono o liquidar el saldo. La mutación requiere `cash.collect`, usa idempotencia y nunca libera automáticamente la mesa. La reimpresión requiere `cash.reprint` y mantiene su estado pendiente de Printing.

Dashboard deja de ejecutar cobros. Los accesos previos desde Orders solo redirigen al contexto correspondiente de Caja; Payments no aparece como módulo técnico visible.

La UI está adaptada para PC y móvil. El caché PWA cambia a `v3.2.2-cash-ui` para evitar que dispositivos instalados conserven el componente anterior.

Esta fase admite cobros simples en efectivo o tarjeta. El cálculo de efectivo recibido, vuelto y pagos mixtos se implementará en `v3.2.3`.

## v3.2.3 · Efectivo, vuelto, tarjeta y pagos mixtos

La capa Payments soporta efectivo, tarjeta y modalidad mixta. Cada pago conserva un único número y una única afectación sobre la prefactura, mientras `pago_medios` registra cómo se compuso el cobro.

Reglas:

- el efectivo recibido debe ser igual o mayor que el efectivo aplicado;
- el vuelto solo se calcula sobre efectivo;
- la tarjeta requiere referencia;
- un pago mixto requiere efectivo y tarjeta mayores que cero;
- la suma aplicada no puede superar el saldo documental;
- el pago confirmado no finaliza el servicio.

Documento de avance: `docs/avance-v3.2.3-medios-pago.md`.

Siguiente fase: `v3.2.4 · Créditos integrados con Payments`.


## v3.2.4 · Créditos integrados con Payments

Una prefactura con saldo puede trasladarse a crédito desde Caja mediante autorización administrativa. La operación crea `CR-########`, mantiene la cuenta global como única venta, liquida el documento por método crédito y conserva la mesa abierta.

Los abonos se registran mediante Payments con naturaleza `cobro_credito`. Efectivo, tarjeta y mixtos actualizan el saldo de la deuda y generan movimientos de Caja, pero no vuelven a incrementar el total financiero de la cuenta global.

La pantalla Créditos continúa visible, aunque ya no permite crear deudas manuales ni eliminarlas físicamente. `accounts.js` y `credits.js` son adaptadores del mismo `creditService`.

Documento de avance: `docs/avance-v3.2.4-creditos-payments.md`.

Siguiente fase: `v3.2.5 · Finalización del servicio y liberación integral`.


## v3.2.5 · Finalización del servicio y liberación integral

El saldo cero continúa siendo un estado financiero, no una orden de liberar la mesa. El mesero, salonero o bartender responsable finaliza el servicio desde **Ver pedido** cuando la atención realmente terminó.

Antes de cerrar, el backend comprueba cantidades disponibles, reservas sin documento, prefacturas pendientes, pagos en proceso, créditos formalizados, saldo global y versión de cuenta. La operación es transaccional e idempotente.

Al confirmar:

```text
cuenta global → cerrada
mesa/banco → libre
cliente operativo de la mesa → limpiado
responsables activos → limpiados
responsables históricos → conservados
realtime → publicado
```

Los créditos formalizados pueden mantener saldo en cartera; esto no impide liberar el puesto porque la venta ya fue conciliada mediante el documento de crédito.

Documento de avance: `docs/avance-v3.2.5-finalizacion-servicio.md`.

Siguiente fase: `v3.3.0 · Dominio Kitchen / Comandas`.

## v3.3.0 · Dominio Kitchen / Comandas

Orders registra el consumo y solicita preparación. `kitchenService` recalcula desde SQLite qué cantidades de cada `pedido_productos.id` aún deben enviarse, ajustarse o anularse.

La fase incorpora destinos `cocina` y `bar`, números `CMD-########`, ítems normalizados, observaciones, adicionales, solicitante humano, idempotencia, concurrencia y realtime por zona. El estado de impresión no modifica el estado operativo de preparación.

Las columnas y rutas legacy permanecen como adaptadores. No se borra historial y las comandas conservan snapshots aunque la mesa deje de existir operativamente.

Documento de avance: `docs/avance-v3.3.0-kitchen-comandas.md`.

Siguiente fase: `v3.3.1 · Trazabilidad operativa de comandas`, después de validar y publicar `v3.3.0`.


## v3.3.0 fix1 · Inicialización segura de Kitchen sobre bases legacy

Se corrige el arranque detectado al migrar una base operativa real procedente de `v3.2.5`.

El incidente tenía dos fallos consecutivos:

1. `createIndexes()` intentaba crear `idx_comandas_pedido` antes de que `migrateSchema()` agregara `pedido_id`.
2. Después de corregir ese orden, una comanda legacy podía llegar a `rebuildLegacyForeignKeys()` con `solicitada_en = NULL`. Al copiar esa fila a `comandas_new`, SQLite rechazaba el valor explícito porque la nueva columna es `NOT NULL`.

El flujo corregido mantiene `createTables → migrateSchema → createIndexes` y, dentro de la reconstrucción legacy, normaliza primero los campos obligatorios de `comandas`. `solicitada_en` conserva `fecha_impresion` cuando existe y usa `CURRENT_TIMESTAMP` solo como último fallback.

No se elimina ni reemplaza la base operativa y se conserva el historial de comandas.

Documento de avance: `docs/avance-v3.3.0-fix1-inicializacion-kitchen.md`.

Siguiente fase: `v3.3.1 · Trazabilidad operativa de comandas`, después de validar `npm test`, el arranque real sobre `data/restaurant.db` y publicar el fix.


## v3.3.1 · Trazabilidad operativa de comandas

Se implementan estados operativos independientes de Printing, timestamps por transición, actor responsable, control de versión, historial por comanda e ítem y snapshots antes/después de cambios de consumo.

Kitchen expone un read model persistente mediante `/api/kitchen/board`, recuperable después de reiniciar el servidor. El tablero puede filtrarse por destino y zona, calcula minutos transcurridos y prioridad operativa y conserva mesa, zona, producto, presentación, observaciones, adicionales y solicitante humano.

La mutación `PUT /api/kitchen/comandas/:id/state` exige versión esperada y registra cada transición. Las anulaciones requieren motivo. El realtime admite restricción por destino además de capacidad y zona.

Documento de avance: `docs/avance-v3.3.1-trazabilidad-comandas.md`.

Siguiente fase: `v3.3.2 · Cuenta departamental y UI/UX de Kitchen`, después de validar y publicar `v3.3.1`.


## v3.3.2 · Cuenta departamental y UI/UX de Kitchen

Se incorpora la identidad departamental `Cocina`, diferenciada de las cuentas humanas mediante `usuarios.clase_cuenta` y `cuenta_departamental_codigo`. La cuenta se provisiona inactiva con secreto aleatorio no expuesto, usa únicamente el rol de sistema `Cocina` y la capacidad `kitchen.operate`.

La navegación inicial y única de esta cuenta es `Kitchen`. El frontend activa un modo exclusivo sin header operativo, sidebar, Dashboard, Mesas, Cuentas, Caja, Menú, Usuarios ni Configuración. El tablero presenta órdenes persistentes en columnas Pendientes, En preparación y Listas, con actualización realtime, reconexión visible y refresco de respaldo.

El administrador conserva control para activar/bloquear la cuenta y establecer una nueva contraseña. El backend impide eliminar la cuenta departamental o asignarle roles distintos de Cocina.

Documento de avance: `docs/avance-v3.3.2-cuenta-departamental-ui-kitchen.md`.

Siguiente fase: `v3.4.0 · Núcleo y cola de Printing`, después de validar y publicar `v3.3.2`.

## v3.4.0 · Núcleo y cola de Printing

Printing se incorpora como servicio interno transversal. Los dominios de negocio continúan siendo responsables de persistir sus documentos y entregar datos canónicos; Printing solo conserva el snapshot recibido, crea el trabajo, ejecuta el adaptador y registra cada intento.

La cola usa `trabajos_impresion`, `intentos_impresion` y `plantillas_documento`. La identidad idempotente de una copia es `documento_tipo + documento_id + copia`. Un fallo de impresión deja el trabajo en estado fallido y conserva el documento de negocio intacto. Los reintentos reutilizan el mismo trabajo y agregan nuevos intentos auditables.

El primer adaptador es `navegador_pdf`, que genera una salida HTML apta para vista previa y flujo navegador/PDF. La arquitectura permite registrar adaptadores posteriores para impresoras térmicas sin mover lógica de negocio a Printing.

Al iniciar el servidor se recuperan trabajos que quedaron abandonados en `procesando` después de una interrupción. La recuperación cierra el intento interrumpido como fallido y devuelve el trabajo a `pendiente`.

Documento de avance: `docs/avance-v3.4.0-printing-core-queue.md`.

Siguiente fase: `v3.4.1 · Integración transversal de documentos`, después de validar y publicar `v3.4.0`.

## v3.4.1 · Integración transversal de documentos con Printing

Los documentos canónicos de Orders, Caja, Créditos y Kitchen se conectan al núcleo persistente de Printing mediante `documentPrintingService`. Cada dominio termina primero su operación y luego entrega un snapshot ya calculado; Printing no modifica saldos, estados financieros, estados de preparación ni cantidades de negocio.

Se integran prefacturas completas y parciales, recibos de cobro, comprobantes de crédito, abonos de crédito, comandas con destino cocina/bar y cierres diarios. La copia inicial usa `copia = 1`; una reimpresión conserva el número documental y reserva transaccionalmente la siguiente copia. Un reintento técnico de un trabajo fallido reutiliza el mismo trabajo y agrega un nuevo intento auditable.

Caja expone reimpresión de prefacturas, recibos y créditos. El adaptador legacy de Dashboard para reimprimir una cuenta selecciona el último documento financiero real disponible. Kitchen encola sus comandas después de persistirlas y mantiene completamente separado el estado operativo de preparación.

El cierre diario se encola mediante `POST /api/printing/documents/daily-close`, usando el snapshot que entrega `FinancialReadService.getPeriodSummary()`.

Documento de avance: `docs/avance-v3.4.1-integracion-documentos-printing.md`.

Siguiente fase: `v3.4.2 · Configuración → Impresoras`.



## v3.4.2 · Configuración → Impresoras

Configuración incorpora una pestaña interna `Impresoras` para administrar por separado Caja, Cocina y Bar. Cada destino define dispositivo, adaptador, tamaño de papel, copias físicas, autoimpresión, plantilla y estado activo.

Settings persiste estos parámetros; Printing los resuelve cuando crea un trabajo y guarda un snapshot dentro de `trabajos_impresion`. Por ello, cambiar una impresora no modifica trabajos ya encolados ni cambia la identidad de una copia existente.

Las comandas se enrutan a Cocina o Bar según su destino canónico. Prefacturas, recibos, créditos, abonos y cierres diarios usan Caja. La prueba de impresión se ejecuta desde Printing y actualiza el estado conocido del dispositivo sin crear documentos de negocio.

La configuración legacy `impresora` puede alimentar únicamente el nombre inicial de Caja. La UI no expone Printing como módulo principal.

Documento de avance: `docs/avance-v3.4.2-configuracion-impresoras.md`.

Siguiente fase: `v3.5.0 · Dashboard y reportes financieros consolidados`.


## v3.5.0 · Dashboard y reportes financieros consolidados

Dashboard adopta la cuenta global como unidad única de venta. Las prefacturas continúan siendo documentos operativos y los pagos continúan siendo movimientos de Caja. Una cuenta dividida nunca genera varias ventas por el solo hecho de tener varios documentos o pagadores.

Se agrega `DashboardReportService` y la ruta `GET /api/dashboard/report`, con filtros por período, zona, cajero, método y responsable. El consolidado separa ventas globales, movimientos de liquidación, cobros posteriores de créditos, consumo activo y documentos pendientes.

La interfaz de Dashboard incorpora un panel de reportes de solo lectura con cuatro vistas: Ventas, Movimientos, Consumo activo y Documentos pendientes. No se agregan acciones de cobro; cualquier cobro sigue perteneciendo exclusivamente a Caja.

Documento de avance: `docs/avance-v3.5.0-dashboard-reportes-financieros.md`.

Siguiente fase: `v3.5.1 · Realtime y recuperación operativa`, únicamente después de autorización explícita para continuar.


## v3.5.1 · Realtime y recuperación operativa

Realtime pasa a funcionar explícitamente como señal de invalidación. La base de datos y los read models siguen siendo la fuente de verdad. Cada conexión identifica la instancia del servidor y la versión técnica; después de una reconexión, reinicio o hueco detectado, la vista activa vuelve a consultar sus APIs persistidas.

Caja utiliza reintento idempotente únicamente para respuestas ambiguas de red/servidor y conserva la misma `Idempotency-Key`. Printing emite estados de sus trabajos sin acoplarlos a estados financieros u operativos. El cliente detecta versiones PWA/SPA obsoletas mediante `X-MundiPOS-Version` y señal SSE.

Documento de avance: `docs/avance-v3.5.1-realtime-recuperacion-operativa.md`.

Siguiente fase: `v3.6.0 · Limpieza legacy y orden estructural`, únicamente después de autorización explícita para continuar.


## v3.6.0 · Limpieza legacy y orden estructural

La transición operativa queda consolidada alrededor de una sola implementación activa por regla. Orders ya no procesa pagos directos ni mantiene placeholders de impresión; Caja/Payments conserva las mutaciones monetarias y Printing conserva toda salida documental.

La API duplicada `/api/credits` deja de montarse. Créditos permanece visible para el usuario, pero opera mediante `/api/accounts`, `creditService` y Payments. El archivo físico `server/routes/credits.js` queda únicamente como shim de importación y no contiene handlers propios.

La navegación Orders → Caja se separa en `OrderWorkflow`. Realtime elimina el namespace retirado y continúa funcionando como señal de invalidación. Se preservan compatibilidades de datos y migración necesarias para instalaciones antiguas; no se elimina historia ni se reconstruyen registros legacy.

Mapa de dependencias: `docs/arquitectura-v3.6.0-dependencias.md`.

Documento de avance: `docs/avance-v3.6.0-limpieza-legacy.md`.

Siguiente fase: `v3.7.0 · Pruebas cruzadas y cierre MundiPOS 3.0`, únicamente después de autorización explícita para continuar.


## v3.7.0 · Pruebas cruzadas y cierre MundiPOS 3.0

La fase final de la línea 3.0 agrega pruebas que atraviesan varios dominios en un mismo escenario y comprueban los contratos que no deben romperse al integrar toda la arquitectura.

La matriz cubre cuenta dividida, pagos múltiples, consumo posterior a un pago, saldo temporal cero, crédito y abonos, reintentos de impresión, desacople entre Kitchen y Printing, finalización explícita y ausencia de rutas monetarias legacy.

Se incorporan comandos dedicados `npm run test:cross-domain` y `npm run test:closure`, además del checklist `docs/checklist-cierre-mundipos-3.0.md`.

El estado de esta entrega es **implementada y pendiente de validación final**. MundiPOS 3.0 solo puede declararse cerrado y publicado después de completar la suite nativa, validación sobre `restaurant.db`, revisión operativa PC/móvil y Git seguro.

Documento de avance: `docs/avance-v3.7.0-cierre-mundipos-3.0.md`.

V4 permanece sin definición canónica hasta completar ese cierre.
