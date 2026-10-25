const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Database } = require('./helpers/testDatabase');
const { InstallationStateService } = require('../server/services/installationStateService');
const { AdminRecoveryService } = require('../server/services/adminRecoveryService');

const OLD = 'Anterior-recovery-secreto';
const NEW = 'Nueva-recovery-secreta';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function context(t, { origin = 'adopted_legacy', admin = true } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-recovery-domain-'));
    const db = new Database({ dbPath: path.join(dir, 'restaurant.db') });
    const sessionDb = new Database({ dbPath: path.join(dir, 'sessions.db') });
    t.after(async () => {
        await sessionDb.close();
        await db.close();
        assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('mundipos-recovery-domain-'));
        await fs.rm(dir, { recursive: true, force: true });
    });
    await db.connect();
    const installation = new InstallationStateService({ db });
    if (origin === 'created_empty') await installation.prepareInstallationState();
    await db.createTables();
    await db.migrateSchema();
    await db.createIndexes();
    if (origin === 'adopted_legacy') await installation.prepareInstallationState();
    await installation.completeInstallationPreparation();
    const hash = await bcrypt.hash(OLD, 10);
    if (origin === 'created_empty') {
        await installation.completeInitialBootstrap({ nombre: 'Anterior', passwordHash: hash });
        await db.run("UPDATE usuarios SET activo = 0 WHERE nombre = 'Anterior'");
    } else if (admin) {
        await db.run(`INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
            VALUES ('Anterior', ?, 'administrador', 0, ?)`, [hash, new Date().toISOString()]);
    }
    await db.run(`INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Basico', 'hash-basico', 'basico', 1, ?),
        ('Cocina', 'hash-cocina', 'basico', 0, ?)`, [new Date().toISOString(), new Date().toISOString()]);
    await db.run("UPDATE usuarios SET clase_cuenta = 'departamental', cuenta_departamental_codigo = 'cocina' WHERE nombre = 'Cocina'");
    await sessionDb.connect();
    await sessionDb.run('CREATE TABLE express_sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    const target = await db.get("SELECT * FROM usuarios WHERE nombre = 'Anterior'");
    const metadata = await installation.loadInstallationState();
    return { db, sessionDb, installation, target, metadata, hash,
        service: new AdminRecoveryService({ db, sessionDb }) };
}

const recoveryAudits = db => db.all("SELECT * FROM historial_transacciones WHERE tipo_accion = 'admin_recovery'");
const input = target => ({ action: 'reactivate', targetUserId: target.id, password: OLD, reason: 'Mantenimiento local aprobado' });
const transactionAdapter = db => ({
    dbPath: db.dbPath, transactionStorage: db.transactionStorage,
    get: db.get.bind(db), all: db.all.bind(db), run: db.run.bind(db),
    withTransaction: db.withTransaction.bind(db)
});

async function verifyCompleted(c, result, action) {
    assert.equal(result.state, 'COMPLETED');
    assert.match(result.operation_id, UUID);
    assert.deepEqual(await c.installation.loadInstallationState(), c.metadata);
    const audits = await recoveryAudits(c.db);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].id, result.audit_id);
    assert.equal(audits[0].usuario_id, null);
    assert.deepEqual(JSON.parse(audits[0].descripcion), {
        version: 1, event: 'admin_recovery', operationId: result.operation_id,
        installationId: c.metadata.installation_id, origin: c.metadata.origin,
        action, targetUserId: result.target_user_id, targetUserName: result.target_user_name,
        reason: result.reason, result: 'completed', context: 'local_maintenance'
    });
    const serialized = JSON.stringify([audits, await c.db.all('SELECT * FROM admin_recovery_operations'), result]);
    for (const secret of [OLD, NEW, c.hash, 'SESSION_SECRET', 'cookie', 'SID-secreto']) assert.ok(!serialized.includes(secret));
    assert.deepEqual(await c.installation.getBootstrapStatus(), {
        hasAdmin: true, adminCount: 1, requiresSetup: false, administrativeRecoveryRequired: false
    });
    await assert.rejects(c.installation.completeInitialBootstrap({ nombre: 'BootstrapIndebido', passwordHash: c.hash }), { code: 'INITIAL_BOOTSTRAP_CLOSED' });
    assert.deepEqual(await c.sessionDb.all('SELECT * FROM express_sessions'), []);
    assert.deepEqual(await c.db.all('SELECT * FROM sesiones_usuario'), []);
}

