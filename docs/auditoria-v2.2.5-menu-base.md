# v2.2.5 · Auditoría técnica y normalización base del módulo Menú

## Estado del documento

- **Fase:** auditoría previa a la normalización profunda de Cuentas / Orders.
- **Fecha:** 2026-07-14.
- **Alcance:** revisión técnica y operativa de `Menú` como fuente de verdad para productos, precios, presentaciones, imágenes, categorías y cocina.
- **Cambios de código:** ninguno. Esta fase es documental.

## Objetivo

Verificar si el módulo **Menú** debe sanearse antes de continuar con la normalización del módulo **Cuentas / Orders**.

La conclusión de la auditoría es clara:

> **Sí. Cuentas depende directamente de Menú. Menú debe estabilizarse antes de normalizar a fondo Orders, porque productos, precios, presentaciones, imágenes y banderas de cocina nacen en Menú y son consumidos por Cuentas durante la operación diaria.**

## Archivos revisados

### Núcleo de Menú

- `server/routes/menu.js`
- `public/js/components/menu.js`

### Dependencias directas con Cuentas

- `server/routes/orders.js`
- `public/js/components/orders.js`

### Dependencias de datos y aplicación

- `server/db/database.js`
- `public/js/main.js`
- `public/index.html`

## Modelo de datos relacionado con Menú

Actualmente Menú se apoya en estas tablas principales:

### `categorias`

Responsable de categorías principales y subcategorías.

Campos relevantes:

- `id`
- `nombre`
- `parent_id`
- `permite_cocina`

Observaciones:

- Categoría principal y subcategoría viven en la misma tabla.
- `parent_id` distingue subcategorías.
- `nombre` es único globalmente, no por nivel.
- `permite_cocina` se usa para decidir si un producto puede generar comanda.

### `productos`

Responsable del producto base que luego consume Cuentas.

Campos relevantes:

- `id`
- `nombre`
- `descripcion`
- `precio`
- `categoria_id`
- `subcategoria_id`
- `es_cocina`
- `imagen`

Observaciones:

- No existe campo `activo`; si un producto no se puede eliminar por tener pedidos pendientes, tampoco existe una forma operativa clara de ocultarlo o desactivarlo.
- Los productos con presentaciones suelen guardar `precio = 0`; el precio real queda en `presentaciones_producto.precio`.
- Cuentas debe saber distinguir producto con precio base vs producto con precio por presentación.

### `presentaciones`

Catálogo global de presentaciones reutilizables.

Campos relevantes:

- `id`
- `nombre`
- `tipo`
- `cantidad`
- `activo`
- `creado_en`
- `actualizado_en`

Observaciones:

- Es catálogo global.
- Una presentación global no define precio por sí sola.
- El precio se define al asociarla con un producto.

### `presentaciones_producto`

Relación producto + presentación + precio.

Campos relevantes:

- `id`
- `producto_id`
- `presentacion_id`
- `precio`
- `activo`
- `imagen`

Observaciones:

- Esta tabla es crítica para Cuentas.
- `presentaciones_producto.id` se usa como identificador operativo en algunos flujos de Orders.
- Tiene campo `imagen`, pero en la UI actual no parece usarse como imagen específica por presentación.

## Endpoints actuales de Menú

### Categorías

- `GET /api/menu/categories`
- `POST /api/menu/categories`
- `DELETE /api/menu/categories/:id`

### Productos

- `GET /api/menu/products`
- `GET /api/menu/products/search`
- `GET /api/menu/products/:id/presentaciones`
- `POST /api/menu/products`
- `PUT /api/menu/products/:id`
- `DELETE /api/menu/products/:id`

### Menú completo

- `GET /api/menu/completo`

### Presentaciones globales

- `GET /api/menu/presentaciones-globales`
- `POST /api/menu/presentaciones-globales`
- `DELETE /api/menu/presentaciones-globales/:id`

## Funciones principales de frontend en `public/js/components/menu.js`

### Carga y render general

- `Menu.load()`
- `Menu.render()`
- `Menu.switchView()`

### Productos

- `Menu.renderProductsView()`
- `Menu.renderProductsTable()`
- `Menu.searchProducts()`
- `Menu.showCreateProductModal()`
- `Menu.createProduct()`
- `Menu.showEditProductModal()`
- `Menu.updateProduct()`
- `Menu.deleteProduct()`

### Categorías y subcategorías

- `Menu.renderCategoriesView()`
- `Menu.showCreateCategoryModal()`
- `Menu.createCategory()`
- `Menu.showCreateSubcategoryModal()`
- `Menu.createSubcategory()`
- `Menu.deleteCategory()`
- `Menu.loadSubcategories()`

### Cocina

- `Menu.onCategoriaChange()`
- `Menu.validateCocinaCheckbox()`
- `Menu.validateEditCocinaCheckbox()`

### Presentaciones

