# v2.2.5M.10 · Cierre Menú base

## Objetivo
Cerrar la fase `v2.2.5M` dejando el módulo Menú como una base mantenible, verificable y preparada para futuras extensiones antes de retomar la normalización principal de Cuentas/Orders.

Este cierre no introduce nuevas funciones de negocio. Su propósito es reducir deuda técnica generada durante las subfases de normalización, especialmente por la acumulación de fixes visuales y funcionales sobre `public/js/components/menu.js`.

## Revisión realizada

### 1. Funciones duplicadas
Se detectó que `menu.js` conservaba bloques legacy de renderizado que habían sido reemplazados por la vista moderna de Menú. Aunque JavaScript terminaba usando la última definición dentro del objeto, mantener ambas versiones hacía más difícil auditar y corregir el módulo.

Se eliminaron duplicados de:

- `render()`
- `renderProductsView()`
- `renderProductsTable()`
- `renderCategoriesView()`
- `renderPresentationsView()`
- `searchProducts()`
- `showPresentacionesModal()`

### 2. Funciones legacy / huérfanas
Se retiraron funciones frontend que ya no pertenecían al flujo vigente:

- eliminación visual legacy de productos, categorías y presentaciones;
- validación de cocina en edición no usada por el formulario vigente;
- flujo separado de `agregar más presentaciones`, porque la edición actual ya carga las presentaciones válidas del grupo con checkboxes;
- helpers de presentaciones que no tenían llamadas vigentes o duplicaban responsabilidades.

La regla vigente queda clara: el módulo Menú usa activar/desactivar como operación segura y conserva la administración de presentaciones por tipo/grupo.

### 3. Estructura del componente Menú
El archivo queda con responsabilidades más claras:

- permisos y helpers base;
- carga de datos;
- creación/edición de productos;
- creación/edición de categorías y subcategorías;
- creación/edición de tipos/grupos y presentaciones;
- manejo de presentaciones por producto;
- helpers visuales;
- render moderno único de Menú.

### 4. Contrato Menú → Cuentas
No se cambia el contrato implementado en `v2.2.5M.8`.

Cuentas sigue consumiendo:

- `/api/menu/operational-products`
- `/api/menu/products/:id/presentaciones` como apoyo para presentaciones del producto

El backend de Cuentas sigue resolviendo precios reales y validando estados activos.

## Validaciones realizadas

```powershell
node --check public/js/components/menu.js
node --check public/js/components/orders.js
node --check public/js/main.js
node --check public/service-worker.js
node --check server/routes/menu.js
node --check server/routes/orders.js
node --check server/app.js
node --check server/db/database.js
```

También se revisaron referencias internas `Menu.*` y `this.*` en `menu.js` para confirmar que no quedaran métodos duplicados ni llamadas a funciones inexistentes.

## Resultado

`v2.2.5M` queda lista para cierre funcional/documental con Menú como fuente confiable de:

- productos activos/inactivos;
- categorías y subcategorías activas/inactivas;
- tipos/grupos de presentación;
- presentaciones filtradas por grupo;
- precios base y precios por presentación;
- marca de cocina/comanda;
- consumo operativo desde Cuentas/Orders.

## Pendientes posteriores fuera de este cierre

Quedan fuera de esta subfase porque corresponden a una evolución posterior del modelo visual:

- imagen por presentación cuando un producto tenga presentaciones activas;
- refinamiento futuro del modelo de imágenes producto/presentación;
- nuevas mejoras visuales no críticas fuera del cierre base.

## Archivos modificados

- `README.md`
- `docs/avance-v2.2.5M.10-cierre-menu-base.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `public/js/components/menu.js`
- `public/index.html`
- `public/service-worker.js`
