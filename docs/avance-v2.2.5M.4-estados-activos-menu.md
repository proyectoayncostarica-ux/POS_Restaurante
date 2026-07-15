# v2.2.5M.4 · Estado activo/inactivo de productos, categorías y presentaciones

## Objetivo

Permitir ocultar elementos del flujo operativo sin borrarlos, protegiendo el historial de cuentas, pagos, reportes y productos ya usados.

Esta subfase forma parte de la normalización base del módulo **Menú** antes de continuar con la estabilización profunda de **Cuentas / Orders**.

## Cambios principales

- Se agrega soporte compatible para `categorias.activa`.
- Se agrega soporte compatible para `productos.activo`.
- Se conserva `presentaciones.activo` y `presentaciones_producto.activo` como controles operativos.
- Menú administrativo puede cargar elementos activos e inactivos.
- Cuentas y endpoints operativos solo reciben elementos activos y válidos.
- Los botones de eliminación administrativa se sustituyen operativamente por activación/desactivación segura.

## Backend

### Base de datos

Se normaliza la estructura para asegurar:

```text
categorias.activa INTEGER NOT NULL DEFAULT 1
productos.activo INTEGER NOT NULL DEFAULT 1
presentaciones.activo INTEGER NOT NULL DEFAULT 1
presentaciones_producto.activo INTEGER NOT NULL DEFAULT 1
```

La migración es compatible con bases existentes y no elimina datos.

### Productos operativos

`GET /api/menu/operational-products` ahora responde bajo contrato:

```text
v2.2.5M.4
```

Reglas:

- Producto inactivo no aparece por defecto.
- Producto en categoría inactiva no aparece por defecto.
- Producto en subcategoría inactiva no aparece por defecto.
- Presentación global inactiva no aparece como opción operativa.
- Relación producto-presentación inactiva no aparece como opción operativa.
- `?include_invalid=1` permite diagnóstico administrativo de bloqueos.

### Endpoints administrativos actualizados

```text
GET /api/menu/categories?include_inactive=1
PUT /api/menu/categories/:id
DELETE /api/menu/categories/:id

GET /api/menu/products?include_inactive=1
PUT /api/menu/products/:id/active
DELETE /api/menu/products/:id

GET /api/menu/presentaciones-globales?include_inactive=1
PUT /api/menu/presentaciones-globales/:id
PUT /api/menu/presentaciones-globales/:id/active
DELETE /api/menu/presentaciones-globales/:id
```

Los `DELETE` de productos, categorías y presentaciones ahora funcionan como desactivación segura para evitar pérdida de información histórica.

## Frontend

En el módulo Menú se muestran estados:

- Activo
- Inactivo

Se agregan acciones visuales para activar/desactivar:

- Productos
- Categorías
- Subcategorías
- Presentaciones globales

Los elementos inactivos se muestran atenuados en la vista administrativa, pero no se exponen al flujo operativo normal.

## Reglas operativas

- Producto inactivo no debe aparecer en Cuentas.
- Categoría inactiva no debe aparecer como fuente operativa de productos.
- Subcategoría inactiva no debe aparecer como fuente operativa de productos.
- Presentación inactiva no debe aparecer para nuevas cuentas.
- Productos o presentaciones históricas no se eliminan.
- Cuentas históricas y reportes no deben romperse.

## No cambia todavía

- La UI de Cuentas / Orders.
- La normalización del carrito en Cuentas.
- El flujo de pago.
- El flujo de comandas.
- El endpoint que Orders usa actualmente para pintar productos legacy.

## Validación técnica

```powershell
node --check server/db/database.js
node --check server/routes/menu.js
node --check public/js/components/menu.js
node --check public/service-worker.js
```

## Criterio de cierre

La subfase se considera cerrada cuando:

- Se puede desactivar un producto desde Menú.
- El producto desactivado desaparece de la operación de Cuentas.
- Se puede reactivar el producto desde Menú.
- Se puede desactivar una categoría o subcategoría sin borrar datos.
- Se puede desactivar una presentación sin borrar datos.
- Los productos históricos no se pierden.
- El endpoint operativo de Menú conserva precios y presentaciones confiables.
