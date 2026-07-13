# v2.2.4.0 · Roadmap de Zonas dinámicas, roles de trabajo y permisos

## Propósito

La fase **v2.2.4** no debe tratarse como una mejora visual simple del módulo `Zonas`. Debe ser una transición controlada para que MundiPOS pase de una estructura rígida basada en `Salón / Bar / Barra` a una arquitectura dinámica capaz de representar distintos tipos de locales, puestos, permisos, roles de trabajo y operación por zonas.

Esta fase existe para definir el camino seguro antes de escribir lógica funcional extensa. El objetivo es evitar código spaghetti, cambios mezclados o restricciones que bloqueen la operación diaria.

## Principio rector

La regla primordial de esta fase es:

```text
No se continúa con la siguiente subfase hasta que la subfase actual esté comprobada como funcional.
```

Flujo obligatorio por subfase:

```text
1. Implementar solo el alcance definido para esa subfase.
2. Probar que la app sigue funcionando en PC y móvil.
3. Si surge un error, corregirlo como fix de la misma subfase.
4. Documentar la subfase o fix en el README canónico.
5. Validar sintaxis y revisar git status.
6. Hacer commit/push seguro.
7. Solo después avanzar a la siguiente subfase.
```

Ejemplos de fixes:

```text
v2.2.4.1 fix1
v2.2.4.1 fix2
v2.2.4.1 fix3
```

## Contexto funcional

El módulo `Zonas` debe representar la estructura real del local, no una lista fija de áreas. Cada negocio puede tener zonas distintas:

```text
Salón
Terraza
Bar
Barra
VIP
Patio
Deck
Segundo piso
Área privada
Lounge
```

Dentro de cada zona pueden existir puestos de distintos tipos:

```text
Mesa
Banco
Sillón
Cabina
Mesa alta
Puesto individual
Barra individual
```

Además, la visibilidad y operación de esas zonas puede depender del usuario que está trabajando. En locales grandes, un bartender puede operar solo Bar/Barra, mientras que un salonero puede operar Salón/Terraza.

## Conceptos base

### Rol de sistema

Define permisos generales dentro de la app.

```text
Admin
- Puede administrar estructura del local.
- Puede administrar usuarios.
- Puede ver todas las zonas.
- Puede configurar permisos y roles.
- Puede ejecutar cierre diario cuando se implemente.

Estándar
- Puede operar únicamente lo asignado.
- No debe administrar estructura del local salvo permiso explícito.
- Puede abrir, reservar, agregar productos o cerrar cuentas según permisos.
```

### Rol de trabajo

Define dónde trabaja el usuario durante su sesión operativa.

```text
Bartender → Bar / Barra
Salonero → Salón / Terraza
Terraza → Terraza
Apoyo → varias zonas asignadas
```

Un usuario puede tener varios roles de trabajo disponibles y escoger con cuál trabajará ese día.

### Sesión operativa activa

Es la elección vigente del usuario para la jornada actual.

Ejemplo:

```text
Usuario: Carlos
Rol de sistema: Estándar
Roles de trabajo:
- Bartender → Bar / Barra
- Salonero → Salón / Terraza

Sesión activa de hoy: Bartender
Zonas visibles: Bar / Barra
```

### Zona dinámica

Una zona es una locación física configurable del local.

Ejemplos:

```text
Salón
Terraza
Bar
Barra
VIP
Patio
```

Propiedades esperadas:

```text
Nombre
Icono
Orden
Activa/inactiva
Visible en Dashboard
Acepta reservaciones
Aplica servicio 10%
Porcentaje de servicio
```

### Puesto dinámico

Un puesto es un elemento operativo dentro de una zona.

Ejemplos:

```text
Mesa 1
Banco 2
Sillón 1
Cabina 3
Mesa alta 4
```

Propiedades esperadas:

```text
Zona asignada
Tipo de puesto
Número o nombre visible
Capacidad
Estado: libre, reservada, ocupada
Reservaciones: heredar de zona, sí, no
Servicio 10%: heredar de zona, sí, no
Activo/inactivo
```

## Reglas funcionales clave

### No bloquear módulos completos

Un usuario estándar puede no tener permiso para administrar `Zonas`, pero sí puede necesitar operar puestos dentro de sus zonas asignadas.

Por eso la app debe controlar permisos por acción, no solo por módulo.

Ejemplo correcto:

```text
Usuario estándar asignado a Bar / Barra

Puede:
- Ver Bar / Barra
- Abrir puesto
- Reservar si la zona/puesto lo permite
- Agregar productos
- Cerrar cuenta si tiene permiso
- Liberar puesto si tiene permiso

No puede:
- Crear zonas
- Editar estructura del local
- Crear usuarios
- Ver zonas no asignadas
```

### Roles de trabajo deben empatar con zonas existentes

No se debe permitir crear roles de trabajo escribiendo zonas como texto libre.

Incorrecto:

```text
Rol: Bartender
Zonas escritas manualmente: Bar, Barra
```

Correcto:

```text
Rol: Bartender
Zonas seleccionadas desde la lista real de zonas creadas.
```

Si no existen zonas:

```text
Antes de crear roles de trabajo, debe crear las zonas del local.
[Ir a Zonas]
```

### Usuarios estándar requieren asignación operativa válida

Un usuario administrador puede crearse aunque todavía no existan zonas.

Un usuario estándar operativo requiere:

```text
- Al menos un rol de trabajo asignado.
- Que ese rol tenga zonas existentes, activas y válidas.
```

Si no hay zonas o roles de trabajo:

```text
Antes de crear usuarios estándar, debe crear zonas y roles de trabajo.
[Ir a Zonas]
```

### Bootstrap de administrador inicial

En producción, si la app no tiene ningún usuario administrador, no debe mostrar login normal. Debe mostrar un registro inicial del primer administrador.

Regla:

```text
Si existe al menos 1 admin:
    mostrar login normal.

Si no existe ningún admin:
    mostrar registro inicial de administrador.
```

El backend debe impedir crear un segundo administrador inicial si ya existe uno.

### Usuario demo solo para desarrollo

El usuario demo es útil para desarrollo, pero no debe bloquear el flujo de producción.

Configuración sugerida:

```env
SEED_DEMO_USER=true
```

En desarrollo puede estar en `true`. En producción debe poder estar en `false` para permitir el registro inicial.

### Servicio 10% por zona/puesto

No todas las zonas aplican servicio a mesa.

Ejemplos:

```text
Salón / Mesa → aplica servicio 10%
Terraza / Mesa → aplica servicio 10%
Bar / Barra → no aplica servicio 10%
Para llevar → no aplica servicio 10%
```

Regla recomendada:

```text
Zona define el comportamiento base.
Puesto puede heredar o sobrescribir.
```

Al abrir un pedido, se debe guardar si ese pedido aplica servicio y cuál porcentaje aplica, para que cambios posteriores en la zona no alteren cuentas ya abiertas.

## Roadmap detallado de v2.2.4

### v2.2.4.0 · Roadmap y reglas de arquitectura

**Objetivo:** documentar el camino seguro antes de tocar lógica funcional.

Incluye:

```text
- Roadmap técnico en documento separado.
- Registro en README canónico.
- Reglas de avance, fixes, validación y commit.
```

No incluye:

```text
- Cambios en base de datos.
- Cambios en login.
- Cambios en Dashboard.
- Cambios en Zonas.
- Restricciones de permisos.
```

### v2.2.4.1 · Auditoría técnica y mapa de impacto

**Objetivo:** identificar dónde vive cada lógica actual antes de modificarla.

Archivos/módulos a revisar:

```text
server/db/database.js
server/routes/auth.js
server/routes/users.js
server/routes/tables.js
server/routes/orders.js
server/routes/dashboard.js
server/middleware/auth.js
server/utils/realtime.js

public/js/main.js
public/js/components/users.js
public/js/components/tables.js
public/js/components/orders.js
public/js/components/dashboard.js
public/css/style.css
public/index.html
```

Entregable esperado:

```text
- Mapa de impacto por módulo.
- Detección de lógica hardcodeada de Salón/Bar/Barra.
- Detección de puntos donde se crean/abren/reservan/cierran puestos.
- Detección de permisos actuales y rutas protegidas.
```

Validación: no debe cambiar comportamiento.

### v2.2.4.2 · Bootstrap de administrador inicial

**Objetivo:** preparar producción cuando no exista ningún administrador.

Nueva lógica:

```text
Si existe al menos 1 admin:
    login normal.

Si no existe ningún admin:
    registro inicial del administrador principal.
```

Debe incluir:

```text
- Endpoint público de estado inicial.
- Endpoint para crear primer administrador.
- Validación backend para impedir duplicar bootstrap.
- Separación de demo/dev y producción.
```

No debe tocar todavía:

```text
- Zonas dinámicas.
- Roles de trabajo.
- Filtros por zona.
```

