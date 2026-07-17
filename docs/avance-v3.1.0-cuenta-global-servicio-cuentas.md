# v3.1.0 · Cuenta global y servicio de dominio de Cuentas

## 1. Objetivo

Convertir la cuenta principal de mesa/banco en una entidad canónica explícita y trasladar las reglas principales de creación, lectura, acumulación de consumo, cálculo de servicio y saldo desde `server/routes/orders.js` hacia un servicio de dominio transaccional.

La experiencia visible continúa usando Cuentas/Pedidos y las rutas `/api/orders`. Esta subfase cambia la arquitectura interna, no el flujo operativo del usuario.

## 2. Fuente de verdad

Durante la migración se conserva la tabla `pedidos`, pero desde v3.1.0 cada fila se trata como **cuenta global**.

La cuenta global conserva:

- número interno `CTA-########`;
- cliente principal;
- mesa/banco y zona;
- responsables de atención en snapshot;
- subtotal consumido;
- servicio aplicado;
- total global;
- total pagado consolidado;
- saldo pendiente consolidado;
- estado operativo;
- estado financiero;
- fechas de apertura, conciliación y cierre;
- versión de concurrencia y fecha de actualización.

Las futuras prefacturas y pagos parciales dependerán de esta cuenta, pero no reemplazarán su condición de fuente financiera única.

## 3. Modelo persistente

Se agregan a `pedidos`:

```text
numero_cuenta
estado_operativo
estado_financiero
total_pagado
saldo_pendiente
fecha_apertura
fecha_conciliacion
fecha_cierre
actualizado_en
version
mesa_numero_snapshot
mesa_tipo_snapshot
zona_id_snapshot
zona_nombre_snapshot
cliente_principal_snapshot
```

También se agrega:

```text
cuenta_responsables
```

Esta tabla conserva los responsables históricos de la cuenta, incluyendo nombre de usuario, rol, fecha de asignación y responsable principal. La eliminación o modificación posterior de responsabilidades vivas en la mesa no borra el contexto histórico de la venta.

## 4. Migración de datos existentes

`database.migrateGlobalAccounts()`:

1. asigna un número `CTA-########` a cada pedido existente;
2. deriva el estado operativo desde el estado legacy;
3. suma pagos existentes;
4. calcula saldo pendiente;
5. deriva el estado financiero;
6. conserva cliente, mesa y zona en snapshots;
7. copia responsables actuales;
8. usa al usuario creador como fallback cuando no existe responsabilidad registrada;
9. crea índices de cuenta, estados y responsables.

La migración fue verificada sobre una copia de una base operativa existente sin modificar el archivo original.

## 5. Servicio de dominio

Se agrega:

```text
server/services/accountService.js
```

Responsabilidades principales:

- crear cuenta global dentro de una transacción `IMMEDIATE`;
- validar productos y presentaciones contra Menú operativo;
- capturar política de servicio de la zona/puesto;
- generar número interno de cuenta;
- capturar snapshots de mesa, zona, cliente y responsables;
- guardar líneas de consumo;
- crear la comanda legacy cuando corresponde;
- agregar productos de forma transaccional;
- sincronizar subtotal, servicio, total pagado, saldo y estados;
- consultar cuenta y responsables sin escribir en la base;
- listar cuentas filtradas por estado, mesa y zonas autorizadas;
- encapsular la edición legacy de producto como adaptador temporal.

## 6. Lecturas sin mutaciones ocultas

Antes de esta fase, `GET /api/orders/:id` recalculaba y escribía totales durante una consulta.

Desde v3.1.0:

- consultar una cuenta no ejecuta `UPDATE`;
- el read model calcula valores canónicos sin alterar versión ni timestamps;
- los totales persistidos se actualizan únicamente después de mutaciones explícitas;
- la prueba automática confirma que dos lecturas consecutivas no cambian la fila.

## 7. Adaptadores de rutas

Se conservan:

```text
GET    /api/orders
GET    /api/orders/:id
POST   /api/orders
POST   /api/orders/:id/products
PUT    /api/orders/:pedido_id/products/:producto_id
POST   /api/orders/:id/pay
```

Cambios internos:

- listar, consultar, crear y agregar productos llaman a `accountService`;
- la edición legacy delega la mutación y sincronización al servicio;
- la ruta legacy de pago sincroniza el agregado global antes y después del cobro;
- las respuestas agregan `numero_cuenta`, estados, pagado y saldo cuando corresponde;
- permisos, zonas y responsabilidad continúan verificándose en backend.

La ruta legacy de pago seguirá siendo reemplazada por Payments en `v3.2.x`. Su existencia actual es solo compatibilidad operativa.

## 8. Caja base

`GET /api/cash/summary` deja de sumar directamente el total bruto de `pedidos` y usa la lectura canónica de cuentas abiertas.

Entrega:

- cuentas abiertas;
- cuentas con saldo pendiente;
- saldo pendiente consolidado.

Todavía no registra pagos por prefactura.

## 9. Invariantes implementadas

- una mesa/banco no puede tener dos cuentas globales abiertas;
- crear cuenta, líneas, snapshots, comanda e historial es una sola transacción;
- si falla una línea, no queda cuenta incompleta;
- el cliente principal y responsables no cambian al agregar consumo;
- un pago parcial actualiza el estado financiero, no libera la mesa desde el servicio de Cuentas;
- el backend calcula precios y servicio;
- la lectura no muta;
- la cuenta global conserva una única numeración interna.

## 10. Compatibilidad

No se implementan todavía:

- cantidades asignadas/disponibles;
- prefacturas persistentes;
- cuenta dividida una subcuenta a la vez;
- Payments por prefactura;
- cierre explícito del servicio;
- impresión real.

Estas responsabilidades corresponden a `v3.1.1` en adelante.

## 11. Pruebas automáticas

Se agregan:

```text
tests/accountService.test.js
tests/globalAccountMigration.test.js
```

Casos nuevos:

1. creación de cuenta con número y snapshots;
2. lectura sin mutaciones;
3. acumulación de consumo;
4. pago parcial con cuenta operativa abierta;
5. rollback completo ante falla de inserción;
6. migración de pedido legacy con pago parcial.

Resultado total de la suite:

```text
27 pruebas aprobadas
0 fallos
```

Comando específico:

```powershell
npm run test:accounts
```

## 12. Versionado

```text
Versión visible: 3.0
Versión package: 3.1.0
Seguimiento interno: 3.1.0
```

## 13. Archivos modificados

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/avance-v3.1.0-cuenta-global-servicio-cuentas.md
package.json
package-lock.json
server/config/appInfo.js
server/db/database.js
server/services/accountService.js
server/routes/orders.js
server/routes/cash.js
tests/accountService.test.js
tests/globalAccountMigration.test.js
```

## 14. Prueba operativa recomendada

1. iniciar servidor sobre una copia de respaldo;
2. confirmar migración sin errores;
3. abrir una mesa con cliente y responsables;
4. crear pedido desde la UI actual;
5. confirmar que se genera `numero_cuenta`;
6. abrir la cuenta varias veces y confirmar que los totales no cambian;
7. agregar productos y confirmar subtotal/servicio/saldo;
8. confirmar que cliente y responsables permanecen;
9. abrir Caja y revisar el saldo consolidado;
10. validar que Dashboard, Menú y Cuentas mantienen el flujo visible anterior.

## 15. Commit

```powershell
git commit -m "v3.1.0: crea cuenta global y servicio de dominio de Cuentas"
```
