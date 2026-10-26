const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const syncFs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PassThrough } = require('node:stream');
const { spawnSync, fork } = require('node:child_process');
const bcrypt = require('bcryptjs');
const { Database } = require('../server/db/database');
const { InstallationStateService } = require('../server/services/installationStateService');
const { AdminRecoveryService } = require('../server/services/adminRecoveryService');
const cli = require('../scripts/recover-admin');

const SCRIPT = path.resolve(__dirname, '../scripts/recover-admin.js');
const OLD = 'Anterior-CLI-secreta';
const NEW = 'Nueva-CLI-secreta';
const UUID = '11111111-1111-4111-8111-111111111111';

async function fixture(t, { admin = true } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-recovery-cli-'));
    const main = path.join(dir, 'restaurant.db');
    const sessions = path.join(dir, 'sessions.db');
    const db = new Database({ dbPath: main });
    const sessionDb = new Database({ dbPath: sessions });
    t.after(async () => {
        await Promise.all([db.close(), sessionDb.close()]);
        assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('mundipos-recovery-cli-'));
        await fs.rm(dir, { recursive: true, force: true });
    });
    await db.connect();
    await db.createTables();
    await db.migrateSchema();
    const installation = new InstallationStateService({ db });
    await installation.prepareInstallationState();
    await installation.completeInstallationPreparation();
    const hash = await bcrypt.hash(OLD, 4);
    let targetId;
    if (admin) targetId = (await db.run(`INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('AdminCLI', ?, 'administrador', 0, ?)`, [hash, new Date().toISOString()])).id;
    const basicId = (await db.run(`INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('BasicoCLI', ?, 'basico', 1, ?)`, [hash, new Date().toISOString()])).id;
    await db.run(`INSERT INTO usuarios (nombre, password, tipo, activo, clase_cuenta, cuenta_departamental_codigo, fecha_creacion)
        VALUES ('CocinaCLI', ?, 'basico', 0, 'departamental', 'cocina', ?)`, [hash, new Date().toISOString()]);
    await sessionDb.connect();
    await sessionDb.run('CREATE TABLE express_sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    await sessionDb.run('INSERT INTO express_sessions VALUES (?, ?, ?)',
        ['SID_CLI_SECRETO', JSON.stringify({ userId: admin ? targetId : basicId, userType: 'administrador', cookie: {} }), Date.now() + 60000]);
    const metadata = await installation.loadInstallationState();
    const service = new AdminRecoveryService({ db, sessionDb });
    return { dir, main, sessions, db, sessionDb, hash, targetId, basicId, metadata, service, installation };
}

function tty() {
    const input = new PassThrough();
    input.isTTY = true;
    input.isRaw = false;
    const raw = [];
    input.setRawMode = value => { raw.push(value); input.isRaw = value; return input; };
    return { input, raw };
}

async function run(c, { answers = [], passwords = [], argv, inputTTY = true, DatabaseClass, ioOverride, env = {} } = {}) {
    const terminal = tty();
    terminal.input.isTTY = inputTTY;
    let text = '';
    let passwordCalls = 0;
    let closed = false;
    const prompts = [];
    const io = ioOverride || {
        async ask(prompt) {
            text += prompt;
            prompts.push(prompt);
            assert.ok(answers.length, `Respuesta ausente para ${prompt}`);
            const answer = answers.shift();
            return typeof answer === 'function' ? answer() : answer;
        },
        async password(prompt) {
            text += prompt;
            passwordCalls++;
            assert.ok(passwords.length, 'Credencial interactiva ausente');
            return passwords.shift();
        },
        close() { closed = true; }
    };
    const code = await cli.main({ argv: argv || ['--db', c.main, '--sessions-db', c.sessions],
        env, cwd: c.dir, projectRoot: c.dir, input: terminal.input,
        output: { isTTY: true, write: chunk => { text += chunk; } }, io, DatabaseClass });
    return { code, text, passwordCalls, prompts, closed };
}

async function pending(c) {
    await c.db.run(`CREATE TRIGGER fail_cli BEFORE INSERT ON historial_transacciones
        WHEN NEW.tipo_accion = 'admin_recovery' BEGIN SELECT RAISE(ABORT, 'forced_cli_test'); END`);
    await assert.rejects(c.service.recover({ action: 'reactivate', targetUserId: c.targetId, password: OLD, reason: 'Motivo persistido CLI' }),
        { code: 'ADMIN_RECOVERY_STORAGE' });
    await c.db.run('DROP TRIGGER fail_cli');
    return c.service.getPendingOperation();
}

async function audits(c) { return c.db.all("SELECT * FROM historial_transacciones WHERE tipo_accion = 'admin_recovery'"); }
async function noOperation(c) {
    assert.equal(await c.db.tableExists('admin_recovery_operations'), false);
    assert.equal((await audits(c)).length, 0);
}

