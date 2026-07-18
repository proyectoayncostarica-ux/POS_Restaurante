# v3.3.0 · Dominio Kitchen / Comandas

## Objetivo

Separar de Orders la decisión sobre el contenido operativo de las comandas. Orders continúa registrando el consumo y solicita el envío; Kitchen consulta SQLite, determina los cambios pendientes por línea y persiste únicamente cantidades nuevas, ajustes o anulaciones.

```text
Orders registra consumo y solicita envío.
Kitchen calcula el contenido operativo.
Printing no controla el estado de preparación.
```

## Alcance implementado

- servicio de dominio `kitchenService`;
- router propio `/api/kitchen`;
- identidad estable mediante `pedido_productos.id`;
- comandas normalizadas con ítems persistentes;
- destinos canónicos `cocina` y `bar`;
- cálculo backend de cantidades enviadas y pendientes;
- ajustes y anulaciones sin reutilizar cantidades;
- observaciones, adicionales y snapshots descriptivos;
- usuario humano que originó cada solicitud o modificación;
- idempotencia por solicitud y serialización transaccional;
- realtime de alcance `comandas` después del commit;
- compatibilidad temporal con rutas y columnas legacy;
- separación entre estado operativo y estado de impresión;
- preservación de comandas aunque se retire una mesa operativa.

No se implementan todavía la cuenta departamental de Cocina ni el tablero visual definitivo. Esos trabajos permanecen en `v3.3.2`. Los estados avanzados y la trazabilidad visual completa permanecen en `v3.3.1`. Printing continúa reservado para `v3.4.x`.

## Modelo de datos

### Productos

`productos` incorpora:

```text
destino_preparacion = ninguno | cocina | bar
```

`es_cocina` se conserva como proyección de compatibilidad. El backend es quien normaliza el destino; el frontend no decide si una categoría permite Cocina.

### Líneas de consumo

`pedido_productos` conserva, junto con la línea canónica:

```text
observacion_snapshot
adicionales_snapshot
usuario_solicitante_id
usuario_solicitante_nombre_snapshot
```

La identidad usada para calcular cantidades es `pedido_productos.id`.

### Comandas

`comandas` conserva las columnas legacy y agrega:

```text
pedido_id
comanda_origen_id
numero_comanda
numero_secuencia
destino
estado_operativo
estado_impresion
usuario_solicitante_id
usuario_solicitante_nombre_snapshot
numero_cuenta_snapshot
mesa_numero_snapshot
mesa_tipo_snapshot
zona_id_snapshot
zona_nombre_snapshot
solicitada_en
enviada_en
clave_idempotencia
solicitud_fingerprint
motivo
origen
version
```

La numeración usa la secuencia independiente:

```text
CMD-########
```

### Ítems e historial mínimo

Se agregan:

```text
comanda_items
historial_comandas
solicitudes_kitchen
```

`comanda_items` registra el delta y su semántica explícita:

```text
envio
ajuste
anulacion
reenvio
legacy
```

Una reducción no se interpreta como cantidad negativa sin contexto. Se persiste como `anulacion` con cantidad absoluta y resultado esperado. Los reenvíos se identifican a nivel de comanda mediante `comanda_origen_id` y el evento de historial; sus ítems conservan la instrucción original para no convertir una anulación o ajuste en un envío nuevo.

## Migración

La migración es idempotente y preserva el modelo anterior:

- no elimina `productos_cocina`;
- no elimina `fecha_impresion`;
- no elimina `estado`;
- conserva comandas antiguas como `origen = legacy`;
- traduce `estado = impresa` a `estado_impresion = impresa` sin afirmar que la preparación esté completada;
- reconstruye tablas legacy sin descartar observaciones, adicionales, solicitantes ni snapshots nuevos;
- cambia los vínculos de mesa y cuenta en comandas a `ON DELETE SET NULL` para conservar historial;
- mantiene mesa, zona y cuenta mediante snapshots aunque el vínculo operativo desaparezca.

## Servicio de dominio

Archivo:

```text
server/services/kitchenService.js
```

Responsabilidades:

1. cargar la cuenta global abierta;
2. identificar al usuario solicitante;
3. leer líneas de consumo y su versión;
4. leer el historial normalizado de envíos;
5. calcular deltas por línea y destino;
6. agrupar una comanda por destino;
7. reservar `CMD-########` dentro de la transacción;
8. persistir comanda, ítems e historial;
9. guardar el resultado idempotente;
10. devolver IDs y proyección legacy.

