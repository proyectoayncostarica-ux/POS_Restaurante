# Avance v3.4.2 · Configuración → Impresoras

## Objetivo

Incorporar la administración central de impresoras dentro de Configuración, manteniendo Printing como servicio transversal interno y evitando convertirlo en un módulo visual principal.

## Contrato implementado

La regla de esta fase es:

```text
Settings guarda configuración.
Printing la resuelve, toma un snapshot al encolar y la ejecuta.
```

La configuración se administra por tres destinos operativos independientes:

- Caja;
- Cocina;
- Bar.

Cada destino conserva:

- nombre de impresora/dispositivo;
- adaptador;
- tamaño de papel;
- cantidad de copias físicas;
- autoimpresión;
- plantilla opcional;
- estado activo/inactivo;
- estado del dispositivo;
- fecha de última prueba;
- último error conocido.

## Persistencia y compatibilidad

La configuración vive en `configuracion` mediante claves internas:

```text
printing.printer.caja
printing.printer.cocina
printing.printer.bar
```

Si existe la clave legacy `impresora`, su valor se adopta únicamente como nombre inicial de la impresora de Caja. Una vez creada la configuración normalizada, cambios posteriores del valor legacy no sobrescriben Settings.

No se crea una identidad financiera nueva ni se modifica ninguna operación de negocio.

## Snapshot por trabajo

`trabajos_impresion` incorpora metadata de ejecución:

```text
destino_impresion
impresora_nombre
tamano_papel
copias_fisicas
autoimpresion
configuracion_impresion_json
```

Al crear un trabajo, Printing resuelve la configuración actual y la congela en el trabajo. Cambiar Settings después no altera trabajos ya existentes.

La idempotencia continúa dependiendo del documento y su payload canónico. Una repetición de la misma copia después de cambiar la impresora devuelve el trabajo existente y conserva su snapshot original.

## Enrutamiento

- Prefacturas, recibos, créditos, abonos y cierres diarios usan el destino `caja`.
- Comandas con destino `cocina` usan la configuración de Cocina.
- Comandas con destino `bar` usan la configuración de Bar.

Los dominios no conocen dispositivos ni tamaños de papel.

## Autoimpresión

La configuración de `autoimpresion` controla si el flujo integrado procesa automáticamente el trabajo después de encolarlo.

Si está desactivada:

- el documento de negocio ya permanece persistido;
- el trabajo queda en la cola;
- no se revierte ninguna operación financiera u operativa.

## Prueba de impresión y estado

La pestaña `Configuración → Impresoras` permite ejecutar una prueba por destino.

La prueba:

1. solicita a Printing el adaptador configurado;
2. genera un documento técnico de prueba;
3. aplica tamaño de papel y cantidad de copias;
4. devuelve la salida del adaptador;
5. actualiza `estado_dispositivo`, `ultimo_test_en` y `ultimo_error`.

La prueba no crea ventas, prefacturas, pagos ni comandas.

## API

Settings guarda configuración:

```text
GET /api/settings/printers
PUT /api/settings/printers/:destination
```

Printing consulta/ejecuta:

```text
GET  /api/printing/printers/status
POST /api/printing/printers/:destination/test
GET  /api/printing/templates
```

## UI/UX

`Configuración` incorpora la pestaña interna `Impresoras`.

No existe una sección principal `Printing` en la navegación.

La interfaz muestra tarjetas independientes para Caja, Cocina y Bar y permite editar:

- dispositivo;
- adaptador;
- papel;
- copias;
- plantilla;
- autoimpresión;
- estado activo.

También muestra el último estado y permite prueba de impresión desde la misma tarjeta.

## Adaptador navegador/PDF

El adaptador inicial conserva su rol de salida base y ahora recibe la configuración congelada del trabajo.

Para el flujo navegador/PDF:

- aplica CSS `@page` según 58mm, 80mm, A4 o Carta;
- representa la cantidad de copias físicas como páginas repetidas;
- devuelve destino, dispositivo, papel y copias en el resultado auditable.

Esto no afirma soporte automático de una impresora térmica física. Drivers adicionales podrán registrarse posteriormente sin mover reglas de negocio.

## Verificaciones internas realizadas durante la implementación

Se ejecutaron pruebas específicas disponibles en el entorno de trabajo para:

- defaults Caja/Cocina/Bar;
- migración de nombre legacy de Caja;
- snapshot inmutable por trabajo;
- idempotencia después de cambiar Settings;
- enrutamiento de comanda Cocina/Bar;
- prueba de impresión y estado;
- presencia de la pestaña interna sin módulo visual Printing.

La validación final con la suite completa, `sqlite3@6.0.1`, `data/restaurant.db` y Git queda aplazada para realizarse fase por fase según la dinámica acordada por el usuario.

## Archivos centrales

```text
server/services/printerConfigurationService.js
server/services/printingService.js
server/services/documentPrintingService.js
server/services/printingAdapters/browserPdfAdapter.js
server/routes/settings.js
server/routes/printing.js
server/db/database.js
public/js/components/settings.js
public/js/main.js
public/css/style.css
```

## Próxima fase

Según el roadmap:

```text
v3.5.0 · Dashboard y reportes financieros consolidados
```

No debe iniciarse hasta que el usuario confirme explícitamente que continúe.
