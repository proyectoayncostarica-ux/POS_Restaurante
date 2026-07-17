# Roadmap v3.0 · Arquitectura modular, Caja y fuente financiera única

## 1. Visión

MundiPOS 3.0 reorganiza la aplicación para representar correctamente la operación real de un restaurante o bar sin convertir la modernización interna en una ruptura de la experiencia del usuario.

```text
Orders administra la cuenta global, la atención y el consumo.
Prefacturas reservan ítems y cantidades para documentos operativos.
Caja es la interfaz autorizada para cobrar documentos emitidos.
Payments registra transacciones, saldos, reversos e idempotencia.
Kitchen administra preparación y comandas.
Printing administra plantillas, colas, reintentos y dispositivos.
Settings administra parámetros, incluida la pestaña Impresoras.
Reporting consulta la cuenta global como fuente financiera única.
```

Cambio operativo aprobado:

```text
Dashboard no procesa dinero.
Cuentas no recibe efectivo ni tarjeta.
Cuentas emite prefacturas.
Caja cobra prefacturas.
```

Payments e Printing son servicios internos. Caja sí es una sección visible accesible desde el header para usuarios con capacidad autorizada.

## 2. Documentos canónicos

Antes de implementar cualquier fase deben revisarse:

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

## 3. Fuente de verdad financiera

La fuente financiera única es la cuenta global asociada a la mesa o banco.

```text
Cuenta global
├── cliente principal
├── mesa/banco y zona
├── responsables de atención
├── consumo acumulado
├── documentos operativos
├── pagos aplicados
├── total pagado consolidado
└── saldo consolidado
```

Las prefacturas y recibos parciales tienen números y pagadores propios, pero no se contabilizan como ventas independientes.

```text
Una cuenta global de ₡5.000
+ dos documentos de ₡3.000 y ₡2.000
= una venta consolidada de ₡5.000
+ dos movimientos de Caja que suman ₡5.000
```

El reporte de ventas cuenta una cuenta global. El reporte de Caja cuenta transacciones monetarias.

## 4. Invariantes de arquitectura

Estas reglas no pueden romperse durante la migración:

1. El backend recalcula precios, totales y saldos.
2. Las operaciones críticas usan transacciones SQLite.
3. La emisión de prefactura reserva cantidades, no borra consumo.
4. Una unidad no puede pertenecer a dos prefacturas válidas.
5. Pagar una prefactura no libera la mesa.
6. Payments nunca cierra la cuenta principal por sí solo.
7. La cuenta global conserva cliente principal y responsables.
8. Los documentos parciales no duplican ventas.
9. La impresión ocurre después de persistir el documento.
10. Un error de impresión no duplica prefacturas ni pagos.
11. El cierre de mesa es explícito y transaccional.
12. Las rutas legacy solo permanecen como adaptadores temporales.
13. PC y móvil deben ofrecer la misma capacidad con presentación adecuada a cada formato.
14. No se avanza a una fase posterior sin prueba, documentación y git seguro.

## 5. Versionado

- **Versión visible:** `3.0`.
- **Versión técnica:** `v3.x.x`.
- Los dominios mayores incrementan el segundo número.
- Las subfases incrementan el tercer número.
- Una corrección derivada de una fase aprobada usa `fixN`.

---

# Fase documental y fundaciones

## v3.0.0 · Auditoría y contrato arquitectónico

### Objetivo

- verificar la viabilidad de separar Orders, Payments, Kitchen y Printing;
- definir la compatibilidad visible;
- identificar riesgos de atomicidad, autorización, división e impresión;
- fijar MundiPOS 3.0 como nueva etapa.

### Commit

```powershell
git commit -m "v3.0.0: documenta arquitectura modular y compatibilidad operativa"
```

---

## v3.0.0 fix1 · Auditoría de Caja, prefacturas y subcuentas

### Objetivo

- definir Caja como sección visible del header;
- definir Cajero como rol/capacidad operativa;
- separar atención, emisión, cobro y cierre;
- aprobar división una subcuenta a la vez;
- permitir continuidad de consumo después de pagos parciales.

### Commit

```powershell
git commit -m "v3.0.0 fix1: audita Caja prefacturas y subcuentas"
```

---

## v3.0.0 fix2 · Fuente financiera única y roadmap consolidado

### Objetivo

- fijar la cuenta global como única fuente financiera interna;
- separar venta consolidada de movimientos individuales de Caja;
- impedir que documentos parciales dupliquen ingresos;
- documentar que pagadores parciales no reemplazan cliente ni responsable principal;
- consolidar el README del proceso y el roadmap definitivo de implementación.

### Alcance

Solo documentación. No modifica lógica, base de datos, PWA ni versión técnica.

### Criterio de aprobación

- existen README canónico y README v3 actualizados;
- el contrato financiero diferencia cuenta, documentos y pagos;
- todas las fases posteriores incorporan la regla de consolidación;
- no quedan contradicciones entre cierre de mesa, pago parcial y reportes.

### Commit

```powershell
git commit -m "v3.0.0 fix2: consolida fuente financiera y roadmap v3"
```

---

## v3.0.1 · Infraestructura transaccional y pruebas base

**Estado:** implementada; pendiente validación operativa y commit seguro.

### Objetivo

Crear la base común antes de modificar dinero, cantidades, documentos o cierre de mesas.

### Cambios previstos

- `database.withTransaction()`;
- soporte `BEGIN IMMEDIATE` para mutaciones críticas;
- commit/rollback centralizados;
- errores de dominio con códigos estables;
- utilidades monetarias y redondeo determinista;
- utilidades de idempotencia;
- SQLite temporal para pruebas;
- fixtures mínimos de usuarios, roles, zonas, mesas, productos y pedidos;
- `npm test` funcional;
- primera prueba de concurrencia controlada.

### Archivos orientativos

```text
server/db/database.js
server/services/transactionService.js
server/errors/domainError.js
server/utils/money.js
tests/helpers/testDatabase.js
tests/fixtures/
package.json
```

