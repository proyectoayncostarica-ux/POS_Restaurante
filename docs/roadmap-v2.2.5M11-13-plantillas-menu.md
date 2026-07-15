# Roadmap v2.2.5M.11–13 · Plantillas, importación e imágenes de Menú

## Estado

Este roadmap extiende la fase `v2.2.5M` antes de volver a la línea principal de `Cuentas / Orders`.

Después del cierre técnico de `v2.2.5M.10 · Cierre Menú base`, se identifica una necesidad operativa válida: facilitar la primera carga completa del menú del local sin obligar al administrador a crear manualmente cada categoría, subcategoría, producto, tipo/grupo de presentación, presentación y precio.

La extensión mantiene la misma regla arquitectónica de la fase Menú: **Menú debe quedar como fuente confiable de verdad antes de continuar la normalización profunda de Cuentas**.

---

## Objetivo general

Crear una herramienta segura, guiada y verificable para construir e importar el menú inicial de un restaurante/bar usando una plantilla Excel oficial de MundiPOS.

El proceso debe cubrir:

- creación ordenada de categorías;
- creación ordenada de subcategorías;
- productos sin presentación;
- productos con presentación;
- tipos/grupos de presentación;
- presentaciones por grupo;
- precios base y precios por presentación;
- productos de cocina;
- validación de relaciones antes de importar;
- compatibilidad con Menú y Cuentas ya normalizados.

---

## Principio de diseño

La plantilla no debe ser un Excel vacío y difícil de llenar. Debe nacer desde un flujo asistido que replique el orden lógico de creación dentro de la app.

Orden de creación esperado:

```text
1. Categorías
2. Subcategorías
3. Productos
4. Tipos/Grupos de presentación, si aplica
5. Presentaciones por grupo
6. Precios de productos o precios por presentación
7. Revisión final
8. Generación de plantilla Excel oficial
9. Importación validada desde plantilla
```

La experiencia debe ayudar al administrador con:

- ayudas contextuales;
- ejemplos de restaurante/bar;
- sugerencias de estructura;
- productos demo opcionales;
- validaciones antes de guardar;
- advertencias cuando falten relaciones;
- guardado de avance;
- generación final de archivo `.xlsx` compatible con el importador.

---

## Reglas de seguridad

- Solo usuarios administradores pueden generar o importar plantillas.
- La importación no debe borrar datos existentes.
- La importación debe ejecutarse en transacción.
- El sistema debe validar la plantilla antes de permitir confirmar la importación.
- El archivo debe incluir metadata verificable para confirmar que es una plantilla oficial de MundiPOS.
- Cualquier error crítico debe bloquear la importación.
- Las advertencias no críticas deben mostrarse en una vista previa antes de confirmar.

---

## Formato base de plantilla Excel

La plantilla oficial debe usar hojas separadas para facilitar validación y mantenimiento.

Hojas mínimas previstas:

```text
_METADATA
README
01_Categorias
02_Subcategorias
03_TiposPresentacion
04_Presentaciones
05_Productos
06_ProductoPresentaciones
```

La hoja `_METADATA` debe incluir al menos:

```text
app = MundiPOS
module = menu_import
template_version = v2.2.5M.11
schema = menu_template_v1
```

La existencia y valores de esa metadata serán usados por el importador para rechazar archivos no compatibles.

---

## v2.2.5M.11 · Generador asistido de Plantilla Excel de Menú

### Objetivo

Crear dentro del módulo Menú una herramienta administrativa para construir una plantilla Excel oficial a partir de formularios guiados.

### Alcance funcional

- Botón administrativo en Menú: `Crear plantilla asistida`.
- Flujo tipo wizard o pantalla guiada.
- Formulario para categorías.
- Formulario para subcategorías dependientes de categoría.
- Formulario para productos.
- Soporte para producto sin presentación con precio base.
- Soporte para producto con presentación.
- Creación o selección de tipo/grupo de presentación.
- Creación de presentaciones dentro de cada grupo.
- Asignación de precios por presentación.
- Validación de relaciones antes de generar Excel.
- Revisión final de la plantilla antes de descargarla.
- Generación de archivo `.xlsx` oficial.

