# v3.1.5 · Read model financiero consolidado

## Estado

Implementado y validado.

## Objetivo

Crear una lectura financiera única basada en la cuenta global de la mesa o banco, sin contabilizar las prefacturas divididas ni los pagos individuales como ventas independientes.

La regla canónica queda:

```text
Venta financiera = una cuenta global conciliada
Documento operativo = una prefactura emitida para un pagador
Movimiento de Caja = un pago individual registrado
```

## Servicio incorporado

Se agrega:

```text
server/services/financialReadService.js
```

El servicio centraliza lecturas para Dashboard, Caja, detalle de cuenta y estadísticas. No ejecuta mutaciones ni modifica saldos.

### Lectura consolidada por cuenta

Cada cuenta expone:

```text
numero_cuenta
cliente_principal
responsable_principal
mesa / banco
zona
total_global
total_documentado
total_pagado
saldo_pendiente
cantidad_documentos
cantidad_pagos
estado_operativo
estado_financiero
fecha_financiera
observacion_financiera
```

También devuelve dos colecciones separadas:

```text
documentos_operativos
movimientos_caja
```

Las prefacturas conservan el nombre del pagador. La cuenta global conserva el cliente principal y los responsables comerciales originales.

## Regla de conciliación

Una cuenta aparece como venta consolidada cuando su total global está cubierto por los pagos registrados y su estado financiero es conciliado o puede derivarse como conciliado.

Ejemplo:

```text
Cuenta global CTA-00000015
Cliente principal: Juan
Responsable: Andrey
Total global: ₡5.000

PF-00000001 · Pedro · ₡3.000
PF-00000002 · Juan  · ₡2.000

Movimientos de Caja:
₡3.000 efectivo
₡2.000 tarjeta
```

Resultado financiero:

```text
Ventas:             1 cuenta por ₡5.000
Documentos:         2 prefacturas operativas
Movimientos Caja:   2 pagos por ₡5.000
```

No se generan dos ventas adicionales de ₡3.000 y ₡2.000.

## Fechas financieras

Se separan dos criterios:

```text
Ventas globales     fecha de conciliación de la cuenta
Movimientos de Caja fecha individual de cada pago
```

Por esta razón, los totales diarios pueden diferir cuando una cuenta recibe pagos en varios días y se concilia posteriormente. Esa diferencia no implica duplicación ni pérdida: representa bases temporales distintas.

Si una cuenta alcanza saldo cero, continúa abierta y luego recibe consumo nuevo, deja de considerarse conciliada hasta liquidar nuevamente el total global. La fecha financiera se establece otra vez en la conciliación vigente.

## Dashboard

Se reemplaza la lectura basada en filas de `pagos` por una fila por cuenta global conciliada.

Cambios:

- `ventasHoy` suma cuentas globales, no prefacturas ni movimientos;
- `cuentasPagadas` cuenta cuentas globales conciliadas;
- `ultimasCuentasPagadas` muestra una fila por cuenta;
- `/api/dashboard/ventas-detalle` devuelve cuentas globales;
- `/api/dashboard/stats/:period` agrupa cuentas por fecha financiera;
- se exponen por separado el total y cantidad de movimientos de Caja.

El detalle visual muestra:

- cliente principal;
- responsable;
- consumo completo;
- documentos operativos;
- movimientos de Caja;
- observación de cuenta dividida.

## Caja

`GET /api/cash/summary` incorpora:

```text
cuentas_conciliadas_hoy
ventas_globales_hoy
cantidad_movimientos_caja_hoy
movimientos_caja_hoy
diferencia_contextual_hoy
```

Se agregan:

```text
GET /api/cash/movements
GET /api/cash/accounts/:id/financial-read
```

La sección Caja muestra las ventas globales y los movimientos como métricas diferentes, además de una tabla de movimientos del día.

## Compatibilidad de detalle

`GET /api/accounts/:id` usa el nuevo read model, pero conserva campos utilizados por el Dashboard anterior:

```text
id
fecha
total
cliente_nombre
usuario_nombre
items
```

También entrega la estructura financiera nueva.

## Limitación temporal conocida

La tabla legacy `pagos` todavía no contiene `prefactura_id`, cajero ni pagador. Por eso, en esta fase:

- los pagos se vinculan con certeza a la cuenta global;
- las prefacturas conservan sus pagadores;
- no se afirma todavía qué pago exacto liquidó qué prefactura;
- el movimiento indica `vinculo_documental = pendiente_paymentservice`.

El vínculo transaccional pago-prefactura se implementará en:

```text
v3.2.0 · Núcleo backend de Payments por prefactura
```

## Base de datos

Esta fase no crea tablas ni columnas nuevas. Utiliza:

```text
pedidos
pedido_productos
cuenta_responsables
prefacturas
pagos
```

## Pruebas

Se agrega:

```text
tests/financialReadService.test.js
```

Cobertura específica:

1. dos prefacturas y dos pagos producen una sola venta global;
2. Caja conserva dos movimientos separados;
3. un pago parcial no crea una venta conciliada;
4. nuevo consumo retira una conciliación temporal;
5. Dashboard presenta cuenta global, documentos y movimientos por separado.

Resultados:

```text
5 pruebas financieras aprobadas
62 pruebas totales aprobadas
0 fallos
```

## Versionado

```text
Versión visible: 3.0
package.json: 3.1.5
Seguimiento interno: 3.1.5
Caché PWA: v3.1.5-financial-read
```

## Validación manual recomendada

1. Crear una cuenta global de ₡5.000.
2. Dividirla en prefacturas de ₡3.000 y ₡2.000.
3. Marcar o cobrar ambos importes mediante el flujo disponible.
4. Confirmar que Dashboard muestra una venta de ₡5.000.
5. Confirmar que Caja muestra dos movimientos por ₡3.000 y ₡2.000.
6. Abrir el detalle y comprobar que el cliente principal continúa siendo el registrado al ocupar la mesa.
7. Agregar consumo nuevo después de un saldo cero y confirmar que la cuenta deja de aparecer como conciliada hasta el siguiente pago total.

## Commit

```powershell
git commit -m "v3.1.5: agrega lectura financiera consolidada por cuenta"
```
