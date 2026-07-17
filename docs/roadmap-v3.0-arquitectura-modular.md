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

### Commit

```powershell
git commit -m "v3.0.1: agrega base transaccional y pruebas de dominio"
```

---

## v3.0.2 · Capacidades, rol Cajero y navegación autorizada

### Objetivo

Separar permisos funcionales de rol de sistema y acceso por zona.

### Cambios previstos

- capacidades persistentes;
- relación capacidades ↔ roles de trabajo;
- rol inicial `Cajero` sin obligación de zona;
- usuarios mixtos atención + Caja;
- `requireCapability()` backend;
- capacidades en sesión;
- destino inicial Caja para cajero exclusivo;
- botón Caja del header condicionado por capacidad;
- administrador conserva acceso completo.

### Capacidades mínimas

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

### Riesgo a controlar

No bloquear usuarios actuales por ausencia de capacidades durante la migración. Debe existir migración y compatibilidad temporal explícita.

### Criterios de aprobación

- cajero exclusivo puede iniciar sesión sin zona;
- usuario mixto conserva atención y accede a Caja;
- usuario sin `cash.collect` no puede cobrar aunque llame el endpoint manualmente;
- navegación PC/móvil respeta capacidades.

### Commit

```powershell
git commit -m "v3.0.2: agrega capacidades y rol operativo de Cajero"
```

---

## v3.0.3 · Acceso operativo compartido y realtime por capacidades

### Objetivo

Centralizar reglas que actualmente viven dispersas en Users, Tables, Orders y Dashboard.

### Servicio previsto

```text
server/services/operationalAccessService.js
public/js/services/operational-access.js
```

### Reglas compartidas

- administrador;
- zona visible;
- zona operable;
- responsabilidad de mesa;
- emisión de prefactura;
- cobro;
- anulación/reverso;
- finalización del servicio;
- visibilidad de eventos realtime.

### Criterios de aprobación

- Orders, Caja y Dashboard consultan la misma política;
- los eventos no filtran datos de mesas no autorizadas;
- backend y frontend producen resultados coherentes;
- frontend nunca sustituye la autorización backend.

### Commit

```powershell
git commit -m "v3.0.3: centraliza acceso operativo y realtime por capacidades"
```

---

# Dominio de Cuentas y prefacturas

## v3.1.0 · Cuenta global y servicio de dominio de Cuentas

### Objetivo

Convertir la cuenta principal en entidad canónica explícita y extraer las reglas de `server/routes/orders.js`.

### Cambios previstos

- `orderService`;
- número interno de cuenta global;
- cliente principal;
- mesa/banco, zona y responsables;
- snapshots históricos;
- total consumido;
- total pagado consolidado;
- saldo consolidado;
- estado operativo y financiero separados;
- fecha de apertura, conciliación y cierre;
- rutas actuales como adaptadores.

### Regla financiera

El servicio de Cuentas es propietario del agregado financiero global. Payments aporta transacciones confirmadas, pero no redefine la venta.

### Criterios de aprobación

- una cuenta se consulta sin mutaciones ocultas;
- total, pagado y saldo se calculan con una sola regla canónica;
- la cuenta conserva cliente principal y responsables;
- el código de router deja de contener lógica compleja de negocio.

### Commit

```powershell
git commit -m "v3.1.0: crea cuenta global y servicio de dominio de Cuentas"
```

---

## v3.1.1 · Líneas de consumo y cantidades disponibles

### Objetivo

Preparar cada línea para asignación parcial sin borrar historial ni cobrar unidades dos veces.

### Cambios previstos

- identidad por `pedido_producto_id`;
- cantidad consumida;
- cantidad asignada;
- cantidad disponible;
- presentación, precio y servicio en snapshot;
- reglas de consolidación de líneas;
- impedir edición incompatible de líneas asignadas;
- deprecar edición legacy que solo conoce producto y no presentación.

### Fórmula canónica

