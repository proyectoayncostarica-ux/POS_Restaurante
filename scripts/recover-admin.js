const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HELP = `Uso: npm run recover-admin -- [--db <ruta>] [--sessions-db <ruta>] [--resume <operationId>]
       npm run recover-admin -- --help

Herramienta local; requiere stdin/stdout TTY, backend detenido y watchdog deshabilitado.
No acepta contraseñas por argumentos, archivos, entorno ni pipes.
MAIN: --db relativo al cwd; DB_PATH relativo al cwd solo desde la raíz del proyecto;
      default <raíz>/data/restaurant.db.
SESSION: --sessions-db relativo al cwd; SESSION_DB_PATH relativo a la raíz;
         default <raíz>/data/sessions.db.
Se carga <raíz>/.env sin sobrescribir variables ya presentes.
`;
const MESSAGES = {
    ARGUMENTS: 'Argumentos inválidos. Use --help; no se aceptan argumentos de secretos.',
    TTY: 'Recovery requiere stdin y stdout TTY locales. No se aceptan contraseñas por pipe.',
    ENV: 'No se pudo leer la configuración local.',
    AMBIGUOUS: 'DB_PATH relativo fuera de la raíz es ambiguo. Use --db con ruta absoluta.',
    PATH: 'Ambas rutas deben identificar archivos existentes y accesibles.',
    SAME_FILE: 'MAIN y SESSION no pueden ser el mismo archivo.',
    MAIN: 'La DB principal no tiene integridad o metadata IDENTIFIED compatible. No se reparó.',
    SESSION: 'La DB técnica no tiene integridad o express_sessions compatible. No se creó ninguna tabla.',
    ACTIVE_ADMIN: 'Existe un Admin activo; no se permite iniciar ni reanudar recovery.',
    CANDIDATE: 'Seleccione por ID uno de los Admin humanos desactivados listados.',
    INPUT: 'Selección, nombre o motivo inválido. El motivo es obligatorio y admite hasta 500 caracteres.',
    PASSWORD: 'Las contraseñas no coinciden o no cumplen la longitud mínima.',
    NOT_FOUND: 'No existe esa operación de recuperación.',
    PENDING: 'Existe otra PREPARED. Reanude la operación pendiente con su operationId.',
    CANCELLED: 'Operación interrumpida. No se cancela ni elimina ninguna PREPARED existente.',
    STORAGE: 'No se pudo completar recovery. Consulte y reanude cualquier PREPARED con su mismo operationId.',
    CLOSE: 'No se pudieron cerrar todos los recursos de mantenimiento.'
};
const SERVICE_MESSAGES = {
    INPUT: MESSAGES.INPUT, DEPENDENCY_CONTRACT: MESSAGES.STORAGE,
    METADATA: MESSAGES.MAIN, INCONSISTENT: MESSAGES.MAIN,
    ACTIVE_ADMIN: MESSAGES.ACTIVE_ADMIN, CANDIDATE: MESSAGES.CANDIDATE,
    RECOVERABLE_ADMIN: 'Existe un Admin humano recuperable: seleccione reactivación o reset.',
    NAME_EXISTS: 'El nombre solicitado ya está ocupado.',
    PASSWORD: 'La contraseña conocida no es válida. No se completó recovery.',
    CHANGED: 'El estado del candidato cambió. Revise antes de reintentar.',
    PENDING: MESSAGES.PENDING, MISMATCH: 'La operación no corresponde a estas bases o parámetros.',
    SESSIONS: MESSAGES.SESSION,
    SCOPE_CHANGED: 'El alcance cambió. Reanude el mismo operationId para registrarlo antes de invalidar.',
    TRANSACTION_CONTEXT: 'Recovery debe ejecutarse fuera de transacciones externas.',
    STORAGE: MESSAGES.STORAGE
};
class CliError extends Error {
    constructor(code) { super(MESSAGES[code]); this.code = code; }
}
const fail = code => { throw new CliError(code); };
const display = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '?');

function parseArgs(argv) {
    const result = {};
    const names = { '--db': 'db', '--sessions-db': 'sessionsDb', '--resume': 'resume', '--help': 'help' };
    for (let index = 0; index < argv.length; index++) {
        if (!Object.hasOwn(names, argv[index])) fail('ARGUMENTS');
        const name = names[argv[index]];
        if (Object.hasOwn(result, name)) fail('ARGUMENTS');
        if (name === 'help') result.help = true;
        else {
            const value = argv[++index];
            if (!value || value.startsWith('--')) fail('ARGUMENTS');
            result[name] = value;
        }
    }
    if (result.resume && !UUID.test(result.resume)) fail('ARGUMENTS');
    if (result.resume) result.resume = result.resume.toLowerCase();
    return result;
}

