# Auditoría v3.0.0 fix1 · Caja, prefacturas y subcuentas operativas

## 1. Propósito

Esta auditoría contrasta el código actual de MundiPOS con el flujo operativo acordado para MundiPOS 3.0:

- el personal de atención abre mesas, registra consumo, envía comandas y emite prefacturas;
- la división de cuenta se realiza desde **Ver pedido**, una subcuenta a la vez;
- cada prefactura parcial tiene cliente, ítems, cantidades y número de documento propio;
- Caja localiza y cobra prefacturas, no modifica el consumo;
- una prefactura pagada no cierra automáticamente la mesa;
- la cuenta principal puede seguir recibiendo productos después de pagos parciales o subcuentas pagadas;
- la mesa se libera únicamente cuando el servicio se finaliza expresamente y no existen consumos ni documentos pendientes;
- Pagos, Impresiones y Cocina se separan internamente sin crear módulos visuales innecesarios;
- **Caja sí será una sección visual operativa**, accesible desde el header para usuarios autorizados.

## 2. Fuente revisada

La revisión estática se realizó sobre el estado reconstruido hasta:

- `v2.2.5M.13 · Imágenes por presentación y producto`;
- `v3.0.0 · Auditoría y contrato arquitectónico`.

Archivos principales revisados:

- `server/db/database.js`;
- `server/routes/auth.js`;
- `server/routes/users.js`;
- `server/routes/tables.js`;
- `server/routes/orders.js`;
- `server/routes/accounts.js`;
- `server/routes/credits.js`;
- `server/routes/settings.js`;
- `server/utils/realtime.js`;
- `public/js/main.js`;
- `public/js/components/users.js`;
- `public/js/components/tables.js`;
- `public/js/components/dashboard.js`;
- `public/js/components/orders.js`;
- `public/js/components/accounts.js`;
- `public/js/components/settings.js`.

Se validaron 17 archivos JavaScript con `node --check`, sin errores de sintaxis. La auditoría no ejecutó cobros reales, concurrencia multiusuario ni impresoras físicas.

## 3. Conclusión ejecutiva

**El flujo propuesto es viable con el código actual, pero no puede construirse correctamente como una extensión pequeña del endpoint de pago existente.** Requiere un modelo persistente nuevo para prefacturas, cantidades asignadas, pagos por documento, capacidades de usuario y finalización explícita del servicio.

La base actual puede reutilizar:

1. `pedidos` como cuenta principal asociada a mesa, cliente y responsable;
2. `pedido_productos` como origen del consumo;
3. el modelo dinámico de zonas y responsables;
4. el snapshot actual de precios, presentaciones y servicio;
5. `Utils.showModal()` para conservar una experiencia conocida;
6. realtime como infraestructura extensible;
7. el sistema de roles de trabajo como punto de partida;
8. el futuro servicio Printing para prefacturas, recibos y comandas.

Sin embargo, el modelo actual no distingue adecuadamente:

- consumo total;
- consumo aún disponible para prefacturar;
- consumo reservado en una prefactura emitida;
- consumo pagado;
- saldo financiero por prefactura;
- mesa activa aunque el saldo actual sea cero;
- usuario que atiende frente a usuario que cobra.

## 4. Matriz de contraste: código actual frente al flujo objetivo

