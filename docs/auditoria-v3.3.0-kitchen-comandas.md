# Auditoría v3.3.0 · Dominio Kitchen / Comandas

## 1. Propósito

Este documento registra la auditoría técnica obligatoria previa a cualquier edición funcional de `v3.3.0` sobre el estado recuperado de MundiPOS `3.2.5`.

La revisión se realizó contrastando el roadmap actualizado con el código real del ZIP `POS_Restaurante_HEAD_v3.2.5_actualizado.zip`.

No se implementaron servicios, rutas, migraciones, pruebas ni cambios de interfaz durante esta auditoría.

---

## 2. Resultado ejecutivo

Kitchen existe actualmente como una función legacy dentro de Orders/Accounts, no como un dominio independiente.

```text
Orders / accountService
        ↓
filtra productos con es_cocina = 1
        ↓
inserta un JSON en comandas
        ↓
frontend pregunta si desea imprimir
        ↓
Orders.printComanda solo muestra una notificación
```

El estado actual permite conservar una lista básica de productos de cocina, pero no puede garantizar:

- identidad estable entre una línea de consumo y un ítem de comanda;
- cálculo de cantidades enviadas y pendientes;
- prevención de duplicados por reintentos o concurrencia;
- separación de destinos cocina/bar;
- observaciones y adicionales persistentes;
- atribución del pedido al usuario humano que agregó cada producto;
- modificaciones y anulaciones consistentes;
- recuperación mediante un read model canónico;
- independencia entre preparación e impresión.

La conclusión es que `v3.3.0` debe comenzar por el modelo y el servicio de dominio. La cuenta departamental y la pantalla visual permanecen correctamente reservadas para `v3.3.2`, aunque `v3.3.0` debe persistir desde ahora todos los datos que esa pantalla necesitará.

---

## 3. Archivos inspeccionados

### Backend principal

```text
server/db/database.js
server/services/accountService.js
server/services/transactionService.js
server/services/operationalAccessService.js
server/services/capabilityService.js
server/security/capabilities.js
server/routes/orders.js
server/routes/menu.js
server/routes/auth.js
server/routes/users.js
server/routes/tables.js
server/routes/settings.js
server/utils/realtime.js
server/app.js
```

### Frontend principal

```text
public/index.html
public/js/main.js
public/js/services/operational-access.js
public/js/components/orders.js
public/js/components/menu.js
public/css/style.css
public/service-worker.js
```

### Documentación y pruebas

```text
docs/PROMPT-CONTINUIDAD-MUNDIPOS-3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/auditoria-v3.0.0-arquitectura-modular.md
docs/auditoria-v2.2.5.0-modulo-cuentas-orders.md
docs/roadmap-v2.2.5-normalizacion-cuentas.md
docs/roadmap-v2.2.5M-normalizacion-menu.md
tests/*.test.js
tests/fixtures/baseFixture.js
```

No se encontró un archivo `kitchenService.js`, un router `/api/kitchen`, un componente visual Kitchen ni pruebas específicas de Kitchen/comandas.

---

## 4. Modelo de datos actual

### 4.1 Tabla legacy `comandas`

La tabla actual contiene únicamente:

```text
id
mesa_id
productos_cocina
fecha_impresion
estado
```

`productos_cocina` almacena un arreglo JSON completo.

El estado está limitado por la restricción:

```text
pendiente
impresa
entregada
```

### 4.2 Problemas estructurales

1. No existe `pedido_id` o cuenta global en la comanda.
2. No existe una tabla normalizada de ítems.
3. No se conserva `pedido_productos.id` como identidad de línea.
4. No existe cantidad enviada acumulada por línea.
5. No existe cantidad pendiente de enviar.
6. No existe destino canónico `cocina` o `bar`.
7. No existe usuario solicitante por comanda o ítem.
8. No existe snapshot de mesa, zona o cuenta.
9. No existen observaciones o adicionales.
10. No existen claves de idempotencia ni fingerprint.
11. No existe versión para concurrencia.
12. No existe historial de cambios.
13. `fecha_impresion` se llena al crear la comanda aunque no haya ocurrido una impresión.
14. `estado = impresa` mezcla impresión con operación de preparación.
15. La relación con `mesas` usa `ON DELETE CASCADE`, por lo que el modelo no está diseñado para preservar historia independiente de la mesa.

### 4.3 Líneas de consumo disponibles

`pedido_productos` sí ofrece una base útil para la normalización:

