# Roadmap v3.0 · Cuentas, prefacturas, Caja, Pagos, Cocina e Impresiones

## Visión

MundiPOS 3.0 reorganizará internamente la aplicación para reflejar la operación real de un restaurante/bar:

```text
Orders administra consumo y pedidos.
Preinvoices administra prefacturas y cantidades asignadas.
Caja es la interfaz autorizada para cobrar.
Payments administra transacciones y saldos.
Kitchen administra preparación y comandas.
Printing administra documentos y dispositivos.
Settings administra parámetros.
```

La experiencia seguirá siendo coherente con la app actual, pero se aprueba un cambio operativo fundamental:

```text
Dashboard/Cuentas dejan de cobrar dinero.
Cuentas emite prefacturas.
Caja cobra prefacturas.
```

Payments e Impresiones continúan siendo servicios internos. Caja sí será una sección visual, accesible desde el header para usuarios autorizados.

Este roadmap sustituye la continuación de `docs/roadmap-v2.2.5-normalizacion-cuentas.md` y recalibra el roadmap v3 inicial después de la auditoría de Caja y subcuentas.

## Versionado

- **Versión visible:** `3.0`.
- **Versionado técnico:** `v3.x.x`.
- Los cambios mayores de dominio incrementan el segundo número.
- Las subfases incrementan el tercer número.
- Los ajustes de una fase aprobada usan `fixN`.

---

## v3.0.0 · Auditoría y contrato arquitectónico

### Objetivo

- verificar viabilidad de modularización;
- documentar riesgos de pagos, comandas e impresión;
- fijar versión visible 3.0;
- definir contrato inicial de compatibilidad.

### Commit

```powershell
git commit -m "v3.0.0: documenta arquitectura modular y compatibilidad operativa"
```

---

## v3.0.0 fix1 · Auditoría de Caja, prefacturas y subcuentas

### Objetivo

- contrastar código actual con el flujo real acordado;
- definir rol/capacidad Cajero;
- separar prefactura, pago y cierre de mesa;
- documentar división una subcuenta a la vez;
- recalibrar el orden de implementación.

### Alcance

Solo documentación. No cambia lógica operativa ni base de datos.

### Commit

```powershell
git commit -m "v3.0.0 fix1: audita Caja prefacturas y subcuentas"
```

---

## v3.0.1 · Infraestructura transaccional y pruebas base

### Objetivo

Crear la base común antes de modificar dinero o cantidades.

### Cambios

- `database.withTransaction()` con soporte `BEGIN IMMEDIATE`;
- errores de dominio normalizados;
- utilidades monetarias con redondeo determinista;
- idempotencia para mutaciones críticas;
- pruebas con SQLite temporal;
- script `npm test` funcional;
- fixtures de usuario, rol, zona, mesa, pedido, producto y presentación.

### Regla

No cambiar todavía botones ni flujo visible.

### Commit

```powershell
git commit -m "v3.0.1: agrega base transaccional y pruebas de dominio"
```

---

## v3.0.2 · Capacidades, rol Cajero y navegación autorizada

### Objetivo

Separar permisos funcionales del acceso por zona.

### Cambios

- tablas `capacidades` y `rol_trabajo_capacidades`;
- capacidades mínimas de Orders, Caja, Kitchen, Printing y Configuración;
- rol inicial `Cajero` sin obligación de zona;
- usuarios mixtos con rol de atención + Caja;
- sesión operativa capaz de activar roles sin zonas;
- navegación y destino inicial filtrados por capacidades;
- guard backend reutilizable `requireCapability()`.

### Compatibilidad

- administradores conservan acceso completo;
- usuarios actuales mantienen roles/zona;
- Caja todavía puede mostrarse como sección en preparación hasta completar su backend.

### Commit

```powershell
git commit -m "v3.0.2: agrega capacidades y rol operativo de Cajero"
```

---

## v3.0.3 · Acceso operativo compartido y realtime por capacidades

### Objetivo

Extraer de `tables.js` reglas comunes para:

- administrador;
- zona permitida;
- responsabilidad de mesa;
- capacidad de emitir prefactura;
- capacidad de cobrar;
- visibilidad realtime.

### Resultado

Orders, Caja, Payments, Kitchen y Printing usan el mismo servicio de autorización.

### Commit

```powershell
git commit -m "v3.0.3: centraliza acceso operativo y realtime por capacidades"
```

---

## v3.1.0 · Servicio de dominio de Cuentas

### Objetivo

Extraer `orderService` y estabilizar la cuenta principal.

### Cambios

- creación de cuenta/pedido;
- agregado de productos;
- validación de responsabilidad;
- snapshot de precios y servicio;
- historial;
- número de control de cuenta;
- estado operativo y financiero separados;
- rutas actuales convertidas en adaptadores.

### Commit

```powershell
git commit -m "v3.1.0: extrae servicio de dominio de Cuentas"
```

---

## v3.1.1 · Líneas de consumo y cantidades disponibles

### Objetivo

