# Avance v2.2.5M.5 · Protección backend administrativa del módulo Menú

## Contexto

Durante la normalización de Menú se confirmó que el módulo funciona como fuente de verdad para Cuentas / Orders: productos, precios, imágenes, categorías, subcategorías, presentaciones y productos de cocina. Por esa razón, antes de volver a Cuentas era necesario proteger Menú como módulo administrativo.

Antes de esta subfase, cualquier usuario autenticado podía ejecutar acciones administrativas sobre Menú: crear productos, editar precios, cambiar presentaciones, crear categorías/subcategorías y activar o desactivar elementos. Esto rompía la separación entre operación del local y administración de la app.

## Objetivo

Convertir las mutaciones de Menú en acciones exclusivas de administradores sin bloquear el consumo operativo del catálogo.

## Regla funcional

- Usuario administrador: puede consultar y administrar Menú.
- Usuario estándar/básico: puede consultar el menú operativo para vender, pero no puede administrar catálogo, estructura ni precios.

## Protección backend aplicada

Se agrega validación administrativa local en `server/routes/menu.js`:

```js
function isMenuAdmin(req) {
    const userType = normalizeUserType(req.session?.userType);
    return userType === 'administrador' || userType === 'admin';
}

function requireMenuAdmin(req, res, next) {
    if (isMenuAdmin(req)) {
        return next();
    }

    return res.status(403).json({
        error: 'Solo los administradores pueden administrar productos, categorías, precios y presentaciones del Menú'
    });
}
```

## Rutas protegidas

Quedan exclusivas para administradores:

```text
POST   /api/menu/categories
PUT    /api/menu/categories/:id
DELETE /api/menu/categories/:id

POST   /api/menu/products
PUT    /api/menu/products/:id
PUT    /api/menu/products/:id/active
DELETE /api/menu/products/:id

POST   /api/menu/presentaciones-globales
PUT    /api/menu/presentaciones-globales/:id
PUT    /api/menu/presentaciones-globales/:id/active
DELETE /api/menu/presentaciones-globales/:id
```

## Rutas que se mantienen consultables

Siguen disponibles para usuarios autenticados porque son necesarias para operación y para el futuro contrato Menú → Cuentas:

```text
GET /api/menu/categories
GET /api/menu/products
GET /api/menu/products/search
GET /api/menu/products/:id/presentaciones
GET /api/menu/operational-products
GET /api/menu/completo
GET /api/menu/presentaciones-globales
```

## Protección de datos administrativos

Los query params de diagnóstico e inactivos quedan limitados a administradores:

```text
include_inactive
includeInactive
include_invalid
include_empty_categories
```

Si un usuario estándar intenta usarlos, el backend los ignora y responde solo datos operativos activos. Esto evita que usuarios de operación vean elementos deshabilitados o diagnósticos internos.

## Ajuste UI

`public/js/components/menu.js` ahora detecta el rol de sistema con `currentUser.tipo`.

Para administradores:

- muestra Gestión de Menú;
- muestra botones de crear;
- muestra acciones de editar, activar y desactivar;
- carga elementos inactivos para administración.

Para usuarios estándar/básicos:

- muestra Consulta de Menú;
- oculta botones administrativos;
- oculta columnas de acciones;
- carga solo elementos activos;
- muestra aviso de modo consulta;
- bloquea llamadas administrativas desde funciones frontend si fueran invocadas manualmente.

## Alcance explícito

Esta subfase no modifica:

- Cuentas / Orders;
- estructura de base de datos;
- contratos de pedidos;
- historial de ventas;
- versión visible de la app, que permanece en 2.0.

## Validación técnica recomendada

```powershell
node --check server/routes/menu.js
node --check public/js/components/menu.js
node --check public/service-worker.js
node --check server/routes/orders.js
node --check public/js/components/orders.js
node --check server/app.js
```

## Pruebas operativas recomendadas

### Como administrador

- Crear producto.
- Editar producto y precio.
- Activar/desactivar producto.
- Crear categoría.
- Crear subcategoría.
- Activar/desactivar categoría/subcategoría.
- Crear presentación global.
- Activar/desactivar presentación global.
- Confirmar que se ven elementos inactivos en Menú administrativo.

### Como usuario estándar/básico

- Abrir Menú y confirmar que aparece como consulta.
- Confirmar que no aparecen botones de crear, editar, activar ni desactivar.
- Confirmar que solo se ven elementos activos.
- Intentar llamar manualmente una ruta mutante y confirmar respuesta `403`.
- Abrir Cuentas/Pedidos y confirmar que el flujo operativo sigue cargando productos activos.

## Criterio de cierre

La subfase se considera cerrada cuando:

- backend responde `403` para mutaciones de Menú hechas por usuarios no administradores;
- administradores pueden seguir gestionando Menú normalmente;
- usuarios estándar pueden seguir consultando productos activos para operar;
- Cuentas no se rompe;
- no se suben archivos sensibles ni base de datos al commit.

## Commit sugerido

```powershell
git commit -m "v2.2.5M.5: protege administracion backend de Menu"
```
