# Contrato v3.0 · Compatibilidad de UI/UX durante la modularización interna

## Objetivo

Definir qué elementos visibles deben conservarse durante la migración v3 y qué cambios operativos están expresamente aprobados por el nuevo flujo de Caja y prefacturas.

Este documento se complementa con `docs/contrato-v3.0-operacion-caja-prefacturas.md`.

## Regla principal

```text
La arquitectura interna cambia sin obligar al usuario a entender servicios técnicos.
Los cambios visibles solo se realizan cuando mejoran y ordenan el flujo operativo real.
```

## Elementos que se mantienen

### Atención y consumo

- Crear pedido continúa dentro de Cuentas.
- Agregar productos continúa desde Dashboard/Cuentas.
- Ver pedido continúa mostrando consumo, cantidades, precios, subtotal y servicio.
- Las comandas continúan originándose al guardar productos de cocina.
- Los usuarios operativos continúan trabajando con mesa, banco, zona y responsabilidad.

### Créditos

- La pantalla visual Créditos continúa existiendo.
- Abonos y pagos completos conservarán acciones reconocibles.
- Internamente delegarán en Payments.

### Impresión

- No se agrega un módulo principal llamado Impresiones.
- Prefacturas, recibos, facturas, créditos y comandas delegan en Printing.
- Configuración de impresoras vive dentro de Configuración.

## Cambio visible aprobado: Caja

Caja será una sección operativa visible, pero no un servicio técnico expuesto al usuario.

- Se abre con botón **Caja** en el header.
- Solo aparece para usuarios autorizados.
- Un cajero exclusivo entra directamente a Caja.
- Un mesero/bartender con capacidad adicional puede abrir Caja desde el mismo header.
- Payments continúa siendo interno y no aparece como navegación.

## Cambio visible aprobado: separación entre prefactura y cobro

El flujo legacy de cobrar directamente desde Dashboard/Cuentas se reemplaza de forma intencional:

```text
Cuentas emite prefactura.
Caja cobra prefactura.
```

Por lo tanto:

- Dashboard deja de procesar dinero;
- el doble clic oculto de pago debe retirarse;
- Ver pedido incorpora `Cuenta dividida` y `Emitir prefactura`;
- el botón de cobro visible vive en Caja;
- una prefactura pagada no cierra la mesa automáticamente.

Este cambio no contradice la compatibilidad: corrige el flujo operativo y mantiene las acciones en el contexto donde realmente corresponden.

## Fachadas de compatibilidad frontend

Durante la transición pueden conservarse métodos públicos como adaptadores:

```javascript
Orders.showPaymentModal = (orderId) => Cashier.openLegacyOrderAdapter(orderId);
Orders.printComanda = (comandaId) => Printing.printKitchenTicket(comandaId);
Orders.printReceipt = (paymentData) => Printing.printPaymentReceipt(paymentData);
```

Sin embargo, la UI nueva no debe seguir iniciando cobros desde Orders. Las fachadas existen solo para evitar roturas mientras se eliminan handlers legacy.

Para prefacturas:

```javascript
Orders.openPreinvoiceFlow = (orderId) => Preinvoices.open(orderId);
Cashier.open = () => Navigation.showSection('cash');
```

## Compatibilidad backend

Los endpoints actuales pueden mantenerse temporalmente como adaptadores:

```text
POST /api/orders/:id/pay
POST /api/accounts/:id/payment
POST /api/accounts/:id/pay-full
POST /api/accounts/:id/reprint
```

Reglas:

1. no duplican reglas de negocio;
2. delegan en servicios v3;
3. quedan protegidos por capacidades;
4. se documentan como legacy;
5. se retiran después de migrar frontend y pruebas.

Endpoints de dominio previstos:

```text
POST /api/orders/:id/preinvoices
GET  /api/orders/:id/active-consumption
GET  /api/cash/preinvoices
POST /api/payments/preinvoices/:id
POST /api/printing/jobs
POST /api/kitchen/commands
```

Los nombres definitivos deben confirmarse en la fase de contrato API.

## Separación PC y móvil

### PC

- Caja puede abrir una vista amplia de búsqueda, detalle y cobro.
- Ver pedido muestra tabla de ítems, checkbox y selector de cantidad.
- Los botones de emisión y cierre mantienen footer moderno.

### Móvil

- Caja se accede desde el header sin duplicar la barra inferior.
- La lista de prefacturas se adapta a cards o tabla responsive.
- La selección de cantidades usa controles táctiles.
- El minimodal de prefactura mantiene footer visible y scroll interno.
- Móvil ofrece las mismas capacidades autorizadas que PC.

## Cambios visibles permitidos

- botón Caja en header;
- filtro de módulos por permisos;
- checkbox `Cuenta dividida`;
- selector de cantidad por ítem;
- minimodal de nombre, resumen y total;
- estados de prefactura y pago;
- cálculo de efectivo y vuelto;
- referencia de tarjeta;
- pago mixto;
- indicador de impresión pendiente/fallida;
- botón Finalizar servicio.

## Cambios visibles no permitidos

- mostrar Payments o Printing como módulos técnicos;
- permitir que Caja modifique productos consumidos;
- permitir que Dashboard cobre directamente;
- cerrar mesa automáticamente al pagar una prefactura;
- ocultar errores reales de impresión con mensajes falsos de éxito;
- ofrecer controles distintos entre PC y móvil que cambien la capacidad operativa;
- autorizar acciones solo porque el botón está oculto o visible.

## Criterio de aprobación

Cada subfase v3 debe demostrar:

1. **Arquitectura:** la responsabilidad está en el servicio correcto.
2. **Seguridad:** backend valida capacidades y contexto.
3. **Compatibilidad:** el flujo sigue siendo comprensible para el usuario.
4. **Operación:** pagos parciales no alteran indebidamente mesa ni consumo.
5. **Responsive:** PC y móvil ofrecen la misma función con diseño adaptado.
