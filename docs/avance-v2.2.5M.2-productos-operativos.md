# v2.2.5M.2 · Normalización backend de productos operativos

## Objetivo

Crear una salida backend clara y estable para que el módulo Cuentas / Orders pueda consumir productos del Menú sin adivinar precios, presentaciones, imágenes, categorías o estado de cocina.

Esta subfase no migra todavía Cuentas al nuevo contrato. Solo prepara a Menú como fuente confiable.

## Endpoint agregado

```text
GET /api/menu/operational-products
```

## Respuesta normalizada

El endpoint devuelve:

```text
success
data
categorias
productos
resumen
version_contrato
```

Cada producto operativo incluye, entre otros campos:

```text
id
producto_id
nombre
descripcion
imagen
imagen_url
categoria_id
categoria_nombre
subcategoria_id
subcategoria_nombre
categoria_operativa
es_cocina
requiere_comanda
tiene_presentaciones
precio_base
precio_operativo
precio_minimo
precio_maximo
origen_precio
presentaciones
disponible_operacion
bloqueos_operativos
```

## Reglas de precio

- Producto sin presentaciones válidas: usa `productos.precio` como `precio_operativo`.
- Producto con presentaciones válidas: el precio operativo vive en cada presentación.
- Producto con precio cero o inválido no se considera operativo por defecto.
- Presentaciones con precio cero o inválido no se exponen como operativas.

## Reglas de cocina

- `es_cocina = 1` se normaliza también como `requiere_comanda = 1`.
- Cuentas podrá usar este campo para determinar si el producto genera comanda.

## Parámetros opcionales

```text
?include_invalid=1
```

Incluye productos no operativos con sus bloqueos en `bloqueos_operativos`.

```text
?include_empty_categories=1
```

Incluye categorías sin productos operativos.

## Alcance

- No cambia UI.
- No cambia Orders todavía.
- No cambia base de datos.
- No cambia la administración visual de Menú.
- No cambia el flujo actual de creación/agregado de pedidos.

## Criterio de éxito

- `node --check server/routes/menu.js` pasa correctamente.
- El endpoint devuelve productos con precio operativo normalizado.
- Los productos con presentaciones devuelven presentaciones con precio válido.
- Los productos de cocina quedan marcados como `requiere_comanda`.
- Cuentas puede migrarse posteriormente a este endpoint sin rearmar productos por su cuenta.
