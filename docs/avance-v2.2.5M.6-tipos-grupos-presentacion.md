# v2.2.5M.6 · Tipos/Grupos de presentación

## Contexto

Presentaciones nació para evitar duplicar productos cuando un mismo producto se vende en distintas medidas o variantes. Ejemplos: Imperial 350 ml / 750 ml / 1000 ml, licores por shot / doble / cuarta / botella, gaseosas por tamaño, bebidas calientes por tamaño y comidas por variante.

El problema detectado era que la administración de Menú manejaba las presentaciones como una lista global plana. Al crear un producto con presentación, el administrador veía presentaciones que no pertenecían al contexto del producto.

## Decisión técnica

Se agrega una nueva capa llamada `tipos_presentacion` o tipo/grupo de presentación.

La relación queda así:

```text
Categoría
  ↓
Subcategoría opcional
  ↓
Tipo/Grupo de presentación
  ↓
Presentaciones del grupo
  ↓
Producto con presentación
  ↓
Presentaciones seleccionadas para ese producto con precio propio
```

## Flujo administrativo esperado

Ejemplo para gaseosas:

```text
Categoría: Bebidas
Subcategoría: Gaseosas
Tipo/Grupo: Bebidas / Gaseosas
Presentaciones: 350 ml, 600 ml, 1000 ml, 2.5 litros, 3 litros
Producto: Coca Cola
```

Al crear Coca Cola como producto con presentación:

1. El administrador activa “¿Tiene presentaciones?”.
2. Selecciona el tipo/grupo “Bebidas / Gaseosas”.
3. El sistema muestra solo las presentaciones de ese grupo.
4. El administrador marca las presentaciones aplicables y define precio por presentación.

## Cambios backend

### Base de datos

Se agrega tabla:

```text
tipos_presentacion
```

Campos principales:

```text
id
nombre
descripcion
categoria_id
subcategoria_id
activo
creado_en
actualizado_en
```

Se agregan columnas compatibles:

```text
productos.tipo_presentacion_id
presentaciones.tipo_presentacion_id
```

También se reconstruye la tabla `presentaciones` para eliminar la restricción global única sobre `nombre` y permitir que nombres como “Grande”, “Pequeño” o “Botella” existan en grupos distintos.

### Endpoints nuevos

```text
GET    /api/menu/presentation-types
POST   /api/menu/presentation-types
PUT    /api/menu/presentation-types/:id
PUT    /api/menu/presentation-types/:id/active
DELETE /api/menu/presentation-types/:id
```

Todos los endpoints mutantes quedan protegidos por `requireMenuAdmin`.

### Presentaciones globales

`GET /api/menu/presentaciones-globales` ahora puede filtrar por:

```text
?tipo_presentacion_id=<id>
```

Crear o editar una presentación exige `tipo_presentacion_id`.

### Productos

Crear o editar un producto con presentación exige:

```text
tipo_presentacion_id
presentaciones_seleccionadas / presentaciones
```

El backend valida que:

- el grupo exista;
- el grupo esté activo;
- el grupo pertenezca a la categoría del producto;
- si el grupo está ligado a subcategoría, coincida con la subcategoría del producto;
- todas las presentaciones seleccionadas pertenezcan al grupo;
- cada presentación tenga precio mayor a cero.

## Cambios frontend

En Menú administrativo:

- la pestaña Presentaciones ahora muestra tipos/grupos y presentaciones por grupo;
- se agrega modal para crear tipo/grupo de presentación;
- se actualiza el modal de nueva presentación para exigir grupo;
- en el modal Nuevo Producto, si se activa “¿Tiene presentaciones?”, primero se elige grupo;
- los checkboxes de presentación se cargan filtrados por grupo;
- usuarios no administradores mantienen Menú en modo consulta.

## Compatibilidad con Cuentas / Orders

No se migra Cuentas todavía.

`GET /api/menu/products/:id/presentaciones` sigue disponible para el modal operativo actual. Para productos nuevos con grupo asignado, el endpoint devuelve las presentaciones del grupo con estado `asignada`, conservando el consumo actual de Orders.

## Fuera de alcance

Queda pendiente para próximas subfases:

- modernización visual completa de modales de Menú (`v2.2.5M.7`);
- carga de imagen desde presentación cuando el producto tiene presentación activa;
- integración limpia Menú → Cuentas (`v2.2.5M.8`);
- revisión final del contrato operativo de imágenes/precios/presentaciones en Orders.

## Archivos modificados

```text
README.md
docs/avance-v2.2.5M.6-tipos-grupos-presentacion.md
server/db/database.js
server/routes/menu.js
public/js/components/menu.js
public/index.html
public/service-worker.js
```
