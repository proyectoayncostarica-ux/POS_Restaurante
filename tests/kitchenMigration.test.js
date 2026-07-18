const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase, applySqlStatements } = require('./helpers/testDatabase');

const LEGACY_KITCHEN_SCHEMA = [
    `CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY,
        nombre TEXT NOT NULL,
        activo INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE mesas (
        id INTEGER PRIMARY KEY,
        numero INTEGER NOT NULL,
        tipo_asiento TEXT,
        zona_id INTEGER,
        zona TEXT
    )`,
    `CREATE TABLE productos (
        id INTEGER PRIMARY KEY,
        nombre TEXT NOT NULL,
        es_cocina INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE presentaciones (
        id INTEGER PRIMARY KEY,
        nombre TEXT,
        cantidad TEXT
    )`,
    `CREATE TABLE pedidos (
        id INTEGER PRIMARY KEY,
        mesa_id INTEGER NOT NULL,
        numero_cuenta TEXT,
        estado_operativo TEXT
    )`,
    `CREATE TABLE pedido_productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pedido_id INTEGER NOT NULL,
        producto_id INTEGER NOT NULL,
        cantidad INTEGER NOT NULL,
        precio_unitario REAL NOT NULL,
        precio_original REAL NOT NULL,
        creado_en TEXT,
        presentacion_id INTEGER
    )`,
    `CREATE TABLE comandas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mesa_id INTEGER NOT NULL,
        productos_cocina TEXT NOT NULL,
        fecha_impresion TEXT NOT NULL,
        estado TEXT NOT NULL
    )`,
    `CREATE TABLE configuracion (
        clave TEXT PRIMARY KEY,
        valor TEXT,
        version_app TEXT
    )`
];

test('migra comandas legacy sin borrar sus datos ni confundir impresión con preparación', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await applySqlStatements(context.db, LEGACY_KITCHEN_SCHEMA);

    await context.db.run(`INSERT INTO usuarios VALUES (1, 'Salonero', 1)`);
    await context.db.run(`INSERT INTO mesas VALUES (1, 7, 'mesa', NULL, 'salon')`);
    await context.db.run(`INSERT INTO productos VALUES (1, 'Casado', 1)`);
    await context.db.run(`INSERT INTO pedidos VALUES (1, 1, 'CTA-00000001', 'abierta')`);
    await context.db.run(`
        INSERT INTO pedido_productos (
            pedido_id, producto_id, cantidad, precio_unitario,
            precio_original, creado_en, presentacion_id
        ) VALUES (1, 1, 2, 3500, 3500, '2026-07-17T10:00:00.000Z', NULL)
    `);
    await context.db.run(`
        INSERT INTO comandas (
            mesa_id, productos_cocina, fecha_impresion, estado
        ) VALUES (1, '[{"producto_id":1,"cantidad":2}]', '2026-07-17T10:01:00.000Z', 'impresa')
    `);

    await context.db.ensurePreparationDestinationColumn();
    await context.db.ensureConsumptionLineColumns();
    await context.db.ensureKitchenSchema();
    await context.db.migrateKitchenLegacy();
    await context.db.ensureKitchenSchema();
    await context.db.migrateKitchenLegacy();

    const product = await context.db.get('SELECT destino_preparacion FROM productos WHERE id = 1');
    assert.equal(product.destino_preparacion, 'cocina');

    const command = await context.db.get('SELECT * FROM comandas WHERE id = 1');
    assert.equal(command.productos_cocina, '[{"producto_id":1,"cantidad":2}]');
    assert.equal(command.destino, 'cocina');
    assert.equal(command.estado_operativo, 'enviada');
    assert.equal(command.estado_impresion, 'impresa');
    assert.equal(command.solicitada_en, '2026-07-17T10:01:00.000Z');
    assert.equal(command.origen, 'legacy');

    const commandItemColumns = await context.db.getColumns('comanda_items');
    assert.ok(commandItemColumns.includes('pedido_producto_id'));
    assert.ok(commandItemColumns.includes('cantidad_delta'));
    assert.ok(commandItemColumns.includes('observacion_snapshot'));

    const requestColumns = await context.db.getColumns('solicitudes_kitchen');
    assert.ok(requestColumns.includes('clave_idempotencia'));
    assert.ok(requestColumns.includes('solicitud_fingerprint'));

    const marker = await context.db.get(`
        SELECT valor FROM configuracion WHERE clave = 'v3_3_kitchen_schema_ready'
    `);
    assert.ok(marker?.valor);
});

