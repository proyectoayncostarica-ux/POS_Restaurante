const fs = require('fs/promises');
const os = require('os');
const path = require('path');
function loadDatabaseClass() {
    try {
        require('sqlite3').verbose();
    } catch (error) {
        const sqlite3Path = require.resolve('sqlite3');
        require.cache[sqlite3Path] = {
            id: sqlite3Path,
            filename: sqlite3Path,
            loaded: true,
            exports: require('./sqlite3Fallback')
        };
    }

    return require('../../server/db/database').Database;
}

const Database = loadDatabaseClass();

async function createTestDatabase() {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-test-'));
    const dbPath = path.join(tempDir, 'test.db');
    const db = new Database({ dbPath });
    await db.connect();
    await db.run('PRAGMA foreign_keys = ON');

    return {
        db,
        dbPath,
        tempDir,
        async cleanup() {
            await db.close();
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    };
}

async function applySqlStatements(db, statements) {
    for (const statement of statements) {
        await db.run(statement);
    }
}

module.exports = {
    Database,
    createTestDatabase,
    applySqlStatements
};
