# v3.2.5 · Finalización del servicio y liberación integral

## Objetivo

Separar definitivamente la conciliación financiera del cierre operativo. Una cuenta puede tener saldo cero y continuar abierta mientras los clientes siguen consumiendo. La mesa o banco se libera únicamente cuando el responsable confirma que el servicio terminó.

## Regla operativa

```text
saldo cero ≠ mesa libre
prefactura pagada ≠ servicio finalizado
crédito formalizado ≠ deuda saldada
```

La acción **Finalizar servicio** pertenece al mesero, salonero o bartender responsable. El administrador puede intervenir como excepción operativa.

## Servicio de dominio

Se agrega:

```text
server/services/serviceFinalizationService.js
```

Responsabilidades:

- construir la lectura previa de cierre;
- verificar integridad de consumos y documentos;
- validar responsabilidad operativa;
- controlar versión y concurrencia;
- aplicar idempotencia;
- cerrar la cuenta global;
- liberar la mesa o banco;
- limpiar responsabilidades activas;
- conservar snapshots históricos;
- registrar auditoría.

## API

```text
GET  /api/orders/:id/finalization
POST /api/orders/:id/finalize-service
```

Ambas rutas requieren:

```text
orders.operate
orders.finalize_service
```

La mutación también requiere:

```text
Idempotency-Key
versión vigente de la cuenta
responsabilidad activa sobre la mesa o privilegio administrador
```

## Checklist de cierre

El backend bloquea la operación cuando encuentra:

- unidades disponibles sin prefactura;
- cantidades reservadas sin documento activo;
- prefacturas `emitida` o `parcial`;
- saldo documental pendiente;
- pagos con estado `pendiente`;
- créditos vigentes que no fueron formalizados por Payments;
- saldo global mayor que cero;
- estado financiero distinto de `conciliada` o `credito`.

Las cuentas liquidadas mediante el adaptador legacy y sin prefacturas pueden cerrarse con una advertencia explícita, siempre que el saldo global sea cero y exista un pago confirmado.

## Créditos

Un crédito correctamente formalizado no bloquea la liberación de la mesa.

```text
Cuenta global conciliada por método crédito
→ servicio puede terminar
→ mesa puede liberarse
→ deuda continúa en cartera de Créditos
```

Un crédito sin prefactura, sin pago de apertura o con origen no normalizado bloquea el cierre para evitar perder trazabilidad.

## Transacción

La mutación se ejecuta en modo `IMMEDIATE`:

```text
1. validar idempotencia
2. validar usuario y responsabilidad
3. comprobar versión
4. marcar cuenta como finalizando
5. volver a consultar toda la integridad
6. fijar total y estado financiero
7. cerrar cuenta global
8. registrar quién finalizó y observación
9. liberar mesa/banco
10. limpiar mesa_responsables
11. conservar cuenta_responsables
12. registrar historial
13. guardar idempotencia
14. commit
```

Cualquier error produce rollback completo. La cuenta vuelve a abierta y la mesa permanece ocupada.

## Persistencia

`pedidos` incorpora:

```text
finalizada_por_usuario_id
finalizada_por_nombre_snapshot
observacion_cierre
```

Se conservan:

```text
cliente_principal_snapshot
mesa_numero_snapshot
zona_nombre_snapshot
cuenta_responsables
fecha_cierre
```

La mesa operativa limpia:

```text
estado = libre
cliente_nombre = NULL
fecha_apertura = NULL
cantidad_personas = NULL
hora_estimada = NULL
```

## Interfaz

En **Ver pedido** aparece **Finalizar servicio** para usuarios autorizados.

El minimodal presenta:

- cuenta global;
- mesa o banco;
- cliente principal;
- total global;
- checklist de integridad;
- bloqueos;
- advertencias de crédito;
- observación opcional;
- confirmación expresa de que terminó el servicio.

El botón definitivo es:

```text
Finalizar y liberar
```

## Realtime

Después del commit se publica un cambio de alcance `cuentas` con:

- cuenta global afectada;
- mesa liberada;
- zona;
- contexto necesario para actualizar Dashboard, Zonas, Orders y Caja.

## Compatibilidad

No se elimina ninguna cuenta, prefactura, pago, crédito o línea de consumo. Los datos operativos se limpian únicamente en `mesas` y `mesa_responsables`; la historia permanece vinculada a la cuenta global.

No se implementan todavía cambios en Kitchen ni Printing.

## Pruebas

La suite específica cubre:

1. bloqueo por consumo sin prefacturar;
2. rollback del estado `finalizando`;
3. cierre conciliado y liberación atómica;
4. conservación de responsabilidades históricas;
5. bloqueo de nuevos productos después del cierre;
6. idempotencia;
7. autorización por responsabilidad;
8. cierre con crédito formalizado pendiente en cartera;
9. contrato visual de confirmación explícita.

Resultado funcional:

```text
6 pruebas específicas aprobadas
105 pruebas funcionales aprobadas
0 fallos funcionales
```

La prueba nativa de `sqlite3@6.0.1` se ejecuta en Windows mediante:

```powershell
npm run test:sqlite-driver
```

## Versionado

```text
Versión visible: 3.0
package.json: 3.2.5
Seguimiento interno: 3.2.5
Caché PWA: v3.2.5-service-finalization
```

## Commit

```powershell
git commit -m "v3.2.5: finaliza servicio y libera mesas integralmente"
```
