const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { Database } = require('./helpers/testDatabase');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_SECRET = 'mundipos-concurrent-session-control-secret-key-32-bytes';
const TEST_PASSWORD = 'Prueba-concurrent-123';

let tempDir;
let runningServer;
let reader;
let sessionReader;
let testUser;

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
        if (child.exitCode !== null) throw new Error(`El servidor terminó antes de iniciar.\n${getLogs()}`);
        try {
            const response = await fetch(`${url}/api/public/bootstrap-status`);
            if (response.ok) return;
        } catch (error) {
            // Inicializando
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

before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-concurrent-test-'));
    const restaurantDbPath = path.join(tempDir, 'restaurant.db');
    const sessionDbPath = path.join(tempDir, 'sessions.db');

    runningServer = await startServer({
        port: await getAvailablePort(),
        restaurantDbPath,
        sessionDbPath
    });

    reader = new Database({ dbPath: restaurantDbPath });
    await reader.connect();
    await reader.run('PRAGMA busy_timeout = 5000');

    sessionReader = new Database({ dbPath: sessionDbPath });
    await sessionReader.connect();
    await sessionReader.run('PRAGMA busy_timeout = 5000');

    // Bootstrap del primer administrador
    const bootstrapResponse = await fetch(`${runningServer.url}/api/auth/bootstrap-admin`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-MundiPOS-Client': 'device-bootstrap-admin'
        },
        body: JSON.stringify({
            nombre: 'Admin_Concurrent',
            password: TEST_PASSWORD,
            confirmPassword: TEST_PASSWORD
        })
    });
    assert.equal(bootstrapResponse.status, 201, runningServer.getLogs());
    testUser = await reader.get('SELECT * FROM usuarios WHERE nombre = ?', ['Admin_Concurrent']);
});

after(async () => {
    if (reader) await reader.close();
    if (sessionReader) await sessionReader.close();
    if (runningServer) await stopServer(runningServer.child);
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

let savedCookieDevice2 = null;

test('Caso A: Dispositivo anterior desconectado se reemplaza automáticamente', async () => {
    // 1. Iniciar sesión desde dispositivo 1
    const login1 = await fetch(`${runningServer.url}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-MundiPOS-Client': 'device-client-1'
        },
        body: JSON.stringify({
            nombre: 'Admin_Concurrent',
            password: TEST_PASSWORD
        })
    });
    assert.equal(login1.status, 200, runningServer.getLogs());
    const cookie1 = extractCookie(login1);
    assert.ok(cookie1);

    const session1Row = await reader.get(
        "SELECT * FROM sesiones_usuario WHERE usuario_id = ? AND client_id = 'device-client-1' AND estado = 'activa'",
        [testUser.id]
    );
    assert.ok(session1Row);
    assert.equal(session1Row.estado, 'activa');

    // 2. Iniciar sesión desde dispositivo 2 (dispositivo 1 NO tiene SSE activo)
    const login2 = await fetch(`${runningServer.url}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-MundiPOS-Client': 'device-client-2'
        },
        body: JSON.stringify({
            nombre: 'Admin_Concurrent',
            password: TEST_PASSWORD
        })
    });

    // Caso A: debe tener éxito automáticamente sin 409
    assert.equal(login2.status, 200, 'El login debe proceder automáticamente al estar el dispositivo 1 desconectado');
    savedCookieDevice2 = extractCookie(login2);
    assert.ok(savedCookieDevice2);

    // Verificar que sesión 1 quedó reemplazada
    const session1After = await reader.get(
        'SELECT * FROM sesiones_usuario WHERE session_uuid = ?',
        [session1Row.session_uuid]
    );
    assert.equal(session1After.estado, 'reemplazada');
    assert.equal(session1After.motivo_finalizacion, 'reemplazo_dispositivo_inactivo');

    // Verificar que sesión técnica 1 fue destruida
    const technical1 = await sessionReader.get(
        'SELECT * FROM express_sessions WHERE sid = ?',
        [session1Row.express_session_id]
    );
    assert.ok(!technical1, 'La sesión técnica de express_sessions debió ser destruida');

    // Verificar que sesión 2 está activa
    const session2Row = await reader.get(
        "SELECT * FROM sesiones_usuario WHERE usuario_id = ? AND client_id = 'device-client-2' AND estado = 'activa'",
        [testUser.id]
    );
    assert.ok(session2Row);
});