function loadEnvFile(projectRoot, env) {
    let contents;
    try { contents = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return; fail('ENV'); }
    for (const line of contents.split(/\r?\n/)) {
        const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match || Object.hasOwn(env, match[1])) continue;
        env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
}

function resolvePaths(options, env, projectRoot = PROJECT_ROOT, cwd = process.cwd()) {
    const root = path.resolve(projectRoot);
    if (!options.db && env.DB_PATH && !path.isAbsolute(env.DB_PATH) && path.resolve(cwd) !== root) fail('AMBIGUOUS');
    return {
        main: { path: options.db ? path.resolve(cwd, options.db)
            : env.DB_PATH ? path.resolve(cwd, env.DB_PATH) : path.join(root, 'data/restaurant.db'),
        source: options.db ? 'argumento --db' : env.DB_PATH ? 'DB_PATH' : 'default' },
        sessions: { path: options.sessionsDb ? path.resolve(cwd, options.sessionsDb)
            : env.SESSION_DB_PATH ? path.resolve(root, env.SESSION_DB_PATH) : path.join(root, 'data/sessions.db'),
        source: options.sessionsDb ? 'argumento --sessions-db' : env.SESSION_DB_PATH ? 'SESSION_DB_PATH' : 'default' }
    };
}

async function canonicalizePaths(paths) {
    const file = async item => {
        try {
            const real = await fsp.realpath(item.path);
            const stat = await fsp.stat(real, { bigint: true });
            if (!stat.isFile()) fail('PATH');
            return { ...item, path: real, stat };
        } catch { fail('PATH'); }
    };
    const main = await file(paths.main);
    const sessions = await file(paths.sessions);
    const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (comparable(main.path) === comparable(sessions.path)
        || (main.stat.ino !== 0n && main.stat.dev === sessions.stat.dev && main.stat.ino === sessions.stat.ino)) fail('SAME_FILE');
    return { main, sessions };
}

function createTerminalIO(input, output, signal) {
    const initialRaw = Boolean(input.isRaw);
    let active;
    readline.emitKeypressEvents(input);
    const read = async (prompt, secret) => {
        if (signal?.aborted) fail('CANCELLED');
        const wasRaw = Boolean(input.isRaw);
        const wasFlowing = input.readableFlowing;
        let value = '';
        let handlers;
        let acceptTurn;
        try {
            output.write(prompt);
            input.setRawMode(true);
            return await new Promise((resolve, reject) => {
                let finished = false;
                const settle = (error) => {
                    if (finished) return;
                    finished = true;
                    if (acceptTurn) clearImmediate(acceptTurn);
                    try { output.write('\n'); } catch { error = new CliError('STORAGE'); }
                    if (error) reject(error); else resolve(value);
                };
                const finish = (error) => {
                    if (error) return settle(error);
                    // Enter queda provisional hasta el siguiente turno: Ctrl+C del mismo chunk gana.
                    if (!finished && !acceptTurn) acceptTurn = setImmediate(() => settle());
                };
                const cancel = () => finish(new CliError('CANCELLED'));
                const keypress = (str, key = {}) => {
                    if (key.ctrl && key.name === 'c') return cancel();
                    if (finished || acceptTurn) return;
                    if (key.name === 'return' || key.name === 'enter') return finish();
                    if (key.name === 'backspace' || key.name === 'delete') {
                        if (value) {
                            value = Array.from(value).slice(0, -1).join('');
                            if (!secret) output.write('\b \b');
                        }
                    } else if (!key.ctrl && !key.meta && str && !/[\u0000-\u001f\u007f-\u009f]/.test(str)) {
                        if (value.length + str.length > 4096) return finish(new CliError('INPUT'));
                        value += str;
                        if (!secret) output.write(str);
                    }
                };
                const onKey = (str, key) => {
                    try { keypress(str, key); } catch { finish(new CliError('STORAGE')); }
                };
                handlers = { keypress: onKey, cancel };
                active = cancel;
                input.on('keypress', onKey);
                input.once('end', cancel);
                input.once('error', cancel);
                signal?.addEventListener('abort', cancel, { once: true });
                if (signal?.aborted) cancel(); else input.resume();
            });
        } finally {
            if (acceptTurn) clearImmediate(acceptTurn);
            if (handlers) {
                input.removeListener('keypress', handlers.keypress);
                input.removeListener('end', handlers.cancel);
                input.removeListener('error', handlers.cancel);
                signal?.removeEventListener('abort', handlers.cancel);
            }
            active = null;
            value = '';
            input.setRawMode(wasRaw);
            if (!wasFlowing) input.pause();
        }
    };
    return {
        ask: prompt => read(prompt, false),
        password: prompt => read(prompt, true),
        close() { active?.(); input.setRawMode(initialRaw); }
    };
}