Preparar el consumo para asignación parcial sin perder historial.

### Cambios

- identificar líneas por `pedido_producto_id`;
- impedir edición incompatible de líneas asignadas;
- consolidar solo líneas completamente disponibles;
- cálculo canónico de cantidad consumida, asignada y disponible;
- retirar mutaciones dentro de `GET /orders/:id`;
- reemplazar edición legacy por línea/presentación o deprecarla.

### Commit

```powershell
git commit -m "v3.1.1: normaliza lineas y cantidades de consumo"
```

---

## v3.1.2 · Modelo persistente de prefacturas

### Objetivo

Crear:

- `prefacturas`;
- `prefactura_items`;
- secuencias documentales;
- snapshots de mesa, zona, cliente, responsable e ítems;
- estados de documento e impresión;
- anulación autorizada que devuelve cantidades.

### Regla

La emisión valida cantidades dentro de una transacción con bloqueo de escritura.

### Commit

```powershell
git commit -m "v3.1.2: agrega modelo transaccional de prefacturas"
```

---

## v3.1.3 · División de cuenta una subcuenta a la vez

### Objetivo

Implementar en `Ver pedido`:

- checkbox `Cuenta dividida`;
- checkbox por ítem;
- cantidad seleccionable;
- total parcial;
- botón `Emitir prefactura`;
- minimodal con nombre, resumen, Volver e Imprimir y emitir;
- retorno al consumo restante después de confirmar.

### Flujo normal

Con división desactivada, `Emitir prefactura` toma todo el consumo disponible.

### PC y móvil

Misma capacidad; tabla amplia en PC y controles táctiles/cards en móvil.

### Commit

```powershell
git commit -m "v3.1.3: agrega emision guiada de prefacturas divididas"
```

---

## v3.1.4 · Continuidad de consumo y finalización preparada

### Objetivo

- separar consumo activo, prefacturas pendientes e historial pagado;
- permitir agregar productos después de emitir o pagar subcuentas;
- mantener mesa abierta con saldo temporal cero;
- preparar validación de `Finalizar servicio` sin liberar todavía desde Payments.

### Commit

```powershell
git commit -m "v3.1.4: mantiene cuentas activas tras prefacturas parciales"
```

---

## v3.2.0 · Núcleo backend de Payments por prefactura

### Objetivo

Crear `paymentService` y ampliar el modelo financiero.

### Cambios

- pago aplicado a `prefactura_id`;
- usuario cajero;
- estado de transacción;
- idempotencia;
- total pagado y saldo;
- reverso/anulación autorizada;
- adaptador temporal del endpoint legacy `/orders/:id/pay`.

### Regla

Payments nunca libera la mesa por sí solo.

### Commit

```powershell
git commit -m "v3.2.0: crea Payments transaccional por prefactura"
```

---

## v3.2.1 · API y read model de Caja

### Objetivo

Crear endpoints específicos para Caja:

- prefacturas pendientes;
- búsqueda por documento, cuenta, mesa, zona, cliente o responsable;
- detalle financiero;
- historial de pagos;
- reimpresiones autorizadas.

### Seguridad

Solo usuarios con capacidades de Caja.

### Commit

```powershell
git commit -m "v3.2.1: agrega API operativa de Caja"
```

---

## v3.2.2 · Sección visual Caja y botón del header

### Objetivo

- agregar botón `Caja` al header;
- crear `cash-section`;
- vista de documentos pendientes y pagados;
- abrir cobro por prefactura;
- destino inicial Caja para cajero exclusivo;
- retirar cobro directo de Dashboard;
- convertir handlers legacy de Orders en fachadas o retirarlos gradualmente.

### Navegación

Caja no se agrega como servicio técnico al sidebar; el acceso principal vive en el header. La visibilidad depende de capacidades.

### Commit

```powershell
git commit -m "v3.2.2: agrega modulo visual de Caja desde el header"
```

---

## v3.2.3 · Efectivo, vuelto, tarjeta y pagos mixtos

### Objetivo

- efectivo recibido;
- vuelto;
- referencia/autorización de tarjeta;
- pagos mixtos mediante múltiples transacciones;
- saldo actualizado en tiempo real;
- protección contra doble cobro.

### Commit

```powershell
git commit -m "v3.2.3: agrega vuelto tarjeta y pagos mixtos en Caja"
```

---

## v3.2.4 · Integración de créditos con Payments

### Objetivo

- consolidar `accounts.js` y `credits.js` backend;
- trasladar prefactura a crédito con autorización;
- conservar pantalla Créditos;
- registrar abonos mediante Payments;
- deprecar rutas duplicadas después de migrar frontend.

### Commit

```powershell
git commit -m "v3.2.4: integra creditos con Payments y prefacturas"
```

---

## v3.2.5 · Finalización del servicio y liberación integral

### Objetivo

Implementar acción explícita del responsable:

- validar cantidades sin prefacturar;
- validar prefacturas pendientes;
- validar pagos en proceso;
- cerrar cuenta principal;
- liberar mesa;
- limpiar `mesa_responsables`;
- registrar historial;
- emitir realtime.

