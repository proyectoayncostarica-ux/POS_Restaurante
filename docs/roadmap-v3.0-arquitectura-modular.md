# Roadmap v3.0 · Modularización interna de Cuentas, Pagos, Comandas e Impresiones

## Visión

MundiPOS v3.0 conservará la experiencia operativa de la versión actual, pero reorganizará su arquitectura interna para que cada dominio tenga una responsabilidad verificable:

```text
Orders administra consumo y pedidos.
Payments administra cobros y saldos.
Kitchen administra comandas y preparación.
Printing administra documentos y dispositivos.
Settings administra parámetros.
```

Pagos e Impresiones no serán módulos visuales del sidebar. Su interfaz se invocará desde las pantallas actuales.

Este roadmap sustituye la continuación prevista de `docs/roadmap-v2.2.5-normalizacion-cuentas.md`. Ese documento se conserva como historial técnico, pero las nuevas implementaciones deben seguir el versionado y orden de v3.

## Versionado

- **Versión visible:** `3.0`.
- **Versionado técnico:** `v3.x.x`.
- Los cambios mayores de dominio incrementan el segundo número.
- Las subfases incrementan el tercer número.
- Los arreglos derivados usan `fixN` solo cuando corrigen una fase ya probada.

---

## v3.0.0 · Auditoría y contrato arquitectónico

### Objetivo

- verificar viabilidad;
- mapear dependencias actuales;
- documentar riesgos;
- fijar contrato de compatibilidad UI/UX;
- definir roadmap de migración;
- cambiar versión visible a 3.0 e interna a 3.0.0.

### Alcance

Documentación y metadata de versión. No cambia lógica operativa.

### Commit sugerido

```powershell
git commit -m "v3.0.0: documenta arquitectura modular y compatibilidad operativa"
```

---

## v3.0.1 · Infraestructura transaccional y pruebas base

### Objetivo

Crear la base común antes de mover reglas de negocio.

### Cambios

- helper `database.withTransaction()`;
- errores de dominio normalizados;
- utilidades monetarias en unidad entera;
- idempotencia básica para mutaciones críticas;
- pruebas con base SQLite temporal;
- script `npm test` funcional;
- fixtures mínimos de mesa, pedido, producto y usuario.

### Regla

No cambiar botones ni endpoints visibles.

### Commit sugerido

```powershell
git commit -m "v3.0.1: agrega base transaccional y pruebas de dominio"
```

---

## v3.0.2 · Acceso operativo compartido

### Objetivo

Extraer de `tables.js` las reglas de:

- administrador;
- zona permitida;
- responsabilidad de mesa;
- rol de trabajo activo;
- autorización para modificar/cobrar cuenta.

### Resultado

`Orders`, `Payments` y `Kitchen` usan el mismo servicio de acceso.

### Commit sugerido

```powershell
git commit -m "v3.0.2: centraliza acceso operativo por zona y responsabilidad"
```

---

## v3.1.0 · Servicio de dominio de Cuentas / Orders

### Objetivo

Mover del router a `orderService`:

- creación de cuenta/pedido;
- agregado de productos;
- validación de estado;
- totales y servicio;
- historial;
- relación con mesa y responsables.

### Compatibilidad

Se conservan rutas `/api/orders` actuales.

### Commit sugerido

```powershell
git commit -m "v3.1.0: extrae servicio transaccional de Cuentas"
```

---

## v3.1.1 · Descomposición frontend de Orders

### Objetivo

Separar dentro del frontend:

- estado del carrito;
- acceso al catálogo;
- render de cuenta;
- creación/agregado;
- adaptadores de UI.

### Restricción

El flujo visible de crear cuenta y agregar productos no cambia.

### Commit sugerido

```powershell
git commit -m "v3.1.1: desacopla estado y vistas internas de Orders"
```

---

## v3.1.2 · Limpieza de totales y mutaciones de lectura

### Objetivo

