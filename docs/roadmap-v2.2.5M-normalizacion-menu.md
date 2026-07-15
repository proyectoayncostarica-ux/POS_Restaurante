# Roadmap v2.2.5M · Normalización base del módulo Menú antes de Cuentas

## Estado

Este roadmap nace como fase previa a `v2.2.5 · Normalización y Estabilización del módulo Cuentas / Orders`.

Durante la auditoría del módulo Cuentas se confirmó que `orders.js` depende directamente de Menú para obtener productos, precios, presentaciones, imágenes, categorías, subcategorías y productos que requieren comanda. Por esa razón, antes de normalizar Cuentas, se debe estabilizar Menú como fuente confiable de datos operativos.

Documento relacionado:

- `docs/auditoria-v2.2.5-menu-base.md`
- `docs/roadmap-v2.2.5-normalizacion-cuentas.md`

---

## Objetivo general

Normalizar el módulo Menú para que sea una fuente de verdad clara, segura y estable para Cuentas.

Menú debe entregar a Cuentas información confiable sobre:

- productos
- categorías
- subcategorías
- imágenes
- precios base
- presentaciones
- precios por presentación
- productos de cocina
- estado activo/inactivo
- datos operativos listos para crear pedidos y agregar productos

---

## Regla de ejecución

Se mantiene la misma dinámica usada en `v2.2.4`:

1. Implementar una subfase.
2. Entregar ZIP con solo archivos modificados.
3. Probar visual y operativamente.
4. Si aparece un bug, marcarlo como fix:
   - `v2.2.5M.x fix1`
   - `v2.2.5M.x fix2`
5. Cuando la subfase esté validada:
   - commit seguro
   - push
6. Avanzar a la siguiente subfase.

No se debe avanzar a una subfase nueva si la anterior no fue validada correctamente.

---

## v2.2.5M.0 · Auditoría técnica del módulo Menú

### Estado

Realizada.

### Alcance

- Auditoría de `server/routes/menu.js`.
- Auditoría de `public/js/components/menu.js`.
- Revisión de dependencia Menú → Cuentas.
- Confirmación de que Menú debe estabilizarse antes de continuar con Orders.
- Creación de documento técnico:
  - `docs/auditoria-v2.2.5-menu-base.md`

### Criterio de cierre

- Documento adjunto al proyecto.
- README actualizado.
- Sin cambios funcionales.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.0: documenta auditoría técnica del módulo Menú"
```

---

## v2.2.5M.1 · Contrato operativo Menú → Cuentas

### Objetivo

Definir formalmente qué datos debe entregar Menú a Cuentas y cómo debe consumirlos `orders.js`.

### Debe documentar

- Qué es un producto operativo.
- Qué es un producto administrativo.
- Qué significa producto con presentación.
- Qué significa producto sin presentación.
- Dónde vive el precio real.
- Cómo se determina si un producto requiere comanda.
- Cómo debe consumir Orders los productos del Menú.
- Qué campos son obligatorios para crear un pedido.
- Qué campos son obligatorios para agregar productos.
- Qué datos nunca debe inventar Cuentas.

### Regla clave

Cuentas no debe adivinar precios, presentaciones, imágenes ni estado de cocina.

Cuentas debe consumir una respuesta normalizada desde Menú.

### Resultado esperado

- `docs/contrato-v2.2.5M.1-menu-cuentas.md`
- `README.md` actualizado

### Sin cambios todavía

- No cambia UI.
- No cambia base de datos.
- No cambia endpoints operativos.
- No cambia Cuentas.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.1: define contrato operativo Menu hacia Cuentas"
```

---

## v2.2.5M.2 · Normalización backend de productos operativos

### Objetivo

Crear una salida backend clara para productos que serán usados por Cuentas.

### Problema actual

Menú administra productos, categorías, subcategorías, imágenes y presentaciones, pero Cuentas necesita consumir esa información de forma más limpia y segura.

### Debe normalizar

- `producto_id`
- `nombre`
- `descripcion`
- `imagen_url`
- `categoria_id`
- `categoria_nombre`
- `subcategoria`
- `es_cocina`
- `tiene_presentaciones`
- `precio_base`
- `precio_operativo`
- `presentaciones`
- `precio_presentacion`
- `estado operativo del producto`

### Endpoints a revisar

- `GET /api/menu/products`
- `GET /api/menu/products/:id/presentaciones`

### Endpoint sugerido

```text
GET /api/menu/operational-products
```

Este endpoint debe entregar productos listos para operación, sin que Orders tenga que reconstruir estructura, precios o presentaciones.