`accountService` llama a Kitchen dentro de la misma transacción en:

- creación de cuenta;
- adición de productos;
- sustitución legacy de producto.

## API

Rutas nuevas:

```text
GET  /api/kitchen/pending
GET  /api/kitchen/comandas/:id
POST /api/kitchen/orders/:pedidoId/dispatch
POST /api/kitchen/comandas/:id/resend
PUT  /api/kitchen/comandas/:id/print-state
```

Capacidades:

```text
kitchen.operate
orders.operate
```

Las consultas y acciones respetan zonas operativas. La solicitud manual de envío exige capacidad de Orders y responsabilidad sobre la mesa o privilegio administrativo.

Adaptadores conservados:

```text
GET /api/orders/comandas/pending
PUT /api/orders/comandas/:id/print
```

Ambos delegan en `kitchenService`.

## Realtime

`/api/kitchen` se incorpora como recurso mutable. El scope canónico es:

```text
comandas
```

Puede ser recibido por usuarios autorizados con:

```text
kitchen.operate
orders.operate
```

El filtrado continúa siendo por zona y el evento se publica después de que la respuesta confirma la transacción.

## Menú y Orders

Menú permite seleccionar:

```text
No requiere preparación
Cocina
Bar
```

La regla legacy `permite_cocina` solo restringe el destino Cocina. No bloquea productos de Bar.

Orders captura por línea:

```text
Indicaciones especiales
Adicionales
```

El backend vuelve a cargar producto, precio, presentación y destino. No confía en totales ni en la clasificación enviada por el frontend.

La interfaz deja de afirmar que una impresión física ocurrió. Mientras `v3.4.x` no exista, informa únicamente que la solicitud está disponible para preparación.

## Compatibilidad y no alcance

Se mantienen temporalmente:

```text
productos.es_cocina
comandas.productos_cocina
comandas.fecha_impresion
comandas.estado
comanda_id
requiere_comanda
rutas legacy bajo Orders
```

No se incluye:

- cuenta departamental Cocina;
- tablero visual Kitchen;
- transición completa de estados `en_preparacion`, `lista` y `entregada`;
- historial visual avanzado;
- cola de Printing;
- drivers térmicos;
- configuración de impresoras;
- limpieza total de legacy.

## Pruebas

Pruebas específicas:

```text
tests/kitchenMigration.test.js
tests/kitchenService.test.js
tests/kitchenUiWorkflow.test.js
```

Cobertura principal:

1. migración de comandas legacy;
2. preservación de snapshots durante reconstrucciones;
3. conservación de comandas al retirar una mesa;
4. separación de Cocina y Bar;
5. exclusión de productos sin preparación;
6. envío únicamente de cantidades nuevas;
7. cambio de destino con anulación y nuevo envío;
8. idempotencia y conflicto de clave;
9. separación entre impresión y preparación;
10. atribución del usuario que realiza un ajuste;
11. concurrencia sin reutilización de cantidades;
12. sustitución de producto dentro del mismo destino sin perder el snapshot anterior;
13. retiro completo de una línea como anulación total;
14. reinicio idempotente sin permitir que la impresión reescriba el estado operativo;
15. reenvío con vínculo, motivo e instrucciones originales sin alterar el neto enviado;
16. compatibilidad de productos legacy y plantillas con destino de preparación;
17. contratos de UI, rutas, zonas y realtime.

Comando específico:

```powershell
npm run test:kitchen
```

Resultado en el entorno de construcción:

```text
19/19 pruebas específicas de Kitchen aprobadas
124/124 pruebas no nativas aprobadas
77/77 archivos JavaScript/CJS sin errores de sintaxis
```

La prueba `tests/sqliteDriverCompatibility.test.js` contiene dos comprobaciones nativas, pero no pudo cargarse en el entorno de construcción porque el ZIP no incluye `node_modules`. Debe ejecutarse en el repositorio local con `sqlite3@6.0.1` instalado después de aplicar el paquete.

## Versionado

```text
Versión visible: 3.0
package.json: 3.3.0
Seguimiento interno: 3.3.0
Caché PWA: v3.3.0-kitchen-domain
```

## Próxima fase

```text
v3.3.1 · Trazabilidad operativa de comandas
```

No debe iniciarse hasta que `v3.3.0` se aplique, se pruebe con SQLite nativo, se valide operativamente y se publique mediante Git seguro.

## Commit canónico sugerido

```powershell
git commit -m "v3.3.0: separa dominio de Kitchen y comandas"
```