```text
cantidad_disponible
= cantidad_consumida
- cantidad_asignada_a_prefacturas_no_anuladas
```

### Criterios de aprobación

- una línea de cantidad 3 puede distribuirse 2 + 1;
- no puede distribuirse 2 + 2;
- anular un documento devuelve la cantidad;
- las cantidades pagadas siguen visibles en historial;
- nuevo consumo crea o consolida líneas solo cuando es seguro.

### Commit

```powershell
git commit -m "v3.1.1: normaliza lineas y cantidades de consumo"
```

---

## v3.1.2 · Secuencias y modelo persistente de prefacturas

### Objetivo

Crear documentos operativos persistentes y trazables.

### Entidades previstas

```text
secuencias_documentales
prefacturas
prefactura_items
historial_prefacturas
```

### Datos mínimos

- número de documento;
- cuenta global;
- pagador visible;
- cliente principal en snapshot;
- mesa/banco y zona en snapshot;
- responsables en snapshot;
- usuario emisor;
- ítems y cantidades;
- subtotal, servicio y total;
- pagado y saldo;
- estado;
- estado de impresión;
- fecha de emisión/anulación.

### Regla

La emisión reserva cantidades dentro de una transacción con bloqueo de escritura. La numeración también se genera dentro de esa transacción.

### Criterios de aprobación

- dos dispositivos no reservan la misma cantidad;
- una impresión fallida no duplica el documento;
- una anulación autorizada devuelve cantidades;
- cada documento conserva su snapshot aunque cambie Menú o la mesa.

### Commit

```powershell
git commit -m "v3.1.2: agrega modelo transaccional de prefacturas"
```

---

## v3.1.3 · División una subcuenta a la vez

### Objetivo

Implementar el flujo aprobado dentro de `Ver pedido`.

### Flujo

1. activar `Cuenta dividida`;
2. seleccionar ítems de un cliente;
3. indicar cantidades;
4. mostrar total parcial;
5. pulsar `Emitir prefactura`;
6. abrir minimodal;
7. escribir nombre del cliente;
8. revisar resumen y total;
9. `Volver` o `Imprimir y emitir`;
10. regresar al consumo restante.

### Reglas UX

- no construir dos subcuentas simultáneamente;
- mostrar cantidad disponible;
- deshabilitar líneas sin cantidad;
- en PC usar tabla amplia;
- en móvil usar controles táctiles/cards sin perder la misma capacidad;
- el frontend mantiene selección temporal; el backend valida todo nuevamente.

### Flujo no dividido

Con `Cuenta dividida` desactivada, `Emitir prefactura` toma todo el consumo disponible en ese momento.

### Criterios de aprobación

- el ejemplo Imperial 3 se divide correctamente 2 + 1;
- el total del minimodal coincide con backend;
- volver no reserva cantidades;
- confirmar sí reserva y persiste;
- la siguiente división solo muestra cantidades restantes.

### Commit

```powershell
git commit -m "v3.1.3: agrega emision guiada de prefacturas divididas"
```

---

## v3.1.4 · Continuidad del consumo después de documentos y pagos

### Objetivo

Permitir que una mesa siga activa aunque se hayan emitido o pagado subcuentas.

### Cambios previstos

- separar consumo disponible, consumo reservado e historial pagado;
- permitir agregar productos nuevos;
- recalcular total global acumulado;
- mantener responsabilidades;
- mantener mesa ocupada;
- mostrar documentos emitidos sin mezclarlos con consumo disponible;
- permitir saldo temporal cero con servicio todavía abierto.

### Criterios de aprobación

- Juan paga y se retira;
- los ítems de Juan no vuelven a seleccionarse;
- María y otros clientes siguen consumiendo;
- se agregan productos nuevos;
- el total global aumenta correctamente;
- la mesa no se libera automáticamente.

### Commit

```powershell
git commit -m "v3.1.4: mantiene cuentas activas tras pagos parciales"
```

---

## v3.1.5 · Read model financiero consolidado

