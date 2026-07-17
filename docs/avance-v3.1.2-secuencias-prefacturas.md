# Avance v3.1.2 · Secuencias y modelo persistente de prefacturas

## 1. Objetivo

Crear la base documental transaccional que permitirá emitir una subcuenta a la vez desde `Ver pedido`, conservar su identidad y reservar cantidades sin convertirla en una venta financiera independiente.

Esta fase implementa el dominio y la persistencia. No agrega todavía la selección visual, el minimodal ni el botón operativo de emisión; esos elementos pertenecen a `v3.1.3`.

## 2. Principio financiero preservado

La prefactura es un documento operativo dependiente de la cuenta global:

```text
Cuenta global CTA-00000015
├── PF-00000001 · Pedro · ₡3.000
└── PF-00000002 · Juan  · ₡2.000
```

Para reportes financieros continúa existiendo una sola venta global. Los documentos parciales conservan pagador, ítems, cantidades y saldo propio, pero no reemplazan al cliente principal, la mesa/banco ni los responsables de la cuenta.

## 3. Persistencia agregada

### `secuencias_documentales`

Mantiene numeración transaccional por tipo documental:

```text
tipo_documento
prefijo
longitud
ultimo_numero
version
creado_en
actualizado_en
```

La primera definición es:

```text
prefactura → PF-00000001
```

La secuencia se incrementa dentro de la misma transacción que persiste el documento. Un rollback no consume definitivamente el número.

### `prefacturas`

Conserva:

- vínculo con la cuenta global;
- número global único y ordinal dentro de la cuenta;
- tipo `completa` o `dividida`;
- nombre del pagador;
- estado documental e impresión;
- subtotal, servicio, total, pagado y saldo;
- snapshots de cuenta, mesa/banco, zona y cliente principal;
- snapshot JSON de responsables;
- usuario emisor y usuario anulador;
- clave de idempotencia y fingerprint;
- fechas, motivo de anulación y versión.

Estados documentales iniciales:

```text
emitida
parcial
pagada
anulada
```

Estados de impresión:

```text
pendiente
impresa
fallida
```

### `prefactura_items`

Cada ítem conserva:

```text
pedido_producto_id
producto y presentación
cantidad asignada
nombres en snapshot
precio unitario
subtotal
servicio
total de línea
```

La cantidad se vincula a una línea de consumo existente y no borra el historial original.

### `historial_prefacturas`

Registra eventos como emisión y anulación con:

```text
estado anterior
estado nuevo
usuario
fecha
detalle serializado
```

## 4. Servicios nuevos

### `documentSequenceService`

Responsable de:

- validar tipos documentales;
- generar números formateados;
- incrementar secuencias con `BEGIN IMMEDIATE`;
- trabajar dentro de una transacción existente;
- consultar el último número confirmado.

### `preinvoiceService`

Responsable de:

- validar cuenta abierta, emisor y pagador;
- normalizar líneas y cantidades;
- reservar cantidades mediante `accountService`;
- crear snapshots inmutables;
- calcular subtotal, servicio y total;
- obtener número y ordinal;
- persistir documento, ítems e historial;
- marcar la cuenta global como financieramente pendiente/parcial;
- devolver el documento completo;
- anular documentos sin pagos y liberar cantidades;
- evitar duplicados mediante idempotencia.

## 5. Refactor de cantidades

`accountService` incorpora operaciones reutilizables dentro de una transacción existente:

```javascript
assignAvailableQuantitiesInTransaction()
releaseAssignedQuantitiesInTransaction()
```

Los métodos públicos anteriores continúan funcionando como adaptadores transaccionales:

```javascript
assignAvailableQuantities()
releaseAssignedQuantities()
```

Esto evita que Prefacturas duplique reglas de disponibilidad y concurrencia.

## 6. Emisión atómica

La emisión interna sigue este orden:

```text
validar cuenta y usuario
→ validar disponibilidad
→ reservar cantidades
→ calcular snapshots y totales
→ generar número documental
→ persistir prefactura
→ persistir ítems
→ registrar historial
→ actualizar estado de cuenta
→ commit
```

Ante cualquier falla se revierte:

```text
prefactura
ítems
historial
cantidad_asignada
secuencia documental
estado de cuenta
```

## 7. Idempotencia

La emisión acepta una clave opcional de idempotencia.

- Mismo key + mismo contenido: devuelve el documento existente.
- Mismo key + contenido diferente: responde con conflicto de idempotencia.
- El reintento no vuelve a reservar cantidades ni genera otro número.

Esto prepara el flujo `Imprimir y emitir`: una falla de impresión o un doble clic no debe crear otra prefactura.

## 8. Anulación

La anulación implementada a nivel de servicio:

- solo permite documentos `emitida` sin pagos;
- conserva el documento y sus ítems como historial;
- cambia el estado a `anulada`;
- deja saldo documental en cero;
- registra motivo, usuario y evento;
- devuelve las cantidades a la cuenta activa;
- recalcula el estado documental de la cuenta global.

Todavía no se expone como acción visual ni endpoint público.

## 9. Compatibilidad

Esta fase no modifica:

- Dashboard;
- navegación;
- botón Caja;
- pantalla `Ver pedido`;
- impresión física;
- Payments;
- rutas públicas de emisión;
- cierre o liberación de mesa.

Las tablas y servicios quedan disponibles para `v3.1.3`.

## 10. Migración

La migración:

- crea las cuatro tablas de forma idempotente;
- registra la secuencia `prefactura` en cero sin reiniciarla;
- crea índices de cuenta, estado, impresión, línea e historial;
- registra `v3_preinvoice_schema_ready`;
- limpia vínculos huérfanos antes de reactivar claves foráneas.

Validación sobre copia de base operativa:

```text
15 cuentas conservadas
40 líneas de consumo conservadas
1 secuencia documental inicial
0 prefacturas creadas artificialmente
0 problemas en PRAGMA foreign_key_check
migración ejecutada dos veces sin reiniciar numeración
```

## 11. Pruebas

Comandos:

```powershell
npm run test:prefacturas
npm test
```

Resultado:

```text
11 pruebas específicas de prefacturas aprobadas
47 pruebas totales aprobadas
0 fallos
```

Casos cubiertos:

- secuencia consecutiva;
- rollback de numeración;
- concurrencia de números;
- migración idempotente;
- emisión y reserva parcial;
- dos subcuentas separadas;
- fuente financiera global intacta;
- idempotencia;
- rollback después de numerar;
- anulación y liberación;
- snapshots inmutables;
- bloqueo de doble reserva concurrente.

## 12. Versionado

```text
Versión visible: 3.0
package.json: 3.1.2
Seguimiento interno: 3.1.2
```

## 13. Archivos principales

```text
server/db/database.js
server/services/accountService.js
server/services/documentSequenceService.js
server/services/preinvoiceService.js
server/config/appInfo.js

tests/documentSequence.test.js
tests/preinvoiceMigration.test.js
tests/preinvoiceService.test.js

package.json
package-lock.json
README.md
docs/README-v3.0.md
docs/roadmap-v3.0-arquitectura-modular.md
```

## 14. Git seguro

```powershell
git status --short

git add README.md
git add docs/README-v3.0.md
git add docs/roadmap-v3.0-arquitectura-modular.md
git add docs/avance-v3.1.2-secuencias-prefacturas.md

git add package.json
git add package-lock.json

git add server/config/appInfo.js
git add server/db/database.js
git add server/services/accountService.js
git add server/services/documentSequenceService.js
git add server/services/preinvoiceService.js

git add tests/documentSequence.test.js
git add tests/preinvoiceMigration.test.js
git add tests/preinvoiceService.test.js
```

Revisión obligatoria:

```powershell
git diff --cached --name-only

git diff --cached --name-only | Select-String -Pattern "\.env$|certs/|cookies\.txt|data/.*\.db|data/.*\.db-shm|data/.*\.db-wal|data/backups|mundipos-rootCA|\.pem$|\.key$|node_modules"

git diff --cached --check
npm run test:prefacturas
npm test
```

Commit:

```powershell
git commit -m "v3.1.2: agrega modelo transaccional de prefacturas"
git push origin main
```

## 15. Siguiente fase

```text
v3.1.3 · División una subcuenta a la vez
```
