const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');

test('provisiona de forma idempotente la cuenta departamental Cocina sin credenciales conocidas', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());

    await context.db.createTables();
    await context.db.migrateSchema();
    await context.db.insertInitialData();
    await context.db.insertInitialData();

    const accounts = await context.db.all(`
        SELECT id, nombre, tipo, clase_cuenta, cuenta_departamental_codigo, activo, password
        FROM usuarios
        WHERE clase_cuenta = 'departamental'
          AND cuenta_departamental_codigo = 'cocina'
    `);

    assert.equal(accounts.length, 1);
    const account = accounts[0];
    assert.equal(account.tipo, 'basico');
    assert.equal(account.clase_cuenta, 'departamental');
    assert.equal(account.cuenta_departamental_codigo, 'cocina');
    assert.equal(Number(account.activo), 0);
    assert.ok(String(account.password || '').length >= 20);
    assert.doesNotMatch(String(account.password || ''), /admin123|cocina123|password|^cocina$/i);

    const roles = await context.db.all(`
        SELECT rt.slug, rt.requiere_zona, rt.es_sistema, rt.destino_inicial
        FROM usuario_roles_trabajo urt
        INNER JOIN roles_trabajo rt ON rt.id = urt.rol_trabajo_id
        WHERE urt.usuario_id = ?
    `, [account.id]);

    assert.deepEqual(roles.map(role => ({ ...role })), [{
        slug: 'cocina',
        requiere_zona: 0,
        es_sistema: 1,
        destino_inicial: 'kitchen'
    }]);

    const capabilities = await context.db.all(`
        SELECT c.codigo
        FROM usuario_roles_trabajo urt
        INNER JOIN rol_trabajo_capacidades rtc ON rtc.rol_trabajo_id = urt.rol_trabajo_id
        INNER JOIN capacidades c ON c.id = rtc.capacidad_id AND c.activa = 1
        WHERE urt.usuario_id = ?
        ORDER BY c.codigo
    `, [account.id]);

    assert.deepEqual(capabilities.map(item => item.codigo), ['kitchen.operate']);
});
