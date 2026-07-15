# Auditoría v2.2.5.0 · Módulo Cuentas / Orders después de Menú

## Propósito

Revisar el estado real de Cuentas después del cierre de `v2.2.5M.13`, identificar qué partes del roadmap original ya fueron adelantadas por la integración Menú → Cuentas y localizar riesgos de permisos, consistencia, deuda legacy y mantenibilidad antes de modificar lógica crítica.

Esta auditoría es estática y documental. No modifica backend, frontend, SQLite ni PWA.

## Archivos revisados

```text
server/routes/orders.js
public/js/components/orders.js
server/routes/menu.js
server/routes/tables.js
server/routes/dashboard.js
server/routes/accounts.js
server/routes/credits.js
server/db/database.js
server/utils/realtime.js
server/app.js
public/js/components/menu.js
public/js/components/dashboard.js
public/js/components/tables.js
public/js/components/accounts.js
public/js/main.js
```

## Estado técnico observado

- `server/routes/orders.js`: aproximadamente 849 líneas.
- `public/js/components/orders.js`: aproximadamente 1949 líneas.
- Ambos archivos pasan validación de sintaxis con `node --check`.
- Todas las rutas de Orders están protegidas por sesión mediante `requireAuth` en `server/app.js`.
- La integración de `v2.2.5M.8` ya conectó Cuentas con `GET /api/menu/operational-products`.
- Crear pedido y agregar productos ya comparten el selector visual por categorías, subcategorías, productos y presentaciones.

## Avances heredados de la fase Menú

Los siguientes puntos del roadmap original de Cuentas ya tienen una base funcional y no deben reimplementarse desde cero:

1. **Fuente operativa de productos:** Orders consume el contrato normalizado de Menú.
2. **Productos y jerarquías activas:** el backend rechaza productos, categorías, subcategorías y presentaciones inactivas.
3. **Precio por presentación:** el backend obtiene el precio desde `presentaciones_producto` y no confía en el precio enviado por frontend.
4. **Presentación obligatoria:** un producto con presentaciones operativas exige seleccionar una presentación.
5. **Crear/agregar productos:** ambos flujos usan el mismo selector visual y el mismo objeto temporal `selectedProducts`.
6. **Productos sin subcategoría:** el selector contempla la opción operativa `Sin subcategoría`.
7. **Imágenes normalizadas:** Menú ya expone imagen base y por presentación; Orders todavía debe consumir plenamente la imagen de presentación en su selector.

## Rutas activas detectadas

```text
GET    /api/orders
GET    /api/orders/:id
POST   /api/orders
POST   /api/orders/:id/products
PUT    /api/orders/:pedido_id/products/:producto_id
POST   /api/orders/:id/pay
GET    /api/orders/comandas/pending
PUT    /api/orders/comandas/:id/print
```

## Hallazgos críticos

### 1. Ausencia de autorización operativa dentro de Orders

`requireAuth` confirma que existe sesión, pero `server/routes/orders.js` no aplica por sí mismo las reglas ya existentes en Zonas para:

- zona permitida por rol activo;
- responsabilidad de mesa/cuenta;
- administrador global;
- usuario estándar responsable;
- usuario estándar no responsable.

En el estado actual, un usuario autenticado puede intentar listar, consultar, crear, agregar productos, editar o pagar cuentas fuera de su responsabilidad llamando directamente a la API.

**Prioridad:** crítica. Debe resolverse en `v2.2.5.2`.

### 2. Colisión de rutas de comandas

`GET /:id` está declarado antes de `GET /comandas/pending`. En Express, una solicitud a `/api/orders/comandas/pending` puede ser capturada primero por `/:id`, usando `comandas` como identificador.

**Prioridad:** alta. Debe corregirse antes de validar comandas.

### 3. Operaciones críticas sin transacción SQLite

Crear pedido, agregar productos, pagar y enviar a crédito ejecutan múltiples escrituras consecutivas sin una transacción envolvente.

Una falla intermedia puede dejar estados parciales, por ejemplo:

- pedido creado sin todos sus productos;
- productos agregados sin historial o comanda;
- pago registrado sin liberar correctamente la mesa;
- crédito creado con responsabilidad residual.

**Prioridad:** crítica. Debe resolverse en el servicio backend común.

### 4. Un GET modifica la base de datos

`GET /api/orders/:id` llama a `updateOrderServiceTotals()`, que recalcula y actualiza columnas del pedido. Una lectura no debería producir escrituras ni cambios de estado.

Esto mezcla consulta y reparación de datos, complica pruebas y puede generar bloqueos innecesarios en SQLite.

**Prioridad:** alta.

### 5. Endpoint legacy de edición incompatible con presentaciones

`PUT /api/orders/:pedido_id/products/:producto_id` presenta varios riesgos:

- identifica por `producto_id`, no por la fila concreta de `pedido_productos`;
- puede actualizar varias filas del mismo producto;
- toma `productos.precio`, que puede ser `0` en productos con presentación;
- no valida el contrato operativo de Menú;
- puede conservar una `presentacion_id` incompatible con el nuevo producto;
- no contempla imagen, grupo ni presentación elegida;
- usa autorización por contraseña del primer administrador activo.

