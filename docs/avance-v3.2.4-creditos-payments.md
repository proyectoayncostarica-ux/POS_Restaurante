# v3.2.4 · Créditos integrados con Payments

## Objetivo

Integrar el crédito al mismo dominio transaccional usado por Caja y Payments, sin crear ventas paralelas, sin liberar la mesa y sin perder la relación con la prefactura y la cuenta global.

## Regla financiera

La cuenta global continúa siendo la única fuente financiera de la venta:

```text
CTA-######## · venta global
└── PF-######## · documento operativo
    └── CR-######## · saldo trasladado a crédito
        ├── PG-######## · abono de efectivo
        └── PG-######## · abono de tarjeta o mixto
```

Formalizar un crédito crea un movimiento de liquidación de venta con método `credito`, pero ese movimiento no aparece como entrada de efectivo de Caja. Los abonos posteriores usan `naturaleza = cobro_credito`: aparecen como movimientos de Caja, pero no incrementan de nuevo el total pagado de la cuenta global.

## Modelo persistente

`cuentas_credito` incorpora:

- número `CR-########` y secuencia documental;
- vínculos `pedido_id`, `prefactura_id` y `pago_apertura_id`;
- snapshots de cuenta, documento, pagador, cliente principal, mesa, zona y responsables;
- monto original, total abonado y saldo pendiente;
- estados `pendiente`, `parcial`, `saldado` y `anulado`;
- operador y administrador autorizador;
- idempotencia, observación, fechas y versión.

Se agrega `historial_creditos` y se amplía `pagos` con:

```text
credito_id
naturaleza = liquidacion_venta | cobro_credito
```

## Formalización desde Caja

La acción `Trasladar a crédito` está disponible únicamente cuando:

- la prefactura está emitida o parcialmente pagada;
- mantiene saldo pendiente;
- la cuenta global está abierta o finalizando;
- no existe otro crédito activo para el mismo documento;
- el usuario tiene `cash.collect`;
- un administrador autoriza la operación.

El proceso es atómico:

```text
validar autorización
→ validar prefactura y saldo
→ generar CR-########
→ crear crédito
→ generar PG-######## de apertura
→ liquidar la prefactura mediante crédito
→ actualizar cuenta global a estado financiero credito
→ registrar historiales
→ commit
```

Una falla revierte crédito, pago de apertura, numeración, saldos e historiales.

## Abonos

Los abonos admiten:

- efectivo y vuelto;
- tarjeta con referencia;
- pago mixto;
- pago parcial o total;
- idempotencia;
- reverso auditable.

Al saldar la deuda:

```text
credito.estado = saldado
credito.saldo_pendiente = 0
cuenta_global.estado_financiero = conciliada
cuenta_global.estado_operativo = abierta
mesa.estado = ocupada
```

La mesa solo podrá liberarse mediante la finalización explícita implementada en `v3.2.5`.

## Consolidación de rutas

`server/routes/accounts.js` y `server/routes/credits.js` delegan en `creditService`. La creación manual de créditos y la eliminación física quedan bloqueadas.

El flujo anterior de Orders que registraba crédito y liberaba la mesa devuelve:

```text
USE_PREINVOICE_CREDIT_FLOW
```

## Lecturas y reportes

`financialReadService` diferencia:

- venta global;
- liquidación de la prefactura mediante crédito;
- saldo de cartera;
- abonos reales recibidos en Caja.

El pago de apertura a crédito no aparece como ingreso de efectivo. Los abonos sí aparecen como movimientos, pero no duplican la venta.

## Interfaz

Caja muestra:

- botón `Trasladar a crédito`;
- minimodal con contraseña administrativa y observación;
- documento `CR-########` asociado;
- saldo del crédito y estado.

La pantalla visible Créditos:

- elimina `Nuevo Crédito`;
- lista únicamente créditos formalizados;
- muestra cuenta global y prefactura origen;
- permite consultar historial;
- registra abonos por efectivo, tarjeta o mixto;
- no ofrece eliminación física.

## Migración

La migración conserva créditos legacy activos, les asigna número documental y completa los campos canónicos disponibles. No reconstruye relaciones inexistentes ni inventa una prefactura para deudas antiguas.

Los nuevos índices dependientes de columnas migradas se crean después de `ensurePaymentSchema()` y `ensureCreditSchema()`, evitando fallos al abrir bases anteriores.

## Pruebas

Se agregan:

```text
tests/creditService.test.js
tests/creditUiWorkflow.test.js
```

Cobertura específica:

1. formalización autorizada;
2. una sola venta financiera;
3. mesa y servicio abiertos;
4. abono mixto sin duplicación;
5. liquidación total del crédito;
6. autorización inválida y rollback;
7. idempotencia;
8. reverso de abono;
9. bloqueo de creación manual y eliminación física;
10. PWA y contrato visual.

Resultado en el entorno de construcción:

```text
99 pruebas funcionales aprobadas
0 fallos funcionales
```

La prueba del addon nativo `sqlite3@6.0.1` se ejecuta en Windows mediante `npm run test:sqlite-driver`.

## Validación operativa

```powershell
npm ci
npm run test:credits
npm run test:payments
npm run test:cash-api
npm run test:cash-ui
npm run test:sqlite-driver
npm test
npm start
```

Verificar por HTTPS:

```text
https://localhost:3000/POS/
https://192.168.0.2:3000/POS/
```

## Commit

```powershell
git commit -m "v3.2.4: integra creditos con Payments y cuenta global"
```

## Siguiente fase

```text
v3.2.5 · Finalización del servicio y liberación integral
```
