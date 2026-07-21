const fs = require('fs');
const path = require('path');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const SESSION_TABLE = 'express_sessions';

function callbackOrNoop(callback) {
    return typeof callback === 'function' ? callback : () => {};
}

function resolveExpiresAt(storedSession = {}, defaultTtlMs = DEFAULT_TTL_MS) {
    const expires = storedSession?.cookie?.expires;
    if (expires) {
        const expiresAt = new Date(expires).getTime();
        if (Number.isFinite(expiresAt)) return expiresAt;
    }

    const maxAge = Number(storedSession?.cookie?.maxAge);
    if (Number.isFinite(maxAge)) return Date.now() + Math.max(0, maxAge);
    return Date.now() + defaultTtlMs;
}

class SQLiteSessionStore extends session.Store {
    constructor(options = {}) {
        super(options);
        if (!options.dbPath) throw new Error('SQLiteSessionStore requiere dbPath');

        this.dbPath = path.resolve(options.dbPath);
        this.defaultTtlMs = Number(options.defaultTtlMs) > 0 ? Number(options.defaultTtlMs) : DEFAULT_TTL_MS;
        this.cleanupIntervalMs = Number(options.cleanupIntervalMs) >= 0
            ? Number(options.cleanupIntervalMs)
            : DEFAULT_CLEANUP_INTERVAL_MS;
        this.expirationHandler = typeof options.expirationHandler === 'function'
            ? options.expirationHandler
            : null;
        this.deferInitialCleanup = Boolean(options.deferInitialCleanup);
        this.db = null;
        this.cleanupTimer = null;
        this.readyPromise = this.initialize();
    }