test('importar CLI no abre DB, escribe prompts/archivos ni registra sockets/rutas', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-cli-import-'));
    t.after(async () => {
        assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('mundipos-cli-import-'));
        await fs.rm(dir, { recursive: true, force: true });
    });
    const probe = `const Module=require('module'),fs=require('fs'),net=require('net');
        const load=Module._load;
        Module._load=function(name,...args){if(/server[\\/]app|server[\\/]db|adminRecoveryService/.test(name))throw Error('side effect import');return load.call(this,name,...args)};
        fs.writeFileSync=fs.mkdirSync=net.Server.prototype.listen=()=>{throw Error('side effect')};
        require(${JSON.stringify(SCRIPT)});`;
    const child = spawnSync(process.execPath, ['-e', probe], { cwd: dir, encoding: 'utf8', windowsHide: true,
        env: { ...process.env, DB_PATH: path.join(dir, 'must-not-exist.db'), SESSION_DB_PATH: path.join(dir, 'no-session.db') } });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, '');
    assert.deepEqual(await fs.readdir(dir), []);
});

test('--help funciona sin TTY, sin abrir DB y con salida 0', () => {
    const child = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /Uso: npm run recover-admin/);
    assert.equal(child.stderr, '');
});

test('parser rechaza flags desconocidos, duplicados, valores ausentes, UUID y secretos por argv', () => {
    for (const argv of [['--wat'], ['--db'], ['--db', '--help'], ['--resume', 'invalid'], ['--db', 'a', '--db', 'b'],
        ['--password', OLD], ['--new-password', NEW], ['--password-file', 'x'], ['--secret=abc'], ['--help', '--secret', OLD]]) {
        assert.throws(() => cli.parseArgs(argv), { code: 'ARGUMENTS' });
    }
    assert.deepEqual(cli.parseArgs(['--db', 'a', '--sessions-db', 'b', '--resume', UUID.toUpperCase()]),
        { db: 'a', sessionsDb: 'b', resume: UUID });
});

for (const token of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf',
    'isPrototypeOf', 'propertyIsEnumerable', 'token-desconocido']) {
    test(`parser rechaza el token no registrado ${token} incluso con valor`, () => {
        for (const argv of [[token, 'value'], ['--help', token, 'value'], ['--db', 'main.db', token, 'value']]) {
            assert.throws(() => cli.parseArgs(argv), { code: 'ARGUMENTS' });
        }
        assert.throws(() => cli.parseArgs(['--db', 'main.db', 'valor-suelto']), { code: 'ARGUMENTS' });
    });
}

test('.env se carga desde project-root y nunca sobrescribe variables presentes, incluso vacías', async t => {
    const c = await fixture(t);
    await fs.writeFile(path.join(c.dir, '.env'), '# comentario\nDB_PATH="from-file.db"\nSESSION_DB_PATH=sessions-file.db\nEMPTY=file\n');
    const env = { DB_PATH: c.main, EMPTY: '' };
    cli.loadEnvFile(c.dir, env);
    assert.deepEqual(env, { DB_PATH: c.main, EMPTY: '', SESSION_DB_PATH: 'sessions-file.db' });
});

test('resolución conserva defaults de raíz, MAIN relativo al cwd y SESSION relativo a raíz', () => {
    const root = path.resolve(__dirname, '..');
    const other = path.join(os.tmpdir(), 'different-cwd');
    const defaults = cli.resolvePaths({}, {}, root, other);
    assert.equal(defaults.main.path, path.join(root, 'data/restaurant.db'));
    assert.equal(defaults.sessions.path, path.join(root, 'data/sessions.db'));
    assert.equal(defaults.main.source, 'default');
    const env = cli.resolvePaths({}, { DB_PATH: 'custom/main.db', SESSION_DB_PATH: 'custom/sessions.db' }, root, root);
    assert.equal(env.main.path, path.join(root, 'custom/main.db'));
    assert.equal(env.sessions.path, path.join(root, 'custom/sessions.db'));
    assert.throws(() => cli.resolvePaths({}, { DB_PATH: 'relative.db' }, root, other), { code: 'AMBIGUOUS' });
    const override = cli.resolvePaths({ db: 'explicit.db', sessionsDb: 'explicit-sessions.db' }, { DB_PATH: 'ignored.db' }, root, other);
    assert.equal(override.main.path, path.join(other, 'explicit.db'));
    assert.equal(override.sessions.path, path.join(other, 'explicit-sessions.db'));
    assert.equal(override.main.source, 'argumento --db');
});

