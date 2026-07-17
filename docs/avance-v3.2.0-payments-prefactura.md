# v3.2.0 · Núcleo backend de Payments por prefactura

## 1. Objetivo

Crear el dominio transaccional de Payments que aplicará movimientos monetarios a una prefactura concreta y consolidará el resultado en la cuenta global, sin tratar cada documento como una venta independiente y sin cerrar automáticamente la mesa o banco.

Esta fase es backend y modelo de datos. La API operativa y la pantalla de cobro de Caja se implementarán en `v3.2.1` y `v3.2.2`.

## 2. Principios preservados

```text
Cuenta global     = única fuente financiera y venta consolidada
Prefactura        = obligación operativa de cobro por pagador
Pago              = movimiento individual de Caja
Mesa/banco        = permanece ocupado mientras el servicio siga abierto
```

Un pago total de una prefactura cambia el estado financiero, pero no ejecuta:

```text
liberación de mesa
eliminación de cliente principal
eliminación de responsables
cierre del servicio
```

## 3. Modelo persistente

### 3.1 `pagos`

La tabla conserva compatibilidad con las columnas monetarias anteriores y agrega:

```text
prefactura_id
numero_pago / numero_secuencia
estado
referencia
cajero_usuario_id
cajero_nombre_snapshot
pagador_nombre_snapshot
fecha_anulacion
anulado_por_usuario_id
anulado_por_nombre_snapshot
motivo_anulacion
version
creado_en / actualizado_en
```

Estados soportados:

```text
pendiente
confirmado
anulado
```

Los movimientos nuevos se confirman dentro de la misma transacción que actualiza la prefactura y la cuenta global.

### 3.2 `pago_componentes`

Separa de forma explícita los componentes del movimiento:

```text
subtotal
servicio
```

La suma de ambos componentes debe coincidir con el monto del pago. En pagos parciales la distribución se calcula sobre el saldo restante; el último pago absorbe exactamente los remanentes para evitar diferencias de redondeo.

### 3.3 `reversos_pago`

Conserva un reverso auditable por pago:

```text
pago_id
monto_revertido
usuario
motivo
fecha
clave de idempotencia
fingerprint de solicitud
```

Un pago no se elimina. Su estado cambia a `anulado` y el reverso queda registrado.

### 3.4 `claves_idempotencia`

Registra claves por ámbito:

```text
payment.create
payment.void
```

La misma clave y los mismos datos devuelven el recurso existente. La misma clave con contenido distinto produce `IDEMPOTENCY_CONFLICT`.

## 4. Numeración

`documentSequenceService` incorpora la secuencia:

```text
pago → PG-########
```

La numeración se genera dentro de la misma transacción que crea el movimiento. Un rollback no consume definitivamente el número.

Los pagos legacy existentes se numeran de forma idempotente durante la migración.

## 5. `paymentService`

Archivo:

```text
server/services/paymentService.js
```

Funciones principales:

```text
recordPreinvoicePayment()
voidPayment()
getPayment()
listByPreinvoice()
listByAccount()
```

### 5.1 Registro de pago

El servicio ejecuta en una transacción `IMMEDIATE`:

```text
validar idempotencia
→ bloquear lectura monetaria
→ validar prefactura y cuenta global
→ validar cajero activo
→ recalcular pagos confirmados
→ impedir sobrepago
→ generar PG-########
→ insertar pago y componentes
→ actualizar saldo/estado de prefactura
→ actualizar total pagado/saldo de cuenta global
→ registrar historiales
→ confirmar
```

### 5.2 Pago parcial

Una prefactura puede quedar:

```text
estado: parcial
total_pagado: monto acumulado confirmado
saldo_pendiente: total - pagos confirmados
```

La cuenta global se actualiza con la suma de todos sus pagos confirmados, no con la suma de prefacturas como ventas.

### 5.3 Pago completo

Cuando el saldo documental llega a cero:

```text
prefactura.estado = pagada
prefactura.fecha_pago = fecha de conciliación del documento
```

La cuenta global puede quedar financieramente conciliada, pero conserva:

```text
estado_operativo = abierta
mesa/banco = ocupado
servicio_activo = true
```

### 5.4 Reverso

El reverso:

```text
marca el pago como anulado
registra reversos_pago
restaura el saldo de la prefactura
recalcula el saldo de la cuenta global
conserva mesa, cliente y responsables
registra historial
```

Los pagos legacy sin `prefactura_id` siguen fuera de este reverso hasta su migración específica.

## 6. Concurrencia e integridad

Dos solicitudes que intentan cobrar el mismo saldo se serializan mediante transacción inmediata. La segunda vuelve a consultar el saldo confirmado antes de insertar.

