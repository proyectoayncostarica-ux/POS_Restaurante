# Auditoría v3.0.0 · Arquitectura modular de Cuentas, Pagos, Comandas e Impresiones

## 1. Propósito

Esta auditoría verifica si el código actual de MundiPOS permite separar internamente las responsabilidades de:

- Cuentas y pedidos;
- cobros y registro de pagos;
- división de cuentas;
- comandas y flujo de cocina/bar;
- impresión de comandas, recibos, créditos y reportes;
- configuración de impresoras.

La separación debe realizarse sin alterar el flujo visible que ya conoce el usuario. El botón **Pagar** debe seguir apareciendo en el mismo lugar y cumplir la misma función operativa; internamente delegará el proceso al nuevo dominio de Pagos. La configuración de impresoras permanecerá como una pestaña de **Configuración**, no como módulo principal de navegación.

## 2. Fuente revisada y límite de la auditoría

La revisión se realizó sobre el estado reconstruido con los archivos entregados hasta:

- `v2.2.5M.13 · Imágenes por presentación y producto`;
- `v2.2.5.0 · Auditoría técnica post-Menú del módulo Cuentas / Orders`.

Se revisaron principalmente:

- `public/js/components/orders.js`;
- `public/js/components/accounts.js`;
- `public/js/components/dashboard.js`;
- `public/js/components/settings.js`;
- `public/js/main.js`;
- `server/routes/orders.js`;
- `server/routes/accounts.js`;
- `server/routes/credits.js`;
- `server/routes/settings.js`;
- `server/routes/tables.js`;
- `server/utils/realtime.js`;
- `server/db/database.js`;
- `server/app.js`;
- `package.json`.

La auditoría fue estática. Se validó sintaxis con `node --check` sobre los 21 archivos JavaScript de `server/` y `public/js/`. No se ejecutaron pruebas end-to-end contra el repositorio vivo ni impresoras físicas.

## 3. Conclusión ejecutiva

**El alcance es viable con el código actual**, pero debe implementarse de forma incremental y con adaptadores de compatibilidad. No es seguro trasladar toda la lógica de una sola vez.

La base actual ofrece puntos favorables:

1. Express ya monta rutas independientes por dominio.
2. El frontend usa objetos globales por componente, por lo que pueden agregarse servicios internos sin crear nuevas pantallas de navegación.
3. SQLite ya cuenta con migraciones mediante `ensureColumn()` y el proyecto ya usa transacciones en el importador de Menú.
4. `Utils.showModal()` permite conservar la experiencia visual mientras cambia el controlador interno.
5. Configuración ya tiene vistas internas y puede incorporar una pestaña `Impresoras`.
6. Realtime ya centraliza mutaciones y puede extenderse a pagos, comandas e impresión.
7. Menú ya entrega a Cuentas un contrato operativo de productos, precios, presentaciones e imágenes.

La principal restricción es que el sistema todavía no cuenta con servicios de dominio, pruebas automatizadas ni un modelo financiero suficiente para pagos parciales, mixtos y divididos.

## 4. Estado arquitectónico actual

### 4.1 Frontend

`public/js/components/orders.js` tiene alrededor de 1.949 líneas y mezcla:

- carga de cuentas y pedidos;
- renderizado de tablas;
- selección de productos;
- carrito temporal;
- creación de pedidos;
- modificación de pedidos;
- cálculo visual de totales;
- modal de pago;
- autorización de crédito;
- cierre de mesa;
- solicitud de impresión;
- comandas;
- interacción con Dashboard.

La lógica visible de pago vive directamente en `Orders`:

- `showPaymentModal()`;
- `processPayment()`;
- `finalizePayment()`;
- `showAdminPasswordModal()`;
- `confirmAdminPassword()`.

Las funciones de impresión siguen siendo placeholders:

- `Orders.printComanda()`;
- `Orders.printReceipt()`.

`public/js/components/accounts.js` repite otra implementación de pago para créditos:

- modal de abono;
- pago completo;
- selección de método;
- impresión de comprobantes mediante funciones placeholder.

`Dashboard.reimprimirFactura()` llama a un endpoint que prepara datos y luego muestra una notificación de impresión, pero no existe una cola o driver de impresión real.

### 4.2 Backend

`server/routes/orders.js` contiene en un mismo archivo:

- validación operativa de productos;
- reglas de servicio;
- consultas;
- creación de pedido;
- agregado de productos;
- edición legacy;
- pago;
- crédito;
- liberación de mesa;
- historial;
- creación de comandas;
- estados de impresión de comanda.