- `Menu.renderPresentationsView()`
- `Menu.showCreatePresentationModal()`
- `Menu.savePresentation()`
- `Menu.deletePresentation()`
- `Menu.loadPresentacionesGlobales()`
- `Menu.loadPresentacionesAsignadas()`
- `Menu.loadPresentacionesDisponibles()`
- `Menu.showPresentacionesModal()`
- `Menu.toggleSelectPresentaciones()`
- `Menu.toggleAgregarMasPresentaciones()`
- `Menu.onTogglePresentacionCheck()`

## Cruce confirmado: Menú → Cuentas / Orders

`public/js/components/orders.js` consume Menú directamente para:

- cargar productos desde `/api/menu/products`;
- llamar `Menu.load()`;
- leer `Menu.categories`;
- leer `Menu.products`;
- construir tabs de categorías;
- construir subcategorías;
- mostrar cards de productos;
- mostrar imágenes de productos;
- detectar `tiene_presentaciones`;
- abrir selector de presentaciones;
- consultar `/api/menu/products/:id/presentaciones`;
- tomar precios base de productos;
- tomar precios de presentaciones;
- detectar `es_cocina` para comandas.

`server/routes/orders.js` depende de las tablas de Menú para:

- validar `producto_id`;
- resolver `precio` de producto sin presentación;
- resolver `precio` de presentación desde `presentaciones_producto`;
- validar `presentacion_id`;
- insertar `pedido_productos`;
- marcar productos de cocina;
- generar comandas cuando aplica;
- recalcular totales.

## Conclusión de dependencia

La relación correcta debería ser:

```text
Menú
  ↓
Producto operativo normalizado
  ↓
Cuentas / Orders
  ↓
Pedido, cuenta, pago, crédito, comanda
```

Cuentas no debería reinterpretar reglas ambiguas de Menú. Cuentas debería recibir un producto normalizado y confiable.

## Hallazgos técnicos importantes

### 1. Menú es la fuente de verdad de precios, pero no tiene un contrato formal

Actualmente existen dos maneras de calcular precio:

```text
Producto sin presentación:
productos.precio

Producto con presentación:
presentaciones_producto.precio
```

Esto es correcto conceptualmente, pero no está documentado ni encapsulado en un contrato estable.

Riesgo:

- Orders puede usar `producto.precio` por error en productos con presentación.
- Productos con presentación pueden mostrar `precio = 0` en flujos legacy.
- El modal de agregar productos puede calcular mal si no consulta presentaciones.

### 2. La validación de cocina es inconsistente entre frontend y backend

En frontend, `Menu.onCategoriaChange()` muestra la opción de cocina si la categoría se llama exactamente `Comidas`:

```text
categoria.nombre.toLowerCase() === "comidas"
```

Pero el backend usa `permite_cocina` en categoría/subcategoría.

Además, el frontend en `validateCocinaCheckbox()` exige que categoría y subcategoría permitan cocina, mientras que el backend permite cocina si la categoría o la subcategoría lo permiten.

Riesgo:

- El frontend puede impedir una combinación que el backend permitiría.
- El backend puede aceptar una combinación que la UI no permite crear fácilmente.
- Si el restaurante cambia nombres de categorías, la lógica visual puede fallar.

### 3. Botones de edición de categorías llaman una función inexistente

En `Menu.renderCategoriesView()` existen botones:

```text
Menu.showEditCategoryModal(...)
```

Pero en `public/js/components/menu.js` no se encontró la función `showEditCategoryModal()`.

Riesgo:

- Si el usuario intenta editar una categoría o subcategoría, puede producirse error de consola.
- La UI muestra una acción que no está implementada.

### 4. Hay funciones legacy o incompletas de presentaciones

Se detectaron funciones que parecen pertenecer a flujos anteriores o incompletos:

- `toggleEditPresentaciones()` llama `loadPresentacionesSelect('edit')`, pero `loadPresentacionesSelect` no aparece definido.
- `togglePrecioInput()` parece no formar parte del flujo principal actual.
- `eliminarPresentacionAsignada()` parece ser auxiliar legacy.

Riesgo:

- Mantener funciones parcialmente conectadas dificulta depurar presentaciones.
- Orders puede heredar inconsistencias si consume productos con presentaciones mal administradas.

### 5. `GET /api/menu/completo` puede omitir productos sin subcategoría

El endpoint `/completo` construye el menú recorriendo categorías principales y subcategorías. En ese recorrido consulta productos con `subcategoria_id = sub.id`.

Riesgo:

- Productos asignados solo a categoría principal, sin subcategoría, pueden quedar fuera de `/completo`.
- Aunque Orders actualmente usa `/menu/products`, este endpoint podría causar errores si se adopta después para optimizar el menú.

### 6. No existe desactivación de productos

`productos` no tiene `activo`.

Actualmente, si un producto tiene pedidos pendientes, no se puede eliminar. Pero tampoco hay forma de ocultarlo de la operación.

Riesgo operativo:

- Productos que ya no se venden pueden seguir apareciendo en Cuentas.
- Eliminar productos históricos es peligroso.
- Menú necesita una opción de activo/inactivo antes de estabilizar Orders.

