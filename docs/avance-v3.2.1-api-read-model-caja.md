# Avance v3.2.1 · API y read model operativo de Caja

## Propósito

Exponer el núcleo transaccional de Payments mediante una API específica de Caja, protegida por capacidades y diseñada alrededor de prefacturas. La cuenta global continúa siendo la única fuente financiera de la venta.

Esta subfase no crea todavía el formulario visual completo de cobro. Su objetivo es dejar un contrato backend estable para la bandeja, búsqueda, detalle, cobro, consulta de movimientos, reverso y solicitud auditada de reimpresión.

## Contrato operativo

```text
Cuenta global CTA-########
├── Prefactura PF-######## · Pedro · pendiente/parcial/pagada
│   └── Pagos PG-########
└── Prefactura PF-######## · Juan · pendiente/parcial/pagada
```

Caja trabaja por prefactura. Dashboard y reportes continúan contabilizando una sola venta por cuenta global.

## Servicio nuevo

```text
server/services/cashReadService.js
```

Responsabilidades:

- construir la cola de documentos pendientes;
- agrupar documentos bajo su cuenta global;
- buscar por documento, cuenta, mesa/banco, zona, cliente principal, pagador o responsable;
- entregar el detalle completo de una prefactura con ítems y pagos;
- entregar el contexto de cobro consolidado de una cuenta;
- derivar acciones posibles sin cerrar la mesa;
- auditar solicitudes de reimpresión sin afirmar que una impresora física respondió.

## Endpoints

### Lecturas con `cash.access`

```text
GET /api/cash/summary
GET /api/cash/queue
GET /api/cash/preinvoices/:preinvoiceId
GET /api/cash/preinvoices/:preinvoiceId/payments
GET /api/cash/payments/:paymentId
GET /api/cash/accounts/:id/collection-read
GET /api/cash/accounts/:id/financial-read
GET /api/cash/movements
```

La cola acepta:

```text
estado=pendiente|emitida|parcial|pagada|anulada|todos
buscar=<texto>
limite=<1..200>
desde=<desplazamiento>
```

### Cobro con `cash.collect`

```text
POST /api/cash/preinvoices/:preinvoiceId/payments
```

Cuerpo:

```json
{
  "monto": 3000,
  "metodo_pago": "efectivo",
  "referencia": null
}
```

La solicitud debe incluir una clave estable:

```text
Idempotency-Key: payment:<uuid>
```

La ruta obtiene el cajero desde la sesión. El cliente no puede declarar otro usuario como cajero.

### Reverso con `cash.reverse`

```text
POST /api/cash/payments/:paymentId/void
```

Cuerpo:

```json
{
  "motivo": "Cobro registrado con método incorrecto"
}
```

También requiere `Idempotency-Key`.

### Reimpresión con `cash.reprint`

```text
POST /api/cash/preinvoices/:preinvoiceId/reprint-request
```

Mientras Printing no esté implementado, esta ruta:

- registra el evento en `historial_prefacturas`;
- devuelve el read model imprimible;
- no crea un trabajo de impresión falso;
- no cambia `estado_impresion` a `impresa`;
- indica explícitamente `pendiente_modulo_printing = true`.

## Cola operativa

La respuesta contiene una vista plana y otra agrupada:

```text
data.documentos
 data.cuentas[].documentos
```

Cada documento incluye:

- número de prefactura;
- pagador;
- tipo completa/dividida;
- estado;
- total, pagado y saldo;
- cantidad de pagos confirmados y anulados;
- contexto de cuenta global;
- mesa/banco y zona;
- cliente principal;
- responsable principal;
- indicador de cuenta dividida;
- indicador `puede_cobrar`.

## Read model de prefactura

```text
data.prefactura
 data.cuenta_global
 data.pagos
 data.acciones
 data.integridad
```

La integridad compara el saldo persistido con:

```text
saldo calculado = total prefactura - pagos confirmados
```

Los pagos anulados se conservan en el historial, pero no reducen el saldo.

## Reglas preservadas

```text
prefactura pagada ≠ cuenta operativa cerrada
saldo temporal cero ≠ mesa liberada
pagador parcial ≠ cliente principal de la cuenta global
varios pagos ≠ varias ventas financieras
```

Un pago exitoso devuelve siempre:

```text
mesa_liberada = false
```

La finalización explícita del servicio permanece reservada para `v3.2.5`.

## Seguridad

- `cash.access`: lecturas de Caja;
- `cash.collect`: registrar pagos;
- `cash.reprint`: solicitar reimpresión;
- `cash.reverse`: anular pagos;
- el cajero se toma de `req.session.userId`;
- los errores de dominio conservan HTTP 400/404/409/422;
- errores internos no exponen detalles sensibles;
- realtime publica cambios de Caja y pagos únicamente a sesiones autorizadas.

## Base de datos

No se crean tablas ni columnas nuevas. Se reutilizan:

```text
pedidos
prefacturas
prefactura_items
pagos
pago_componentes
reversos_pago
claves_idempotencia
historial_prefacturas
```

## Pruebas

Se agrega:

```text
tests/cashReadService.test.js
```

Cobertura:

1. dos prefacturas divididas agrupadas bajo una sola cuenta;
2. búsqueda por pagador, documento, cuenta, mesa y zona;
3. detalle con ítems, pagos y cuenta global;
4. pago de una prefactura sin cierre de mesa;
5. cola pendiente actualizada después del pago;
6. solicitud de reimpresión auditada sin impresión ficticia;
7. lectura consolidada de cuenta;
8. contrato de capacidades de los endpoints.

Resultado en el entorno de reconstrucción:

```text
76 pruebas funcionales aprobadas
0 fallos
```

La prueba nativa de `sqlite3@6.0.1` debe ejecutarse en Windows después de `npm ci`. El total esperado de la suite completa es 78 pruebas.

## Versionado

```text
Versión visible: 3.0
package.json: 3.2.1
Seguimiento interno: 3.2.1
Node.js mínimo: 20.17.0
sqlite3: 6.0.1
```

## Archivos de la subfase

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/avance-v3.2.1-api-read-model-caja.md
package.json
package-lock.json
server/config/appInfo.js
server/services/cashReadService.js
server/routes/cash.js
tests/cashReadService.test.js
```

## Commit

```powershell
git commit -m "v3.2.1: agrega API operativa de Caja"
```