### v2.2.4.3 · Modelo base de zonas dinámicas y puestos dinámicos

**Objetivo:** crear la base conceptual de zonas y puestos sin romper lo actual.

Modelo sugerido:

```text
zonas
- id
- nombre
- slug
- icono
- orden
- acepta_reservas
- aplica_servicio
- porcentaje_servicio
- visible_dashboard
- activa
- created_at
- updated_at

tipos_puesto
- id
- nombre
- icono
- orden
- activo
- created_at
- updated_at

mesas / puestos actual
- zona_id
- tipo_puesto_id
- numero
- nombre_visible
- capacidad
- acepta_reservas_override
- aplica_servicio_override
- activo
```

Regla: no renombrar de golpe la tabla `mesas` si eso puede romper el sistema. Se puede mantener internamente y tratarla visualmente como `puestos`.

### v2.2.4.4 · Migración compatible de datos actuales

**Objetivo:** convertir la estructura actual en datos dinámicos sin perder compatibilidad.

Migración esperada:

```text
salon  → Zona: Salón
bar    → Zona: Bar
barra  → Zona: Barra

mesa   → Tipo de puesto: Mesa
banco  → Tipo de puesto: Banco
```

Validación obligatoria:

```text
- Dashboard sigue mostrando zonas.
- Zonas sigue mostrando mesas/bancos.
- Abrir mesa funciona.
- Reservar funciona.
- Cerrar/liberar funciona.
- Pedidos sigue funcionando.
- No se rompe la base local.
```

### v2.2.4.5 · Administración de zonas y tipos de puesto

**Objetivo:** permitir que el admin cree la estructura real del local.

Módulo Zonas debe separarse en:

```text
Administración:
- Crear zona.
- Editar zona.
- Activar/desactivar zona.
- Definir si acepta reservas.
- Definir si aplica servicio 10%.
- Orden de visualización.

Puestos:
- Crear puesto dentro de zona.
- Elegir tipo de puesto.
- Número/nombre visible.
- Capacidad.
- Heredar o sobrescribir reservas.
- Heredar o sobrescribir servicio 10%.
```

### v2.2.4.6 · Roles de trabajo vinculados a zonas existentes

**Objetivo:** crear roles de trabajo seleccionando zonas reales del sistema.

Ejemplos:

```text
Bartender → Bar / Barra
Salonero → Salón / Terraza
Terraza → Terraza
```

Reglas:

```text
- No se puede asignar una zona inexistente.
- No se puede usar texto libre para zonas.
- Un rol sin zonas activas no puede usarse como rol operativo.
- Si una zona se desactiva, el rol debe advertir o quedar limitado a zonas activas restantes.
```

### v2.2.4.7 · Usuarios con rol de sistema y roles de trabajo

**Objetivo:** separar permisos administrativos de asignación operativa.

Cada usuario debe tener:

```text
Rol de sistema:
- Admin
- Estándar

Roles de trabajo disponibles:
- Bartender
- Salonero
- Terraza
- Apoyo
```

Reglas:

```text
Admin:
- Puede crearse aunque no existan zonas.

Estándar:
- Requiere al menos un rol de trabajo asignado.
- Ese rol debe tener zonas válidas.
```

### v2.2.4.8 · Sesión operativa activa

**Objetivo:** definir dónde trabajará el usuario hoy.

Flujo:

```text
Usuario con un solo rol de trabajo:
    entra directo con ese rol activo.

Usuario con varios roles de trabajo:
    debe elegir uno al iniciar sesión.

Admin:
    puede entrar en vista completa.
```

El rol activo define:

```text
- Zonas visibles.
- Puestos visibles.
- Dashboard.
- Zonas.
- Pedidos.
- Cuentas.
- Header.
```

### v2.2.4.9 · Header con rol de sistema y rol de trabajo

**Objetivo:** que el usuario siempre sepa bajo qué perfil está operando.

Ejemplos:

```text
Admin · Vista completa
Andrey
```

```text
Estándar · Bartender
Carlos
```

```text
Estándar · Salonero
María
```

En móvil debe mantenerse compacto sin romper el diseño actual.

### v2.2.4.10 · Dashboard dinámico según zonas permitidas

**Objetivo:** eliminar filtros fijos de Salón/Bar/Barra.

Dashboard debe pintar según:

```text
Admin:
    todas las zonas visibles.

Usuario estándar:
    solo zonas del rol de trabajo activo.
```

Regla:

```text
“Todos” significa todas las zonas permitidas para ese usuario.
```

