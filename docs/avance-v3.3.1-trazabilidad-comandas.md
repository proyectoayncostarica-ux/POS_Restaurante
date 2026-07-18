# Avance v3.3.1 · Trazabilidad operativa de comandas

## Objetivo

Construir la trazabilidad persistente y el read model operativo de Kitchen sobre el dominio normalizado de `v3.3.0`, manteniendo Printing separado de la preparación.

## Implementación

- Estados operativos: `pendiente`, `enviada`, `en_preparacion`, `lista`, `entregada`, `anulada`.
- Transiciones controladas y versionadas con `expectedVersion`.
- Anulación con motivo obligatorio.
- Timestamps independientes: solicitud, envío, inicio de preparación, lista, entrega y anulación.
- Actor de la última transición conservado como snapshot.
- Nueva tabla `historial_comanda_items` con snapshots `antes_json` y `despues_json`.
- Historial de comanda e ítem consultable desde API.
- Read model `/api/kitchen/board` reconstruido desde SQLite, con minutos transcurridos, prioridad operativa, mesa, zona, solicitante, ítems e historial.
- Recuperación de pendientes después de reiniciar sin memoria de proceso.
- Realtime de comandas con capacidad, zona y soporte opcional de destino `cocina`/`bar`.
- Estados de impresión continúan separados y no alteran preparación.

## Rutas

```text
GET /api/kitchen/board
GET /api/kitchen/comandas/:id/history
PUT /api/kitchen/comandas/:id/state
```

## Migración

La migración es idempotente. Agrega columnas de timestamps, prioridad y actor a `comandas`, crea `historial_comanda_items` y preserva el flujo de reconstrucción legacy corregido por `v3.3.0-fix1`.

No elimina comandas, no borra historial, no modifica la fuente financiera global y no introduce dependencias de Printing.

## Alcance no incluido

- Cuenta departamental Cocina.
- Pantalla visual completa de Kitchen.
- Configuración de impresoras.
- Cola definitiva de Printing.

Estos puntos permanecen en `v3.3.2` y `v3.4.x` según el roadmap.

## Validación prevista

1. Pruebas específicas de migración, estados, read model, historial y realtime.
2. Suite completa.
3. Arranque sobre `data/restaurant.db`.
4. Validación operativa de transiciones y recuperación.
5. Git seguro con staging explícito.
