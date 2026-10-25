const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');
const { Database } = require('./helpers/testDatabase');
const { InstallationStateService } = require('../server/services/installationStateService');

const ROOT = path.resolve(__dirname, '..');
const PASSWORD = 'Prueba-bootstrap-v441-segura';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

async function stopServer(server) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) return;
    const exited = once(server.child, 'exit');
    server.child.kill();
    await exited;
}

async function createContext(t, { legacy = false, adminActive = null } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-bootstrap-'));
    const dbPath = path.join(dir, 'restaurant.db');
    const db = new Database({ dbPath });
    const servers = [];
    const readers = [];
    t.after(async () => {
        for (const server of servers) await stopServer(server);
        for (const reader of readers) await reader.close();
        await db.close();
        assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('mundipos-bootstrap-'));
        await fs.rm(dir, { recursive: true, force: true });
    });
    if (legacy) {
        await db.connect();
        // Esquema previo al Paso 1: todavía no existe installation_metadata.
        await db.createTables();
        await db.migrateSchema();
        if (adminActive !== null) {
            await db.run(`INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
                VALUES ('AdminLegacy', ?, 'administrador', ?, ?)`,
            [await bcrypt.hash(PASSWORD, 10), adminActive, new Date().toISOString()]);
        }
        await db.close();
    }
    await db.initializeDatabase();
    const service = new InstallationStateService({ db });
    return {
        db, service,
        async start() {
            const reservation = net.createServer();
            reservation.listen(0, '127.0.0.1');
            await once(reservation, 'listening');
            const port = reservation.address().port;
            await new Promise(resolve => reservation.close(resolve));
            const sessionDbPath = path.join(dir, `sessions-${servers.length}.db`);
            let logs = '';
            const child = spawn(process.execPath, ['server/app.js'], {
                cwd: ROOT,
                env: {
                    ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test',
                    HTTPS_ENABLED: 'false', COOKIE_SECURE: 'false',
                    SESSION_SECRET: 'mundipos-initial-bootstrap-tests-secret-over-32-bytes',
                    DB_PATH: dbPath, SESSION_DB_PATH: sessionDbPath
                },
                stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
            });
            child.stdout.on('data', chunk => { logs += chunk; });
            child.stderr.on('data', chunk => { logs += chunk; });
            const server = { child, url: `http://127.0.0.1:${port}`, logs: () => logs };
            servers.push(server);
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
                if (child.exitCode !== null) throw new Error(logs);
                try {
                    const response = await fetch(`${server.url}/api/public/bootstrap-status`);
                    if (response.ok) {
                        const sessions = new Database({ dbPath: sessionDbPath });
                        await sessions.connect();
                        readers.push(sessions);
                        return { ...server, sessions };
                    }
                } catch {
                    // Espera únicamente al arranque del proceso con sus DB temporales.
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw new Error(`No inició el servidor de prueba.\n${logs}`);
        }
    };
}

async function status(server) {
    const response = await fetch(`${server.url}/api/public/bootstrap-status`);
    const body = await response.json();
    assert.equal(response.status, 200, server.logs());
    assert.deepEqual(Object.keys(body.data).sort(),
        ['adminCount', 'administrativeRecoveryRequired', 'hasAdmin', 'requiresSetup']);
    assert.match(response.headers.get('cache-control'), /no-store/);
    return body.data;
}