No necesariamente todo el restaurante.

### v2.2.4.11 · Navegación inferior móvil dinámica

**Objetivo:** que el menú inferior se construya con zonas reales.

Si hay pocas zonas:

```text
Todos | Salón | Bar | Barra
```

Si hay muchas:

```text
Todos | Salón | Terraza | VIP | Bar | Barra | Patio
```

Debe ser desplazable horizontalmente en móvil, sin ocupar varias líneas ni romper diseño.

### v2.2.4.12 · Restricciones backend por zona y acción

**Objetivo:** que la seguridad no dependa solo del frontend.

El backend debe validar:

```text
- Usuario autenticado.
- Rol de sistema.
- Rol de trabajo activo.
- Zonas permitidas.
- Permiso de acción.
```

Permisos sugeridos:

```text
zones.view
zones.manage
zones.create
zones.edit
zones.delete

seats.view
seats.create
seats.edit
seats.delete
seats.open
seats.reserve
seats.release

orders.view
orders.create
orders.add_products
orders.close

credits.view
credits.manage

users.view
users.manage

settings.view
settings.manage

daily_close.execute

reports.view
```

Regla clave:

```text
No bloquear módulos completos.
Bloquear o permitir acciones concretas.
```

### v2.2.4.13 · Servicio 10% integrado a pedidos y cuentas

**Objetivo:** que el servicio se calcule según zona/puesto.

Regla:

```text
Al abrir pedido, se guarda si ese puesto aplica servicio y el porcentaje correspondiente.
```

Impacta:

```text
- Apertura de pedido.
- Cierre de cuenta.
- Ventas del día.
- Cuentas pagadas.
- Reportes futuros.
```

### v2.2.4.14 · Módulo Zonas premium y operativo

**Objetivo:** rediseñar Zonas con la nueva lógica.

Debe quedar dividido claramente:

```text
Administración del local:
- Zonas.
- Tipos de puesto.
- Puestos.

Operación:
- Ver puestos asignados.
- Abrir.
- Reservar.
- Pasar reserva a ocupada.
- Agregar productos.
- Liberar.
```

Admin ve ambas capas. Usuario estándar ve solo operación sobre sus zonas permitidas.

### v2.2.4.15 · Sincronización PC/móvil adaptada a zonas dinámicas

**Objetivo:** asegurar que realtime siga funcionando con la nueva estructura.

Debe refrescar correctamente:

```text
- Dashboard.
- Zonas.
- Pedidos.
- Cuentas.
```

Cuando cambie:

```text
- Estado de puesto.
- Pedido.
- Pago.
- Reserva.
- Zona asignada.
- Rol activo.
```

### v2.2.4.16 · Limpieza final y cierre de fase

**Objetivo:** cerrar la transición sin deuda técnica.

Debe revisar:

```text
- No quedan filtros hardcodeados de Salón/Bar/Barra.
- No hay lógica duplicada entre Dashboard y Zonas.
- Backend valida zonas permitidas.
- Frontend solo pinta lo permitido.
- README actualizado.
- Service worker versionado si aplica.
- App funciona en PC y móvil.
- No se commitea data/restaurant.db.
```

## Validaciones obligatorias antes de cada commit

Antes de cualquier commit:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
git status --short
```

Validar sintaxis según archivos tocados:

```powershell
node --check server/app.js
node --check public/js/main.js
```

Y también los archivos específicos modificados en esa subfase.

Filtro de seguridad:

```powershell
git diff --cached --name-only | Select-String -Pattern "data/restaurant.db|\.env$|certs/|\.pem$|\.key$|rootCA|mundipos-rootCA|node_modules|cookies.txt|data/backups"
```

No debe devolver nada.

No usar:

```powershell
git add .
```

Siempre hacer staging explícito por archivo.

## Commit seguro por subfase

Ejemplo:

```powershell
git add README.md
git add docs/roadmap-v2.2.4-zonas-roles-permisos.md
git diff --cached --name-status
git commit -m "v2.2.4.0: documenta roadmap de zonas dinámicas y roles"
git push origin main
```

Ejemplo para fixes:

```powershell
git commit -m "v2.2.4.1 fix1: corrige mapa de impacto de zonas"
git push origin main
```

## Cierre de v2.2.4.0

Con este documento, la subfase **v2.2.4.0** queda definida como fase documental. La siguiente subfase segura será:

```text
v2.2.4.1 · Auditoría técnica y mapa de impacto
```

No debe iniciarse implementación funcional hasta completar y confirmar la auditoría.
