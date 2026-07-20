# v3.5.0 · Dashboard y reportes financieros consolidados

## Objetivo

Alinear Dashboard y reportes con la cuenta global como única fuente financiera de la venta, sin volver a sumar prefacturas ni pagos como ventas independientes.

## Contratos aplicados

- Una cuenta global conciliada o liquidada a crédito representa una sola venta consolidada.
- Una cuenta dividida continúa siendo una sola venta aunque tenga varias prefacturas y varios pagadores.
- Las prefacturas son documentos operativos y aparecen únicamente como trazabilidad o documentos pendientes.
- Los pagos son movimientos de Caja y se presentan por separado.
- Los cobros posteriores de créditos se separan de los movimientos que liquidaron ventas del período.
- Dashboard permanece en modo consulta y no expone acciones de cobro.
- El responsable financiero/operativo mostrado proviene de la cuenta global; el pagador parcial solo aparece en el detalle documental.

## Backend

Se agrega `server/services/dashboardReportService.js` como capa de lectura consolidada. El servicio combina:

- ventas globales consolidadas;
- movimientos confirmados de Caja;
- consumo activo de cuentas abiertas;
- prefacturas pendientes;
- opciones de filtros.

La ruta `GET /api/dashboard/report` admite rango por fecha y filtros por:

- zona;
- cajero;
- método de pago;
- responsable.

Los filtros de cajero y método seleccionan las cuentas relacionadas sin convertir cada pago en una venta adicional. Los movimientos conservan su propia granularidad por pago.

`FinancialReadService` amplía su lectura para:

- filtrar por responsable;
- filtrar movimientos por cajero y método;
- exponer el detalle de medios de pago;
- reconocer cuentas en estado financiero `credito` dentro de las ventas consolidadas.

## Dashboard

El Dashboard incorpora un panel de consolidado financiero con:

- rango Desde/Hasta;
- filtro de zona;
- filtro de cajero;
- filtro de método;
- filtro de responsable;
- tarjetas de ventas globales, movimientos de Caja, consumo activo, documentos pendientes y diferencia venta/liquidaciones;
- vistas separadas de Ventas, Movimientos, Consumo activo y Documentos pendientes.

Las tablas permiten abrir la cuenta global para trazabilidad, pero no cobrar desde Dashboard.

## Conciliación

El resumen separa:

- `ventas_globales`;
- `movimientos_caja`;
- `movimientos_liquidacion_ventas`;
- `cobros_credito`;
- `diferencia_ventas_vs_liquidaciones`.

Esto evita comparar de forma incorrecta ventas del período con cobros de créditos originados en períodos anteriores.

## Pruebas incorporadas

`tests/dashboardFinancialReport.test.js` cubre:

1. dos prefacturas y dos pagos producen una sola venta global;
2. filtros por cajero o método no multiplican la venta;
3. consumo activo y documentos pendientes no se contabilizan como ventas;
4. Dashboard financiero no implementa cobro directo.

También se actualizan los contratos PWA estáticos a la línea `v3.5.0-dashboard-reports`.

## Estado

Implementación preparada para validación posterior según la dinámica temporal acordada:

```text
pruebas específicas
→ suite completa
→ validación operativa
→ Git seguro
```

La siguiente fase del roadmap es `v3.5.1 · Realtime y recuperación operativa` únicamente después de autorización explícita del usuario para continuar escribiendo código.
