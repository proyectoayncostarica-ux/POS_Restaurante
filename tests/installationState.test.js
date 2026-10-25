const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Database } = require('./helpers/testDatabase');
const { InstallationStateService } = require('../server/services/installationStateService');

const TABLE = 'installation_metadata';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const START = '2026-10-25T12:00:00.000Z';

async function createContext(t, { connect = true } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mundipos-installation-'));
    const dbPath = path.join(dir, 'restaurant.db');
    const db = new Database({ dbPath });
    t.after(async () => {
        await db.close();
        assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('mundipos-installation-'));
        await fs.rm(dir, { recursive: true, force: true });
    });
    if (connect) await db.connect();
    return { db, dbPath, service: new InstallationStateService({ db }) };
}

async function createLegacy(db, userType = null, active = 1) {
    // Núcleo pre-v4.4: sin tablas modernas de sesiones, roles o finanzas.
    await db.run(`CREATE TABLE usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT UNIQUE, password TEXT,
        tipo TEXT, activo INTEGER DEFAULT 1, fecha_creacion TEXT NOT NULL
    )`);
    await db.run(`CREATE TABLE mesas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, numero INTEGER NOT NULL,
        capacidad INTEGER, estado TEXT, zona TEXT, tipo_asiento TEXT
    )`);
    await db.run('CREATE TABLE configuracion (clave TEXT PRIMARY KEY, valor TEXT, version_app TEXT)');
    await db.run("INSERT INTO configuracion (clave, valor) VALUES ('nombre_restaurante', 'Negocio anterior')");
    await db.run("INSERT INTO mesas (numero, capacidad, estado, zona, tipo_asiento) VALUES (42, 4, 'libre', 'salon', 'mesa')");
    if (userType) {
        await db.run(`INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
            VALUES ('usuario-anterior', 'hash-anterior', ?, ?, ?)`, [userType, active, START]);
    }
}

test('startup registra nueva/PREPARING antes de seeds y conserva nueva sin UUID tras reinicio', async t => {
    const { db, service } = await createContext(t, { connect: false });
    const createTables = db.createTables.bind(db);
    db.createTables = async () => {
        const checkpoint = await service.loadInstallationState();
        assert.equal(checkpoint.origin, 'created_empty');
        assert.equal(checkpoint.state, 'PREPARING');
        assert.equal(checkpoint.installation_id, null);
        assert.equal(await db.tableExists('usuarios'), false);
        await createTables();
    };
    await db.initializeDatabase();
    const first = await service.loadInstallationState();
    assert.equal(first.origin, 'created_empty');
    assert.equal(first.state, 'AWAITING_INITIAL_ADMIN');
    assert.equal(first.installation_id, null);
    assert.equal(first.confirmed_at, null);
    assert.ok(await db.get("SELECT id FROM usuarios WHERE cuenta_departamental_codigo = 'cocina'"));

    db.createTables = createTables;
    await db.close();
    await db.initializeDatabase();
    assert.deepEqual(await service.loadInstallationState(), first);
});

for (const [name, type, active] of [
    ['Admin activo', 'administrador', 1],
    ['Admin desactivado', 'administrador', 0],
    ['sin usuarios ni Admin', null, 1],
    ['Básico y datos propios sin Admin', 'basico', 1]
]) {
    test(`legacy ${name}: adopta UUID y lo conserva sin repetir preparación`, async t => {
        const { db, service } = await createContext(t);
        await createLegacy(db, type, active);
        const checkpoint = await service.prepareInstallationState();
        assert.equal(checkpoint.origin, 'adopted_legacy');
        assert.equal(checkpoint.state, 'PREPARING');
        assert.equal(checkpoint.installation_id, null);
        await db.close();
        await db.initializeDatabase();
        const first = await service.loadInstallationState();
        assert.equal(first.state, 'IDENTIFIED');
        assert.equal(first.origin, 'adopted_legacy');
        assert.match(first.installation_id, UUID_V4);
        assert.ok(first.confirmed_at);
        assert.equal((await db.get("SELECT valor FROM configuracion WHERE clave = 'nombre_restaurante'")).valor, 'Negocio anterior');
        assert.ok(await db.get('SELECT id FROM mesas WHERE numero = 42'));
        if (type) {
            const user = await db.get("SELECT tipo, activo, password FROM usuarios WHERE nombre = 'usuario-anterior'");
            assert.deepEqual(user, { tipo: type, activo: active, password: 'hash-anterior' });
        }
        await db.close();
        await db.initializeDatabase();
        assert.deepEqual(await service.prepareInstallationState(), first);
        assert.deepEqual(await service.completeInstallationPreparation(), first);
    });
}