### Criterio de éxito

- Producto sin presentación devuelve precio operativo correcto.
- Producto con presentación devuelve presentaciones válidas.
- Producto de cocina queda marcado correctamente.
- Orders puede consumir la respuesta sin lógica ambigua.
- No se rompen productos existentes.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.2: normaliza productos operativos de Menu"
```

---

## v2.2.5M.3 · Normalización de presentaciones y precios

### Objetivo

Dejar las presentaciones como fuente confiable de precio cuando apliquen.

### Problema actual

En productos con presentación, el precio real puede vivir en `presentaciones_producto.precio`, mientras `productos.precio` puede ser `0` o no representar el precio operativo real.

### Reglas

- Si el producto tiene presentación, el precio operativo sale de la presentación.
- Si el producto no tiene presentación, el precio operativo sale del producto.
- No permitir presentaciones sin precio válido.
- No permitir presentaciones duplicadas para el mismo producto.
- No permitir productos con presentación sin ninguna presentación activa/válida.
- Mantener compatibilidad con pedidos históricos.

### UI a revisar

- Crear presentación.
- Editar presentación.
- Vincular presentación a producto.
- Desvincular presentación de producto.
- Mostrar precios correctamente.
- Evitar estados ambiguos.

### Criterio de éxito

- Producto con una presentación calcula bien.
- Producto con varias presentaciones calcula bien.
- Producto sin presentación calcula bien.
- Cuentas no recibe precios ambiguos.
- No se afectan cuentas históricas.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.3: normaliza presentaciones y precios de productos"
```

---

## v2.2.5M.4 · Estado activo/inactivo de productos, categorías y presentaciones

### Objetivo

Permitir ocultar elementos del flujo operativo sin borrarlos.

### Motivación

En operación real, un producto puede dejar de estar disponible temporalmente. No debe eliminarse si ya fue usado en cuentas, pagos, reportes o historial.

### Debe agregar o normalizar

- `productos.activo`
- `categorias.activa`
- `subcategorias.activa`, si aplica como entidad real
- `presentaciones_producto.activa` o equivalente

### Reglas

- Producto inactivo no aparece en Cuentas.
- Categoría inactiva no aparece en Cuentas.
- Presentación inactiva no aparece en Cuentas.
- Admin puede ver/editar elementos inactivos desde Menú.
- No se rompen pedidos históricos.
- No se borran productos usados en pagos o reportes.

### Criterio de éxito

- Producto desactivado desaparece de Crear Pedido y Agregar Productos.
- Producto desactivado sigue existiendo en cuentas históricas.
- Presentación desactivada deja de estar disponible para nuevas cuentas.
- No se pierde información histórica.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.4: agrega estado activo a productos y presentaciones"
```

---

## v2.2.5M.5 · Protección backend administrativa del módulo Menú

### Objetivo

Asegurar que solo usuarios administradores puedan modificar Menú.

### Rutas a revisar

- `POST /api/menu/products`
- `PUT /api/menu/products/:id`
- `DELETE /api/menu/products/:id`
- `POST /api/menu/categories`
- `PUT /api/menu/categories/:id`
- `DELETE /api/menu/categories/:id`
- `POST /api/menu/presentaciones`
- `PUT /api/menu/presentaciones/:id`
- `DELETE /api/menu/presentaciones/:id`

### Regla

Usuario estándar puede consumir productos operativos si tiene acceso operativo, pero no puede crear, editar ni eliminar productos, categorías, subcategorías o presentaciones.

### Criterio de éxito

- Admin administra Menú.
- Básico/estándar no puede modificar Menú ni por UI ni por API.
- Menú sigue siendo consumible por Cuentas.
- No se bloquea el flujo operativo de pedidos.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.5: protege administracion backend de Menu"
```

---

## v2.2.5M.6 · Tipos/Grupos de presentación

### Objetivo

Agregar una capa nueva para agrupar presentaciones según categoría y subcategoría, evitando que el administrador vea una lista global plana al crear productos con presentación.

### Lógica esperada

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
```

### Ejemplo

```text
Categoría: Bebidas
Subcategoría: Gaseosas
Tipo/Grupo: Bebidas / Gaseosas
Presentaciones: 350 ml, 600 ml, 1000 ml, 2.5 litros, 3 litros
Producto: Coca Cola
```

### Criterio de éxito

- El admin puede crear tipos/grupos de presentación.
- Cada grupo pertenece a una categoría y opcionalmente a una subcategoría.
- El admin puede crear presentaciones dentro de un grupo.
- Al crear producto con presentación, primero se elige grupo.
- El modal de producto solo muestra las presentaciones del grupo seleccionado.
- Backend valida que el producto, grupo y presentaciones pertenezcan al mismo contexto.
- Cuentas / Orders no se migra todavía, pero conserva compatibilidad con `/menu/products/:id/presentaciones`.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.6: agrega tipos y grupos de presentacion"
```

