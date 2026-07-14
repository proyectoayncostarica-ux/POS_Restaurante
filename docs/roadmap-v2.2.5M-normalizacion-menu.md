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

## v2.2.5M.6 · Corrección y normalización visual del módulo Menú

### Objetivo

Corregir inconsistencias visuales y botones incompletos del módulo Menú.

### Hallazgo actual

La UI llama a funciones que parecen incompletas o inexistentes, por ejemplo:

```text
Menu.showEditCategoryModal()
```

### Debe revisar

- Crear producto.
- Editar producto.
- Crear categoría.
- Editar categoría.
- Crear presentación.
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
- No se rompe la UI móvil ni PC.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.6: normaliza interfaz administrativa de Menu"
```

---

## v2.2.5M.7 · Endpoint operativo único para Cuentas

### Objetivo

Crear la fuente definitiva que usará Orders para crear y agregar productos.

### Endpoint sugerido

```text
GET /api/menu/operational-products
```

### Estructura esperada

```json
{
  "categorias": [],
  "productos": [
    {
      "id": 1,
      "nombre": "Cerveza",
      "descripcion": "",
      "imagen_url": "",
      "categoria_id": 2,
      "categoria_nombre": "Bebidas",
      "subcategoria": "Cervezas",
      "es_cocina": false,
      "tiene_presentaciones": true,
      "precio_operativo": null,
      "presentaciones": [
        {
          "id": 4,
          "nombre": "Lata",
          "precio": 1500,
          "activa": true
        }
      ],
      "activo": true
    }
  ]
}
```

### Regla

Orders debe dejar de armar por su cuenta la estructura de productos.

Menú debe entregarla lista y confiable.

### Criterio de éxito

- Orders puede crear pedido usando este endpoint.
- Orders puede agregar productos usando este endpoint.
- Presentaciones salen completas.
- Precios salen correctos.
- Cocina/comanda sale marcada.
- Los productos inactivos no aparecen.
- Las presentaciones inactivas no aparecen.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.7: agrega endpoint operativo de productos para Cuentas"
```

---

## v2.2.5M.8 · Limpieza de funciones legacy de Menú

### Objetivo

Eliminar o aislar funciones incompletas, duplicadas o sin uso.

### Archivos a revisar

- `public/js/components/menu.js`
- `server/routes/menu.js`
- llamadas desde `index.html`
- llamadas desde `main.js`
- llamadas desde `orders.js`

### Regla

No eliminar ninguna función sin verificar llamadas desde:

- HTML inline
- modales dinámicos
- main.js
- orders.js
- dashboard.js

### Resultado esperado

- Menú queda más legible.
- Menú queda más mantenible.
- No quedan botones rotos.
- No quedan funciones obvias sin uso.
- No se rompe Cuentas.

### Commit sugerido

```powershell
git commit -m "v2.2.5M.8: limpia funciones legacy del modulo Menu"
```

---

## v2.2.5M.9 · Pruebas operativas Menú → Cuentas

### Objetivo

Validar que Menú entrega datos correctos antes de volver a Orders.

### Checklist obligatorio

1. Crear categoría.
2. Editar categoría.
3. Crear producto sin presentación.
4. Crear producto con presentación.
5. Crear varias presentaciones para un producto.
6. Marcar producto como cocina.
7. Cambiar precio de presentación.
8. Desactivar producto.
9. Desactivar presentación.
10. Confirmar que Cuentas no muestra productos inactivos.
11. Confirmar que Cuentas no muestra presentaciones inactivas.
12. Confirmar que Cuentas muestra precios correctos.
13. Confirmar que productos de cocina siguen marcados.
14. Confirmar que productos históricos siguen visibles en cuentas ya pagadas.
15. Confirmar que usuario estándar no puede administrar Menú.

### Resultado esperado

- `docs/pruebas-v2.2.5M.9-menu-cuentas.md`
- `README.md` actualizado

### Commit sugerido

```powershell
git commit -m "v2.2.5M.9: documenta pruebas operativas Menu hacia Cuentas"
```

---

## v2.2.5M.10 · Cierre de normalización base de Menú

### Objetivo

Cerrar Menú como fuente confiable para Cuentas.

### Debe incluir

- `docs/cierre-v2.2.5M-menu-base.md`
- `README.md` actualizado
- versionado interno actualizado
- Service Worker actualizado

### Criterio de cierre

- Menú administra productos correctamente.
- Menú protege edición solo para admin.
- Menú entrega productos operativos listos para Orders.
- Productos con presentación tienen precios confiables.
- Productos sin presentación tienen precios confiables.
- Productos de cocina quedan correctamente marcados.
- Productos inactivos no aparecen en Cuentas.
- Presentaciones inactivas no aparecen en Cuentas.
- Cuentas puede continuar su normalización sin rehacer Menú.

### Commit y tag sugerido

```powershell
git commit -m "v2.2.5M: cierra normalizacion base del modulo Menu"
git tag v2.2.5M-cierre
git push origin main
git push origin v2.2.5M-cierre
```

---

## Orden recomendado

```text
v2.2.5M.0  Auditoría técnica                 ✅
v2.2.5M.1  Contrato operativo Menú → Cuentas
v2.2.5M.2  Productos operativos backend
v2.2.5M.3  Presentaciones y precios
v2.2.5M.4  Estados activo/inactivo
v2.2.5M.5  Protección backend admin
v2.2.5M.6  UI administrativa Menú
v2.2.5M.7  Endpoint operativo para Cuentas
v2.2.5M.8  Limpieza legacy
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
