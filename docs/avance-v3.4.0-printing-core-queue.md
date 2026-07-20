# v3.4.0 · Núcleo y cola de Printing

## Objetivo

Crear el servicio transversal de Printing y una cola persistente sin adelantar la integración documental de `v3.4.1` ni la configuración visual de impresoras de `v3.4.2`.

## Regla arquitectónica

```text
dominio de negocio persiste documento
→ dominio entrega snapshot canónico
→ Printing persiste trabajo
→ Printing crea intento
→ adaptador genera/envía salida
→ éxito o fallo queda auditado
```

Un fallo del adaptador o del dispositivo no revierte, borra ni vuelve a crear el documento de negocio.

## Modelo persistente

### `trabajos_impresion`

Conserva tipo e identificador del documento, número visible, copia, plantilla, adaptador, payload canónico, fingerprint, estado, cantidad y máximo de intentos, último error y resultado.

La restricción única es:

```text
documento_tipo + documento_id + copia
```

Repetir la misma solicitud devuelve el trabajo existente. Usar la misma identidad con datos diferentes produce conflicto de idempotencia.

### `intentos_impresion`

Cada ejecución queda registrada con número de intento, adaptador, timestamps, estado, código/mensaje de error y resultado.

### `plantillas_documento`

Permite contenido versionado por código y tipo documental. Printing interpola datos recibidos; no calcula totales ni reglas de negocio.

## Estados

Trabajo:

```text
pendiente
procesando
completado
fallido
cancelado
```

Intento:

```text
procesando
completado
fallido
```

## Adaptador inicial

`navegador_pdf` genera HTML para vista previa e impresión mediante navegador/PDF. No marca por sí mismo un dispositivo físico como exitoso. La interfaz de adaptadores queda abierta para drivers térmicos posteriores.

## Reintentos y recuperación

Un trabajo fallido puede volver a `pendiente` mientras no alcance `max_intentos`. Cada nueva ejecución agrega un intento; nunca crea otro documento de negocio.

Al iniciar MundiPOS, los trabajos que permanecieron en `procesando` después de una interrupción se recuperan: el intento abierto se marca fallido con `PROCESS_INTERRUPTED` y el trabajo vuelve a la cola.

## API interna

```text
GET  /api/printing/jobs
GET  /api/printing/jobs/:id
POST /api/printing/jobs/:id/process
POST /api/printing/jobs/:id/retry
POST /api/printing/preview
PUT  /api/printing/templates/:code
```

La consulta/proceso/reintento requiere `printing.retry`. Plantillas y vista previa requieren `printing.configure`.

La creación de trabajos queda disponible como servicio interno (`printingService.enqueue`) para que `v3.4.1` conecte Prefacturas, Payments, Créditos, Kitchen y cierres sin duplicar plantillas ni lógica.

## Compatibilidad

- no cambia la cuenta global como única venta financiera;
- no convierte prefacturas en ventas;
- no modifica pagos ni créditos;
- no mezcla el estado operativo de Kitchen con impresión;
- no libera mesas;
- no añade Printing como módulo visual principal;
- `Configuración → Impresoras` sigue reservada para `v3.4.2`.

## Pruebas incluidas

- migración y creación idempotente del esquema;
- cascada de intentos;
- persistencia previa al adaptador;
- idempotencia por documento/tipo/copia;
- conflicto ante payload diferente;
- vista previa navegador/PDF;
- error de adaptador auditado;
- reintento sobre el mismo trabajo;
- límite máximo de intentos;
- plantillas versionadas;
- orden de cola;
- recuperación tras interrupción;
- contrato de separación respecto de los dominios financieros y Kitchen.

## Próxima fase

`v3.4.1 · Integración transversal de documentos` conectará los documentos canónicos con Printing. Printing seguirá sin recalcular negocio.