---

## v2.2.5M.7 · Normalización visual final de Menú

### Estado

Implementada para prueba operativa.

### Objetivo

Modernizar y ordenar visualmente todos los modales y vistas administrativas de Menú después de tener cerrada la nueva lógica de tipos/grupos de presentación.

### Debe revisar

- Crear producto.
- Editar producto.
- Crear categoría.
- Editar categoría.
- Crear subcategoría.
- Crear tipo/grupo de presentación.
- Crear presentación dentro de grupo.
- Editar presentación.
- Productos con presentación.
- Productos sin presentación.
- Imagen de producto.
- Producto de cocina.
- Botones que llamen funciones inexistentes.
- Formularios que no recarguen datos correctamente.

### Criterio de éxito

- No hay botones que llamen funciones inexistentes.
- Modales abren correctamente.
- Formularios guardan y recargan.
- Menú no deja estados inconsistentes.
- La UI se ve coherente en PC y móvil.
- No se modifica todavía la lógica profunda de Cuentas.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.7: normaliza visualmente el modulo Menu"
```

### Fixes derivados

#### v2.2.5M.7 fix1 · Footer visible y subnavegación móvil de Menú

- Corrige modales de Menú con footer oculto y sin scroll vertical interno.
- Refuerza que en móvil no se dupliquen los tabs superiores cuando ya existe barra inferior de subnavegación.
- No cambia backend, base de datos ni contrato operativo Menú → Cuentas.

Commit sugerido:

```powershell
git commit -m "v2.2.5M.7 fix1: corrige modales y subnavegacion movil de Menu"
```

---

## v2.2.5M.8 · Integración Menú → Cuentas

### Objetivo

Con Menú ya normalizado, migrar Cuentas / Orders para consumir la fuente de verdad de Menú de forma limpia y operativa.

### Alcance aplicado

- `orders.js` carga productos/categorías desde `/api/menu/operational-products`.
- Orders deja de ejecutar `Menu.load()` desde el modal de pedidos para evitar datos administrativos o inactivos.
- Se reutiliza el selector visual por categorías/subcategorías tanto para nuevo pedido como para agregar productos a una cuenta existente.
- Los productos con presentación muestran solo presentaciones operativas asignadas al producto.
- Los precios visibles salen de `precio_operativo`, `precio_minimo` y `precio_maximo`.
- El payload enviado al backend ya no incluye precio calculado por frontend.
- `server/routes/orders.js` vuelve a resolver el precio desde SQLite y valida estados activos.
- Se soportan productos directos de categoría aunque existan subcategorías, mediante opción `Sin subcategoría`.
- Se mantiene cocina/comanda desde el producto validado.

### Imagen

La nueva regla de imagen por presentación queda pendiente para una subfase posterior. En esta fase se conserva la imagen del producto para no mezclar integración operativa con rediseño del modelo visual de imágenes.

### Criterio de éxito

- Orders consume productos activos desde Menú sin duplicar lógica administrativa.
- Productos inactivos o ligados a categorías/subcategorías inactivas no aparecen ni pasan validación backend.
- Productos con presentación exigen presentación válida.
- Precios salen desde `productos.precio` o `presentaciones_producto.precio`, no desde el frontend.
- Agregar productos a cuentas existentes soporta productos con presentación.
- Cocina/comanda sigue funcionando.
- No se rompen cuentas existentes.

### Archivos esperados

- `README.md`
- `docs/avance-v2.2.5M.8-integracion-menu-cuentas.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `server/routes/menu.js`
- `server/routes/orders.js`
- `public/js/components/orders.js`
- `public/index.html`
- `public/service-worker.js`

### Commit sugerido

```powershell
git commit -m "v2.2.5M.8: integra Menu normalizado con Cuentas"
```

---

## Resumen actualizado de subfases

