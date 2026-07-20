# MundiPOS v3.6.0 · Mapa de dependencias activas después de la limpieza legacy

## Propósito

Documentar qué capa es canónica al cerrar la transición arquitectónica previa a `v3.7.0` y distinguir compatibilidad de esquema/historial de compatibilidad de ejecución.

## Regla

```text
Una regla de negocio tiene un solo servicio canónico.
Las rutas traducen HTTP y autorizan.
Realtime solo invalida lecturas.
Printing opera después de persistir el documento.
El frontend navega entre dominios sin reimplementar sus reglas.
```

## Dependencias activas

| Dominio | API activa | Servicio canónico | Frontend principal |
|---|---|---|---|
| Cuenta/consumo | `/api/orders` | `accountService` + `preinvoiceService` + `serviceFinalizationService` | `orders.js` |
| Caja/Payments | `/api/cash` | `paymentService` + `cashReadService` | `cash.js` |
| Créditos | `/api/accounts` | `creditService` + `paymentService` | `accounts.js` / Caja |
| Kitchen | `/api/kitchen` | `kitchenService` | `kitchen.js` |
| Printing | `/api/printing` | `printingService` + `documentPrintingService` | `printing-client.js` |
| Reportes | `/api/dashboard/report` | `dashboardReportService` + `financialReadService` | `dashboard.js` |
| Realtime | `/api/events`, `/api/realtime/state` | `realtime.js` | `main.js` |

## Compatibilidad retirada en v3.6.0

- `POST /api/orders/:id/pay`: retirado. Todo cobro comienza en Caja sobre un documento persistido.
- `/api/credits`: ya no se monta como API pública. Créditos opera mediante `/api/accounts`.
- `accountService.recordLegacyBalancePayment()`: retirado.
- `Orders.showPaymentModal()`, `Orders.processPayment()`, `Orders.finalizePayment()`: retirados.
- `Orders.printComanda()` y `Orders.printReceipt()`: placeholders retirados; Printing es el único flujo documental.
- Clasificación realtime específica de `/api/credits`: retirada junto con la API duplicada.

## Compatibilidad que permanece por preservación histórica

No toda referencia denominada `legacy` puede eliminarse físicamente. Permanecen campos, migraciones y normalizaciones necesarios para leer instalaciones actualizadas desde versiones anteriores, por ejemplo:

- estados históricos de `pedidos`;
- filas antiguas de `pagos` sin todos los vínculos v3;
- columnas heredadas de `comandas` utilizadas durante migraciones idempotentes;
- clave de configuración `impresora` usada únicamente como semilla inicial de Caja.

Estas compatibilidades son de **datos/migración**, no una segunda implementación operativa.

## Frontera frontend

`Orders` conserva `openInCash(orderId)` porque existen botones visibles que abren la cuenta desde la vista de consumo. La navegación transversal se ejecuta en `OrderWorkflow`, que cambia de sección y enfoca la cuenta; no procesa dinero.

## Criterio para v3.7.0

Las pruebas cruzadas deben comprobar que ninguna ruta retirada reaparece como dependencia y que los flujos visibles continúan funcionando mediante sus dominios canónicos.
