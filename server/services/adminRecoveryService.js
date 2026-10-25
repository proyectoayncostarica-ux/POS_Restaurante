const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { InstallationStateService } = require('./installationStateService');

const TABLE = 'admin_recovery_operations';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = ['reactivate', 'reset_password', 'create_admin'];
const REASON = 'recuperacion_administrativa_local';
const CREATE_TABLE = `CREATE TABLE ${TABLE} (
    operation_id TEXT PRIMARY KEY NOT NULL CHECK(length(operation_id) = 36),
    installation_id TEXT NOT NULL,
    origin TEXT NOT NULL CHECK(origin IN ('created_empty', 'adopted_legacy')),
    action TEXT NOT NULL CHECK(action IN ('reactivate', 'reset_password', 'create_admin')),
    target_user_id INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
    target_user_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    main_db_path TEXT,
    sessions_db_path TEXT,
    affected_user_ids TEXT NOT NULL,
    affected_session_uuids TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('PREPARED', 'COMPLETED')),
    created_at TEXT NOT NULL,
    completed_at TEXT,
    audit_id INTEGER UNIQUE REFERENCES historial_transacciones(id) ON DELETE RESTRICT,
    CHECK(action = 'create_admin' OR target_user_id IS NOT NULL),
    CHECK((state = 'PREPARED' AND completed_at IS NULL AND audit_id IS NULL)
        OR (state = 'COMPLETED' AND target_user_id IS NOT NULL AND completed_at IS NOT NULL AND audit_id IS NOT NULL))
)`;
const CREATE_INDEX = `CREATE UNIQUE INDEX idx_admin_recovery_prepared ON ${TABLE}(state) WHERE state = 'PREPARED'`;
const MESSAGES = {
    INPUT: 'Entrada de recuperación inválida.',
    DEPENDENCY_CONTRACT: 'Ambas bases deben exponer transactionStorage.getStore para verificar el contexto transaccional.',
    METADATA: 'La instalación no tiene metadata IDENTIFIED válida.',
    INCONSISTENT: 'La estructura o los datos de mantenimiento son inconsistentes.',
    ACTIVE_ADMIN: 'Ya existe un administrador activo. No se permite recuperación.',
    CANDIDATE: 'El ID seleccionado no corresponde a un Admin humano desactivado.',
    RECOVERABLE_ADMIN: 'Existe un Admin humano desactivado; debe recuperarse esa cuenta.',
    NAME_EXISTS: 'El nombre solicitado ya está ocupado.',
    PASSWORD: 'La contraseña conocida no es válida.',
    CHANGED: 'El candidato cambió durante la operación. Revalide antes de reintentar.',
    PENDING: 'Existe una recuperación PREPARED. Debe reanudarse con su operationId.',
    MISMATCH: 'La operación no corresponde a los parámetros o a estas bases de datos.',
    SESSIONS: 'No se puede determinar con seguridad el alcance de las sesiones técnicas.',
    SCOPE_CHANGED: 'Cambió el alcance de sesiones. Reanude la misma operación para registrarlo.',
    TRANSACTION_CONTEXT: 'Recovery debe ejecutarse fuera de transacciones existentes de ambas bases.',
    STORAGE: 'No se pudo confirmar la recuperación. Consulte el estado de la operación antes de reintentar.'
};

class RecoveryError extends Error {
    constructor(key, operationId) {
        super(MESSAGES[key]);
        this.code = `ADMIN_RECOVERY_${key}`;
        if (operationId) this.operationId = operationId;
    }
}

const fail = (key, operationId) => { throw new RecoveryError(key, operationId); };
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const normalizedSql = sql => String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
const union = (left, right) => [...new Set([...left, ...right])].sort();

class AdminRecoveryService {
    constructor({ db, sessionDb, clock = () => new Date().toISOString(), uuidFactory = () => crypto.randomUUID() } = {}) {
        if (!db || !sessionDb || db === sessionDb
            || [db, sessionDb].some(item => !['get', 'all', 'run', 'withTransaction'].every(key => typeof item[key] === 'function'))
            || (db.dbPath && db.dbPath === sessionDb.dbPath)) throw new RecoveryError('INPUT');
        if ([db, sessionDb].some(item => !item.transactionStorage
            || typeof item.transactionStorage.getStore !== 'function')) throw new RecoveryError('DEPENDENCY_CONTRACT');
        this.db = db;
        this.sessionDb = sessionDb;
        this.clock = clock;
        this.uuidFactory = uuidFactory;
        this.installation = new InstallationStateService({ db });
    }

