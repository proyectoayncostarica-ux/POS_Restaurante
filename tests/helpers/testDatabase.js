const fs = require('fs/promises');
const os = require('os');
const path = require('path');
function loadDatabaseClass() {
    let restoreModuleLoader = null;
    try {
        require('sqlite3').verbose();
    } catch (error) {
        const Module = require('module');
        const originalLoad = Module._load;
        const sqliteFallback = require('./sqlite3Fallback');
        const bcryptFallback = require('./bcryptFallback');
        Module._load = function loadWithTestFallbacks(request, parent, isMain) {
            if (request === 'sqlite3') return sqliteFallback;
            if (request === 'bcryptjs') return bcryptFallback;
            return originalLoad.call(this, request, parent, isMain);
        };
        restoreModuleLoader = () => {
            Module._load = originalLoad;
        };
    }

    try {
        return require('../../server/db/database').Database;
    } finally {
        restoreModuleLoader?.();
    }
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
