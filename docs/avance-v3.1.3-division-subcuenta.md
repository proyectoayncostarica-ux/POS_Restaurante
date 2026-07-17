# Avance v3.1.3 · División una subcuenta a la vez

## Estado

Implementación terminada y preparada para validación operativa.

- Versión visible: `3.0`
- Versión interna/package: `3.1.3`
- Fase: emisión guiada de prefacturas desde `Ver pedido`
- Base de datos: sin tablas nuevas; utiliza el modelo persistente creado en `v3.1.2`

## Objetivo

Conectar las líneas de consumo y el modelo de prefacturas con el flujo real del personal de atención:

```text
activar Cuenta dividida
→ elegir ítems de un cliente
→ indicar cantidades
→ revisar total parcial
→ escribir nombre del pagador
→ imprimir y emitir una sola prefactura
→ volver al consumo restante
```

La aplicación nunca construye dos subcuentas simultáneamente. Cada confirmación genera un documento independiente y reserva únicamente sus cantidades.

## Flujo implementado

### Cuenta no dividida

Con `Cuenta dividida` desactivada, `Emitir prefactura` incluye todo el consumo disponible en ese momento. El backend valida que una prefactura de tipo `completa` contenga exactamente todas las líneas y cantidades disponibles.

### Cuenta dividida

Al activar `Cuenta dividida`:

- cada línea disponible muestra un checkbox;
- las líneas con cantidad mayor que uno muestran un selector numérico;
- el selector permanece deshabilitado hasta marcar la línea;
- el resumen calcula unidades y total parcial;
- `Emitir prefactura parcial` permanece deshabilitado sin selección;
- la selección vive únicamente en el frontend hasta confirmar.

### Minimodal

El minimodal muestra:

- nombre obligatorio del cliente/pagador;
- productos y cantidades elegidas;
- subtotal;
- servicio;
- total seleccionado;
- botón `Volver`;
- botón `Imprimir y emitir`.

`Volver` no escribe en SQLite ni reserva cantidades. La selección se restaura para corregirla.

`Imprimir y emitir` persiste primero la prefactura mediante una solicitud idempotente. Después abre una impresión temporal del navegador. Un bloqueo o fallo de la ventana de impresión no duplica ni revierte el documento ya emitido.

## Endpoints operativos

```text
GET  /api/orders/:id/preinvoices
GET  /api/orders/:id/preinvoices/:preinvoiceId
POST /api/orders/:id/preinvoices
```

La emisión requiere:

```text
orders.operate
orders.issue_preinvoice
```

Una prefactura dividida requiere además:

```text
orders.split
```

El backend valida zona y responsabilidad de mesa/banco. Ocultar controles en el navegador no sustituye la autorización.

## Protección del flujo legacy

La división antigua mediante `productos_divididos` queda rechazada con:

```text
USE_PREINVOICE_SPLIT_FLOW
```

Una cuenta que ya tiene prefacturas activas o cantidades asignadas no puede cobrarse mediante el endpoint legacy de pago completo. El backend responde:

```text
ACCOUNT_REQUIRES_PREINVOICE_PAYMENT
```

Esto evita cobrar nuevamente cantidades reservadas y prepara la migración a Caja/Payments.

## Realtime

Las mutaciones de prefactura se publican con alcance `cuentas`. De esta manera pueden actualizarse:

- usuarios de atención autorizados para la zona;
- Caja con `cash.access`;
- administradores.

## Fuente financiera

La implementación conserva la regla canónica:

```text
prefactura = documento operativo
cuenta global = única venta financiera
```

Los documentos parciales tienen numeración y pagador propios, pero no generan ventas separadas en reportes.

## Impresión temporal

La impresión de esta fase usa una ventana imprimible del navegador. No marca automáticamente `estado_impresion = impresa` porque todavía no existe confirmación de una cola o dispositivo físico.

La integración con trabajos, reintentos, drivers y configuración de impresoras permanece en `v3.4.x`.

## Archivos principales

```text
server/services/preinvoiceService.js
server/routes/orders.js
server/utils/realtime.js
public/js/components/orders.js
public/css/style.css
public/index.html
public/service-worker.js
tests/preinvoiceService.test.js
tests/preinvoiceWorkflowUi.test.js
```

## Pruebas automáticas

Suite específica:

```powershell
npm run test:division
```

Resultado preparado:

```text
13 pruebas aprobadas
0 fallos
```

Suite completa:

```powershell
npm test
```

Resultado preparado:

```text
53 pruebas aprobadas
0 fallos
```

La cobertura incluye:

- división secuencial `2 + 1`;
- idempotencia;
- concurrencia sobre la última unidad;
- rollback de documento, cantidades y secuencia;
- prefactura completa exacta;
- rechazo de una prefactura completa parcial;
- presencia del checkbox, cantidades y minimodal;
- protección por capacidades;
- rechazo del pago dividido legacy;
- alcance realtime de cuentas.

## Validación operativa requerida

1. Abrir una mesa con varios productos y cantidades mayores que uno.
2. Entrar a `Ver pedido`.
3. Activar `Cuenta dividida`.
4. Seleccionar `Imperial ×2` y otros productos para el primer cliente.
5. Confirmar que el total parcial cambia.
6. Pulsar `Emitir prefactura parcial`.
7. Escribir el nombre del pagador.
8. Pulsar `Volver` y verificar que la selección continúa sin reservarse.
9. Confirmar con `Imprimir y emitir`.
10. Verificar el número `PF-########` y la ventana imprimible.
11. Confirmar que el consumo activo solo muestra cantidades restantes.
12. Repetir para el segundo cliente.
13. Confirmar que ambos documentos aparecen separados y vinculados a la misma cuenta global.
14. Agregar nuevos productos a la mesa y confirmar que la cuenta continúa abierta.

## Commit

```powershell
git commit -m "v3.1.3: agrega emision guiada de prefacturas divididas"
```

## Siguiente fase

```text
v3.1.4 · Continuidad del consumo después de documentos y pagos
```