La ruta `POST /api/orders/:id/pay` realiza varias escrituras sucesivas sin transacción única. El mismo problema existe en pagos y abonos de crédito.

`server/routes/accounts.js` y `server/routes/credits.js` administran la misma tabla `cuentas_credito` con endpoints parcialmente duplicados. El frontend actual consume principalmente `/api/accounts`; no se encontraron llamadas frontend activas a `/api/credits`. Esto convierte `credits.js` en candidato legacy o en una API duplicada que debe consolidarse.

### 4.3 Base de datos

El modelo actual incluye:

- `pedidos`;
- `pedido_productos`;
- `pagos`;
- `cuentas_credito`;
- `pagos_creditos`;
- `comandas`;
- `historial_transacciones`.

La tabla `pagos` solo contempla:

- pedido;
- método `efectivo`, `tarjeta` o `credito`;
- monto;
- subtotal y servicio;
- fecha.

No contempla de manera formal:

- usuario que cobra;
- estado del pago;
- efectivo recibido;
- vuelto;
- referencia de tarjeta o transferencia;
- pago mixto;
- idempotencia;
- anulación;
- aplicación del pago a productos, persona o parte de cuenta.

La tabla `pedidos` tampoco conserva:

- total pagado;
- saldo pendiente;
- estado parcialmente pagado;
- bloqueo de cobro concurrente.

`comandas` almacena productos como texto/JSON en `productos_cocina`, utiliza `fecha_impresion` desde la creación y mezcla el estado operativo de la comanda con el hecho de imprimirla.

### 4.4 Seguridad y responsabilidad operativa

El middleware global exige sesión para `/api`, pero `orders.js`, `accounts.js` y `credits.js` no aplican por sí mismos el mismo control de zona y responsabilidad que ya existe en `tables.js`.

La lógica reutilizable de acceso a zona, mesa y responsables está actualmente acoplada a `server/routes/tables.js`. Para v3 debe extraerse a un servicio común antes de permitir cobros o modificaciones de cuenta desde rutas nuevas.

### 4.5 Realtime

`server/utils/realtime.js` reconoce mutaciones de:

- mesas;
- pedidos;
- cuentas;
- créditos;
- reinicio del sistema.

Un nuevo endpoint `/api/payments`, `/api/kitchen` o `/api/printing` no emitiría eventos operativos hasta extender `OPERATIONAL_PREFIXES`, `getScope()` e `inferMutationContext()`.

### 4.6 Pruebas

`package.json` no tiene suite automatizada; el script `test` finaliza con error intencional. En un cambio financiero y transaccional de esta magnitud, la ausencia de pruebas aumenta considerablemente el riesgo.

## 5. Corrección de un hallazgo anterior

La auditoría `v2.2.5.0` señaló una posible colisión entre:

- `GET /api/orders/:id`;
- `GET /api/orders/comandas/pending`.

En el código actual, `/:id` representa un solo segmento y `/comandas/pending` contiene dos segmentos, por lo que Express no debería capturar esa ruta como `/:id` en condiciones normales. Lo mismo aplica a `/summary/stats` frente a `/:id` en Cuentas y Créditos.

Aunque conviene declarar rutas estáticas antes que rutas dinámicas por claridad, **no se considera un bloqueo funcional confirmado**. Esta observación debe sustituir el diagnóstico anterior.

## 6. Riesgos actuales si no se separa de forma ordenada

### Riesgo crítico 1 · Cobros parcialmente escritos

Un pago puede registrar una fila en `pagos` y fallar antes de actualizar el pedido o liberar la mesa. Un crédito puede cambiar el estado del pedido y fallar antes de crear `cuentas_credito`.

**Consecuencia:** dinero registrado de forma inconsistente, mesa ocupada después del cobro o crédito sin cuenta asociada.

### Riesgo crítico 2 · Cobro duplicado

No existe clave de idempotencia ni bloqueo de pago. Un doble clic, reintento de red o dos dispositivos pueden intentar cobrar la misma cuenta casi al mismo tiempo.

**Consecuencia:** pagos duplicados o cierre competitivo de la cuenta.

### Riesgo crítico 3 · Pago dividido incompleto

El backend acepta `productos_divididos` y calcula un monto, pero no registra qué productos o cantidades quedaron cubiertos. El pedido continúa pendiente sin saldo formal ni asignación persistente.

**Consecuencia:** el mismo producto puede cobrarse más de una vez y no existe forma confiable de determinar cuándo cerrar la mesa.

### Riesgo alto 4 · Mezcla de crédito y pago

