const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const { Database } = require('./helpers/testDatabase');
const { USER_SESSION_END_REASONS } = require('../server/services/userSessionService');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_SECRET = 'mundipos-v4.3.2-logout-test-secret-with-more-than-32-bytes';
const NOW = '2026-07-21T12:00:00.000Z';

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

async function createHttpFixture(t, label) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `mundipos-v432-${label}-`));
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

    const adminName = `Admin_v432_${label}`;
    const bootstrapResponse = await fetch(`${runningServer.url}/api/auth/bootstrap-admin`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-MundiPOS-Client': `logout-${label}`
        },
        body: JSON.stringify({
            nombre: adminName,
            password: 'Prueba-v432-segura',
            confirmPassword: 'Prueba-v432-segura'
        })
    });
    assert.equal(bootstrapResponse.status, 201, runningServer.getLogs());
    const cookie = extractCookie(bootstrapResponse);
    const user = await reader.get('SELECT * FROM usuarios WHERE nombre = ?', [adminName]);
    const historicalSession = await reader.get(
        `SELECT * FROM sesiones_usuario
         WHERE usuario_id = ? AND estado = 'activa'
         ORDER BY id DESC LIMIT 1`,
        [user.id]
    );
    assert.ok(historicalSession);

    return {
        ...runningServer,
        reader,
        sessionReader,
        cookie,
        user,
        historicalSession
    };
}

async function createOperationalContext(fixture, options = {}) {
    const role = await fixture.reader.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero v4.3.2', 'salonero-v4-3-2', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [NOW]);
    const zone = await fixture.reader.run(`
        INSERT INTO zonas (nombre, slug, orden, aplica_servicio, porcentaje_servicio, activa, creado_en)
        VALUES ('Zona v4.3.2', 'zona-v4-3-2', 1, 1, 10, 1, ?)
    `, [NOW]);
    const seat = await fixture.reader.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (432, 4, ?, 'zona-v4-3-2', 'mesa', ?, 1, 'Cliente', ?, 2)
    `, [options.seatState || 'ocupada', zone.id, NOW]);

    const responsibleUserId = options.responsibleUserId ?? fixture.user.id;
    if (options.assign !== false) {
        await fixture.reader.run(`
            INSERT INTO mesa_responsables (
                mesa_id, usuario_id, rol_trabajo_id, asignado_por_usuario_id, fecha_asignacion
            ) VALUES (?, ?, ?, ?, ?)
        `, [seat.id, responsibleUserId, role.id, responsibleUserId, NOW]);
    }

    let account = null;
    if (options.account) {
        account = await fixture.reader.run(`
            INSERT INTO pedidos (
                mesa_id, usuario_id, rol_trabajo_id, fecha, estado, total,
                cliente_nombre, numero_cuenta, estado_operativo, estado_financiero,
                total_pagado, saldo_pendiente, fecha_apertura
            ) VALUES (?, ?, ?, ?, ?, 1000, 'Cliente', 'CTA-V432', ?, ?, ?, ?, ?)
        `, [
            seat.id,
            responsibleUserId,
            role.id,
            NOW,
            options.account.state || 'pendiente',
            options.account.operationalState || 'abierta',
            options.account.financialState || 'sin_documentos',
            options.account.paid ?? 0,
            options.account.balance ?? 1000,
            NOW
        ]);
    }

    if (options.historicalAccountResponsibility) {
        await fixture.reader.run(`
            INSERT INTO cuenta_responsables (
                pedido_id, usuario_id, rol_trabajo_id, usuario_nombre_snapshot,
                rol_nombre_snapshot, es_principal, fecha_asignacion_snapshot
            ) VALUES (?, ?, ?, ?, 'Salonero v4.3.2', 1, ?)
        `, [account.id, fixture.user.id, role.id, fixture.user.nombre, NOW]);
    }

    return { role, zone, seat, account };
}

async function createOtherUser(fixture) {
    return fixture.reader.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Otro usuario v4.3.2', 'hash', 'basico', 1, ?)
    `, [NOW]);
}