- evitar que `GET /orders/:id` escriba totales;
- recalcular solo en mutaciones controladas;
- definir snapshot de precios y servicio;
- retirar edición legacy incompatible con presentaciones o reemplazarla.

### Commit sugerido

```powershell
git commit -m "v3.1.2: normaliza totales y mutaciones de Cuentas"
```

---

## v3.2.0 · Núcleo backend de Payments

### Objetivo

Crear:

- `paymentService`;
- tabla canónica de transacciones de pago;
- estados de pago;
- idempotencia;
- usuario cobrador;
- efectivo recibido, vuelto y referencia;
- adaptador para `POST /orders/:id/pay`.

### Regla

La mesa no se libera hasta que el saldo pendiente sea cero.

### Commit sugerido

```powershell
git commit -m "v3.2.0: crea nucleo transaccional de Payments"
```

---

## v3.2.1 · Servicio frontend de Payments

### Objetivo

Crear `public/js/services/payments.js` y trasladar:

- modal de cobro;
- método de pago;
- autorización de crédito;
- validaciones;
- mensajes;
- estado temporal del cobro.

### Compatibilidad

El botón **Pagar** permanece en Cuentas y puede seguir llamando inicialmente a `Orders.showPaymentModal()` como fachada.

### Commit sugerido

```powershell
git commit -m "v3.2.1: separa flujo frontend de cobro sin cambiar la UI"
```

---

## v3.2.2 · Efectivo, tarjeta y pagos mixtos

### Objetivo

- efectivo recibido;
- cálculo de vuelto;
- referencia/autorización de tarjeta;
- múltiples métodos sobre una misma cuenta;
- saldo actualizado después de cada transacción.

### Commit sugerido

```powershell
git commit -m "v3.2.2: agrega vuelto referencias y pagos mixtos"
```

---

## v3.2.3 · Integración de créditos con Payments

### Objetivo

- consolidar reglas duplicadas de `accounts.js` y `credits.js`;
- mantener la pantalla visual Créditos/Cuentas;
- procesar abonos y pagos completos mediante `paymentService`;
- preservar historial y reportes;
- deprecar el router duplicado solo después de migrar llamadas.

### Commit sugerido

```powershell
git commit -m "v3.2.3: integra creditos al servicio central de Payments"
```

---

## v3.3.0 · Modelo persistente de división de cuenta

### Objetivo

Crear divisiones y partes persistentes para:

- partes iguales;
- persona/ocupante;
- productos y cantidades;
- monto libre.

### Commit sugerido

```powershell
git commit -m "v3.3.0: agrega modelo persistente de division de cuenta"
```

---

## v3.3.1 · UI de pago separado

### Objetivo

Ampliar el modal invocado desde **Pagar** con:

- pago total;
- división sugerida por cantidad de ocupantes;
- asignación por productos;
- división por monto;
- resumen de partes pagadas y pendientes.

### PC y móvil

Mismas capacidades, diseño adaptado; sin nueva navegación.

### Commit sugerido

```powershell
git commit -m "v3.3.1: agrega UI de pago separado desde Cuentas"
```

---

## v3.3.2 · Cierre financiero y liberación integral

### Objetivo

En una sola transacción:

- confirmar último pago;
- cerrar pedido;
- liberar mesa;
- limpiar `mesa_responsables`;
- cerrar divisiones;
- registrar historial;
- emitir realtime.

### Commit sugerido

```powershell
git commit -m "v3.3.2: cierra cuentas y libera mesas de forma integral"
```

---

## v3.4.0 · Dominio de Kitchen / Comandas

### Objetivo

Separar de Orders:

- creación de comanda;
- destinos cocina/bar;
- items nuevos/modificados;
- estados operativos;
- control de reenvíos.

### Compatibilidad

La comanda sigue originándose al guardar productos de cocina desde Cuentas.

### Commit sugerido

```powershell
git commit -m "v3.4.0: separa dominio operativo de comandas"
```

---

## v3.4.1 · Integridad y trazabilidad de comandas

### Objetivo