`credito` figura como método permitido en `pagos`, pero la ruta de Orders lo procesa como traslado a `cuentas_credito`, no como pago efectivo. Además existen dos routers para la misma entidad de crédito.

**Consecuencia:** reportes ambiguos, código duplicado y reglas distintas para el mismo caso.

### Riesgo alto 5 · Liberación incompleta de mesa

Pago y crédito liberan datos de `mesas`, pero no se observa limpieza consistente de `mesa_responsables` dentro de la misma operación transaccional.

**Consecuencia:** responsables residuales, bloqueos de cambio de rol y eventos realtime incorrectos.

### Riesgo alto 6 · Impresión declarada pero no ejecutada

Varias pantallas muestran mensajes como “enviada a impresión” aunque el sistema solo construye texto o devuelve datos.

**Consecuencia:** falsa confirmación al usuario y pérdida silenciosa de comandas o comprobantes.

### Riesgo alto 7 · Comanda ligada a impresión

El modelo actual confunde “comanda creada”, “comanda enviada”, “comanda impresa” y “comanda preparada”.

**Consecuencia:** no se puede distinguir una falla de impresora de un problema operativo de cocina.

### Riesgo alto 8 · Autorización dispersa

Las reglas de zona y responsabilidad no están centralizadas para Orders y futuros Payments.

**Consecuencia:** una nueva ruta podría permitir cobrar o modificar una cuenta fuera del alcance operativo del usuario.

### Riesgo medio 9 · Uso de `REAL` para dinero

Los montos se almacenan como `REAL`, lo que puede introducir diferencias de punto flotante.

**Consecuencia:** centavos residuales y dificultad para cerrar saldos exactos. En Costa Rica normalmente se muestran colones sin fracciones, pero el sistema admite decimales y debe definir una unidad monetaria consistente.

### Riesgo medio 10 · Objetos globales e inline handlers

La UI depende de objetos globales y atributos `onclick` con nombres como `Orders.processPayment()`.

**Consecuencia:** un cambio directo de nombre rompe botones. Por eso la migración debe conservar fachadas compatibles durante varias fases.

## 7. Arquitectura objetivo recomendada

### 7.1 Principio de compatibilidad

La interfaz visible no cambia por la separación interna:

```text
Botón Pagar → Orders.showPaymentModal() → Payments.openOrderPayment()
```

Durante la migración, `Orders.showPaymentModal()` puede mantenerse como una fachada delgada. El usuario sigue pulsando **Pagar**, mientras el controlador real vive en `Payments`.

### 7.2 Frontend propuesto

```text
public/js/services/
├── order-api.js
├── payments.js
├── kitchen.js
├── printing.js
└── operational-access.js

public/js/components/
├── orders.js
├── accounts.js
├── dashboard.js
└── settings.js
```

No se crean opciones nuevas en el sidebar para Pagos ni Impresiones.

Responsabilidades:

- `orders.js`: pantalla, cuenta, pedido, carrito y consumo;
- `payments.js`: modales y estado de cobro, efectivo, tarjeta, vuelto, pagos mixtos y división;
- `kitchen.js`: solicitud y seguimiento de comandas;
- `printing.js`: vista previa, solicitud de impresión y reimpresión;
- `settings.js`: pestaña visual para guardar parámetros de impresoras.

### 7.3 Backend propuesto

```text
server/services/
├── transactionService.js
├── operationalAccessService.js
├── orderService.js
├── paymentService.js
├── creditService.js
├── kitchenService.js
├── printingService.js
└── auditService.js

server/routes/
├── orders.js
├── payments.js
├── accounts.js
├── kitchen.js
└── printing.js
```

Las rutas deben quedar delgadas: validar request, llamar al servicio y devolver respuesta.

### 7.4 Compatibilidad de endpoints

No se deben retirar de inmediato:

- `POST /api/orders/:id/pay`;
- `POST /api/accounts/:id/payment`;
- `POST /api/accounts/:id/pay-full`;
- `POST /api/accounts/:id/reprint`.

Primero deben convertirse en adaptadores que llamen a `paymentService` o `printingService`. Solo después de migrar el frontend y documentar compatibilidad podrán marcarse como legacy.

## 8. Modelo de datos recomendado

### 8.1 Transacciones de pago canónicas

Crear una tabla nueva es más seguro que reconstruir inmediatamente `pagos`, porque la tabla actual exige `pedido_id` y es usada por Dashboard.

Propuesta conceptual:

```text
transacciones_pago
- id
- origen_tipo          pedido | credito
- origen_id
- pedido_id            nullable
- credito_id           nullable
- usuario_id
- metodo_pago
- monto_centavos
- efectivo_recibido_centavos
- vuelto_centavos
- referencia
- estado               pendiente | confirmado | anulado | fallido
- idempotency_key
- creado_en
- confirmado_en
- metadata_json
```

