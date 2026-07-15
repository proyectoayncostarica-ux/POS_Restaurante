# v2.2.5M.9 · Pruebas Menú → Cuentas

## Objetivo
Validar y dejar trazabilidad de que la integración `Menú → Cuentas` funciona correctamente después de `v2.2.5M.8`, antes de cerrar la normalización base del módulo Menú.

Esta subfase es de pruebas y documentación. No debe introducir lógica nueva salvo correcciones puntuales si durante la prueba aparece un bug real.

## Alcance

Se valida que Cuentas/Orders consuma Menú como fuente de verdad para:

- productos operativos;
- categorías y subcategorías activas;
- productos con y sin presentación;
- tipos/grupos de presentación;
- presentaciones asignadas por producto;
- precios reales desde backend;
- productos de cocina y generación de comanda;
- agregar productos a una cuenta existente.

## Fuera de alcance

- No se moderniza UI.
- No se cambia el modelo de imágenes por presentación.
- No se agregan nuevas reglas de negocio.
- No se modifica el service worker ni el cache PWA.
- No se retoma todavía la normalización profunda de Cuentas fuera del contrato Menú.

## Matriz de pruebas funcionales

| ID | Caso | Preparación | Acción | Resultado esperado | Estado |
| --- | --- | --- | --- | --- | --- |
| M9-01 | Producto sin presentación | Producto activo con precio base mayor a 0 | Crear pedido y seleccionar producto | Se agrega con precio correcto desde backend | Pendiente |
| M9-02 | Producto con presentación | Producto activo con grupo y presentaciones asignadas | Crear pedido, seleccionar producto y elegir presentación | Se agrega con precio de presentación, no con precio base 0 | Pendiente |
| M9-03 | Presentaciones filtradas por producto | Producto con solo algunas presentaciones del grupo asignadas | Abrir selector de presentación | Solo aparecen presentaciones asignadas y activas del producto | Pendiente |
| M9-04 | Producto directo sin subcategoría | Producto activo ligado solo a categoría | Abrir Nuevo Pedido y usar opción `Sin subcategoría` | El producto aparece y se puede agregar | Pendiente |
| M9-05 | Producto con subcategoría | Producto activo ligado a categoría y subcategoría activa | Filtrar por categoría/subcategoría | Aparece únicamente dentro de su contexto correcto | Pendiente |
| M9-06 | Producto de cocina | Producto activo marcado como cocina | Crear pedido con ese producto | Se guarda pedido y genera comanda según flujo existente | Pendiente |
| M9-07 | Agregar producto a cuenta existente | Cuenta abierta existente | Usar Agregar Productos | Selector visual carga productos operativos y permite agregar | Pendiente |
| M9-08 | Agregar presentación a cuenta existente | Cuenta abierta y producto con presentación | Agregar producto con presentación | Se agrega con presentación y precio correcto | Pendiente |
| M9-09 | Producto inactivo | Producto desactivado desde Menú | Abrir Nuevo Pedido | No aparece en Cuentas | Pendiente |
| M9-10 | Categoría inactiva | Categoría desactivada con productos activos dentro | Abrir Nuevo Pedido | Sus productos no aparecen operativamente | Pendiente |
| M9-11 | Subcategoría inactiva | Subcategoría desactivada con productos activos dentro | Abrir Nuevo Pedido | Sus productos no aparecen operativamente | Pendiente |
| M9-12 | Presentación inactiva | Presentación asignada al producto pero desactivada | Abrir selector de presentación | La presentación no aparece | Pendiente |
| M9-13 | Relación producto-presentación inactiva | Presentación activa pero relación desactivada | Abrir selector de presentación | La presentación no aparece para ese producto | Pendiente |
| M9-14 | Precio inválido | Presentación o producto con precio operativo 0/inválido | Intentar agregar desde Cuentas | Backend rechaza o evita inserción inválida | Pendiente |
| M9-15 | Usuario estándar | Usuario no administrador | Operar Cuentas y consultar Menú | Puede vender productos activos, pero no administrar Menú | Pendiente |
| M9-16 | Usuario admin | Usuario administrador | Operar Cuentas y administrar Menú | Puede administrar Menú y los cambios se reflejan en Cuentas tras recargar | Pendiente |

## Prueba técnica recomendada

```powershell
node --check server/routes/menu.js
node --check server/routes/orders.js
node --check public/js/components/orders.js
node --check public/js/components/menu.js
node --check public/service-worker.js
node --check server/app.js
```

## Criterio de aprobación

La subfase se considera aprobada si:

- Cuentas no muestra productos inactivos ni dependientes de categorías/subcategorías inactivas.
- Los productos con presentación nunca usan el precio base 0 como precio final.
- Las presentaciones visibles en Cuentas son únicamente las asignadas y activas para el producto.
- El backend resuelve precios desde SQLite y no confía en precios enviados por frontend.
- Agregar productos a una cuenta existente respeta el mismo contrato que crear un pedido nuevo.
- Los productos de cocina siguen generando comanda.
- Usuario estándar puede operar, pero no administrar Menú.

## Resultado esperado

Si todos los casos se validan correctamente, la siguiente subfase debe ser:

```text
v2.2.5M.10 · Cierre Menú base
```