async function bootstrap(server, nombre = 'AdminInicial', payload = {}) {
    const response = await fetch(`${server.url}/api/auth/bootstrap-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MundiPOS-Client': CLIENT_ID },
        body: JSON.stringify({ nombre, password: PASSWORD, confirmPassword: PASSWORD, ...payload })
    });
    const body = await response.json();
    assert.doesNotMatch(JSON.stringify(body), /installation_id|installationId|confirmed_at|adopted_legacy|created_empty/);
    return { response, body };
}

const auditRows = db => db.all("SELECT * FROM historial_transacciones WHERE tipo_accion = 'bootstrap_admin'");
const adminRows = db => db.all("SELECT * FROM usuarios WHERE tipo = 'administrador'");

test('nueva pendiente publica únicamente las señales de bootstrap', async t => {
    const context = await createContext(t);
    const server = await context.start();
    assert.deepEqual(await status(server), {
        hasAdmin: false, adminCount: 0, requiresSetup: true, administrativeRecoveryRequired: false
    });
    assert.equal((await context.service.loadInstallationState()).installation_id, null);
});

for (const adminActive of [1, 0, null]) {
    test(`legacy con Admin activo=${adminActive}: nunca permite bootstrap inicial`, async t => {
        const context = await createContext(t, { legacy: true, adminActive });
        const server = await context.start();
        const before = await context.service.loadInstallationState();
        assert.equal(before.origin, 'adopted_legacy');
        assert.equal(before.state, 'IDENTIFIED');
        assert.deepEqual(await status(server), {
            hasAdmin: adminActive === 1, adminCount: adminActive === 1 ? 1 : 0,
            requiresSetup: false, administrativeRecoveryRequired: adminActive !== 1
        });
        const result = await bootstrap(server);
        assert.equal(result.response.status, 409);
        assert.equal(result.body.code, 'INITIAL_BOOTSTRAP_CLOSED');
        assert.equal((await adminRows(context.db)).length, adminActive === null ? 0 : 1);
        assert.deepEqual(await context.service.loadInstallationState(), before);
        assert.deepEqual(await auditRows(context.db), []);
    });
}

test('bootstrap confirma Admin, UUID y auditoría únicos; reinicio y pérdida de Admin no lo reabren', async t => {
    const context = await createContext(t);
    let server = await context.start();
    const result = await bootstrap(server);
    assert.equal(result.response.status, 201, server.logs());
    assert.equal(result.body.success, true);
    const [admin] = await adminRows(context.db);
    assert.equal(admin.nombre, 'AdminInicial');
    assert.equal(admin.activo, 1);
    assert.notEqual(admin.password, PASSWORD);
    assert.equal(await bcrypt.compare(PASSWORD, admin.password), true);
    const first = await context.service.loadInstallationState();
    assert.equal(first.origin, 'created_empty');
    assert.equal(first.state, 'IDENTIFIED');
    assert.match(first.installation_id, UUID_V4);
    assert.notEqual(first.installation_id, CLIENT_ID);
    assert.equal(first.confirmed_at, admin.fecha_creacion);
    const [audit] = await auditRows(context.db);
    assert.equal((await auditRows(context.db)).length, 1);
    assert.equal(audit.usuario_id, admin.id);
    assert.equal(audit.fecha, first.confirmed_at);
    assert.deepEqual(JSON.parse(audit.descripcion), {
        version: 1, event: 'bootstrap_admin', userId: admin.id, userName: admin.nombre,
        installationId: first.installation_id, origin: 'created_empty',
        previousState: 'AWAITING_INITIAL_ADMIN', state: 'IDENTIFIED'
    });
    const [session] = await context.db.all('SELECT * FROM sesiones_usuario');
    assert.equal(session.client_id, CLIENT_ID);
    assert.notEqual(first.installation_id, session.session_uuid);
    assert.notEqual(first.installation_id, session.express_session_id);
    const cookie = result.response.headers.get('set-cookie').split(';', 1)[0];
    assert.equal((await (await fetch(`${server.url}/api/auth/verify`, { headers: { Cookie: cookie } })).json()).authenticated, true);
    assert.deepEqual(await status(server), {
        hasAdmin: true, adminCount: 1, requiresSetup: false, administrativeRecoveryRequired: false
    });
    assert.equal((await bootstrap(server, 'SegundoAdmin')).response.status, 409);

    await stopServer(server);
    server = await context.start();
    assert.deepEqual(await context.service.loadInstallationState(), first);
    await context.db.run("UPDATE usuarios SET nombre = 'AdminRenombrado', activo = 0 WHERE id = ?", [admin.id]);
    await context.db.run("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('clientId', 'otro-cliente')");
    assert.deepEqual(await status(server), {
        hasAdmin: false, adminCount: 0, requiresSetup: false, administrativeRecoveryRequired: true
    });
    assert.equal((await bootstrap(server, 'TercerAdmin')).response.status, 409);
    assert.deepEqual(await context.service.loadInstallationState(), first);
    assert.equal((await adminRows(context.db)).length, 1);
    assert.equal((await auditRows(context.db)).length, 1);
});

test('dos procesos HTTP independientes compiten por una sola confirmación SQLite', async t => {
    const context = await createContext(t);
    // Cada proceso tiene su propio Database, cola JS y store de sesiones.
    const left = await context.start();
    const right = await context.start();
    assert.equal((await status(left)).requiresSetup, true);
    assert.equal((await status(right)).requiresSetup, true);
    await context.db.run('CREATE TABLE bootstrap_transitions (installation_id TEXT)');
    await context.db.run(`CREATE TRIGGER count_bootstrap_transition AFTER UPDATE OF state ON installation_metadata
        WHEN OLD.state = 'AWAITING_INITIAL_ADMIN' AND NEW.state = 'IDENTIFIED'
        BEGIN INSERT INTO bootstrap_transitions VALUES (NEW.installation_id); END`);
    const results = await Promise.all([bootstrap(left, 'AdminCarreraA'), bootstrap(right, 'AdminCarreraB')]);
    assert.deepEqual(results.map(result => result.response.status).sort(), [201, 409]);
    assert.equal(results.find(result => result.response.status === 409).body.code, 'INITIAL_BOOTSTRAP_CLOSED');
    assert.equal((await adminRows(context.db)).length, 1);
    assert.equal((await auditRows(context.db)).length, 1);
    const metadata = await context.service.loadInstallationState();
    assert.equal(metadata.state, 'IDENTIFIED');
    assert.match(metadata.installation_id, UUID_V4);
    assert.deepEqual(await context.db.all('SELECT * FROM bootstrap_transitions'),
        [{ installation_id: metadata.installation_id }]);
    assert.equal((await context.db.all('SELECT * FROM installation_metadata')).length, 1);
    assert.equal((await context.db.all('SELECT * FROM sesiones_usuario')).length, 1);
});

for (const phase of ['identity', 'audit']) {
    test(`fallo precommit en ${phase} revierte Admin, identidad y auditoría; permite reintento`, async t => {
        const context = await createContext(t);
        const server = await context.start();
        const before = await context.service.loadInstallationState();
        await context.db.run(phase === 'identity'
            ? `CREATE TRIGGER fail_bootstrap BEFORE UPDATE OF state ON installation_metadata
                WHEN NEW.state = 'IDENTIFIED' BEGIN SELECT RAISE(ABORT, 'forced_identity_failure'); END`
            : `CREATE TRIGGER fail_bootstrap BEFORE INSERT ON historial_transacciones
                WHEN NEW.tipo_accion = 'bootstrap_admin' BEGIN SELECT RAISE(ABORT, 'forced_audit_failure'); END`);
        assert.equal((await bootstrap(server)).response.status, 500);
        assert.match(server.logs(), new RegExp(`forced_${phase}_failure`));
        assert.deepEqual(await adminRows(context.db), []);
        assert.deepEqual(await auditRows(context.db), []);
        assert.deepEqual(await context.service.loadInstallationState(), before);
        assert.equal((await status(server)).requiresSetup, true);
        await context.db.run('DROP TRIGGER fail_bootstrap');
        assert.equal((await bootstrap(server)).response.status, 201);
        assert.equal((await auditRows(context.db)).length, 1);
    });
}

for (const phase of ['store', 'lifecycle']) {
    test(`fallo postcommit en ${phase} conserva bootstrap y permite login normal después`, async t => {
        const context = await createContext(t);
        const server = await context.start();
        const faultDb = phase === 'store' ? server.sessions : context.db;
        const table = phase === 'store' ? 'express_sessions' : 'sesiones_usuario';
        await faultDb.run(`CREATE TRIGGER fail_autologin BEFORE INSERT ON ${table}
            BEGIN SELECT RAISE(ABORT, 'forced_autologin_failure'); END`);
        const failed = await bootstrap(server);
        assert.equal(failed.response.status, 503);
        assert.equal(failed.body.code, 'BOOTSTRAP_COMMITTED_LOGIN_REQUIRED');
        assert.equal(failed.body.bootstrapCompleted, true);
        assert.equal(failed.body.requiresSetup, false);
        assert.equal(failed.body.loginRequired, true);
        assert.match(failed.body.error, /ya fueron confirmados.*No repita.*Recargue/);
        const first = await context.service.loadInstallationState();
        assert.equal(first.state, 'IDENTIFIED');
        assert.match(first.installation_id, UUID_V4);
        assert.equal((await adminRows(context.db)).length, 1);
        assert.equal((await auditRows(context.db)).length, 1);
        assert.deepEqual(await context.db.all('SELECT * FROM sesiones_usuario'), []);
        assert.deepEqual(await server.sessions.all('SELECT * FROM express_sessions'), []);
        assert.equal((await status(server)).requiresSetup, false);
        assert.equal((await bootstrap(server, 'ReintentoIndebido')).response.status, 409);
        await faultDb.run('DROP TRIGGER fail_autologin');
        const login = await fetch(`${server.url}/api/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: 'AdminInicial', password: PASSWORD })
        });
        assert.equal(login.status, 200, server.logs());
        assert.equal((await login.json()).success, true);
        assert.deepEqual(await context.service.loadInstallationState(), first);
        assert.equal((await auditRows(context.db)).length, 1);
        assert.equal((await context.db.all("SELECT * FROM historial_transacciones WHERE tipo_accion = 'login'")).length, 1);
    });
}

