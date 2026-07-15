# v2.2.5M.3 · Normalización de presentaciones y precios

## Objetivo

Estabilizar el contrato de precios de Menú para que Cuentas / Orders no tenga que adivinar si el precio real de un producto vive en `productos.precio` o en `presentaciones_producto.precio`.

Esta subfase mantiene a Menú como fuente de verdad de productos, presentaciones y precios antes de continuar con la normalización profunda de Cuentas.

## Reglas operativas definidas

- Producto sin presentación:
  - el precio operativo sale de `productos.precio`.
  - el precio debe ser mayor a cero.

- Producto con presentación:
  - el precio operativo sale exclusivamente de `presentaciones_producto.precio`.
  - `productos.precio` queda en `0` para evitar ambigüedad.
  - debe existir al menos una presentación activa, vinculada y con precio mayor a cero.

- Presentación inválida:
  - global inactiva,
  - vínculo inactivo para el producto,
  - precio menor o igual a cero,
  - duplicada dentro del mismo producto,
  - inexistente.

- Producto con presentaciones configuradas pero sin ninguna presentación operativa válida:
  - no se considera disponible para operación.
  - aparece en diagnóstico usando `GET /api/menu/operational-products?include_invalid=1`.

## Cambios backend aplicados

Archivo modificado:

- `server/routes/menu.js`

### Helper de normalización de presentaciones

Se centralizó la normalización de presentaciones para operación.

Cada presentación devuelve ahora información más clara:

- `precio`
- `precio_operativo`
- `precio_configurado`
- `relacion_activa`
- `presentacion_activa`
- `disponible_operacion`
- `bloqueos_operativos`

### Validación de presentaciones al crear producto

Al crear producto con presentaciones, el backend valida:

- al menos una presentación,
- presentación existente,
- presentación global activa,
- precio mayor a cero,
- sin duplicados.

### Validación de presentaciones al editar producto

Al editar producto con presentaciones, el backend aplica las mismas reglas que al crear.

Además, si un producto pasa a manejarse sin presentaciones, se desactivan sus vínculos previos en `presentaciones_producto` para evitar residuos operativos.

### Upsert seguro de presentaciones

Se agregó lógica común para:

- crear vínculo producto-presentación,
- reactivar vínculo existente,
- actualizar precio,
- desactivar presentaciones que ya no deben estar activas para ese producto.

### Endpoint operativo actualizado

`GET /api/menu/operational-products` ahora usa contrato:

```text
version_contrato: v2.2.5M.3
```

El endpoint ahora distingue entre:

- `tiene_presentaciones`
- `tiene_presentaciones_configuradas`
- `total_presentaciones`
- `total_presentaciones_configuradas`
- `presentaciones`
- `presentaciones_diagnostico` cuando se usa `include_invalid=1`

## Alcance

Esta subfase no cambia:

- UI de Menú.
- UI de Cuentas.
- `orders.js`.
- base de datos.
- flujo actual de crear/agregar pedidos.

## Validación técnica

Comando ejecutado:

```powershell
node --check server/routes/menu.js
```

## Criterio de aceptación operativo

La subfase se considera válida si:

1. Se puede crear producto sin presentación con precio mayor a cero.
2. Se puede crear producto con una presentación y precio mayor a cero.
3. Se puede crear producto con varias presentaciones válidas.
4. No permite producto con presentación sin precio válido.
5. No permite presentación duplicada dentro del mismo producto.
6. No permite presentación inexistente o inactiva.
7. `GET /api/menu/operational-products` sigue respondiendo correctamente.
8. Los productos inválidos aparecen en diagnóstico con `include_invalid=1`.

## Siguiente paso

Continuar con:

```text
v2.2.5M.4 · Estado activo/inactivo de productos, categorías y presentaciones
```
