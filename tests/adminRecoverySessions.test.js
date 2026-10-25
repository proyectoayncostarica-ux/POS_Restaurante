const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Database } = require('./helpers/testDatabase');
const { InstallationStateService } = require('../server/services/installationStateService');
const { AdminRecoveryService } = require('../server/services/adminRecoveryService');

const PASSWORD = 'Password-recovery-sessions-secreta';
const NOW = '2026-10-25T18:00:00.000Z';

async function context(t, { admin = true } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-recovery-sessions-'));
    const db = new Database({ dbPath: path.join(dir, 'restaurant.db') });
    const sessionDb = new Database({ dbPath: path.join(dir, 'sessions.db') });
    t.after(async () => {
        await sessionDb.close();
        await db.close();
        assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('mundipos-recovery-sessions-'));
        await fs.rm(dir, { recursive: true, force: true });
    });
    await db.connect();
    await db.createTables();
    await db.migrateSchema();
    const installation = new InstallationStateService({ db });
    await installation.prepareInstallationState();
    await installation.completeInstallationPreparation();
    const hash = await bcrypt.hash(PASSWORD, 4);
    const user = async (nombre, tipo = 'basico') => {
        const inserted = await db.run(`INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
            VALUES (?, ?, ?, ?, ?)`, [nombre, hash, tipo, tipo === 'administrador' ? 0 : 1, NOW]);
        return inserted.id;
    };
    const targetId = admin ? await user('AdminA', 'administrador') : null;
    const otherAdminId = admin ? await user('AdminB', 'administrador') : null;
    const basicId = await user('BasicNormal');
    const staleId = await user('BasicConSesionAdmin');
    await sessionDb.connect();
    await sessionDb.run('CREATE TABLE express_sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    const service = new AdminRecoveryService({ db, sessionDb });
    return { db, sessionDb, service, installation, targetId, otherAdminId, basicId, staleId,
        metadata: await installation.loadInstallationState(), hash };
}

async function technical(c, sid, userId, userType = 'basico', expired = false) {
    await c.sessionDb.run('INSERT INTO express_sessions VALUES (?, ?, ?)',
        [sid, JSON.stringify({ userId, userType, cookie: { originalMaxAge: 60000 } }), Date.now() + (expired ? -60000 : 60000)]);
}