for (const [name, sql] of [
    ['sin tabla', 'DROP TABLE installation_metadata'],
    ['sin cabecera', 'DELETE FROM installation_metadata'],
    ['PREPARING', "UPDATE installation_metadata SET state = 'PREPARING'"],
    ['formato futuro', 'UPDATE installation_metadata SET format_version = 2'],
    ['estado inválido', "UPDATE installation_metadata SET state = 'desconocido'"],
    ['UUID inválido', "UPDATE installation_metadata SET state = 'IDENTIFIED', installation_id = 'invalido', confirmed_at = created_at"],
    ['Admin activo en pendiente', `INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('AdminContradictorio', 'hash', 'administrador', 1, '2026-10-25T12:00:00.000Z')`]
]) {
    test(`metadata ${name}: GET/POST bloquean sin reparar ni conceder bootstrap`, async t => {
        const context = await createContext(t);
        const server = await context.start();
        await context.db.run('PRAGMA ignore_check_constraints = ON');
        await context.db.run(sql);
        const snapshot = () => context.db.all('SELECT * FROM installation_metadata');
        const before = name === 'sin tabla' ? null : await snapshot();
        const get = await fetch(`${server.url}/api/public/bootstrap-status`);
        assert.equal(get.status, 503);
        const body = await get.json();
        assert.equal(body.code, 'BOOTSTRAP_STATUS_UNAVAILABLE');
        assert.equal(body.data, undefined);
        const post = await bootstrap(server);
        assert.equal(post.response.status, 503);
        assert.equal(post.body.code, 'BOOTSTRAP_STATUS_UNAVAILABLE');
        assert.equal(await context.db.get("SELECT id FROM usuarios WHERE nombre = 'AdminInicial'"), undefined);
        assert.deepEqual(await auditRows(context.db), []);
        if (before) assert.deepEqual(await snapshot(), before);
        else assert.equal(await context.db.tableExists('installation_metadata'), false);
    });
}

test('conserva validaciones de nombre/password y rechaza nombre ocupado sin cerrar bootstrap', async t => {
    const context = await createContext(t);
    const server = await context.start();
    for (const payload of [
        { nombre: '' }, { nombre: 'ab' }, { nombre: 'a'.repeat(41) }, { nombre: 'nombre inválido' },
        { password: 'corta' }, { confirmPassword: 'diferente' }
    ]) {
        assert.equal((await bootstrap(server, 'AdminInicial', payload)).response.status, 400);
    }
    await context.db.run(`INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('NombreOcupado', 'hash', 'basico', 1, ?)`, [new Date().toISOString()]);
    const conflict = await bootstrap(server, 'NombreOcupado');
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.code, 'BOOTSTRAP_USERNAME_EXISTS');
    assert.deepEqual(await adminRows(context.db), []);
    assert.deepEqual(await auditRows(context.db), []);
    assert.equal((await status(server)).requiresSetup, true);
    assert.equal((await context.service.loadInstallationState()).installation_id, null);
});