test('main carga .env antes de resolver y conserva overrides del entorno operativo', async t => {
    const c = await fixture(t);
    await fs.writeFile(path.join(c.dir, '.env'), 'DB_PATH=equivocada.db\nSESSION_DB_PATH=sessions.db\n');
    const result = await run(c, { argv: [], env: { DB_PATH: c.main },
        answers: ['DETENIDO', '1', String(c.targetId), 'Configuracion local', 'RECUPERAR'], passwords: [OLD] });
    assert.equal(result.code, 0, result.text);
    assert.match(result.text, /MAIN \(DB_PATH\)/);
    assert.match(result.text, /SESSION \(SESSION_DB_PATH\)/);
    assert.equal(syncFs.existsSync(path.join(c.dir, 'equivocada.db')), false);
});

test('rutas inexistentes o directorios se rechazan sin crear archivo ni directorio', async t => {
    const c = await fixture(t);
    const missing = path.join(c.dir, 'missing/subdir/main.db');
    const result = await run(c, { argv: ['--db', missing, '--sessions-db', c.sessions] });
    assert.equal(result.code, 1);
    assert.equal(syncFs.existsSync(path.join(c.dir, 'missing')), false);
    const directory = await run(c, { argv: ['--db', c.dir, '--sessions-db', c.sessions] });
    assert.equal(directory.code, 1);
    assert.equal(directory.prompts.length, 0);
});

test('MAIN y SESSION mismo archivo se rechazan antes de abrir', async t => {
    const c = await fixture(t);
    const result = await run(c, { argv: ['--db', c.main, '--sessions-db', c.main] });
    assert.equal(result.code, 1);
    assert.match(result.text, /mismo archivo/);
    assert.equal(result.prompts.length, 0);
});

test('dos rutas al mismo realpath y hardlinks también se rechazan', async t => {
    const c = await fixture(t);
    const alias = path.join(c.dir, 'linked');
    await fs.symlink(c.dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
        const result = await run(c, { argv: ['--db', c.main, '--sessions-db', path.join(alias, 'restaurant.db')] });
        assert.equal(result.code, 1);
        assert.match(result.text, /mismo archivo/);
    } finally { await fs.unlink(alias); }
    const hard = path.join(c.dir, 'hard-main.db');
    await fs.link(c.main, hard);
    const result = await run(c, { argv: ['--db', c.main, '--sessions-db', hard] });
    assert.equal(result.code, 1);
    assert.match(result.text, /mismo archivo/);
});

