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
const TEST_SECRET = 'mundipos-v4.3.2-fix1-login-guard-secret-with-more-than-32-bytes';
const ORIGINAL_PASSWORD = 'Prueba-v432-fix1-original';
const OTHER_PASSWORD = 'Prueba-v432-fix1-otro';
const EXPECTED_CONFLICT = {
    success: false,
    error: 'Ya existe una sesión autenticada. Cierre la sesión actual antes de iniciar con otra identidad.',
    message: 'Ya existe una sesión autenticada. Cierre la sesión actual antes de iniciar con otra identidad.',
    code: 'SESSION_ALREADY_AUTHENTICATED'
};

let tempDir;
let runningServer;
let reader;
let sessionReader;
let originalUser;
let otherUser;
let originalCookie;
let originalHistoricalSession;
let responsibility;

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

async function login({ cookie, nombre, password }) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    return fetch(`${runningServer.url}/api/auth/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ nombre, password })
    });
}

function getHistoricalSessions(userId) {
    return reader.all('SELECT * FROM sesiones_usuario WHERE usuario_id = ? ORDER BY id', [userId]);
}

function getTransactionHistory() {
    return reader.all('SELECT tipo_accion, usuario_id, descripcion FROM historial_transacciones ORDER BY id');
}

async function assertConflict(response) {
    assert.equal(response.status, 409, runningServer.getLogs());
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), EXPECTED_CONFLICT);
}

async function assertOriginalSessionPreserved() {
    const histories = await getHistoricalSessions(originalUser.id);
    assert.equal(histories.length, 1);
    assert.equal(histories[0].id, originalHistoricalSession.id);
    assert.equal(histories[0].session_uuid, originalHistoricalSession.session_uuid);
    assert.equal(histories[0].express_session_id, originalHistoricalSession.express_session_id);
    assert.equal(histories[0].estado, 'activa');
    assert.equal(histories[0].finalizada_en, null);
    assert.equal(histories[0].motivo_finalizacion, null);

    const technical = await sessionReader.get(
        'SELECT sid, sess FROM express_sessions WHERE sid = ?',
        [originalHistoricalSession.express_session_id]
    );
    assert.equal(technical.sid, originalHistoricalSession.express_session_id);
    const payload = JSON.parse(technical.sess);
    assert.equal(payload.userId, originalUser.id);
    assert.equal(payload.userName, originalUser.nombre);
    assert.equal(payload.userType, originalUser.tipo);
    assert.equal(payload.userSessionUuid, originalHistoricalSession.session_uuid);

    const verifyResponse = await fetch(`${runningServer.url}/api/auth/verify`, {
        headers: { Cookie: originalCookie }
    });
    assert.equal(verifyResponse.status, 200, runningServer.getLogs());
    const verification = await verifyResponse.json();
    assert.equal(verification.authenticated, true);
    assert.equal(verification.user.id, originalUser.id);
    assert.equal(verification.user.nombre, originalUser.nombre);
    assert.equal(verification.user.tipo, originalUser.tipo);
}

before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-v432-fix1-login-'));
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

    const bootstrapResponse = await fetch(`${runningServer.url}/api/auth/bootstrap-admin`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-MundiPOS-Client': 'tablet-fix1-original'
        },
        body: JSON.stringify({
            nombre: 'Admin_fix1_original',
            password: ORIGINAL_PASSWORD,
            confirmPassword: ORIGINAL_PASSWORD
        })
    });
    assert.equal(bootstrapResponse.status, 201, runningServer.getLogs());
    originalCookie = extractCookie(bootstrapResponse);
    originalUser = await reader.get('SELECT * FROM usuarios WHERE nombre = ?', ['Admin_fix1_original']);
    originalHistoricalSession = await reader.get(
        `SELECT * FROM sesiones_usuario
         WHERE usuario_id = ? AND estado = 'activa'
         ORDER BY id DESC LIMIT 1`,
        [originalUser.id]
    );

    const otherPasswordHash = await bcrypt.hash(OTHER_PASSWORD, 4);
    const other = await reader.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES (?, ?, 'administrador', 1, ?)
    `, ['Admin_fix1_alterno', otherPasswordHash, new Date().toISOString()]);
    otherUser = await reader.get('SELECT * FROM usuarios WHERE id = ?', [other.id]);

    const role = await reader.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero fix1', 'salonero-fix1', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [new Date().toISOString()]);
    const zone = await reader.run(`
        INSERT INTO zonas (nombre, slug, orden, aplica_servicio, porcentaje_servicio, activa, creado_en)
        VALUES ('Zona fix1', 'zona-fix1', 1, 1, 10, 1, ?)
    `, [new Date().toISOString()]);
    const seat = await reader.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (4321, 4, 'ocupada', 'zona-fix1', 'mesa', ?, 1, 'Cliente fix1', ?, 2)
    `, [zone.id, new Date().toISOString()]);
    await reader.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id, asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, originalUser.id, role.id, originalUser.id, new Date().toISOString()]);
    responsibility = { mesaId: seat.id, userId: originalUser.id };
});

after(async () => {
    await stopServer(runningServer?.child);
    if (reader) await reader.close();
    if (sessionReader) await sessionReader.close();
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test('rechaza login del mismo usuario y conserva SID, identidad e historial activo', async () => {
    const historyBefore = await getTransactionHistory();
    const response = await login({
        cookie: originalCookie,
        nombre: originalUser.nombre,
        password: ORIGINAL_PASSWORD
    });
    await assertConflict(response);
    await assertOriginalSessionPreserved();
    assert.deepEqual(await getTransactionHistory(), historyBefore);
});

test('rechaza login de otro usuario y no crea una segunda historia', async () => {
    const historyBefore = await getTransactionHistory();
    assert.deepEqual(await getHistoricalSessions(otherUser.id), []);
    const response = await login({
        cookie: originalCookie,
        nombre: otherUser.nombre,
        password: OTHER_PASSWORD
    });
    await assertConflict(response);
    await assertOriginalSessionPreserved();
    assert.deepEqual(await getHistoricalSessions(otherUser.id), []);
    assert.deepEqual(await getTransactionHistory(), historyBefore);
});

test('la reautenticación alternativa no elude la responsabilidad operativa vigente', async () => {
    const responsibilityBefore = await reader.get(
        'SELECT * FROM mesa_responsables WHERE mesa_id = ? AND usuario_id = ?',
        [responsibility.mesaId, responsibility.userId]
    );
    const seatBefore = await reader.get('SELECT * FROM mesas WHERE id = ?', [responsibilityBefore.mesa_id]);
    const historyBefore = await getTransactionHistory();
    const response = await login({
        cookie: originalCookie,
        nombre: otherUser.nombre,
        password: OTHER_PASSWORD
    });
    await assertConflict(response);
    assert.deepEqual(
        await reader.get(
            'SELECT * FROM mesa_responsables WHERE mesa_id = ? AND usuario_id = ?',
            [responsibility.mesaId, responsibility.userId]
        ),
        responsibilityBefore
    );
    assert.deepEqual(
        await reader.get('SELECT * FROM mesas WHERE id = ?', [responsibilityBefore.mesa_id]),
        seatBefore
    );
    await assertOriginalSessionPreserved();
    assert.deepEqual(await getTransactionHistory(), historyBefore);
});

test('un Admin autenticado tampoco puede iniciar con otra identidad', async () => {
    assert.equal(originalUser.tipo, 'administrador');
    const historyBefore = await getTransactionHistory();
    const response = await login({
        cookie: originalCookie,
        nombre: otherUser.nombre,
        password: OTHER_PASSWORD
    });
    await assertConflict(response);
    await assertOriginalSessionPreserved();
    assert.deepEqual(await getTransactionHistory(), historyBefore);
});

test('el login normal sin sesión autenticada conserva su comportamiento', async () => {
    assert.deepEqual(await getHistoricalSessions(otherUser.id), []);
    const response = await login({ nombre: otherUser.nombre, password: OTHER_PASSWORD });
    assert.equal(response.status, 200, runningServer.getLogs());
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.user.id, otherUser.id);
    assert.ok(extractCookie(response));
    const histories = await getHistoricalSessions(otherUser.id);
    assert.equal(histories.length, 1);
    assert.equal(histories[0].estado, 'activa');
});

test('las credenciales inválidas sin sesión autenticada siguen rechazándose sin historia', async () => {
    const sessionsBefore = await reader.all('SELECT * FROM sesiones_usuario ORDER BY id');
    const historyBefore = await getTransactionHistory();
    const response = await login({
        nombre: originalUser.nombre,
        password: 'credencial-incorrecta'
    });
    assert.equal(response.status, 401, runningServer.getLogs());
    assert.deepEqual(await response.json(), { error: 'Contraseña incorrecta' });
    assert.deepEqual(await reader.all('SELECT * FROM sesiones_usuario ORDER BY id'), sessionsBefore);
    assert.deepEqual(await getTransactionHistory(), historyBefore);
});
