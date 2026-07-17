# Avance v3.0.0 fix1 · Auditoría de Caja, prefacturas y subcuentas

## Objetivo

Contrastar el código actual con el flujo operativo aprobado para:

- usuario Cajero exclusivo o combinado con atención;
- división de cuenta una subcuenta a la vez;
- prefacturas independientes enlazadas a una cuenta principal;
- cobro desde Caja;
- continuidad de la mesa después de pagos parciales;
- cierre explícito del servicio;
- integración futura con Payments, Printing, Kitchen y realtime.

## Resultado

La auditoría confirma que el alcance es viable, pero requiere nuevas entidades y servicios. La ruta actual de pago y el uso de `productos_divididos` no ofrecen persistencia suficiente para el flujo aprobado.

## Hallazgos críticos

- roles de trabajo obligatoriamente ligados a zonas, incompatibles con Cajero exclusivo;
- cualquier sesión autenticada puede intentar llamar el endpoint de pago;
- no existe prefactura ni número documental;
- no existe asignación parcial por cantidad;
- el pago dividido no marca ítems cubiertos;
- el pago completo libera la mesa automáticamente;
- Dashboard conserva doble clic de cobro directo;
- `pedido_productos` consolida líneas aun cuando en v3 deberán poder quedar parcialmente asignadas;
- realtime filtra por zonas y no por capacidades;
- impresión continúa como placeholder.

## Decisiones documentadas

```text
Cajero será rol/capacidad, no tercer tipo rígido de usuario.
Caja será una sección visual accesible desde el header.
Payments e Impresiones continúan como servicios internos.
Cuentas emite prefacturas; Caja las cobra.
Una prefactura pagada no cierra la mesa.
La mesa se libera solo mediante Finalizar servicio.
```

## Documentos creados/actualizados

- `README.md`;
- `docs/auditoria-v3.0.0-fix1-caja-prefacturas-subcuentas.md`;
- `docs/contrato-v3.0-operacion-caja-prefacturas.md`;
- `docs/contrato-v3.0-compatibilidad-ui.md`;
- `docs/roadmap-v3.0-arquitectura-modular.md`;
- `docs/avance-v3.0.0-fix1-auditoria-caja-prefacturas.md`.

## Alcance técnico

Solo documentación. No se modifican:

- base de datos;
- backend operativo;
- frontend operativo;
- PWA/cache;
- versión package 3.0.0.

## Siguiente fase

```text
v3.0.1 · Infraestructura transaccional y pruebas base
```