### Criterios de aprobación

- rollback comprobado ante una falla intermedia;
- dos mutaciones concurrentes no crean datos incompatibles;
- cálculos monetarios repetibles;
- suite ejecutable en una base temporal;
- ningún flujo visible cambia todavía.

### Implementación realizada

- `database.withTransaction()` con conexión aislada, cola, modos SQLite y savepoints;
- `transactionService` como fachada para servicios futuros;
- errores de dominio con códigos estables;
- utilidades monetarias e idempotencia;
- SQLite temporal y fixtures mínimos;
- `npm test` con 11 pruebas aprobadas;
- package y seguimiento interno actualizados a `3.0.1`;
- sin cambios visuales ni migración de rutas operativas.

Documento:

```text
docs/avance-v3.0.1-infraestructura-transaccional-pruebas.md
```

### Commit

```powershell
git commit -m "v3.0.1: agrega base transaccional y pruebas de dominio"
```

---

## v3.0.2 · Capacidades, rol Cajero y navegación autorizada

### Estado

```text
IMPLEMENTADO · pendiente de validación operativa y git seguro
```

### Objetivo

Separar permisos funcionales de rol de sistema y acceso por zona, habilitando un cajero exclusivo o combinado sin convertir `cajero` en un tercer tipo rígido de usuario.

### Cambios implementados

- tablas `capacidades` y `rol_trabajo_capacidades`;
- columnas `requiere_zona`, `es_sistema` y `destino_inicial` en `roles_trabajo`;
- catálogo canónico de capacidades en `server/security/capabilities.js`;
- servicio de resolución de capacidades por roles activos;
- middleware `requireCapability()` con administrador como acceso total;
- rol de sistema `Cajero`, sin zona y con destino inicial Caja;
- capacidades incluidas en sesión y payload de usuario;
- unión de capacidades para usuarios con varios roles activos;
- botón Caja en el header condicionado por `cash.access`;
- destino inicial Caja para usuario exclusivamente cajero;
- ocultamiento de módulos no autorizados en PC y móvil;
- sección base Caja y endpoint protegido de resumen;
- gestión administrativa de capacidades dentro de roles de trabajo;
- soporte de roles sin zona en Usuarios y sesión operativa;
- protección de la ruta legacy de pago con `cash.collect`.

### Capacidades registradas

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

### Compatibilidad temporal

Para no bloquear a los usuarios actuales durante la transición, la migración ejecuta una sola vez un backfill sobre roles operativos existentes. Estos reciben las capacidades de atención y las capacidades legacy mínimas de Caja.

El administrador debe poder revisar posteriormente cada rol y retirar `cash.access`, `cash.collect` o `cash.reprint` cuando el negocio utilice un cajero exclusivo.

La compatibilidad no sustituye el modelo final: desde esta fase toda operación nueva debe depender de capacidades explícitas.

### Archivos principales

```text
server/security/capabilities.js
server/services/capabilityService.js
server/middleware/requireCapability.js
server/routes/cash.js
public/js/components/cash.js
```

También se actualizan autenticación, Usuarios, Zonas/Roles, Orders, Dashboard, navegación, base de datos, estilos, PWA y pruebas.

### Pruebas automáticas

La suite queda en 15 casos aprobados, incluyendo:

- esquema de capacidades;
- creación/normalización del rol Cajero;
- cajero exclusivo sin zona;
- usuario mixto con unión de capacidades;
- administrador con acceso total;
- cobertura transaccional, monetaria e idempotencia de `v3.0.1`.

### Criterios de aprobación operativa

- cajero exclusivo puede iniciar sesión sin zona y entra a Caja;
- usuario mixto conserva atención y accede a Caja;
- usuario sin `cash.access` no ve el botón Caja;
- usuario sin `cash.collect` recibe `403 CAPABILITY_REQUIRED` al intentar llamar manualmente la ruta de pago;
- administrador puede editar capacidades de roles;
- navegación PC/móvil respeta capacidades;
- usuarios actuales continúan operando después de la migración;
- `npm test` termina con 15 pruebas y 0 fallos.

### Commit

```powershell
git commit -m "v3.0.2: agrega capacidades y rol operativo de Cajero"
```

---

## v3.0.3 · Acceso operativo compartido y realtime por capacidades

### Objetivo

Centralizar capacidades, zonas efectivas, responsabilidad, navegación y filtrado realtime en una política operativa común para backend y frontend.

### Implementación

Se agregan:

```text
server/services/operationalAccessService.js
public/js/services/operational-access.js
```

El servicio backend resuelve:

- usuario y condición de administrador;
- roles activos de la sesión;
- capacidades efectivas;
- zonas visibles/operables;
- responsabilidad sobre mesas;
- secciones autorizadas;
- destino inicial;
- recepción autorizada de eventos SSE.

El servicio frontend consume la política `acceso_operativo` entregada por sesión y adapta navegación/realtime, sin reemplazar la autorización backend.

### Integraciones

- `requireCapability()` utiliza el contexto compartido;
- Auth entrega `acceso_operativo`;
- Dashboard, Zonas y Menú requieren `orders.operate`;
- Orders filtra cuentas por zonas y verifica responsabilidad en mutaciones;
- Caja conserva acceso sin zona mediante `cash.access`;
- rutas de comandas requieren `kitchen.operate`;
- cambios de usuario/rol emiten eventos dirigidos;
- el cliente actualiza sesión, navegación y SSE cuando cambia su política.

### Realtime

La entrega SSE se filtra por:

```text
capacidad requerida
zona relacionada
usuario objetivo
alcance funcional
mesa/pedido/comanda relacionados
```

Esto evita que:

- un usuario de otra zona reciba datos operativos ajenos;
- un cajero exclusivo reciba eventos de mesas;
- cambios privados de roles se difundan globalmente.

### Pruebas

La suite asciende a 21 casos aprobados.

Cobertura nueva:

- política combinada para usuario mixto;
- aislamiento del cajero exclusivo;
- filtrado realtime entre zonas;
- responsabilidad compartida de mesa;
- paridad frontend/backend para secciones y eventos.

