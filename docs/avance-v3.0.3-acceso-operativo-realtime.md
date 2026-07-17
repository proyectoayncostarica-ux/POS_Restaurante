# v3.0.3 · Acceso operativo compartido y realtime por capacidades

## 1. Objetivo

Crear una política operativa única para resolver:

- capacidades efectivas;
- roles activos de la sesión;
- zonas visibles y operables;
- responsabilidad sobre mesas/cuentas;
- secciones autorizadas;
- destino inicial del usuario;
- entrega segura de eventos realtime.

La fase no cambia el flujo visible de atención o Caja. Centraliza las decisiones internas para que Cuentas, prefacturas, Payments, Kitchen y Printing puedan evolucionar sin duplicar reglas de acceso.

## 2. Problema previo

Antes de esta subfase, la aplicación tenía reglas similares distribuidas entre:

- `auth.js`;
- `tables.js`;
- `orders.js`;
- `dashboard.js`;
- `main.js`;
- `realtime.js`;
- componentes visuales individuales.

Esto generaba riesgos:

- frontend y backend podían interpretar permisos de forma distinta;
- un usuario podía ocultar una sección visualmente, pero seguir consultando una ruta no protegida;
- Dashboard y Orders podían aplicar filtros de zona diferentes;
- realtime podía enviar datos de otra zona o módulo;
- cambios de roles/capacidades exigían recargar manualmente;
- cada nuevo dominio podía copiar lógica ya existente.

## 3. Servicio compartido backend

Se agrega:

```text
server/services/operationalAccessService.js
```

Responsabilidades:

- resolver el contexto operativo desde la sesión y la base de datos;
- normalizar capacidades y zonas;
- construir la política que recibe el frontend;
- determinar si una sección puede abrirse;
- determinar si una zona es visible;
- construir filtros SQL de zona;
- verificar responsabilidad sobre una mesa;
- resolver banderas operativas como dividir, emitir prefactura, finalizar servicio o cobrar;
- decidir si un cliente SSE puede recibir un evento.

El contexto puede reutilizarse dentro de la misma solicitud mediante `req.operationalAccess`, evitando consultas repetidas.

## 4. Middleware de capacidades

`requireCapability()` delega la resolución al servicio compartido.

Esto mantiene la regla:

```text
Ocultar un botón no autoriza ni protege una operación.
La autorización final siempre se ejecuta en backend.
```

## 5. Política entregada por sesión

`auth.js` incorpora `acceso_operativo` al usuario autenticado.

Incluye:

- identificador y tipo de usuario;
- condición de administrador;
- capacidades efectivas;
- roles activos;
- zonas efectivas;
- secciones permitidas;
- destino inicial.

El frontend ya no necesita reconstruir toda la política desde nombres de roles o supuestos visuales.

## 6. Rutas operativas normalizadas

### Dashboard

Requiere `orders.operate` y filtra datos mediante las zonas efectivas del contexto compartido.

### Zonas / Mesas

Requiere `orders.operate`. Las operaciones de mesa utilizan la misma regla de zona y responsabilidad que Cuentas.

### Menú

El consumo operativo requiere `orders.operate`. Las mutaciones administrativas conservan además sus protecciones de administrador.

### Cuentas / Orders

- listar cuentas requiere `orders.operate`;
- el listado se limita a zonas autorizadas;
- consultar una cuenta verifica visibilidad;
- crear/agregar/modificar verifica acceso operativo y responsabilidad;
- cobrar continúa protegido por `cash.collect` como adaptador legacy temporal;
- las rutas de comanda requieren `kitchen.operate`.

### Caja

Un usuario con `cash.access` puede abrir Caja sin necesitar zona. Esto no le concede acceso a Dashboard, Zonas o Cuentas.

## 7. Realtime por capacidades

`server/utils/realtime.js` amplía el contexto SSE con:

- capacidades;
- zonas efectivas;
- usuario objetivo;
- mesa/pedido/comanda relacionados;
- alcance funcional del evento.

Los eventos se filtran antes de enviarse.

Ejemplos:

- un salonero de Salón no recibe una modificación de Bar;
- un cajero exclusivo no recibe eventos de mesas;
- un usuario con Caja recibe cambios financieros globales autorizados;
- un cambio de rol puede dirigirse únicamente al usuario afectado;
- el administrador conserva visibilidad total.

Los alcances diferenciados incluyen:

```text
mesas
pedidos
comandas
pagos
caja
menu
usuarios
sesion
estructura
```

## 8. Servicio frontend

Se agrega:

```text
public/js/services/operational-access.js
```

El servicio:

- interpreta `acceso_operativo`;
- controla navegación visible;
- valida la relevancia local de eventos realtime;
- mantiene una política de respaldo compatible para sesiones antiguas durante la transición.

`main.js` delega en este servicio y, ante cambios dirigidos de sesión/usuario/estructura:

1. vuelve a consultar la sesión;
2. actualiza `currentUser`;
3. reconstruye navegación y botón Caja;
4. redirige si la sección actual dejó de estar autorizada;
5. reconecta SSE con el contexto actualizado.

## 9. Paridad frontend/backend

Se agregan pruebas que comparan ambas políticas para:

- autorización de secciones;
- recepción de eventos realtime.

La intención no es convertir el frontend en autoridad, sino detectar regresiones donde la experiencia visual contradiga la decisión backend.

## 10. Cobertura automática

La suite asciende a 21 pruebas aprobadas, incluyendo:

- esquema y servicio de capacidades;
- cajero exclusivo sin zona;
- usuario mixto;
- administrador;
- política única de atención y Caja;
- aislamiento del cajero frente a eventos de mesas;
- filtro realtime entre zonas;
- responsabilidad de mesa;
- paridad frontend/backend;
- transacciones, rollback, savepoints y concurrencia;
- utilidades monetarias e idempotencia.

Comandos:

```powershell
npm test
npm run test:access
```

## 11. Compatibilidad

No se implementa todavía:

- cuenta global canónica v3.1;
- cantidades disponibles;
- prefacturas persistentes;
- división de cuenta;
- Payments por prefactura;
- cierre explícito del servicio.

La ruta legacy de cobro continúa existiendo, pero ya exige `cash.collect`.

## 12. Archivos principales

```text
server/services/operationalAccessService.js
server/middleware/requireCapability.js
server/routes/auth.js
server/routes/dashboard.js
server/routes/tables.js
server/routes/menu.js
server/routes/orders.js
server/routes/users.js
server/utils/realtime.js

public/js/services/operational-access.js
public/js/main.js
public/js/components/cash.js
public/index.html
public/service-worker.js

tests/operationalAccessService.test.js
tests/operationalAccessParity.test.js
```

## 13. Resultado esperado

La aplicación conserva su operación visible, pero toda nueva fase puede consultar una política única para decidir:

```text
quién puede ver
quién puede operar
sobre qué zona o mesa
qué evento puede recibir
qué acción debe bloquear el backend
```

## 14. Versión

```text
Versión visible: 3.0
Package: 3.0.3
Seguimiento interno: 3.0.3
```
