const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const sqlite3Package = require('sqlite3/package.json');
const sqlite3 = require('sqlite3').verbose();

function openDatabase(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(db);
        });
    });
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(error) {
            if (error) {
                reject(error);
                return;
            }
            resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (error, row) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(row);
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(rows);
        });
    });
}

function closeDatabase(db) {
    return new Promise((resolve, reject) => {
        db.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

test('MundiPOS usa exactamente sqlite3 6.0.1', () => {
    assert.equal(sqlite3Package.version, '6.0.1');
});

test('el binario nativo abre SQLite, usa WAL y conserva integridad transaccional', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-sqlite3-v6-'));
    const dbPath = path.join(tempDir, 'compatibility.db');
    let db;

    t.after(async () => {
        if (db) {
            await closeDatabase(db).catch(() => {});
            db = null;
        }
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    db = await openDatabase(dbPath);

    const runtime = await get(db, 'SELECT sqlite_version() AS version');
    assert.match(runtime.version, /^3\./);

    await run(db, 'PRAGMA foreign_keys = ON');
    await run(db, 'PRAGMA busy_timeout = 5000');

    const journal = await get(db, 'PRAGMA journal_mode = WAL');
    assert.equal(String(journal.journal_mode).toLowerCase(), 'wal');

    await run(db, `
        CREATE TABLE parent (
            id INTEGER PRIMARY KEY,
            nombre TEXT NOT NULL
        )
    `);
    await run(db, `
        CREATE TABLE child (
            id INTEGER PRIMARY KEY,
            parent_id INTEGER NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES parent(id)
        )
    `);

    await run(db, 'BEGIN IMMEDIATE');
    await run(db, 'INSERT INTO parent (id, nombre) VALUES (?, ?)', [1, 'temporal']);
    await run(db, 'ROLLBACK');

    const rolledBack = await get(db, 'SELECT COUNT(*) AS total FROM parent');
    assert.equal(rolledBack.total, 0);

    await run(db, 'BEGIN IMMEDIATE');
    await run(db, 'INSERT INTO parent (id, nombre) VALUES (?, ?)', [1, 'persistente']);
    await run(db, 'COMMIT');

    const committed = await get(db, 'SELECT id, nombre FROM parent WHERE id = 1');
    assert.deepEqual(committed, { id: 1, nombre: 'persistente' });

    await assert.rejects(
        run(db, 'INSERT INTO child (id, parent_id) VALUES (?, ?)', [1, 999]),
        (error) => error && error.code === 'SQLITE_CONSTRAINT'
    );

    const compileOptions = await all(db, 'PRAGMA compile_options');
    assert.ok(compileOptions.length > 0);

    const integrity = await get(db, 'PRAGMA integrity_check');
    assert.equal(integrity.integrity_check, 'ok');
});