async function snapshotOperationalState(reader) {
    return {
        mesas: await reader.all('SELECT * FROM mesas ORDER BY id'),
        responsables: await reader.all('SELECT * FROM mesa_responsables ORDER BY mesa_id, usuario_id'),
        pedidos: await reader.all('SELECT * FROM pedidos ORDER BY id')
    };
}

function postLogout(fixture, cookie = fixture.cookie) {
    const headers = cookie ? { Cookie: cookie } : {};
    return fetch(`${fixture.url}/api/auth/logout`, { method: 'POST', headers });
}

function verify(fixture) {
    return fetch(`${fixture.url}/api/auth/verify`, {
        headers: { Cookie: fixture.cookie }
    });
}

async function assertSessionRemainsActive(fixture) {
    const historical = await fixture.reader.get(
        'SELECT * FROM sesiones_usuario WHERE id = ?',
        [fixture.historicalSession.id]
    );
    assert.equal(historical.estado, 'activa');
    assert.equal(historical.finalizada_en, null);
    assert.equal(historical.motivo_finalizacion, null);

    const technical = await fixture.sessionReader.get(
        'SELECT * FROM express_sessions WHERE sid = ?',
        [fixture.historicalSession.express_session_id]
    );
    assert.equal(technical.sid, fixture.historicalSession.express_session_id);
    assert.equal(JSON.parse(technical.sess).userId, fixture.user.id);

    const logoutHistory = await fixture.reader.get(
        `SELECT COUNT(*) AS total FROM historial_transacciones
         WHERE usuario_id = ? AND tipo_accion = 'logout'`,
        [fixture.user.id]
    );
    assert.equal(Number(logoutHistory.total), 0);

    const verifyResponse = await verify(fixture);
    assert.equal(verifyResponse.status, 200, fixture.getLogs());
    assert.equal((await verifyResponse.json()).authenticated, true);
}

async function assertLogoutCompleted(fixture, response) {
    assert.equal(response.status, 200, fixture.getLogs());
    assert.deepEqual(await response.json(), {
        success: true,
        message: 'Sesión cerrada exitosamente'
    });

    const historical = await fixture.reader.get(
        'SELECT * FROM sesiones_usuario WHERE id = ?',
        [fixture.historicalSession.id]
    );
    assert.equal(historical.estado, 'cerrada');
    assert.ok(historical.finalizada_en);
    assert.equal(historical.motivo_finalizacion, USER_SESSION_END_REASONS.LOGOUT);

    const technical = await fixture.sessionReader.get(
        'SELECT sid FROM express_sessions WHERE sid = ?',
        [fixture.historicalSession.express_session_id]
    );
    assert.equal(technical, undefined);

    const logoutHistory = await fixture.reader.get(
        `SELECT COUNT(*) AS total FROM historial_transacciones
         WHERE usuario_id = ? AND tipo_accion = 'logout'`,
        [fixture.user.id]
    );
    assert.equal(Number(logoutHistory.total), 1);

    const verifyResponse = await verify(fixture);
    assert.equal(verifyResponse.status, 200, fixture.getLogs());
    assert.deepEqual(await verifyResponse.json(), { authenticated: false });
}

test('permite logout sin responsabilidad y conserva el cierre histórico/técnico previo', { timeout: 90000 }, async t => {
    const fixture = await createHttpFixture(t, 'sin-responsabilidad');

    await assertLogoutCompleted(fixture, await postLogout(fixture));
});

test('bloquea logout con mesa propia activa sin mutar operación ni destruir sesión', { timeout: 90000 }, async t => {
    const fixture = await createHttpFixture(t, 'mesa-propia');
    const { seat } = await createOperationalContext(fixture);
    const before = await snapshotOperationalState(fixture.reader);

    const response = await postLogout(fixture);
    const body = await response.json();

    assert.equal(response.status, 409, fixture.getLogs());
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(body.success, false);
    assert.equal(body.code, 'OPERATIONAL_RESPONSIBILITY_ACTIVE');
    assert.equal(body.tiene_responsabilidad, true);
    assert.equal(body.total, 1);
    assert.equal(body.responsabilidades.length, 1);
    assert.equal(body.responsabilidades[0].tipo, 'mesa');
    assert.equal(body.responsabilidades[0].id, seat.id);
    assert.deepEqual(body.responsabilidades[0].causas, ['mesa_ocupada']);
    assert.equal(body.responsabilidades[0].asignacion.usuario_id, fixture.user.id);
    await assertSessionRemainsActive(fixture);
    assert.deepEqual(await snapshotOperationalState(fixture.reader), before);
});