Comandos:

```powershell
npm test
npm run test:access
```

### Criterios de aprobación

- Orders, Caja, Dashboard, Zonas y Menú consultan la política compartida;
- usuarios sin capacidad reciben bloqueo backend aunque manipulen la UI;
- eventos no filtran datos de otra zona o usuario;
- cambios de rol/capacidad actualizan navegación sin recarga manual completa;
- cajero exclusivo conserva Caja y no recibe datos de atención;
- frontend y backend mantienen paridad comprobada;
- `npm test` termina con 21 pruebas y 0 fallos.

### Archivos esperados

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/avance-v3.0.3-acceso-operativo-realtime.md
package.json
package-lock.json
server/config/appInfo.js
server/services/operationalAccessService.js
server/middleware/requireCapability.js
server/routes/auth.js
server/routes/dashboard.js
server/routes/tables.js
server/routes/menu.js
server/routes/orders.js
server/routes/users.js
server/utils/realtime.js
public/js/services/operational-access.js
public/js/main.js
public/js/components/cash.js
public/index.html
public/service-worker.js
tests/operationalAccessService.test.js
tests/operationalAccessParity.test.js
```

### Commit

```powershell
git commit -m "v3.0.3: centraliza acceso operativo y realtime por capacidades"
```

---

# Dominio de Cuentas y prefacturas

## v3.1.0 · Cuenta global y servicio de dominio de Cuentas

### Estado

Implementado y preparado para validación operativa.

### Objetivo

Convertir la cuenta principal en entidad canónica explícita y extraer las reglas de `server/routes/orders.js`.

### Cambios implementados

- `server/services/accountService.js` como servicio de dominio;
- número interno único `CTA-########`;
- cliente principal y snapshots de mesa/banco y zona;
- tabla `cuenta_responsables` para responsabilidad histórica;
- subtotal, servicio, total pagado y saldo consolidados;
- estados operativo y financiero separados;
- fechas de apertura, conciliación y cierre;
- migración de pedidos legacy;
- creación y agregado de productos transaccionales;
- lecturas sin mutaciones ocultas;
- rutas `/api/orders` conservadas como adaptadores;
- resumen de Caja basado en saldo de cuentas abiertas;
- pruebas de dominio y migración.

### Regla financiera

El servicio de Cuentas es propietario del agregado financiero global. Payments aporta transacciones confirmadas, pero no redefine la venta.

### Criterios de aprobación

- una cuenta se consulta sin mutaciones ocultas;
- total, pagado y saldo se calculan con una sola regla canónica;
- la cuenta conserva cliente principal y responsables;
- crear cuenta y líneas es una transacción única;
- una falla intermedia no deja cuenta incompleta;
- un pago parcial puede mantener la cuenta operativamente abierta;
- el router delega las reglas principales al servicio;
- `npm run test:accounts` y `npm test` pasan sin fallos.

### Archivos principales

```text
server/services/accountService.js
server/db/database.js
server/routes/orders.js
server/routes/cash.js
tests/accountService.test.js
tests/globalAccountMigration.test.js
```

### Commit

```powershell
git commit -m "v3.1.0: crea cuenta global y servicio de dominio de Cuentas"
```

---

## v3.1.1 · Líneas de consumo y cantidades disponibles

**Estado:** completada.

### Objetivo

Preparar cada línea para asignación parcial sin borrar historial ni cobrar unidades dos veces.

### Implementación realizada

- identidad estable mediante `pedido_producto_id`;
- `cantidad_consumida`, `cantidad_asignada` y `cantidad_disponible`;
- snapshots de producto, presentación, precio y servicio;
- versión por línea para detectar cambios concurrentes;
- asignación y liberación transaccional de cantidades;
- agrupación previa de selecciones repetidas;
- consolidación solo sobre líneas totalmente disponibles y equivalentes;
- bloqueo de edición legacy ambigua, con presentación o con cantidades asignadas;
- read models separados para historial, consumo activo y consumo asignado;
- migración idempotente de líneas existentes.

### Fórmula canónica

```text
cantidad_disponible
= cantidad_consumida
- cantidad_asignada_a_prefacturas_no_anuladas
```

En esta fase el contador ya existe y se prueba mediante el servicio de dominio. `v3.1.2` será responsable de vincularlo a prefacturas persistentes.

### Criterios aprobados

- una línea de cantidad 3 puede distribuirse `2 + 1`;
- no puede distribuirse `2 + 2`;
- una asignación fallida no deja cambios parciales;
- las líneas asignadas permanecen en historial y desaparecen del consumo disponible;
- una anulación futura podrá liberar cantidades sin borrar consumo;
- nuevo consumo crea o consolida líneas solo cuando es seguro;
- una línea modificada en otro dispositivo se rechaza por versión.

### Validación

```text
36 pruebas aprobadas
0 fallos
migración validada sobre copia de base operativa
```

### Commit

```powershell
git commit -m "v3.1.1: normaliza lineas y cantidades de consumo"
```

---

## v3.1.2 · Secuencias y modelo persistente de prefacturas

**Estado:** completada.

### Objetivo

Crear documentos operativos persistentes y trazables sin convertirlos en ventas financieras independientes.

### Implementación realizada

- `secuencias_documentales` con numeración `PF-########`;
- numeración y persistencia dentro de la misma transacción;
- `prefacturas` vinculadas a la cuenta global;
- ordinal propio dentro de cada cuenta;
- tipos `completa` y `dividida`;
- pagador visible separado del cliente principal;
- estados documentales y de impresión;
- snapshots de cuenta, mesa/banco, zona, cliente y responsables;
- `prefactura_items` con cantidades, precios y servicio congelados;
- `historial_prefacturas` para emisión y anulación;
- idempotencia opcional para evitar duplicados por reintento;
- anulación de documentos sin pagos con devolución de cantidades;
- helpers transaccionales reutilizables en `accountService`;
- migración e índices idempotentes.

### Regla financiera

