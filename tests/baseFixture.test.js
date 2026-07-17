const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase, applySqlStatements } = require('./helpers/testDatabase');
const { BASE_SCHEMA, seedBaseFixture } = require('./fixtures/baseFixture');

test('el fixture temporal crea usuarios, roles, zonas, mesas, productos y pedidos', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());

    await applySqlStatements(context.db, BASE_SCHEMA);
    await seedBaseFixture(context.db);

    const counts = {};
    for (const table of ['usuarios', 'roles_trabajo', 'zonas', 'mesas', 'productos', 'pedidos']) {
        const row = await context.db.get(`SELECT COUNT(*) AS total FROM ${table}`);
        counts[table] = row.total;
    }

    assert.deepEqual(counts, {
        usuarios: 1,
        roles_trabajo: 1,
        zonas: 1,
        mesas: 1,
        productos: 1,
        pedidos: 1
    });
});
