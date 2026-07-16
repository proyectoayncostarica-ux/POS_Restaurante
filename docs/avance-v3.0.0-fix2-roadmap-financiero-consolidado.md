# v3.0.0 fix2 · Fuente financiera única y roadmap consolidado

## Objetivo

Consolidar el diseño de MundiPOS 3.0 después de aprobar el flujo de Caja, prefacturas divididas, continuidad del consumo y cuenta global como única fuente financiera interna.

## Aclaración principal

Las prefacturas, recibos o facturas parciales pueden tener:

- número propio;
- pagador propio;
- ítems y cantidades propios;
- pagos propios.

Sin embargo, el reporte financiero consolidado registra una sola venta por cuenta global.

Ejemplo:

```text
Mesa 1 · Cliente principal Juan · Responsable Andrey
Cuenta global: ₡5.000

Documento Pedro: ₡3.000
Documento Juan:  ₡2.000
```

Resultado:

```text
Ventas: una cuenta global de ₡5.000
Caja: dos movimientos de ₡3.000 y ₡2.000
```

## Documentación creada o actualizada

- `README.md`
- `docs/README-v3.0.md`
- `docs/roadmap-v3.0-arquitectura-modular.md`
- `docs/contrato-v3.0-cuenta-global-fuente-financiera.md`
- `docs/avance-v3.0.0-fix2-roadmap-financiero-consolidado.md`

## Alcance

Esta fase es documental.

No modifica:

- backend operativo;
- frontend operativo;
- base de datos;
- service worker;
- metadata de versión;
- permisos reales;
- cobros reales.

## Resultado

El roadmap queda ordenado desde fundaciones transaccionales hasta cierre de v3.0, incluyendo:

- capacidades y Cajero;
- cuenta global;
- cantidades disponibles;
- prefacturas;
- división una subcuenta a la vez;
- continuidad del consumo;
- Payments;
- Caja;
- créditos;
- cierre explícito;
- Kitchen;
- Printing;
- Configuración de impresoras;
- reportes consolidados;
- realtime;
- limpieza legacy;
- pruebas cruzadas.

## Siguiente fase

```text
v3.0.1 · Infraestructura transaccional y pruebas base
```
