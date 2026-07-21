const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const { SQLiteSessionStore } = require('../server/services/sqliteSessionStore');

const root = path.resolve(__dirname, '..');
const TEST_SECRET = 'mundipos-v4.1.1-test-secret-with-more-than-32-bytes';

function callStore(store, method, ...args) {
    return new Promise((resolve, reject) => {
        store[method](...args, (error, value) => error ? reject(error) : resolve(value));
    });
}

function createTempDirectory() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-session-test-'));
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
            // El proceso todavía está inicializando SQLite y las rutas.
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Tiempo agotado esperando el servidor.\n${getLogs()}`);
}

async function startServer({ port, restaurantDbPath, sessionDbPath }) {
    let logs = '';
    const child = spawn(process.execPath, ['server/app.js'], {
        cwd: root,
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
    assert.ok(setCookie, 'El login debe devolver la cookie pos.sid');
    return setCookie.split(';', 1)[0];
}

test('el store persiste sesiones, expone all() y no devuelve sesiones expiradas', async t => {
    const tempDir = await createTempDirectory();
    let store = new SQLiteSessionStore({
        dbPath: path.join(tempDir, 'sessions.db'),
        cleanupIntervalMs: 0
    });
    t.after(async () => {
        await callStore(store, 'close').catch(() => null);
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    await store.ready();
    const activeSession = {
        cookie: { expires: new Date(Date.now() + 60000).toISOString() },
        userId: 42,
        activeWorkRoleIds: [3]
    };
    await callStore(store, 'set', 'active-sid', activeSession);
    assert.deepEqual(await callStore(store, 'get', 'active-sid'), activeSession);
    assert.deepEqual(await callStore(store, 'all'), [activeSession]);
    assert.equal(await callStore(store, 'length'), 1);

    await callStore(store, 'set', 'expired-sid', {
        cookie: { expires: new Date(Date.now() - 1000).toISOString() },
        userId: 99
    });
    await callStore(store, 'close');
    store = new SQLiteSessionStore({
        dbPath: path.join(tempDir, 'sessions.db'),
        cleanupIntervalMs: 0
    });
    await store.ready();
    assert.equal(await callStore(store, 'get', 'expired-sid'), null);
    assert.equal(await callStore(store, 'get', 'missing-sid'), null);
    assert.deepEqual(await callStore(store, 'all'), [activeSession]);
});

test('login, verify, reinicio de Node y logout conservan el contrato actual', { timeout: 90000 }, async t => {
    const tempDir = await createTempDirectory();
    const restaurantDbPath = path.join(tempDir, 'restaurant.db');
    const sessionDbPath = path.join(tempDir, 'sessions.db');
    const port = await getAvailablePort();
    let runningServer = null;
    t.after(async () => {
        await stopServer(runningServer?.child);
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    runningServer = await startServer({ port, restaurantDbPath, sessionDbPath });
    const bootstrapResponse = await fetch(`${runningServer.url}/api/auth/bootstrap-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nombre: 'Admin_v411',
            password: 'Prueba-v411-segura',
            confirmPassword: 'Prueba-v411-segura'
        })
    });
    assert.equal(bootstrapResponse.status, 201, runningServer.getLogs());
    const bootstrapCookie = extractCookie(bootstrapResponse);
    const bootstrapLogoutResponse = await fetch(`${runningServer.url}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: bootstrapCookie }
    });
    assert.equal(bootstrapLogoutResponse.status, 200);

    const loginResponse = await fetch(`${runningServer.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nombre: 'Admin_v411',
            password: 'Prueba-v411-segura'
        })
    });
    assert.equal(loginResponse.status, 200, runningServer.getLogs());
    const cookie = extractCookie(loginResponse);

    const verifyBeforeRestart = await fetch(`${runningServer.url}/api/auth/verify`, {
        headers: { Cookie: cookie }
    });
    assert.equal(verifyBeforeRestart.status, 200);
    assert.equal((await verifyBeforeRestart.json()).authenticated, true);

    await stopServer(runningServer.child);
    runningServer = await startServer({ port, restaurantDbPath, sessionDbPath });
    const verifyAfterRestart = await fetch(`${runningServer.url}/api/auth/verify`, {
        headers: { Cookie: cookie }
    });
    assert.equal(verifyAfterRestart.status, 200);
    const recoveredSession = await verifyAfterRestart.json();
    assert.equal(recoveredSession.authenticated, true);
    assert.equal(recoveredSession.user.nombre, 'Admin_v411');

    const logoutResponse = await fetch(`${runningServer.url}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookie }
    });
    assert.equal(logoutResponse.status, 200);

    const verifyAfterLogout = await fetch(`${runningServer.url}/api/auth/verify`, {
        headers: { Cookie: cookie }
    });
    assert.equal(verifyAfterLogout.status, 200);
    assert.equal((await verifyAfterLogout.json()).authenticated, false);
});
