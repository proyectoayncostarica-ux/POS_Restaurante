# v2.2.5M.7 fix2 · Resumen móvil compacto y columna de subcategorías

## Objetivo
Corregir la ergonomía visual del módulo Menú en móvil, reduciendo el espacio muerto del resumen superior y reorganizando la tabla de categorías principales para que el botón de crear subcategoría viva junto al contador de subcategorías.

## Problema detectado
- Las cards superiores de `Productos`, `Estructura`, `Tipos/Grupos` e `Inactivos` ocupaban demasiado alto en móvil.
- El contenido resumido era útil en escritorio, pero en móvil consumía espacio que debía priorizar el flujo operativo.
- En `Categorías Principales`, la columna `Acciones` cargaba tres tareas a la vez: crear subcategoría, editar y ocultar/visualizar.

## Ajuste aplicado
### 1) Resumen móvil compacto
- El resumen superior se mantiene como cards informativas en escritorio.
- En móvil pasa a una **fila horizontal desplazable** con cards más pequeñas.
- Cada card queda **cliqueable** y abre un mini modal de detalle:
  - **Productos:** total, con presentación y de cocina.
  - **Estructura:** categorías principales y subcategorías.
  - **Tipos/Grupos:** total de grupos y presentaciones.
  - **Inactivos:** desglose por productos, categorías, grupos y presentaciones.

### 2) Categorías principales más claras
- La columna `Subcategorías` ahora muestra el número y el botón `+ Sub` alineados horizontalmente.
- La columna `Acciones` se simplifica a:
  - `Editar`
  - `Ocultar/Visualizar`

## Alcance
- Solo ajusta interfaz del módulo Menú.
- No cambia backend ni la lógica operativa de Orders/Cuentas.
- No modifica permisos ni rutas de administración.

## Cache / PWA
- `public/index.html` actualiza el versionado de assets a `v2.2.5M.7-fix2-summary-mobile`.
- `public/service-worker.js` actualiza `MUNDIPOS_SW_VERSION` al mismo valor.

## Archivos modificados
- `README.md`
- `docs/avance-v2.2.5M.7-fix2-summary-mobile.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `public/js/components/menu.js`
- `public/css/style.css`
- `public/index.html`
- `public/service-worker.js`