```text
id
pedido_id
producto_id
cantidad
cantidad_asignada
presentacion_id
snapshots de producto y presentación
creado_en
actualizado_en
version
```

La identidad estable que debe usar Kitchen es `pedido_productos.id`.

No debe utilizarse solamente `producto_id`, porque una cuenta puede contener varias líneas del mismo producto con distintas presentaciones, precios, instrucciones o momentos de solicitud.

### 4.4 Combinación actual de líneas

Al agregar productos, `accountService.addProducts()` puede aumentar la cantidad de una línea existente cuando coinciden producto, presentación, precio y política de servicio, siempre que la línea no tenga cantidades asignadas a prefacturas.

Esto permite calcular un delta acumulado por línea, pero crea una nueva obligación para Kitchen:

```text
cantidad actual de la línea
- cantidad efectiva ya enviada a preparación
= diferencia pendiente
```

Las futuras observaciones y adicionales deberán formar parte de la identidad de combinación. Dos hamburguesas con instrucciones distintas no pueden fusionarse en una sola línea.

---

## 5. Flujo actual de creación

### 5.1 Cuenta nueva

`accountService.createAccount()`:

1. valida productos y precios desde SQLite;
2. crea la cuenta global;
3. inserta las líneas en `pedido_productos`;
4. filtra `validatedItems` por `es_cocina === 1`;
5. inserta el arreglo completo en `comandas.productos_cocina`;
6. devuelve `comanda_id` y `requiere_comanda`.

La cuenta, las líneas y la comanda legacy se crean en una misma transacción, lo cual debe preservarse.

### 5.2 Adición de productos

`accountService.addProducts()` repite la misma lógica:

1. agrega o incrementa líneas de consumo;
2. filtra únicamente los productos recibidos en esa solicitud;
3. crea otra fila JSON de `comandas`.

El flujo no consulta cuánto se había enviado anteriormente. Depende de que el frontend no repita la solicitud y de que cada operación llegue una sola vez.

### 5.3 Edición legacy

`replaceLegacyProduct()` modifica directamente una línea de consumo, pero no genera:

- ajuste de Kitchen;
- anulación de la preparación anterior;
- nuevo ítem de comanda;
- vínculo entre antes y después.

Por tanto, consumo y preparación pueden quedar desalineados.

---

## 6. Productos y resolución de destino

### 6.1 Estado actual

La única marca efectiva es:

```text
productos.es_cocina
```

Categorías y subcategorías contienen `permite_cocina`, pero esa propiedad funciona como autorización administrativa para marcar el producto. No define una estación de preparación.

El endpoint `/api/menu/operational-products` proyecta:

```text
es_cocina
requiere_comanda
```

No existe destino `bar` ni otra estación.

### 6.2 Decisión propuesta para v3.3.0

Agregar una propiedad canónica en producto:

```text
destino_preparacion = ninguno | cocina | bar
```

Reglas de compatibilidad:

```text
es_cocina = 1  → backfill inicial destino_preparacion = cocina
es_cocina = 0  → backfill inicial destino_preparacion = ninguno
```

Durante la transición:

- `destino_preparacion` será la fuente canónica;
- `es_cocina` se conservará como compatibilidad legacy;
- el backend validará el destino;
- Orders no enviará el destino como una decisión confiable;
- las presentaciones heredarán inicialmente el destino del producto;
- un override por presentación queda fuera de alcance salvo evidencia operativa posterior.

El término `es_cocina` no debe reinterpretarse como `bar`; su compatibilidad debe mantenerse explícita.

---

## 7. Observaciones, adicionales y pedidos especiales

### 7.1 Ausencia actual

El payload actual de Orders solo contiene:

```json
{
  "producto_id": 1,
  "cantidad": 2,
  "presentacion_id": 3
}
```

No existe captura ni persistencia de:

- observaciones;
- instrucciones especiales;
- adicionales descriptivos;
- exclusiones como `sin salsa`;
- solicitudes como `arroz adicional`.

### 7.2 Requisito para el modelo

Estos datos deben persistirse primero en la línea de consumo o en una entidad operativa estable. No pueden existir únicamente dentro de la comanda ni en memoria del frontend, porque Kitchen debe poder reconstruir la solicitud después de un reinicio.

Propuesta mínima para `pedido_productos`:

```text
observacion_operativa_snapshot TEXT
adicionales_snapshot TEXT/JSON
```

Reglas:

- el backend normaliza longitud y formato;
- las observaciones forman parte de la combinación de líneas;
- el frontend no puede modificar snapshots históricos después del envío sin generar un ajuste;
- Kitchen copia estos valores a `comanda_items`;
- precios o cálculos financieros no deben incorporarse al contenido visual de Kitchen.

---

## 8. Usuario humano solicitante

### 8.1 Información disponible

- La cuenta tiene un usuario creador y responsables.
- `addProducts()` recibe el usuario de la sesión actual.
- El historial general registra quién agregó productos.

### 8.2 Información faltante

La comanda JSON no conserva al usuario que originó la solicitud.

Además, no debe asumirse que el creador original de la cuenta es quien agregó todos los productos posteriores.

### 8.3 Regla propuesta

Cada solicitud o ítem de Kitchen debe conservar:

```text
usuario_solicitante_id
usuario_solicitante_nombre_snapshot
```

El actor corresponde al usuario autenticado que registró ese cambio de consumo.

La futura cuenta departamental de Cocina no reemplazará este dato. En `v3.3.2`, las acciones de preparación se atribuirán a la estación departamental, mientras el solicitante humano permanecerá inmutable.

---

## 9. Impresión y placeholder actual

Después de crear o agregar productos, Orders muestra:

```text
¿Desea imprimir la comanda para cocina?
```

Si el usuario confirma, `Orders.printComanda()` únicamente muestra:

```text
Comanda enviada a cocina
```

No se invoca una API, no se imprime, no se registra un intento y no se actualiza de forma real el estado.

La ruta legacy:

```text
PUT /api/orders/comandas/:id/print
```

solo cambia `estado` a `impresa`.

### Decisión para v3.3.0

- El registro de consumo debe solicitar el envío operativo automáticamente.
- No debe depender de una confirmación de impresión.
- La UI no debe afirmar que imprimió algo que no ocurrió.
- La comanda operativa debe persistir aunque Printing todavía no exista.
- La ruta legacy de impresión debe conservarse solo como adaptador auditado, sin controlar `estado_operativo`.
- La cola definitiva, reintentos y dispositivos permanecen en `v3.4.x`.

---

## 10. Realtime actual

### 10.1 Capacidades existentes

`kitchen.operate` ya existe en backend y frontend.

El scope `comandas` admite usuarios con:

```text
kitchen.operate
orders.operate
```

### 10.2 Problema de creación

Las comandas se crean como efecto interno de:

```text
POST /api/orders
POST /api/orders/:id/products
```

El middleware infiere esas mutaciones como scope `pedidos`, no `comandas`.

Un usuario que solo tenga `kitchen.operate` no recibe un evento `pedidos`, por lo que no puede enterarse en tiempo real de una nueva solicitud.

### 10.3 Cambio requerido

Las respuestas de Orders que creen cambios de Kitchen deberán declarar contexto realtime explícito para `comandas`, incluyendo como mínimo:

```text
comandaIds
orderIds
mesaIds
zoneIds
destinos
```

El scope `comandas` ya permite que usuarios de Orders y Kitchen reciban el evento según autorización. En `v3.3.1` deberá añadirse filtrado exacto por destino y read model.

También debe agregarse `/api/kitchen` a la infraestructura realtime cuando exista el nuevo router.

Realtime se emitirá únicamente después del commit confirmado.

---

## 11. Permisos y navegación

### 11.1 Estado actual

- `kitchen.operate` protege las dos rutas legacy.
- No existe sección `kitchen` en los mapas `SECTION_REQUIREMENTS`.
- No existe destino inicial `kitchen` efectivo.
- `buildOperationalSession()` solo distingue entre `cash` y `dashboard`.
- No existe sección HTML, componente ni carga en `Navigation`.

### 11.2 Separación por subfases

`v3.3.0`:

- conserva la capacidad;
- crea servicios y rutas de dominio;
- garantiza seguridad backend;
- no crea todavía la cuenta departamental ni la pantalla completa.

`v3.3.1`:

- agrega read model, estados e historial;
- prepara realtime y recuperación.

`v3.3.2`:

- añade sección `kitchen`;
- generaliza `destino_inicial`;
- provisiona rol/cuenta departamental;
- restringe navegación y responsabilidades;
- construye UI/UX de monitor, tablet y móvil.

---

## 12. Recuperación después de reiniciar

Las filas legacy se conservan en SQLite y pueden consultarse después de un reinicio. Sin embargo:

- no existe read model normalizado;
- la UI no consume las pendientes;
- el JSON puede depender de estructuras antiguas;
- no existen cantidades efectivas por línea;
- no se pueden reconstruir modificaciones;
- el estado puede representar impresión y no preparación.

`v3.3.0` debe garantizar persistencia canónica. La recuperación visual completa corresponde a `v3.3.1` y `v3.3.2`.

---

## 13. Riesgos de concurrencia e idempotencia

### Riesgo actual

Dos solicitudes simultáneas o un doble clic pueden insertar dos filas de comanda con las mismas cantidades.

### Base técnica disponible

`TransactionService.immediate()` utiliza transacciones SQLite `IMMEDIATE`, lo que permite serializar el cálculo de diferencias si Kitchen trabaja dentro de la misma transacción que el cambio de consumo.

### Reglas propuestas

1. `accountService` persiste el consumo.
2. Dentro de la misma transacción solicita a `kitchenService` calcular el delta.
3. `kitchenService` consulta las cantidades efectivas previamente enviadas por `pedido_producto_id`.
4. Solo inserta diferencias no documentadas.
5. La clave de idempotencia se guarda con fingerprint.
6. Repetir una solicitud idéntica devuelve el resultado anterior o un resultado vacío explícito.
7. Una misma clave con contenido distinto produce conflicto.
8. El commit ocurre antes de realtime.

El frontend no enviará la cantidad pendiente como fuente de verdad.

---

## 14. Modelo canónico propuesto

Los nombres quedan sujetos a la implementación y a las pruebas de migración, pero los conceptos mínimos son los siguientes.

### 14.1 Extensión de `comandas`

```text
id
pedido_id
mesa_id legacy
numero_comanda
destino
estado_operativo
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
version
productos_cocina legacy
fecha_impresion legacy
estado legacy
```

`estado_operativo` será independiente del estado de impresión.

### 14.2 Nueva tabla `comanda_items`

```text
id
comanda_id
pedido_producto_id
producto_id
presentacion_id
cantidad_delta
tipo_cambio
producto_nombre_snapshot
presentacion_nombre_snapshot
presentacion_cantidad_snapshot
observacion_snapshot
adicionales_snapshot
usuario_solicitante_id
usuario_solicitante_nombre_snapshot
creado_en
version
```

`cantidad_delta` puede representar aumentos o reducciones, pero una reducción solo es válida acompañada por un `tipo_cambio` explícito como `anulacion` o `ajuste`. Nunca se interpretará una cantidad negativa sin semántica.

### 14.3 Historial

El historial completo pertenece a `v3.3.1`, pero `v3.3.0` necesita al menos preservar eventos de creación, ajuste, anulación y reenvío sin borrar registros anteriores.

Puede iniciarse una tabla `historial_comandas` en `v3.3.0` con el conjunto mínimo y ampliarse de forma compatible en `v3.3.1`.

### 14.4 Secuencia documental

La numeración de comandas puede reutilizar `secuencias_documentales` con un tipo separado, siempre que no se mezcle con prefacturas ni documentos financieros.

Una comanda sigue siendo un documento operativo, no una venta.

---

## 15. Compatibilidad legacy

### Elementos que deben preservarse temporalmente

```text
comandas.productos_cocina
comandas.fecha_impresion
comandas.estado
GET /api/orders/comandas/pending
PUT /api/orders/comandas/:id/print
respuesta comanda_id / requiere_comanda de Orders
productos.es_cocina
```

### Adaptación segura

- Las nuevas comandas se escribirán en el modelo normalizado.
- El JSON legacy podrá generarse como proyección compatible durante la transición.
- El endpoint pending deberá delegar en `kitchenService` o en el nuevo read model.
- La ruta print solo actualizará compatibilidad de impresión; no preparación.
- No se eliminará ninguna fila histórica.
- No se reescribirán comandas antiguas de manera destructiva.
- Las comandas legacy sin vínculo de línea se marcarán como origen legacy y permanecerán consultables.

La limpieza definitiva se evaluará en `v3.6.0` después de auditar consumidores.

---

## 16. Alcance aprobado propuesto para v3.3.0

### Incluye