### 7. Imágenes de producto están en Menú, pero Orders las usa directamente

Orders construye la imagen así:

```text
producto.imagen ? origin + producto.imagen : /uploads/ImagenGenerica.jpg
```

Esto funciona, pero la imagen queda como una convención no formalizada.

Riesgo:

- Si Menú cambia ruta o formato de imagen, Orders puede romper visualmente.
- `presentaciones_producto.imagen` existe en base, pero no parece formar parte del contrato operativo.

### 8. Respuestas de presentaciones tienen formato dual

`GET /api/menu/products/:id/presentaciones` devuelve datos en dos formas:

```text
producto_nombre
presentaciones

data: {
  producto_nombre,
  presentaciones
}
```

Esto conserva compatibilidad, pero también revela que distintos flujos esperan formas distintas.

Riesgo:

- Orders puede consumir `response.data.presentaciones` en un flujo y `response.presentaciones` en otro.
- Mantener ambas formas sin documentar aumenta acoplamiento.

### 9. Menú no separa claramente datos administrativos y datos operativos

`GET /api/menu/products` devuelve todos los productos para administración y operación.

Para Orders sería mejor tener un contrato operativo específico, por ejemplo:

```text
GET /api/menu/operational-products
```

o normalizar `/products` para devolver siempre campos operativos confiables.

Campos operativos esperados:

- `producto_id`
- `nombre`
- `descripcion`
- `categoria_id`
- `categoria_nombre`
- `subcategoria_id`
- `subcategoria_nombre`
- `imagen_url`
- `es_cocina`
- `tiene_presentaciones`
- `precio_base`
- `presentaciones_activas`
- `precio_minimo`
- `activo`

### 10. Menú no tiene restricciones backend administrativas claras

Las rutas de Menú están protegidas por autenticación general, pero dentro de `server/routes/menu.js` no se observa una restricción explícita de administrador para crear, editar o eliminar productos/categorías/presentaciones.

Riesgo:

- Si la UI se oculta pero un usuario estándar llama directamente el endpoint, podría modificar Menú si no existe una protección previa en otra capa.
- Menú es crítico para precios y operación; debería estar protegido backend-side.

## Hallazgos sobre Cuentas dependiente de Menú

### Crear pedido usa el flujo moderno

El flujo moderno de Orders usa:

- `Menu.categories`
- `Menu.products`
- tabs de categoría;
- subcategorías;
- cards de producto;
- selector de presentaciones.

### Agregar productos a pedido existente todavía usa flujo legacy

El flujo de agregar productos a un pedido existente usa selects con `data-price` y `data-cocina`.

Riesgo:

- Un producto con presentaciones puede no resolverse igual que en Crear Pedido.
- Menú debe ofrecer un producto operativo normalizado para que ambos flujos compartan la misma fuente.

## Clasificación de riesgos

### Riesgo alto

- Inconsistencia de precios entre producto base y presentaciones.
- Falta de contrato operativo Menú → Orders.
- Función `showEditCategoryModal()` inexistente pero llamada por la UI.
- Falta de desactivación de productos.
- Falta de restricción backend explícita para cambios administrativos de Menú.

### Riesgo medio

- Lógica de cocina basada en nombre `Comidas` en frontend.
- `/menu/completo` omite productos sin subcategoría.
- Respuesta dual en endpoint de presentaciones.
- Funciones legacy de presentaciones.

### Riesgo bajo

- Logs de depuración en búsqueda de productos.
- Inconsistencias visuales menores en tablas/modal legacy.

## Recomendación de ejecución

Antes de continuar con la normalización de Cuentas, conviene insertar una fase previa para Menú.

Propuesta de bloque previo:

```text
v2.2.5M · Normalización base del módulo Menú
```

Subfases sugeridas:

```text
v2.2.5M.0 · Auditoría técnica de Menú
v2.2.5M.1 · Contrato operativo Menú → Cuentas
v2.2.5M.2 · Protección backend administrativa de Menú
v2.2.5M.3 · Normalización de productos operativos
v2.2.5M.4 · Normalización de presentaciones y precios
v2.2.5M.5 · Normalización de cocina/comandas desde Menú
v2.2.5M.6 · Limpieza de funciones legacy de Menú
v2.2.5M.7 · Cierre y pruebas Menú → Cuentas
```

## Siguiente paso recomendado

Crear el documento:

```text
docs/roadmap-v2.2.5M-normalizacion-menu.md
```

Ese roadmap debe definir el contrato estable que Cuentas usará después para no reescribir lógica dos veces.

## Criterio de cierre de esta auditoría

Esta auditoría queda cerrada cuando se confirme que:

- Menú es reconocido como fuente de verdad para productos, precios, presentaciones, imágenes y cocina.
- Se aprueba ejecutar una normalización base de Menú antes de intervenir `orders.js` a fondo.
- El roadmap de Menú queda documentado en `docs/`.

