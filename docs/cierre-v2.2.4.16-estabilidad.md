# v2.2.4.16 · Limpieza final y cierre de estabilidad

## Objetivo

Cerrar la línea de trabajo `v2.2.4` dejando documentado el alcance funcional estabilizado y sincronizando los assets PWA para evitar regresiones por caché después de las fases de zonas dinámicas, roles de trabajo, responsabilidad compartida, servicio 10% y Realtime adaptado.

## Alcance funcional estabilizado

- Zonas dinámicas y tipos de puesto dinámicos.
- Roles de trabajo vinculados a zonas reales y activas.
- Usuarios con rol de sistema y roles de trabajo.
- Sesión operativa multirrol.
- Header con rol de sistema y roles activos.
- Dashboard dinámico por zonas permitidas.
- Navegación móvil dinámica con `Todos`, primeras zonas visibles y `Más...`.
- Responsabilidad compartida por mesa/cuenta.
- Reasignación de responsables desde el módulo Zonas.
- Restricciones backend por zona y responsabilidad.
- Servicio 10% integrado a pedidos, cuentas, pagos y Dashboard.
- Zonas premium operativo/administrativo.
- Realtime segmentado por contexto operativo.

## Limpieza aplicada

- Se sincronizó el cache busting de `index.html` en `v2.2.4.16-cierre-estabilidad`.
- Se actualizó `public/service-worker.js` a `v2.2.4.16-cierre-estabilidad`.
- Se depuró la lista de precaché para evitar versiones intermedias mezcladas.
- Se mantiene el Service Worker defensivo que siempre devuelve una `Response` válida.
- Se actualizó la línea interna de estabilidad en `server/config/appInfo.js` sin cambiar la versión visible de usuario (`2.0`).

## Checklist mínimo de cierre operativo

### Login y sesión

- Admin puede ingresar sin rol operativo si no necesita operar zona específica.
- Usuario estándar puede seleccionar uno o varios roles de trabajo.
- El cambio de roles activos respeta autorización admin y responsabilidades activas.

### Dashboard

- Admin ve operación global.
- Usuario estándar ve solo zonas permitidas por sus roles activos.
- Las cards muestran zona/tipo reales.
- Las mesas ajenas quedan bloqueadas para usuario estándar.
- Admin y responsables reales pueden operar sin bloqueos falsos.

### Zonas

- Admin ve administración y operación.
- Usuario estándar ve operación permitida.
- Reasignar mesa permite seleccionar responsables con sesión operativa activa compatible con la zona.
- No aparecen usuarios inactivos, sin sesión o con rol activo incompatible.

### Pedidos/cuentas/servicio

- Al crear pedido se guarda snapshot de servicio.
- Al cobrar se muestra subtotal, servicio y total.
- Dashboard muestra montos con servicio cuando aplica.

### Realtime/PWA

- Al abrir, reservar, cerrar, cobrar o reasignar, las vistas relevantes se actualizan.
- La PWA no queda en pantalla blanca después del login.
- El navegador carga assets `v2.2.4.16-cierre-estabilidad`.

## Criterios de detención

Detener el cierre y reportar bug si ocurre cualquiera de estos casos:

- Pantalla blanca después de login.
- `GET /api/tables/structure` responde 500.
- Admin queda bloqueado por “Responsable asignado”.
- Responsable real no puede operar su mesa.
- Usuario estándar ve zonas fuera de sus roles activos.
- Reasignación muestra usuarios sin sesión operativa activa o con rol incompatible.
- El cobro pierde el desglose de servicio.
- Realtime provoca recargas infinitas o vistas cruzadas entre usuarios.

## Nota de versionado

La app conserva `APP_VERSION = 2.0` como versión visible para clientes. La estabilidad interna de desarrollo de esta línea queda cerrada en `v2.2.4.16`.
