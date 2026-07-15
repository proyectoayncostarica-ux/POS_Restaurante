# v2.2.5M.8 · Integración Menú → Cuentas

## Objetivo
Integrar Cuentas/Orders con el contrato operativo normalizado de Menú para que el flujo de venta consuma únicamente productos, precios y presentaciones válidas para operación.

## Contexto
Durante la auditoría previa se confirmó que Cuentas depende de Menú para:

- productos disponibles;
- categorías y subcategorías;
- precios base;
- presentaciones y precios por presentación;
- productos de cocina/comanda;
- imágenes de productos;
- estados activo/inactivo.

Por eso, después de estabilizar Menú, Orders debía dejar de depender de `/api/menu/products` como lista administrativa y pasar al contrato operativo.

## Cambios frontend

### `public/js/components/orders.js`

- Se agrega carga de Menú operativo desde:

```text
/api/menu/operational-products
```

- `Orders.load()` ahora sincroniza productos/categorías operativas desde el contrato Menú.
- `showCreateOrderModal()` ya no ejecuta `Menu.load()`, evitando cargar elementos inactivos cuando el usuario es administrador y evitando renderizar Menú administrativo desde Cuentas.
- Se agregan helpers para:
  - sincronizar contrato operativo;
  - calcular precio visible operativo;
  - detectar productos con presentación;
  - normalizar imágenes;
  - construir payload seguro de productos seleccionados sin enviar precio desde frontend.
- El selector de productos en pedidos muestra precios operativos:
  - producto sin presentación: precio base operativo;
  - producto con presentación: `Desde ₡...` o rango si aplica.
- El selector de presentaciones usa primero las presentaciones operativas embebidas en el contrato Menú.
- Si debe consultar fallback, filtra solo presentaciones asignadas y disponibles.
- El flujo de `Agregar Productos` a una cuenta existente deja de usar el selector plano legacy y reutiliza el selector visual por categorías/subcategorías.
- Se agrega soporte para productos sin subcategoría dentro de una categoría que sí tiene subcategorías mediante la opción `Sin subcategoría`.

## Cambios backend

### `server/routes/orders.js`

- Se agregan validaciones operativas para pedidos:
  - producto existe;
  - producto activo;
  - categoría activa;
  - subcategoría activa si aplica;
  - presentación activa si aplica;
  - relación producto-presentación activa;
  - precio operativo mayor a cero.
- El backend deja de confiar en precios enviados desde el frontend.
- El precio final se resuelve desde:
  - `productos.precio` para productos sin presentación;
  - `presentaciones_producto.precio` para productos con presentación.
- Si un producto tiene presentaciones operativas, el backend exige `presentacion_id`.
- Se mantiene compatibilidad con IDs de `presentaciones_producto.id` o `presentaciones.id`, normalizando internamente a `presentaciones.id` para guardar en `pedido_productos`.
- Se mantiene detección de cocina desde el producto validado para generar comanda.

### `server/routes/menu.js`

- Se actualiza `version_contrato` de `/api/menu/operational-products` a `v2.2.5M.8`.

## Qué no cambia

- No se modifica la estructura de base de datos.
- No se cambia el modelo de imágenes todavía.
- No se elimina el endpoint legacy `/api/menu/products` porque sigue sirviendo para Menú administrativo.
- No se cambian cuentas ya creadas ni historial de pedidos.

## Pendiente posterior

La imagen sigue saliendo desde el producto. La nueva regla indicada por producto con presentación activa, donde la imagen pueda venir desde la presentación, queda pendiente para una fase posterior porque requiere definir el modelo visual y de carga de imágenes por presentación.

## Pruebas recomendadas

### Nuevo pedido

1. Abrir una mesa/banco ocupado.
2. Crear pedido con producto sin presentación.
3. Crear pedido con producto con presentación.
4. Confirmar que el selector muestra solo presentaciones asignadas y operativas.
5. Confirmar que el total se calcula con precio de presentación.
6. Confirmar que productos de cocina generan comanda.

### Agregar productos a pedido existente

1. Abrir una cuenta pendiente.
2. Agregar producto sin presentación.
3. Agregar producto con presentación.
4. Confirmar que el backend consolida productos repetidos por producto/presentación.
5. Confirmar que el total de la cuenta se actualiza correctamente.

### Seguridad operativa

1. Desactivar un producto en Menú.
2. Confirmar que no aparece en Cuentas.
3. Desactivar una categoría/subcategoría.
4. Confirmar que sus productos no aparecen en Cuentas.
5. Desactivar una presentación o relación producto-presentación.
6. Confirmar que no aparece como opción operativa.

## Archivos modificados

- `README.md`
- `docs/avance-v2.2.5M.8-integracion-menu-cuentas.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `server/routes/menu.js`
- `server/routes/orders.js`
- `public/js/components/orders.js`
- `public/index.html`
- `public/service-worker.js`