    async safe(work) {
        try { return await work(); } catch (error) {
            // Los errores sqlite3.verbose pueden contener parámetros: no propagarlos ni loguearlos.
            throw error instanceof RecoveryError ? error : new RecoveryError('STORAGE');
        }
    }

    async metadata(db) {
        let row;
        try { row = await this.installation.loadInstallationState(db); } catch { fail('METADATA'); }
        if (!row || row.state !== 'IDENTIFIED') fail('METADATA');
        return row;
    }

    async operations(db, create = false) {
        const table = await db.get('SELECT type, sql FROM sqlite_master WHERE lower(name) = ?', [TABLE]);
        if (!table) {
            if (!create) return [];
            await db.run(CREATE_TABLE);
            await db.run(CREATE_INDEX);
        } else {
            const index = await db.get("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_admin_recovery_prepared'");
            if (table.type !== 'table' || normalizedSql(table.sql) !== normalizedSql(CREATE_TABLE)
                || !index || normalizedSql(index.sql) !== normalizedSql(CREATE_INDEX)) fail('INCONSISTENT');
        }
        const rows = await db.all(`SELECT * FROM ${TABLE}`);
        for (const row of rows) {
            if (!UUID.test(row.operation_id) || !UUID.test(row.installation_id)
                || !ACTIONS.includes(row.action) || !['created_empty', 'adopted_legacy'].includes(row.origin)
                || !['PREPARED', 'COMPLETED'].includes(row.state) || !text(row.reason, 500)
                || !text(row.target_user_name, 255) || !date(row.created_at)
                || (row.target_user_id !== null && !positiveId(row.target_user_id))
                || (row.action !== 'create_admin' && row.target_user_id === null)
                || (row.state === 'PREPARED' && (row.completed_at !== null || row.audit_id !== null))
                || (row.state === 'COMPLETED' && (!positiveId(row.target_user_id) || !positiveId(row.audit_id)
                    || !date(row.completed_at) || Date.parse(row.completed_at) < Date.parse(row.created_at)))) fail('INCONSISTENT');
            this.scopeFromOperation(row);
        }
        if (rows.filter(row => row.state === 'PREPARED').length > 1) fail('INCONSISTENT');
        return rows;
    }

    scopeFromOperation(row) {
        let users, sessions;
        try { users = JSON.parse(row.affected_user_ids); sessions = JSON.parse(row.affected_session_uuids); } catch { fail('INCONSISTENT'); }
        if (!Array.isArray(users) || !users.every(positiveId) || new Set(users).size !== users.length
            || !Array.isArray(sessions) || !sessions.every(value => text(value, 120))
            || new Set(sessions).size !== sessions.length) fail('INCONSISTENT');
        return { users, sessions };
    }

    bind(row, metadata) {
        if (row.installation_id !== metadata.installation_id || row.origin !== metadata.origin
            || row.main_db_path !== (this.db.dbPath || null)
            || row.sessions_db_path !== (this.sessionDb.dbPath || null)) fail('MISMATCH');
    }