```text
prefacturas = distribución y cobro operativo
cuenta global = única venta financiera
```

La suma de documentos puede explicar cómo se liquidó la cuenta, pero no crea múltiples ventas en reportes.

### Atomicidad

Una sola transacción contiene:

```text
reserva de cantidades
numeración
prefactura
ítems
historial
estado documental de la cuenta
```

Una falla revierte todos esos elementos, incluida la secuencia.

### Criterios aprobados

- dos dispositivos no reservan la misma cantidad;
- números concurrentes son distintos;
- un rollback no consume definitivamente el número;
- una clave de idempotencia no duplica documentos;
- una anulación sin pagos devuelve cantidades;
- cada documento conserva snapshots aunque cambie Menú;
- la cuenta global conserva su total completo;
- la migración no reinicia secuencias existentes.

### Validación

```text
11 pruebas específicas aprobadas
47 pruebas totales aprobadas
0 fallos
PRAGMA foreign_key_check: 0 incidencias
```

Documento:

```text
docs/avance-v3.1.2-secuencias-prefacturas.md
```

### Commit

```powershell
git commit -m "v3.1.2: agrega modelo transaccional de prefacturas"
```

---

## v3.1.3 · División una subcuenta a la vez

**Estado:** implementada; pendiente de validación operativa y commit.

### Objetivo

Implementar el flujo aprobado dentro de `Ver pedido` usando el modelo persistente de `v3.1.2`.

### Flujo implementado

1. activar `Cuenta dividida`;
2. seleccionar ítems de un solo cliente;
3. indicar cantidades cuando una línea dispone de varias unidades;
4. visualizar unidades y total parcial;
5. pulsar `Emitir prefactura parcial`;
6. abrir minimodal;
7. escribir nombre del cliente/pagador;
8. revisar productos, subtotal, servicio y total;
9. usar `Volver` o `Imprimir y emitir`;
10. regresar al consumo restante y repetir para el siguiente cliente.

### Reglas implementadas

- no se construyen dos subcuentas simultáneamente;
- la selección es temporal hasta confirmar;
- `Volver` conserva la selección y no escribe en SQLite;
- cada confirmación usa una clave de idempotencia;
- la prefactura se persiste antes de abrir impresión;
- las cantidades emitidas dejan de aparecer como disponibles;
- documentos previos bloquean la cuenta como dividida;
- el backend vuelve a validar cantidades, versiones, zona, responsabilidad y capacidades;
- una prefactura `completa` debe coincidir exactamente con todo el consumo disponible;
- la división legacy mediante `productos_divididos` queda rechazada;
- el pago legacy queda bloqueado cuando existen prefacturas o cantidades asignadas.

### API

```text
GET  /api/orders/:id/preinvoices
GET  /api/orders/:id/preinvoices/:preinvoiceId
POST /api/orders/:id/preinvoices
```

Capacidades:

```text
orders.operate
orders.issue_preinvoice
orders.split              solo para cuenta dividida
```

### Impresión transitoria

`Imprimir y emitir` utiliza una ventana imprimible del navegador. No confirma ni cambia `estado_impresion`, porque la cola, los drivers y los reintentos pertenecen a `v3.4.x`.

### Realtime

Las emisiones se publican con alcance `cuentas`, visible para atención autorizada por zona y para Caja con `cash.access`.

### Criterios de aprobación

- Imperial 3 se divide correctamente como 2 + 1;
- el minimodal coincide con el cálculo backend;
- `Volver` no reserva cantidades;
- confirmar sí reserva y persiste;
- la segunda división muestra únicamente cantidades restantes;
- cada prefactura tiene número y pagador propios;
- la cuenta global conserva el total financiero único;
- no es posible cobrar por el flujo legacy una cuenta ya documentada;
- PC y móvil permiten completar el mismo flujo.

### Pruebas

```powershell
npm run test:division
npm test
```

Resultado de preparación:

```text
13 pruebas específicas aprobadas
53 pruebas totales aprobadas
0 fallos
```

### Documento

```text
docs/avance-v3.1.3-division-subcuenta.md
```

### Commit

```powershell
git commit -m "v3.1.3: agrega emision guiada de prefacturas divididas"
```

---

## v3.1.4 · Continuidad del consumo después de documentos y pagos

### Objetivo

Permitir que una mesa siga activa aunque se hayan emitido o pagado subcuentas, separando el estado operativo del servicio del estado financiero de sus documentos.

### Implementación

- las líneas distinguen cantidad disponible, documentada pendiente, pagada y reservada sin documento;
- `getAccount()` entrega vistas separadas de consumo activo, documentos pendientes e historial liquidado;
- una cuenta abierta puede tener saldo temporal cero sin liberar la mesa;
- los productos nuevos se registran en líneas independientes cuando la línea histórica ya tiene asignaciones;
- el total global acumulado se recalcula sin modificar cliente ni responsables;
- el pago normal legacy sin prefacturas liquida solo el saldo actual dentro de una transacción;
- el adaptador de pago ya no cambia la cuenta a pagada ni la mesa a libre;
- la UI informa que el servicio continúa abierto y oculta el pago cuando no existe saldo;
- las reservas sin documento se muestran como alerta de integridad.

### Límites de esta fase

- no se registra todavía el pago real por prefactura desde Caja;
- el flujo de crédito continúa pendiente de `v3.2.4`;
- el cierre explícito y la liberación definitiva de mesa corresponden a `v3.2.5`.

### Criterios de aprobación

- Juan paga y se retira;
- los ítems de Juan no vuelven a seleccionarse;
- María y otros clientes siguen consumiendo;
- se agregan productos nuevos;
- el total global aumenta correctamente;
- un saldo cero puede coexistir con una cuenta abierta;
- la mesa, el cliente principal y los responsables permanecen activos;
- una liquidación posterior cobra únicamente el consumo nuevo.

### Validación automática

```powershell
npm run test:continuity
npm test
```

Resultado esperado:

```text
4 pruebas específicas aprobadas
57 pruebas totales aprobadas
0 fallos
```