| Área | Código actual | Flujo objetivo | Estado |
|---|---|---|---|
| Cuenta principal | Un `pedido` pendiente por mesa | Una cuenta principal abierta que puede recibir consumo durante todo el servicio | Reutilizable con cambios |
| División | `productos_divididos` acepta IDs de filas completas | Selección por ítem y cantidad, una subcuenta a la vez | Incompatible |
| Cantidades parciales | No existe asignación persistente por cantidad | Imperial ×3 puede distribuirse 2 + 1 | Ausente |
| Prefacturas | No existe entidad ni número de documento | Cada subcuenta emitida genera documento independiente | Ausente |
| Cliente de subcuenta | Solo existe cliente general del pedido/mesa | Cada prefactura parcial tiene nombre propio | Ausente |
| Pago parcial | Registra un pago, pero no marca qué productos cubrió | Pago aplicado a una prefactura y sus ítems congelados | Incompatible |
| Consumo activo | Todos los productos continúan visibles o el pedido se cierra | Los ítems ya prefacturados se separan del consumo disponible | Ausente |
| Continuar consumiendo | Pago completo marca pedido pagado y libera mesa | La mesa puede continuar aun después de pagar una subcuenta | Incompatible |
| Cierre de mesa | Pago completo libera automáticamente | Cierre explícito cuando termina el servicio y todo está conciliado | Incompatible |
| Cajero | No existe capacidad ni sección Caja | Usuario exclusivo o rol adicional con acceso a Caja | Ausente |
| Permiso de cobro | Cualquier usuario autenticado puede llamar `/orders/:id/pay` | Solo usuario con capacidad `cash.collect` | Riesgo crítico |
| Dashboard | Doble clic abre pago directo | Dashboard no cobra; conduce a cuenta/prefactura | Debe cambiar |
| Cuentas | Botón Pagar ejecuta cobro | Cuentas emite prefactura; Caja cobra | Debe cambiar |
| Impresión | Placeholders y notificaciones | Trabajo de impresión trazable por documento | Ausente |
| Realtime | Filtrado principalmente por zona/responsables | Caja recibe eventos de prefacturas de todas las zonas autorizadas | Debe extenderse |

## 5. Hallazgos detallados

### 5.1 El modelo actual de usuario no soporta correctamente un cajero exclusivo

`usuarios.tipo` solo acepta:

```text
basico
administrador
```

Esto no es un problema por sí mismo: **no se recomienda agregar `cajero` como tercer tipo de sistema**. La flexibilidad requerida se resuelve mejor mediante un usuario estándar con una capacidad de Caja.

El problema real está en los roles de trabajo actuales:

- todo rol debe tener al menos una zona activa;
- un usuario estándar debe tener al menos un rol con zonas activas;
- `isSelectableWorkRole()` considera seleccionable únicamente un rol con zonas;
- la sesión operativa y realtime deducen acceso exclusivamente desde zonas.

Un cajero exclusivo no debería necesitar operar Salón, Bar o Terraza. Asignarle todas las zonas solo para habilitar Caja mezclaría responsabilidades y podría conceder acceso indebido a mesas.

#### Recomendación

Agregar capacidades independientes del alcance por zona:

```text
cash.access
cash.collect
cash.reprint
orders.operate
orders.split
orders.issue_preinvoice
kitchen.operate
settings.printers
```

Modelo sugerido:

```text
capacidades
rol_trabajo_capacidades
```

El rol `Cajero` podrá existir sin zonas y con capacidades de Caja. Un rol `Salonero` podrá añadir también `cash.access` y `cash.collect` cuando el negocio lo necesite.

### 5.2 La navegación actual no puede mostrar una experiencia exclusiva de Caja

El sidebar es estático y contiene Panel, Zonas, Menú, Cuentas, Créditos, Usuarios y Configuración. La aplicación siempre intenta entrar al Dashboard después del login.

Para un cajero exclusivo se requiere:

- botón **Caja** en el header;
- sección visual `cash-section`;
- navegación filtrada por capacidades;
- destino inicial Caja cuando el usuario no tenga acceso operativo al Dashboard;
- ausencia de accesos a Menú, Zonas, Cuentas o Configuración si no están autorizados.

Para usuarios mixtos, Caja aparecerá como botón del header sin retirar sus módulos operativos normales.

### 5.3 La ruta de pago actual es incompatible con subcuentas reales

`POST /api/orders/:id/pay` recibe opcionalmente `productos_divididos`, pero:

- selecciona filas completas por ID;
- multiplica por la cantidad total de la fila;
- no permite asignar una parte de una cantidad;
- no registra qué ítems fueron cobrados;
- no evita volver a cobrar los mismos ítems;
- no crea una subcuenta ni documento;
- no conserva nombre de cliente parcial;
- no calcula un saldo persistente por división.

El endpoint no debe ampliarse con más condicionales. Debe convertirse temporalmente en adaptador y finalmente dejar de ser el punto principal de cobro.