for (const origin of ['adopted_legacy', 'created_empty']) {
    test(`${origin}: reactiva sin alterar identidad, hash, roles ni otras cuentas`, async t => {
        const c = await context(t, { origin });
        const inserted = await c.db.run("INSERT INTO roles_trabajo (nombre, slug, descripcion) VALUES ('Mesero', 'mesero', 'Prueba')");
        await c.db.run('INSERT INTO usuario_roles_trabajo (usuario_id, rol_trabajo_id) VALUES (?, ?)', [c.target.id, inserted.id]);
        const roles = await c.db.all('SELECT * FROM usuario_roles_trabajo');
        const others = await c.db.all('SELECT * FROM usuarios WHERE id != ?', [c.target.id]);
        const result = await c.service.recover(input(c.target));
        assert.deepEqual(await c.db.get('SELECT * FROM usuarios WHERE id = ?', [c.target.id]), { ...c.target, activo: 1 });
        assert.deepEqual(await c.db.all('SELECT * FROM usuario_roles_trabajo'), roles);
        assert.deepEqual(await c.db.all('SELECT * FROM usuarios WHERE id != ?', [c.target.id]), others);
        await verifyCompleted(c, result, 'reactivate');
        assert.deepEqual(await c.service.getOperation(result.operation_id), result);
        assert.equal(await c.service.getPendingOperation(), null);
    });
}

test('reset usa mínimo seis caracteres y coste 10; COMPLETED no recalcula ni cambia hash', async t => {
    const c = await context(t);
    const result = await c.service.recover({ ...input(c.target), action: 'reset_password', newPassword: NEW });
    const user = await c.db.get('SELECT * FROM usuarios WHERE id = ?', [c.target.id]);
    assert.equal(user.activo, 1);
    assert.equal(await bcrypt.compare(NEW, user.password), true);
    assert.equal(bcrypt.getRounds(user.password), 10);
    assert.deepEqual(user, { ...c.target, activo: 1, password: user.password });
    await verifyCompleted(c, result, 'reset_password');
    assert.deepEqual(await c.service.recover({ operationId: result.operation_id, newPassword: 'x' }), result);
    assert.deepEqual(await c.service.recover({ operationId: result.operation_id.toUpperCase() }), result);
    assert.equal((await c.db.get('SELECT password FROM usuarios WHERE id = ?', [c.target.id])).password, user.password);
    assert.equal((await recoveryAudits(c.db)).length, 1);
    assert.equal(JSON.stringify(await recoveryAudits(c.db)).includes(user.password), false);
    await assert.rejects(c.service.recover({ ...input(c.target), operationId: result.operation_id, action: 'create_admin' }), { code: 'ADMIN_RECOVERY_MISMATCH' });
    await assert.rejects(c.service.recover(input(c.target)), { code: 'ADMIN_RECOVERY_ACTIVE_ADMIN' });
});

test('crea Admin humano sin roles y conserva Básico/Cocina sin conversión', async t => {
    const c = await context(t, { admin: false });
    const others = await c.db.all('SELECT * FROM usuarios');
    const result = await c.service.recover({ action: 'create_admin', targetUserName: 'Recuperacion_1', newPassword: NEW, reason: 'Sin Admin recuperable' });
    const user = await c.db.get('SELECT * FROM usuarios WHERE id = ?', [result.target_user_id]);
    assert.equal(user.nombre, 'Recuperacion_1');
    assert.equal(user.tipo, 'administrador');
    assert.equal(user.clase_cuenta, 'humana');
    assert.equal(user.cuenta_departamental_codigo, null);
    assert.equal(user.activo, 1);
    assert.equal(await bcrypt.compare(NEW, user.password), true);
    assert.equal(bcrypt.getRounds(user.password), 10);
    assert.deepEqual(await c.db.all('SELECT * FROM usuario_roles_trabajo WHERE usuario_id = ?', [user.id]), []);
    assert.deepEqual(await c.db.all('SELECT * FROM usuarios WHERE id != ?', [user.id]), others);
    await verifyCompleted(c, result, 'create_admin');
    assert.equal(JSON.stringify(await c.db.all('SELECT * FROM admin_recovery_operations')).includes(user.password), false);
});