Reglas:

```text
monto > 0
monto <= saldo pendiente de prefactura
suma pagos confirmados <= total de prefactura
suma componentes = monto
pagos anulados no forman parte de saldos ni reportes
```

Errores de dominio preparados:

```text
PREINVOICE_ALREADY_PAID
PAYMENT_EXCEEDS_PREINVOICE_BALANCE
PREINVOICE_OVERPAID
PAYMENT_COMPONENTS_OUT_OF_BALANCE
PAYMENT_ALREADY_VOIDED
PAYMENT_VOID_NOT_ALLOWED
LEGACY_PAYMENT_VOID_NOT_SUPPORTED
CREDIT_PAYMENT_NOT_AVAILABLE
IDEMPOTENCY_CONFLICT
```

## 7. Read model financiero

`financialReadService` ahora:

- suma únicamente pagos confirmados;
- excluye movimientos anulados de ventas y totales de Caja;
- enlaza `pago → prefactura → cuenta global`;
- expone número de pago y documento;
- expone pagador, cajero y referencia;
- diferencia movimientos `paymentservice` de pagos legacy.

El vínculo temporal:

```text
vinculo_documental = pendiente_paymentservice
```

se reemplaza por:

```text
paymentservice
legacy_cuenta_global
```

según corresponda.

## 8. Migración

La migración:

1. agrega columnas a `pagos`;
2. crea tablas auxiliares;
3. crea la secuencia `pago`;
4. marca pagos históricos como confirmados;
5. genera números `PG-########`;
6. crea componentes de subtotal y servicio;
7. crea índices;
8. registra `v3_payment_schema_ready`.

Se ejecutó sobre una copia de la base operativa disponible:

```text
15 cuentas preservadas
15 pagos legacy preservados
15 pagos numerados
30 componentes generados
0 problemas de claves foráneas
```

## 9. Compatibilidad y alcance pendiente

Esta fase no agrega todavía endpoints públicos para cobrar desde Caja y no cambia la UI.

Queda pendiente:

```text
v3.2.1 API y read model operativo de Caja
v3.2.2 interfaz Caja
v3.2.3 efectivo recibido, vuelto, tarjeta y combinaciones
v3.2.4 créditos
v3.2.5 finalización explícita y liberación integral
```

El método `credito` permanece permitido para registros legacy, pero `paymentService` no crea pagos de crédito antes de `v3.2.4`.

## 10. Pruebas

Suite específica:

```text
npm run test:payments
8 pruebas aprobadas
0 fallos
```

Cobertura:

- pago total por prefactura;
- pago parcial;
- cajero y pagador en snapshot;
- componentes monetarios;
- idempotencia y conflicto de fingerprint;
- rechazo de sobrepago;
- concurrencia del último saldo;
- reverso y restauración;
- exclusión de anulados en lectura financiera;
- migración idempotente de pagos legacy.

Suite completa:

```text
npm test
70 pruebas aprobadas
0 fallos
```

También se validó sintaxis JavaScript y migración sobre copia de base. El servidor HTTP completo debe validarse localmente después de instalar dependencias.

## 11. Archivos

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/avance-v3.2.0-payments-prefactura.md

package.json
package-lock.json

server/config/appInfo.js
server/db/database.js
server/services/accountService.js
server/services/documentSequenceService.js
server/services/financialReadService.js
server/services/paymentService.js
server/services/preinvoiceService.js

tests/paymentMigration.test.js
tests/paymentService.test.js
```

## 12. Git seguro

```powershell
git status --short

git add README.md
git add docs/README-v3.0.md
git add docs/roadmap-v3.0-arquitectura-modular.md
git add docs/avance-v3.2.0-payments-prefactura.md

git add package.json
git add package-lock.json

git add server/config/appInfo.js
git add server/db/database.js
git add server/services/accountService.js
git add server/services/documentSequenceService.js
git add server/services/financialReadService.js
git add server/services/paymentService.js
git add server/services/preinvoiceService.js

git add tests/paymentMigration.test.js
git add tests/paymentService.test.js
```

Revisión:

```powershell
git diff --cached --name-only

git diff --cached --name-only | Select-String -Pattern "\.env$|certs/|cookies\.txt|data/.*\.db|data/.*\.db-shm|data/.*\.db-wal|data/backups|mundipos-rootCA|\.pem$|\.key$|node_modules"

git diff --cached --check
npm run test:payments
npm test
```

Commit:

```powershell
git commit -m "v3.2.0: crea Payments transaccional por prefactura"
git push origin main

git status --short
```
