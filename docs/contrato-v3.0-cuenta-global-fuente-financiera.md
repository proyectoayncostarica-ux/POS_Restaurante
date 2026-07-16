# Contrato v3.0 · Cuenta global como fuente financiera única

## 1. Propósito

Definir la relación obligatoria entre la cuenta global, las prefacturas parciales, los pagos, los documentos entregados a los pagadores y los reportes financieros internos de MundiPOS.

Este contrato evita que una cuenta dividida duplique ventas o cambie la responsabilidad original de la mesa.

## 2. Entidad financiera canónica

La entidad financiera canónica es la cuenta global asociada a:

- mesa o banco;
- zona;
- cliente principal registrado al ocupar la mesa;
- responsable o responsables de atención;
- fecha de apertura;
- consumo total acumulado;
- servicio aplicado;
- total pagado consolidado;
- saldo consolidado;
- fecha de conciliación o cierre.

La implementación podrá conservar `pedidos` como base de esta entidad durante la migración, pero el dominio v3 la tratará explícitamente como cuenta global.

## 3. Documentos operativos parciales

Cada prefactura o documento parcial tendrá:

- número propio;
- nombre del pagador;
- ítems y cantidades asignadas;
- subtotal y servicio correspondiente;
- total del documento;
- saldo del documento;
- estado;
- pagos relacionados;
- recibo o factura visible correspondiente.

El nombre del pagador puede ser diferente del cliente principal de la cuenta global.

Ejemplo:

```text
Cuenta CTA-000125
Mesa 1
Cliente principal: Juan
Responsable: Andrey
Total global: ₡5.000

PF-000125-01 · Pedro · ₡3.000
PF-000125-02 · Juan  · ₡2.000
```

## 4. Regla de consolidación

```text
total_cuenta_global
= suma del valor de todas las cantidades consumidas válidas

pagado_cuenta_global
= suma de pagos confirmados no reversados aplicados a documentos de la cuenta

saldo_cuenta_global
= total_cuenta_global - pagado_cuenta_global
```

Una prefactura anulada no reserva cantidades ni participa en el saldo.

Un pago reversado no participa en el total pagado.

## 5. Regla de reporte

### Reporte de ventas

El reporte consolidado registra una sola venta por cuenta global.

Campos mínimos:

- número de cuenta global;
- mesa/banco y zona;
- cliente principal;
- responsable de atención;
- total global;
- fecha de conciliación final;
- estado;
- observación de división;
- cantidad de documentos y pagos.

Ejemplo de observación:

```text
Cuenta dividida: 2 documentos, pagos de ₡3.000 y ₡2.000.
```

### Reporte de Caja

El reporte de Caja registra cada movimiento monetario real:

- pago;
- fecha y hora;
- cajero;
- método;
- monto;
- documento;
- referencia;
- estado o reverso.

Los movimientos de Caja no se suman nuevamente como ventas si ya forman parte de la cuenta global.

## 6. Responsabilidad operativa

La división no cambia automáticamente:

- cliente principal;
- responsable de atención;
- mesa/banco;
- zona;
- cuenta global.

El pagador de un documento parcial no se convierte en responsable principal de la cuenta.

Los reportes por mesero, salonero o bartender utilizan la responsabilidad registrada en la cuenta global y sus snapshots históricos.

## 7. Continuidad después de un pago parcial

Después de pagar una subcuenta:

- las cantidades pagadas permanecen en historial;
- dejan de estar disponibles para nuevas prefacturas;
- la cuenta global sigue abierta;
- la mesa sigue ocupada;
- se mantienen los responsables;
- se pueden agregar productos;
- el total global puede aumentar con nuevo consumo.

Por tanto, el total final de la cuenta global solo queda cerrado cuando finaliza el servicio.

## 8. Fecha financiera

La venta consolidada utiliza como fecha financiera principal la fecha de conciliación final o cierre de la cuenta global.

Las fechas individuales de pago se conservan para:

- conciliación de Caja;
- trazabilidad;
- auditoría;
- control de métodos de pago;
- turnos de cajero.

Este criterio separa el momento de cada movimiento de efectivo del momento en que la cuenta global queda conciliada.

## 9. Impresión y numeración

Cada documento tiene numeración independiente:

```text
CTA  Cuenta global
PF   Prefactura
PG   Pago interno
RC   Recibo o comprobante
AN   Anulación o reverso
```

La numeración debe ser única, persistente y generada dentro de una transacción.

Un error de impresión no genera un nuevo número de negocio. Crea o actualiza un trabajo de impresión asociado al documento existente.

## 10. Condiciones de cierre

Una cuenta global solo puede cerrarse cuando:

- el personal solicita `Finalizar servicio`;
- no quedan cantidades sin prefacturar;
- no quedan documentos pendientes de liquidación;
- no hay pagos procesándose;
- los créditos, si existen, están formalizados;
- el saldo consolidado cumple la regla de cierre;
- no se agregó consumo durante la validación.

El cierre debe ser transaccional y ejecutar:

- conciliación final;
- cierre operativo;
- liberación de mesa/banco;
- limpieza de responsables;
- historial;
- realtime.

## 11. Prohibiciones

No se permite:

- sumar prefacturas parciales como ventas independientes;
- cambiar el cliente principal por el nombre de un pagador parcial;
- liberar la mesa al pagar una subcuenta;
- borrar líneas pagadas;
- calcular reportes financieros únicamente desde documentos parciales;
- confiar en el total enviado por frontend;
- generar documentos duplicados por reintento de impresión;
- registrar dos pagos por el mismo intento idempotente.

## 12. Criterio de aceptación

La implementación cumple este contrato cuando demuestra que:

1. una cuenta dividida produce múltiples documentos sin duplicar ventas;
2. la suma de pagos coincide con el total pagado consolidado;
3. los pagadores parciales no alteran cliente ni responsable principal;
4. la mesa puede seguir consumiendo después de un pago parcial;
5. ventas y movimientos de Caja pueden conciliarse sin sumar dos veces;
6. la cuenta global conserva trazabilidad completa hasta el cierre.