for (const [label, change, expected] of [
    ['Admin activo', "UPDATE usuarios SET activo = 1 WHERE nombre = 'Anterior'", 'ACTIVE_ADMIN'],
    ['PREPARING', "UPDATE installation_metadata SET state = 'PREPARING', installation_id = NULL, confirmed_at = NULL", 'METADATA'],
    ['AWAITING_INITIAL_ADMIN', "UPDATE installation_metadata SET origin = 'created_empty', state = 'AWAITING_INITIAL_ADMIN', installation_id = NULL, confirmed_at = NULL", 'METADATA'],
    ['sin metadata', 'DROP TABLE installation_metadata', 'METADATA'],
    ['sin cabecera', 'DELETE FROM installation_metadata', 'METADATA'],
    ['formato futuro', 'UPDATE installation_metadata SET format_version = 2', 'METADATA'],
    ['UUID inválido', "UPDATE installation_metadata SET installation_id = 'invalido'", 'METADATA'],
    ['origen inválido', "UPDATE installation_metadata SET origin = 'desconocido'", 'METADATA'],
    ['Admin departamental', "UPDATE usuarios SET clase_cuenta = 'departamental', cuenta_departamental_codigo = 'otro' WHERE nombre = 'Anterior'", 'INCONSISTENT'],
    ['hash inconsistente', "UPDATE usuarios SET password = 'hash-invalido' WHERE nombre = 'Anterior'", 'INCONSISTENT'],
    ['schema incompatible', 'DROP TABLE sesiones_usuario', 'STORAGE']
]) {
    test(`rechaza ${label} sin crear una operación ni reparar datos`, async t => {
        const c = await context(t);
        await c.db.run('PRAGMA ignore_check_constraints = ON');
        await c.db.run(change);
        const before = await c.db.all('SELECT * FROM usuarios');
        await assert.rejects(c.service.recover(input(c.target)), { code: `ADMIN_RECOVERY_${expected}` });
        assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
        assert.deepEqual(await c.db.all('SELECT * FROM usuarios'), before);
        assert.deepEqual(await recoveryAudits(c.db), []);
    });
}

test('password incorrecta, reset corto y creación con candidato son rechazados sin secretos', async t => {
    const c = await context(t);
    for (const [request, code] of [
        [{ ...input(c.target), password: 'Contraseña-incorrecta-secreta' }, 'PASSWORD'],
        [{ ...input(c.target), action: 'reset_password', newPassword: '12345' }, 'INPUT'],
        [{ action: 'reset_password', targetUserId: c.target.id, passwordHash: c.hash, reason: 'Sin texto' }, 'INPUT'],
        [{ action: 'create_admin', targetUserName: 'OtroAdmin', newPassword: NEW, reason: 'Olvidó password' }, 'RECOVERABLE_ADMIN'],
        [{ ...input(c.target), targetUserId: (await c.db.get("SELECT id FROM usuarios WHERE nombre = 'Basico'")).id }, 'CANDIDATE'],
        [{ ...input(c.target), targetUserId: (await c.db.get("SELECT id FROM usuarios WHERE nombre = 'Cocina'")).id }, 'CANDIDATE']
    ]) {
        await assert.rejects(c.service.recover(request), error => {
            assert.equal(error.code, `ADMIN_RECOVERY_${code}`);
            for (const secret of [OLD, NEW, c.hash, 'Contraseña-incorrecta-secreta']) {
                assert.equal(JSON.stringify({ ...error, message: error.message, stack: error.stack }).includes(secret), false);
            }
            return true;
        });
    }
    assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
});

test('CREATE_ADMIN valida nombre, unicidad y ocho caracteres de contraseña', async t => {
    const c = await context(t, { admin: false });
    for (const targetUserName of ['', 'ab', 'a'.repeat(41), 'nombre inválido']) {
        await assert.rejects(c.service.recover({ action: 'create_admin', targetUserName, newPassword: NEW, reason: 'Prueba' }), { code: 'ADMIN_RECOVERY_INPUT' });
    }
    await assert.rejects(c.service.recover({ action: 'create_admin', targetUserName: 'basico', newPassword: NEW, reason: 'Prueba' }), { code: 'ADMIN_RECOVERY_NAME_EXISTS' });
    await assert.rejects(c.service.recover({ action: 'create_admin', targetUserName: 'Nuevo', newPassword: '1234567', reason: 'Prueba' }), { code: 'ADMIN_RECOVERY_INPUT' });
    assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
});