1. Migración idempotente de Kitchen.
2. Modelo normalizado de comandas e ítems.
3. `kitchenService` como propietario del cálculo.
4. Delegación desde `accountService` sin duplicar reglas.
5. Identidad mediante `pedido_productos.id`.
6. Delta de cantidades por línea.
7. Destino canónico cocina/bar.
8. Snapshots de producto, presentación, observaciones y adicionales.
9. Usuario humano solicitante.
10. Idempotencia y serialización transaccional.
11. Realtime posterior al commit.
12. Adaptadores legacy.
13. Pruebas de dominio, migración, concurrencia, rutas y realtime.
14. Actualización de documentación y versión técnica a `3.3.0` cuando la fase sea aprobada operativamente.

### No incluye

- cuenta departamental Cocina;
- tablero visual definitivo;
- estados avanzados completos;
- historial visual completo;
- cola de impresión;
- drivers térmicos;
- configuración de impresoras;
- reportes finales;
- política general de sesiones simultáneas;
- limpieza definitiva de legacy.

---

## 17. Diseño de servicio propuesto

Archivo principal:

```text
server/services/kitchenService.js
```

Responsabilidades mínimas:

```text
requestDispatch()
calculatePendingChanges()
resolvePreparationDestination()
createOperationalTickets()
getLegacyPendingAdapter()
markLegacyPrintState()
```

Regla de integración:

```text
accountService registra o modifica consumo.
accountService solicita a kitchenService dentro de la misma transacción.
kitchenService consulta SQLite y decide el contenido.
accountService no filtra ni construye comandas por sí mismo.
```

No debe existir lógica duplicada de cálculo en router o frontend.

---

## 18. Rutas propuestas

### Router nuevo

```text
server/routes/kitchen.js
```

Alcance inicial sugerido:

```text
GET  /api/kitchen/pending
GET  /api/kitchen/comandas/:id
POST /api/kitchen/orders/:pedidoId/dispatch
POST /api/kitchen/comandas/:id/resend
PUT  /api/kitchen/comandas/:id/print-state   adaptador temporal
```

Consideraciones:

- el envío originado por atención requiere `orders.operate`;
- la lectura operativa de Kitchen requiere `kitchen.operate`;
- el reenvío debe exigir motivo y capacidad definida;
- no se utilizará `kitchen.operate` para permitir crear o alterar consumo;
- las rutas legacy de Orders se conservarán como adaptadores temporales.

La forma exacta se cerrará durante la implementación para evitar endpoints redundantes con el envío automático de Orders.

---

## 19. Matriz obligatoria de pruebas

### Dominio

1. `Hamburguesa ×2` genera exactamente dos unidades.
2. Repetir sin cambios no genera otra cantidad.
3. Agregar una unidad genera solo una unidad nueva.
4. Producto sin preparación queda fuera.
5. Presentación conserva nombre y cantidad snapshot.
6. Cocina y bar generan destinos separados.
7. Observación y adicionales quedan congelados.
8. Usuario solicitante corresponde a la sesión que agregó el producto.
9. Dos dispositivos concurrentes no duplican cantidades.
10. Una clave idempotente repetida devuelve replay seguro.
11. Misma clave con fingerprint distinto produce conflicto.
12. Un ajuste conserva antes y después.
13. Una reducción genera anulación explícita.
14. Un reenvío conserva vínculo y motivo.
15. La falta de impresora no afecta la persistencia.

### Migración

1. Base nueva crea todas las estructuras.
2. Base legacy conserva filas JSON.
3. Ejecutar la migración dos veces no duplica ni pierde datos.
4. `es_cocina` se backfillea correctamente a destino.
5. No se modifican cuentas, prefacturas, pagos o créditos.
6. No se eliminan comandas históricas.

### Seguridad y rutas

1. Sin sesión: `401`.
2. Sin capacidad: `403`.
3. `orders.operate` puede solicitar envío de su consumo autorizado.
4. `kitchen.operate` puede consultar pendientes.
5. Kitchen no puede abrir o modificar cuentas.
6. El frontend no puede imponer destino o cantidad pendiente.

### Realtime

1. El evento se emite después del commit.
2. Un usuario solo Kitchen recibe nuevas comandas.
3. Un usuario sin capacidad no las recibe.
4. El contexto incluye zona, mesa, cuenta, comanda y destino.
5. Un rollback no produce evento.

### Regresión

```text
npm run test:domain
npm run test:access
npm run test:accounts
npm run test:lines
npm run test:prefacturas
npm run test:continuity
npm run test:payments
npm run test:credits
npm run test:finalization
npm run test:sqlite-driver
npm test
npm audit --omit=dev
```

