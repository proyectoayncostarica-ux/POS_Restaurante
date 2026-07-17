# v3.2.2 · Sección visual Caja y modal de cobro

## Estado

Implementada y preparada para validación operativa en Windows, PC y dispositivos móviles PWA.

## Objetivo

Conectar la API de Caja de `v3.2.1` con una interfaz visible para el cajero, manteniendo las reglas aprobadas:

```text
Cuenta global = fuente financiera única
Prefactura = documento operativo por pagador
Pago = movimiento individual de Caja
Pago confirmado ≠ servicio finalizado
```

## Flujo operativo

1. El usuario autorizado abre `Caja` desde el header.
2. Caja carga el resumen, la cola de documentos y los movimientos del día.
3. El cajero busca por documento, cuenta, mesa/banco, zona, cliente, pagador o responsable.
4. La cola agrupa las prefacturas bajo la cuenta global.
5. El cajero selecciona una prefactura.
6. El panel muestra cuenta principal, pagador, ítems, total, pagos y saldo.
7. El cajero pulsa `Cobrar prefactura`.
8. El modal permite registrar un abono o liquidar el saldo.
9. La solicitud utiliza una clave de idempotencia y bloquea el botón mientras se procesa.
10. Caja actualiza resumen, cola, detalle y movimientos.
11. La mesa continúa operativamente abierta.

## Interfaz de Caja

### Resumen

Muestra por separado:

- cuentas y prefacturas pendientes;
- saldo documental visible;
- ventas globales del día;
- movimientos individuales de Caja.

Los dos últimos datos no se suman entre sí porque representan lecturas financieras distintas.

### Cola

La cola agrupa documentos por cuenta global:

```text
CTA-00000015 · Mesa 1 · Salón
Cliente principal: Juan
Responsable: Andrey

PF-00000021 · Pedro · saldo ₡3.000
PF-00000022 · Juan  · saldo ₡2.000
```

Filtros disponibles:

```text
pendiente
emitida
parcial
pagada
anulada
todos
```

### Detalle

El panel de detalle incluye:

- número de prefactura;
- pagador;
- número de cuenta global;
- cliente principal;
- mesa o banco;
- zona;
- responsable;
- estado operativo del servicio;
- ítems y cantidades;
- subtotal, servicio, total y saldo;
- pagos confirmados o anulados;
- acciones autorizadas.

## Modal de cobro

La fase admite:

```text
efectivo simple
tarjeta simple
abono parcial
pago total
```

Validaciones de interfaz:

- monto obligatorio mayor que cero;
- monto no superior al saldo documental;
- método permitido;
- referencia obligatoria para tarjeta;
- bloqueo durante el envío;
- clave `Idempotency-Key` única por intento.

La validación definitiva sigue ejecutándose en `paymentService` dentro de una transacción.

## Retiro del cobro directo

Dashboard deja de abrir `Orders.showPaymentModal` mediante doble clic.

Orders conserva una fachada temporal:

```text
Orders.openInCash(orderId)
→ Navigation.showSection('cash')
→ Cash.focusAccount(orderId)
```

Esto conserva compatibilidad con llamadas antiguas, pero la transacción visible se inicia dentro de Caja.

## Reimpresión

Caja puede solicitar una reimpresión cuando la sesión posee `cash.reprint`.

La solicitud:

- se registra en historial;
- abre una representación imprimible en el navegador;
- no cambia falsamente el estado a impresión física completada;
- permanece pendiente de `v3.4.x · Printing`.

## Realtime

Los eventos de pagos y Caja recargan la vista activa mediante la infraestructura existente. La selección se conserva cuando el documento sigue disponible.

## PWA

El caché cambia a:

```text
v3.2.2-cash-ui
```

Esto obliga a los dispositivos instalados a recuperar:

- `cash.js`;
- `orders.js`;
- `dashboard.js`;
- `style.css`;
- `index.html`.

## Adaptación visual

### PC

- cola y detalle en dos columnas;
- resumen de cuatro indicadores;
- tablas de consumo y movimientos;
- saldo destacado;
- filtros persistentes mientras la sección está abierta.

### Móvil

- indicadores compactos;
- búsqueda táctil;
- cola y detalle apilados;
- desplazamiento automático al detalle;
- modal adaptado al ancho disponible;
- botones de acción a ancho completo.

## Archivos modificados

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/avance-v3.2.2-caja-visual-modal-cobro.md
package.json
package-lock.json
server/config/appInfo.js
public/js/components/cash.js
public/js/components/dashboard.js
public/js/components/orders.js
public/css/style.css
public/index.html
public/service-worker.js
tests/cashUiWorkflow.test.js
```

## Pruebas

### Suite específica

```powershell
npm run test:cash-ui
```

Resultado en el entorno de construcción:

```text
6 aprobadas
0 fallos
```

### Suite funcional

Sin cargar el addon nativo externo de SQLite:

```text
82 pruebas funcionales aprobadas
0 fallos funcionales
```

En Windows, después de `npm ci`, la prueba del driver aporta dos casos adicionales. Resultado esperado:

```text
84 pruebas aprobadas
0 fallos
```

## Validación operativa requerida

1. Iniciar por HTTPS.
2. Entrar con un cajero exclusivo.
3. Confirmar ingreso directo a Caja.
4. Emitir dos prefacturas divididas desde `Ver pedido`.
5. Buscar por pagador y por número de cuenta.
6. Abrir la primera prefactura.
7. Registrar un abono.
8. Confirmar estado parcial y saldo restante.
9. Liquidar el saldo.
10. Confirmar que la mesa continúa ocupada.
11. Agregar consumo nuevo desde atención.
12. Confirmar que no reaparecen ítems ya pagados.
13. Probar tarjeta con referencia.
14. Probar reimpresión.
15. Validar el mismo flujo desde móvil PWA.
16. Confirmar que Dashboard no abre pago directo.

## Límites pendientes

Se implementarán en `v3.2.3`:

- efectivo recibido;
- cálculo de vuelto;
- validación de vuelto negativo;
- pago mixto;
- medios configurables;
- desglose visual de múltiples componentes.

## Commit

```powershell
git commit -m "v3.2.2: agrega Caja visual y modal de cobro"
```
