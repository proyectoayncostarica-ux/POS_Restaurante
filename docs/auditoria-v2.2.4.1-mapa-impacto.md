# v2.2.4.1 · Auditoría técnica y mapa de impacto

## Propósito

Esta subfase documenta el estado técnico actual de MundiPOS antes de iniciar la implementación de zonas dinámicas, puestos dinámicos, roles de trabajo, permisos por acción, sesión operativa activa y servicio 10% configurable.

El objetivo no es modificar comportamiento todavía. El objetivo es identificar dónde vive cada lógica, qué riesgos existen y qué archivos se verán afectados para que las próximas subfases se implementen sin romper código funcional ni mezclar cambios incompatibles.

## Regla de esta subfase

```text
No se modifica lógica funcional.
No se modifica base de datos.
No se activan permisos nuevos.
No se cambia Dashboard, Zonas, Usuarios, Pedidos ni Cuentas.
Solo se documenta la auditoría y el mapa de impacto.
```

La siguiente subfase no debe comenzar hasta que este documento y el README canónico estén adjuntos al código y se haya verificado que la app sigue limpia en Git.

## Archivos auditados

### Backend

```text
server/app.js
server/db/database.js
server/routes/auth.js
server/routes/users.js
server/routes/tables.js
server/routes/orders.js
server/routes/dashboard.js
server/routes/accounts.js
server/utils/realtime.js
```

### Frontend

```text
public/index.html
public/css/style.css
public/js/main.js
public/js/components/dashboard.js
public/js/components/tables.js
public/js/components/orders.js
public/js/components/users.js
public/service-worker.js
```

### Documentación

```text
README.md
docs/roadmap-v2.2.4-zonas-roles-permisos.md
```

## Validación realizada

Se revisó sintaxis de los archivos JavaScript principales relacionados con esta auditoría:

```powershell
node --check server/app.js
node --check server/db/database.js
node --check server/routes/auth.js
node --check server/routes/users.js
node --check server/routes/tables.js
node --check server/routes/orders.js
node --check server/routes/dashboard.js
node --check server/utils/realtime.js
node --check public/js/main.js
node --check public/js/components/users.js
node --check public/js/components/tables.js
node --check public/js/components/orders.js
node --check public/js/components/dashboard.js
node --check public/service-worker.js
```

Resultado: sin errores de sintaxis detectados en esta revisión.

---

# 1. Estado técnico actual

## 1.1 La app todavía usa zonas rígidas

La app sigue dependiendo de valores fijos:

```text
salon
bar
bar-mesa
bar-banco
```

Visualmente se muestran como:

```text
Todos
Salón
Bar
Barra
```

Estos valores aparecen en:

```text
public/index.html
public/js/main.js
public/js/components/dashboard.js
public/js/components/tables.js
public/css/style.css
server/routes/dashboard.js
server/routes/tables.js
server/db/database.js
```

### Impacto

Para pasar a zonas dinámicas, estos valores no deben eliminarse de golpe. Primero deben coexistir con zonas reales creadas desde base de datos. Luego se podrá migrar gradualmente Dashboard, Zonas y la subnavegación móvil.

## 1.2 La tabla `mesas` funciona como “puestos”

Actualmente la tabla `mesas` contiene:

```text
id
numero
capacidad
estado
zona
tipo_asiento
cliente_nombre
fecha_apertura
cantidad_personas
hora_estimada
```

Aunque se llama `mesas`, en la práctica ya representa:

```text
Mesa
Banco
```

Por eso puede evolucionar a “puesto” sin renombrar la tabla inmediatamente.

### Recomendación

No renombrar `mesas` en la primera implementación. Eso tocaría demasiadas rutas, componentes, queries, historial, pedidos, comandas y pagos.

La transición segura es:

```text
Mantener tabla interna: mesas
Agregar columnas nuevas compatibles: zona_id, tipo_puesto_id, nombre_visible, activo, reglas de servicio/reserva
Tratar visualmente y documentalmente como Puestos
Renombrar internamente a futuro solo si se justifica
```

## 1.3 No existe tabla real de zonas

Actualmente `zona` es un campo `TEXT` dentro de `mesas`.

No existe una entidad con propiedades como:

```text
nombre
icono
orden
activa
visible_dashboard
acepta_reservas
aplica_servicio
porcentaje_servicio
```

### Impacto

Sin una tabla `zonas`, no se puede:

```text
- Crear Terraza, VIP, Patio o Segundo piso como zonas reales.
- Asignar zonas a roles de trabajo de forma segura.
- Validar que un rol de trabajo solo use zonas existentes.
- Controlar servicio 10% por zona.
- Controlar si una zona acepta reservas.
- Ordenar zonas dinámicamente en Dashboard y navegación móvil.
```

## 1.4 No existe tabla real de tipos de puesto

Actualmente `tipo_asiento` es un campo `TEXT` con lógica implícita:

```text
mesa
banco
```

No existe un catálogo de tipos de puesto.

### Impacto

No se puede crear dinámicamente:

```text
Sillón
Cabina
Mesa alta
Puesto individual
Lounge
```

La migración segura debe crear `tipos_puesto` y mapear:

```text
mesa  → Mesa
banco → Banco
```

## 1.5 Usuarios solo tienen rol de sistema básico

Actualmente `usuarios.tipo` usa:

```text
basico
administrador
```

Esto sirve como rol de sistema, pero no existe rol de trabajo.

### Impacto

Hoy no se puede representar:

```text
Carlos es Estándar, pero hoy trabaja como Bartender.
María es Estándar, pero hoy trabaja en Terraza.
Andrey es Admin, pero quiere operar en Vista completa o como Salonero.
```

## 1.6 No existe sesión operativa activa

La sesión Express guarda:

```text
userId
userName
userNombre
userType
```

No guarda:

```text
rol_trabajo_activo_id
rol_trabajo_activo_nombre
zonas_permitidas
vista_operativa
```

### Impacto

Dashboard, Zonas, Pedidos y Cuentas no pueden filtrar todavía por rol de trabajo activo.

## 1.7 La app crea un administrador demo por defecto

Cuando la base está vacía, el inicializador crea automáticamente:

```text
usuario: admin
contraseña: admin123
tipo: administrador
```

### Impacto

Esto es útil para desarrollo, pero bloquea el futuro flujo de producción donde, si no existe ningún administrador, debe mostrarse un registro inicial en lugar del login.

La siguiente implementación funcional debe separar modo demo/desarrollo de modo producción mediante configuración.

## 1.8 El módulo Usuarios bloquea por módulo completo

En frontend, `Users.load()` impide el acceso si el usuario no es administrador.

En backend, las rutas de usuarios usan `requireAdmin`.

Esto está bien para administración de usuarios, pero no resuelve la nueva arquitectura de permisos por acción.

### Impacto

El patrón actual no debe replicarse en Zonas. Un usuario estándar no debe administrar Zonas, pero sí puede necesitar operar puestos asignados.

Regla futura:

```text
No bloquear Zonas completo para usuario estándar.
Bloquear o permitir acciones concretas.
```

## 1.9 Los endpoints operativos no validan zona permitida

Actualmente el middleware global valida autenticación, pero las rutas operativas no validan si el usuario puede operar una mesa/banco específica.

Endpoints afectados:

```text
POST /api/tables/:id/open
POST /api/tables/:id/close
POST /api/tables/:id/change-to-occupied
POST /api/orders
POST /api/orders/:id/products
POST /api/orders/:id/pay
GET /api/dashboard
GET /api/tables
GET /api/orders
GET /api/accounts
```

### Impacto

Cuando existan roles de trabajo, no bastará con ocultar zonas en frontend. El backend tendrá que validar zona permitida antes de leer o mutar datos.

## 1.10 Dashboard duplica lógica de zonas en backend y frontend

El backend construye resumen por:

```text
todos
salon
bar-mesa
bar-banco
```

El frontend también recalcula y normaliza zonas con la misma lógica.

### Impacto

La transición dinámica debe evitar duplicar dos modelos. Lo ideal es que el backend entregue una estructura de zonas visibles y el frontend solo pinte lo recibido.

## 1.11 La navegación inferior móvil es estática

`INTERNAL_SUBNAV` en `public/js/main.js` tiene subnavegación fija para Dashboard y Zonas:

```text
Todos
Salón
Bar
Barra
```

Además, `public/index.html` contiene botones fijos para Dashboard.

### Impacto

La navegación inferior móvil y los tabs PC deben generarse desde zonas visibles, no desde constantes fijas.

## 1.12 Zonas mezcla administración y operación

El módulo `Zonas` actual administra y opera al mismo tiempo:

```text
- Crear mesa/banco
- Editar capacidad
- Eliminar
- Abrir
- Reservar
- Cambiar reserva a ocupada
- Liberar
```

### Impacto

La nueva arquitectura debe separar:

```text
Administración del local
- Crear zona
- Editar zona
- Crear tipo de puesto
- Crear puesto
- Configurar servicio/reservas

Operación diaria
- Ver puestos permitidos
- Abrir
- Reservar
- Agregar productos
- Liberar
```

Admin debe ver ambas capas. Usuario estándar debe ver solo operación permitida.

## 1.13 El servicio 10% está controlado de forma manual en pago

El pago permite aplicar o no 10% desde UI, pero la decisión no viene de zona/puesto ni se guarda como regla del pedido al abrirlo.

Además, se detectó una inconsistencia técnica importante: parte del frontend intenta detectar “barra” comparando contra `barra`, mientras los datos actuales de tipo de asiento suelen venir como `banco`.

### Impacto

La futura lógica de servicio no debe depender de un checkbox manual como regla principal. Debe venir de:

```text
zona.aplica_servicio
puesto.aplica_servicio_override
```

Y al abrir pedido debe guardarse:

```text
aplica_servicio
porcentaje_servicio
```

Así un cambio posterior de configuración no altera pedidos ya abiertos.

## 1.14 Realtime sincroniza operación, pero no está segmentado por zonas

El SSE actual notifica cambios operativos a todos los clientes autenticados.

### Impacto

Cuando existan zonas por rol de trabajo, los clientes pueden seguir recibiendo aviso general y refrescar, siempre que las APIs ya filtren por permisos. Sin embargo, no debe enviarse payload sensible con datos de zonas no permitidas.

## 1.15 Hay inserción directa de datos de usuario en HTML

Algunos componentes interpolan directamente valores como nombres de clientes, usuarios o productos dentro de HTML.

Dashboard ya tiene uso parcial de `escapeHTML`, pero no es consistente en:

```text
public/js/components/tables.js
public/js/components/orders.js
public/js/components/users.js
```

### Impacto

Al ampliar usuarios, zonas, roles y nombres personalizados, aumenta la cantidad de texto ingresado por el usuario. Conviene centralizar escape/sanitización antes de expandir formularios dinámicos.

## 1.16 La apertura de mesa/banco aún puede mejorarse con actualización atómica

El endpoint de abrir/reservar puesto hace:

```text
1. SELECT mesa
2. validar estado libre
3. UPDATE mesa
```

### Impacto

Ya existe protección contra doble pedido pendiente, pero para evitar competencia entre dos dispositivos intentando abrir el mismo puesto, conviene convertir la apertura en operación atómica:

```sql
UPDATE mesas
SET estado = ...
WHERE id = ? AND estado = 'libre'
```

Luego validar `changes`.

---

# 2. Mapa de impacto por módulo

## 2.1 `server/db/database.js`

### Responsabilidad actual

```text
- Crear tablas base.
- Aplicar migraciones.
- Crear usuario administrador inicial.
- Crear mesas demo de Salón.
- Normalizar columnas antiguas.
```

### Impacto futuro

Deberá incorporar:

```text
- Tabla zonas.
- Tabla tipos_puesto.
- Campos nuevos en mesas/puestos.
- Tablas de roles de trabajo.
- Tablas de asignación usuario ↔ rol de trabajo.
- Tablas de asignación rol de trabajo ↔ zonas.
- Campos de servicio en pedidos.
- Configuración SEED_DEMO_USER.
- Migración compatible de salon/bar/barra actuales.
```

### Riesgo

Alto. Este archivo toca persistencia y migraciones. Cada cambio debe ser pequeño y probado con base limpia y base existente.

## 2.2 `server/routes/auth.js`

### Responsabilidad actual