test('la reconstrucción legacy conserva snapshots de Kitchen y evita borrar comandas al eliminar una mesa', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await context.db.run('PRAGMA foreign_keys = OFF');
    await applySqlStatements(context.db, LEGACY_KITCHEN_SCHEMA);

    await context.db.run(`INSERT INTO usuarios VALUES (1, 'Salonero', 1)`);
    await context.db.run(`INSERT INTO mesas VALUES (1, 9, 'mesa', NULL, 'salon')`);
    await context.db.run(`INSERT INTO productos VALUES (1, 'Arroz con pollo', 1)`);
    await context.db.run(`INSERT INTO pedidos VALUES (1, 1, 'CTA-00000009', 'abierta')`);
    await context.db.run(`
        INSERT INTO pedido_productos (
            pedido_id, producto_id, cantidad, precio_unitario,
            precio_original, creado_en, presentacion_id
        ) VALUES (1, 1, 1, 3200, 3200, '2026-07-17T11:00:00.000Z', NULL)
    `);
    await context.db.run(`
        INSERT INTO comandas (
            mesa_id, productos_cocina, fecha_impresion, estado
        ) VALUES (1, '[{"producto_id":1,"cantidad":1}]', '2026-07-17T11:01:00.000Z', 'pendiente')
    `);

    await context.db.ensureConsumptionLineColumns();
    await context.db.ensureKitchenSchema();
    await context.db.run(`
        UPDATE pedido_productos
        SET observacion_snapshot = 'Sin cebolla',
            adicionales_snapshot = '["Arroz adicional"]',
            usuario_solicitante_id = 1,
            usuario_solicitante_nombre_snapshot = 'Salonero'
        WHERE id = 1
    `);
    await context.db.run(`
        UPDATE comandas
        SET pedido_id = 1,
            destino = 'cocina',
            estado_operativo = 'pendiente',
            estado_impresion = 'pendiente',
            usuario_solicitante_id = 1,
            usuario_solicitante_nombre_snapshot = 'Salonero',
            numero_cuenta_snapshot = 'CTA-00000009',
            mesa_numero_snapshot = 9,
            zona_nombre_snapshot = 'Salón',
            solicitada_en = '2026-07-17T11:01:00.000Z',
            origen = 'legacy',
            version = 2
        WHERE id = 1
    `);

    await context.db.rebuildLegacyForeignKeys();
    await context.db.ensureConsumptionLineColumns();
    await context.db.ensureKitchenSchema();
    await context.db.run('PRAGMA foreign_keys = ON');

    const line = await context.db.get('SELECT * FROM pedido_productos WHERE id = 1');
    assert.equal(line.observacion_snapshot, 'Sin cebolla');
    assert.equal(line.adicionales_snapshot, '["Arroz adicional"]');
    assert.equal(line.usuario_solicitante_nombre_snapshot, 'Salonero');

    const beforeDelete = await context.db.get('SELECT * FROM comandas WHERE id = 1');
    assert.equal(beforeDelete.pedido_id, 1);
    assert.equal(beforeDelete.numero_cuenta_snapshot, 'CTA-00000009');
    assert.equal(beforeDelete.usuario_solicitante_nombre_snapshot, 'Salonero');
    assert.equal(beforeDelete.version, 2);

    await context.db.run('DELETE FROM mesas WHERE id = 1');
    const afterDelete = await context.db.get('SELECT * FROM comandas WHERE id = 1');
    assert.ok(afterDelete);
    assert.equal(afterDelete.mesa_id, null);
    assert.equal(afterDelete.mesa_numero_snapshot, 9);
    assert.equal(afterDelete.numero_cuenta_snapshot, 'CTA-00000009');
});
