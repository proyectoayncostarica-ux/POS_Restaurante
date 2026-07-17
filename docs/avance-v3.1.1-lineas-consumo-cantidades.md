# v3.1.1 · Líneas de consumo y cantidades disponibles

## Objetivo

Normalizar `pedido_productos` como líneas de consumo estables, trazables y divisibles por cantidades antes de crear prefacturas persistentes.

La fase conserva la cuenta global como fuente financiera. No registra ventas nuevas ni implementa cobros; únicamente establece qué unidades continúan disponibles para ser asignadas a documentos operativos.

## Regla de dominio

```text
cantidad_disponible
= cantidad_consumida
- cantidad_asignada
```

`cantidad_asignada` representará desde `v3.1.2` la suma de cantidades vinculadas a prefacturas no anuladas.

## Persistencia

`pedido_productos` incorpora:

```text
cantidad_asignada
producto_nombre_snapshot
presentacion_nombre_snapshot
presentacion_cantidad_snapshot
aplica_servicio_snapshot
porcentaje_servicio_snapshot
servicio_unitario_snapshot
actualizado_en
version
```

La cantidad consumida original continúa en `cantidad`. No se elimina ni se reduce cuando una unidad se asigna.

## Read model

Cada línea devuelve:

```text
pedido_producto_id
cantidad_consumida
cantidad_asignada
cantidad_disponible
estado_asignacion
subtotal_consumido
subtotal_asignado
subtotal_disponible
servicio_asignado
servicio_disponible
total_asignado
total_disponible
version
```

La cuenta global agrega:

```text
productos               historial completo
productos_disponibles   consumo todavía seleccionable
productos_asignados     líneas con reserva total o parcial
resumen_lineas           unidades y montos consolidados
```

## Asignación transaccional

`accountService.assignAvailableQuantities()`:

1. normaliza IDs y cantidades;
2. agrupa entradas repetidas de una misma línea;
3. verifica que la cuenta esté abierta;
4. valida la versión esperada;
5. comprueba disponibilidad;
6. actualiza todas las líneas dentro de una transacción `IMMEDIATE`;
7. revierte la operación completa ante cualquier error.

Ejemplo permitido:

```text
Imperial ×3
asignación 1: ×2
asignación 2: ×1
```

Ejemplo rechazado:

```text
Imperial ×3
misma solicitud: ×2 + ×2
```

El segundo caso se agrupa como cuatro unidades antes de escribir y no deja cambios parciales.

## Liberación

`accountService.releaseAssignedQuantities()` resta cantidades asignadas sin alterar el consumo original. Será utilizado por la anulación de prefacturas en fases posteriores.

## Consolidación de líneas

El consumo nuevo solo se suma a una línea existente cuando coinciden:

- cuenta;
- producto;
- presentación;
- precio;
- política de servicio;
- `cantidad_asignada = 0`.

Si una línea ya fue asignada total o parcialmente, el consumo nuevo crea otra línea. Esto mantiene separado el historial anterior del consumo agregado después.

## Edición legacy

La edición temporal que recibe `producto_id` queda bloqueada cuando:

- existen varias líneas para el mismo producto;
- la línea utiliza presentación;
- la línea tiene cantidades asignadas;
- la línea cambió concurrentemente.

La edición por línea específica será el único contrato válido cuando se retire el adaptador legacy.

## UI

`Ver pedido` diferencia:

```text
Consumo activo
Consumo ya asignado
Resumen de cuenta global
```

Las cantidades asignadas permanecen visibles como historial, pero no vuelven a sumarse al consumo disponible.

## Migración

Las líneas existentes reciben:

- `cantidad_asignada = 0`;
- snapshots de producto y presentación;
- snapshot de servicio desde la cuenta global;
- versión inicial;
- timestamp de actualización.

El backfill es idempotente y no vuelve a modificar snapshots ya establecidos. La migración fue validada sobre una copia de la base operativa con 38 líneas y 46 unidades; no se detectaron cantidades inválidas.

## Pruebas

La suite terminó con:

```text
36 pruebas aprobadas
0 fallos
```

Casos nuevos:

- snapshots y disponibilidad inicial;
- distribución `2 + 1`;
- rechazo atómico de `2 + 2`;
- consolidación segura;
- separación después de asignación parcial;
- liberación de cantidades;
- bloqueo de edición legacy;
- conflicto por versión;
- migración idempotente de líneas antiguas.

## Compatibilidad

Esta fase no implementa todavía:

- secuencias documentales;
- prefacturas;
- nombres de pagadores;
- impresión de prefacturas;
- cobros de Caja;
- Payments;
- cierre explícito de mesa.

La ruta `/api/orders` continúa siendo el adaptador compatible de la cuenta global.

## Archivos principales

```text
server/db/database.js
server/services/accountService.js
public/js/components/orders.js
public/index.html
public/service-worker.js
tests/consumptionLines.test.js
tests/consumptionLineMigration.test.js
```

## Git seguro

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue

git status --short

git add README.md
git add docs/README-v3.0.md
git add docs/roadmap-v3.0-arquitectura-modular.md
git add docs/avance-v3.1.1-lineas-consumo-cantidades.md

git add package.json
git add package-lock.json

git add server/config/appInfo.js
git add server/db/database.js
git add server/services/accountService.js

git add public/js/components/orders.js
git add public/index.html
git add public/service-worker.js

git add tests/helpers/testDatabase.js
git add tests/helpers/bcryptFallback.js
git add tests/operationalAccessParity.test.js
git add tests/consumptionLines.test.js
git add tests/consumptionLineMigration.test.js

git diff --cached --name-only
git diff --cached --check
npm run test:lines
npm test

git commit -m "v3.1.1: normaliza lineas y cantidades de consumo"
git push origin main

git status --short
```

## Siguiente fase

```text
v3.1.2 · Secuencias y modelo persistente de prefacturas
```