### Documento

```text
docs/avance-v3.1.4-continuidad-consumo.md
```

### Commit

```powershell
git commit -m "v3.1.4: mantiene cuentas activas tras pagos parciales"
```

---

## v3.1.5 · Read model financiero consolidado

### Estado

Implementado.

### Objetivo

Crear una lectura única para Dashboard, reportes, Caja y cierre sin sumar documentos parciales como ventas independientes.

### Implementación

```text
financialReadService
├── cuenta global consolidada
├── documentos operativos
├── movimientos de Caja
├── resumen por período
└── estadísticas por fecha financiera
```

Lecturas expuestas:

```text
Cuenta global
Total consumido
Total documentado
Total pagado
Saldo
Cantidad de documentos
Cantidad de pagos
Estado operativo
Estado financiero
Cliente principal
Responsable principal
Fecha de conciliación
Observación financiera
```

### Regla de reportes

- venta: una cuenta global conciliada;
- movimientos de Caja: una fila por pago;
- pagadores parciales: detalle operativo de prefacturas;
- responsable comercial: snapshot de la cuenta global;
- fecha de venta: conciliación vigente;
- fecha de movimiento: fecha individual del pago.

### Resultado validado

- ₡3.000 + ₡2.000 no aparecen como dos ventas adicionales;
- Caja muestra ambos movimientos;
- una cuenta global de ₡5.000 produce una sola venta de ₡5.000;
- el cliente principal sigue siendo Juan aunque Pedro pague una parte;
- un pago parcial no crea una venta conciliada;
- nuevo consumo retira una conciliación temporal hasta el siguiente pago total;
- 5 pruebas específicas y 62 pruebas totales aprobadas.

### Limitación trasladada a Payments

La tabla legacy `pagos` todavía no tiene `prefactura_id`. El vínculo exacto entre movimiento, prefactura, pagador y cajero se implementará en `v3.2.0`.

### Documento

```text
docs/avance-v3.1.5-read-model-financiero.md
```

### Commit

```powershell
git commit -m "v3.1.5: agrega lectura financiera consolidada por cuenta"
```

---

# Payments y Caja

## v3.2.0 · Núcleo backend de Payments por prefactura

### Estado

Completada.

### Objetivo

Crear `paymentService` y un modelo monetario transaccional que aplique movimientos a una prefactura concreta y consolide su efecto sobre la cuenta global.

### Entidades implementadas

```text
pagos
pago_componentes
reversos_pago
claves_idempotencia
```

### Cambios implementados

- vínculo exacto `pago → prefactura → cuenta global`;
- número único `PG-########` generado transaccionalmente;
- cajero y pagador guardados como snapshots;
- estados `pendiente`, `confirmado` y `anulado`;
- referencia opcional;
- componentes de subtotal y servicio;
- idempotencia separada para crear y anular;
- pagos parciales por prefactura;
- reverso autorizado a nivel de servicio;
- actualización transaccional de saldo y estado de prefactura;
- actualización consolidada de total pagado, saldo y estado financiero de la cuenta global;
- exclusión de movimientos anulados en Dashboard, Caja y reportes;
- migración y numeración de pagos legacy.

### Reglas

```text
Payments registra movimientos, no ventas.
Solo pagos confirmados afectan saldos y reportes.
Un pago de prefactura no libera mesa ni cierra servicio.
La cuenta global continúa siendo la única fuente financiera.
```

`paymentService` admite `efectivo` y `tarjeta` como movimientos base. Efectivo recibido, vuelto y combinaciones operativas quedan para `v3.2.3`; crédito se integra en `v3.2.4`.

### Criterios aprobados

- doble clic con la misma clave no duplica un pago;
- una clave reutilizada con datos diferentes genera conflicto;
- dos dispositivos no cobran dos veces el mismo saldo;
- un monto superior al saldo se rechaza sin escrituras parciales;
- un reverso restaura el saldo documental y global;
- pagos anulados no forman parte de ventas ni movimientos confirmados;
- una prefactura pagada puede coexistir con una cuenta operativamente abierta;
- la mesa permanece ocupada hasta la finalización explícita.

### Validación

```text
8 pruebas específicas de Payments
70 pruebas totales
0 fallos
```

Migración sobre copia operativa:

```text
15 pagos preservados y numerados
30 componentes creados
0 problemas de claves foráneas
```

### Documento

```text
docs/avance-v3.2.0-payments-prefactura.md
```

### Commit

```powershell
git commit -m "v3.2.0: crea Payments transaccional por prefactura"
```

---

## v3.2.0 fix1 · Actualización compatible de dependencias

### Estado

Completada.

### Objetivo

Aplicar las correcciones que npm puede resolver sin cambios mayores y conservar una instalación reproducible en `package-lock.json`.

### Reglas

- no usar `npm audit fix --force`;
- ejecutar la suite completa después de modificar el lockfile;
- no incluir `node_modules`;
- mantener la versión funcional en `3.2.0`.

### Commit

```powershell
git commit -m "v3.2.0 fix1: actualiza dependencias compatibles de seguridad"
```

---

## v3.2.0 fix2 · Actualización controlada del driver SQLite

### Estado

En validación operativa.

### Objetivo

Actualizar explícitamente `sqlite3 5.1.7` a `sqlite3 6.0.1` para eliminar la cadena vulnerable heredada de `node-gyp`, `cacache`, `make-fetch-happen` y `tar`, sin alterar la capa de dominio.

### Implementación

Se agregan:

```text
scripts/upgrade-sqlite3.ps1
tests/sqliteDriverCompatibility.test.js
docs/avance-v3.2.0-fix2-sqlite3.md
```

El script:

- exige Node.js `>=20.17.0`;
- valida Windows x64 cuando corresponde;
- evita actualizar con el servidor usando el puerto 3000;
- respalda `package.json` y `package-lock.json`;
- instala exactamente `sqlite3@6.0.1`;
- regenera la instalación con `npm ci`;
- ejecuta la prueba nativa y la suite completa;
- ejecuta `npm audit --omit=dev --audit-level=high`;
- restaura los manifests si falla.