```text
- Login.
- Logout.
- Verificar sesión.
- Verificar contraseña de administrador.
```

### Impacto futuro

Deberá incorporar:

```text
- Bootstrap status público.
- Registro inicial del primer administrador.
- Respuesta de login con roles de trabajo disponibles.
- Selección de rol de trabajo activo.
- Limpieza de rol activo al cerrar sesión.
```

### Riesgo

Alto. Impacta el acceso inicial a la app.

## 2.3 `server/routes/users.js`

### Responsabilidad actual

```text
- CRUD de usuarios.
- Solo admin.
- Tipo de usuario básico/administrador.
- Protección de último administrador activo.
```

### Impacto futuro

Deberá incorporar:

```text
- Rol de sistema como concepto claro.
- Asignación de roles de trabajo a usuarios.
- Validación de usuario estándar con al menos un rol de trabajo válido.
- Avisos si no existen zonas o roles de trabajo.
- Permisos especiales opcionales a futuro.
```

### Riesgo

Medio-alto. Debe evitar bloquear creación de administrador inicial y evitar usuarios estándar sin operación posible.

## 2.4 `server/routes/tables.js`

### Responsabilidad actual

```text
- Listar mesas/bancos.
- Crear mesa/banco solo para salón/bar.
- Editar capacidad.
- Eliminar último número del grupo.
- Abrir, reservar, liberar y cambiar reserva a ocupada.
- Obtener siguiente número.
```

### Impacto futuro

Deberá transformarse o complementarse con:

```text
- CRUD de zonas reales.
- CRUD de tipos de puesto.
- CRUD de puestos.
- Validación de permisos por acción.
- Validación de zona permitida por sesión operativa.
- Reglas de reserva por zona/puesto.
- Reglas de servicio por zona/puesto.
- Apertura atómica de puesto.
```

### Riesgo

Muy alto. Es el centro operativo de Zonas.

## 2.5 `server/routes/dashboard.js`

### Responsabilidad actual

```text
- Resumen operativo.
- Ventas del día.
- Cuentas pagadas del día.
- Mesas/bancos detalle.
- Agrupación rígida Todos/Salón/Bar/Barra.
```

### Impacto futuro

Deberá cambiar a:

```text
- Consultar zonas visibles según sesión operativa.
- Entregar zonas dinámicas ya agrupadas.
- Calcular “Todos” como todas las zonas permitidas del usuario.
- Evitar hardcode de salon/bar/bar-banco.
```

### Riesgo

Alto. Dashboard es la vista principal y ya tiene sincronización móvil/PC.

## 2.6 `server/routes/orders.js`

### Responsabilidad actual

```text
- Crear pedido sobre mesa ocupada.
- Agregar productos.
- Editar productos.
- Procesar pagos.
- Crear créditos.
- Liberar mesa al pagar.
```

### Impacto futuro

Deberá incorporar:

```text
- Validación de zona permitida antes de crear/agregar/cobrar.
- Servicio 10% guardado en el pedido al abrirlo.
- Porcentaje de servicio persistido.
- Cálculo de servicio basado en pedido, no solo UI.
- Historial usando nombre dinámico de puesto/zona.
```

### Riesgo

Muy alto. Toca dinero, cuentas, créditos y liberación de puestos.

## 2.7 `server/routes/accounts.js`

### Responsabilidad actual

```text
- Cuentas de crédito.
- Abonos.
- Pago completo de crédito.
- Reimpresión/detalle.
```

### Impacto futuro

Deberá filtrar por zona permitida cuando usuarios estándar vean cuentas. También debe respetar el servicio guardado en el pedido al mostrar detalles o reimpresiones.

### Riesgo

Medio-alto. Toca datos financieros y créditos.

## 2.8 `server/utils/realtime.js`

### Responsabilidad actual

```text
- SSE.
- Broadcast de cambios operativos.
- Refresco PC/móvil.
```

### Impacto futuro

Deberá asegurar que los eventos no filtren datos sensibles de zonas ajenas. Puede mantenerse como broadcast general si las APIs filtran por permisos, pero no debe incluir payloads detallados no autorizados.

### Riesgo

Medio. El riesgo real depende de cuánto detalle se agregue al payload.

## 2.9 `public/js/main.js`

