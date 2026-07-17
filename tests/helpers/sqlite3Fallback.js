const { DatabaseSync } = require('node:sqlite');

function normalizeParams(params) {
    return Array.isArray(params) ? params : [];
}

class CompatibleDatabase {
    constructor(filename, callback) {
        try {
            this.database = new DatabaseSync(filename);
            queueMicrotask(() => callback?.(null));
        } catch (error) {
            queueMicrotask(() => callback?.(error));
        }
    }

    run(sql, params = [], callback) {
        try {
            const result = this.database.prepare(sql).run(...normalizeParams(params));
            const context = {
                lastID: Number(result.lastInsertRowid || 0),
                changes: Number(result.changes || 0)
            };
            queueMicrotask(() => callback?.call(context, null));
        } catch (error) {
            queueMicrotask(() => callback?.call({}, error));
        }
        return this;
    }

    get(sql, params = [], callback) {
        try {
            const row = this.database.prepare(sql).get(...normalizeParams(params));
            queueMicrotask(() => callback?.(null, row));
        } catch (error) {
            queueMicrotask(() => callback?.(error));
        }
        return this;
    }

    all(sql, params = [], callback) {
        try {
            const rows = this.database.prepare(sql).all(...normalizeParams(params));
            queueMicrotask(() => callback?.(null, rows));
        } catch (error) {
            queueMicrotask(() => callback?.(error));
        }
        return this;
    }

    close(callback) {
        try {
            this.database.close();
            queueMicrotask(() => callback?.(null));
        } catch (error) {
            queueMicrotask(() => callback?.(error));
        }
    }
}

module.exports = {
    verbose() {
        return module.exports;
    },
    Database: CompatibleDatabase
};