La prueba nativa SQLite y `npm audit` deberán ejecutarse en el entorno local con dependencias instaladas.

---

## 20. Archivos previstos para implementación

### Backend

```text
server/db/database.js
server/services/accountService.js
server/services/kitchenService.js
server/routes/orders.js
server/routes/kitchen.js
server/app.js
server/utils/realtime.js
server/services/operationalAccessService.js
server/security/capabilities.js
```

### Menú y captura operativa

```text
server/routes/menu.js
public/js/components/menu.js
public/js/components/orders.js
```

### Pruebas

```text
tests/kitchenMigration.test.js
tests/kitchenService.test.js
tests/kitchenRoutes.test.js
tests/kitchenRealtime.test.js
tests/kitchenLegacyCompatibility.test.js
tests/kitchenOrdersUiContract.test.js
```

### Documentación y PWA

```text
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
docs/avance-v3.3.0-kitchen-comandas.md
docs/PROMPT-CONTINUIDAD-MUNDIPOS-3.0.md
package.json
package-lock.json
public/index.html
public/service-worker.js
```

La lista final dependerá del diff real. No se incluirán bases, respaldos, secretos, certificados ni `node_modules`.

---

## 21. Riesgos de implementación

| Riesgo | Impacto | Mitigación |
|---|---:|---|
| Duplicar cantidades por concurrencia | Alto | Transacción `IMMEDIATE`, cálculo backend e idempotencia |
| Fusionar líneas con observaciones distintas | Alto | Incluir snapshots operativos en identidad de línea |
| Romper consumidores legacy | Alto | Adaptadores y proyección JSON temporal |
| Mezclar impresión con preparación | Alto | `estado_operativo` separado y Printing fuera de alcance |
| Perder solicitante humano | Alto | Snapshot por comanda/ítem desde la sesión |
| Interpretar `es_cocina` como bar | Medio | Campo canónico de destino y backfill explícito |
| Realtime invisible para cuenta Kitchen | Alto | Scope explícito `comandas` y pruebas de paridad |
| Migración destructiva | Alto | Crear/añadir idempotentemente y preservar filas legacy |
| Incrementar demasiado el alcance | Alto | Mantener UI y cuenta departamental en `v3.3.2` |
| Alterar dominios financieros | Crítico | Pruebas cruzadas completas y ninguna dependencia de totales frontend |

---

## 22. Decisiones cerradas por esta auditoría

1. `pedido_productos.id` será la identidad canónica de línea para Kitchen.
2. Kitchen calculará diferencias desde SQLite; el frontend no enviará pendientes confiables.
3. Observaciones y adicionales deben persistirse antes de crear la comanda.
4. El usuario solicitante se conserva por cambio, no solo por cuenta.
5. El destino requiere un campo canónico; `es_cocina` queda como compatibilidad.
6. La creación de comanda debe permanecer en la misma transacción que el consumo.
7. La impresión no podrá controlar `estado_operativo`.
8. Las rutas legacy no se eliminan en `v3.3.0`.
9. La UI visual y la cuenta departamental no se adelantan desde `v3.3.2`.
10. `v3.4.x` permanece exclusivamente dedicado a Printing e impresoras.

---

## 23. Preguntas abiertas no bloqueantes

Estas decisiones pueden cerrarse durante la implementación sin modificar los contratos principales:

1. Nombre final del campo `destino_preparacion`.
2. Si adicionales se almacenan como JSON estructurado o lista normalizada inicialmente.
3. Forma exacta de numeración de comandas.
4. Si el endpoint manual de dispatch será público desde `v3.3.0` o solo un adaptador interno.
5. Estrategia visual temporal para mostrar observaciones en Orders antes del tablero `v3.3.2`.
6. Tratamiento de comandas legacy cuyo JSON no puede vincularse inequívocamente con una línea histórica.

La regla conservadora será preservar esos registros como legacy sin inventar vínculos.

---

## 24. Puerta de entrada a implementación

Antes de editar código debe aprobarse este alcance.

La implementación comenzará por:

```text
1. pruebas de migración fallidas;
2. migración idempotente;
3. kitchenService y pruebas de dominio;
4. delegación desde accountService;
5. rutas y realtime;
6. captura de observaciones/destino;
7. compatibilidad legacy;
8. suite completa;
9. documentación y PWA;
10. ZIP solo con archivos modificados.
```

No se preparará commit ni se avanzará a `v3.3.1` hasta que `v3.3.0` sea verificada operativamente.