### Guardado de avance

La primera versión puede guardar el avance en navegador mediante almacenamiento local para no introducir todavía una tabla de borradores.

Regla inicial:

```text
Guardar avance local
Generar plantilla final .xlsx
```

Una fase futura puede convertir esto en borradores persistentes en SQLite si se requiere.

### Alcance visual

#### PC

- Wizard amplio con pasos visibles.
- Tablas de revisión por sección.
- Botones principales alineados horizontalmente.
- Ayudas contextuales visibles sin ocupar demasiado espacio.

#### Móvil

- Flujo por pasos de una columna.
- Botones táctiles grandes.
- Ayudas contextuales colapsables.
- Revisión resumida antes de descargar.
- Sin duplicar navegación superior; respetar barra inferior existente.

### No incluido en M.11

- No importa datos a SQLite.
- No modifica Cuentas/Orders.
- No carga imágenes binarias.
- No borra ni actualiza productos existentes.
- No crea todavía endpoint definitivo de importación.

### Archivos esperados

El alcance exacto se definirá al implementar, pero se prevén:

```text
README.md
docs/avance-v2.2.5M.11-generador-plantilla-menu.md
docs/roadmap-v2.2.5M-normalizacion-menu.md
docs/roadmap-v2.2.5M11-13-plantillas-menu.md
server/routes/menu.js
public/js/components/menu.js
public/css/style.css
public/index.html
public/service-worker.js
```

Si se requiere librería para generar Excel, debe documentarse explícitamente en `package.json` y `package-lock.json`.

### Validación mínima

- Crear plantilla con productos sin presentación.
- Crear plantilla con productos con presentación.
- Crear tipos/grupos y presentaciones desde el wizard.
- Validar que productos con presentación tengan grupo y precios por presentación.
- Descargar `.xlsx`.
- Verificar que el archivo incluya hojas y metadata esperadas.
- Verificar que usuarios estándar no puedan acceder al generador.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.11: agrega generador asistido de plantilla de Menu"
```

---

## v2.2.5M.12 · Importar Menú desde Plantilla

### Objetivo

Permitir que el administrador importe a SQLite una plantilla Excel oficial generada o compatible con MundiPOS.

### Alcance funcional

- Botón administrativo: `Importar desde plantilla`.
- Subida de archivo `.xlsx`.
- Validación de metadata oficial.
- Validación de hojas requeridas.
- Validación de columnas requeridas.
- Vista previa de resultados.
- Separación de errores críticos y advertencias.
- Confirmación final antes de importar.
- Importación transaccional.
- Registro claro de lo creado o actualizado.

### Reglas de importación

La importación debe comportarse de forma segura:

```text
crear si no existe
actualizar si existe y coincide con clave natural
advertir si hay conflicto
nunca eliminar automáticamente
```

### Validaciones mínimas

- Categoría duplicada.
- Subcategoría sin categoría válida.
- Tipo/grupo sin categoría válida.
- Tipo/grupo con subcategoría que no pertenece a la categoría indicada.
- Presentación sin tipo/grupo válido.
- Producto sin categoría válida.
- Producto con presentación sin tipo/grupo.
- Producto con presentación sin precios válidos.
- Producto con presentación usando presentaciones de otro grupo.
- Producto de cocina en categoría/subcategoría que no permite cocina.
- Precio base o precio por presentación menor o igual a cero.

### No incluido en M.12

- No importación masiva de imágenes binarias.
- No ZIP de imágenes.
- No cambio de lógica visual de imágenes en Cuentas.
- No eliminación masiva.

### Archivos esperados

```text
README.md
docs/avance-v2.2.5M.12-importar-menu-plantilla.md
docs/roadmap-v2.2.5M-normalizacion-menu.md
docs/roadmap-v2.2.5M11-13-plantillas-menu.md
server/routes/menu.js
server/db/database.js
public/js/components/menu.js
public/css/style.css
public/index.html
public/service-worker.js
package.json
package-lock.json
```

`package.json` y `package-lock.json` solo se agregan si se incorpora dependencia real para leer `.xlsx`.

### Validación mínima

- Rechazar archivo que no sea plantilla oficial.
- Rechazar plantilla sin hoja `_METADATA`.
- Rechazar plantilla con columnas faltantes.
- Mostrar preview sin importar si hay errores críticos.
- Importar correctamente una plantilla válida.
- Confirmar que Menú muestra lo importado.
- Confirmar que Cuentas consume los productos importados desde `/api/menu/operational-products`.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.12: importa Menu desde plantilla validada"
```