### Responsabilidad actual

```text
- Estado global currentUser.
- Login/logout.
- Header.
- Navegación principal.
- Subnavegación móvil fija.
- Realtime cliente.
- PWA.
```

### Impacto futuro

Deberá incorporar:

```text
- Estado de rol de trabajo activo.
- Selector de rol de trabajo tras login.
- Header con rol de sistema + rol de trabajo.
- Subnavegación dinámica para Dashboard/Zonas.
- Ocultamiento de módulos/acciones según permisos.
```

### Riesgo

Alto. Es el pegamento principal del frontend.

## 2.10 `public/js/components/dashboard.js`

### Responsabilidad actual

```text
- Pintar Dashboard.
- Filtros fijos por zonas.
- Filtros por estado.
- Cards de puestos.
- Cuentas pagadas recientes.
- Acciones hacia Pedidos, Cuentas y Zonas.
```

### Impacto futuro

Debe dejar de normalizar zonas fijas y pintar la estructura recibida desde backend:

```text
zonasVisibles[]
puestos[]
resumen por zona
```

### Riesgo

Alto. Ya está muy optimizado visualmente; se debe proteger el diseño actual mientras cambia la fuente de datos.

## 2.11 `public/js/components/tables.js`

### Responsabilidad actual

```text
- Renderizar módulo Zonas.
- Crear mesa/banco.
- Abrir/reservar/liberar.
- Editar capacidad.
- Eliminar.
- Modales operativos premium.
```

### Impacto futuro

Debe separarse en dos capas:

```text
Administración:
- Zonas
- Tipos de puesto
- Puestos

Operación:
- Ver puestos permitidos
- Abrir/reservar/liberar/agregar productos
```

### Riesgo

Muy alto. Será uno de los cambios principales de v2.2.4.

## 2.12 `public/js/components/users.js`

### Responsabilidad actual

```text
- CRUD básico de usuarios.
- Tipo básico/administrador.
- Acceso solo admin.
```

### Impacto futuro

Debe permitir:

```text
- Asignar rol de sistema.
- Asignar roles de trabajo.
- Mostrar advertencia si no existen zonas/roles.
- Impedir usuario estándar operativo sin rol de trabajo válido.
```

### Riesgo

Medio-alto.

## 2.13 `public/js/components/orders.js`

### Responsabilidad actual

```text
- Nuevo pedido.
- Agregar productos.
- Pago.
- Servicio 10% desde UI.
- Liberar puesto desde nuevo pedido.
```

### Impacto futuro

Debe:

```text
- Mostrar solo puestos permitidos.
- Respetar servicio configurado por pedido.
- No depender del tipo fijo banco/barra.
- Usar nombres dinámicos de puesto.
```

### Riesgo

Muy alto. Toca operación y cobro.

## 2.14 `public/index.html`

### Responsabilidad actual

```text
- Estructura del login.
- Header principal.
- Sidebar.
- Dashboard base.
- Tabs fijos de Dashboard.
```

### Impacto futuro

Debe adaptar:

```text
- Registro inicial si no hay admin.
- Selector de rol de trabajo.
- Header con rol de sistema + rol de trabajo.
- Dashboard sin tabs fijos hardcodeados.
```

### Riesgo

Medio.

## 2.15 `public/css/style.css`

### Responsabilidad actual

```text
- Diseño global.
- Cards Dashboard.
- Cards Zonas.
- Mobile subnav.
- Modales premium.
```

### Impacto futuro

Debe soportar:

```text
- Zonas dinámicas sin clases fijas por salón/bar/barra.
- Badges genéricos por zona/tipo.
- Estilos de administración vs operación.
- Selector de rol de trabajo.
- Registro inicial.
```

### Riesgo

Medio. Se debe evitar perder el diseño premium ya logrado.

## 2.16 `public/service-worker.js`

### Responsabilidad actual

```text
- Cache PWA.
- Network-first para CSS/JS/API.
- Versionado de assets.
```

### Impacto futuro

Cada cambio funcional importante en frontend debe actualizar versión de service worker y de assets si aplica.

### Riesgo

Medio. Si no se versiona, móvil puede mostrar código viejo.

---

# 3. Dependencias críticas entre futuras subfases