Durante la transición se puede mantener compatibilidad de lectura con `pagos` y `pagos_creditos`, pero debe evitarse una doble escritura indefinida. El roadmap debe incluir migración explícita de Dashboard y reportes a la fuente canónica.

### 8.2 División de cuenta

Para soportar división por persona, producto, cantidad o monto:

```text
divisiones_cuenta
- id
- pedido_id
- tipo
- estado
- cantidad_partes
- creado_por
- creado_en

partes_cuenta
- id
- division_id
- etiqueta
- total_centavos
- pagado_centavos
- estado

parte_items
- parte_id
- pedido_producto_id
- cantidad
- monto_centavos

pago_aplicaciones
- transaccion_pago_id
- parte_id
- pedido_producto_id
- cantidad
- monto_centavos
```

La cantidad de ocupantes de la mesa puede sugerir el número de partes, pero no debe obligar a que cada ocupante pague exactamente una parte.

### 8.3 Comandas

El dominio de cocina debe separar contenido y estado operativo de la impresión:

```text
comandas
- id
- pedido_id
- mesa_id
- destino              cocina | bar | otro
- estado_operativo     pendiente | enviada | preparando | lista | entregada | cancelada
- creada_en
- enviada_en

comanda_items
- id
- comanda_id
- pedido_producto_id
- cantidad
- notas
- estado
```

La impresión debe registrarse en otra tabla.

### 8.4 Trabajos de impresión

```text
trabajos_impresion
- id
- tipo_documento
- referencia_tipo
- referencia_id
- impresora_id
- estado               pendiente | procesando | impreso | fallido | cancelado
- intentos
- solicitado_por
- payload_hash
- error_ultimo
- creado_en
- impreso_en
```

La tabla permite reintentos, reimpresión autorizada y auditoría.

### 8.5 Configuración de impresoras

Una sola clave `impresora` no es suficiente. Se recomienda una estructura para:

- impresora de caja;
- impresora de cocina;
- impresora de bar;
- papel 58/80 mm;
- copias;
- autoimpresión;
- driver;
- estado activo;
- documento asignado.

La UI vive en `Configuración > Impresoras`; el servicio técnico vive separado.

## 9. Estrategia de migración segura

Se recomienda un patrón de sustitución gradual:

1. crear servicios sin cambiar botones;
2. envolver funciones antiguas con fachadas;
3. hacer que rutas antiguas deleguen a servicios nuevos;
4. agregar tablas nuevas sin eliminar las actuales;
5. migrar lecturas de Dashboard/reportes;
6. ejecutar pruebas de regresión;
7. retirar código legacy solo al final.

No debe realizarse un “big bang” que reescriba simultáneamente Orders, pagos, créditos, comandas, Dashboard e impresión.

## 10. Mejoras esperadas

- Cobros atómicos y resistentes a doble clic/reintentos.
- Registro real de efectivo recibido y vuelto.
- Referencias de tarjeta/transferencia.
- Pagos parciales y mixtos persistentes.
- División de cuenta por persona, producto, cantidad o monto.
- Cierre de mesa únicamente cuando el saldo llega a cero.
- Limpieza transaccional de responsables.
- Crédito tratado como dominio financiero, no como método ambiguo.
- Comandas auditables incluso si falla la impresora.
- Cola de impresión con reintentos y estado real.
- Un solo formato de recibo reutilizable por Cuentas, Créditos y Dashboard.
- Configuración de impresoras centralizada en la pestaña existente de Configuración.
- Archivos más pequeños y responsabilidades verificables.
- Pruebas unitarias sobre reglas financieras sin depender del DOM.
- Menor riesgo al agregar nuevos métodos de pago o impresoras.

## 11. Criterios de éxito de v3

La migración v3 se considerará correcta cuando:

- la UI mantenga botones, nombres y flujo operativo reconocible;
- Orders no contenga reglas financieras ni drivers de impresión;
- Payments sea la única fuente de reglas de cobro;
- Kitchen sea la única fuente de estado de comanda;
- Printing sea la única fuente de plantillas, cola y drivers;
- Settings solo administre configuración;
- todas las operaciones financieras sean transaccionales e idempotentes;
- Dashboard y reportes lean la fuente canónica de pagos;
- no existan routers duplicados de créditos;
- existan pruebas automatizadas de los escenarios críticos;
- el código legacy se retire solo después de verificar compatibilidad.
