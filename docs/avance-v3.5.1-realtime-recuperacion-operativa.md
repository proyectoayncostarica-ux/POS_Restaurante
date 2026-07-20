# v3.5.1 · Realtime y recuperación operativa

## Objetivo

Coordinar Cuentas, Caja, Dashboard, Zonas, Kitchen y Printing usando realtime como señal de cambio y la base persistida como única fuente de recuperación.

## Contratos implementados

- Cada conexión SSE identifica `serverInstanceId`, `serverTrack` y cursor de eventos.
- Un reinicio del servidor o un hueco de eventos marca la conexión como necesitada de recuperación.
- Tras reconectar, el cliente vuelve a consultar las APIs persistidas de la vista activa; no reconstruye estado financiero u operativo a partir del evento SSE.
- El servidor expone `GET /api/realtime/state` como estado técnico de sincronización.
- Las respuestas API incluyen `X-MundiPOS-Version`; un cliente con build distinto recibe señal `version-obsolete` y debe recargar antes de continuar operando.
- Caja conserva selección y recarga resumen, cola, movimientos y detalle desde backend después de recuperación.
- Kitchen recupera su tablero desde `GET /api/kitchen/board`; los eventos no sustituyen el read model persistido.
- Dashboard vuelve a ejecutar su lectura consolidada cuando está visible o queda marcado como obsoleto cuando está en segundo plano.
- Los cambios de responsables continúan viajando por realtime dirigido, sin agregar polling agresivo.
- Printing emite eventos `printing-change` después de obtener el estado persistido del trabajo; pendiente, fallido o completado siguen siendo estados de la cola, no estados del documento de negocio.

## Recuperación idempotente de cobros

La UI de Caja usa `Utils.requestIdempotent()` para el registro de pagos. Ante una pérdida de red o respuesta 5xx ambigua, repite una sola vez la misma solicitud con la misma `Idempotency-Key`. El backend existente decide si crea el pago o devuelve el replay ya persistido, evitando duplicar movimientos.

Errores 4xx de validación/autorización no se reintentan automáticamente.

## Versionado obsoleto

El cliente envía su build `3.5.1` mediante `X-MundiPOS-Version` y en la conexión SSE. El servidor responde con su `STABILITY_TRACK`. Si difieren, la UI señaliza que debe recargarse y solicita actualización del Service Worker cuando está disponible.

## Printing

Los trabajos generados por documentos transversales emiten un evento de alcance `impresion` con `printingJobIds`, tipo, documento y estado persistido. Los consumidores autorizados pueden refrescar su cola; el evento no modifica pagos, prefacturas, créditos, comandas ni cierres.

## Pruebas incorporadas

- `tests/realtimeRecovery.test.js`
- `tests/paymentRecoveryUi.test.js`

Durante la preparación de la fase se ejecutaron 170 pruebas no nativas con 170 aprobadas. La validación final con `sqlite3@6.0.1`, `restaurant.db` y Git queda pendiente según la dinámica temporal acordada.

## Siguiente fase

`v3.6.0 · Limpieza legacy y orden estructural`, únicamente después de autorización explícita del usuario para continuar escribiendo código.
