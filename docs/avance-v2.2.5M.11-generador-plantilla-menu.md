# v2.2.5M.11 · Generador asistido de Plantilla Excel de Menú

## Objetivo
Crear una herramienta administrativa dentro del módulo Menú para construir y descargar una plantilla Excel oficial de MundiPOS, usando formularios guiados y el mismo orden lógico de creación que se usa en la app.

Esta subfase prepara el archivo que posteriormente será consumido por `v2.2.5M.12 · Importar Menú desde Plantilla`.

## Alcance implementado

### 1. Botón administrativo en Menú
Se agrega el botón:

```text
Plantilla asistida
```

El botón está disponible solo para usuarios administradores y permite abrir el generador.

### 2. Wizard de creación
El asistente se organiza en cuatro pasos:

```text
1. Estructura
2. Productos
3. Presentaciones
4. Revisión
```

Cada paso incluye ayuda contextual para mantener el orden correcto de creación.

### 3. Estructura del menú
Permite preparar:

- metadata del negocio;
- categorías;
- subcategorías.

### 4. Productos
Permite preparar productos con:

- clave del producto;
- nombre;
- descripción;
- categoría;
- subcategoría opcional;
- precio base;
- indicador de producto con presentación;
- tipo/grupo de presentación;
- indicador de cocina;
- estado activo.

### 5. Tipos, presentaciones y precios
Permite preparar:

- tipos/grupos de presentación;
- presentaciones asociadas a grupos;
- precios por producto-presentación.

### 6. Demo y guardado de avance
Se agregan dos herramientas de apoyo:

- `Cargar demo`: carga un ejemplo con Bebidas/Gaseosas y Comidas/Hamburguesas.
- `Guardar avance`: guarda el borrador en `localStorage` del navegador.

No se crea todavía una tabla SQLite de borradores.

### 7. Generación de Excel oficial
Se agrega el endpoint backend:

```text
POST /api/menu/template/generate
```

El endpoint genera un `.xlsx` oficial con las hojas:

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

La hoja `_METADATA` incluye datos verificables para la importación futura:

```text
template_id = MUNDIPOS_MENU_TEMPLATE
app = MundiPOS
module = menu_import
template_version = v2.2.5M.11
schema = menu-template-v1
```

## Seguridad
- El generador está protegido por `requireMenuAdmin`.
- Usuarios estándar no pueden ver el botón ni generar el archivo mediante endpoint.
- No se importan datos ni se modifica SQLite en esta subfase.

## Compatibilidad
No cambia:

- Cuentas / Orders;
- base de datos;
- lógica de venta;
- lógica de cocina/comanda;
- importación real de datos.

## Cache / PWA
Se actualiza el versionado a:

```text
v2.2.5M.11-template-wizard
```

## Archivos modificados
- `README.md`
- `docs/avance-v2.2.5M.11-generador-plantilla-menu.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `docs/roadmap-v2.2.5M11-13-plantillas-menu.md`
- `server/routes/menu.js`
- `public/js/components/menu.js`
- `public/css/style.css`
- `public/index.html`
- `public/service-worker.js`

## Validación recomendada

```powershell
node --check server/routes/menu.js
node --check public/js/components/menu.js
node --check public/service-worker.js
node --check server/app.js
```

Prueba operativa:

```text
1. Entrar como administrador.
2. Abrir Menú.
3. Abrir Plantilla asistida.
4. Cargar demo.
5. Revisar los cuatro pasos.
6. Guardar avance.
7. Descargar Excel.
8. Abrir el archivo y confirmar hojas/metadata.
9. Entrar como usuario estándar y confirmar que no aparece el botón.
```

## Commit sugerido

```powershell
git commit -m "v2.2.5M.11: agrega generador asistido de plantilla de Menu"
```
