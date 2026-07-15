# v2.2.5M.7 · Normalización visual final de Menú

## Estado

Implementada para prueba operativa.

Esta subfase se ejecuta después de `v2.2.5M.6 · Tipos/Grupos de presentación` y antes de integrar Menú con Cuentas.

## Objetivo

Dejar el módulo Menú visualmente coherente y administrativamente completo sin cambiar todavía la lógica profunda de Cuentas / Orders.

M.7 no introduce nuevas tablas ni cambia el contrato backend funcional de M.6. Su alcance es UI administrativa, experiencia de uso, corrección de acciones incompletas y versionado de caché.

## Cambios principales

### Vista general de Menú

- Se agrega resumen visual con conteos de productos, categorías, subcategorías, tipos/grupos, presentaciones, productos de cocina, productos con presentación e inactivos.
- Se reorganiza la barra de acciones y navegación interna de Menú.
- Se mejora el modo consulta para usuarios no administradores.

### Productos

- La tabla de productos ahora muestra miniatura del producto con fallback a `ImagenGenerica.jpg`.
- Se agrupa nombre y descripción del producto en una celda más legible.
- Se agrega columna de grupo de presentación para productos que usan la lógica de M.6.
- Se mantiene el botón de ver presentaciones para productos con presentación.
- Las acciones administrativas quedan agrupadas visualmente.

### Categorías y subcategorías

- Se normaliza la vista de categorías principales y subcategorías.
- Se agregan estados vacíos claros.
- Se completa la edición visual de categorías y subcategorías mediante `Menu.showEditCategoryModal` y `Menu.updateCategory`.
- Se mantienen activar/desactivar como acciones separadas.

### Tipos/Grupos y presentaciones

- Se separa visualmente la tabla de tipos/grupos y la tabla de presentaciones.
- Se agrega edición UI para tipos/grupos de presentación usando el endpoint backend existente.
- Se agrega edición UI para presentaciones globales usando el endpoint backend existente.
- Se mantiene activar/desactivar como acción independiente.

### Modales

- Se aplica estilo moderno específico al módulo Menú (`modal-menu`).
- Se mejoran formularios, campos, checks, listas de presentaciones y pie de modal.
- Se moderniza el modal de detalle de presentaciones por producto.

### PWA / caché

- `public/index.html` y `public/service-worker.js` avanzan a `v2.2.5M.7-menu-visual-final` para evitar mezcla de assets anteriores.

## Alcance deliberadamente excluido

No se modifica todavía:

- `orders.js`
- `server/routes/orders.js`
- reglas de creación de cuentas
- integración final Menú → Cuentas
- lógica de imágenes por presentación

La regla futura de imágenes por presentación queda pendiente para M.8 o una subfase específica antes de Cuentas, según se detalle el alcance.

## Archivos modificados

- `README.md`
- `docs/avance-v2.2.5M.7-normalizacion-visual-menu.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `public/js/components/menu.js`
- `public/css/style.css`
- `public/index.html`
- `public/service-worker.js`

## Validaciones sugeridas

```powershell
node --check public/js/components/menu.js
node --check public/service-worker.js
node --check server/db/database.js
node --check server/routes/menu.js
node --check server/routes/orders.js
node --check public/js/components/orders.js
node --check server/app.js
```

## Prueba operativa sugerida

### Administrador

1. Entrar a Menú.
2. Confirmar resumen visual y navegación.
3. Confirmar miniaturas en productos.
4. Crear y editar categoría.
5. Crear y editar subcategoría.
6. Crear y editar tipo/grupo de presentación.
7. Crear y editar presentación dentro de grupo.
8. Crear producto con presentación y confirmar que respeta grupo.
9. Editar producto y confirmar que conserva presentaciones asignadas.
10. Activar/desactivar productos, categorías, tipos/grupos y presentaciones.

### Usuario estándar/básico

1. Entrar a Menú.
2. Confirmar modo consulta.
3. Confirmar que no aparecen acciones administrativas.
4. Confirmar que Cuentas sigue cargando productos activos.

## Commit sugerido

```powershell
git commit -m "v2.2.5M.7: normaliza visualmente el modulo Menu"
```
