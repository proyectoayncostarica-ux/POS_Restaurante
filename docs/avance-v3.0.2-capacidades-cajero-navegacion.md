# v3.0.2 · Capacidades, rol Cajero y navegación autorizada

## 1. Objetivo

Introducir un sistema persistente de capacidades que permita separar:

```text
tipo de usuario
rol de trabajo
zona operativa
permisos funcionales
```

La fase habilita el rol operativo `Cajero`, tanto exclusivo como combinado con atención, sin implementar todavía el nuevo núcleo transaccional de Payments.

## 2. Decisión arquitectónica

`usuarios.tipo` continúa limitado a:

```text
basico
administrador
```

`Cajero` no se agrega como tercer tipo rígido. Se crea como rol de trabajo sin obligación de zona y con capacidades explícitas.

Esto permite:

```text
Cajero exclusivo
Salonero
Bartender
Salonero + Cajero
Bartender + Cajero
Administrador
```

El administrador conserva acceso completo. Los usuarios estándar obtienen la unión de capacidades de los roles activos en su sesión operativa.

## 3. Modelo persistente

### 3.1 Capacidades

Se agrega la tabla `capacidades` con código estable, nombre, descripción, categoría y estado activo.

### 3.2 Relación rol-capacidad

Se agrega `rol_trabajo_capacidades`, con clave compuesta por rol y capacidad.

### 3.3 Extensión de roles de trabajo

`roles_trabajo` incorpora:

```text
requiere_zona
es_sistema
destino_inicial
```

El rol `Cajero` se normaliza como:

```text
slug = cajero
requiere_zona = 0
es_sistema = 1
destino_inicial = cash
```

## 4. Catálogo inicial

```text
orders.operate
orders.split
orders.issue_preinvoice
orders.finalize_service
cash.access
cash.collect
cash.reprint
cash.reverse
kitchen.operate
printing.configure
printing.retry
```

Los códigos son contratos internos estables. Las rutas y servicios no deben decidir permisos mediante nombres visibles de roles.

## 5. Compatibilidad con instalaciones existentes

La migración registra un marcador único:

```text
v3_capability_backfill_done
```

La primera ejecución asigna a los roles operativos existentes capacidades de atención y las capacidades legacy mínimas de Caja. Esto evita que un negocio actualizado pierda de forma inmediata la posibilidad de cobrar.

Después de la migración, el administrador puede retirar capacidades de Caja a saloneros/bartenders y dejar el cobro exclusivamente al rol Cajero.

El rol Cajero siempre conserva como mínimo:

```text
cash.access
cash.collect
cash.reprint
```

## 6. Autorización backend

Se crean:

```text
server/security/capabilities.js
server/services/capabilityService.js
server/middleware/requireCapability.js
```

`requireCapability()`:

1. exige una sesión autenticada;
2. permite acceso total al administrador;
3. vuelve a resolver en base de datos las capacidades de los roles activos;
4. responde `403` con código `CAPABILITY_REQUIRED` cuando falta el permiso.

La ruta legacy:

```text
POST /api/orders/:id/pay
```

queda protegida por:

```text
cash.collect
```

Esto mantiene compatibilidad temporal, pero el nuevo cobro por prefactura será responsabilidad de Payments/Caja en `v3.2.x`.

## 7. Sesión operativa

La autenticación ahora entrega:

```text
roles_trabajo
capacidades
destino_inicial
sesion_operativa
```

Un rol sin zona es seleccionable si está activo. Por tanto, un usuario exclusivamente Cajero puede iniciar sesión aunque no tenga zonas asociadas.

Si el usuario activa varios roles, las capacidades se unen sin duplicados. Un usuario con rol de atención y Cajero mantiene ambos conjuntos de funciones.

## 8. Navegación autorizada

Se agrega una política frontend central `Access` para visibilidad y destino inicial.

Reglas iniciales:

```text
Dashboard/Zonas/Menú/Cuentas → orders.operate
Caja → cash.access
Usuarios/Configuración → administrador
```

Caja se presenta mediante el botón del header. No se agrega como módulo principal del sidebar.