test('no atribuye al usuario actual el trabajo activo asignado a otro usuario', { timeout: 90000 }, async t => {
    const fixture = await createHttpFixture(t, 'otro-usuario');
    const otherUser = await createOtherUser(fixture);
    await createOperationalContext(fixture, { responsibleUserId: otherUser.id });

    await assertLogoutCompleted(fixture, await postLogout(fixture));
});

test('bloquea una cuenta pagada y conciliada mientras el servicio siga abierto', { timeout: 90000 }, async t => {
    const fixture = await createHttpFixture(t, 'pagada-abierta');
    const { account } = await createOperationalContext(fixture, {
        account: {
            state: 'pagado',
            operationalState: 'abierta',
            financialState: 'conciliada',
            paid: 1000,
            balance: 0
        }
    });
    const before = await snapshotOperationalState(fixture.reader);

    const response = await postLogout(fixture);
    const body = await response.json();

    assert.equal(response.status, 409, fixture.getLogs());
    assert.equal(body.code, 'OPERATIONAL_RESPONSIBILITY_ACTIVE');
    assert.deepEqual(body.responsabilidades[0].causas, [
        'mesa_ocupada',
        'cuenta_operativa_abierta'
    ]);
    assert.deepEqual(body.responsabilidades[0].cuentas_operativas, [{
        id: account.id,
        numero_cuenta: 'CTA-V432',
        estado_operativo: 'abierta',
        estado_financiero: 'conciliada',
        total_pagado: 1000,
        saldo_pendiente: 0
    }]);
    await assertSessionRemainsActive(fixture);
    assert.deepEqual(await snapshotOperationalState(fixture.reader), before);
});

test('permite logout con servicio cerrado/liberado aunque exista snapshot histórico', { timeout: 90000 }, async t => {
    const fixture = await createHttpFixture(t, 'servicio-finalizado');
    await createOperationalContext(fixture, {
        seatState: 'libre',
        assign: false,
        account: {
            state: 'pagado',
            operationalState: 'cerrada',
            financialState: 'conciliada',
            paid: 1000,
            balance: 0
        },
        historicalAccountResponsibility: true
    });

    await assertLogoutCompleted(fixture, await postLogout(fixture));
});

test('falla cerrado si el evaluador no está disponible y mantiene la sesión activa', { timeout: 90000 }, async t => {
    const fixture = await createHttpFixture(t, 'fallo-evaluador');
    await fixture.reader.run(
        'ALTER TABLE mesa_responsables RENAME TO mesa_responsables_indisponible'
    );

    const response = await postLogout(fixture);
    const body = await response.json();

    assert.equal(response.status, 500, fixture.getLogs());
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(body, {
        success: false,
        error: 'No fue posible verificar las responsabilidades operativas. La sesión permanece activa.',
        code: 'OPERATIONAL_RESPONSIBILITY_CHECK_FAILED',
        message: 'No fue posible verificar las responsabilidades operativas. La sesión permanece activa.'
    });
    await assertSessionRemainsActive(fixture);
});

test('mantiene idempotente el logout sin sesión autenticada', { timeout: 90000 }, async t => {
    const fixture = await createHttpFixture(t, 'sin-sesion');
    await assertLogoutCompleted(fixture, await postLogout(fixture));

    const response = await postLogout(fixture, null);

    assert.equal(response.status, 200, fixture.getLogs());
    assert.deepEqual(await response.json(), {
        success: true,
        message: 'Sesión cerrada exitosamente'
    });
});
