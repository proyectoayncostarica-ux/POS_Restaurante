# Avance v3.4.1 · Integración transversal de documentos con Printing

## Objetivo

Conectar los documentos canónicos de Orders, Caja, Créditos y Kitchen al núcleo persistente de Printing creado en `v3.4.0`, sin mover reglas de negocio, cálculos financieros ni estados operativos al servicio de impresión.

## Contrato central

La secuencia es siempre:

```text
dominio persiste el documento
→ dominio entrega snapshot canónico
→ Printing crea trabajo persistente
→ adaptador procesa el trabajo
→ cada intento queda auditado
```

Un error al crear o procesar un trabajo de impresión no revierte el documento de negocio ya persistido. Los endpoints de mutación conservan el resultado del dominio y exponen el estado del encolado por separado.

## Servicio transversal

Se incorpora `server/services/documentPrintingService.js` como única capa de traducción entre documentos de negocio y Printing.

Tipos integrados:

- `prefactura`: prefactura completa;
- `prefactura_parcial`: prefactura dividida/parcial;
- `recibo_cobro`: pago confirmado de una prefactura;
- `comprobante_credito`: formalización de crédito;
- `abono_credito`: cobro posterior aplicado a un crédito;
- `comanda`: orden de preparación para `cocina` o `bar`;
- `cierre_diario`: snapshot financiero del período solicitado.

Orders, Caja, Créditos y Kitchen no contienen plantillas HTML propias. Solo invocan `documentPrintingService` después de que su operación canónica termina.

## Prefacturas

Al emitir una prefactura desde Orders se crea el trabajo de impresión correspondiente a la copia `1`.

El payload conserva:

- número documental original;
- tipo completa/dividida;
- pagador;
- cliente principal;
- cuenta global;
- mesa/banco y zona;
- responsables snapshot;
- ítems snapshot;
- subtotal;
- servicio;
- total;
- observación;
- emisor.

Repetir una emisión por idempotencia reutiliza el mismo trabajo de copia `1`.

## Recibos y abonos

Después de persistir un pago confirmado:

- una liquidación de prefactura genera `recibo_cobro`;
- un cobro de crédito genera `abono_credito`.

El payload usa exclusivamente el registro persistido de `pagos`, sus componentes y medios de pago. Printing no recalcula montos, vuelto, servicio ni saldos.

## Créditos

Después de formalizar un crédito desde una prefactura se encola `comprobante_credito` usando el mismo `numero_credito` ya persistido.

El comprobante conserva snapshots de cliente, pagador, cuenta, prefactura origen, mesa, zona, responsables, monto original, total abonado, saldo y autorización.

## Kitchen

Las comandas creadas durante:

- apertura de una cuenta;
- adición de productos;
- ajuste/reemplazo de producto;
- solicitud explícita de despacho;
- reenvío operativo;

se entregan a Printing después de ser persistidas por Kitchen.

El tipo documental es siempre `comanda`; el payload conserva `destino` para distinguir `cocina` y `bar`.

El estado operativo de preparación sigue independiente del trabajo de impresión. Una comanda cuyo trabajo falle puede reutilizar el reintento de `v3.4.0` sobre el mismo `trabajo_impresion_id`; no se crea una nueva comanda de negocio por una falla del dispositivo.

## Reimpresión

`PrintingService.enqueueNextCopy()` reserva de forma transaccional el siguiente número de copia para la misma pareja `documento_tipo + documento_id`.

Por tanto:

- la reimpresión conserva `documento_numero`;
- cada copia obtiene un nuevo registro en `trabajos_impresion`;
- cada copia conserva su propio payload fingerprint;
- cada intento de cada copia se audita en `intentos_impresion`;
- un reintento técnico de una copia fallida no crea otra copia.

Caja permite solicitar nuevas copias de prefacturas, recibos y comprobantes de crédito. El adaptador legacy de Dashboard para reimpresión de una cuenta global selecciona el último documento financiero real disponible —pago, crédito o prefactura— en lugar de fabricar un documento sin identidad propia.

## Cierre diario

Se incorpora:

```text
POST /api/printing/documents/daily-close
```

El endpoint construye el snapshot mediante `FinancialReadService.getPeriodSummary()` y lo entrega a Printing sin recalcular ventas ni movimientos de caja.

El identificador del trabajo usa el período `desde/hasta`; repetir exactamente el mismo cierre conserva la identidad de la copia inicial.

## Compatibilidad y seguridad

- No se elimina la compatibilidad legacy de estados de impresión de Kitchen.
- No se cambia el contrato de cuenta global.
- Pagar una prefactura no libera la mesa.
- Formalizar o abonar un crédito no duplica la venta global.
- Printing no actualiza directamente `prefacturas`, `pagos`, `cuentas_credito` ni `comandas`.
- No se incorpora todavía configuración física de impresoras; corresponde a `v3.4.2`.

## Archivos principales

```text
server/services/documentPrintingService.js
server/services/printingService.js
server/services/cashReadService.js
server/services/printingAdapters/browserPdfAdapter.js
server/routes/orders.js
server/routes/cash.js
server/routes/accounts.js
server/routes/credits.js
server/routes/kitchen.js
server/routes/printing.js
public/js/services/printing-client.js
public/js/components/orders.js
public/js/components/cash.js
```

## Pruebas añadidas

`tests/printingDocumentsIntegration.test.js` valida por contrato estático que:

- los tipos documentales viven en el servicio transversal;
- los dominios encolan después de sus mutaciones canónicas;
- no existen plantillas documentales duplicadas en las rutas de Orders, Caja, Créditos o Kitchen;
- Orders y Caja consumen el HTML ya generado por Printing mediante `PrintingClient`;
- la reimpresión reserva una nueva copia;
- el cierre diario usa Printing;
- los reintentos siguen perteneciendo al núcleo de cola.

## Siguiente fase

`v3.4.2 · Configuración → Impresoras`.

Esa fase deberá incorporar la configuración administrativa de dispositivos/destinos y hacer que Printing consuma dicha configuración, sin convertir Printing en un módulo financiero visible ni mover lógica documental a Settings.