for (const legacy of [false, true]) {
    test(`reanuda PREPARING ${legacy ? 'legacy' : 'nueva'} tras interrupción del inicializador`, async t => {
        const { db, service } = await createContext(t);
        if (legacy) await createLegacy(db);
        await db.close();
        const createIndexes = db.createIndexes.bind(db);
        db.createIndexes = async () => { throw new Error('interrupción simulada antes de seeds'); };
        await assert.rejects(db.initializeDatabase(), /interrupción simulada/);
        const checkpoint = await service.loadInstallationState();
        assert.equal(checkpoint.state, 'PREPARING');
        assert.equal(checkpoint.origin, legacy ? 'adopted_legacy' : 'created_empty');
        assert.equal(checkpoint.installation_id, null);
        await db.close();
        db.createIndexes = createIndexes;
        await db.initializeDatabase();
        const completed = await service.loadInstallationState();
        assert.equal(completed.origin, checkpoint.origin);
        assert.equal(completed.created_at, checkpoint.created_at);
        assert.equal(completed.state, legacy ? 'IDENTIFIED' : 'AWAITING_INITIAL_ADMIN');
        if (legacy) assert.match(completed.installation_id, UUID_V4);
        else assert.equal(completed.installation_id, null);
    });
}

test('un fallo al crear checkpoint revierte también su tabla; el reintento sigue siendo nuevo', async t => {
    const { db, service } = await createContext(t);
    const failing = new InstallationStateService({ db, clock: () => { throw new Error('fallo de checkpoint'); } });
    await assert.rejects(failing.prepareInstallationState(), /fallo de checkpoint/);
    assert.equal(await db.tableExists(TABLE), false);
    assert.equal((await service.prepareInstallationState()).origin, 'created_empty');
});

test('un fallo antes del commit de identidad conserva PREPARING sin UUID confirmado', async t => {
    const { db, service } = await createContext(t);
    await createLegacy(db);
    const checkpoint = await service.prepareInstallationState();
    const failing = new InstallationStateService({ db: {
        withTransaction: (work, options) => db.withTransaction(async tx => {
            await work(tx);
            throw new Error('fallo antes de commit');
        }, options)
    } });
    await assert.rejects(failing.completeInstallationPreparation(), /fallo antes de commit/);
    assert.deepEqual(await service.loadInstallationState(), checkpoint);
    const completed = await service.completeInstallationPreparation();
    assert.match(completed.installation_id, UUID_V4);
    assert.deepEqual(await service.completeInstallationPreparation(), completed);
});

for (const [name, schema] of [
    ['ajena', 'CREATE TABLE notas (id INTEGER PRIMARY KEY, texto TEXT)'],
    ['solo usuarios no demuestra MundiPOS', 'CREATE TABLE usuarios (id INTEGER, nombre TEXT, password TEXT, tipo TEXT)']
]) {
    test(`base ${name}: se detiene antes de crear metadata, tablas o seeds`, async t => {
        const { db } = await createContext(t);
        await db.run(schema);
        const before = await db.all('SELECT type, name, sql FROM sqlite_master ORDER BY name');
        await db.close();
        await assert.rejects(db.initializeDatabase(), { code: 'INSTALLATION_DATABASE_UNRECOGNIZED' });
        assert.equal(await db.tableExists(TABLE), false);
        assert.deepEqual(await db.all('SELECT type, name, sql FROM sqlite_master ORDER BY name'), before);
    });
}

const pending = {
    singleton_id: 1, format_version: 1, origin: 'created_empty', state: 'PREPARING',
    installation_id: null, created_at: START, updated_at: START, confirmed_at: null
};
const invalidCases = [
    ['sin cabecera', []],
    ['singleton incorrecto', [{ ...pending, singleton_id: 2 }]],
    ['varias cabeceras', [pending, { ...pending, singleton_id: 2 }]],
    ['formato futuro', [{ ...pending, format_version: 2 }]],
    ['origin desconocido', [{ ...pending, origin: 'otra' }]],
    ['state desconocido', [{ ...pending, state: 'ACTIVE' }]],
    ['IDENTIFIED sin identidad', [{ ...pending, state: 'IDENTIFIED', confirmed_at: START }]],
    ['identidad no UUIDv4', [{ ...pending, state: 'IDENTIFIED', installation_id: 'incorrecta', confirmed_at: START }]],
    ['identidad prematura', [{ ...pending, installation_id: '11111111-1111-4111-8111-111111111111' }]],
    ['legacy esperando primer Admin', [{ ...pending, origin: 'adopted_legacy', state: 'AWAITING_INITIAL_ADMIN' }]],
    ['fecha inválida', [{ ...pending, updated_at: 'no-es-fecha' }]],
    ['confirmación prematura', [{ ...pending, confirmed_at: START }]]
];

