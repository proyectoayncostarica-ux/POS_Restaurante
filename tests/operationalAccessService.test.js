const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase, applySqlStatements } = require('./helpers/testDatabase');
const {
    resolveAccessContext,
    canOpenSection,
    buildZoneFilter,
    evaluateMesaAccess,
    canReceiveRealtimeEvent
} = require('../server/services/operationalAccessService');

const ACCESS_SCHEMA = [
    `CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY,
        nombre TEXT,
        tipo TEXT,
        activo INTEGER DEFAULT 1
    )`,
    `CREATE TABLE roles_trabajo (
        id INTEGER PRIMARY KEY,
        nombre TEXT,
        activo INTEGER DEFAULT 1
    )`,
    `CREATE TABLE usuario_roles_trabajo (
        usuario_id INTEGER,
        rol_trabajo_id INTEGER,
        PRIMARY KEY(usuario_id, rol_trabajo_id)
    )`,
    `CREATE TABLE capacidades (
        id INTEGER PRIMARY KEY,
        codigo TEXT UNIQUE,
        activa INTEGER DEFAULT 1
    )`,
    `CREATE TABLE rol_trabajo_capacidades (
        rol_trabajo_id INTEGER,
        capacidad_id INTEGER,
        PRIMARY KEY(rol_trabajo_id, capacidad_id)
    )`,
    `CREATE TABLE zonas (
        id INTEGER PRIMARY KEY,
        nombre TEXT,
        activa INTEGER DEFAULT 1
    )`,
    `CREATE TABLE rol_trabajo_zonas (
        rol_trabajo_id INTEGER,
        zona_id INTEGER,
        PRIMARY KEY(rol_trabajo_id, zona_id)
    )`,
    `CREATE TABLE mesas (
        id INTEGER PRIMARY KEY,
        numero INTEGER,
        zona_id INTEGER,
        estado TEXT
    )`,
    `CREATE TABLE mesa_responsables (
        mesa_id INTEGER,
        usuario_id INTEGER,
        PRIMARY KEY(mesa_id, usuario_id)
    )`
];

async function seedAccessFixture(db) {
    await db.run(`INSERT INTO usuarios VALUES (1, 'Andrey', 'basico', 1)`);
    await db.run(`INSERT INTO usuarios VALUES (2, 'Ana', 'basico', 1)`);
    await db.run(`INSERT INTO usuarios VALUES (3, 'Admin', 'administrador', 1)`);
    await db.run(`INSERT INTO roles_trabajo VALUES (10, 'Salonero', 1)`);
    await db.run(`INSERT INTO roles_trabajo VALUES (11, 'Cajero', 1)`);
    await db.run(`INSERT INTO usuario_roles_trabajo VALUES (1, 10)`);
    await db.run(`INSERT INTO usuario_roles_trabajo VALUES (1, 11)`);
    await db.run(`INSERT INTO usuario_roles_trabajo VALUES (2, 11)`);
    await db.run(`INSERT INTO capacidades VALUES (100, 'orders.operate', 1)`);
    await db.run(`INSERT INTO capacidades VALUES (101, 'orders.split', 1)`);
    await db.run(`INSERT INTO capacidades VALUES (102, 'cash.access', 1)`);
    await db.run(`INSERT INTO capacidades VALUES (103, 'cash.collect', 1)`);
    await db.run(`INSERT INTO rol_trabajo_capacidades VALUES (10, 100)`);
    await db.run(`INSERT INTO rol_trabajo_capacidades VALUES (10, 101)`);
    await db.run(`INSERT INTO rol_trabajo_capacidades VALUES (11, 102)`);
    await db.run(`INSERT INTO rol_trabajo_capacidades VALUES (11, 103)`);
    await db.run(`INSERT INTO zonas VALUES (20, 'Salón', 1)`);
    await db.run(`INSERT INTO zonas VALUES (21, 'Bar', 1)`);
    await db.run(`INSERT INTO rol_trabajo_zonas VALUES (10, 20)`);
    await db.run(`INSERT INTO mesas VALUES (30, 1, 20, 'ocupada')`);
    await db.run(`INSERT INTO mesas VALUES (31, 2, 21, 'ocupada')`);
    await db.run(`INSERT INTO mesa_responsables VALUES (30, 1)`);
}

function requestWithSession(userId, userType, activeWorkRoleIds) {
    return {
        session: {
            userId,
            userType,
            activeWorkRoleIds
        }
    };
}

