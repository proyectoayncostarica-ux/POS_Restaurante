# Avance v3.7.0 · Pruebas cruzadas y cierre MundiPOS 3.0

## Objetivo

Cerrar la línea arquitectónica MundiPOS 3.0 con pruebas cruzadas entre dominios, una matriz explícita de aceptación y documentación que distinga con claridad entre implementación preparada y cierre operativo realmente publicado.

## Implementación de esta fase

### 1. Pruebas cruzadas de dominio

Se incorpora `tests/mundiPos3CrossDomain.test.js` para validar escenarios que atraviesan más de un dominio y que no deben depender únicamente de pruebas unitarias aisladas:

- una cuenta global dividida en varias prefacturas conserva una sola venta;
- múltiples pagos permanecen como movimientos independientes;
- un cliente puede pagar y retirarse mientras el servicio continúa abierto;
- se puede agregar consumo después de un pago sin crear otra cuenta financiera;
- el saldo temporal cero no libera la mesa;
- la finalización explícita libera la mesa únicamente al final;
- crédito y abonos no duplican la venta global;
- un fallo/reintento de Printing no modifica la prefactura origen;
- el estado de impresión de Kitchen permanece separado del estado operativo;
- no reaparecen las rutas monetarias legacy retiradas en v3.6.0.

### 2. Contrato automático de cierre

Se incorpora `tests/mundiPos3ClosureContract.test.js` para comprobar:

- versión técnica `3.7.0` consistente en package, backend y PWA;
- existencia del checklist canónico de cierre;
- roadmap actualizado sin declarar V4 antes de la publicación final;
- scripts dedicados `test:cross-domain` y `test:closure`;
- documentación que mantiene la cuenta global como fuente financiera única;
- estado de cierre marcado como pendiente de validación operativa/publicación mientras esos pasos no hayan ocurrido.

### 3. Checklist canónico

Se incorpora `docs/checklist-cierre-mundipos-3.0.md` con la matriz mínima definida por el roadmap, cobertura automática asociada y columna de validación operativa pendiente.

La intención es evitar un falso positivo documental: preparar v3.7.0 no equivale a declarar cerrada la versión si todavía no se ejecutaron las verificaciones locales, la prueba sobre la base real y Git seguro.

### 4. Versionado y PWA

La línea técnica se actualiza a `3.7.0` y el caché PWA a `v3.7.0-cross-domain-closure` para asegurar que los navegadores no continúen ejecutando assets de fases anteriores durante la validación final.

## Fuera de alcance

Esta fase no introduce nuevos dominios de negocio ni define MundiPOS V4. Tampoco elimina migraciones históricas necesarias para abrir bases antiguas.

## Validación pendiente acordada

Por decisión operativa, las validaciones finales se ejecutarán posteriormente y fase por fase en el equipo del proyecto:

1. pruebas específicas;
2. suite completa con `sqlite3@6.0.1`;
3. arranque y migración sobre `data/restaurant.db`;
4. comprobación operativa crítica en PC y móvil;
5. staging explícito;
6. commit y push seguro;
7. comprobación `main = origin/main`, divergencia `0 0` y árbol limpio.

Hasta completar esos pasos, el estado correcto es **v3.7.0 implementada y preparada para validación final**, no “MundiPOS 3.0 publicado y cerrado”.

## Documentos relacionados

- `docs/roadmap-v3.0-arquitectura-modular.md`
- `docs/checklist-cierre-mundipos-3.0.md`
- `docs/arquitectura-v3.6.0-dependencias.md`
- `docs/contrato-v3.0-cuenta-global-fuente-financiera.md`
- `docs/contrato-v3.0-operacion-caja-prefacturas.md`

## Commit previsto después de validar

```text
v3.7.0: cierra arquitectura operativa de MundiPOS 3.0
```