---

## v2.2.5M.13 · Imágenes por presentación y producto

### Objetivo

Definir e implementar la regla visual de imágenes cuando un producto tiene presentaciones activas.

### Problema a resolver

Actualmente la imagen vive principalmente en el producto. Con la nueva lógica de tipos/grupos y presentaciones, algunos productos requieren imagen por presentación.

Ejemplo:

```text
Producto: Imperial
Presentaciones: 350 ml, 750 ml, 1000 ml
```

Cada presentación podría requerir una imagen distinta. En esos casos, Cuentas debe mostrar la imagen correcta según la presentación seleccionada.

### Alcance preliminar

- Mantener imagen base del producto como fallback.
- Permitir imagen específica por relación producto-presentación.
- Ajustar Menú administrativo para cargar o editar imagen por presentación del producto.
- Ajustar contrato operativo para entregar imagen efectiva.
- Ajustar Cuentas para mostrar imagen efectiva.

### Decisión pendiente

Antes de implementar M.13 se debe definir si la imagen vive en:

```text
presentaciones_producto.imagen
```

o en una tabla separada de assets por producto/presentación.

### No incluido todavía

- Importación masiva de imágenes desde ZIP.
- Optimización avanzada de imágenes.
- CDN o almacenamiento externo.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.13: agrega imagenes por presentacion de producto"
```

---

## Retorno a Cuentas / Orders

Después de completar y validar `v2.2.5M.11`, `v2.2.5M.12` y `v2.2.5M.13`, se retoma la línea principal:

```text
v2.2.5 · Normalización y Estabilización del módulo Cuentas / Orders
```

El retorno a Cuentas debe partir de un Menú con:

- datos normalizados;
- carga inicial asistida;
- importación validada;
- imágenes efectivas definidas;
- contrato operativo estable.

---

## Regla de commits seguros

Antes de cada commit:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
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

## Estado de implementación · v2.2.5M.11

`v2.2.5M.11 · Generador asistido de Plantilla Excel de Menú` queda implementado como fase de generación, no de importación.

Incluye:

- botón administrativo `Plantilla asistida`;
- wizard por pasos;
- demo contextual;
- guardado local del borrador;
- validación previa;
- endpoint `POST /api/menu/template/generate`;
- archivo `.xlsx` oficial con metadata verificable.

La importación real queda pendiente para:

```text
v2.2.5M.12 · Importar Menú desde Plantilla
```

## Estado de implementación · v2.2.5M.12

`v2.2.5M.12 · Importar Menú desde Plantilla` queda implementado como fase de validación e importación real.

Incluye:

- botón administrativo `Importar plantilla`;
- endpoint `POST /api/menu/template/validate`;
- endpoint `POST /api/menu/template/import`;
- validación de metadata oficial;
- validación de hojas y columnas requeridas;
- importación transaccional;
- creación/actualización sin eliminación de registros existentes;
- recarga del módulo Menú después de importar.

Commit sugerido:

```powershell
git commit -m "v2.2.5M.12: agrega importacion de Menu desde plantilla"
```