- tabla de items de comanda;
- evitar duplicados;
- distinguir creación, envío, preparación y entrega;
- pruebas de agregado posterior de productos;
- realtime por destino.

### Commit sugerido

```powershell
git commit -m "v3.4.1: agrega trazabilidad de items y estados de comanda"
```

---

## v3.5.0 · Núcleo de Printing

### Objetivo

Crear:

- `printingService`;
- trabajos de impresión;
- plantillas por tipo de documento;
- estado, intentos y errores;
- interfaz de drivers;
- vista previa/base PDF o navegador.

### Documentos iniciales

- comanda cocina;
- comanda bar;
- precuenta;
- recibo de pago;
- comprobante de crédito;
- reimpresión de venta.

### Commit sugerido

```powershell
git commit -m "v3.5.0: crea nucleo y cola de trabajos de impresion"
```

---

## v3.5.1 · Integración transversal de Printing

### Objetivo

Reemplazar placeholders en:

- Orders;
- Payments;
- Créditos;
- Dashboard;
- Kitchen.

Cada módulo solicita el documento; Printing lo construye y ejecuta.

### Commit sugerido

```powershell
git commit -m "v3.5.1: integra impresion central con modulos operativos"
```

---

## v3.5.2 · Configuración > Impresoras

### Objetivo

Agregar una pestaña interna de Configuración para:

- impresoras de caja/cocina/bar;
- tamaño de papel;
- copias;
- autoimpresión;
- asignación por documento/destino;
- prueba de impresión;
- estado de conexión.

### Restricción

No crear módulo visual de Impresiones en el sidebar.

### Commit sugerido

```powershell
git commit -m "v3.5.2: agrega configuracion interna de impresoras"
```

---

## v3.6.0 · Dashboard y reportes financieros canónicos

### Objetivo

Migrar ventas, métodos de pago, créditos y cierres para leer la fuente canónica de Payments.

### Commit sugerido

```powershell
git commit -m "v3.6.0: migra dashboard y reportes a pagos canonicos"
```

---

## v3.7.0 · Realtime, auditoría y recuperación

### Objetivo

- scopes `pagos`, `comandas` e `impresion`;
- eventos dirigidos por zona/responsable;
- reintentos seguros;
- historial estructurado;
- recuperación de pagos o impresiones pendientes después de reinicio.

### Commit sugerido

```powershell
git commit -m "v3.7.0: integra realtime y recuperacion operativa v3"
```

---

## v3.8.0 · Limpieza legacy y consolidación

### Objetivo

- retirar reglas de pago de Orders/Accounts;
- retirar impresión local de cada componente;
- retirar router de créditos duplicado;
- eliminar funciones huérfanas;
- adelgazar rutas;
- documentar APIs definitivas.

### Condición

Solo después de pruebas completas y búsqueda global de referencias.

### Commit sugerido

```powershell
git commit -m "v3.8.0: elimina legacy de pagos comandas e impresion"
```

---

## v3.9.0 · Pruebas cruzadas y cierre de MundiPOS 3.0

### Matriz mínima

- crear cuenta;
- agregar productos;
- producto con/sin presentación;
- cocina/bar;
- efectivo con vuelto;
- tarjeta con referencia;
- pago mixto;
- crédito y abonos;
- división igual, por persona, productos y monto;
- dos dispositivos intentando cobrar;
- cierre y liberación de mesa;
- falla/reintento de impresora;
- reimpresión;
- PC/móvil;
- permisos y responsabilidad;
- realtime;
- backup/restauración.

### Commit sugerido

```powershell
git commit -m "v3.9.0: cierra migracion modular de MundiPOS 3.0"
```

## Orden obligatorio

No iniciar Payments antes de contar con:

1. transacciones;
2. pruebas base;
3. acceso operativo compartido;
4. servicio de Orders estable.

No iniciar impresión física antes de separar Kitchen y crear trabajos de impresión.

No eliminar endpoints ni fachadas legacy hasta la fase v3.8.0.