## 3.1 No se puede filtrar Dashboard por zonas permitidas sin sesión operativa

Antes de filtrar Dashboard/Zonas por usuario, debe existir:

```text
- Rol de trabajo activo.
- Zonas asignadas a ese rol.
- Middleware/helper backend para obtener zonas permitidas.
```

## 3.2 No se pueden crear usuarios estándar operativos sin zonas y roles de trabajo

Antes de asignar usuarios estándar, deben existir:

```text
- Zonas reales.
- Roles de trabajo vinculados a zonas reales.
```

Si no existen, el módulo Usuarios debe mostrar aviso y permitir solo administradores.

## 3.3 No se puede crear rol de trabajo con zonas escritas libremente

Los roles de trabajo deben seleccionar zonas reales activas.

## 3.4 No se debe activar seguridad backend por zona antes de migrar datos

Si se activa filtrado estricto sin migrar `salon/bar/barra` hacia zonas reales, se puede dejar el sistema sin zonas visibles.

## 3.5 No se debe cambiar cálculo de servicio sin persistir la regla en pedido

El 10% debe guardarse al abrir pedido. Si solo se calcula al pagar, un cambio de configuración podría alterar cuentas abiertas.

---

# 4. Riesgos principales detectados

| Riesgo | Nivel | Descripción | Mitigación |
|---|---:|---|---|
| Hardcode de Salón/Bar/Barra | Alto | Aparece en backend, frontend, CSS y HTML. | Migrar por compatibilidad, no eliminar de golpe. |
| Renombrar `mesas` prematuramente | Muy alto | Rompería pedidos, pagos, comandas, dashboard y modales. | Mantener tabla `mesas` y tratarla como puestos. |
| Activar restricciones antes de sesión operativa | Muy alto | Usuarios podrían quedar sin acceso a operación. | Crear primero roles/sesión activa y luego filtrar. |
| Usuario demo en producción | Alto | Impide registro inicial real. | Agregar `SEED_DEMO_USER`. |
| Roles de trabajo con zonas inexistentes | Alto | Asignaciones huérfanas. | Crear roles seleccionando zonas reales. |
| Servicio 10% solo desde UI | Alto | Inconsistencia al cobrar y reportar. | Persistir regla en pedido. |
| Realtime sin segmentación | Medio | Refresca todos los clientes. | Mantener payload general y filtrar APIs por permisos. |
| Cache PWA móvil | Medio | Puede cargar JS/CSS viejo. | Versionar service worker/assets en cada cambio funcional. |
| Inserción directa de HTML | Medio | Nombres personalizados pueden romper UI o generar riesgo. | Centralizar escape de texto. |
| Operaciones no atómicas | Medio-alto | Dos dispositivos pueden competir por el mismo puesto. | Usar UPDATE condicional y validar `changes`. |

---

# 5. Orden técnico recomendado después de esta auditoría

El roadmap v2.2.4.0 ya definió las subfases generales. Esta auditoría confirma que el orden seguro debe mantenerse así:

## v2.2.4.2 · Bootstrap de administrador inicial

Primera implementación funcional recomendada.

Debe tocar principalmente:

```text
server/db/database.js
server/routes/auth.js
public/index.html
public/js/main.js
public/css/style.css
public/service-worker.js
README.md
```

Objetivo:

```text
Si no hay administrador, mostrar registro inicial.
Si hay administrador, login normal.
Usuario demo configurable por entorno.
```

## v2.2.4.3 · Modelo base de zonas y puestos dinámicos

Debe crear estructura sin cambiar todavía el comportamiento visible.

Debe tocar principalmente:

```text
server/db/database.js
server/routes/tables.js
README.md
```

## v2.2.4.4 · Migración compatible de datos actuales

Debe migrar:

```text
salon → Zona Salón
bar + mesa → Zona Bar / Tipo Mesa
bar + banco → Zona Barra o Zona Bar con tipo Banco, según decisión final
mesa → Tipo de puesto Mesa
banco → Tipo de puesto Banco
```

Punto pendiente de decisión antes de implementar:

```text
¿Barra será una zona propia o seguirá siendo una vista derivada de Bar + Banco?
```

