const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('sqlite3');
const { Database } = require('../server/db/database');

async function fixture(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-existing-only-'));
    const instances = [];
    t.after(async () => {
        await Promise.all(instances.map(db => db.close()));
        assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('mundipos-existing-only-'));
        await fs.rm(dir, { recursive: true, force: true });
    });
    const open = (file, mustExist = true) => {
        const db = new Database({ dbPath: path.join(dir, file), mustExist });
        instances.push(db);
        return db;
    };
    const seed = open('existing.db', false);
    await seed.connect();
    await seed.run('CREATE TABLE marker (value TEXT)');
    await seed.run("INSERT INTO marker VALUES ('original')");
    await seed.close();
    return { dir, open };
}

test('existing-only abre archivos existentes y transacciones sin inicialización ni cambios de esquema', async t => {
    const c = await fixture(t);
    const db = c.open('existing.db');
    db.initializeDatabase = () => assert.fail('No debe inicializar');
    await db.connect();
    assert.deepEqual(await db.get('SELECT * FROM marker'), { value: 'original' });
    assert.deepEqual(await db.withTransaction(tx => tx.get('SELECT * FROM marker')), { value: 'original' });
    assert.deepEqual((await db.all("SELECT name FROM sqlite_master WHERE type = 'table'")).map(row => row.name), ['marker']);
    assert.equal(sqlite3.OPEN_READWRITE & sqlite3.OPEN_CREATE, 0);
});

test('existing-only rechaza archivo ausente y no crea archivo ni directorios padre', async t => {
    const c = await fixture(t);
    const db = c.open('no-existe/subdir/restaurant.db');
    await assert.rejects(db.connect(), { code: 'SQLITE_CANTOPEN' });
    assert.equal(syncFs.existsSync(path.join(c.dir, 'no-existe')), false);
    assert.equal(syncFs.existsSync(db.dbPath), false);
    assert.equal(db.db, null);
});

test('openConnection y withTransaction también rechazan rutas inexistentes sin crearlas', async t => {
    const c = await fixture(t);
    const db = c.open('missing.db');
    await assert.rejects(db.openConnection(), { code: 'SQLITE_CANTOPEN' });
    await assert.rejects(db.withTransaction(() => assert.fail('No debe empezar')), { code: 'SQLITE_CANTOPEN' });
    assert.equal(syncFs.existsSync(db.dbPath), false);
});

test('una instancia conectada y cerrada no puede recrear su archivo en otra transacción', async t => {
    const c = await fixture(t);
    const db = c.open('existing.db');
    await db.connect();
    await db.close();
    assert.equal(path.dirname(db.dbPath), c.dir);
    await fs.unlink(db.dbPath);
    await assert.rejects(db.withTransaction(tx => tx.run('CREATE TABLE forbidden (id INTEGER)')), { code: 'SQLITE_CANTOPEN' });
    assert.equal(syncFs.existsSync(db.dbPath), false);
});

for (const entry of ['connect', 'openConnection']) {
    test(`${entry}: desaparición tras stat y justo antes de SQLite no recrea la DB`, async t => {
        const c = await fixture(t);
        const db = c.open('existing.db');
        assert.equal((await fs.stat(db.dbPath)).isFile(), true);
        const create = db.createSQLiteConnection.bind(db);
        db.createSQLiteConnection = callback => {
            assert.equal(path.dirname(db.dbPath), c.dir);
            syncFs.unlinkSync(db.dbPath);
            return create(callback);
        };
        await assert.rejects(db[entry](), { code: 'SQLITE_CANTOPEN' });
        assert.equal(syncFs.existsSync(db.dbPath), false);
    });
}

test('el default conserva creación histórica de directorio, archivo y transacciones', async t => {
    const c = await fixture(t);
    const db = new Database({ dbPath: path.join(c.dir, 'normal/subdir/new.db') });
    try {
        assert.equal(db.mustExist, false);
        await db.connect();
        await db.withTransaction(tx => tx.run('CREATE TABLE normal (id INTEGER)'));
        assert.equal((await fs.stat(db.dbPath)).isFile(), true);
    } finally { await db.close(); }
});

test('dos instancias independientes abren el mismo archivo existente y conservan datos', async t => {
    const c = await fixture(t);
    const a = c.open('existing.db');
    const b = c.open('existing.db');
    await a.connect();
    await b.connect();
    assert.notEqual(a.transactionStorage, b.transactionStorage);
    await a.withTransaction(tx => tx.run("UPDATE marker SET value = 'confirmed'"));
    assert.deepEqual(await b.withTransaction(tx => tx.get('SELECT * FROM marker')), { value: 'confirmed' });
});