### Objetivo

Crear una lectura única para Dashboard, reportes, Caja y cierre sin sumar documentos parciales como ventas independientes.

### Lecturas previstas

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
```

### Regla de reportes

- venta: una cuenta global;
- movimientos de Caja: una fila por pago;
- pagadores parciales: detalle operativo;
- responsable comercial: snapshot de la cuenta global;
- fecha financiera principal: conciliación final.

### Criterios de aprobación

- ₡3.000 + ₡2.000 no aparecen como dos ventas adicionales;
- el total de Caja sí muestra ambos movimientos;
- ambos reportes concilian con ₡5.000;
- el cliente principal sigue siendo Juan aunque Pedro pague una parte.

### Commit

```powershell
git commit -m "v3.1.5: agrega lectura financiera consolidada por cuenta"
```

---

# Payments y Caja

## v3.2.0 · Núcleo backend de Payments por prefactura

### Objetivo

Crear `paymentService` y un modelo monetario transaccional.

### Entidades previstas

```text
pagos
pago_componentes
reversos_pago
claves_idempotencia
```

### Cambios previstos

- pago aplicado a `prefactura_id`;
- usuario cajero;
- método de pago;
- monto;
- estado;
- referencia;
- efectivo recibido y vuelto cuando aplique;
- idempotencia;
- reverso/anulación autorizada;
- actualización de saldo de prefactura;
- actualización del total pagado consolidado de la cuenta global.

### Regla

Payments registra movimientos. No crea ventas independientes y no libera mesas.

### Criterios de aprobación

- doble clic no duplica un pago;
- dos dispositivos no cobran el mismo saldo completo;
- un reverso restaura el saldo;
- la cuenta global refleja la suma confirmada;
- un documento pagado no cierra el servicio.

### Commit

```powershell
git commit -m "v3.2.0: crea Payments transaccional por prefactura"
```

---

## v3.2.1 · API y read model operativo de Caja

### Objetivo

Crear endpoints específicos para la operación de Caja.

### Funciones

- listar documentos pendientes;
- buscar por número, cuenta, mesa, zona, cliente principal, pagador o responsable;
- consultar detalle de documento;
- consultar saldo;
- consultar pagos;
- consultar contexto global de la cuenta;
- solicitar reimpresión autorizada.

### Seguridad

Solo capacidades de Caja. El cajero consulta únicamente los datos necesarios para el cobro.

### Criterios de aprobación

- cajero encuentra una prefactura por número o mesa;
- ve pagador y contexto global sin editar consumo;
- no accede a cuentas fuera de la política definida;
- saldos coinciden con Payments y Cuentas.

### Commit

```powershell
git commit -m "v3.2.1: agrega API operativa de Caja"
```

---

## v3.2.2 · Sección visual Caja y botón del header

### Objetivo

Crear la interfaz visible de cobro sin exponer el servicio Payments como módulo técnico.

### Cambios previstos

- botón `Caja` en header;
- `cash-section`;
- bandeja de documentos pendientes y pagados;
- filtros y búsqueda;
- detalle de cuenta global y documento;
- apertura del modal de cobro;
- destino inicial Caja para cajero exclusivo;
- retiro del cobro directo de Dashboard;
- handlers legacy de Orders convertidos en fachadas temporales o eliminados.

### PC

- tabla/bandeja amplia;
- panel de detalle;
- filtros persistentes durante la sesión.

### Móvil

- cards compactas;
- búsqueda accesible;
- modal táctil;
- navegación compatible con header y barra inferior existentes.

### Criterios de aprobación

- el cajero exclusivo entra a Caja;
- el usuario mixto abre Caja sin perder su sesión operativa;
- Dashboard no muestra cobro directo;
- el flujo visible de cobro se inicia desde Caja.

### Commit

```powershell
git commit -m "v3.2.2: agrega Caja operativa desde el header"
```

---

## v3.2.3 · Efectivo, vuelto, tarjeta y pagos mixtos

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