async function validateDatabases(db, sessionDb) {
    const { InstallationStateService } = require('../server/services/installationStateService');
    let state;
    try {
        state = await db.withTransaction(async tx => {
            const check = await tx.all('PRAGMA quick_check');
            if (check.length !== 1 || Object.values(check[0])[0] !== 'ok') fail('MAIN');
            const metadata = await new InstallationStateService({ db }).loadInstallationState(tx);
            if (!metadata || metadata.state !== 'IDENTIFIED') fail('MAIN');
            const admins = await tx.all("SELECT id, nombre, clase_cuenta, cuenta_departamental_codigo, activo FROM usuarios WHERE tipo = 'administrador'");
            return { metadata, admins };
        }, { mode: 'DEFERRED' });
    } catch { fail('MAIN'); }
    try {
        await sessionDb.withTransaction(async tx => {
            const check = await tx.all('PRAGMA quick_check');
            const table = await tx.get("SELECT type FROM sqlite_master WHERE name = 'express_sessions'");
            const columns = await tx.all('PRAGMA table_info(express_sessions)');
            const column = name => columns.find(item => item.name === name);
            if (check.length !== 1 || Object.values(check[0])[0] !== 'ok' || table?.type !== 'table'
                || column('sid')?.type.toUpperCase() !== 'TEXT' || column('sid').pk !== 1
                || column('sess')?.type.toUpperCase() !== 'TEXT' || column('sess').notnull !== 1
                || column('expires_at')?.type.toUpperCase() !== 'INTEGER' || column('expires_at').notnull !== 1) fail('SESSION');
        }, { mode: 'DEFERRED' });
    } catch { fail('SESSION'); }
    return state;
}

async function recoverInteractively({ service, state, options, paths, io, write, signal }) {
    const installation = `${state.metadata.installation_id.slice(0, 8)}…${state.metadata.installation_id.slice(-4)}`;
    const targets = () => {
        write(`Instalación: ${installation}`);
        write(`MAIN (${paths.main.source}): ${paths.main.path}`);
        write(`SESSION (${paths.sessions.source}): ${paths.sessions.path}`);
    };
    targets();
    write('Las rutas y contenidos se verifican, pero no existe prueba persistente/criptográfica de que ambas DB pertenezcan a la misma instalación.');
    write('El backend debe estar DETENIDO y su reinicio automático/watchdog DESHABILITADO. La CLI no puede demostrarlo perfectamente.');
    if (await io.ask('Confirme esas condiciones y las DB objetivo escribiendo DETENIDO: ') !== 'DETENIDO') fail('CANCELLED');
    const pending = await service.getPendingOperation();
    let operation;
    if (options.resume) {
        operation = await service.getOperation(options.resume);
        if (!operation) fail('NOT_FOUND');
        if (pending && pending.operation_id !== operation.operation_id) fail('PENDING');
        if (operation.state === 'COMPLETED') {
            write(`La operación ${operation.operation_id} ya finalizó (COMPLETED). No se volvió a ejecutar.`);
            return;
        }
    }
    if (state.admins.some(admin => admin.activo === 1)) fail('ACTIVE_ADMIN');
    if (state.admins.some(admin => admin.activo !== 0 || admin.clase_cuenta !== 'humana' || admin.cuenta_departamental_codigo !== null)) fail('MAIN');
    if (pending) {
        operation = pending;
        write(`PREPARED: ${pending.operation_id}; acción: ${pending.action}; cuenta: ${pending.target_user_name} (ID ${pending.target_user_id ?? 'nuevo'}); fecha: ${pending.created_at}; motivo: ${pending.reason}`);
        if (!options.resume && await io.ask('Debe reanudar esta operación. Escriba REANUDAR o salga sin modificarla: ') !== 'REANUDAR') fail('CANCELLED');
    }
    let request;
    if (operation) request = { operationId: operation.operation_id, action: operation.action };
    else if (state.admins.length) {
        write('1. Reactivar Admin con contraseña conocida.');
        write('2. Resetear contraseña y reactivar.');
        const choice = await io.ask('Acción (1/2): ');
        if (!['1', '2'].includes(choice)) fail('INPUT');
        for (const admin of state.admins) write(`ID ${admin.id}: ${admin.nombre}`);
        const selected = await io.ask('ID explícito del Admin: ');
        const candidate = state.admins.find(admin => /^[1-9]\d*$/.test(selected) && admin.id === Number(selected));
        if (!candidate) fail('CANDIDATE');
        request = { action: choice === '1' ? 'reactivate' : 'reset_password', targetUserId: candidate.id };
        operation = { target_user_name: candidate.nombre, target_user_id: candidate.id };
    } else {
        write('3. Crear Admin humano de recuperación (no existe Admin humano recuperable).');
        if (await io.ask('Acción (3): ') !== '3') fail('INPUT');
        const name = (await io.ask('Nombre del nuevo Admin: ')).trim();
        if (!/^[a-zA-Z0-9._-]{3,40}$/.test(name)) fail('INPUT');
        request = { action: 'create_admin', targetUserName: name };
        operation = { target_user_name: name, target_user_id: null };
    }
    try {
        if (request.action === 'reactivate') request.password = await io.password('Contraseña conocida (sin echo): ');
        else {
            request.newPassword = await io.password('Nueva contraseña (sin echo): ');
            const repeated = await io.password('Repita la contraseña (sin echo): ');
            if (request.newPassword !== repeated || request.newPassword.length < (request.action === 'create_admin' ? 8 : 6)) fail('PASSWORD');
        }
        const reason = request.operationId ? operation.reason : (await io.ask('Motivo obligatorio (se audita; no escriba contraseñas): ')).trim();
        const secret = request.password ?? request.newPassword;
        if (!reason || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason) || (secret && reason.includes(secret))) fail('INPUT');
        if (!request.operationId) request.reason = reason;
        targets();
        write(`Acción: ${request.action}; cuenta: ${operation.target_user_name} (ID ${operation.target_user_id ?? 'nuevo'}); motivo: ${reason}`);
        if (request.operationId) write(`Reanudación: ${request.operationId}`);
        if (await io.ask('Confirme la invalidación administrativa escribiendo RECUPERAR: ') !== 'RECUPERAR') fail('CANCELLED');
        if (signal.aborted) fail('CANCELLED');
        const result = await service.recover(request);
        write(`COMPLETED: ${result.operation_id}; acción: ${result.action}; Admin: ${result.target_user_name} (ID ${result.target_user_id}).`);
        write('Inicie MundiPOS normalmente e ingrese con la cuenta administrativa recuperada.');
    } finally {
        delete request.password;
        delete request.newPassword;
    }
}