**Prioridad:** crítica. Debe rediseñarse o retirarse si no existe flujo activo real.

### 6. Pago y crédito no limpian responsabilidades

Los flujos de pago normal y crédito liberan la mesa, pero no se observó limpieza de `mesa_responsables` dentro de Orders.

Zonas ya tiene helpers para responsabilidad operativa, pero Orders no reutiliza ese comportamiento.

**Prioridad:** crítica para consistencia Dashboard → Zonas → Cuentas.

### 7. Pago parcial o dividido incompleto

El backend acepta `productos_divididos` y calcula un monto parcial, pero no se observa un cierre completo del ciclo:

- no descuenta o marca productos ya pagados;
- no recalcula un saldo restante independiente;
- el pedido puede permanecer pendiente con el total completo;
- existe riesgo de repetir cobros sobre los mismos productos.

Debe decidirse si el pago dividido será funcional en esta fase o si se deshabilita explícitamente hasta tener modelo persistente.

### 8. Funciones frontend legacy u huérfanas

Candidatas verificadas para revisión en `public/js/components/orders.js`:

```text
addProductRow()
addProductRowToList()
removeProductRow()
updateProductPrice()
calculateTotal()
calculateAddTotal()
updatePaymentTotal()
updateProductResumen()
updateOrderResumenTotal()
```

Las primeras seis pertenecen al selector antiguo basado en filas/selects. El flujo visible actual usa cards, `selectedProducts` y `showOrderSummaryModal()`.

No deben eliminarse hasta revisar HTML dinámico y llamadas cruzadas, pero actualmente aparecen como deuda legacy clara.

### 9. Estado frontend demasiado acoplado

El objeto global `Orders` mezcla:

- carga y listado de cuentas;
- estado del carrito;
- selección de presentaciones;
- render de categorías;
- pago y crédito;
- impresión;
- manipulación directa del footer de modales;
- liberación de mesas mediante `Tables`;
- sincronización de datos dentro del objeto global `Menu`.

Esto dificulta probar o modificar una función sin afectar otras. La normalización debe separar al menos:

```text
estado del carrito
adaptador del catálogo operativo
render del selector
servicio de pago
acciones de cuenta
```

### 10. Impresión todavía es placeholder

```text
printComanda()
printReceipt()
```

solo muestran notificaciones. La existencia de endpoints y tablas no equivale a una impresión funcional.

Debe tomarse una decisión explícita en la fase de comandas.

### 11. Imagen por presentación no consumida plenamente

M.13 entrega imagen efectiva por presentación, pero el selector de presentaciones de Orders construye cards con nombre, precio y grupo, sin mostrar la imagen específica de cada presentación.

No bloquea precios ni ventas, pero queda como integración visual pendiente dentro de Cuentas.

## Riesgos medios y de mantenibilidad

- Existen nombres mezclados: pedido, orden, cuenta, zona y mesa.
- Hay estilos inline y emojis definidos por nombres literales de categorías/subcategorías.
- `Orders` sincroniza datos escribiendo directamente en `Menu.categories` y `Menu.products`.
- Algunos flujos llaman `Dashboard.refreshData()` y además `Orders.load()`, mientras realtime global también puede refrescar módulos.
- `renderOrdersView()` contiene una apertura duplicada de `<div class="table-container">`.
- Los estados mostrados y los estados persistidos requieren normalización transversal.

## Orden actualizado de intervención

```text
v2.2.5.0  Auditoría post-Menú y recalibración
v2.2.5.1  Contrato operativo de Cuentas
v2.2.5.2  Permisos, zona y responsabilidad backend
v2.2.5.3  Servicio transaccional de cuenta, productos y precios
v2.2.5.4  Carrito frontend único y estado desacoplado
v2.2.5.5  Unificación visual final crear/agregar y presentación-imagen
v2.2.5.6  Pagos, crédito, servicio y liberación integral
v2.2.5.7  Comandas e impresión: implementar o aislar
v2.2.5.8  Limpieza legacy y funciones huérfanas
v2.2.5.9  Estados y textos operativos
v2.2.5.10 Realtime específico de Cuentas
v2.2.5.11 Pruebas cruzadas
v2.2.5.12 Cierre técnico
```

## Criterio de cierre de la auditoría

La auditoría queda cerrada cuando:

- el roadmap reconoce los avances heredados de Menú;
- no se repite la integración ya terminada en M.8;
- permisos y transacciones quedan como primeras prioridades;
- las funciones legacy se consideran candidatas, no se eliminan a ciegas;
- el siguiente paso queda definido como contrato operativo documental.

## Validaciones estáticas ejecutadas

```powershell
node --check server/routes/orders.js
node --check public/js/components/orders.js
node --check server/routes/tables.js
node --check server/utils/realtime.js
```

Resultado: sin errores de sintaxis.