```text
v2.2.5M.0  Auditoría técnica                 ✅
v2.2.5M.1  Contrato operativo Menú → Cuentas
v2.2.5M.2  Productos operativos backend
v2.2.5M.3  Presentaciones y precios
v2.2.5M.4  Estados activo/inactivo
v2.2.5M.5  Protección backend admin
v2.2.5M.6  Tipos/Grupos de presentación
v2.2.5M.7  Normalización visual final de Menú
v2.2.5M.7f1 Footer visible y subnavegación móvil
v2.2.5M.8  Integración Menú → Cuentas
v2.2.5M.9  Pruebas Menú → Cuentas
v2.2.5M.10 Cierre Menú base
```

---

## Regla de commits seguros

Antes de cada commit:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
git update-index --skip-worktree data/restaurant.db
git status --short
```

Agregar solo archivos esperados. Nunca usar:

```powershell
git add .
```

Filtro obligatorio:

```powershell
git diff --cached --name-only | Select-String -Pattern "data/restaurant.db|\.env$|certs/|\.pem$|\.key$|rootCA|mundipos-rootCA|node_modules|cookies.txt|data/backups"
```

Si el filtro imprime algo, detenerse y corregir staging.

---

## Criterio final de éxito

La fase `v2.2.5M` se considera cerrada cuando Menú sea una fuente confiable y estable para Cuentas:

- productos activos/inactivos claros
- presentaciones activas/inactivas claras
- precios confiables
- imágenes confiables
- cocina/comanda correctamente marcada
- endpoint operativo único para Orders
- UI administrativa sin funciones rotas
- backend protegido para administración
- pruebas Menú → Cuentas documentadas y aprobadas

Después de esto, se retoma la línea principal:

```text
v2.2.5 · Normalización y Estabilización del módulo Cuentas / Orders
```

#### v2.2.5M.7 fix2 · Resumen móvil compacto y columna de subcategorías

Objetivo del fix:
- compactar el resumen superior de Menú en móvil;
- convertir cada card en acceso a mini modal informativo;
- mover `+ Sub` a la columna `Subcategorías` en `Categorías Principales`;
- dejar `Acciones` solo para `Editar` y `Ocultar/Visualizar`.

Archivos esperados:
- `README.md`
- `docs/avance-v2.2.5M.7-fix2-summary-mobile.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `public/js/components/menu.js`
- `public/css/style.css`
- `public/index.html`
- `public/service-worker.js`

Commit sugerido:

```powershell
git commit -m "v2.2.5M.7 fix2: compacta resumen movil y reordena subcategorias"
```


## v2.2.5M.9 · Pruebas Menú → Cuentas

### Objetivo

Validar mediante una matriz de pruebas que Cuentas/Orders consume correctamente el contrato operativo de Menú implementado en `v2.2.5M.8`.

Esta fase no debe introducir nueva lógica funcional; su función es confirmar estabilidad, documentar resultados y dejar listo el camino para `v2.2.5M.10 · Cierre Menú base`.

### Matriz mínima obligatoria

- producto sin presentación;
- producto con presentación;
- presentaciones filtradas por producto;
- producto directo sin subcategoría;
- producto con subcategoría;
- producto de cocina y comanda;
- agregar producto a cuenta existente;
- agregar producto con presentación a cuenta existente;
- producto inactivo;
- categoría inactiva;
- subcategoría inactiva;
- presentación inactiva;
- relación producto-presentación inactiva;
- precio operativo inválido;
- usuario estándar operando;
- usuario administrador administrando.

### Archivos esperados

- `README.md`
- `docs/avance-v2.2.5M.9-pruebas-menu-cuentas.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`

### Validación técnica

```powershell
node --check server/routes/menu.js
node --check server/routes/orders.js
node --check public/js/components/orders.js
node --check public/js/components/menu.js
node --check public/service-worker.js
node --check server/app.js
```

### Commit sugerido

```powershell
git commit -m "v2.2.5M.9: documenta pruebas Menu Cuentas"
```

#### v2.2.5M.9 fix1 · Pulido visual global y Menú premium

Objetivo del fix:
- actualizar botones globales de footer al estilo visual de Dashboard/Zonas;
- eliminar el botón `Actualizar` del módulo Menú;
- modernizar botones principales de Menú;
- modernizar estados, acciones y tablas del módulo Menú;
- diferenciar correctamente PC y móvil sin duplicar navegación superior en móvil.

Archivos esperados:
- `README.md`
- `docs/avance-v2.2.5M.9-fix1-pulido-visual-menu.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `public/js/components/menu.js`
- `public/css/style.css`
- `public/index.html`
- `public/service-worker.js`

Commit sugerido:

```powershell
git commit -m "v2.2.5M.9 fix1: pule visualmente Menu y botones globales"
```