test('usuario mixto recibe una política única de atención, Caja y zona', async t => {
    const fixture = await createTestDatabase();
    t.after(() => fixture.cleanup());
    await applySqlStatements(fixture.db, ACCESS_SCHEMA);
    await seedAccessFixture(fixture.db);

    const context = await resolveAccessContext(
        requestWithSession(1, 'basico', [10, 11]),
        fixture.db
    );

    assert.deepEqual(context.capabilities, [
        'cash.access',
        'cash.collect',
        'orders.operate',
        'orders.split'
    ]);
    assert.deepEqual(context.zoneIds, [20]);
    assert.equal(canOpenSection(context, 'dashboard'), true);
    assert.equal(canOpenSection(context, 'cash'), true);

    const filter = buildZoneFilter(context, { alias: 'm' });
    assert.equal(filter.clause, 'm.zona_id IN (?)');
    assert.deepEqual(filter.params, [20]);
});

test('cajero exclusivo puede abrir Caja pero no recibe datos operativos de mesas', async t => {
    const fixture = await createTestDatabase();
    t.after(() => fixture.cleanup());
    await applySqlStatements(fixture.db, ACCESS_SCHEMA);
    await seedAccessFixture(fixture.db);

    const context = await resolveAccessContext(
        requestWithSession(2, 'basico', [11]),
        fixture.db
    );

    assert.deepEqual(context.zoneIds, []);
    assert.equal(canOpenSection(context, 'cash'), true);
    assert.equal(canOpenSection(context, 'dashboard'), false);
    assert.equal(canReceiveRealtimeEvent(context, {
        scope: 'caja',
        global: true
    }), true);
    assert.equal(canReceiveRealtimeEvent(context, {
        scope: 'pedidos',
        zoneIds: [20]
    }), false);
    assert.equal(canReceiveRealtimeEvent(context, {
        scope: 'pedidos',
        zoneIds: [20],
        targetUserIds: [2]
    }), false, 'ser usuario objetivo no debe omitir la capacidad requerida');
});

test('realtime por zona no filtra eventos de otra zona ni eventos sin contexto', async t => {
    const fixture = await createTestDatabase();
    t.after(() => fixture.cleanup());
    await applySqlStatements(fixture.db, ACCESS_SCHEMA);
    await seedAccessFixture(fixture.db);

    const context = await resolveAccessContext(
        requestWithSession(1, 'basico', [10]),
        fixture.db
    );

    assert.equal(canReceiveRealtimeEvent(context, {
        scope: 'pedidos',
        zoneIds: [20]
    }), true);
    assert.equal(canReceiveRealtimeEvent(context, {
        scope: 'pedidos',
        zoneIds: [21]
    }), false);
    assert.equal(canReceiveRealtimeEvent(context, {
        scope: 'pedidos'
    }), false);
    assert.equal(canReceiveRealtimeEvent(context, {
        scope: 'sesion',
        targetUserIds: [1]
    }), true);
});

test('responsabilidad de mesa usa la misma política compartida', async t => {
    const fixture = await createTestDatabase();
    t.after(() => fixture.cleanup());
    await applySqlStatements(fixture.db, ACCESS_SCHEMA);
    await seedAccessFixture(fixture.db);

    const waiter = await resolveAccessContext(
        requestWithSession(1, 'basico', [10]),
        fixture.db
    );
    const cashier = await resolveAccessContext(
        requestWithSession(2, 'basico', [11]),
        fixture.db
    );

    const waiterMesa = await evaluateMesaAccess(waiter, {
        id: 30,
        zona_id: 20,
        estado: 'ocupada'
    }, fixture.db);
    const otherZone = await evaluateMesaAccess(waiter, {
        id: 31,
        zona_id: 21,
        estado: 'ocupada'
    }, fixture.db);
    const cashierMesa = await evaluateMesaAccess(cashier, {
        id: 30,
        zona_id: 20,
        estado: 'ocupada'
    }, fixture.db);

    assert.equal(waiterMesa.visible, true);
    assert.equal(waiterMesa.operable, true);
    assert.equal(waiterMesa.isResponsible, true);
    assert.equal(otherZone.visible, false);
    assert.equal(otherZone.operable, false);
    assert.equal(cashierMesa.visible, false);
    assert.equal(cashierMesa.operable, false);
    assert.equal(cashierMesa.canCollect, true);
});