for (const [name, rows] of invalidCases) {
    test(`metadata alterada ${name}: error explícito sin reparar ni continuar startup`, async t => {
        const { db, service } = await createContext(t);
        // Simula una cabecera manipulada, sin las restricciones del esquema nuevo.
        await db.run(`CREATE TABLE ${TABLE} (
            singleton_id INTEGER, format_version INTEGER, origin TEXT, state TEXT,
            installation_id TEXT, created_at TEXT, updated_at TEXT, confirmed_at TEXT
        )`);
        for (const row of rows) {
            await db.run(`INSERT INTO ${TABLE} VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, Object.values(row));
        }
        const before = await db.all(`SELECT * FROM ${TABLE}`);
        const invalid = error => /^INSTALLATION_(METADATA_INVALID|FORMAT_UNSUPPORTED)$/.test(error.code);
        await assert.rejects(service.loadInstallationState(), invalid);
        await assert.rejects(service.prepareInstallationState(), invalid);
        await assert.rejects(service.completeInstallationPreparation(), invalid);
        await db.close();
        await assert.rejects(db.initializeDatabase(), invalid);
        assert.equal(await db.tableExists('usuarios'), false);
        assert.deepEqual(await db.all(`SELECT * FROM ${TABLE}`), before);
    });
}

test('SQLite impide otra cabecera y combinaciones de campos imposibles', async t => {
    const { db, service } = await createContext(t);
    await service.prepareInstallationState();
    for (const sql of [
        `INSERT INTO ${TABLE} SELECT 2, format_version, origin, state, installation_id, created_at, updated_at, confirmed_at FROM ${TABLE}`,
        `INSERT INTO ${TABLE} SELECT * FROM ${TABLE}`,
        `UPDATE ${TABLE} SET state = 'IDENTIFIED'`,
        `UPDATE ${TABLE} SET origin = 'adopted_legacy', state = 'AWAITING_INITIAL_ADMIN'`
    ]) {
        await assert.rejects(db.run(sql), /constraint/i);
    }
    assert.equal((await db.all(`SELECT * FROM ${TABLE}`)).length, 1);
});

test('conexiones independientes comparten singleton y una sola identidad confirmada', async t => {
    const { db, dbPath, service } = await createContext(t);
    await createLegacy(db);
    const peer = new Database({ dbPath });
    await peer.connect();
    try {
        const other = new InstallationStateService({ db: peer });
        const prepared = await Promise.all([service.prepareInstallationState(), other.prepareInstallationState()]);
        assert.deepEqual(prepared[0], prepared[1]);
        const completed = await Promise.all([service.completeInstallationPreparation(), other.completeInstallationPreparation()]);
        assert.deepEqual(completed[0], completed[1]);
        assert.match(completed[0].installation_id, UUID_V4);
        assert.equal((await db.all(`SELECT * FROM ${TABLE}`)).length, 1);
    } finally {
        await peer.close();
    }
});

test('identidad no depende de Admin ni de clientId/SID/serverInstanceId en configuración', async t => {
    const { db, service } = await createContext(t);
    await createLegacy(db, 'administrador');
    for (const key of ['installationId', 'clientId', 'SID', 'serverInstanceId']) {
        await db.run('INSERT INTO configuracion (clave, valor) VALUES (?, ?)', [key, '11111111-1111-4111-8111-111111111111']);
    }
    await service.prepareInstallationState();
    const first = await service.completeInstallationPreparation();
    assert.match(first.installation_id, UUID_V4);
    assert.notEqual(first.installation_id, '11111111-1111-4111-8111-111111111111');
    await db.run("UPDATE configuracion SET valor = 'otro-cliente-proceso-o-sesion'");
    await db.run('UPDATE usuarios SET activo = 0');
    assert.deepEqual(await service.prepareInstallationState(), first);
    assert.deepEqual(await service.completeInstallationPreparation(), first);
});
