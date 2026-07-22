const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const { Database, createTestDatabase } = require('./helpers/testDatabase');
const { SQLiteSessionStore } = require('../server/services/sqliteSessionStore');
const {
    UserSessionService,
    USER_SESSION_END_REASONS
} = require('../server/services/userSessionService');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_SECRET = 'mundipos-v4.2.2-lifecycle-test-secret-with-more-than-32-bytes';

function callStore(store, method, ...args) {
    return new Promise((resolve, reject) => {
        store[method](...args, (error, value) => error ? reject(error) : resolve(value));
    });
}

async function initializeSchema(db) {
    await db.createTables();
    await db.migrateSchema();
    await db.createIndexes();
}

async function insertUser(db, name) {
    const result = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES (?, 'hash-prueba', 'administrador', 1, ?)
    `, [name, new Date().toISOString()]);
    return Number(result.id);
}

async function getAvailablePort() {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    server.close();
    await once(server, 'close');
    return port;
}

async function waitForServer(url, child, getLogs) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`El servidor terminó antes de iniciar.\n${getLogs()}`);
        }
        try {
            const response = await fetch(`${url}/api/public/bootstrap-status`);
            if (response.ok) return;
        } catch (error) {
            // El proceso todavía está inicializando sus dos bases SQLite.
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Tiempo agotado esperando el servidor.\n${getLogs()}`);
}

