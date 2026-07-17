# Avance v3.1.4 · Continuidad del consumo después de documentos y pagos

## Estado

Implementación terminada y preparada para validación operativa.

- Versión visible: `3.0`
- Versión interna/package: `3.1.4`
- Fase: continuidad de la cuenta global después de emitir o liquidar documentos
- Base de datos: sin tablas ni columnas nuevas

## Objetivo

Separar definitivamente el ciclo operativo de la mesa/banco del estado financiero de sus documentos.

La regla de esta fase es:

```text
pagar una prefactura o liquidar el saldo actual
≠
cerrar la cuenta global
≠
liberar la mesa/banco
```

Mientras `estado_operativo = abierta`, el responsable puede seguir agregando productos. Los consumos ya documentados o pagados permanecen en el historial, pero no vuelven a aparecer como cantidades disponibles.

## Lectura de continuidad por línea

Cada línea de consumo conserva ahora las vistas derivadas:

```text
cantidad_consumida
cantidad_disponible
cantidad_documentada
cantidad_documentada_pendiente
cantidad_pagada
cantidad_reservada_sin_documento
```

La disponibilidad continúa siendo:

```text
cantidad_disponible = cantidad_consumida - cantidad_asignada
```

La clasificación documental se deriva de `prefactura_items` y del estado de la prefactura:

- `emitida` o `parcial`: cantidad documentada pendiente de cobro;
- `pagada`: cantidad liquidada;
- `anulada`: no reserva cantidades y no forma parte del consumo documentado activo.

Una línea puede aparecer en más de una vista. Por ejemplo:

```text
Imperial ×3
├── pagada ×2
└── disponible ×1
```

Esto permite que los dos productos pagados desaparezcan del consumo activo sin eliminar el historial de la cuenta global.

## Read model de la cuenta

`accountService.getAccount()` entrega adicionalmente:

```text
productos_documentados_pendientes
productos_pagados
productos_reservados_sin_documento
resumen_documentos
continuidad_operativa
```

`continuidad_operativa` informa:

```text
servicio_activo
puede_agregar_consumo
requiere_finalizacion_explicita
mesa_debe_permanecer_ocupada
saldo_temporal_cero
consumo_disponible
consumo_documentado_pendiente
consumo_pagado
```

`resumen_documentos` incluye cantidades y montos de prefacturas activas, pendientes, pagadas y anuladas.

## Saldo temporal cero

Una cuenta puede encontrarse así:

```text
estado_operativo: abierta
estado_financiero: conciliada
saldo_pendiente: 0
```

Esto significa que el consumo registrado hasta ese momento está liquidado, no que el servicio terminó.

La mesa continúa:

- ocupada;
- vinculada al cliente principal;
- bajo los mismos responsables;
- disponible para agregar productos nuevos.

Cuando se agrega consumo nuevo, el total global acumulado aumenta y el estado financiero vuelve de `conciliada` a `parcial` o `pendiente`, sin crear otra cuenta global.

## Nuevos productos después de documentos pagados

El nuevo consumo no se mezcla con una línea que ya tiene cantidades asignadas. Se crea una línea nueva aunque el producto y el precio sean iguales.

Ejemplo:

```text
Línea 10 · Imperial ×3 · pagada/asignada ×2 · disponible ×1
Agregar Imperial ×2

Resultado:
Línea 10 · historial original
Línea 11 · Imperial ×2 · disponible ×2
```

Así se evita que una modificación posterior altere la trazabilidad de la prefactura ya emitida.

## Adaptador transitorio de pago completo

La ruta legacy:

```text
POST /api/orders/:id/pay
```

para pagos normales sin prefacturas ahora delega en:

```text
accountService.recordLegacyBalancePayment()
```

El adaptador:

1. valida que la cuenta siga abierta;
2. rechaza cuentas con prefacturas o cantidades asignadas;
3. calcula únicamente el saldo actual pendiente;
4. registra el movimiento en una transacción;
5. sincroniza el agregado financiero;
6. mantiene `estado_operativo = abierta`;
7. no cambia la mesa a `libre`;
8. no borra cliente, responsables ni fecha de apertura.

Si después se agregan productos, una segunda liquidación paga solo el nuevo saldo, no vuelve a cobrar lo anterior.

Este endpoint sigue siendo un adaptador temporal. El cobro por prefactura, idempotencia financiera, métodos mixtos y concurrencia de Caja se implementarán en `v3.2.x`.

### Crédito

El flujo legacy de crédito no se redefine en esta fase. Su integración correcta con la cuenta global y Payments permanece planificada para:

```text
v3.2.4 · Créditos integrados con Payments
```

## Interfaz de Ver pedido

La vista distingue:

```text
Consumo activo
Consumo documentado pendiente de cobro
Historial de consumo liquidado
Prefacturas emitidas
Resumen de cuenta global
```

Cuando el saldo es cero y la cuenta sigue abierta, se muestra el aviso:

```text
El consumo actual está liquidado, pero el servicio continúa abierto.
```

El botón de pago completo legacy solo se muestra cuando:

- el servicio está abierto;
- existe saldo pendiente mayor que cero;
- no hay prefacturas activas;
- no hay cantidades asignadas;
- el usuario tiene `cash.collect`.

## Integridad

El read model compara:

```text
cantidad_asignada
vs.
cantidad documentada en prefacturas no anuladas
```

Si existe una diferencia, la línea se identifica como reserva sin documento y la UI muestra una advertencia de revisión. Esta situación no debe aparecer en el flujo normal, pero queda visible para auditoría y recuperación.

## Cierre de mesa

Esta fase impide el cierre automático por pago normal, pero todavía no agrega el botón definitivo `Finalizar servicio`.

La finalización transaccional, validación de documentos pendientes, liberación de mesa y limpieza de responsabilidades corresponde a:

```text
v3.2.5 · Finalización y liberación integral
```

## Archivos principales

```text
server/services/accountService.js
server/routes/orders.js
public/js/components/orders.js
public/css/style.css
public/index.html
public/service-worker.js
tests/accountContinuity.test.js
```

## Pruebas automáticas

Suite específica:

```powershell
npm run test:continuity
```

Resultado:

```text
4 pruebas aprobadas
0 fallos
```

Suite completa:

```powershell
npm test
```

Resultado:

```text
57 pruebas aprobadas
0 fallos
```

La cobertura incluye:

- prefactura pagada que deja únicamente la cantidad restante en consumo activo;
- incorporación de productos nuevos después de un pago;
- conservación de cliente y responsables;
- total global acumulado correcto;
- saldo temporal cero con cuenta operativa abierta;
- reactivación del saldo al agregar consumo;
- pago transitorio del saldo actual sin liberar mesa;
- segundo pago que liquida únicamente el consumo nuevo;
- contrato visual de consumo activo, pendiente y liquidado.

## Validación operativa requerida

### Escenario de prefactura pagada

1. Abrir una mesa con `Imperial ×3`.
2. Emitir una prefactura de `Imperial ×2` para Pedro.
3. Cuando Payments esté disponible, liquidar ese documento; para esta fase puede validarse el read model mediante pruebas automáticas.
4. Confirmar que `Imperial ×2` aparece en historial liquidado.
5. Confirmar que el consumo activo conserva únicamente `Imperial ×1`.
6. Agregar `Imperial ×2` u otros productos.
7. Confirmar que la cuenta global aumenta y la mesa sigue ocupada.

### Escenario del adaptador transitorio

1. Abrir una cuenta sin prefacturas.
2. Procesar el pago completo con efectivo o tarjeta.
3. Confirmar que el saldo queda en cero.
4. Confirmar que la mesa sigue ocupada y conserva el cliente.
5. Agregar productos nuevos.
6. Confirmar que aparece un saldo nuevo.
7. Procesar otro pago y verificar que solo cobra ese saldo.

## Git seguro

```powershell
git status --short

git add README.md
git add docs/README-v3.0.md
git add docs/roadmap-v3.0-arquitectura-modular.md
git add docs/avance-v3.1.4-continuidad-consumo.md

git add package.json
git add package-lock.json

git add server/config/appInfo.js
git add server/services/accountService.js
git add server/routes/orders.js

git add public/js/components/orders.js
git add public/css/style.css
git add public/index.html
git add public/service-worker.js

git add tests/accountContinuity.test.js
```

Revisión obligatoria:

```powershell
git diff --cached --name-only

git diff --cached --name-only | Select-String -Pattern "\.env$|certs/|cookies\.txt|data/.*\.db|data/.*\.db-shm|data/.*\.db-wal|data/backups|mundipos-rootCA|\.pem$|\.key$|node_modules"

git diff --cached --check
npm run test:continuity
npm test
```

El filtro de seguridad debe quedar vacío.

## Commit

```powershell
git commit -m "v3.1.4: mantiene cuentas activas tras pagos parciales"
```

## Siguiente fase

```text
v3.1.5 · Read model financiero consolidado
```
