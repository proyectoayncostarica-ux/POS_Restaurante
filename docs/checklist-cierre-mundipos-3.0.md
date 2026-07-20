# Checklist de cierre · MundiPOS 3.0

**Fase:** v3.7.0 · Pruebas cruzadas y cierre MundiPOS 3.0  
**Estado del documento:** preparado para validación final  
**Regla:** este documento no declara MundiPOS 3.0 publicado ni cerrado por sí solo. El cierre definitivo exige pruebas automáticas completas, validación operativa sobre la base real, staging explícito, commit, push y árbol limpio.

## Contratos de arquitectura que no pueden romperse

- La cuenta global es la única venta financiera.
- Una prefactura es un documento operativo; varias prefacturas no crean varias ventas.
- Payments registra movimientos de Caja y mantiene idempotencia.
- Pagar una prefactura no finaliza el servicio ni libera la mesa.
- Los créditos son cuentas por cobrar ligadas a la misma venta global.
- Los abonos de crédito no vuelven a incrementar la venta.
- La división de cuenta vive en Orders/Accounts; Caja cobra documentos existentes.
- Kitchen conserva estado operativo independiente del estado de impresión.
- Printing persiste trabajos después del documento de negocio y un fallo de dispositivo no revierte el origen.
- Dashboard y reportes son de consulta; no procesan cobros.
- Realtime invalida vistas y la recuperación vuelve a leer estado persistido.
- La finalización explícita del servicio libera mesa y responsables únicamente cuando la integridad lo permite.
- La compatibilidad legacy restante es de datos/migración, no una segunda implementación operativa.

## Matriz mínima de cierre

| Escenario | Cobertura automática principal | Validación operativa final |
|---|---|---|
| Administrador | `capabilityService`, `operationalAccessService`, `serviceFinalization` | Pendiente |
| Cajero exclusivo | `cashUiWorkflow`, `operationalAccessParity` | Pendiente |
| Salonero con capacidad Caja | `operationalAccessService`, `cashUiWorkflow` | Pendiente |
| Bartender con capacidad Caja | `operationalAccessParity`, `cashUiWorkflow` | Pendiente |
| Cuenta normal | `accountService`, `mundiPos3CrossDomain` | Pendiente |
| Cuenta dividida 2 + 1 | `preinvoiceService`, `dashboardFinancialReport`, `mundiPos3CrossDomain` | Pendiente |
| Múltiples líneas y cantidades | `consumptionLines`, `preinvoiceService` | Pendiente |
| Cliente que paga y se retira | `accountContinuity`, `mundiPos3CrossDomain` | Pendiente |
| Consumo agregado después de un pago | `accountContinuity`, `mundiPos3CrossDomain` | Pendiente |
| Saldo temporal cero con mesa abierta | `accountContinuity` | Pendiente |
| Efectivo y vuelto | `paymentMethods`, `paymentService` | Pendiente |
| Tarjeta | `paymentMethods`, `paymentService` | Pendiente |
| Pago mixto | `paymentMethods`, `mundiPos3CrossDomain` | Pendiente |
| Reverso autorizado | `paymentService`, `creditService` | Pendiente |
| Crédito y abonos | `creditService`, `mundiPos3CrossDomain` | Pendiente |
| Impresión fallida y reintento | `printingService`, `mundiPos3CrossDomain` | Pendiente |
| Dos dispositivos emitiendo/cobrando | `idempotency`, `paymentService`, `realtimeRecovery` | Pendiente |
| Finalización y limpieza de responsables | `serviceFinalization`, `mundiPos3CrossDomain` | Pendiente |
| Una venta global con múltiples pagos | `dashboardFinancialReport`, `mundiPos3CrossDomain` | Pendiente |
| Kitchen desacoplado de impresión | `kitchenTraceability`, `mundiPos3CrossDomain` | Pendiente |
| PC y móvil | contratos UI/PWA y revisión manual | Pendiente |

## Comandos de validación previstos

Las validaciones deben ejecutarse en orden sobre cada fase pendiente antes de su commit. Para v3.7.0, como mínimo:

```powershell
npm run test:cross-domain
npm run test:closure
npm test
npm start
```

La validación operativa debe comprobar la base real `data/restaurant.db` sin copiarla, restaurarla ni incluirla en Git.

## Criterio de cierre definitivo

MundiPOS 3.0 se considera cerrado únicamente cuando todos estos puntos estén confirmados:

1. las pruebas específicas de v3.7.0 pasan;
2. la suite completa pasa con `sqlite3@6.0.1`;
3. el servidor inicia y migra correctamente la base operativa real;
4. la matriz manual crítica se valida en PC y móvil;
5. no existen errores de conciliación entre ventas globales y movimientos de Caja;
6. Kitchen y Printing mantienen estados desacoplados;
7. no reaparecen rutas monetarias legacy ni una segunda API de Créditos;
8. el staging contiene únicamente los archivos esperados;
9. el commit de v3.7.0 se publica en `main` sin force-push;
10. `main = origin/main`, divergencia `0 0` y árbol limpio.

## Estado de V4

La definición funcional y contractual de MundiPOS V4 permanece deliberadamente abierta. No se debe crear un roadmap V4 canónico hasta completar y publicar los diez criterios anteriores.