Un cajero exclusivo:

- entra directamente a Caja;
- no ve módulos de atención;
- no necesita zona;
- no recibe el menú hamburguesa cuando no tiene enlaces laterales visibles.

La UI solo mejora la experiencia. La protección real permanece en backend.

## 9. Sección base Caja

Se agregan:

```text
server/routes/cash.js
public/js/components/cash.js
```

La sección inicial muestra un resumen de cuentas pendientes y consumo pendiente. No procesa dinero todavía.

Esto permite validar navegación, permisos y sesión antes de introducir el dominio Payments.

## 10. Administración de roles y usuarios

La pantalla administrativa de roles permite:

- decidir si el rol requiere zona;
- seleccionar zonas cuando aplica;
- seleccionar capacidades agrupadas;
- reconocer roles de sistema;
- conservar las capacidades mínimas del Cajero.

Usuarios permite asignar roles sin zona y muestra el rol Cajero de forma explícita. Un usuario estándar sigue requiriendo al menos un rol operativo activo.

## 11. Pruebas automáticas

Se agregan:

```text
tests/capabilityService.test.js
tests/capabilitySchema.test.js
```

La suite completa valida 15 casos con 0 fallos:

- creación de tablas y rol Cajero;
- capacidades mínimas del Cajero;
- cajero exclusivo sin zona;
- usuario mixto;
- administrador con acceso completo;
- transacciones, savepoints y concurrencia;
- dinero e idempotencia.

También se comprobó la migración sobre una copia de una base existente, sin modificar la base real.

## 12. Alcance no incluido

Esta fase no implementa:

- prefacturas persistentes;
- API final de Caja;
- Payments transaccional;
- efectivo, tarjeta, vuelto o pagos mixtos;
- cierre financiero y liberación integral;
- realtime filtrado por capacidades.

Esos cambios continúan en `v3.0.3`, `v3.1.x` y `v3.2.x`.

## 13. Archivos modificados

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/avance-v3.0.2-capacidades-cajero-navegacion.md
package.json
package-lock.json
server/config/appInfo.js
server/db/database.js
server/security/capabilities.js
server/services/capabilityService.js
server/middleware/requireCapability.js
server/routes/auth.js
server/routes/users.js
server/routes/tables.js
server/routes/orders.js
server/routes/cash.js
server/app.js
public/js/main.js
public/js/components/cash.js
public/js/components/tables.js
public/js/components/users.js
public/js/components/orders.js
public/js/components/dashboard.js
public/css/style.css
public/index.html
public/service-worker.js
tests/helpers/testDatabase.js
tests/capabilityService.test.js
tests/capabilitySchema.test.js
```

## 14. Validación operativa requerida

### Administrador

1. Iniciar sesión.
2. Abrir Zonas y editar roles de trabajo.
3. Confirmar que existe el rol Cajero sin zona.
4. Revisar capacidades agrupadas.
5. Crear o editar un usuario estándar y asignarle solo Cajero.

### Cajero exclusivo

1. Iniciar sesión.
2. Confirmar que no solicita zona.
3. Confirmar entrada directa a Caja.
4. Confirmar que no ve módulos de atención no autorizados.
5. Confirmar que Caja muestra el resumen base.

### Usuario mixto

1. Asignar un rol de atención y Cajero.
2. Seleccionar ambos roles en la sesión operativa.
3. Confirmar Dashboard/Cuentas y botón Caja.
4. Cambiar a un conjunto de roles sin Caja y confirmar que el botón desaparece.

### Protección backend

1. Retirar `cash.collect` de un rol de atención.
2. Iniciar sesión con ese rol.
3. Intentar llamar manualmente la ruta legacy de pago.
4. Confirmar respuesta `403` con `CAPABILITY_REQUIRED`.

### Compatibilidad

1. Confirmar que roles existentes conservan operación después de actualizar.
2. Ejecutar `npm test`.
3. Confirmar 15 pruebas aprobadas y 0 fallos.

## 15. Commit

```powershell
git commit -m "v3.0.2: agrega capacidades y rol operativo de Cajero"
```