### Criterios de aprobación

- `npm ls sqlite3 --depth=0` muestra `sqlite3@6.0.1`;
- `npm ci` termina correctamente en Windows con Node 24;
- la prueba nativa valida WAL, commit, rollback, FK e integridad;
- las 70 pruebas previas y la prueba nueva terminan sin fallos;
- MundiPOS inicia por HTTPS;
- las migraciones se ejecutan sin cambios inesperados;
- la base conserva información después de reiniciar;
- no quedan vulnerabilidades altas de producción;
- `data/restaurant.db` no se agrega al commit.

### Deuda técnica

El upstream de `sqlite3` está deprecado y sin mantenimiento activo. La sustitución por un driver mantenido se evaluará después de estabilizar Payments y no formará parte de esta corrección.

### Commit

```powershell
git commit -m "v3.2.0 fix2: actualiza driver SQLite de forma controlada"
```

---

## v3.2.1 · API y read model operativo de Caja

**Estado: implementada.**

### Objetivo

Exponer Payments mediante endpoints específicos de Caja, con lectura agrupada por cuenta global y operación monetaria por prefactura.

### Implementación

- servicio `cashReadService`;
- cola de prefacturas pendientes;
- agrupación de documentos bajo una cuenta global;
- búsqueda por documento, cuenta, mesa/banco, zona, cliente principal, pagador o responsable;
- detalle de prefactura con ítems, pagos y contexto financiero;
- lectura consolidada de cobro de una cuenta;
- registro de pagos idempotentes por prefactura;
- consulta individual de pagos;
- reverso auditable;
- solicitud de reimpresión auditada sin simular una impresión física;
- realtime para Caja y Payments.

### API

```text
GET  /api/cash/queue                              cash.access
GET  /api/cash/preinvoices/:id                    cash.access
GET  /api/cash/preinvoices/:id/payments           cash.access
POST /api/cash/preinvoices/:id/payments           cash.collect
POST /api/cash/preinvoices/:id/reprint-request    cash.reprint
GET  /api/cash/payments/:id                       cash.access
POST /api/cash/payments/:id/void                  cash.reverse
GET  /api/cash/accounts/:id/collection-read       cash.access
```

Los cobros y reversos requieren `Idempotency-Key`. El cajero se obtiene de la sesión autenticada.

### Invariantes

```text
prefactura pagada ≠ mesa liberada
pagador parcial ≠ cliente principal
varias prefacturas ≠ varias ventas
reimpresión solicitada ≠ impresión física confirmada
```

### Criterios de aprobación

- cajero encuentra una prefactura por número, cuenta, mesa, zona, cliente, pagador o responsable;
- una cuenta dividida aparece una vez con sus documentos separados;
- detalle de documento coincide con Payments y Cuentas;
- pago parcial actualiza solo el saldo del documento;
- pago completo no cierra la cuenta operativa;
- doble solicitud con la misma clave no duplica el pago;
- usuario sin `cash.collect` no puede cobrar;
- usuario sin `cash.reverse` no puede anular;
- reimpresión queda auditada y pendiente de Printing;
- 76 pruebas funcionales terminan sin fallos;
- en Windows, `npm test` valida también las dos pruebas nativas de SQLite.

### Archivos

```text
server/services/cashReadService.js
server/routes/cash.js
tests/cashReadService.test.js
docs/avance-v3.2.1-api-read-model-caja.md
```

### Commit

```powershell
git commit -m "v3.2.1: agrega API operativa de Caja"
```

---

## v3.2.2 · Sección visual Caja y modal de cobro

**Estado: implementada.**

### Objetivo

Conectar la API de Caja con una interfaz visible, autorizada y adaptable, sin exponer Payments como módulo técnico ni permitir cobros directos desde Dashboard.

### Implementación

- botón `Caja` del header conservado como acceso principal;
- destino inicial Caja para cajero exclusivo;
- resumen de cuentas, documentos, saldo documental, ventas globales y movimientos;
- bandeja agrupada por cuenta global;
- búsqueda por documento, cuenta, mesa/banco, zona, cliente, pagador o responsable;
- filtros por estado;
- panel de detalle con cuenta global, ítems, saldo e historial de pagos;
- modal para abono o pago completo;
- métodos simples `efectivo` y `tarjeta`;
- referencia requerida en la UI para tarjeta;
- clave `Idempotency-Key` por envío;
- bloqueo local durante el procesamiento;
- actualización de cola, detalle, resumen y movimientos después del cobro;
- reimpresión auditada mediante navegador;
- layouts específicos para PC y móvil;
- caché PWA `v3.2.2-cash-ui`;
- Dashboard sin acceso directo al modal de pago;
- Orders convertido en fachada de navegación hacia Caja.

### Flujo

```text
Caja
→ buscar cuenta o prefactura
→ seleccionar documento
→ verificar pagador, ítems y saldo
→ abrir modal de cobro
→ registrar pago idempotente
→ actualizar documento y cuenta global
→ mantener mesa operativamente abierta
```

### Capacidades

```text
cash.access   consulta la bandeja y el detalle
cash.collect  habilita el botón y la mutación de cobro
cash.reprint  habilita la solicitud de reimpresión
```

La autorización backend de `v3.2.1` permanece como fuente real de seguridad.

### PC

- cola y detalle en dos paneles;
- tablas de ítems y movimientos;
- filtros visibles;
- saldo documental destacado.

### Móvil

- cards compactas;
- cola y detalle apilados;
- scroll al documento seleccionado;
- controles táctiles;
- modal de ancho completo;
- caché actualizado para PWA instalada.

### Límites de fase

No incluye todavía:

- efectivo recibido;
- cálculo y validación de vuelto;
- pagos mixtos;
- medios configurables;
- reverso visual;
- impresión física o cola Printing;
- finalización del servicio.

### Criterios de aprobación