test('PREPARED bloquea otra operación y SQLite impide otra pendiente y CANCELLED', async t => {
    const c = await context(t);
    await c.db.run(`CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON historial_transacciones
        WHEN NEW.tipo_accion = 'admin_recovery' BEGIN SELECT RAISE(ABORT, 'forced_failure'); END`);
    await assert.rejects(c.service.recover(input(c.target)), { code: 'ADMIN_RECOVERY_STORAGE' });
    const pending = await c.service.getPendingOperation();
    assert.equal(pending.state, 'PREPARED');
    assert.match(pending.operation_id, UUID);
    assert.equal(pending.audit_id, null);
    assert.equal(pending.completed_at, null);
    await assert.rejects(c.service.recover(input(c.target)), error => error.code === 'ADMIN_RECOVERY_PENDING' && error.operationId === pending.operation_id);
    await assert.rejects(c.db.run(`INSERT INTO admin_recovery_operations SELECT
        '22222222-2222-4222-8222-222222222222', installation_id, origin, action, target_user_id,
        target_user_name, reason, main_db_path, sessions_db_path, affected_user_ids,
        affected_session_uuids, state, created_at, completed_at, audit_id FROM admin_recovery_operations`), /constraint/i);
    await assert.rejects(c.db.run("UPDATE admin_recovery_operations SET state = 'CANCELLED'"), /constraint/i);
    await c.db.run('DROP TRIGGER fail_recovery_audit');
    const resumed = await c.service.recover({ operationId: pending.operation_id, password: OLD });
    await verifyCompleted(c, resumed, 'reactivate');
});

test('UUID inválido y tabla de mantenimiento incompatible se rechazan', async t => {
    const c = await context(t);
    const badUuid = new AdminRecoveryService({ db: c.db, sessionDb: c.sessionDb, uuidFactory: () => 'no-uuid' });
    await assert.rejects(badUuid.recover(input(c.target)), { code: 'ADMIN_RECOVERY_INPUT' });
    await c.db.run('CREATE TABLE admin_recovery_operations (operation_id TEXT)');
    await assert.rejects(c.service.recover(input(c.target)), { code: 'ADMIN_RECOVERY_INCONSISTENT' });
    assert.equal((await c.db.get('SELECT activo FROM usuarios WHERE id = ?', [c.target.id])).activo, 0);
});

test('resultado de integridad SQLite no válido bloquea sin preparar ni cambiar Admin', async t => {
    const c = await context(t);
    const wrapper = {
        transactionStorage: c.db.transactionStorage,
        dbPath: c.db.dbPath, get: c.db.get.bind(c.db), run: c.db.run.bind(c.db), all: c.db.all.bind(c.db),
        withTransaction: (work, options) => c.db.withTransaction(tx => work({ ...tx,
            all: (sql, params) => sql === 'PRAGMA quick_check'
                ? Promise.resolve([{ quick_check: 'corrupt page' }]) : tx.all(sql, params)
        }), options)
    };
    await assert.rejects(new AdminRecoveryService({ db: wrapper, sessionDb: c.sessionDb }).recover(input(c.target)), { code: 'ADMIN_RECOVERY_INCONSISTENT' });
    assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
    assert.deepEqual(await c.db.get('SELECT * FROM usuarios WHERE id = ?', [c.target.id]), c.target);
});

test('rechaza adaptadores que delegan transacciones pero no permiten verificar su contexto', async t => {
    const c = await context(t);
    for (const realDb of [c.db, c.sessionDb]) {
        const delegated = transactionAdapter(realDb);
        delete delegated.transactionStorage;
        for (const adapter of [delegated, { ...delegated, transactionStorage: {} },
            { ...delegated, transactionStorage: { getStore: false } }]) {
            const dependencies = realDb === c.db ? { db: adapter, sessionDb: c.sessionDb }
                : { db: c.db, sessionDb: adapter };
            assert.throws(() => new AdminRecoveryService(dependencies), { code: 'ADMIN_RECOVERY_DEPENDENCY_CONTRACT' });
        }
    }
    assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
    assert.deepEqual(await c.db.get('SELECT * FROM usuarios WHERE id = ?', [c.target.id]), c.target);
    assert.deepEqual(await recoveryAudits(c.db), []);
});