    async initialize() {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
        await new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, error => error ? reject(error) : resolve());
        });
        await this.run('PRAGMA journal_mode = WAL');
        await this.run('PRAGMA busy_timeout = 5000');
        await this.run(`CREATE TABLE IF NOT EXISTS ${SESSION_TABLE} (
            sid TEXT PRIMARY KEY,
            sess TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )`);
        await this.run(`CREATE INDEX IF NOT EXISTS idx_${SESSION_TABLE}_expires_at
            ON ${SESSION_TABLE} (expires_at)`);
        if (!this.deferInitialCleanup || this.expirationHandler) {
            await this.deleteExpired();
        }

        if (this.cleanupIntervalMs > 0) {
            this.cleanupTimer = setInterval(() => {
                this.deleteExpired().catch(error => this.emit('disconnect', error));
            }, this.cleanupIntervalMs);
            this.cleanupTimer.unref?.();
        }
        this.emit('connect');
        return this;
    }

    ready() {
        return this.readyPromise;
    }

    setExpirationHandler(handler) {
        if (handler !== null && typeof handler !== 'function') {
            throw new TypeError('expirationHandler debe ser una función o null');
        }
        this.expirationHandler = handler;
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function onRun(error) {
                if (error) return reject(error);
                resolve({ changes: this.changes, lastID: this.lastID });
            });
        });
    }

    queryGet(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
        });
    }

    queryAll(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (error, rows = []) => error ? reject(error) : resolve(rows));
        });
    }

    async processExpiredRow(row) {
        if (this.expirationHandler) {
            let parsedSession = null;
            try {
                parsedSession = JSON.parse(row.sess);
            } catch (error) {
                this.emit('expirationError', error);
            }

            try {
                await this.expirationHandler({
                    sid: row.sid,
                    session: parsedSession,
                    expiresAt: Number(row.expires_at)
                });
            } catch (error) {
                this.emit('expirationError', error);
                return false;
            }
        }

        await this.run(
            `DELETE FROM ${SESSION_TABLE} WHERE sid = ? AND expires_at <= ?`,
            [row.sid, Date.now()]
        );
        return true;
    }

    async deleteExpired() {
        if (!this.db) await this.ready();
        const rows = await this.queryAll(
            `SELECT sid, sess, expires_at FROM ${SESSION_TABLE} WHERE expires_at <= ? ORDER BY expires_at, sid`,
            [Date.now()]
        );
        let changes = 0;
        for (const row of rows) {
            if (await this.processExpiredRow(row)) changes += 1;
        }
        return { changes };
    }

    get(sid, callback) {
        const done = callbackOrNoop(callback);
        this.ready().then(async () => {
            const row = await this.queryGet(
                `SELECT sid, sess, expires_at FROM ${SESSION_TABLE} WHERE sid = ?`,
                [sid]
            );
            if (!row) return done(null, null);
            if (Number(row.expires_at) <= Date.now()) {
                await this.processExpiredRow(row);
                return done(null, null);
            }
            try {
                done(null, JSON.parse(row.sess));
            } catch (parseError) {
                done(parseError);
            }
        }).catch(done);
    }

    set(sid, storedSession, callback) {
        const done = callbackOrNoop(callback);
        let serializedSession;
        try {
            serializedSession = JSON.stringify(storedSession);
        } catch (error) {
            return done(error);
        }
        const expiresAt = resolveExpiresAt(storedSession, this.defaultTtlMs);
        this.ready().then(() => {
            this.db.run(`INSERT OR REPLACE INTO ${SESSION_TABLE} (sid, sess, expires_at) VALUES (?, ?, ?)`,
                [sid, serializedSession, expiresAt], error => done(error || null));
        }).catch(done);
    }

    destroy(sid, callback) {
        const done = callbackOrNoop(callback);
        this.ready().then(() => {
            this.db.run(`DELETE FROM ${SESSION_TABLE} WHERE sid = ?`, [sid], error => done(error || null));
        }).catch(done);
    }

    touch(sid, storedSession, callback) {
        const done = callbackOrNoop(callback);
        const expiresAt = resolveExpiresAt(storedSession, this.defaultTtlMs);
        this.ready().then(async () => {
            const row = await this.queryGet(
                `SELECT sid, sess, expires_at FROM ${SESSION_TABLE} WHERE sid = ?`,
                [sid]
            );
            if (!row) return done(null);
            if (Number(row.expires_at) <= Date.now()) {
                await this.processExpiredRow(row);
                return done(null);
            }
            await this.run(
                `UPDATE ${SESSION_TABLE} SET expires_at = ? WHERE sid = ? AND expires_at > ?`,
                [expiresAt, sid, Date.now()]
            );
            done(null);
        }).catch(done);
    }

    all(callback) {
        const done = callbackOrNoop(callback);
        this.ready().then(async () => {
            await this.deleteExpired();
            const rows = await this.queryAll(
                `SELECT sess FROM ${SESSION_TABLE} WHERE expires_at > ? ORDER BY sid`,
                [Date.now()]
            );
            done(null, rows.map(row => JSON.parse(row.sess)));
        }).catch(done);
    }

    length(callback) {
        const done = callbackOrNoop(callback);
        this.ready().then(async () => {
            await this.deleteExpired();
            const row = await this.queryGet(
                `SELECT COUNT(*) AS total FROM ${SESSION_TABLE} WHERE expires_at > ?`,
                [Date.now()]
            );
            done(null, Number(row?.total || 0));
        }).catch(done);
    }

    clear(callback) {
        const done = callbackOrNoop(callback);
        this.ready().then(() => {
            this.db.run(`DELETE FROM ${SESSION_TABLE}`, error => done(error || null));
        }).catch(done);
    }

    async listActiveSessions() {
        await this.ready();
        await this.deleteExpired();
        const rows = await this.queryAll(
            `SELECT sid, sess, expires_at FROM ${SESSION_TABLE} WHERE expires_at > ? ORDER BY sid`,
            [Date.now()]
        );
        return rows.map(row => ({
            sid: row.sid,
            session: JSON.parse(row.sess),
            expiresAt: Number(row.expires_at)
        }));
    }

    close(callback) {
        const done = callbackOrNoop(callback);
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.ready().then(() => {
            if (!this.db) return done(null);
            this.db.close(error => {
                if (!error) this.db = null;
                done(error || null);
            });
        }).catch(done);
    }
}

module.exports = {
    SQLiteSessionStore,
    DEFAULT_TTL_MS,
    DEFAULT_CLEANUP_INTERVAL_MS,
    resolveExpiresAt
};
