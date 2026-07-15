# v2.2.5M.13 · Imágenes por presentación y producto

## Objetivo
Cerrar la lógica de imágenes del módulo Menú para productos con presentaciones, permitiendo que una presentación asignada a un producto tenga su propia imagen operativa.

## Regla definida
Para productos sin presentación:

```text
producto.imagen → ImagenGenerica.jpg
```

Para productos con presentación:

```text
presentaciones_producto.imagen → producto.imagen → ImagenGenerica.jpg
```

Esto permite que un mismo producto base tenga imágenes distintas según su presentación.

## Backend
Se ajusta `server/routes/menu.js` para que los endpoints de creación y edición de productos acepten archivos con nombres dinámicos:

```text
imagen_presentacion_<presentacion_id>
```

Ejemplo:

```text
imagen_presentacion_12
imagen_presentacion_15
```

Las imágenes se guardan en:

```text
presentaciones_producto.imagen
```

La imagen base del producto se mantiene en:

```text
productos.imagen
```

## Contrato operativo
`GET /api/menu/operational-products` ahora entrega:

- `imagen`
- `imagen_url`
- `imagen_producto`
- `imagen_origen`

A nivel de presentación también entrega:

- `imagen`
- `imagen_url`
- `imagen_origen`

`imagen_origen` puede ser:

```text
presentacion
producto
generica
```

## Menú administrativo
En el modal de producto:

- al crear producto con presentación, cada presentación seleccionada permite cargar imagen opcional;
- al editar producto con presentación, se muestra miniatura actual por presentación;
- si se carga nueva imagen de presentación, se actualiza solo esa relación producto-presentación;
- si no se carga imagen nueva, se conserva la imagen existente.

## Vista de consulta
El modal `Ver presentaciones` muestra miniatura por presentación, cantidad, grupo y precio.

## Alcance no incluido
No se incluye todavía:

- ZIP de imágenes;
- carga de imágenes desde plantilla Excel;
- optimización avanzada de imágenes;
- almacenamiento externo/CDN.

## Archivos modificados
- `README.md`
- `docs/avance-v2.2.5M.13-imagenes-presentacion-producto.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `docs/roadmap-v2.2.5M11-13-plantillas-menu.md`
- `server/routes/menu.js`
- `public/js/components/menu.js`
- `public/css/style.css`
- `public/index.html`
- `public/service-worker.js`

## Validación recomendada

```powershell
node --check server/routes/menu.js
node --check public/js/components/menu.js
node --check public/service-worker.js
node --check server/app.js
```

## Pruebas operativas
1. Crear producto con presentación y cargar imagen para una presentación.
2. Crear producto con presentación y dejar otra presentación sin imagen.
3. Confirmar que la presentación con imagen usa su imagen propia.
4. Confirmar que la presentación sin imagen usa la imagen base del producto.
5. Editar producto y cambiar la imagen de una presentación.
6. Confirmar que Cuentas sigue mostrando productos y presentaciones operativas.
