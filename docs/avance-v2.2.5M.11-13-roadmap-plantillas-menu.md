# v2.2.5M.11–13 · Roadmap de plantillas, importación e imágenes de Menú

## Objetivo

Documentar la extensión del bloque Menú antes de volver a la línea principal de Cuentas/Orders.

La nueva extensión responde a una necesidad operativa: facilitar la primera carga del catálogo de un restaurante/bar mediante una plantilla Excel oficial, creada desde formularios guiados y luego importada con validación estricta.

## Decisión tomada

La fase Menú no se considera cerrada definitivamente para volver a Cuentas hasta documentar y ejecutar, salvo postergación explícita, estas subfases:

```text
v2.2.5M.11 · Generador asistido de Plantilla Excel de Menú
v2.2.5M.12 · Importar Menú desde Plantilla
v2.2.5M.13 · Imágenes por presentación y producto
v2.2.5 · Retomar normalización de Cuentas / Orders
```

## Razonamiento

Menú ya quedó normalizado como fuente operativa para Cuentas, pero todavía falta una herramienta profesional para cargar rápidamente el menú inicial de un local.

La carga manual puede ser costosa cuando existen:

- múltiples categorías;
- múltiples subcategorías;
- productos con y sin presentación;
- tipos/grupos de presentación;
- presentaciones por grupo;
- precios por presentación;
- productos de cocina.

## Documento canónico creado

Se crea:

```text
docs/roadmap-v2.2.5M11-13-plantillas-menu.md
```

Este documento define:

- objetivo general;
- principio de diseño;
- formato base de plantilla Excel;
- reglas de seguridad;
- alcance de M.11;
- alcance de M.12;
- alcance preliminar de M.13;
- validaciones mínimas;
- commits sugeridos.

## Alcance de esta actualización

Esta actualización es solo documental.

No cambia:

- backend;
- frontend operativo;
- base de datos;
- permisos;
- Menú funcional;
- Cuentas/Orders;
- service worker;
- cache/PWA.

## Archivos modificados

- `README.md`
- `docs/roadmap-v2.2.5M-normalizacion-menu.md`
- `docs/roadmap-v2.2.5M11-13-plantillas-menu.md`
- `docs/avance-v2.2.5M.11-13-roadmap-plantillas-menu.md`

## Commit sugerido

```powershell
git commit -m "v2.2.5M.11-13: documenta roadmap de plantillas de Menu"
```