test('un alias válido de MAIN opera y persiste la ruta canónica, no el symlink', async t => {
    const c = await fixture(t);
    const alias = path.join(c.dir, 'alias-main');
    await fs.symlink(c.dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    try {
        const result = await run(c, { argv: ['--db', path.join(alias, 'restaurant.db'), '--sessions-db', c.sessions],
            answers: ['DETENIDO', '1', String(c.targetId), 'Alias verificado', 'RECUPERAR'], passwords: [OLD] });
        assert.equal(result.code, 0, result.text);
        assert.equal(result.text.includes(path.join(alias, 'restaurant.db')), false);
        const row = (await c.db.all('SELECT * FROM admin_recovery_operations'))[0];
        assert.equal(row.main_db_path, await fs.realpath(c.main));
        assert.equal(row.sessions_db_path, await fs.realpath(c.sessions));
    } finally { await fs.unlink(alias); }
});

for (const invalid of ['sin tabla', 'columnas incompatibles', 'metadata incompatible']) {
    test(`${invalid}: no repara, no ofrece acciones y cierra ambas DB`, async t => {
        const c = await fixture(t);
        if (invalid === 'metadata incompatible') await c.db.run('UPDATE installation_metadata SET format_version = 2');
        else {
            await c.sessionDb.run('DROP TABLE express_sessions');
            if (invalid === 'columnas incompatibles') await c.sessionDb.run('CREATE TABLE express_sessions (sid TEXT PRIMARY KEY, sess INTEGER, expires_at TEXT)');
        }
        const instances = [];
        class Tracked extends Database {
            constructor(options) { super(options); this.closed = false; instances.push(this); assert.equal(options.mustExist, true); }
            async close() { await super.close(); this.closed = true; }
            initializeDatabase() { assert.fail('No debe inicializar'); }
        }
        const result = await run(c, { DatabaseClass: Tracked });
        assert.equal(result.code, 1);
        assert.equal(result.prompts.length, 0);
        assert.equal(result.closed, true);
        assert.equal(instances.length, 2);
        assert.ok(instances.every(db => db.closed && db.db === null));
        await noOperation(c);
    });
}

test('sin TTY no lee passwords ni abre DB; las credenciales del entorno no son alternativa', async t => {
    const c = await fixture(t);
    let opened = false;
    class Forbidden { constructor() { opened = true; } }
    const result = await run(c, { inputTTY: false, DatabaseClass: Forbidden });
    assert.equal(result.code, 1);
    assert.equal(opened, false);
    assert.equal(result.passwordCalls, 0);
    const child = spawnSync(process.execPath, [SCRIPT, '--db', c.main, '--sessions-db', c.sessions],
        { encoding: 'utf8', windowsHide: true, env: { ...process.env, PASSWORD: OLD, NEW_PASSWORD: NEW } });
    assert.equal(child.status, 1);
    assert.match(child.stdout, /TTY/);
    assert.equal((child.stdout + child.stderr).includes(OLD), false);
});

test('Enter o confirmación distinta de DETENIDO cancela antes de PREPARED', async t => {
    const c = await fixture(t);
    const before = await c.sessionDb.all('SELECT * FROM express_sessions');
    const result = await run(c, { answers: [''] });
    assert.equal(result.code, 130);
    assert.equal(result.passwordCalls, 0);
    assert.match(result.text, /watchdog/);
    assert.match(result.text, /no existe prueba persistente/);
    assert.equal(result.text.includes(c.metadata.installation_id), false);
    assert.deepEqual(await c.sessionDb.all('SELECT * FROM express_sessions'), before);
    await noOperation(c);
});

for (const action of ['reactivate', 'reset_password', 'create_admin']) {
    test(`CLI ${action}: llama a B1, sin secretos, roles ni login automático`, async t => {
        const c = await fixture(t, { admin: action !== 'create_admin' });
        const answers = action === 'create_admin' ? ['DETENIDO', '3', 'NuevoCLI', 'Mantenimiento CLI', 'RECUPERAR']
            : ['DETENIDO', action === 'reactivate' ? '1' : '2', String(c.targetId), 'Mantenimiento CLI', 'RECUPERAR'];
        const result = await run(c, { answers, passwords: action === 'reactivate' ? [OLD] : [NEW, NEW] });
        assert.equal(result.code, 0, result.text);
        assert.equal(result.closed, true);
        const rows = await c.db.all('SELECT * FROM admin_recovery_operations');
        assert.equal(rows.length, 1);
        assert.equal(rows[0].state, 'COMPLETED');
        assert.equal(rows[0].action, action);
        const user = await c.db.get('SELECT * FROM usuarios WHERE id = ?', [rows[0].target_user_id]);
        assert.equal(user.activo, 1);
        assert.equal(await bcrypt.compare(action === 'reactivate' ? OLD : NEW, user.password), true);
        assert.equal((await audits(c)).length, 1);
        assert.deepEqual(await c.db.all('SELECT * FROM sesiones_usuario'), []);
        assert.deepEqual(await c.db.all('SELECT * FROM usuario_roles_trabajo'), []);
        assert.deepEqual(await c.sessionDb.all('SELECT * FROM express_sessions'), []);
        assert.deepEqual(await c.installation.loadInstallationState(), c.metadata);
        assert.match(result.text, /Inicie MundiPOS normalmente/);
        for (const secret of [OLD, NEW, c.hash, user.password, 'SID_CLI_SECRETO', 'SESSION_SECRET']) assert.equal(result.text.includes(secret), false);
        assert.equal(result.text.includes('ID ' + c.basicId + ': BasicoCLI'), false);
        assert.equal(result.text.includes(': CocinaCLI'), false);
    });
}

for (const variant of ['mismatch', 'corta', 'motivo con password', 'confirmación final', 'password incorrecta', 'ID básico']) {
    test(`${variant}: no inicia recuperación ni revela credenciales`, async t => {
        const c = await fixture(t);
        const reset = variant !== 'password incorrecta';
        const answers = ['DETENIDO', reset ? '2' : '1', String(variant === 'ID básico' ? c.basicId : c.targetId),
            variant === 'motivo con password' ? NEW : 'Motivo', variant === 'confirmación final' ? '' : 'RECUPERAR'];
        const passwords = !reset ? ['Incorrecta-CLI-secreta'] : variant === 'mismatch' ? [NEW, 'Diferente-CLI'] : variant === 'corta' ? ['12345', '12345'] : [NEW, NEW];
        const result = await run(c, { answers, passwords });
        assert.equal(result.code, variant === 'confirmación final' ? 130 : 1);
        for (const secret of [OLD, NEW, c.hash, 'Incorrecta-CLI-secreta']) assert.equal(result.text.includes(secret), false);
        assert.equal((await c.db.get('SELECT activo FROM usuarios WHERE id = ?', [c.targetId])).activo, 0);
        await noOperation(c);
    });
}

test('un Admin activo impide ofrecer nuevas acciones', async t => {
    const c = await fixture(t);
    await c.db.run('UPDATE usuarios SET activo = 1 WHERE id = ?', [c.targetId]);
    const result = await run(c, { answers: ['DETENIDO'] });
    assert.equal(result.code, 1);
    assert.match(result.text, /Admin activo/);
    assert.equal(result.passwordCalls, 0);
    await noOperation(c);
});

test('no ofrece crear con candidato recuperable y la creación exige mínimo ocho caracteres', async t => {
    const c = await fixture(t);
    const denied = await run(c, { answers: ['DETENIDO', '3'] });
    assert.equal(denied.code, 1);
    assert.equal(denied.passwordCalls, 0);
    assert.equal(denied.text.includes('3. Crear'), false);
    await noOperation(c);
    const empty = await fixture(t, { admin: false });
    const short = await run(empty, { answers: ['DETENIDO', '3', 'NuevoCLI'], passwords: ['1234567', '1234567'] });
    assert.equal(short.code, 1);
    await noOperation(empty);
});

for (const explicit of [false, true]) {
    test(`PREPARED ${explicit ? 'con --resume' : 'detectada'} conserva operationId y una auditoría`, async t => {
        const c = await fixture(t);
        const row = await pending(c);
        const result = await run(c, { argv: ['--db', c.main, '--sessions-db', c.sessions, ...(explicit ? ['--resume', row.operation_id] : [])],
            answers: explicit ? ['DETENIDO', 'RECUPERAR'] : ['DETENIDO', 'REANUDAR', 'RECUPERAR'], passwords: [OLD] });
        assert.equal(result.code, 0, result.text);
        assert.match(result.text, /PREPARED/);
        assert.equal(result.text.includes(row.operation_id), true);
        assert.equal((await c.db.all('SELECT * FROM admin_recovery_operations')).length, 1);
        assert.equal((await c.service.getOperation(row.operation_id)).state, 'COMPLETED');
        assert.equal((await audits(c)).length, 1);
    });
}

test('declinar PREPARED o --resume incorrecto no crea otra operación ni CANCELLED', async t => {
    const c = await fixture(t);
    const row = await pending(c);
    const declined = await run(c, { answers: ['DETENIDO', 'NO'] });
    assert.equal(declined.code, 130);
    const wrong = await run(c, { argv: ['--db', c.main, '--sessions-db', c.sessions, '--resume', UUID], answers: ['DETENIDO'] });
    assert.equal(wrong.code, 1);
    assert.deepEqual(await c.service.getPendingOperation(), row);
    assert.equal((await c.db.all('SELECT * FROM admin_recovery_operations')).length, 1);
    assert.equal((await audits(c)).length, 0);
});

test('--resume COMPLETED sale 0 incluso con Admin activo y no pide password ni duplica efectos', async t => {
    const c = await fixture(t);
    const row = await c.service.recover({ action: 'reactivate', targetUserId: c.targetId, password: OLD, reason: 'Finalizada' });
    const before = await c.db.all('SELECT * FROM usuarios');
    const result = await run(c, { argv: ['--db', c.main, '--sessions-db', c.sessions, '--resume', row.operation_id], answers: ['DETENIDO'] });
    assert.equal(result.code, 0);
    assert.equal(result.passwordCalls, 0);
    assert.match(result.text, /ya finalizó/);
    assert.deepEqual(await c.db.all('SELECT * FROM usuarios'), before);
    assert.equal((await audits(c)).length, 1);
    assert.equal((await c.db.all('SELECT * FROM admin_recovery_operations')).length, 1);
});

test('--resume de una COMPLETED no elude otra PREPARED diferente', async t => {
    const c = await fixture(t);
    const completed = await c.service.recover({ action: 'reactivate', targetUserId: c.targetId, password: OLD, reason: 'Anterior' });
    await c.db.run('UPDATE usuarios SET activo = 0 WHERE id = ?', [c.targetId]);
    const prepared = await pending(c);
    const result = await run(c, { argv: ['--db', c.main, '--sessions-db', c.sessions, '--resume', completed.operation_id], answers: ['DETENIDO'] });
    assert.equal(result.code, 1);
    assert.match(result.text, /otra PREPARED/);
    assert.equal(result.passwordCalls, 0);
    assert.deepEqual(await c.service.getPendingOperation(), prepared);
    assert.equal((await c.db.all('SELECT * FROM admin_recovery_operations')).length, 2);
    assert.equal((await audits(c)).length, 1);
});

test('fallo B1 se informa sin stack y finally cierra ambas DB y la interacción', async t => {
    const c = await fixture(t);
    await c.db.run(`CREATE TRIGGER fail_cli BEFORE INSERT ON historial_transacciones
        WHEN NEW.tipo_accion = 'admin_recovery' BEGIN SELECT RAISE(ABORT, '${OLD}'); END`);
    const instances = [];
    class Tracked extends Database {
        constructor(options) { super(options); instances.push(this); }
        async close() { await super.close(); this.wasClosed = true; }
    }
    const result = await run(c, { DatabaseClass: Tracked,
        answers: ['DETENIDO', '1', String(c.targetId), 'Motivo', 'RECUPERAR'], passwords: [OLD] });
    assert.equal(result.code, 1);
    assert.equal(result.closed, true);
    assert.ok(instances.every(db => db.wasClosed && db.db === null));
    assert.equal(result.text.includes(OLD), false);
    assert.equal(result.text.includes(' at '), false);
    assert.equal((await c.service.getPendingOperation()).state, 'PREPARED');
    assert.equal((await audits(c)).length, 0);
});

for (const ending of ['enter', 'ctrl-c', 'end', 'error', 'signal', 'output-error']) {
    test(`password sin echo restaura raw y listeners ante ${ending}`, async () => {
        const terminal = tty();
        const controller = new AbortController();
        let text = '';
        const output = { write(chunk) { if (ending === 'output-error' && chunk === '\n') throw new Error(OLD); text += chunk; } };
        const io = cli.createTerminalIO(terminal.input, output, controller.signal);
        const result = io.password('Password: ');
        terminal.input.emit('keypress', 'a', { name: 'a' });
        terminal.input.emit('keypress', 'x', { name: 'x' });
        terminal.input.emit('keypress', undefined, { name: 'backspace' });
        terminal.input.emit('keypress', 'b', { name: 'b' });
        terminal.input.emit('keypress', undefined, { name: 'delete' });
        terminal.input.emit('keypress', 'c', { name: 'c' });
        if (ending === 'ctrl-c') terminal.input.emit('keypress', undefined, { name: 'c', ctrl: true });
        else if (ending === 'signal') controller.abort();
        else if (ending === 'end') terminal.input.emit('end');
        else if (ending === 'error') terminal.input.emit('error', new Error(OLD));
        else terminal.input.emit('keypress', undefined, { name: 'return' });
        if (ending === 'enter') assert.equal(await result, 'ac');
        else await assert.rejects(result);
        assert.equal(terminal.input.isRaw, false);
        assert.deepEqual(terminal.raw, [true, false]);
        assert.equal(terminal.input.listenerCount('keypress'), 0);
        assert.equal(terminal.input.listenerCount('error'), 0);
        assert.ok(['Password: \n', 'Password: '].includes(text));
        io.close();
    });
}

test('el helper restaura el modo raw previo en lugar de asumir que estaba deshabilitado', async () => {
    const terminal = tty();
    terminal.input.isRaw = true;
    const io = cli.createTerminalIO(terminal.input, { write() {} }, new AbortController().signal);
    const password = io.password('Secret: ');
    terminal.input.emit('keypress', undefined, { name: 'return' });
    await password;
    assert.equal(terminal.input.isRaw, true);
    io.close();
    assert.equal(terminal.input.isRaw, true);
});

test('AbortSignal posterior a Enter invalida la aceptación pendiente y restaura raw', async () => {
    const terminal = tty();
    const controller = new AbortController();
    let text = '';
    const io = cli.createTerminalIO(terminal.input, { write: chunk => { text += chunk; } }, controller.signal);
    try {
        const password = io.password('Password: ');
        terminal.input.write(OLD + '\r');
        controller.abort();
        await assert.rejects(password, { code: 'CANCELLED' });
        assert.equal(terminal.input.isRaw, false);
        assert.equal(terminal.input.listenerCount('keypress'), 0);
        assert.equal(terminal.input.listenerCount('error'), 0);
        assert.equal(text.includes(OLD), false);
    } finally { io.close(); }
});

for (const phase of ['DETENIDO', 'RECUPERAR', 'password']) {
    test(`workflow ${phase} con Enter y Ctrl+C en el mismo chunk nunca llama recovery`, async t => {
        const c = await fixture(t);
        const beforeAdmin = await c.db.get('SELECT * FROM usuarios WHERE id = ?', [c.targetId]);
        const beforeSessions = await c.sessionDb.all('SELECT * FROM express_sessions');
        const recover = t.mock.method(AdminRecoveryService.prototype, 'recover', AdminRecoveryService.prototype.recover);
        const terminal = tty();
        const instances = [];
        let text = '';
        let passwords = 0;
        let confirmations = 0;
        class Tracked extends Database {
            constructor(options) { super(options); instances.push(this); }
            async close() { await super.close(); this.wasClosed = true; }
        }
        const code = await cli.main({ argv: ['--db', c.main, '--sessions-db', c.sessions], env: {}, projectRoot: c.dir,
            input: terminal.input, DatabaseClass: Tracked, output: { isTTY: true, write(chunk) {
                text += chunk;
                const send = value => setImmediate(() => terminal.input.write(value));
                if (chunk.includes('Confirme esas condiciones')) send(phase === 'DETENIDO' ? 'DETENIDO\r\x03' : 'DETENIDO\r');
                if (chunk.includes('Acción (1/2)')) send('1\r');
                if (chunk.includes('ID explícito')) send(String(c.targetId) + '\r');
                if (chunk.includes('Contraseña conocida')) {
                    passwords++;
                    send(OLD + (phase === 'password' ? '\r\x03' : '\r'));
                }
                if (chunk.includes('Motivo obligatorio')) send('Prueba cancelacion agrupada\r');
                if (chunk.includes('Confirme la invalidación')) {
                    confirmations++;
                    if (phase === 'RECUPERAR') setImmediate(() => terminal.input.write('RECUPERAR\r\x03'));
                    else send('RECUPERAR\r');
                }
            } } });
        assert.equal(code, 130, text);
        assert.equal(recover.mock.callCount(), 0);
        assert.equal(terminal.input.isRaw, false);
        assert.equal(terminal.input.listenerCount('keypress'), 0);
        assert.equal(terminal.input.listenerCount('error'), 0);
        assert.equal(instances.length, 2);
        assert.ok(instances.every(db => db.wasClosed && db.db === null));
        assert.equal(passwords, phase === 'DETENIDO' ? 0 : 1);
        assert.equal(confirmations, phase === 'RECUPERAR' ? 1 : 0);
        assert.deepEqual(await c.db.get('SELECT * FROM usuarios WHERE id = ?', [c.targetId]), beforeAdmin);
        assert.deepEqual(await c.sessionDb.all('SELECT * FROM express_sessions'), beforeSessions);
        await noOperation(c);
        for (const secret of [OLD, c.hash, 'SID_CLI_SECRETO']) assert.equal(text.includes(secret), false);
    });
}

for (const phase of ['menú', 'password', 'confirmación', 'confirmación PREPARED', 'fallo B1']) {
test(`flujo nativo ${phase}: restaura TTY y cierra ambas DB ante SIGINT/error`, async t => {
    const c = await fixture(t);
    const prepared = phase === 'confirmación PREPARED' ? await pending(c) : null;
    if (phase === 'fallo B1') await c.db.run(`CREATE TRIGGER fail_cli BEFORE INSERT ON historial_transacciones
        WHEN NEW.tipo_accion = 'admin_recovery' BEGIN SELECT RAISE(ABORT, '${OLD}'); END`);
    const terminal = tty();
    let text = '';
    const instances = [];
    class Tracked extends Database {
        constructor(options) { super(options); instances.push(this); }
        async close() { await super.close(); this.wasClosed = true; }
    }
    const code = await cli.main({ argv: ['--db', c.main, '--sessions-db', c.sessions, ...(prepared ? ['--resume', prepared.operation_id] : [])], env: {}, projectRoot: c.dir,
        input: terminal.input, DatabaseClass: Tracked, output: { isTTY: true, write(chunk) {
            text += chunk;
            const send = value => setImmediate(() => terminal.input.write(value + '\r'));
            const interrupt = () => setImmediate(() => process.emit('SIGINT'));
            if (chunk.includes('Confirme esas condiciones')) send('DETENIDO');
            if (chunk.includes('Acción (1/2)')) { if (phase === 'menú') interrupt(); else send('1'); }
            if (chunk.includes('ID explícito')) send(String(c.targetId));
            if (chunk.includes('Contraseña conocida')) { if (phase === 'password') interrupt(); else send(OLD); }
            if (chunk.includes('Motivo obligatorio')) send('Prueba TTY nativa');
            if (chunk.includes('Confirme la invalidación')) { if (phase === 'fallo B1') send('RECUPERAR'); else interrupt(); }
        } } });
    assert.equal(code, phase === 'fallo B1' ? 1 : 130);
    assert.equal(terminal.input.isRaw, false);
    assert.ok(instances.every(db => db.wasClosed && db.db === null));
    assert.equal(text.includes(OLD), false);
    if (prepared) assert.deepEqual(await c.service.getPendingOperation(), prepared);
    else if (phase === 'fallo B1') assert.equal((await c.service.getPendingOperation()).state, 'PREPARED');
    else await noOperation(c);
});
}

test('una conexión fallida o un cierre fallido no impiden cerrar la otra DB ni filtran errores', async t => {
    const c = await fixture(t);
    for (const failure of ['connect', 'close']) {
        const instances = [];
        class Tracked extends Database {
            constructor(options) { super(options); instances.push(this); }
            async connect() { if (failure === 'connect' && this.dbPath === c.sessions) throw new Error(OLD); return super.connect(); }
            async close() { await super.close(); this.wasClosed = true; if (failure === 'close' && this.dbPath === c.main) throw new Error(OLD); }
        }
        const result = await run(c, { DatabaseClass: Tracked, answers: failure === 'close' ? [''] : [] });
        assert.equal(result.code, 1);
        assert.equal(result.text.includes(OLD), false);
        assert.ok(instances.every(db => db.wasClosed && db.db === null));
        assert.equal(result.closed, true);
        await noOperation(c);
    }
});

test('el comando npm es explícito, sin hooks de arranque ni endpoints productivos', () => {
    const pkg = require('../package.json');
    assert.equal(pkg.scripts['recover-admin'], 'node scripts/recover-admin.js');
    for (const hook of ['start', 'prestart', 'postinstall', 'prepare']) assert.equal(String(pkg.scripts[hook]).includes('recover-admin'), false);
    const source = syncFs.readFileSync(SCRIPT, 'utf8');
    assert.equal(/require\(['"][^'"]*app\.js|initializeDatabase\s*\(|\.listen\s*\(|express\s*\(/.test(source), false);
});

function worker(config) {
    return new Promise((resolve, reject) => {
        const child = fork(path.join(__dirname, 'helpers/adminRecoveryCrashWorker.js'), [], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        const messages = [];
        const timeout = setTimeout(() => { child.kill(); reject(new Error('Worker timeout')); }, 20000);
        child.on('error', error => { clearTimeout(timeout); reject(error); });
        child.on('message', message => messages.push(message));
        child.on('exit', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, messages }); });
        child.send(config);
    });
}

test('crash real tras COMMIT SESSION conserva PREPARED y un segundo proceso reanuda sin duplicar', async t => {
    const c = await fixture(t);
    const historyId = crypto.randomUUID();
    await c.sessionDb.run('INSERT INTO express_sessions VALUES (?, ?, ?)',
        ['SID_CRASH_RESIDUAL', JSON.stringify({ userId: c.basicId, userType: 'administrador' }), Date.now() + 60000]);
    const now = new Date().toISOString();
    await c.db.run(`INSERT INTO sesiones_usuario (session_uuid, usuario_id, express_session_id, estado, iniciada_en, actualizado_en)
        VALUES (?, ?, 'SID_CRASH_RESIDUAL', 'activa', ?, ?)`, [historyId, c.basicId, now, now]);
    await c.db.close();
    await c.sessionDb.close();
    const crashed = await worker({ main: c.main, sessions: c.sessions, targetId: c.targetId, password: NEW, crash: true });
    assert.equal(crashed.code, 86);
    const db = new Database({ dbPath: c.main, mustExist: true });
    const sessionDb = new Database({ dbPath: c.sessions, mustExist: true });
    try {
        await db.connect();
        await sessionDb.connect();
        assert.equal((await db.get('PRAGMA quick_check')).quick_check, 'ok');
        assert.equal((await sessionDb.get('PRAGMA quick_check')).quick_check, 'ok');
        const operations = await db.all('SELECT * FROM admin_recovery_operations');
        assert.equal(operations.length, 1);
        const operation = operations[0];
        assert.equal(operation.state, 'PREPARED');
        assert.equal(operation.audit_id, null);
        assert.ok(JSON.parse(operation.affected_session_uuids).includes(historyId));
        assert.equal((await db.get('SELECT estado FROM sesiones_usuario WHERE session_uuid = ?', [historyId])).estado, 'activa');
        assert.deepEqual(await db.get('SELECT activo, password FROM usuarios WHERE id = ?', [c.targetId]), { activo: 0, password: c.hash });
        assert.equal((await db.all("SELECT * FROM historial_transacciones WHERE tipo_accion = 'admin_recovery'")).length, 0);
        assert.deepEqual(await new InstallationStateService({ db }).loadInstallationState(), c.metadata);
        assert.deepEqual(await sessionDb.all('SELECT * FROM express_sessions'), []);
        const resumed = await worker({ main: c.main, sessions: c.sessions, operationId: operation.operation_id, password: NEW, crash: false });
        assert.equal(resumed.code, 0);
        assert.deepEqual(resumed.messages, [{ operationId: operation.operation_id, state: 'COMPLETED' }]);
        const completed = await db.all('SELECT * FROM admin_recovery_operations');
        assert.equal(completed.length, 1);
        assert.equal(completed[0].operation_id, operation.operation_id);
        assert.equal(completed[0].state, 'COMPLETED');
        assert.equal((await db.all("SELECT * FROM historial_transacciones WHERE tipo_accion = 'admin_recovery'")).length, 1);
        assert.equal((await db.get('SELECT activo FROM usuarios WHERE id = ?', [c.targetId])).activo, 1);
        assert.deepEqual(await db.get('SELECT estado, motivo_finalizacion FROM sesiones_usuario WHERE session_uuid = ?', [historyId]),
            { estado: 'revocada', motivo_finalizacion: 'recuperacion_administrativa_local' });
        assert.equal(await bcrypt.compare(NEW, (await db.get('SELECT password FROM usuarios WHERE id = ?', [c.targetId])).password), true);
        assert.deepEqual(await new InstallationStateService({ db }).loadInstallationState(), c.metadata);
    } finally { await Promise.all([db.close(), sessionDb.close()]); }
});
