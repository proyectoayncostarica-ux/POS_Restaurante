# Avance v3.3.0 fix1 · Inicialización segura de Kitchen sobre bases legacy

## 1. Incidente corregido

Después de publicar `v3.3.0`, el arranque sobre una base operativa existente procedente de `v3.2.5` reveló dos fallos consecutivos del mismo flujo de migración.

Primer fallo:

```text
SQLITE_ERROR: no such column: pedido_id
CREATE INDEX IF NOT EXISTS idx_comandas_pedido ON comandas(pedido_id)
```

Segundo fallo, visible después de corregir el primero:

```text
SQLITE_CONSTRAINT: NOT NULL constraint failed: comandas_new.solicitada_en
```

Ninguno de los dos errores implica pérdida de datos ni corrupción de SQLite. Ambos ocurrían por el orden y la preparación de los datos durante la migración de la tabla legacy `comandas`.

## 2. Causa raíz completa

### 2.1 Índices antes de migraciones

La inicialización ejecutaba la creación global de índices demasiado pronto. En una base `v3.2.5`, `comandas` ya existe pero todavía no contiene `pedido_id`, `estado_operativo`, `destino` ni el resto del modelo normalizado de Kitchen.

Por ello `idx_comandas_pedido` podía evaluarse antes de que `migrateSchema()` agregara las columnas.

### 2.2 NULL explícito durante reconstrucción

`ensureKitchenSchema()` agrega `solicitada_en` mediante `ALTER TABLE`. Para compatibilidad con SQLite, esta columna se agrega inicialmente como `TEXT` nullable; las filas antiguas quedan temporalmente con `solicitada_en = NULL`.

Después, `rebuildLegacyForeignKeys()` reconstruye `comandas` para reemplazar las claves foráneas legacy con borrado en cascada. La tabla nueva define:

```text
solicitada_en TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
```

Sin embargo, `rebuildTable()` copia las columnas existentes de forma explícita. Cuando la fila origen contiene `NULL`, SQLite intenta insertar ese `NULL`; el `DEFAULT CURRENT_TIMESTAMP` no se aplica porque la columna sí aparece en el `INSERT`.

El resultado era:

```text
NOT NULL constraint failed: comandas_new.solicitada_en
```

## 3. Corrección

La secuencia global queda:

```text
connect
→ foreign_keys OFF
→ createTables
→ migrateSchema
→ createIndexes
→ insertInitialData
→ ensureDynamicModelConsistency
→ foreign_keys ON
```

Además, `rebuildLegacyForeignKeys()` normaliza las filas legacy de `comandas` antes de crear y poblar `comandas_new`.

Se protegen los campos obligatorios y, específicamente para la fecha de solicitud, se usa:

```text
solicitada_en existente
→ fecha_impresion legacy
→ CURRENT_TIMESTAMP como último fallback
```

También se normalizan valores obligatorios como `productos_cocina`, `estado`, `destino`, `estado_operativo`, `estado_impresion`, `origen` y `version` para impedir que una migración parcial anterior deje valores incompatibles con la tabla reconstruida.

## 4. Recuperación después de un intento fallido

El fix es idempotente y contempla que un intento previo de `npm start` haya alcanzado parcialmente `ensureKitchenSchema()`.

En ese caso:

- la tabla original `comandas` puede contener ya columnas nuevas;
- `solicitada_en` puede existir con valores `NULL`;
- puede existir temporalmente `comandas_new` de un intento fallido.

`rebuildTable()` elimina primero cualquier tabla temporal `*_new`, la normalización corrige los campos obligatorios de la tabla original y luego la reconstrucción se repite sin eliminar el historial de comandas.

No se requiere borrar ni reemplazar `data/restaurant.db`.

## 5. Reglas preservadas

- La migración continúa siendo idempotente.
- No se borra historial de comandas.
- No se elimina compatibilidad legacy.
- Las comandas dejan de depender de `ON DELETE CASCADE` sobre mesas y pedidos.
- Printing continúa separado del estado operativo de preparación.
- La cuenta global, Caja, Payments, créditos y finalización no cambian.
- La base operativa permanece local, ignorada por Git y fuera de las entregas.

## 6. Pruebas de regresión

La regresión reproduce una base `v3.2.5` con una comanda existente y verifica:

1. `createTables()` no altera la tabla legacy existente;
2. `pedido_id` todavía no existe antes de la migración de Kitchen;
3. `ensureKitchenSchema()` agrega las columnas nuevas y deja `solicitada_en = NULL` en la fila legacy;
4. `rebuildLegacyForeignKeys()` normaliza la fila antes de copiarla;
5. la reconstrucción conserva la comanda y usa `fecha_impresion` como `solicitada_en`;
6. los índices `idx_comandas_pedido` e `idx_comandas_operacion` se crean únicamente cuando las columnas ya existen;
7. las reconstrucciones posteriores conservan snapshots e historial y no eliminan comandas al borrar una mesa.

## 7. Alcance

Archivos funcionales:

```text
server/db/database.js
tests/kitchenMigration.test.js
```

Documentación:

```text
README.md
docs/README-v3.0.md
docs/PROMPT-CONTINUIDAD-MUNDIPOS-3.0.md
docs/avance-v3.3.0-fix1-inicializacion-kitchen.md
```

## 8. Validación requerida en el entorno operativo

Después de aplicar el fix:

```text
node --test tests/kitchenMigration.test.js
npm test
npm start
```

El arranque debe completar las migraciones sobre `data/restaurant.db` sin ninguno de estos errores:

```text
SQLITE_ERROR: no such column: pedido_id
SQLITE_CONSTRAINT: NOT NULL constraint failed: comandas_new.solicitada_en
```

Solo después de validar el arranque real se debe realizar staging explícito, commit y push.

## 9. Commit canónico

```text
v3.3.0 fix1: corrige inicializacion de Kitchen sobre base legacy
```

La siguiente fase continúa siendo `v3.3.1 · Trazabilidad operativa de comandas` únicamente después de validar este fix operativamente y publicarlo con Git seguro.