async function main({ argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), projectRoot = PROJECT_ROOT,
    input = process.stdin, output = process.stdout, io, DatabaseClass } = {}) {
    const write = message => output.write(`${display(message)}\n`);
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    const databases = [];
    let code = 0;
    try {
        const options = parseArgs(argv);
        if (options.help) { output.write(HELP); return 0; }
        if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') fail('TTY');
        process.on('SIGINT', interrupt);
        io = io || createTerminalIO(input, output, controller.signal);
        loadEnvFile(projectRoot, env);
        const paths = await canonicalizePaths(resolvePaths(options, env, projectRoot, cwd));
        const Database = DatabaseClass || require('../server/db/database').Database;
        const { AdminRecoveryService } = require('../server/services/adminRecoveryService');
        const db = new Database({ dbPath: paths.main.path, mustExist: true });
        const sessionDb = new Database({ dbPath: paths.sessions.path, mustExist: true });
        databases.push(db, sessionDb);
        await db.connect();
        await sessionDb.connect();
        const state = await validateDatabases(db, sessionDb);
        const service = new AdminRecoveryService({ db, sessionDb });
        await recoverInteractively({ service, state, options, paths, io, write, signal: controller.signal });
    } catch (error) {
        const message = error instanceof CliError ? error.message : SERVICE_MESSAGES[String(error.code).replace(/^ADMIN_RECOVERY_/, '')] || MESSAGES.STORAGE;
        write(message);
        code = error.code === 'CANCELLED' ? 130 : 1;
    } finally {
        process.removeListener('SIGINT', interrupt);
        try { io?.close(); } catch { code = 1; }
        const closed = await Promise.allSettled(databases.map(db => db.close()));
        if (closed.some(result => result.status === 'rejected')) { write(MESSAGES.CLOSE); code = 1; }
    }
    return code;
}

if (require.main === module) {
    main().then(code => { process.exitCode = code; }, () => { process.stderr.write(`${MESSAGES.STORAGE}\n`); process.exitCode = 1; });
}

module.exports = { main, parseArgs, loadEnvFile, resolvePaths, canonicalizePaths, createTerminalIO };