async function historical(c, userId, sid, estado = 'activa') {
    const uuid = crypto.randomUUID();
    await c.db.run(`INSERT INTO sesiones_usuario (session_uuid, usuario_id, express_session_id,
        estado, iniciada_en, actualizado_en, finalizada_en, motivo_finalizacion)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuid, userId, sid, estado, NOW, NOW, estado === 'activa' ? null : NOW, estado === 'activa' ? null : 'logout']);
    return uuid;
}

async function populate(c) {
    await technical(c, 'SID_TARGET_SECRETO', c.targetId, 'basico', true);
    await technical(c, 'SID_ADMIN_OTRO_SECRETO', c.otherAdminId);
    await technical(c, 'SID_STALE_SECRETO', c.staleId, 'administrador');
    await technical(c, 'sid-basico-normal', c.basicId);
    await technical(c, 'sid-basico-mismo-usuario', c.staleId);
    const affected = [
        await historical(c, c.targetId, 'SID_TARGET_SECRETO'),
        await historical(c, c.targetId, 'sid-target-huerfano'),
        await historical(c, c.otherAdminId, 'sid-admin-huerfano'),
        await historical(c, c.staleId, 'SID_STALE_SECRETO')
    ];
    const preserved = [
        await historical(c, c.basicId, 'sid-basico-normal'),
        await historical(c, c.staleId, 'sid-basico-mismo-usuario'),
        await historical(c, c.targetId, 'sid-terminado', 'cerrada')
    ];
    const role = await c.db.run("INSERT INTO roles_trabajo (nombre, slug) VALUES ('Mesero', 'mesero')");
    await c.db.run('INSERT INTO usuario_roles_trabajo (usuario_id, rol_trabajo_id) VALUES (?, ?)', [c.targetId, role.id]);
    const mesa = await c.db.run('INSERT INTO mesas (numero, estado) VALUES (19, \'ocupada\')');
    await c.db.run('INSERT INTO mesa_responsables (mesa_id, usuario_id, rol_trabajo_id) VALUES (?, ?, ?)', [mesa.id, c.targetId, role.id]);
    const pedido = await c.db.run(`INSERT INTO pedidos (mesa_id, usuario_id, fecha, estado, total)
        VALUES (?, ?, ?, 'pendiente', 1250)`, [mesa.id, c.targetId, NOW]);
    await c.db.run(`INSERT INTO cuenta_responsables (pedido_id, usuario_id, usuario_nombre_snapshot,
        es_principal, fecha_asignacion_snapshot) VALUES (?, ?, 'AdminA', 1, ?)`, [pedido.id, c.targetId, NOW]);
    return { affected, preserved };
}

async function business(db) {
    const result = {};
    for (const table of ['usuario_roles_trabajo', 'mesa_responsables', 'mesas', 'pedidos', 'cuenta_responsables']) {
        result[table] = await db.all(`SELECT * FROM ${table}`);
    }
    return result;
}

const request = c => ({ action: 'reactivate', targetUserId: c.targetId, password: PASSWORD, reason: 'Recuperación local' });
const audits = db => db.all("SELECT * FROM historial_transacciones WHERE tipo_accion = 'admin_recovery'");

async function verifyRevoked(c, ids) {
    for (const id of ids) {
        const row = await c.db.get('SELECT * FROM sesiones_usuario WHERE session_uuid = ?', [id]);
        assert.equal(row.estado, 'revocada');
        assert.equal(row.motivo_finalizacion, 'recuperacion_administrativa_local');
        assert.ok(row.finalizada_en);
        assert.equal(row.actualizado_en, row.finalizada_en);
    }
    assert.deepEqual(await c.installation.loadInstallationState(), c.metadata);
}

test('elimina A/B/C incluso expiradas; revoca huérfanas y conserva Básicos, historia y negocio', async t => {
    const c = await context(t);
    const { affected, preserved } = await populate(c);
    const beforeBusiness = await business(c.db);
    const beforeHistory = await c.db.all('SELECT * FROM sesiones_usuario');
    const result = await c.service.recover(request(c));
    assert.equal(result.state, 'COMPLETED');
    assert.deepEqual((await c.sessionDb.all('SELECT sid FROM express_sessions ORDER BY sid')).map(row => row.sid),
        ['sid-basico-mismo-usuario', 'sid-basico-normal']);
    await verifyRevoked(c, affected);
    for (const uuid of preserved) assert.deepEqual(await c.db.get('SELECT * FROM sesiones_usuario WHERE session_uuid = ?', [uuid]), beforeHistory.find(row => row.session_uuid === uuid));
    assert.deepEqual(await business(c.db), beforeBusiness);
    assert.equal((await c.db.all('SELECT * FROM sesiones_usuario')).length, beforeHistory.length);
    const serialized = JSON.stringify([result, await audits(c.db)]);
    for (const secret of [PASSWORD, c.hash, 'SID_TARGET_SECRETO', 'SID_STALE_SECRETO', 'SID_ADMIN_OTRO_SECRETO', 'cookie']) {
        assert.equal(serialized.includes(secret), false);
    }
});

for (const [label, key, userType, removed] of [
    ['Básico con tipo básico', 'basicId', 'basico', false],
    ['Básico con privilegio administrativo residual', 'staleId', 'administrador', true],
    ['Admin con tipo básico residual', 'targetId', 'basico', true]
]) {
    test(`${label}: correlaciona userId string con MAIN antes de decidir el alcance`, async t => {
        const c = await context(t);
        await technical(c, 'sid-correlacionado', String(c[key]), userType);
        const uuid = await historical(c, c[key], 'sid-correlacionado');
        const beforeSessions = await c.sessionDb.all('SELECT * FROM express_sessions');
        const beforeHistory = await c.db.get('SELECT * FROM sesiones_usuario WHERE session_uuid = ?', [uuid]);
        const result = await c.service.recover(request(c));
        assert.equal(result.state, 'COMPLETED');
        assert.deepEqual(await c.sessionDb.all('SELECT * FROM express_sessions'), removed ? [] : beforeSessions);
        if (removed) await verifyRevoked(c, [uuid]);
        else assert.deepEqual(await c.db.get('SELECT * FROM sesiones_usuario WHERE session_uuid = ?', [uuid]), beforeHistory);
    });
}

test('sesiones anónimas con userId ausente/null y tipo ausente/null/vacío no bloquean recovery', async t => {
    const c = await context(t);
    const anonymous = [{}, { userId: null }, { userType: null }, { userId: null, userType: null },
        { userType: '' }, { userId: null, userType: '  ' }];
    for (const [index, stored] of anonymous.entries()) {
        await c.sessionDb.run('INSERT INTO express_sessions VALUES (?, ?, ?)',
            [`sid-anonimo-${index}`, JSON.stringify(stored), Date.now() + 60000]);
    }
    const before = await c.sessionDb.all('SELECT * FROM express_sessions ORDER BY sid');
    assert.equal((await c.service.recover(request(c))).state, 'COMPLETED');
    assert.deepEqual(await c.sessionDb.all('SELECT * FROM express_sessions ORDER BY sid'), before);
    assert.deepEqual(await c.installation.loadInstallationState(), c.metadata);
});

for (const stored of ['{no JSON', 'null', '[]', '{"userId":"invalido","userType":"administrador"}',
    '{"userType":"administrador"}', '{"userId":99,"userType":"superadmin"}',
    '{"userId":true,"userType":"administrador"}', '{"userId":[1],"userType":"administrador"}', '{"userId":999}',
    '{"userId":999999,"userType":"basico"}', '{"userId":999999,"userType":"administrador"}',
    '{"userId":999999,"userType":"admin"}', '{"userType":"admin"}']) {
    test(`JSON inseguro ${stored.slice(0, 20)}: fail closed sin eliminar sesiones`, async t => {
        const c = await context(t);
        await technical(c, 'SID_TARGET_SECRETO', c.targetId, 'administrador');
        await c.sessionDb.run('INSERT INTO express_sessions VALUES (?, ?, ?)', ['SID_CORRUPTO_SECRETO', stored, Date.now() + 60000]);
        const before = await c.sessionDb.all('SELECT * FROM express_sessions ORDER BY sid');
        await assert.rejects(c.service.recover(request(c)), error => {
            assert.equal(error.code, 'ADMIN_RECOVERY_SESSIONS');
            assert.equal(JSON.stringify({ ...error, message: error.message, stack: error.stack }).includes('SID_CORRUPTO_SECRETO'), false);
            return true;
        });
        assert.deepEqual(await c.sessionDb.all('SELECT * FROM express_sessions ORDER BY sid'), before);
        assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
        assert.equal((await c.db.get('SELECT activo FROM usuarios WHERE id = ?', [c.targetId])).activo, 0);
    });
}

for (const [label, userType] of [['objeto', {}], ['array', ['administrador']], ['número', 1]]) {
    test(`userType ${label}: fail closed incluso con userId válido`, async t => {
        const c = await context(t);
        await technical(c, 'SID_TARGET_SECRETO', c.targetId, 'administrador');
        await c.sessionDb.run('INSERT INTO express_sessions VALUES (?, ?, ?)',
            ['SID_TIPO_INVALIDO', JSON.stringify({ userId: c.basicId, userType }), Date.now() + 60000]);
        const before = await c.sessionDb.all('SELECT * FROM express_sessions ORDER BY sid');
        await assert.rejects(c.service.recover(request(c)), { code: 'ADMIN_RECOVERY_SESSIONS' });
        assert.deepEqual(await c.sessionDb.all('SELECT * FROM express_sessions ORDER BY sid'), before);
        assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
        assert.equal((await c.db.get('SELECT activo FROM usuarios WHERE id = ?', [c.targetId])).activo, 0);
        assert.deepEqual(await audits(c.db), []);
    });
}

test('fallo justo antes de COMMIT técnico revierte deletes y MAIN; PREPARED permite reanudar', async t => {
    const c = await context(t);
    const ids = await populate(c);
    const before = await c.sessionDb.all('SELECT * FROM express_sessions ORDER BY sid');
    const failingSessions = {
        transactionStorage: c.sessionDb.transactionStorage,
        dbPath: c.sessionDb.dbPath,
        get: c.sessionDb.get.bind(c.sessionDb), all: c.sessionDb.all.bind(c.sessionDb), run: c.sessionDb.run.bind(c.sessionDb),
        withTransaction: (work, options) => c.sessionDb.withTransaction(async tx => {
            const result = await work(tx);
            if (options.mode === 'IMMEDIATE') throw new Error(`SQL params ${PASSWORD} SID_TARGET_SECRETO ${c.hash}`);
            return result;
        }, options)
    };
    const service = new AdminRecoveryService({ db: c.db, sessionDb: failingSessions });
    await assert.rejects(service.recover(request(c)), error => {
        const serialized = JSON.stringify({ ...error, message: error.message, stack: error.stack });
        for (const secret of [PASSWORD, c.hash, 'SID_TARGET_SECRETO']) assert.equal(serialized.includes(secret), false);
        return error.code === 'ADMIN_RECOVERY_STORAGE';
    });
    assert.deepEqual(await c.sessionDb.all('SELECT * FROM express_sessions ORDER BY sid'), before);
    assert.equal((await c.db.get('SELECT activo FROM usuarios WHERE id = ?', [c.targetId])).activo, 0);
    const pending = await c.service.getPendingOperation();
    assert.equal(pending.state, 'PREPARED');
    assert.deepEqual(await audits(c.db), []);
    const completed = await c.service.recover({ operationId: pending.operation_id, password: PASSWORD });
    assert.equal(completed.operation_id, pending.operation_id);
    await verifyRevoked(c, ids.affected);
});

test('COMMIT técnico seguido de fallo MAIN conserva PREPARED y correlación histórica sin SIDs', async t => {
    const c = await context(t);
    const ids = await populate(c);
    const beforeBusiness = await business(c.db);
    const beforeHistory = await c.db.all('SELECT * FROM sesiones_usuario');
    await c.db.run(`CREATE TRIGGER fail_main BEFORE INSERT ON historial_transacciones
        WHEN NEW.tipo_accion = 'admin_recovery' BEGIN SELECT RAISE(ABORT, 'main_failure'); END`);
    await assert.rejects(c.service.recover({ ...request(c), action: 'reset_password', newPassword: 'Nueva-password-recovery' }), { code: 'ADMIN_RECOVERY_STORAGE' });
    assert.equal((await c.sessionDb.all('SELECT * FROM express_sessions')).length, 2);
    const pending = await c.service.getPendingOperation();
    assert.equal(pending.state, 'PREPARED');
    assert.ok(JSON.parse(pending.affected_session_uuids).includes(ids.affected[3]));
    assert.equal(JSON.stringify(pending).includes('SID_STALE_SECRETO'), false);
    assert.equal((await c.db.get('SELECT password FROM usuarios WHERE id = ?', [c.targetId])).password, c.hash);
    assert.equal((await c.db.get('SELECT activo FROM usuarios WHERE id = ?', [c.targetId])).activo, 0);
    assert.deepEqual(await c.db.all('SELECT * FROM sesiones_usuario'), beforeHistory);
    assert.deepEqual(await business(c.db), beforeBusiness);
    await c.db.run('DROP TRIGGER fail_main');
    const completed = await c.service.recover({ operationId: pending.operation_id, newPassword: 'Nueva-password-recovery' });
    assert.equal(completed.operation_id, pending.operation_id);
    await verifyRevoked(c, ids.affected);
    assert.deepEqual(await business(c.db), beforeBusiness);
    assert.equal((await audits(c.db)).length, 1);
    assert.deepEqual(await c.service.recover({ operationId: pending.operation_id }), completed);
    assert.equal((await audits(c.db)).length, 1);
});

test('CREATE_ADMIN limpia Admin JSON residual y no deja cuenta parcial si falla MAIN', async t => {
    const c = await context(t, { admin: false });
    await technical(c, 'SID_STALE_SECRETO', c.staleId, 'admin');
    await technical(c, 'sid-basico-normal', c.basicId);
    const staleHistory = await historical(c, c.staleId, 'SID_STALE_SECRETO');
    await c.db.run(`CREATE TRIGGER fail_main BEFORE INSERT ON historial_transacciones
        WHEN NEW.tipo_accion = 'admin_recovery' BEGIN SELECT RAISE(ABORT, 'create_failure'); END`);
    await assert.rejects(c.service.recover({ action: 'create_admin', targetUserName: 'AdminNuevo', newPassword: PASSWORD, reason: 'Sin candidato' }), { code: 'ADMIN_RECOVERY_STORAGE' });
    assert.deepEqual(await c.db.all("SELECT * FROM usuarios WHERE tipo = 'administrador'"), []);
    assert.equal((await c.sessionDb.all('SELECT * FROM express_sessions')).length, 1);
    const pending = await c.service.getPendingOperation();
    assert.equal(pending.target_user_id, null);
    await c.db.run('DROP TRIGGER fail_main');
    const result = await c.service.recover({ operationId: pending.operation_id, newPassword: PASSWORD });
    assert.equal((await c.db.all("SELECT * FROM usuarios WHERE tipo = 'administrador'")).length, 1);
    assert.equal((await c.db.get('SELECT * FROM usuarios WHERE id = ?', [result.target_user_id])).activo, 1);
    await verifyRevoked(c, [staleHistory]);
    assert.equal((await audits(c.db)).length, 1);
});

test('cambio concurrente del hash se detecta antes de preparar o sobrescribir', async t => {
    const c = await context(t);
    const changedHash = await bcrypt.hash('Otra-clave-fuera-del-servicio', 4);
    let changed = false;
    const wrapper = {
        transactionStorage: c.db.transactionStorage,
        dbPath: c.db.dbPath, get: c.db.get.bind(c.db), all: c.db.all.bind(c.db), run: c.db.run.bind(c.db),
        withTransaction: async (work, options) => {
            const result = await c.db.withTransaction(work, options);
            if (!changed && options.mode === 'DEFERRED') {
                changed = true;
                await c.db.run('UPDATE usuarios SET password = ? WHERE id = ?', [changedHash, c.targetId]);
            }
            return result;
        }
    };
    await assert.rejects(new AdminRecoveryService({ db: wrapper, sessionDb: c.sessionDb }).recover(request(c)), { code: 'ADMIN_RECOVERY_CHANGED' });
    assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
    assert.deepEqual(await c.db.get('SELECT password, activo FROM usuarios WHERE id = ?', [c.targetId]), { password: changedHash, activo: 0 });
});

test('dos pares de conexiones independientes no completan dos recuperaciones', async t => {
    const c = await context(t);
    const peer = new Database({ dbPath: c.db.dbPath });
    const peerSessions = new Database({ dbPath: c.sessionDb.dbPath });
    await peer.connect();
    await peerSessions.connect();
    try {
        const other = new AdminRecoveryService({ db: peer, sessionDb: peerSessions });
        const results = await Promise.allSettled([c.service.recover(request(c)), other.recover(request(c))]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        const failure = results.find(result => result.status === 'rejected').reason;
        assert.ok(['ADMIN_RECOVERY_PENDING', 'ADMIN_RECOVERY_ACTIVE_ADMIN'].includes(failure.code));
        assert.equal((await audits(c.db)).length, 1);
        assert.equal((await c.db.all('SELECT * FROM admin_recovery_operations')).length, 1);
        assert.equal((await c.db.get('SELECT activo FROM usuarios WHERE id = ?', [c.targetId])).activo, 1);
    } finally {
        await peerSessions.close();
        await peer.close();
    }
});

test('CREATE_ADMIN revierte la cuenta provisional si falla la DB técnica', async t => {
    const c = await context(t, { admin: false });
    await technical(c, 'SID_STALE_SECRETO', c.staleId, 'administrador');
    await c.sessionDb.run(`CREATE TRIGGER fail_delete BEFORE DELETE ON express_sessions
        BEGIN SELECT RAISE(ABORT, 'session_delete_failure'); END`);
    await assert.rejects(c.service.recover({ action: 'create_admin', targetUserName: 'AdminNuevo', newPassword: PASSWORD, reason: 'Sin candidato' }), { code: 'ADMIN_RECOVERY_STORAGE' });
    assert.equal(await c.db.get("SELECT id FROM usuarios WHERE nombre = 'AdminNuevo'"), undefined);
    assert.equal((await c.sessionDb.all('SELECT * FROM express_sessions')).length, 1);
    const pending = await c.service.getPendingOperation();
    assert.equal(pending.state, 'PREPARED');
    await c.sessionDb.run('DROP TRIGGER fail_delete');
    const completed = await c.service.recover({ operationId: pending.operation_id, newPassword: PASSWORD });
    assert.equal(completed.state, 'COMPLETED');
    assert.equal((await c.db.all("SELECT * FROM usuarios WHERE tipo = 'administrador'")).length, 1);
});

test('fallo justo antes de COMMIT MAIN revierte incluso auditoría y COMPLETED', async t => {
    const c = await context(t);
    await technical(c, 'SID_TARGET_SECRETO', c.targetId, 'administrador');
    const wrapper = {
        transactionStorage: c.db.transactionStorage,
        dbPath: c.db.dbPath, get: c.db.get.bind(c.db), all: c.db.all.bind(c.db), run: c.db.run.bind(c.db),
        withTransaction: (work, options) => c.db.withTransaction(async tx => {
            const result = await work(tx);
            if (result?.state === 'COMPLETED' && options.mode === 'IMMEDIATE') throw new Error('forced_main_commit_failure');
            return result;
        }, options)
    };
    await assert.rejects(new AdminRecoveryService({ db: wrapper, sessionDb: c.sessionDb }).recover(request(c)), { code: 'ADMIN_RECOVERY_STORAGE' });
    assert.deepEqual(await c.sessionDb.all('SELECT * FROM express_sessions'), []);
    assert.deepEqual(await audits(c.db), []);
    assert.equal((await c.db.get('SELECT activo FROM usuarios WHERE id = ?', [c.targetId])).activo, 0);
    const pending = await c.service.getPendingOperation();
    assert.equal(pending.state, 'PREPARED');
    assert.equal(pending.audit_id, null);
    assert.equal((await c.service.recover({ operationId: pending.operation_id, password: PASSWORD })).state, 'COMPLETED');
    assert.equal((await audits(c.db)).length, 1);
});

test('alcance nuevo entre preparación y ejecución exige registrar UUID histórico antes de borrar', async t => {
    const c = await context(t);
    let changed = false;
    let uuid;
    const wrapper = {
        transactionStorage: c.db.transactionStorage,
        dbPath: c.db.dbPath, get: c.db.get.bind(c.db), all: c.db.all.bind(c.db), run: c.db.run.bind(c.db),
        withTransaction: async (work, options) => {
            const result = await c.db.withTransaction(work, options);
            if (!changed && result?.state === 'PREPARED') {
                changed = true;
                await technical(c, 'SID_NUEVO_SECRETO', c.staleId, 'administrador');
                uuid = await historical(c, c.staleId, 'SID_NUEVO_SECRETO');
            }
            return result;
        }
    };
    await assert.rejects(new AdminRecoveryService({ db: wrapper, sessionDb: c.sessionDb }).recover(request(c)), { code: 'ADMIN_RECOVERY_SCOPE_CHANGED' });
    assert.equal((await c.sessionDb.all('SELECT * FROM express_sessions')).length, 1);
    const pending = await c.service.getPendingOperation();
    assert.equal(pending.state, 'PREPARED');
    assert.equal((await c.db.get('SELECT activo FROM usuarios WHERE id = ?', [c.targetId])).activo, 0);
    const result = await c.service.recover({ operationId: pending.operation_id, password: PASSWORD });
    assert.equal(result.state, 'COMPLETED');
    await verifyRevoked(c, [uuid]);
});