- el cajero exclusivo entra a Caja;
- el usuario mixto abre Caja sin perder su sesión operativa;
- una cuenta dividida aparece agrupada con documentos separados;
- búsqueda y filtros localizan documentos;
- el detalle coincide con la cuenta global;
- el modal permite abono o liquidación simple;
- el envío repetido no duplica pagos;
- usuario sin `cash.collect` no ve acción operativa y backend lo bloquea;
- Dashboard no inicia cobros;
- Orders abre Caja en vez de procesar dinero;
- una prefactura pagada mantiene la mesa abierta;
- PC y móvil completan el mismo flujo;
- 6 pruebas específicas de UI terminan sin fallos;
- en Windows, la suite completa con sqlite3 instalado termina con 84 pruebas.

### Archivos

```text
public/js/components/cash.js
public/js/components/dashboard.js
public/js/components/orders.js
public/css/style.css
public/index.html
public/service-worker.js
server/config/appInfo.js
tests/cashUiWorkflow.test.js
docs/avance-v3.2.2-caja-visual-modal-cobro.md
```

### Commit

```powershell
git commit -m "v3.2.2: agrega Caja visual y modal de cobro"
```

---

## v3.2.3 · Efectivo, vuelto, tarjeta y pagos mixtos ✅

**Estado: implementada y validada.**


### Objetivo

Completar los métodos de cobro.

### Cambios previstos

- efectivo recibido;
- vuelto calculado y validado;
- tarjeta con referencia/autorización;
- medios configurables;
- pagos mixtos mediante componentes o múltiples transacciones;
- saldo actualizado en tiempo real;
- bloqueo durante envío;
- confirmación y errores claros.

### Criterios de aprobación

- no se permite vuelto negativo;
- no se cobra más del saldo salvo regla explícita de efectivo/vuelto;
- un pago mixto concilia exactamente;
- método y cajero quedan auditados;
- PC y móvil completan el mismo flujo.

### Commit

```powershell
git commit -m "v3.2.3: agrega efectivo tarjeta vuelto y pagos mixtos"
```

---

## v3.2.4 · Integración de créditos con Payments

### Objetivo

Consolidar el crédito dentro del modelo financiero sin eliminar la pantalla visible de Créditos.

### Cambios previstos

- un documento puede trasladarse a crédito con autorización;
- `creditService` usa la cuenta global y la prefactura;
- abonos pasan por Payments;
- consolidación de `accounts.js` y `credits.js` backend;
- adaptación gradual del frontend;
- historial y documentos de abono;
- rutas duplicadas deprecadas después de migrar consumidores.

### Criterios de aprobación

- trasladar a crédito no libera cantidades ni duplica venta;
- abonos actualizan el saldo correcto;
- la cuenta global refleja el estado `credito`;
- reportes distinguen venta, crédito y movimiento de Caja.

### Commit

```powershell
git commit -m "v3.2.4: integra creditos con Payments y cuenta global"
```

---

## v3.2.5 · Finalización del servicio y liberación integral

### Objetivo

Crear una acción explícita para cerrar la operación de la mesa.

### Validaciones

- no quedan cantidades sin prefacturar;
- no quedan prefacturas pendientes;
- no hay pagos procesándose;
- créditos formalizados;
- saldo consolidado válido;
- versión de la cuenta no cambió durante la validación.

### Transacción de cierre

- conciliar cuenta global;
- fijar total final y fecha financiera;
- cerrar estado operativo;
- liberar mesa/banco;
- limpiar responsables;
- registrar historial;
- emitir realtime;
- preparar documentos finales si corresponden.

### Regla

Saldo cero no libera automáticamente la mesa.

### Criterios de aprobación

- no se cierra una mesa con consumo nuevo no documentado;
- no se cierra con una prefactura pendiente;
- después del cierre no se agregan productos;
- Dashboard, Zonas, Caja y responsable se actualizan;
- la venta consolidada aparece una sola vez.

### Commit

```powershell
git commit -m "v3.2.5: finaliza servicio y libera mesas integralmente"
```

---

# Kitchen y comandas

## v3.3.0 · Dominio Kitchen / Comandas

### Objetivo

Separar de Orders la lógica de preparación.

### Cambios previstos

- `kitchenService`;
- creación de comanda por cambios nuevos;
- destino cocina/bar;
- ítems nuevos, modificados y anulados;
- identidad de línea;
- responsable y tiempos;
- Orders solicita la operación, Kitchen decide el contenido.

### Criterios de aprobación

- agregar productos genera solo los nuevos ítems de comanda;
- un producto no cocina no se envía;
- una presentación conserva su descripción correcta;
- reenvíos quedan auditados;
- la impresión no define el estado de preparación.

### Commit

```powershell
git commit -m "v3.3.0: separa dominio de Kitchen y comandas"
```

---

## v3.3.1 · Trazabilidad operativa de comandas

### Estados

```text
pendiente
enviada
en_preparacion
lista
entregada
anulada
```

### Objetivo

- historial por ítem;
- usuario responsable;
- timestamps;
- cambios y anulaciones;
- recuperación después de reinicio;
- read model para cocina/bar.

### Commit

```powershell
git commit -m "v3.3.1: agrega trazabilidad operativa de comandas"
```

---

# Printing e impresoras

## v3.4.0 · Núcleo y cola de Printing

### Objetivo

Crear una infraestructura transversal de documentos e impresión.

### Entidades previstas

```text
trabajos_impresion
intentos_impresion
plantillas_documento
```

### Cambios previstos

- `printingService`;
- trabajo persistente;
- estados e intentos;
- idempotencia por documento/tipo/copia;
- vista previa;
- adaptador navegador/PDF;
- base para drivers térmicos;
- reintentos.

### Regla

Persistir el documento antes de imprimir. Una falla de dispositivo no revierte ni repite la operación de negocio.

### Commit

```powershell
git commit -m "v3.4.0: crea nucleo y cola de Printing"
```

---

## v3.4.1 · Integración transversal de documentos

### Documentos

