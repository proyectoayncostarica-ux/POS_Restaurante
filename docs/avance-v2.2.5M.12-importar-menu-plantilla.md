# v2.2.5M.12 · Importar Menú desde Plantilla

## Objetivo
Agregar la importación real del Menú desde la plantilla Excel oficial generada en `v2.2.5M.11`, manteniendo una validación previa estricta y una importación transaccional segura.

## Alcance
Esta subfase implementa:

- botón administrativo `Importar plantilla` dentro del módulo Menú;
- lectura de archivo `.xlsx` en frontend;
- endpoint backend de validación previa;
- endpoint backend de importación confirmada;
- validación de plantilla oficial mediante `_METADATA`;
- validación de hojas y columnas requeridas;
- creación o actualización de categorías, subcategorías, tipos/grupos, presentaciones, productos y precios por presentación;
- importación en transacción SQLite;
- registro en historial de transacciones.

## Endpoints agregados

```text
POST /api/menu/template/validate
POST /api/menu/template/import
```

Ambos endpoints están protegidos con `requireMenuAdmin`.

## Formato aceptado
Solo se acepta `.xlsx` con estructura oficial:

```text
_METADATA
README
01_Categorias
02_Subcategorias
03_TiposPresentacion
04_Presentaciones
05_Productos
06_ProductoPresentaciones
07_Validacion
```

La hoja `_METADATA` debe incluir:

```text
template_id = MUNDIPOS_MENU_TEMPLATE
schema = menu-template-v1
module = menu_import
```

## Reglas de importación

La importación no elimina datos existentes. Opera bajo la regla:

```text
crear si no existe
actualizar si existe por coincidencia segura
nunca borrar elementos existentes
```

La coincidencia se realiza por nombres y contexto:

- categoría principal por nombre y `parent_id IS NULL`;
- subcategoría por nombre + categoría padre;
- tipo/grupo por nombre + categoría + subcategoría opcional;
- presentación por nombre + tipo/grupo;
- producto por nombre;
- relación producto-presentación por producto + presentación.

## Validaciones

La validación previa revisa:

- archivo `.xlsx` válido;
- estructura ZIP/XLSX legible;
- hojas requeridas;
- columnas requeridas;
- metadata oficial;
- claves internas duplicadas;
- relaciones categoría/subcategoría;
- relaciones tipo/grupo/presentación;
- productos con presentación y `clave_tipo`;
- precios por presentación mayores a cero.

Si existen errores críticos, el backend no permite importar.

## Seguridad y permisos

- Solo administradores ven el botón `Importar plantilla`.
- Los endpoints rechazan usuarios no administradores.
- La importación se ejecuta dentro de una transacción `BEGIN/COMMIT`.
- Si ocurre un error durante la importación, se ejecuta `ROLLBACK`.

## No incluido todavía

- Importación masiva de imágenes.
- ZIP de imágenes.
- Imagen por presentación/producto.

Eso queda pendiente para:

```text
v2.2.5M.13 · Imágenes por presentación y producto
```

## Archivos modificados

- `README.md`
- `docs/avance-v2.2.5M.12-importar-menu-plantilla.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `docs/roadmap-v2.2.5M11-13-plantillas-menu.md`
- `server/routes/menu.js`
- `public/js/components/menu.js`
- `public/css/style.css`
- `public/index.html`
- `public/service-worker.js`

## Pruebas recomendadas

Como administrador:

1. Abrir Menú.
2. Descargar una plantilla desde `Plantilla asistida`.
3. Abrir `Importar plantilla`.
4. Seleccionar el `.xlsx`.
5. Validar plantilla.
6. Confirmar que se muestra resumen de categorías, productos, tipos, presentaciones y relaciones.
7. Importar.
8. Confirmar que Menú se recarga y muestra los elementos importados.
9. Repetir la importación y confirmar que actualiza sin duplicar.

Como usuario estándar:

1. Abrir Menú.
2. Confirmar que no aparece `Importar plantilla`.
3. Confirmar que los endpoints rechazan cambios administrativos.
