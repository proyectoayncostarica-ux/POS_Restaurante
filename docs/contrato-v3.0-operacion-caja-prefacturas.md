# Contrato v3.0 · Operación de Caja, prefacturas y cuentas divididas

## 1. Propósito

Definir el comportamiento obligatorio de MundiPOS 3.0 para separar atención, emisión de prefacturas, cobro y cierre de mesa.

Este contrato prevalece sobre cualquier flujo legacy donde Dashboard o Cuentas procesen directamente el dinero.

## 2. Responsabilidades por dominio

### Cuentas / Orders

- abrir y mantener la cuenta principal;
- registrar productos, presentaciones y cantidades;
- mostrar consumo activo;
- permitir división por ítem y cantidad;
- emitir prefacturas normales o parciales;
- permitir continuar agregando consumo;
- finalizar el servicio cuando corresponda.

### Caja

- localizar prefacturas emitidas;
- mostrar mesa, zona, cliente, responsable y número de control;
- cobrar prefacturas;
- registrar efectivo, tarjeta, pagos mixtos, referencias y vuelto;
- consultar pagos y reimpresiones autorizadas.

### Payments

- validar autorización de cobro;
- registrar transacciones idempotentes;
- aplicar pagos a una prefactura;
- calcular saldo;
- actualizar estados financieros;
- manejar anulaciones y reversos autorizados.

### Printing

- generar prefacturas, recibos y facturas;
- registrar trabajos y resultados;
- permitir reintentos sin duplicar documentos;
- usar configuración de impresoras definida en Configuración.

### Kitchen

- administrar qué productos se preparan y sus estados;
- solicitar a Printing la comanda correspondiente;
- no mezclar estado de preparación con estado de impresión.

## 3. Usuario Cajero

### Regla

`Cajero` será un rol/capacidad operativa, no un tercer tipo rígido de usuario.

Un usuario estándar puede ser:

```text
Cajero exclusivo
Salonero
Bartender
Salonero + Cajero
Bartender + Cajero
```

### Cajero exclusivo

- accede a Caja;
- no opera mesas ni agrega productos;
- no administra Menú ni Configuración;
- no necesita una zona operativa para cobrar;
- puede consultar únicamente información necesaria para el cobro.

### Usuario mixto

Un mesero, salonero o bartender con capacidad de Caja conserva sus funciones de atención y puede abrir Caja desde el header.

## 4. Navegación visible

- Caja se abre mediante botón **Caja** en el header.
- No se agrega un módulo principal llamado Payments.
- No se agrega un módulo principal llamado Impresiones.
- Configuración de impresoras vive en `Configuración → Impresoras`.
- El sidebar y la pantalla inicial se filtran por capacidades.
- Un cajero exclusivo entra directamente a Caja.

## 5. Regla de cobro

Dashboard no procesa pagos.

Cuentas no recibe efectivo ni tarjeta. Desde Cuentas se emiten prefacturas.

Caja cobra únicamente documentos emitidos.

## 6. Prefactura normal

Cuando `Cuenta dividida` está desactivada:

- `Emitir prefactura` toma todo el consumo disponible;
- se muestra minimodal de revisión;
- se usa el cliente general de la cuenta, con posibilidad de confirmación según diseño aprobado;
- al confirmar se crea un documento único;
- la mesa permanece activa después del pago.

## 7. Prefactura dividida

Cuando `Cuenta dividida` está activa:

- cada línea muestra checkbox;
- una línea con cantidad mayor a 1 permite elegir cantidad;
- solo se construye una subcuenta por vez;
- el total parcial se actualiza durante la selección;
- `Emitir prefactura` abre minimodal;
- el minimodal contiene nombre del cliente, resumen, cantidades, total, botón Volver y botón Imprimir y emitir;
- al confirmar se bloquean las cantidades en esa prefactura;
- el usuario vuelve al consumo restante para crear la siguiente.

## 8. Regla de cantidades

```text
cantidad_disponible
= cantidad_consumida
- cantidad_asignada_a_prefacturas_no_anuladas
```

No se permite:

- asignar más cantidad que la disponible;
- asignar la misma unidad a dos prefacturas;
- editar silenciosamente una prefactura emitida;
- borrar historial de cantidades pagadas.

## 9. Estados

### Cuenta principal

```text
abierta
finalizando
cerrada
cancelada
```

El estado financiero se administra por separado:

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

### Impresión

```text
pendiente
impresa
fallida
reimpresa
```

## 10. Pago y continuidad del servicio

Pagar una prefactura:

- no cierra la cuenta principal;
- no libera la mesa;
- no elimina responsables;
- no impide agregar nuevos productos;
- retira sus cantidades del consumo disponible;
- conserva sus ítems en historial.

La cuenta puede estar temporalmente sin saldo pendiente y seguir abierta.

## 11. Finalización del servicio

La mesa solo se libera por una acción explícita del responsable o administrador.

Antes de cerrar se valida:

- no quedan cantidades sin prefacturar;
- no quedan prefacturas pendientes;
- no hay pagos en proceso;
- cualquier crédito está formalizado;
- no se agregaron nuevos productos durante el cierre.

El cierre debe ejecutar atómicamente:

- cerrar cuenta principal;
- liberar mesa/banco;
- limpiar responsables;
- registrar historial;
- actualizar Dashboard;
- emitir realtime.

## 12. Documentos y trazabilidad

Cada entidad tendrá número interno único:

```text
Cuenta principal
Prefactura
Recibo o factura
Anulación o reverso
```

Cada prefactura enlaza:

- cuenta principal;
- mesa/banco;
- zona;
- cliente parcial;
- responsable de atención;
- usuario emisor;
- cajero que cobra;
- pagos realizados;
- recibo/factura final.

## 13. Compatibilidad transitoria

Los métodos y endpoints legacy podrán mantenerse como adaptadores mientras se migran llamadas, pero no conservarán reglas de negocio duplicadas.

El endpoint legacy de pago directo debe quedar deprecado y finalmente bloqueado para el flujo operativo normal.

## 14. Criterio de aprobación

Una fase se considera correcta solo si demuestra:

1. integridad de cantidades;
2. autorización backend;
3. persistencia documental;
4. idempotencia financiera;
5. continuidad de mesa tras pagos parciales;
6. cierre explícito y transaccional;
7. equivalencia funcional en PC y móvil.
