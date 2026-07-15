# v2.2.5M.7 fix1 · Footer visible y subnavegación móvil de Menú

## Estado

Fix preparado para prueba operativa.

## Contexto

Después de implementar `v2.2.5M.7 · Normalización visual final de Menú`, se detectaron regresiones graves en los modales administrativos del módulo Menú.

Los modales afectados eran:

- Nuevo Producto
- Nueva Categoría
- Nueva Subcategoría
- Nueva Presentación
- Nuevo Tipo/Grupo de Presentación
- Formularios de edición equivalentes del módulo Menú

## Problemas detectados

1. El footer de los modales podía quedar oculto.
2. Los formularios largos no ofrecían scroll vertical claro.
3. En móvil, los botones de acción del footer podían quedar fuera del área visible.
4. La subnavegación interna superior de Menú podía duplicar la navegación inferior móvil ya existente.

## Causa técnica

La modernización visual agregó estilos específicos para `.modal-menu` con `overflow: hidden`, pero no convirtió el modal en un layout vertical robusto.

El resultado era que el modal contenía:

- header
- body largo
- footer

pero el body no recibía correctamente el scroll interno y podía empujar el footer fuera del viewport.

## Corrección aplicada

Se ajusta `public/css/style.css` para que los modales de Menú funcionen como layout vertical:

- `.modal-content.modal-menu` usa `display: flex` y `flex-direction: column`.
- `.modal-header` y `.modal-footer` quedan como áreas fijas dentro del modal.
- `.modal-body` queda como área flexible con `overflow-y: auto`.
- En móvil se limita el alto con `100dvh`, se ajustan paddings y se asegura que los botones del footer sean visibles y táctiles.
- Las listas internas de presentaciones mantienen scroll propio cuando crecen.

## Subnavegación móvil

Se refuerza que los tabs internos superiores de Menú no se muestren en móvil mediante reglas específicas para:

```css
#menu-section .internal-tabs
#menu-section .menu-tabs-row.internal-tabs
```

Esto respeta la regla visual ya documentada en el README: en móvil/tablet la navegación interna del módulo debe resolverse con la barra inferior existente, no con botones superiores duplicados.

## Archivos modificados

- `README.md`
- `docs/avance-v2.2.5M.7-fix1-modales-menu.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `public/css/style.css`
- `public/index.html`
- `public/service-worker.js`

## Validación técnica sugerida

```powershell
node --check public/service-worker.js
node --check public/js/components/menu.js
node --check server/routes/menu.js
node --check server/app.js
```

## Prueba operativa sugerida

Como administrador en PC y móvil:

1. Abrir Menú.
2. Abrir `Nuevo Producto`.
3. Confirmar que el footer sea visible y que el body tenga scroll si el contenido excede el alto disponible.
4. Abrir `Nueva Categoría`.
5. Abrir `Nueva Subcategoría`.
6. Abrir `Nuevo Tipo/Grupo de Presentación`.
7. Abrir `Nueva Presentación`.
8. Confirmar que los botones Guardar/Cancelar siempre sean accesibles.
9. En móvil, confirmar que no aparezcan tabs superiores duplicando la barra inferior de Menú.

## Commit sugerido

```powershell
git commit -m "v2.2.5M.7 fix1: corrige modales y subnavegacion movil de Menu"
```
