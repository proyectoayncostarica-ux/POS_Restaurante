const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase, applySqlStatements } = require('./helpers/testDatabase');

const LEGACY_LINE_SCHEMA = [
    `CREATE TABLE productos (id INTEGER PRIMARY KEY, nombre TEXT)`,
    `CREATE TABLE presentaciones (id INTEGER PRIMARY KEY, nombre TEXT, cantidad TEXT)`,
    `CREATE TABLE pedidos (
        id INTEGER PRIMARY KEY,
        aplica_servicio INTEGER,
        porcentaje_servicio REAL
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
    `CREATE TABLE configuracion (
        clave TEXT PRIMARY KEY,
        valor TEXT,
        version_app TEXT
    )`
];

test('migra líneas legacy con snapshots inmutables y cantidades disponibles', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await applySqlStatements(context.db, LEGACY_LINE_SCHEMA);

    const date = '2026-07-16T08:00:00.000Z';
    await context.db.run(`INSERT INTO productos VALUES (1, 'Imperial 350 ml')`);
    await context.db.run(`INSERT INTO presentaciones VALUES (2, 'Botella', '350 ml')`);
    await context.db.run(`INSERT INTO pedidos VALUES (3, 1, 10)`);
    await context.db.run(`
        INSERT INTO pedido_productos (
            pedido_id, producto_id, cantidad, precio_unitario,
            precio_original, creado_en, presentacion_id
        ) VALUES (3, 1, 3, 1000, 1000, ?, 2)
    `, [date]);

    await context.db.ensureConsumptionLineColumns();
    await context.db.migrateConsumptionLines();

    const migrated = await context.db.get('SELECT * FROM pedido_productos WHERE id = 1');
    assert.equal(migrated.cantidad_asignada, 0);
    assert.equal(migrated.producto_nombre_snapshot, 'Imperial 350 ml');
    assert.equal(migrated.presentacion_nombre_snapshot, 'Botella');
    assert.equal(migrated.presentacion_cantidad_snapshot, '350 ml');
    assert.equal(migrated.aplica_servicio_snapshot, 1);
    assert.equal(migrated.porcentaje_servicio_snapshot, 10);
    assert.equal(migrated.servicio_unitario_snapshot, 100);
    assert.equal(migrated.actualizado_en, date);
    assert.equal(migrated.version, 1);

    await context.db.run(`UPDATE productos SET nombre = 'Nombre cambiado' WHERE id = 1`);
    await context.db.run(`UPDATE pedidos SET porcentaje_servicio = 20 WHERE id = 3`);
    await context.db.migrateConsumptionLines();

    const secondRun = await context.db.get('SELECT * FROM pedido_productos WHERE id = 1');
    assert.equal(secondRun.producto_nombre_snapshot, 'Imperial 350 ml');
    assert.equal(secondRun.porcentaje_servicio_snapshot, 10);
    assert.equal(secondRun.servicio_unitario_snapshot, 100);

    const marker = await context.db.get(`
        SELECT valor FROM configuracion WHERE clave = 'v3_consumption_line_backfill_done'
    `);
    assert.ok(marker?.valor);
});
