# Avance v3.6.0 · Limpieza legacy y orden estructural

## Objetivo

Retirar implementaciones de transición que ya no tienen consumidores activos y consolidar las fronteras de dominio antes de las pruebas cruzadas finales de MundiPOS 3.0.

## Cambios realizados

### 1. Orders deja de procesar dinero

Se retira `POST /api/orders/:id/pay` y el método `accountService.recordLegacyBalancePayment()`. Orders continúa administrando consumo, prefacturas y finalización; Caja/Payments conserva toda mutación monetaria.

También se retiran del componente Orders los métodos sin consumidores:

- `showPaymentModal`;
- `processPayment`;
- `finalizePayment`;
- modal de contraseña asociado al cobro legacy;
- `printComanda` placeholder;
- `printReceipt` placeholder.

El acceso visible “Abrir en Caja” permanece, pero delega la navegación transversal a `OrderWorkflow`.

### 2. Accounts y Credits se consolidan

`server/app.js` deja de montar `/api/credits`. La API activa de créditos es `/api/accounts`, respaldada por `creditService` y Payments.

`server/routes/credits.js` queda reducido a un shim de importación hacia `accounts.js`; no contiene una segunda colección de handlers y no se monta públicamente.

### 3. Realtime elimina una rama duplicada

Al desaparecer `/api/credits`, Realtime deja de anunciar esa ruta como prefijo operacional independiente. Las mutaciones financieras de crédito viajan por Accounts/Caja y sus scopes canónicos.

### 4. Orden frontend

Se introduce `public/js/services/order-workflow.js` para la navegación Orders → Caja. Orders conserva el punto de entrada que consumen sus botones, pero ya no conoce la implementación de navegación transversal ni contiene lógica monetaria.

### 5. Compatibilidad histórica protegida

No se eliminan columnas, tablas ni normalizadores necesarios para bases actualizadas desde versiones anteriores. La limpieza distingue entre:

```text
legacy operativo sin consumidor → se retira
compatibilidad de datos/migración → se conserva
```

No se borra historial financiero, operativo, Kitchen ni Printing.

## Contratos preservados

- una cuenta global sigue siendo la única venta real;
- prefacturas no se convierten en ventas independientes;
- pagar no cierra ni libera la mesa;
- Dashboard no cobra;
- Caja/Payments es el único dominio monetario;
- créditos y abonos no duplican ventas;
- Printing ocurre después de persistir;
- realtime no es fuente de verdad;
- Kitchen conserva trazabilidad y estado independiente de impresión.

## Pruebas agregadas

`tests/legacyCleanupContract.test.js` verifica estáticamente que:

- `/api/credits` no está montado;
- Orders no expone pago directo;
- el adaptador de saldo legacy desapareció;
- los placeholders de impresión desaparecieron;
- la navegación a Caja está separada;
- Realtime no conserva el namespace retirado;
- Dashboard permanece sin mutaciones de cobro;
- PWA usa la versión de caché `v3.6.0-legacy-cleanup`.

## Próxima fase

`v3.7.0 · Pruebas cruzadas y cierre MundiPOS 3.0`.

Las verificaciones completas y Git de las fases acumuladas se realizarán posteriormente en orden, según la dinámica temporal acordada con el usuario.