### Regla

Saldo cero no libera automáticamente la mesa.

### Commit

```powershell
git commit -m "v3.2.5: finaliza servicio y libera mesas de forma integral"
```

---

## v3.3.0 · Dominio de Kitchen / Comandas

### Objetivo

Separar de Orders:

- creación de comanda;
- destino cocina/bar;
- ítems nuevos, modificados o anulados;
- estados operativos;
- reenvíos y trazabilidad.

### Commit

```powershell
git commit -m "v3.3.0: separa dominio de Kitchen y comandas"
```

---

## v3.3.1 · Seguimiento operativo de comandas

### Objetivo

- pendiente;
- enviada;
- en preparación;
- lista;
- entregada;
- anulada;
- historial por ítem y responsable.

### Commit

```powershell
git commit -m "v3.3.1: agrega trazabilidad operativa de comandas"
```

---

## v3.4.0 · Núcleo de Printing

### Objetivo

Crear:

- `printingService`;
- trabajos de impresión;
- estados e intentos;
- plantillas;
- vista previa;
- adaptador navegador/PDF;
- base para drivers térmicos.

### Regla

Persistir documento antes de imprimir. Un fallo de impresora no duplica la operación de negocio.

### Commit

```powershell
git commit -m "v3.4.0: crea nucleo y cola de Printing"
```

---

## v3.4.1 · Integración transversal de documentos

### Objetivo

Conectar Printing con:

- prefacturas;
- recibos/facturas;
- créditos;
- comandas;
- cierres diarios;
- reimpresiones.

### Commit

```powershell
git commit -m "v3.4.1: integra documentos operativos con Printing"
```

---

## v3.4.2 · Configuración → Impresoras

### Objetivo

Crear pestaña interna para:

- caja;
- cocina;
- bar;
- tamaño de papel;
- copias;
- autoimpresión;
- prueba;
- estado del dispositivo.

### Commit

```powershell
git commit -m "v3.4.2: agrega configuracion central de impresoras"
```

---

## v3.5.0 · Dashboard, saldos y reportes financieros

### Objetivo

- retirar cobro directo del Dashboard;
- mostrar consumo activo pendiente y documentos emitidos;
- separar ventas cobradas de consumo abierto;
- reportar por cajero, método, prefactura, mesa y responsable;
- conservar historial completo de la mesa.

### Commit

```powershell
git commit -m "v3.5.0: normaliza Dashboard y reportes de Caja"
```

---

## v3.5.1 · Realtime y recuperación operativa

### Objetivo

- eventos por capacidades;
- actualización inmediata de Caja y responsables;
- recuperación de pagos/impresiones pendientes;
- reintentos seguros;
- señalización de datos obsoletos.

### Commit

```powershell
git commit -m "v3.5.1: sincroniza Caja prefacturas y cuentas en realtime"
```

---

## v3.6.0 · Limpieza legacy

### Objetivo

- retirar lógica de pago de `orders.js`;
- retirar pago directo de Dashboard;
- consolidar Accounts/Credits;
- retirar endpoints deprecados;
- eliminar placeholders de impresión;
- ordenar servicios, routers y componentes.

### Commit

```powershell
git commit -m "v3.6.0: elimina legacy de pagos comandas e impresion"
```

---

## v3.7.0 · Pruebas cruzadas y cierre MundiPOS 3.0

### Matriz mínima

- cajero exclusivo;
- mesero con capacidad Caja;
- cuenta normal;
- cuenta dividida 2 + 1;
- cliente que paga y se retira;
- nuevos productos después del pago;
- efectivo, tarjeta y mixto;
- crédito;
- impresión fallida y reintento;
- concurrencia entre dos dispositivos;
- cierre final y limpieza de responsables;
- PC y móvil.

### Commit

```powershell
git commit -m "v3.7.0: cierra arquitectura operativa de MundiPOS 3.0"
```

---

## Regla de commits seguros

Antes de cada commit:

```powershell
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
git status --short
```

Agregar únicamente archivos esperados. No usar:

```powershell
git add .
```

Filtro obligatorio:

```powershell
git diff --cached --name-only | Select-String -Pattern "data/restaurant.db|\.env$|certs/|\.pem$|\.key$|rootCA|mundipos-rootCA|node_modules|cookies.txt|data/backups"
```

Si imprime algo, detenerse.

## Criterio final de éxito

MundiPOS 3.0 queda cerrado cuando:

- el personal de atención administra consumo y prefacturas;
- Caja cobra documentos con autorización;
- cantidades no pueden duplicarse;
- pagos no cierran mesas prematuramente;
- el servicio se finaliza explícitamente;
- Kitchen y Printing están desacoplados;
- Configuración administra impresoras sin ejecutar lógica de impresión;
- realtime mantiene coordinados cajero, responsables y Dashboard;
- legacy financiero e impresión dispersa fueron retirados;
- pruebas automáticas y cruzadas están aprobadas.