    async mainState(db, plan) {
        const integrity = await db.all('PRAGMA quick_check');
        if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok'
            || (await db.all('PRAGMA foreign_key_check')).length) fail('INCONSISTENT');
        const users = await db.all('SELECT id, nombre, password, tipo, clase_cuenta, cuenta_departamental_codigo, activo, fecha_creacion FROM usuarios');
        const admins = users.filter(user => user.tipo === 'administrador');
        if (admins.some(user => user.clase_cuenta !== 'humana' || user.cuenta_departamental_codigo !== null
            || ![0, 1].includes(user.activo) || typeof user.password !== 'string'
            || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(user.password))) fail('INCONSISTENT');
        const kitchenAdmin = await db.get(`SELECT u.id FROM usuarios u
            JOIN usuario_roles_trabajo ur ON ur.usuario_id = u.id
            JOIN roles_trabajo r ON r.id = ur.rol_trabajo_id
            WHERE u.tipo = 'administrador' AND r.slug = 'cocina' LIMIT 1`);
        if (kitchenAdmin) fail('INCONSISTENT');
        if (admins.some(user => user.activo === 1)) fail('ACTIVE_ADMIN');
        const candidate = users.find(user => user.id === plan.target_user_id);
        if (plan.action === 'create_admin') {
            if (admins.length) fail('RECOVERABLE_ADMIN');
            if (users.some(user => user.nombre.toLowerCase() === plan.target_user_name.toLowerCase())) fail('NAME_EXISTS');
        } else {
            if (!candidate || !admins.includes(candidate) || candidate.activo !== 0) fail('CANDIDATE');
            if (plan.target_user_name && plan.target_user_name !== candidate.nombre) fail('CHANGED');
        }
        const history = await db.all('SELECT session_uuid, usuario_id, express_session_id, estado FROM sesiones_usuario');
        if (history.some(row => !text(row.session_uuid, 120) || !positiveId(row.usuario_id)
            || !text(row.express_session_id, 512)
            || !['activa', 'cerrada', 'revocada', 'reemplazada', 'expirada'].includes(row.estado))) fail('INCONSISTENT');
        return { users, admins, candidate, history };
    }

    async sessionScope(db, state, targetId) {
        const integrity = await db.all('PRAGMA quick_check');
        if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') fail('SESSIONS');
        const users = new Set(state.admins.map(user => user.id));
        if (targetId) users.add(targetId);
        const matches = [];
        const sessions = new Set();
        const rows = await db.all('SELECT sid, sess, expires_at FROM express_sessions');
        for (const row of rows) {
            let stored;
            try { stored = JSON.parse(row.sess); } catch { fail('SESSIONS'); }
            if (!text(row.sid, 512) || !Number.isFinite(row.expires_at)
                || !stored || typeof stored !== 'object' || Array.isArray(stored)) fail('SESSIONS');
            if (stored.userId != null && typeof stored.userId !== 'number'
                && !(typeof stored.userId === 'string' && /^[1-9]\d*$/.test(stored.userId))) fail('SESSIONS');
            const userId = stored.userId == null ? null : Number(stored.userId);
            if (stored.userType != null && typeof stored.userType !== 'string') fail('SESSIONS');
            const type = stored.userType == null ? '' : stored.userType.trim().toLowerCase();
            if ((userId !== null && !positiveId(userId)) || !['', 'basico', 'administrador', 'admin'].includes(type)
                || (userId === null && type)
                || (userId !== null && !state.users.some(user => user.id === userId))) fail('SESSIONS');
            if (!users.has(userId) && type !== 'administrador' && type !== 'admin') continue;
            matches.push(row);
            for (const history of state.history) {
                // SID puede haberse reutilizado por otro usuario: no revocar por SID solamente.
                if (history.estado === 'activa' && history.usuario_id === userId
                    && history.express_session_id === row.sid) sessions.add(history.session_uuid);
            }
        }
        return { users: [...users], sessions: [...sessions], matches };
    }

    plan(input, existing) {
        if (existing) {
            if ((input.action !== undefined && input.action !== existing.action)
                || (input.targetUserId !== undefined && input.targetUserId !== existing.target_user_id)
                || (input.targetUserName !== undefined && input.targetUserName.trim() !== existing.target_user_name)
                || (input.reason !== undefined && input.reason.trim() !== existing.reason)) fail('MISMATCH');
            return existing;
        }
        if (!ACTIONS.includes(input.action) || !text(input.reason, 500)) fail('INPUT');
        const name = typeof input.targetUserName === 'string' ? input.targetUserName.trim() : '';
        if (input.action === 'create_admin' ? !/^[a-zA-Z0-9._-]{3,40}$/.test(name) : !positiveId(input.targetUserId)) fail('INPUT');
        return { action: input.action, target_user_id: input.action === 'create_admin' ? null : input.targetUserId,
            target_user_name: name, reason: input.reason.trim() };
    }

    async completed(db, row) {
        const audit = await db.get('SELECT * FROM historial_transacciones WHERE id = ?', [row.audit_id]);
        if (!audit || audit.tipo_accion !== 'admin_recovery' || audit.usuario_id !== null
            || audit.descripcion !== JSON.stringify(this.audit(row))) fail('INCONSISTENT');
        return row;
    }

    audit(row) {
        return { version: 1, event: 'admin_recovery', operationId: row.operation_id,
            installationId: row.installation_id, origin: row.origin, action: row.action,
            targetUserId: row.target_user_id, targetUserName: row.target_user_name,
            reason: row.reason, result: 'completed', context: 'local_maintenance' };
    }

    getOperation(operationId) {
        return this.safe(() => this.db.withTransaction(async db => {
            if (typeof operationId !== 'string' || !UUID.test(operationId)) fail('INPUT');
            operationId = operationId.toLowerCase();
            const metadata = await this.metadata(db);
            const row = (await this.operations(db)).find(item => item.operation_id === operationId) || null;
            if (row) this.bind(row, metadata);
            return row?.state === 'COMPLETED' ? this.completed(db, row) : row;
        }, { mode: 'DEFERRED' }));
    }

    getPendingOperation() {
        return this.safe(() => this.db.withTransaction(async db => {
            const metadata = await this.metadata(db);
            const row = (await this.operations(db)).find(item => item.state === 'PREPARED') || null;
            if (row) this.bind(row, metadata);
            return row;
        }, { mode: 'DEFERRED' }));
    }

    recover(input = {}) {
        return this.safe(async () => {
            // Un savepoint externo no garantiza que PREPARED quede confirmado antes del commit técnico.
            if (this.db.transactionStorage.getStore() || this.sessionDb.transactionStorage.getStore()) fail('TRANSACTION_CONTEXT');
            const requestedId = input.operationId ?? this.uuidFactory();
            if (typeof requestedId !== 'string' || !UUID.test(requestedId)) fail('INPUT');
            const operationId = requestedId.toLowerCase();
            const attempt = await this.db.withTransaction(async db => {
                const metadata = await this.metadata(db);
                const rows = await this.operations(db);
                const existing = rows.find(row => row.operation_id === operationId);
                const plan = this.plan(input, existing);
                if (existing) this.bind(existing, metadata);
                if (existing?.state === 'COMPLETED') return { completed: await this.completed(db, existing) };
                const pending = rows.find(row => row.state === 'PREPARED' && row.operation_id !== operationId);
                if (pending) fail('PENDING', pending.operation_id);
                const state = await this.mainState(db, plan);
                if (state.candidate) plan.target_user_name = state.candidate.nombre;
                await this.sessionScope(this.sessionDb, state, plan.target_user_id);
                return { plan, metadata, expectedHash: state.candidate?.password };
            }, { mode: 'DEFERRED' });
            if (attempt.completed) return attempt.completed;
            const { plan, expectedHash } = attempt;
            let passwordHash;
            if (plan.action === 'reactivate') {
                if (typeof input.password !== 'string' || !await bcrypt.compare(input.password, expectedHash)) fail('PASSWORD');
            } else {
                const minimum = plan.action === 'create_admin' ? 8 : 6;
                if (typeof input.newPassword !== 'string' || input.newPassword.length < minimum) fail('INPUT');
                passwordHash = await bcrypt.hash(input.newPassword, 10);
            }
            const prepared = await this.db.withTransaction(async db => {
                const metadata = await this.metadata(db);
                const rows = await this.operations(db);
                const existing = rows.find(row => row.operation_id === operationId);
                if (existing) {
                    this.bind(existing, metadata);
                    this.plan(input, existing);
                    if (existing.state === 'COMPLETED') return this.completed(db, existing);
                }
                const pending = rows.find(row => row.state === 'PREPARED' && row.operation_id !== operationId);
                if (pending) fail('PENDING', pending.operation_id);
                if (metadata.installation_id !== attempt.metadata.installation_id || metadata.origin !== attempt.metadata.origin) fail('MISMATCH');
                const state = await this.mainState(db, plan);
                if (state.candidate?.password !== expectedHash) fail('CHANGED');
                const scope = await this.sessionDb.withTransaction(tx => this.sessionScope(tx, state, plan.target_user_id), { mode: 'DEFERRED' });
                const previous = existing ? this.scopeFromOperation(existing) : { users: [], sessions: [] };
                await this.operations(db, true);
                if (!existing) {
                    const now = this.clock();
                    if (!date(now)) fail('INPUT');
                    await db.run(`INSERT INTO ${TABLE} (operation_id, installation_id, origin, action,
                        target_user_id, target_user_name, reason, main_db_path, sessions_db_path,
                        affected_user_ids, affected_session_uuids, state, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARED', ?)`,
                    [operationId, metadata.installation_id, metadata.origin, plan.action, plan.target_user_id,
                        plan.target_user_name, plan.reason, this.db.dbPath || null, this.sessionDb.dbPath || null,
                        JSON.stringify(scope.users), JSON.stringify(scope.sessions), now]);
                } else {
                    await db.run(`UPDATE ${TABLE} SET affected_user_ids = ?, affected_session_uuids = ?
                        WHERE operation_id = ? AND state = 'PREPARED'`,
                    [JSON.stringify(union(previous.users, scope.users)), JSON.stringify(union(previous.sessions, scope.sessions)), operationId]);
                }
                if (JSON.stringify(await this.metadata(db)) !== JSON.stringify(metadata)) fail('INCONSISTENT');
                return (await this.operations(db)).find(row => row.operation_id === operationId);
            }, { mode: 'IMMEDIATE' });
            if (prepared.state === 'COMPLETED') return prepared;

            return this.db.withTransaction(async db => {
                const metadata = await this.metadata(db);
                const row = (await this.operations(db)).find(item => item.operation_id === operationId);
                if (!row) fail('INCONSISTENT');
                this.bind(row, metadata);
                if (row.state === 'COMPLETED') return this.completed(db, row);
                const state = await this.mainState(db, row);
                if (state.candidate?.password !== expectedHash) fail('CHANGED');
                const now = this.clock();
                if (!date(now) || Date.parse(now) < Date.parse(row.created_at)) fail('INPUT');
                let targetId = row.target_user_id;
                if (row.action === 'create_admin') {
                    const inserted = await db.run(`INSERT INTO usuarios
                        (nombre, password, tipo, clase_cuenta, cuenta_departamental_codigo, activo, fecha_creacion)
                        VALUES (?, ?, 'administrador', 'humana', NULL, 0, ?)`, [row.target_user_name, passwordHash, now]);
                    targetId = inserted.lastID || inserted.id;
                }
                const saved = this.scopeFromOperation(row);
                await this.sessionDb.withTransaction(async tx => {
                    const scope = await this.sessionScope(tx, state, targetId);
                    if (scope.users.some(id => id !== targetId && !saved.users.includes(id))
                        || scope.sessions.some(uuid => !saved.sessions.includes(uuid))) fail('SCOPE_CHANGED');
                    for (const session of scope.matches) await tx.run('DELETE FROM express_sessions WHERE sid = ?', [session.sid]);
                    if ((await this.sessionScope(tx, state, targetId)).matches.length) fail('SESSIONS');
                }, { mode: 'IMMEDIATE' });

                const updated = row.action === 'reset_password'
                    ? await db.run('UPDATE usuarios SET password = ?, activo = 1 WHERE id = ? AND activo = 0 AND password = ?', [passwordHash, targetId, expectedHash])
                    : await db.run('UPDATE usuarios SET activo = 1 WHERE id = ? AND activo = 0', [targetId]);
                if (updated.changes !== 1) fail('CHANGED');
                const affectedUsers = new Set([...saved.users, targetId]);
                for (const history of state.history) {
                    if (history.estado !== 'activa' || (!affectedUsers.has(history.usuario_id)
                        && !saved.sessions.includes(history.session_uuid))) continue;
                    await db.run(`UPDATE sesiones_usuario SET estado = 'revocada', motivo_finalizacion = ?,
                        finalizada_en = ?, actualizado_en = ? WHERE session_uuid = ? AND estado = 'activa'`,
                    [REASON, now, now, history.session_uuid]);
                }
                const finished = { ...row, target_user_id: targetId };
                const audit = await db.run(`INSERT INTO historial_transacciones
                    (tipo_accion, usuario_id, descripcion, fecha) VALUES ('admin_recovery', NULL, ?, ?)`,
                [JSON.stringify(this.audit(finished)), now]);
                const completed = await db.run(`UPDATE ${TABLE} SET target_user_id = ?, state = 'COMPLETED',
                    completed_at = ?, audit_id = ? WHERE operation_id = ? AND state = 'PREPARED'`,
                [targetId, now, audit.lastID || audit.id, operationId]);
                if (completed.changes !== 1 || JSON.stringify(await this.metadata(db)) !== JSON.stringify(metadata)) fail('INCONSISTENT');
                return (await this.operations(db)).find(item => item.operation_id === operationId);
            }, { mode: 'IMMEDIATE' });
        });
    }
}

module.exports = { AdminRecoveryService };
