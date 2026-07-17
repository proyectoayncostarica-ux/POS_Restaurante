# Avance v3.2.3 · Efectivo, vuelto, tarjeta y pagos mixtos

## Objetivo

Completar los medios básicos de cobro de Caja sobre una prefactura, manteniendo una sola transacción financiera por pago y conservando la cuenta global como única fuente de verdad de la venta.

## Alcance implementado

- efectivo simple con monto aplicado, efectivo recibido y vuelto;
- tarjeta simple con referencia o autorización obligatoria;
- pago mixto formado por un componente de efectivo y otro de tarjeta;
- abonos parciales o liquidación total;
- cálculo monetario en unidades menores;
- persistencia transaccional de cada medio en `pago_medios`;
- idempotencia que incluye montos recibidos, vuelto y referencias;
- read model de pagos con desglose de medios;
- movimientos financieros con modalidad canónica, monto recibido y vuelto;
- modal de Caja adaptable a escritorio y móvil;
- caché PWA `v3.2.3-payment-methods`.

## Regla monetaria

El monto que reduce el saldo es la suma de `monto_aplicado` de los medios confirmados. El efectivo recibido puede ser mayor que el efectivo aplicado; la diferencia es el vuelto. La tarjeta siempre aplica exactamente el importe autorizado y no genera vuelto.

```text
pago.monto = efectivo aplicado + tarjeta aplicada
pago.vuelto = efectivo recibido - efectivo aplicado
saldo nuevo = saldo anterior - pago.monto
```

El total recibido o cargado no se contabiliza como venta. La venta sigue siendo el total de la cuenta global.

## Compatibilidad de datos

`pagos.metodo_pago` se conserva como campo legacy para no reconstruir la tabla operativa existente. La modalidad canónica se guarda en `pagos.metodo_pago_v3` y los componentes reales en `pago_medios`.

Para un pago mixto:

```text
pagos.metodo_pago       = efectivo    (compatibilidad)
pagos.metodo_pago_v3    = mixto       (lectura canónica)
pago_medios             = efectivo + tarjeta
```

Todas las lecturas nuevas usan `metodo_pago_v3` cuando existe.

## Integridad

La operación completa se ejecuta dentro de una transacción `IMMEDIATE`:

1. valida idempotencia;
2. valida saldo documental;
3. valida medios y referencias;
4. genera `PG-########`;
5. inserta el pago;
6. inserta componentes de subtotal/servicio;
7. inserta medios de pago;
8. actualiza prefactura;
9. actualiza cuenta global;
10. registra historial.

Un error revierte todas las escrituras.

## Pruebas

Se agregan pruebas para:

- efectivo con vuelto;
- tarjeta sin referencia;
- pago mixto;
- sobrepago y efectivo insuficiente;
- idempotencia de medios;
- migración de pagos legacy;
- contrato visual y caché PWA.

En el entorno de construcción pasaron 89 pruebas funcionales, excluyendo únicamente la prueba del addon nativo `sqlite3`, que debe ejecutarse en Windows después de `npm ci`.

## Fuera de alcance

- crédito integrado con Payments;
- cierre y liberación explícita del servicio;
- factura/recibo final mediante Printing;
- apertura y cierre de turno de caja.

## Git

```powershell
git commit -m "v3.2.3: agrega efectivo tarjeta vuelto y pagos mixtos"
```

La siguiente fase es `v3.2.4 · Créditos integrados con Payments`.