test('wrappers con contexto delegado permiten recovery fuera de transacciones externas', async t => {
    const c = await context(t);
    const db = transactionAdapter(c.db);
    const sessionDb = transactionAdapter(c.sessionDb);
    assert.equal(db.transactionStorage, c.db.transactionStorage);
    assert.equal(sessionDb.transactionStorage, c.sessionDb.transactionStorage);
    const service = new AdminRecoveryService({ db, sessionDb });
    await verifyCompleted(c, await service.recover(input(c.target)), 'reactivate');
});

test('wrappers con contexto delegado rechazan recovery en transacciones externas y savepoints', async t => {
    const c = await context(t);
    const service = new AdminRecoveryService({ db: transactionAdapter(c.db), sessionDb: transactionAdapter(c.sessionDb) });
    for (const realDb of [c.db, c.sessionDb]) {
        await assert.rejects(realDb.withTransaction(() => service.recover(input(c.target))), { code: 'ADMIN_RECOVERY_TRANSACTION_CONTEXT' });
        await assert.rejects(realDb.withTransaction(() => realDb.withTransaction(() => service.recover(input(c.target)))),
            { code: 'ADMIN_RECOVERY_TRANSACTION_CONTEXT' });
    }
    assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
    assert.deepEqual(await c.db.get('SELECT * FROM usuarios WHERE id = ?', [c.target.id]), c.target);
    assert.deepEqual(await recoveryAudits(c.db), []);
});

test('no admite envolver recovery en una transacción externa que haga PREPARED no durable', async t => {
    const c = await context(t);
    for (const db of [c.db, c.sessionDb]) {
        await assert.rejects(db.withTransaction(() => c.service.recover(input(c.target))), { code: 'ADMIN_RECOVERY_TRANSACTION_CONTEXT' });
    }
    assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
    assert.deepEqual(await c.db.get('SELECT * FROM usuarios WHERE id = ?', [c.target.id]), c.target);
});

test('integración HTTP: recovery mantiene bootstrap cerrado, login normal y ninguna ruta de recovery', async t => {
    const c = await context(t);
    await c.service.recover(input(c.target));
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    let logs = '';
    const child = spawn(process.execPath, ['server/app.js'], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, DB_PATH: c.db.dbPath, SESSION_DB_PATH: c.sessionDb.dbPath,
            PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', HTTPS_ENABLED: 'false',
            COOKIE_SECURE: 'false', SESSION_SECRET: 'recovery-http-tests-secret-with-more-than-32-bytes' },
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    const url = `http://127.0.0.1:${port}`;
    try {
        let response;
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            if (child.exitCode !== null) throw new Error(logs);
            try { response = await fetch(`${url}/api/public/bootstrap-status`); if (response.ok) break; } catch {}
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(response?.ok, logs);
        assert.deepEqual((await response.json()).data, {
            hasAdmin: true, adminCount: 1, requiresSetup: false, administrativeRecoveryRequired: false
        });
        const bootstrap = await fetch(`${url}/api/auth/bootstrap-admin`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: 'OtroAdmin', password: NEW, confirmPassword: NEW })
        });
        assert.equal(bootstrap.status, 409);
        const login = await fetch(`${url}/api/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: c.target.nombre, password: OLD })
        });
        assert.equal(login.status, 200, logs);
        const cookie = login.headers.get('set-cookie').split(';', 1)[0];
        for (const route of ['/api/recover-admin', '/api/admin-recovery', '/api/auth/recover-admin']) {
            assert.equal((await fetch(`${url}${route}`, { method: 'POST', headers: { Cookie: cookie } })).status, 404);
        }
        assert.deepEqual(await c.installation.loadInstallationState(), c.metadata);
        assert.equal((await recoveryAudits(c.db)).length, 1);
    } finally {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill();
            await exited;
        }
    }
});