test('Caso B1: Dispositivo anterior CONECTADO por SSE rechaza segundo login sin forceClose con 409', async () => {
    assert.ok(savedCookieDevice2, 'Debe existir cookie válida de dispositivo 2');

    // Conectar dispositivo 2 por SSE
    const abortController = new AbortController();
    const sseResponse = await fetch(
        `${runningServer.url}/api/realtime/events?clientId=device-client-2`,
        {
            headers: {
                'X-MundiPOS-Client': 'device-client-2',
                'Cookie': savedCookieDevice2
            },
            signal: abortController.signal
        }
    );
    assert.equal(sseResponse.status, 200, 'SSE debe conectar exitosamente');

    // Esperar brevemente a que el servidor registre el cliente SSE en memoria
    await new Promise(resolve => setTimeout(resolve, 300));

    // 2. Intentar login desde dispositivo 3 SIN forceClose
    const login3WithoutForce = await fetch(`${runningServer.url}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-MundiPOS-Client': 'device-client-3'
        },
        body: JSON.stringify({
            nombre: 'Admin_Concurrent',
            password: TEST_PASSWORD
        })
    });

    assert.equal(login3WithoutForce.status, 409, 'Debe devolver 409 al detectar dispositivo 2 conectado');
    const conflictBody = await login3WithoutForce.json();
    assert.equal(conflictBody.code, 'CONCURRENT_SESSION_ACTIVE');
    assert.equal(conflictBody.details.clientId, 'device-client-2');
    assert.equal(conflictBody.details.deviceActive, true);

    // La sesión 2 debe permanecer activa
    const session2StillActive = await reader.get(
        "SELECT * FROM sesiones_usuario WHERE usuario_id = ? AND client_id = 'device-client-2' AND estado = 'activa'",
        [testUser.id]
    );
    assert.ok(session2StillActive);
    assert.equal(session2StillActive.estado, 'activa');

    // Desconectar SSE del dispositivo 2
    abortController.abort();
    await new Promise(resolve => setTimeout(resolve, 100));
});

test('Caso B2: Dispositivo anterior CONECTADO permite forzar cierre con forceClose: true', async () => {
    const session2Row = await reader.get(
        "SELECT * FROM sesiones_usuario WHERE usuario_id = ? AND client_id = 'device-client-2' AND estado = 'activa'",
        [testUser.id]
    );
    assert.ok(session2Row);

    const abortController = new AbortController();
    const sseResponse = await fetch(
        `${runningServer.url}/api/realtime/events?clientId=device-client-2`,
        {
            headers: {
                'X-MundiPOS-Client': 'device-client-2',
                'Cookie': savedCookieDevice2
            },
            signal: abortController.signal
        }
    );
    assert.equal(sseResponse.status, 200);
    await new Promise(resolve => setTimeout(resolve, 300));

    // 2. Reintentar login desde dispositivo 3 CON forceClose: true
    const login3WithForce = await fetch(`${runningServer.url}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-MundiPOS-Client': 'device-client-3'
        },
        body: JSON.stringify({
            nombre: 'Admin_Concurrent',
            password: TEST_PASSWORD,
            forceClose: true
        })
    });

    assert.equal(login3WithForce.status, 200, 'Login con forceClose debe tener éxito');
    const cookie3 = extractCookie(login3WithForce);
    assert.ok(cookie3);

    // Sesión 2 debió quedar reemplazada con motivo 'reemplazo_forzado_nuevo_dispositivo'
    const session2After = await reader.get(
        'SELECT * FROM sesiones_usuario WHERE session_uuid = ?',
        [session2Row.session_uuid]
    );
    assert.equal(session2After.estado, 'reemplazada');
    assert.equal(session2After.motivo_finalizacion, 'reemplazo_forzado_nuevo_dispositivo');

    // Sesión técnica 2 debió ser eliminada
    const technical2 = await sessionReader.get(
        'SELECT * FROM express_sessions WHERE sid = ?',
        [session2Row.express_session_id]
    );
    assert.ok(!technical2);

    // Sesión 3 debe estar activa
    const session3Row = await reader.get(
        "SELECT * FROM sesiones_usuario WHERE usuario_id = ? AND client_id = 'device-client-3' AND estado = 'activa'",
        [testUser.id]
    );
    assert.ok(session3Row);

    abortController.abort();
    await new Promise(resolve => setTimeout(resolve, 100));
});

test('Mismo dispositivo: reconexión o re-login con mismo client_id procede normalmente', async () => {
    // Dispositivo 3 vuelve a iniciar sesión (mismo client_id)
    const reloginDevice3 = await fetch(`${runningServer.url}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-MundiPOS-Client': 'device-client-3'
        },
        body: JSON.stringify({
            nombre: 'Admin_Concurrent',
            password: TEST_PASSWORD
        })
    });

    assert.equal(reloginDevice3.status, 200, 'Re-login del mismo dispositivo debe proceder sin 409');
});

