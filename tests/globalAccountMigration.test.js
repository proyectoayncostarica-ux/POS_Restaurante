const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase, applySqlStatements } = require('./helpers/testDatabase');

const LEGACY_SCHEMA = [
    `CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT, tipo TEXT, activo INTEGER)`,
    `CREATE TABLE roles_trabajo (id INTEGER PRIMARY KEY, nombre TEXT)`,
    `CREATE TABLE zonas (id INTEGER PRIMARY KEY, nombre TEXT)`,
    `CREATE TABLE mesas (
        id INTEGER PRIMARY KEY, numero INTEGER, tipo_asiento TEXT, zona TEXT,
        zona_id INTEGER, estado TEXT, cliente_nombre TEXT
    )`,
    `CREATE TABLE mesa_responsables (
        mesa_id INTEGER, usuario_id INTEGER, rol_trabajo_id INTEGER,
        fecha_asignacion TEXT
    )`,
    `CREATE TABLE pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mesa_id INTEGER NOT NULL,
        usuario_id INTEGER NOT NULL,
        rol_trabajo_id INTEGER,
        fecha TEXT NOT NULL,
        estado TEXT NOT NULL,
        total REAL NOT NULL DEFAULT 0,
        cliente_nombre TEXT,
        aplica_servicio INTEGER,
        porcentaje_servicio REAL,
        monto_servicio REAL DEFAULT 0,
        total_con_servicio REAL
    )`,
    `CREATE TABLE pagos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pedido_id INTEGER,
        metodo_pago TEXT,
        monto REAL,
        fecha TEXT
    )`
];

test('migra pedidos legacy a cuentas globales numeradas y con snapshot financiero', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await applySqlStatements(context.db, LEGACY_SCHEMA);

    const date = '2026-07-15T10:00:00.000Z';
    await context.db.run(`INSERT INTO usuarios VALUES (1, 'Andrey', 'basico', 1)`);
    await context.db.run(`INSERT INTO roles_trabajo VALUES (2, 'Salonero')`);
    await context.db.run(`INSERT INTO zonas VALUES (3, 'Salón')`);
    await context.db.run(`INSERT INTO mesas VALUES (4, 1, 'mesa', 'salon', 3, 'ocupada', 'Juan')`);
    await context.db.run(`INSERT INTO mesa_responsables VALUES (4, 1, 2, ?)` , [date]);
    await context.db.run(`
        INSERT INTO pedidos (
            id, mesa_id, usuario_id, rol_trabajo_id, fecha, estado, total,
            cliente_nombre, aplica_servicio, porcentaje_servicio,
            monto_servicio, total_con_servicio
        ) VALUES (5, 4, 1, 2, ?, 'pendiente', 5000, 'Juan', 0, 0, 0, 5000)
    `, [date]);
    await context.db.run(`INSERT INTO pagos (pedido_id, metodo_pago, monto, fecha) VALUES (5, 'efectivo', 2000, ?)`, [date]);

    await context.db.ensureGlobalAccountColumns();
    await context.db.migrateGlobalAccounts();

    const account = await context.db.get('SELECT * FROM pedidos WHERE id = 5');
    assert.equal(account.numero_cuenta, 'CTA-00000005');
    assert.equal(account.estado_operativo, 'abierta');
    assert.equal(account.estado_financiero, 'parcial');
    assert.equal(account.total_pagado, 2000);
    assert.equal(account.saldo_pendiente, 3000);
    assert.equal(account.cliente_principal_snapshot, 'Juan');
    assert.equal(account.mesa_numero_snapshot, 1);
    assert.equal(account.zona_nombre_snapshot, 'Salón');

    const responsibility = await context.db.get('SELECT * FROM cuenta_responsables WHERE pedido_id = 5');
    assert.equal(responsibility.usuario_nombre_snapshot, 'Andrey');
    assert.equal(responsibility.rol_nombre_snapshot, 'Salonero');
});