### 5.4 `pedido_productos` consolida cantidades y pierde trazabilidad útil

Al agregar productos, si encuentra el mismo producto y presentación, aumenta `cantidad` sobre la misma fila.

Esto es aceptable mientras toda la línea está sin asignar. Se vuelve riesgoso cuando parte de la línea ya está incluida en una prefactura:

```text
Imperial ×3
- Juan recibe 2
- luego se agregan 2 nuevas Imperial
```

Actualizar la misma fila a ×5 dificulta distinguir consumo anterior, nuevas rondas y cantidades ya documentadas.

#### Recomendación

- conservar filas de consumo como eventos o lotes estables;
- no modificar una fila que ya tenga cantidades asignadas a prefacturas;
- permitir consolidación únicamente en una fila completamente disponible, con mismo producto, presentación y precio;
- identificar siempre por `pedido_producto_id`, no solo por `producto_id`.

### 5.5 Se necesita una entidad Prefactura, no un pago parcial informal

La prefactura debe existir antes del cobro. Debe congelar:

- cuenta principal;
- mesa/banco y zona;
- cliente de la subcuenta;
- responsable de atención;
- ítems y cantidades;
- nombre y presentación;
- precio unitario;
- subtotal;
- servicio;
- total;
- saldo;
- número interno;
- fecha y usuario emisor;
- estado de documento e impresión.

Modelo sugerido:

```text
prefacturas
prefactura_items
```

Estados recomendados:

```text
emitida
parcialmente_pagada
pagada
anulada
```

El estado de impresión debe mantenerse separado:

```text
pendiente
impresa
fallida
reimpresa
```

### 5.6 La selección debe ser temporal y la emisión debe ser atómica

El flujo acordado crea una sola subcuenta a la vez:

1. activar `Cuenta dividida`;
2. seleccionar ítems;
3. escoger cantidad por línea;
4. pulsar `Emitir prefactura`;
5. revisar minimodal;
6. escribir nombre del cliente;
7. volver para corregir o confirmar impresión/emisión.

La selección puede mantenerse en estado frontend hasta la confirmación. Al confirmar, el backend debe ejecutar una transacción que:

1. valide que el pedido continúa abierto;
2. valide responsabilidad del emisor;
3. vuelva a calcular cantidades disponibles;
4. rechace sobreasignaciones;
5. genere número de documento;
6. cree prefactura;
7. cree prefactura_items;
8. registre historial;
9. cree una solicitud de impresión;
10. emita realtime.

Para evitar que dos dispositivos asignen la misma cantidad, la transacción debe comenzar con bloqueo de escritura apropiado para SQLite, por ejemplo `BEGIN IMMEDIATE`.

### 5.7 La cantidad disponible debe derivarse de asignaciones válidas

No se recomienda borrar ni reducir físicamente el consumo original. La disponibilidad debe calcularse así:

```text
cantidad_disponible
= cantidad_consumida
- cantidad_asignada_en_prefacturas_no_anuladas
```

Consecuencias:

- al emitir una prefactura, las cantidades dejan de estar disponibles para otra;
- aunque la prefactura siga pendiente de pago, ya no pueden duplicarse;
- al anular una prefactura válida, las cantidades vuelven a estar disponibles;
- al pagar, los ítems permanecen en historial y no reaparecen;
- nuevos productos pueden agregarse como consumo nuevo.

La vista de la cuenta debe separar:

```text
Consumo activo sin prefacturar
Prefacturas emitidas pendientes
Prefacturas pagadas / historial
```

### 5.8 La cuenta operativa y el estado financiero deben separarse

El modelo actual usa un único `pedidos.estado`:

```text
pendiente
pagado
cancelado
credito
```

Esto no representa el caso:

```text
mesa abierta + saldo actual cero + clientes todavía consumiendo
```

Se recomienda separar:

```text
estado_operativo: abierta | finalizando | cerrada | cancelada
estado_financiero: sin_documentos | pendiente | parcial | conciliada | credito
```