Recomendación: en arquitectura dinámica, **Barra debe poder ser zona propia**, porque un local puede tener Bar sin Barra o Barra sin mesas de Bar.

## v2.2.4.5 · Administración de zonas y tipos de puesto

Debe rediseñar el módulo Zonas, pero todavía sin filtros por usuario estándar.

## v2.2.4.6 · Roles de trabajo vinculados a zonas existentes

Debe crear roles de trabajo seleccionando zonas reales.

## v2.2.4.7 · Usuarios con rol de sistema y roles de trabajo

Debe extender Usuarios.

## v2.2.4.8 · Sesión operativa activa

Debe agregar selector de rol de trabajo al login.

## v2.2.4.9 en adelante

Recién aquí se recomienda empezar a filtrar Dashboard, Zonas, Pedidos y Cuentas según rol activo.

---

# 6. Decisiones pendientes antes de escribir código funcional

Antes de v2.2.4.2 o v2.2.4.3 conviene confirmar estas decisiones:

## 6.1 Usuario demo

Propuesta:

```env
SEED_DEMO_USER=true
```

En desarrollo:

```text
true
```

En producción:

```text
false
```

## 6.2 Barra como zona propia

Decisión recomendada:

```text
Barra debe ser zona propia dinámica.
```

Razón:

```text
Un local puede tener Barra sin Bar, Bar sin bancos, o varias barras.
```

## 6.3 Tabla `mesas`

Decisión recomendada:

```text
Mantener nombre interno `mesas` durante v2.2.4.
```

Razón:

```text
Evita romper pedidos, pagos, comandas y consultas existentes.
```

## 6.4 Servicio 10%

Decisión recomendada:

```text
Zona define valor base.
Puesto puede heredar o sobrescribir.
Pedido guarda la regla aplicada al momento de abrirse.
```

## 6.5 Usuarios estándar sin zonas

Decisión recomendada:

```text
No permitir usuario estándar activo sin al menos un rol de trabajo válido.
Permitir administradores aunque no existan zonas.
```

---

# 7. Checklist de validación para cada subfase futura

Antes de cerrar cualquier subfase v2.2.4.x:

```text
1. App inicia sin errores.
2. Login funciona.
3. Dashboard carga.
4. Zonas carga.
5. Abrir puesto funciona.
6. Reservar puesto funciona si aplica.
7. Crear pedido funciona.
8. Agregar productos funciona.
9. Procesar pago funciona.
10. Cuentas pagadas/ventas del día siguen registrando.
11. Realtime PC/móvil sigue refrescando.
12. Móvil no queda con CSS/JS viejo por PWA.
13. README actualizado.
14. No se sube data/restaurant.db.
```

Validaciones técnicas mínimas:

```powershell
node --check server/app.js
node --check server/db/database.js
node --check server/routes/auth.js
node --check server/routes/users.js
node --check server/routes/tables.js
node --check server/routes/orders.js
node --check server/routes/dashboard.js
node --check public/js/main.js
node --check public/js/components/dashboard.js
node --check public/js/components/tables.js
node --check public/js/components/orders.js
node --check public/js/components/users.js
node --check public/service-worker.js
```

Y filtro de seguridad antes del commit:

```powershell
git diff --cached --name-only | Select-String -Pattern "data/restaurant.db|\.env$|certs/|\.pem$|\.key$|rootCA|mundipos-rootCA|node_modules|cookies.txt|data/backups"
```

No debe imprimir nada.

---

# 8. Cierre de v2.2.4.1

La auditoría confirma que la implementación debe ser gradual. La app actual funciona sobre una arquitectura rígida de zonas, pero ya tiene suficientes bases operativas para migrar de forma controlada:

```text
- Sesión Express estable.
- Realtime PC/móvil existente.
- Dashboard operativo consolidado.
- Zonas con operación base.
- Usuarios con rol de sistema básico.
- PWA con estrategia de actualización.
```

La siguiente subfase funcional recomendada es:

```text
v2.2.4.2 · Bootstrap de administrador inicial
```

No se recomienda empezar todavía con rediseño visual de Zonas ni restricciones por usuario, porque primero debe resolverse el flujo de primer administrador y la separación entre desarrollo/producción.
