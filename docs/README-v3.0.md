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

