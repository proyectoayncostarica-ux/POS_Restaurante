const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase, applySqlStatements } = require('./helpers/testDatabase');
const {
    getCapabilitiesForUser,
    hasCapability,
    allCapabilityCodes
} = require('../server/services/capabilityService');

const CAPABILITY_SCHEMA = [
    `CREATE TABLE usuarios (id INTEGER PRIMARY KEY, nombre TEXT, tipo TEXT, activo INTEGER DEFAULT 1)`,
    `CREATE TABLE roles_trabajo (id INTEGER PRIMARY KEY, nombre TEXT, activo INTEGER DEFAULT 1)`,
    `CREATE TABLE usuario_roles_trabajo (usuario_id INTEGER, rol_trabajo_id INTEGER, PRIMARY KEY(usuario_id, rol_trabajo_id))`,
    `CREATE TABLE capacidades (id INTEGER PRIMARY KEY, codigo TEXT UNIQUE, activa INTEGER DEFAULT 1)`,
    `CREATE TABLE rol_trabajo_capacidades (rol_trabajo_id INTEGER, capacidad_id INTEGER, PRIMARY KEY(rol_trabajo_id, capacidad_id))`
];

test('cajero exclusivo obtiene capacidades de Caja sin depender de zona', async t => {
    const fixture = await createTestDatabase();
    t.after(() => fixture.cleanup());
    await applySqlStatements(fixture.db, CAPABILITY_SCHEMA);

    await fixture.db.run(`INSERT INTO usuarios VALUES (1, 'Ana', 'basico', 1)`);
    await fixture.db.run(`INSERT INTO roles_trabajo VALUES (10, 'Cajero', 1)`);
    await fixture.db.run(`INSERT INTO usuario_roles_trabajo VALUES (1, 10)`);
    await fixture.db.run(`INSERT INTO capacidades VALUES (100, 'cash.access', 1)`);
    await fixture.db.run(`INSERT INTO capacidades VALUES (101, 'cash.collect', 1)`);
    await fixture.db.run(`INSERT INTO rol_trabajo_capacidades VALUES (10, 100)`);
    await fixture.db.run(`INSERT INTO rol_trabajo_capacidades VALUES (10, 101)`);

    const codes = await getCapabilitiesForUser({ userId: 1, userType: 'basico', activeRoleIds: [10] }, fixture.db);
    assert.deepEqual(codes, ['cash.access', 'cash.collect']);
    assert.equal(hasCapability(codes, 'cash.collect'), true);
    assert.equal(hasCapability(codes, 'orders.operate'), false);
});

test('usuario mixto une capacidades de atención y Caja', async t => {
    const fixture = await createTestDatabase();
    t.after(() => fixture.cleanup());
    await applySqlStatements(fixture.db, CAPABILITY_SCHEMA);

    await fixture.db.run(`INSERT INTO usuarios VALUES (1, 'Andrey', 'basico', 1)`);
    await fixture.db.run(`INSERT INTO roles_trabajo VALUES (10, 'Salonero', 1)`);
    await fixture.db.run(`INSERT INTO roles_trabajo VALUES (11, 'Cajero', 1)`);
    await fixture.db.run(`INSERT INTO usuario_roles_trabajo VALUES (1, 10)`);
    await fixture.db.run(`INSERT INTO usuario_roles_trabajo VALUES (1, 11)`);
    await fixture.db.run(`INSERT INTO capacidades VALUES (100, 'orders.operate', 1)`);
    await fixture.db.run(`INSERT INTO capacidades VALUES (101, 'cash.access', 1)`);
    await fixture.db.run(`INSERT INTO rol_trabajo_capacidades VALUES (10, 100)`);
    await fixture.db.run(`INSERT INTO rol_trabajo_capacidades VALUES (11, 101)`);

    const codes = await getCapabilitiesForUser({ userId: 1, userType: 'basico', activeRoleIds: [10, 11] }, fixture.db);
    assert.deepEqual(codes, ['cash.access', 'orders.operate']);
});

test('administrador conserva todas las capacidades', async () => {
    const codes = await getCapabilitiesForUser({ userId: 1, userType: 'administrador', activeRoleIds: [] });
    assert.deepEqual(codes, allCapabilityCodes());
});