async function startServer({ port, restaurantDbPath, sessionDbPath }) {
    let logs = '';
    const child = spawn(process.execPath, ['server/app.js'], {
        cwd: PROJECT_ROOT,
        env: {
            ...process.env,
            PORT: String(port),
            HOST: '127.0.0.1',
            NODE_ENV: 'test',
            HTTPS_ENABLED: 'false',
            COOKIE_SECURE: 'false',
            SESSION_SECRET: TEST_SECRET,
            DB_PATH: restaurantDbPath,
            SESSION_DB_PATH: sessionDbPath
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { logs += chunk.toString(); });
    child.stderr.on('data', chunk => { logs += chunk.toString(); });

    const url = `http://127.0.0.1:${port}`;
    await waitForServer(url, child, () => logs);
    return { child, url, getLogs: () => logs };
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return;
    child.kill();
    const result = await Promise.race([
        once(child, 'exit'),
        new Promise(resolve => setTimeout(resolve, 5000, 'timeout'))
    ]);
    if (result === 'timeout' && child.exitCode === null) {
        child.kill('SIGKILL');
        await once(child, 'exit');
    }
}

function extractCookie(response) {
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie, 'La autenticación debe devolver la cookie pos.sid');
    return setCookie.split(';', 1)[0];
}

test('login, verify, rechazo de reautenticación, reinicio y logout mantienen un historial coherente', { timeout: 90000 }, async t => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-v422-http-'));
    const restaurantDbPath = path.join(tempDir, 'restaurant.db');
    const sessionDbPath = path.join(tempDir, 'sessions.db');
    const port = await getAvailablePort();
    let runningServer = null;
    let reader = null;
    let sessionReader = null;

    t.after(async () => {
        await stopServer(runningServer?.child);
        if (reader) await reader.close();
        if (sessionReader) await sessionReader.close();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    runningServer = await startServer({ port, restaurantDbPath, sessionDbPath });
    reader = new Database({ dbPath: restaurantDbPath });
    await reader.connect();
    await reader.run('PRAGMA busy_timeout = 5000');
    sessionReader = new Database({ dbPath: sessionDbPath });
    await sessionReader.connect();
    await sessionReader.run('PRAGMA busy_timeout = 5000');

    const bootstrapResponse = await fetch(`${runningServer.url}/api/auth/bootstrap-admin`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-MundiPOS-Client': 'tablet-bootstrap'
        },
        body: JSON.stringify({
            nombre: 'Admin_v422',
            password: 'Prueba-v422-segura',
            confirmPassword: 'Prueba-v422-segura'
        })
    });
    assert.equal(bootstrapResponse.status, 201, runningServer.getLogs());
    const bootstrapCookie = extractCookie(bootstrapResponse);

    let sessionRows = await reader.all('SELECT * FROM sesiones_usuario ORDER BY id');
    assert.equal(sessionRows.length, 1);
    assert.equal(sessionRows[0].estado, 'activa');
    assert.match(sessionRows[0].session_uuid, /^[0-9a-f-]{36}$/i);
    assert.ok(sessionRows[0].express_session_id);
    assert.equal(sessionRows[0].client_id, 'tablet-bootstrap');
    assert.ok(sessionRows[0].iniciada_en);
    assert.equal(sessionRows[0].finalizada_en, null);
    assert.equal(sessionRows[0].motivo_finalizacion, null);
    const bootstrapTechnical = await sessionReader.get(
        'SELECT sid FROM express_sessions WHERE sid = ?',
        [sessionRows[0].express_session_id]
    );
    assert.equal(bootstrapTechnical?.sid, sessionRows[0].express_session_id);

    const bootstrapLogout = await fetch(`${runningServer.url}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: bootstrapCookie }
    });
    assert.equal(bootstrapLogout.status, 200, runningServer.getLogs());
    sessionRows = await reader.all('SELECT * FROM sesiones_usuario ORDER BY id');
    assert.equal(sessionRows[0].estado, 'cerrada');
    assert.ok(sessionRows[0].finalizada_en);
    assert.equal(sessionRows[0].motivo_finalizacion, USER_SESSION_END_REASONS.LOGOUT);

    const countBeforeFailedLogin = sessionRows.length;
    const failedLogin = await fetch(`${runningServer.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: 'Admin_v422', password: 'incorrecta' })
    });
    assert.equal(failedLogin.status, 401);
    sessionRows = await reader.all('SELECT * FROM sesiones_usuario ORDER BY id');
    assert.equal(sessionRows.length, countBeforeFailedLogin);

    const loginResponse = await fetch(`${runningServer.url}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-MundiPOS-Client': 'tablet-caja-1'
        },
        body: JSON.stringify({ nombre: 'Admin_v422', password: 'Prueba-v422-segura' })
    });
    assert.equal(loginResponse.status, 200, runningServer.getLogs());
    const cookie = extractCookie(loginResponse);
    sessionRows = await reader.all('SELECT * FROM sesiones_usuario ORDER BY id');
    const firstLoginRow = sessionRows.at(-1);
    assert.equal(firstLoginRow.estado, 'activa');
    assert.equal(firstLoginRow.client_id, 'tablet-caja-1');

    const countBeforeVerify = sessionRows.length;
    for (let index = 0; index < 3; index += 1) {
        const verify = await fetch(`${runningServer.url}/api/auth/verify`, {
            headers: { Cookie: cookie }
        });
        assert.equal(verify.status, 200);
        assert.equal((await verify.json()).authenticated, true);
    }
    sessionRows = await reader.all('SELECT * FROM sesiones_usuario ORDER BY id');
    assert.equal(sessionRows.length, countBeforeVerify);
    assert.equal(sessionRows.filter(row => row.estado === 'activa').length, 1);

    const reauthentication = await fetch(`${runningServer.url}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            'X-MundiPOS-Client': 'tablet-caja-1'
        },
        body: JSON.stringify({ nombre: 'Admin_v422', password: 'Prueba-v422-segura' })
    });
    assert.equal(reauthentication.status, 409, runningServer.getLogs());
    assert.deepEqual(await reauthentication.json(), {
        success: false,
        error: 'Ya existe una sesión autenticada. Cierre la sesión actual antes de iniciar con otra identidad.',
        message: 'Ya existe una sesión autenticada. Cierre la sesión actual antes de iniciar con otra identidad.',
        code: 'SESSION_ALREADY_AUTHENTICATED'
    });

    const correlatedRows = await reader.all(`
        SELECT * FROM sesiones_usuario
        WHERE express_session_id = ?
        ORDER BY id
    `, [firstLoginRow.express_session_id]);
    assert.equal(correlatedRows.length, 1);
    assert.equal(correlatedRows[0].estado, 'activa');
    assert.equal(correlatedRows[0].finalizada_en, null);
    assert.equal(correlatedRows[0].motivo_finalizacion, null);
    assert.equal(correlatedRows[0].session_uuid, firstLoginRow.session_uuid);

    const countBeforeRestart = (await reader.all('SELECT * FROM sesiones_usuario')).length;
    await stopServer(runningServer.child);
    runningServer = await startServer({ port, restaurantDbPath, sessionDbPath });

    const verifyAfterRestart = await fetch(`${runningServer.url}/api/auth/verify`, {
        headers: { Cookie: cookie }
    });
    assert.equal(verifyAfterRestart.status, 200, runningServer.getLogs());
    assert.equal((await verifyAfterRestart.json()).authenticated, true);

    sessionRows = await reader.all('SELECT * FROM sesiones_usuario ORDER BY id');
    assert.equal(sessionRows.length, countBeforeRestart);
    const activeAfterRestart = sessionRows.filter(row => row.estado === 'activa');
    assert.equal(activeAfterRestart.length, 1);
    assert.equal(activeAfterRestart[0].session_uuid, correlatedRows[0].session_uuid);

    const logoutResponse = await fetch(`${runningServer.url}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookie }
    });
    assert.equal(logoutResponse.status, 200, runningServer.getLogs());

    const finalLifecycle = await reader.get(
        'SELECT * FROM sesiones_usuario WHERE session_uuid = ?',
        [correlatedRows[0].session_uuid]
    );
    assert.equal(finalLifecycle.estado, 'cerrada');
    assert.ok(finalLifecycle.finalizada_en);
    assert.equal(finalLifecycle.motivo_finalizacion, USER_SESSION_END_REASONS.LOGOUT);
    const destroyedTechnical = await sessionReader.get(
        'SELECT sid FROM express_sessions WHERE sid = ?',
        [correlatedRows[0].express_session_id]
    );
    assert.equal(destroyedTechnical, undefined);
    const verifyAfterLogout = await fetch(`${runningServer.url}/api/auth/verify`, {
        headers: { Cookie: cookie }
    });
    assert.equal(verifyAfterLogout.status, 200);
    assert.equal((await verifyAfterLogout.json()).authenticated, false);

    const historyActions = await reader.all(`
        SELECT tipo_accion
        FROM historial_transacciones
        WHERE tipo_accion IN ('bootstrap_admin', 'login', 'logout')
        ORDER BY id
    `);
    assert.deepEqual(
        historyActions.map(row => row.tipo_accion),
        ['bootstrap_admin', 'logout', 'login', 'logout']
    );
});

test('la expiración técnica por acceso y limpieza actualiza historia sin borrar filas', async t => {
    const context = await createTestDatabase();
    let store = null;
    t.after(async () => {
        if (store) await callStore(store, 'close').catch(() => null);
        await context.cleanup();
    });
    await initializeSchema(context.db);

    const userId = await insertUser(context.db, 'usuario-expiracion');
    const service = new UserSessionService({ db: context.db });
    store = new SQLiteSessionStore({
        dbPath: path.join(context.tempDir, 'sessions.db'),
        cleanupIntervalMs: 0
    });
    await store.ready();
    const installExpirationHandler = () => {
        store.setExpirationHandler(({ sid, expiresAt }) => (
            service.expireActiveByExpressSessionId(sid, {
                endedAt: new Date(expiresAt).toISOString()
            })
        ));
    };
    installExpirationHandler();

    const expiredByGetAt = Date.now() - 2000;
    await service.startAuthenticatedSession({
        sessionUuid: '42200000-0000-4000-8000-000000000001',
        userId,
        expressSessionId: 'sid-expira-get',
        startedAt: new Date(expiredByGetAt - 5000).toISOString()
    });
    await callStore(store, 'set', 'sid-expira-get', {
        userId,
        userSessionUuid: '42200000-0000-4000-8000-000000000001',
        cookie: { expires: new Date(expiredByGetAt).toISOString() }
    });
    assert.equal(await callStore(store, 'get', 'sid-expira-get'), null);

    const expiredByGet = await service.findByUuid('42200000-0000-4000-8000-000000000001');
    assert.equal(expiredByGet.estado, 'expirada');
    assert.equal(expiredByGet.finalizada_en, new Date(expiredByGetAt).toISOString());
    assert.equal(expiredByGet.motivo_finalizacion, USER_SESSION_END_REASONS.TTL_EXPIRATION);

    const expiredByCleanupAt = Date.now() - 1000;
    await service.startAuthenticatedSession({
        sessionUuid: '42200000-0000-4000-8000-000000000002',
        userId,
        expressSessionId: 'sid-expira-cleanup',
        startedAt: new Date(expiredByCleanupAt - 5000).toISOString()
    });
    await callStore(store, 'set', 'sid-expira-cleanup', {
        userId,
        userSessionUuid: '42200000-0000-4000-8000-000000000002',
        cookie: { expires: new Date(expiredByCleanupAt).toISOString() }
    });
    await store.deleteExpired();

    const expiredByCleanup = await service.findByUuid('42200000-0000-4000-8000-000000000002');
    assert.equal(expiredByCleanup.estado, 'expirada');
    assert.equal(expiredByCleanup.finalizada_en, new Date(expiredByCleanupAt).toISOString());
    assert.equal(expiredByCleanup.motivo_finalizacion, USER_SESSION_END_REASONS.TTL_EXPIRATION);

    const expiredAtStartup = Date.now() - 500;
    await service.startAuthenticatedSession({
        sessionUuid: '42200000-0000-4000-8000-000000000005',
        userId,
        expressSessionId: 'sid-expira-startup',
        startedAt: new Date(expiredAtStartup - 5000).toISOString()
    });
    await callStore(store, 'set', 'sid-expira-startup', {
        userId,
        userSessionUuid: '42200000-0000-4000-8000-000000000005',
        cookie: { expires: new Date(expiredAtStartup).toISOString() }
    });
    await callStore(store, 'close');
    store = new SQLiteSessionStore({
        dbPath: path.join(context.tempDir, 'sessions.db'),
        cleanupIntervalMs: 0,
        deferInitialCleanup: true
    });
    await store.ready();
    installExpirationHandler();
    assert.deepEqual(await store.listActiveSessions(), []);

    const expiredByStartup = await service.findByUuid('42200000-0000-4000-8000-000000000005');
    assert.equal(expiredByStartup.estado, 'expirada');
    assert.equal(expiredByStartup.finalizada_en, new Date(expiredAtStartup).toISOString());
    assert.equal(expiredByStartup.motivo_finalizacion, USER_SESSION_END_REASONS.TTL_EXPIRATION);

    const history = await service.listByUser(userId);
    assert.equal(history.length, 3);
    assert.ok(history.every(row => row.estado === 'expirada'));
    assert.equal(await callStore(store, 'length'), 0);
});

test('la reconciliación conserva sesiones válidas, expira huérfanas y reconstruye legado una sola vez', async t => {
    const context = await createTestDatabase();
    let store = null;
    t.after(async () => {
        if (store) await callStore(store, 'close').catch(() => null);
        await context.cleanup();
    });
    await initializeSchema(context.db);

    const userId = await insertUser(context.db, 'usuario-reconciliacion');
    const service = new UserSessionService({
        db: context.db,
        clock: () => '2026-07-21T18:00:00.000Z'
    });
    await service.startAuthenticatedSession({
        sessionUuid: '42200000-0000-4000-8000-000000000003',
        userId,
        expressSessionId: 'sid-huerfano',
        startedAt: '2026-07-21T17:00:00.000Z'
    });
    await service.startAuthenticatedSession({
        sessionUuid: '42200000-0000-4000-8000-000000000004',
        userId,
        expressSessionId: 'sid-valido',
        clientId: 'cliente-valido',
        startedAt: '2026-07-21T17:10:00.000Z'
    });

    store = new SQLiteSessionStore({
        dbPath: path.join(context.tempDir, 'sessions.db'),
        cleanupIntervalMs: 0
    });
    await store.ready();
    const futureExpiry = Date.now() + 60 * 60 * 1000;
    await callStore(store, 'set', 'sid-valido', {
        userId,
        userSessionUuid: '42200000-0000-4000-8000-000000000004',
        userSessionClientId: 'cliente-valido',
        cookie: {
            expires: new Date(futureExpiry).toISOString(),
            originalMaxAge: 60 * 60 * 1000
        }
    });
    await callStore(store, 'set', 'sid-legado', {
        userId,
        userSessionClientId: 'cliente-legado',
        cookie: {
            expires: new Date(futureExpiry).toISOString(),
            originalMaxAge: 60 * 60 * 1000
        }
    });

    const technicalSessions = await store.listActiveSessions();
    await service.reconcileActiveSessions(technicalSessions);
    await service.reconcileActiveSessions(technicalSessions);

    const orphan = await service.findByUuid('42200000-0000-4000-8000-000000000003');
    assert.equal(orphan.estado, 'expirada');
    assert.equal(
        orphan.motivo_finalizacion,
        USER_SESSION_END_REASONS.RECONCILIATION_MISSING
    );

    const valid = await service.findByUuid('42200000-0000-4000-8000-000000000004');
    assert.equal(valid.estado, 'activa');
    assert.equal(valid.finalizada_en, null);

    const legacyRows = await service.findByExpressSessionId('sid-legado');
    assert.equal(legacyRows.length, 1);
    assert.equal(legacyRows[0].usuario_id, userId);
    assert.equal(legacyRows[0].client_id, 'cliente-legado');
    assert.equal(legacyRows[0].estado, 'activa');

    const allRows = await service.listByUser(userId);
    assert.equal(allRows.length, 3);
    assert.equal(allRows.filter(row => row.estado === 'activa').length, 2);
});

test('v4.2.2 conserva la separación técnica y v4.3.2 usa el evaluador canónico', async () => {
    const [authSource, storeSource] = await Promise.all([
        fs.readFile(path.join(PROJECT_ROOT, 'server/routes/auth.js'), 'utf8'),
        fs.readFile(path.join(PROJECT_ROOT, 'server/services/sqliteSessionStore.js'), 'utf8')
    ]);
    const logoutStart = authSource.indexOf("router.post('/logout'");
    const logoutEnd = authSource.indexOf("router.get('/verify'", logoutStart);
    const logoutSource = authSource.slice(logoutStart, logoutEnd);
    const serviceMethods = Object.getOwnPropertyNames(UserSessionService.prototype);

    assert.ok(logoutStart >= 0 && logoutEnd > logoutStart);
    assert.doesNotMatch(authSource, /\.regenerate\s*\(/);
    assert.doesNotMatch(storeSource, /sesiones_usuario/);
    assert.match(
        logoutSource,
        /operationalResponsibilityService\.getUserResponsibilities\s*\(/
    );
    assert.doesNotMatch(
        logoutSource,
        /mesa_responsables|cuenta_responsables|estado_operativo|FROM\s+pedidos/i
    );
    assert.ok(!serviceMethods.includes('heartbeat'));
    assert.ok(!serviceMethods.includes('transfer'));
    assert.ok(!serviceMethods.includes('revokeAutomatically'));
    assert.ok(!serviceMethods.includes('enforceUserSessionLimit'));
});