Durante compatibilidad, `pedidos.estado = pendiente` puede mantenerse mientras el servicio esté abierto, incluso si todas las prefacturas actuales están pagadas.

### 5.9 Pagar una prefactura no debe liberar la mesa

La ruta actual marca el pedido como pagado y libera la mesa cuando el pago no contiene `productos_divididos`.

En el flujo v3 esto es incorrecto. Un pago solo debe:

- registrar la transacción;
- actualizar el saldo de la prefactura;
- actualizar el estado financiero agregado de la cuenta;
- notificar a Caja y al responsable.

La mesa permanece ocupada. La finalización debe ser una acción separada del personal responsable.

### 5.10 El cierre del servicio requiere condiciones explícitas

La acción **Finalizar servicio / Cerrar mesa** debe validar en una sola transacción:

- no existen cantidades consumidas sin prefacturar;
- no existen prefacturas pendientes o parcialmente pagadas;
- no existen pagos en proceso;
- cualquier crédito está formalmente trasladado y documentado;
- la cuenta no recibió nuevos productos después de la validación inicial;
- el usuario es responsable de la mesa o administrador autorizado.

Solo entonces:

- se cierra la cuenta principal;
- se libera la mesa;
- se limpia `mesa_responsables`;
- se registra historial;
- se actualiza Dashboard;
- se emite realtime.

### 5.11 El código actual permite pagos a cualquier usuario autenticado

`server/app.js` exige sesión, pero `server/routes/orders.js` no comprueba capacidad de Caja para `/pay` ni responsabilidad de mesa para todas sus mutaciones.

Un usuario autenticado que conozca el ID podría intentar cobrar una cuenta manualmente.

La v3 debe aplicar seguridad backend:

```text
orders.operate             modificar consumo de mesas propias/autorizadas
orders.issue_preinvoice    emitir prefacturas de mesas propias/autorizadas
cash.access                consultar cola de Caja
cash.collect               registrar cobros
cash.reprint               reimprimir comprobantes
```

Ocultar botones en frontend es solo una mejora UX; la autorización definitiva debe estar en backend.

### 5.12 Dashboard contiene un acceso oculto de cobro directo

La acción principal de una mesa ocupada abre Agregar productos, pero el doble clic ejecuta:

```text
Dashboard.abrirProcesarPago()
```

Esto contradice el nuevo flujo. Debe retirarse o redirigirse a Ver cuenta/emitir prefactura. Dashboard no debe procesar dinero.

### 5.13 Caja necesita un read model propio

Caja no debería consumir directamente la lista completa de pedidos y reconstruir estados en frontend.

Se recomienda una consulta específica que entregue:

- prefacturas emitidas con saldo;
- mesa/banco;
- zona;
- cliente;
- responsable;
- número de cuenta y prefactura;
- total, pagado y saldo;
- estado;
- fecha/hora;
- indicador de cuenta dividida;
- cantidad de documentos hermanos de la misma mesa.

Búsquedas mínimas:

```text
número de prefactura
número de cuenta
mesa/banco
zona
cliente
responsable
```

### 5.14 La tabla `pagos` requiere ampliación

Actualmente no guarda:

- prefactura;
- usuario cajero;
- estado;
- clave de idempotencia;
- efectivo recibido;
- vuelto;
- referencia de tarjeta;
- anulación/reverso;
- dispositivo o caja de origen.

Puede ampliarse de forma compatible o crearse una tabla canónica nueva. La opción conservadora es migrar `pagos` y mantener sus filas históricas.

Columnas recomendadas:

```text
prefactura_id
usuario_cajero_id
estado
idempotency_key
efectivo_recibido
vuelto
referencia
creado_en
confirmado_en
anulado_en
```

Pagos mixtos se representan como varias transacciones aplicadas a la misma prefactura.

### 5.15 El número de documento debe generarse en backend

El ID autoincremental del pedido no cubre por sí solo el control documental solicitado.

Se requieren secuencias transaccionales para:

```text
cuenta principal
prefactura
recibo/factura
nota de anulación/reverso
```

Modelo sugerido:

```text
document_sequences
```

Ejemplo conceptual:

```text
CTA-2026-000123
PF-2026-000456
RC-2026-000789
```

El formato definitivo será configurable, pero la unicidad debe protegerse con índices `UNIQUE`.

### 5.16 Impresión y emisión documental no deben confundirse

Pulsar **Imprimir y emitir prefactura** debe persistir primero el documento y luego solicitar impresión.

Si la impresora falla:

- la prefactura continúa emitida;
- sus ítems continúan reservados;
- el trabajo queda `fallido` o `pendiente`;
- el usuario puede reintentar/reimprimir;
- no se debe generar otra prefactura por accidente.

Esto exige que Printing maneje trabajos separados del estado de negocio.

### 5.17 Realtime debe comprender capacidades, no solo zonas

El contexto actual filtra eventos principalmente mediante zonas de roles activos. Un cajero exclusivo sin zonas no recibiría cambios de pedidos/prefacturas.

Realtime debe incorporar capacidades activas:

```text
cash.access → eventos de Caja autorizados
orders.operate → eventos de zonas permitidas
kitchen.operate → eventos de comandas relevantes
```

Los pagos de una prefactura deben actualizar:

- la cola de Caja;
- la cuenta del mesero responsable;
- Dashboard;
- la mesa relacionada;
- reportes financieros.

## 6. Modelo de datos objetivo recomendado

### 6.1 Cuenta principal

Ampliaciones sugeridas en `pedidos`:

```text
numero_control
estado_operativo
estado_financiero
cerrado_en
cerrado_por_usuario_id
version_registro
```

`version_registro` o un campo equivalente ayuda a detectar mutaciones concurrentes.

### 6.2 Prefacturas

```text
prefacturas
- id
- numero_documento
- pedido_id
- cliente_nombre
- usuario_emisor_id
- subtotal
- servicio
- total
- total_pagado
- saldo
- estado
- estado_impresion
- fecha_emision
- fecha_pago
- anulada_en
- anulada_por_usuario_id
- motivo_anulacion
- snapshot_mesa
- snapshot_zona
- snapshot_responsable
```

### 6.3 Ítems de prefactura

```text
prefactura_items
- id
- prefactura_id
- pedido_producto_id
- cantidad
- producto_nombre_snapshot
- presentacion_snapshot
- precio_unitario
- subtotal
- servicio_asignado
- total
```

### 6.4 Pagos

```text
pagos
- id
- pedido_id
- prefactura_id
- usuario_cajero_id
- metodo_pago
- monto
- estado
- idempotency_key
- efectivo_recibido
- vuelto
- referencia
- fecha
```

### 6.5 Capacidades

```text
capacidades
rol_trabajo_capacidades
```

### 6.6 Impresión

```text
trabajos_impresion
- id
- tipo_documento
- referencia_id
- impresora_destino
- estado
- intentos
- error
- solicitado_por_usuario_id
- creado_en
- impreso_en
```

## 7. Flujos objetivo validados

### 7.1 Cuenta normal sin división

1. El mesero abre Ver pedido.
2. No activa `Cuenta dividida`.
3. Pulsa `Emitir prefactura`.
4. El sistema toma todo el consumo disponible.
5. El minimodal muestra cliente general, resumen y total.
6. Se emite una prefactura completa.
7. Caja la cobra.
8. La mesa permanece abierta hasta que el responsable finalice el servicio.

### 7.2 Cuenta dividida, una subcuenta a la vez

1. El mesero activa `Cuenta dividida`.
2. Selecciona ítems y cantidades de Juan.
3. Pulsa `Emitir prefactura`.
4. En minimodal escribe Juan y confirma.
5. El sistema bloquea esas cantidades.
6. La vista vuelve al consumo restante.
7. Repite el proceso para María.

### 7.3 Cliente se retira antes

1. Juan paga su prefactura en Caja.
2. La prefactura de Juan queda pagada.
3. Sus productos no aparecen en consumo disponible.
4. La mesa continúa ocupada.
5. Los demás clientes agregan nuevos productos.
6. Se emiten nuevas prefacturas más adelante.

### 7.4 Cierre final

