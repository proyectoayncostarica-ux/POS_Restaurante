# Contrato v3.0 · Compatibilidad de UI/UX durante la modularización interna

## Objetivo

Definir la regla que debe respetarse durante toda la migración v3: la separación interna de Cuentas, Pagos, Comandas e Impresiones no debe obligar al usuario promedio a aprender un flujo nuevo.

## Regla principal

```text
La interfaz conserva la intención y ubicación de las acciones.
La arquitectura interna cambia quién ejecuta cada acción.
```

## Elementos que se mantienen

### Cuentas / Orders

- El botón visible continúa llamándose **Pagar**.
- El usuario abre el cobro desde la cuenta como lo hace actualmente.
- Crear pedido y agregar productos permanecen dentro de Cuentas.
- La cuenta continúa mostrando consumo, subtotal, servicio y total.

### Créditos

- Los botones de abono y pago completo permanecen en la pantalla actual.
- El usuario no navega a un módulo visual llamado Pagos.

### Impresión

- Reimprimir factura continúa disponible desde Dashboard/detalle de venta.
- Imprimir recibo continúa apareciendo después del pago cuando corresponda.
- La comanda continúa originándose al crear o agregar productos de cocina.
- No se agrega un módulo principal de navegación llamado Impresiones.

### Configuración

- La administración de impresoras vive como pestaña interna de **Configuración**.
- Solo usuarios autorizados pueden modificarla.

## Fachadas de compatibilidad frontend

Durante la transición pueden mantenerse métodos públicos existentes:

```javascript
Orders.showPaymentModal = (orderId) => Payments.openOrderPayment(orderId);
Orders.processPayment = (orderId) => Payments.submitOrderPayment(orderId);
Orders.printComanda = (comandaId) => Printing.printKitchenTicket(comandaId);
Orders.printReceipt = (paymentData) => Printing.printPaymentReceipt(paymentData);
```

Los métodos antiguos dejan de contener reglas de negocio, pero conservan su nombre hasta retirar los `onclick` legacy.

En Créditos:

```javascript
Accounts.showPaymentModal = (accountId) => Payments.openCreditPayment(accountId);
Accounts.processPayment = (accountId) => Payments.submitCreditPayment(accountId);
Accounts.printPaymentReceipt = (data) => Printing.printCreditPaymentReceipt(data);
```

## Compatibilidad backend

Los endpoints actuales se mantienen inicialmente como adaptadores:

```text
POST /api/orders/:id/pay
POST /api/accounts/:id/payment
POST /api/accounts/:id/pay-full
POST /api/accounts/:id/reprint
```

Internamente delegarán a servicios nuevos. No deben duplicar reglas.

Los endpoints nuevos pueden coexistir:

```text
POST /api/payments/order/:id
POST /api/payments/credit/:id
POST /api/printing/jobs
POST /api/kitchen/commands
```

La eliminación de rutas antiguas requiere:

1. migrar todas las llamadas frontend;
2. verificar que no existan llamadas externas;
3. documentar la deprecación;
4. completar pruebas de regresión;
5. realizar commit de limpieza independiente.

## Separación PC y móvil

La modularización no debe introducir navegación nueva en ninguna plataforma.

### PC

- Se conservan botones y modales en las pantallas actuales.
- Configuración puede mostrar una pestaña amplia de Impresoras.

### Móvil

- Se conserva la barra inferior existente.
- No se agregan accesos superiores duplicados.
- Los modales de pago, división e impresión deben usar footer visible y scroll interno.
- Los controles de cobro deben ser táctiles y no depender de hover.

## Cambios visibles permitidos

Se permiten mejoras que no cambien la intención operativa:

- cálculo visible de vuelto;
- campos de referencia de tarjeta;
- indicador de saldo pendiente;
- opciones de división de cuenta;
- estado real de impresión;
- mensajes de error y reintento;
- vista previa del recibo;
- selector de impresora dentro de Configuración.

## Cambios visibles no permitidos sin fase aprobada

- mover Pagar a otro módulo principal;
- crear sidebar Pagos;
- crear sidebar Impresiones;
- retirar botones antes de ofrecer equivalencia;
- cambiar nombres operativos sin justificación;
- obligar al usuario a configurar detalles técnicos durante cada cobro;
- abrir flujos diferentes entre PC y móvil sin conservar las mismas capacidades.

## Criterio de aprobación

Cada subfase v3 debe demostrar dos cosas por separado:

1. **Arquitectura:** la responsabilidad fue trasladada al servicio correcto.
2. **Compatibilidad:** el usuario puede completar el mismo flujo desde la UI existente.
