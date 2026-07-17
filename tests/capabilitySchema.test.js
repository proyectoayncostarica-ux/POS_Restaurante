const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Database } = require('./helpers/testDatabase');

test('inicialización v3.0.2 crea capacidades y rol Cajero sin zona', async t => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-capability-schema-'));
    const db = new Database({ dbPath: path.join(tempDir, 'test.db') });
    t.after(async () => {
        await db.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    await db.initializeDatabase();

    const cashier = await db.get(`SELECT * FROM roles_trabajo WHERE slug = 'cajero'`);
    assert.ok(cashier);
    assert.equal(Number(cashier.requiere_zona), 0);
    assert.equal(cashier.destino_inicial, 'cash');

    const capabilities = await db.all(`
        SELECT c.codigo
        FROM rol_trabajo_capacidades rtc
        INNER JOIN capacidades c ON c.id = rtc.capacidad_id
        WHERE rtc.rol_trabajo_id = ?
        ORDER BY c.codigo
    `, [cashier.id]);
    assert.deepEqual(capabilities.map(item => item.codigo), ['cash.access', 'cash.collect', 'cash.reprint']);
});
