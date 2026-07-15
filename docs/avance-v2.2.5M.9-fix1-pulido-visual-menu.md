# v2.2.5M.9 fix1 · Pulido visual global y Menú premium

## Objetivo
Antes de cerrar la subfase `v2.2.5M.9 · Pruebas Menú → Cuentas`, se corrigen inconsistencias visuales detectadas en el módulo Menú y en botones globales de footer para mantener uniformidad con la línea visual ya aplicada en Dashboard y Zonas.

## Problemas detectados
1. Los botones de footer de modales seguían usando una apariencia antigua en varias pantallas.
2. En Menú existía un botón `Actualizar` que no aportaba una función real al flujo administrativo.
3. Los botones `Nuevo Producto`, `Nueva Categoría`, `Nuevo Tipo/Grupo` y `Nueva Presentación` conservaban una apariencia visual anterior.
4. Los botones y estados dentro de tablas de Menú no estaban alineados con el estilo premium de la app.
5. El módulo Menú necesitaba una capa visual más profesional diferenciando comportamiento PC y móvil.

## Correcciones aplicadas

### 1. Botones globales de footer
Se actualizó el estilo global de `.modal-footer .btn` para que todos los modales de la app usen botones más modernos:

- radios más amplios;
- sombras suaves;
- gradientes por acción;
- mejor altura táctil;
- layout horizontal en PC;
- layout apilado y cómodo en móvil.

Este ajuste es global y beneficia a Menú, Dashboard, Zonas, Cuentas y demás modales que usen `Utils.showModal()`.

### 2. Eliminación del botón Actualizar en Menú
Se retiró el botón `Actualizar` de la barra de acciones del módulo Menú.

No se elimina `Menu.load()` porque sigue siendo la función base necesaria para cargar y refrescar datos cuando el módulo se abre o cuando una acción administrativa termina.

### 3. Botones principales de Menú
Se modernizan los botones administrativos de la parte superior:

- `Nuevo Producto`
- `Nueva Categoría`
- `Nuevo Tipo/Grupo`
- `Nueva Presentación`

Ahora usan estilo más cercano a una app profesional: píldoras, gradientes, sombra y mejor jerarquía visual.

### 4. Tablas, estados y acciones
Se modernizan los elementos internos del módulo Menú:

- badges de estado `Activo/Inactivo`;
- botones de editar;
- botones de ocultar/visualizar;
- botones de presentación;
- tabla de productos;
- tabla de categorías;
- tabla de tipos/grupos y presentaciones.

### 5. Diferencia PC / móvil
En PC:

- botones de footer mantienen distribución horizontal;
- tabs internos de Menú conservan formato premium;
- tablas mantienen lectura amplia.

En móvil:

- botones de footer se apilan para mejorar el toque;
- acciones principales ocupan ancho completo;
- tablas conservan scroll horizontal cuando corresponde;
- se respeta la navegación inferior móvil ya existente.

## Alcance
Este fix es visual y de limpieza UX.

No modifica:

- backend;
- base de datos;
- permisos;
- rutas API;
- lógica de Cuentas/Orders;
- contrato operativo Menú → Cuentas.

## Archivos modificados
- `README.md`
- `docs/avance-v2.2.5M.9-fix1-pulido-visual-menu.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `public/js/components/menu.js`
- `public/css/style.css`
- `public/index.html`
- `public/service-worker.js`

## Validación recomendada

```powershell
node --check public/js/components/menu.js
node --check public/js/components/orders.js
node --check public/service-worker.js
node --check server/routes/menu.js
node --check server/routes/orders.js
node --check server/app.js
```

## Pruebas visuales recomendadas

### PC
- Abrir Menú > Productos.
- Verificar botones principales modernos.
- Verificar tablas, estados y acciones.
- Abrir modales y confirmar footer moderno.
- Revisar Dashboard/Zonas para confirmar que los botones de footer globales se ven coherentes.

### Móvil
- Abrir Menú.
- Confirmar que no aparece navegación superior duplicada.
- Confirmar acciones principales de ancho completo.
- Abrir modales y verificar botones del footer apilados y táctiles.
- Revisar que la barra inferior móvil no quede tapada por contenido.