- prefactura normal;
- prefactura parcial;
- recibo/factura de cobro;
- comprobante de crédito;
- abono;
- comanda cocina/bar;
- cierre diario;
- reimpresión autorizada.

### Regla

Cada dominio entrega datos canónicos a Printing. Printing no recalcula el negocio.

### Criterios de aprobación

- reimprimir usa el mismo número de documento;
- cada copia queda auditada;
- una comanda fallida puede reintentarse;
- Orders, Caja y Créditos no contienen plantillas duplicadas.

### Commit

```powershell
git commit -m "v3.4.1: integra documentos operativos con Printing"
```

---

## v3.4.2 · Configuración → Impresoras

### Objetivo

Crear una pestaña interna de Configuración sin exponer Printing como módulo visual principal.

### Parámetros

- impresora de Caja;
- impresora de cocina;
- impresora de bar;
- tamaño de papel;
- copias;
- autoimpresión;
- plantilla;
- prueba de impresión;
- estado del dispositivo.

### Regla

Settings guarda configuración. Printing la ejecuta.

### Commit

```powershell
git commit -m "v3.4.2: agrega configuracion central de impresoras"
```

---

# Dashboard, reportes y realtime

## v3.5.0 · Dashboard y reportes financieros consolidados

### Objetivo

Alinear indicadores con la cuenta global como fuente financiera única.

### Cambios previstos

- retirar cobro directo del Dashboard;
- consumo activo por cuenta abierta;
- documentos pendientes;
- ventas consolidadas por cuenta cerrada/conciliada;
- movimientos de Caja por pago;
- filtros por cajero, método, zona y responsable;
- observación de cuenta dividida;
- conciliación entre ventas y pagos sin doble suma.

### Criterios de aprobación

- una cuenta dividida aparece como una venta;
- los pagos aparecen como movimientos separados;
- total de ventas y total de pagos pueden conciliarse según periodo/estado;
- el responsable se toma de la cuenta global;
- el pagador parcial solo aparece en detalle.

### Commit

```powershell
git commit -m "v3.5.0: consolida Dashboard reportes y movimientos de Caja"
```

---

## v3.5.1 · Realtime y recuperación operativa

### Objetivo

Coordinar atención, Caja, Dashboard, Zonas, Kitchen y Printing.

### Eventos previstos

- cuenta actualizada;
- prefactura emitida/anulada;
- pago confirmado/reversado;
- saldo actualizado;
- servicio finalizado;
- mesa liberada;
- comanda actualizada;
- impresión pendiente/fallida/completada.

### Recuperación

- reintento de pagos idempotentes;
- recuperación de trabajos de impresión;
- recarga de Caja;
- señalización de versión obsoleta;
- actualización del responsable sin polling agresivo.

### Commit

```powershell
git commit -m "v3.5.1: sincroniza Cuentas Caja Kitchen y Printing"
```

---

# Limpieza y cierre

## v3.6.0 · Limpieza legacy y orden estructural

### Objetivo

Retirar código de transición después de que todos los consumidores usen servicios v3.

### Cambios previstos

- retirar lógica de pago de `orders.js`;
- retirar pago directo de Dashboard;
- consolidar Accounts/Credits;
- eliminar endpoints legacy y fachadas sin consumidores;
- retirar placeholders de impresión;
- separar componentes frontend extensos;
- routers delgados;
- servicios por dominio;
- documentación de dependencias;
- detección de funciones huérfanas y duplicadas.

### Criterios de aprobación

- no existen dos implementaciones activas de la misma regla;
- no hay funciones públicas sin consumidor justificado;
- no hay router con transacciones de negocio dispersas;
- pruebas confirman compatibilidad visible.

### Commit

```powershell
git commit -m "v3.6.0: elimina legacy y ordena arquitectura modular"
```

---

## v3.7.0 · Pruebas cruzadas y cierre MundiPOS 3.0

### Matriz mínima

- administrador;
- cajero exclusivo;
- salonero con capacidad Caja;
- bartender con capacidad Caja;
- cuenta normal;
- cuenta dividida 2 + 1;
- múltiples líneas y cantidades;
- cliente que paga y se retira;
- consumo agregado después de un pago;
- saldo temporal cero con mesa abierta;
- efectivo y vuelto;
- tarjeta;
- pago mixto;
- reverso autorizado;
- crédito y abonos;
- impresión fallida y reintento;
- dos dispositivos emitiendo/cobrando;
- finalización y limpieza de responsables;
- una venta global con múltiples pagos;
- PC y móvil.

### Criterio final

MundiPOS 3.0 queda cerrado cuando:

- la cuenta global es la única fuente financiera;
- documentos y pagos parciales no duplican ventas;
- el personal de atención administra consumo y prefacturas;
- Caja cobra con autorización;
- Payments es transaccional e idempotente;
- pagar no cierra mesas;
- finalizar servicio libera integralmente;
- Kitchen y Printing están desacoplados;
- Configuración administra impresoras;
- Dashboard y reportes concilian ventas y Caja;
- realtime mantiene todos los dispositivos coordinados;
- legacy fue retirado;
- pruebas automáticas y operativas están aprobadas.

### Commit

```powershell
git commit -m "v3.7.0: cierra arquitectura operativa de MundiPOS 3.0"
```

---

# Regla de commits seguros

Antes de cada commit:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
git status --short
```

Agregar únicamente los archivos esperados. Nunca usar:

```powershell
git add .
```

Filtro obligatorio:

```powershell
git diff --cached --name-only | Select-String -Pattern "data/restaurant.db|\.env$|certs/|\.pem$|\.key$|rootCA|mundipos-rootCA|node_modules|cookies.txt|data/backups"
```

Si imprime algo, detener el commit y corregir staging.

# Regla de avance

Una subfase se considera cerrada únicamente cuando:

1. funciona operativamente;
2. pasa validación de sintaxis;
3. pasa pruebas automáticas disponibles;
4. tiene documento de avance;
5. README y roadmap están actualizados;
6. el staging contiene solo archivos esperados;
7. el commit y push están completos;
8. `git status --short` queda limpio.