1. Todos los consumos están prefacturados.
2. Todas las prefacturas están pagadas o formalmente trasladadas a crédito.
3. El mesero pulsa `Finalizar servicio`.
4. El backend valida nuevamente.
5. Se cierra cuenta, libera mesa y limpia responsables.

## 8. Riesgos si se implementa fuera de orden

### Crítico · Doble asignación de cantidades

Dos dispositivos pueden emitir prefacturas usando la misma unidad si no existe transacción y validación de disponibilidad en backend.

### Crítico · Cierre prematuro de mesa

Reutilizar la lógica actual de `/pay` liberaría la mesa cuando el primer cliente paga.

### Crítico · Cobro sin autorización

Crear la UI de Caja antes del modelo de capacidades dejaría endpoints financieros expuestos a cualquier sesión.

### Crítico · Documento impreso sin persistencia

Imprimir primero y guardar después puede producir prefacturas físicas sin respaldo en base de datos.

### Alto · Consumo reaparece o desaparece incorrectamente

Reducir directamente `pedido_productos.cantidad` perdería trazabilidad; no reducirlo sin asignaciones permitiría cobrar dos veces.

### Alto · Totales inconsistentes

Calcular servicio y redondeo por cuenta y por prefactura sin una regla única puede provocar diferencias entre total general y suma de documentos.

### Alto · Roles de Caja con acceso indebido

Usar zonas como sustituto de permisos podría permitir a un cajero operar mesas o pedidos.

### Alto · Realtime incompleto

Caja podría no ver nuevas prefacturas o el mesero podría no ver un pago realizado.

### Medio · Historial legacy ambiguo

Pagos antiguos no tendrán prefactura asociada. Deben marcarse como registros legacy y conservarse para consulta.

## 9. Orden de implementación recomendado

1. Infraestructura transaccional, dinero e idempotencia.
2. Capacidades, rol Cajero y navegación autorizada.
3. Acceso operativo común y realtime por capacidades.
4. Servicio de Cuentas y líneas de consumo estables.
5. Modelo de prefacturas, cantidades asignadas y secuencias.
6. UI de división una subcuenta a la vez.
7. Contrato mínimo de Printing para emitir prefactura.
8. Núcleo de Payments por prefactura.
9. Sección visual Caja y botón del header.
10. Efectivo, vuelto, tarjeta, pagos mixtos y crédito.
11. Finalización explícita del servicio y liberación integral.
12. Kitchen, Printing completo, reportes, realtime y limpieza legacy.

## 10. Pruebas mínimas obligatorias

- usuario sin `cash.collect` no puede cobrar por API;
- cajero exclusivo entra directamente a Caja y no ve módulos no autorizados;
- salonero con capacidad adicional puede alternar operación y Caja;
- una línea cantidad 3 se divide 2 + 1 sin duplicación;
- dos emisiones concurrentes no pueden sobreasignar;
- prefactura anulada devuelve cantidades disponibles;
- prefactura pagada no devuelve cantidades;
- pagar una prefactura no libera mesa;
- mesa con saldo temporal cero continúa abierta;
- nuevos productos pueden agregarse después de un pago parcial;
- cierre falla si quedan cantidades sin prefacturar;
- cierre falla si queda una prefactura pendiente;
- cierre exitoso limpia `mesa_responsables`;
- fallo de impresión no duplica prefactura;
- doble clic de cobro no genera pago duplicado;
- realtime actualiza Caja y responsable de mesa;
- suma de prefacturas coincide con cantidades consumidas y reglas de servicio.

## 11. Dictamen final

El flujo propuesto representa mejor la operación real de restaurantes y bares que el modelo actual. La arquitectura vigente permite evolucionar hacia él, pero la implementación debe tratar **Cuenta, Prefactura, Pago y Mesa como estados relacionados pero independientes**.

La regla central de v3 queda definida así:

```text
El mesero administra consumo y emite prefacturas.
Caja cobra documentos emitidos.
Un pago liquida una prefactura, no finaliza el servicio.
La mesa se libera únicamente mediante cierre operativo explícito.
```
