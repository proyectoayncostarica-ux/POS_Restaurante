const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTestDatabase } = require('./helpers/testDatabase');
const {
    UserSessionService,
    USER_SESSION_STATUSES
} = require('../server/services/userSessionService');

const PROJECT_ROOT = path.join(__dirname, '..');
const FIXED_START = '2026-07-21T12:00:00.000Z';
const FIXED_END = '2026-07-21T13:00:00.000Z';

async function initializeSchema(db) {
    await db.createTables();
    await db.migrateSchema();
    await db.createIndexes();
}

async function insertUser(db, name = 'usuario-sesiones') {
    const result = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES (?, 'hash-prueba', 'basico', 1, ?)
    `, [name, FIXED_START]);
    return Number(result.id);
}

test('v4.2.1 crea sesiones_usuario de forma idempotente y conserva sus datos', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());

    await initializeSchema(context.db);
    const userId = await insertUser(context.db);
    const service = new UserSessionService({ db: context.db });
    await service.create({
        sessionUuid: '11111111-1111-4111-8111-111111111111',
        userId,
        expressSessionId: 'sid-tecnico-reutilizable',
        clientId: 'cliente-pc-caja',
        startedAt: FIXED_START
    });

    await initializeSchema(context.db);

    const table = await context.db.get(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sesiones_usuario'"
    );
    assert.equal(table?.name, 'sesiones_usuario');

    const rows = await context.db.all('SELECT * FROM sesiones_usuario');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].session_uuid, '11111111-1111-4111-8111-111111111111');
    assert.equal(rows[0].express_session_id, 'sid-tecnico-reutilizable');
    assert.equal(rows[0].client_id, 'cliente-pc-caja');
});

test('el esquema declara identidad propia, estados, relación de usuario e índices útiles', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await initializeSchema(context.db);

    const columns = await context.db.all("PRAGMA table_info('sesiones_usuario')");
    const columnNames = columns.map(column => column.name);
    assert.deepEqual(columnNames, [
        'id',
        'session_uuid',
        'usuario_id',
        'express_session_id',
        'client_id',
        'estado',
        'iniciada_en',
        'ultima_actividad_en',
        'finalizada_en',
        'motivo_finalizacion',
        'actualizado_en'
    ]);
    assert.equal(columns.find(column => column.name === 'id')?.pk, 1);
    assert.equal(columns.find(column => column.name === 'session_uuid')?.notnull, 1);
    assert.equal(columns.find(column => column.name === 'express_session_id')?.pk, 0);

    const definition = await context.db.get(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sesiones_usuario'"
    );
    for (const status of USER_SESSION_STATUSES) {
        assert.match(definition.sql, new RegExp(`['\"]${status}['\"]`));
    }

    const foreignKeys = await context.db.all("PRAGMA foreign_key_list('sesiones_usuario')");
    assert.ok(foreignKeys.some(key => (
        key.table === 'usuarios'
        && key.from === 'usuario_id'
        && key.to === 'id'
        && key.on_delete === 'RESTRICT'
    )));

    const indexes = await context.db.all("PRAGMA index_list('sesiones_usuario')");
    const indexNames = new Set(indexes.map(index => index.name));
    assert.ok(indexNames.has('idx_sesiones_usuario_usuario_inicio'));
    assert.ok(indexNames.has('idx_sesiones_usuario_estado_inicio'));
    assert.ok(indexNames.has('idx_sesiones_usuario_cliente_inicio'));
    assert.ok(indexNames.has('idx_sesiones_usuario_express_sid'));
    assert.ok(indexNames.has('idx_sesiones_usuario_inicio'));
    assert.ok(indexes.some(index => Number(index.unique) === 1));
});

test('el repositorio conserva historia y permite correlacionar varias filas con un mismo SID', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await initializeSchema(context.db);
    const userId = await insertUser(context.db, 'historial-sesiones');
    const service = new UserSessionService({
        db: context.db,
        clock: () => FIXED_END
    });

    const first = await service.create({
        sessionUuid: '22222222-2222-4222-8222-222222222222',
        userId,
        expressSessionId: 'sid-compartido-historico',
        clientId: 'cliente-tablet-1',
        startedAt: FIXED_START
    });
    const second = await service.create({
        sessionUuid: '33333333-3333-4333-8333-333333333333',
        userId,
        expressSessionId: 'sid-compartido-historico',
        clientId: 'cliente-tablet-2',
        startedAt: FIXED_END
    });

    assert.notEqual(first.session_uuid, second.session_uuid);
    const correlated = await service.findByExpressSessionId('sid-compartido-historico');
    assert.equal(correlated.length, 2);

    const closed = await service.updateStatus(first.session_uuid, {
        status: 'cerrada',
        endedAt: FIXED_END,
        endReason: 'logout'
    });
    assert.equal(closed.id, first.id);
    assert.equal(closed.estado, 'cerrada');
    assert.equal(closed.finalizada_en, FIXED_END);
    assert.equal(closed.motivo_finalizacion, 'logout');

    const history = await service.listByUser(userId);
    assert.equal(history.length, 2);
    assert.ok(history.some(row => row.session_uuid === first.session_uuid));
    assert.ok(history.some(row => row.session_uuid === second.session_uuid));

    await assert.rejects(
        () => service.create({
            sessionUuid: '44444444-4444-4444-8444-444444444444',
            userId: userId + 9999,
            expressSessionId: 'sid-sin-usuario'
        }),
        /SQLITE_CONSTRAINT|FOREIGN KEY constraint failed/i
    );
    const foreignKeyIssues = await context.db.all('PRAGMA foreign_key_check');
    assert.deepEqual(foreignKeyIssues, []);
});

test('v4.2.1 mantiene separado el historial del store técnico y no integra auth prematuramente', () => {
    const authSource = fs.readFileSync(path.join(PROJECT_ROOT, 'server/routes/auth.js'), 'utf8');
    const storeSource = fs.readFileSync(path.join(PROJECT_ROOT, 'server/services/sqliteSessionStore.js'), 'utf8');
    const serviceMethods = Object.getOwnPropertyNames(UserSessionService.prototype);

    assert.doesNotMatch(authSource, /sesiones_usuario|userSessionService/);
    assert.match(storeSource, /SESSION_TABLE\s*=\s*['"]express_sessions['"]/);
    assert.doesNotMatch(storeSource, /sesiones_usuario/);
    assert.ok(serviceMethods.includes('create'));
    assert.ok(serviceMethods.includes('findByUuid'));
    assert.ok(serviceMethods.includes('findByExpressSessionId'));
    assert.ok(serviceMethods.includes('listByUser'));
    assert.ok(serviceMethods.includes('updateStatus'));
    assert.ok(!serviceMethods.includes('heartbeat'));
    assert.ok(!serviceMethods.includes('transfer'));
    assert.ok(!serviceMethods.includes('revokeAutomatically'));
});
