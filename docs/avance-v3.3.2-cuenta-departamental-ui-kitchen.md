# Avance v3.3.2 · Cuenta departamental y UI/UX de Kitchen

## Objetivo

Incorporar una identidad operativa compartida para el departamento de Cocina y un tablero visual persistente que complemente la comanda impresa sin conceder acceso a otros módulos de MundiPOS.

## Cuenta departamental Cocina

La tabla `usuarios` incorpora:

- `clase_cuenta`: `humana` o `departamental`;
- `cuenta_departamental_codigo`: identificador funcional de la estación.

Durante la inicialización se provisionan idempotentemente:

- rol de sistema `Cocina`;
- `requiere_zona = 0`;
- `destino_inicial = kitchen`;
- única capacidad `kitchen.operate`;
- una cuenta departamental con código `cocina`.

La cuenta se crea inactiva y con un secreto aleatorio no expuesto. Un administrador debe establecer una contraseña conocida y activarla antes del primer uso.

El administrador puede:

- activar o bloquear la cuenta;
- cambiar su nombre visible;
- restablecer su contraseña.

No puede:

- eliminarla desde la gestión normal de usuarios;
- convertirla en administrador;
- asignarle otros roles operativos.

## Acceso y navegación

Al iniciar sesión, el único rol Cocina se selecciona automáticamente. La política operativa resuelve:

```text
allowedSections = ['kitchen']
initialSection = 'kitchen'
```

La cuenta departamental obtiene alcance de lectura de zonas únicamente para Kitchen, pero no adquiere capacidades de Orders, Caja, Créditos, Usuarios o Configuración.

El frontend activa `kitchen-department-mode`, que oculta el header operativo normal, sidebar y navegación móvil. Permanecen visibles únicamente:

- tablero Kitchen;
- estado de conexión;
- identidad de estación;
- actualización manual;
- cerrar sesión.

## Tablero visual

`public/js/components/kitchen.js` consume `GET /api/kitchen/board` y presenta tres columnas:

- Pendientes;
- En preparación;
- Listas.

Cada tarjeta muestra:

- hora de solicitud;
- tiempo transcurrido;
- mesa o banco;
- zona;
- usuario humano solicitante;
- destino Cocina/Bar;
- producto y cantidad;
- presentación;
- adicionales;
- indicaciones especiales;
- modificaciones, anulaciones o reenvíos.

No se muestran precios, saldos ni información de cobro.

## Acciones operativas

Las transiciones usan la API versionada de `v3.3.1`:

```text
pendiente → enviada → en_preparacion → lista → entregada
```

Cada cambio envía `expectedVersion`. Los conflictos refrescan el tablero en vez de sobrescribir cambios de otra estación.

Las anulaciones y reenvíos requieren confirmación y motivo.

## Realtime y recuperación

La vista Kitchen se refresca cuando recibe eventos `comandas` autorizados. La cuenta departamental Cocina recibe únicamente destinos `cocina` y no eventos exclusivos de Bar.

El tablero muestra estado En línea/Reconectando y mantiene un refresco periódico de respaldo. Después de recargar o reiniciar, el read model persistente recupera las órdenes no finalizadas.

## Independencia de Printing

`v3.3.2` no implementa cola ni drivers de impresión.

```text
Tablero visual = estado operativo persistente
Printing       = canal documental futuro
```

Una futura falla de impresión no debe ocultar ni retroceder una orden visual.

## Pruebas añadidas

- `tests/kitchenDepartmentAccount.test.js`
- `tests/kitchenAccess.test.js`
- `tests/kitchenUiContract.test.js`

Estas pruebas cubren provisión idempotente, capacidades exclusivas, navegación, acceso de zonas, filtrado realtime, contrato visual y administración protegida de la cuenta departamental.

## Validación requerida

Antes de publicar:

1. pruebas específicas de Kitchen;
2. suite completa;
3. `npm start` sobre `data/restaurant.db`;
4. activar/restablecer contraseña de Cocina desde Usuarios;
5. iniciar sesión con Cocina y confirmar acceso exclusivo al tablero;
6. generar una orden desde un usuario humano y confirmar aparición realtime con solicitante, mesa e indicaciones;
7. recorrer estados hasta Lista/Entregada;
8. Git seguro con staging explícito.

## Siguiente fase

`v3.4.0 · Núcleo y cola de Printing`.
