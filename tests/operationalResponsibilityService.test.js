const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const {
    OperationalResponsibilityService
} = require('../server/services/operationalResponsibilityService');

async function createFixture() {
    const context = await createTestDatabase();
    await context.db.createTables();
    await context.db.migrateSchema();

    const now = '2026-07-21T12:00:00.000Z';
    const user = await context.db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Usuario responsable', 'hash', 'basico', 1, ?)
    `, [now]);
    const otherUser = await context.db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Otro usuario', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await context.db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero v4.3.1', 'salonero-v4-3-1', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await context.db.run(`
        INSERT INTO zonas (nombre, slug, orden, aplica_servicio, porcentaje_servicio, activa, creado_en)
        VALUES ('Zona v4.3.1', 'zona-v4-3-1', 1, 1, 10, 1, ?)
    `, [now]);

    return {
        ...context,
        now,
        user,
        otherUser,
        role,
        zone,
        service: new OperationalResponsibilityService({ db: context.db })
    };
}

async function createSeat(fixture, options = {}) {
    const state = options.state || 'ocupada';
    const number = options.number || 91;
    return fixture.db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (?, 4, ?, 'zona-v4-3-1', 'mesa', ?, 1, 'Cliente', ?, 2)
    `, [number, state, fixture.zone.id, fixture.now]);
}

async function assignSeat(fixture, seatId, userId = fixture.user.id) {
    await fixture.db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id, asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seatId, userId, fixture.role.id, userId, fixture.now]);
}

async function createAccount(fixture, seatId, options = {}) {
    return fixture.db.run(`
        INSERT INTO pedidos (
            mesa_id, usuario_id, rol_trabajo_id, fecha, estado, total,
            cliente_nombre, numero_cuenta, estado_operativo, estado_financiero,
            total_pagado, saldo_pendiente, fecha_apertura
        ) VALUES (?, ?, ?, ?, ?, ?, 'Cliente', ?, ?, ?, ?, ?, ?)
    `, [
        seatId,
        fixture.user.id,
        fixture.role.id,
        fixture.now,
        options.state || 'pendiente',
        options.total ?? 1000,
        options.accountNumber || `CTA-TEST-${seatId}`,
        options.operationalState || 'abierta',
        options.financialState || 'sin_documentos',
        options.paid ?? 0,
        options.balance ?? 1000,
        fixture.now
    ]);
}

test('un usuario válido sin entidades operativas propias no tiene responsabilidad', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());

    const result = await fixture.service.getUserResponsibilities(fixture.user.id);

    assert.deepEqual(result, {
        usuario_id: fixture.user.id,
        tiene_responsabilidad: false,
        total: 0,
        responsabilidades: []
    });
});

test('una mesa ocupada asignada atribuye responsabilidad con evidencia concreta', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());
    const seat = await createSeat(fixture);
    await assignSeat(fixture, seat.id);
    const before = await fixture.db.all('SELECT * FROM mesa_responsables ORDER BY mesa_id, usuario_id');

    const result = await fixture.service.getUserResponsibilities(fixture.user.id);
    const after = await fixture.db.all('SELECT * FROM mesa_responsables ORDER BY mesa_id, usuario_id');

    assert.equal(result.tiene_responsabilidad, true);
    assert.equal(result.total, 1);
    assert.equal(result.responsabilidades[0].tipo, 'mesa');
    assert.equal(result.responsabilidades[0].id, seat.id);
    assert.deepEqual(result.responsabilidades[0].causas, ['mesa_ocupada']);
    assert.deepEqual(after, before, 'la evaluación debe ser read-only');
});

test('el trabajo activo asignado a otro usuario no se atribuye al consultado', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());
    const seat = await createSeat(fixture);
    await assignSeat(fixture, seat.id, fixture.otherUser.id);

    const result = await fixture.service.getUserResponsibilities(fixture.user.id);

    assert.equal(result.tiene_responsabilidad, false);
    assert.equal(result.total, 0);
});

test('un servicio finalizado y liberado no cuenta aunque conserve snapshots históricos', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());
    const seat = await createSeat(fixture, { state: 'libre' });
    const account = await createAccount(fixture, seat.id, {
        state: 'pagado',
        operationalState: 'cerrada',
        financialState: 'conciliada',
        paid: 1000,
        balance: 0
    });
    await fixture.db.run(`
        INSERT INTO cuenta_responsables (
            pedido_id, usuario_id, rol_trabajo_id, usuario_nombre_snapshot,
            rol_nombre_snapshot, es_principal, fecha_asignacion_snapshot
        ) VALUES (?, ?, ?, 'Usuario responsable', 'Salonero v4.3.1', 1, ?)
    `, [account.id, fixture.user.id, fixture.role.id, fixture.now]);

    const result = await fixture.service.getUserResponsibilities(fixture.user.id);

    assert.equal(result.tiene_responsabilidad, false);
    assert.equal(result.total, 0);
});

test('una cuenta pagada conserva responsabilidad mientras el servicio siga activo', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());
    const seat = await createSeat(fixture);
    await assignSeat(fixture, seat.id);
    const account = await createAccount(fixture, seat.id, {
        state: 'pagado',
        operationalState: 'abierta',
        financialState: 'conciliada',
        paid: 1000,
        balance: 0
    });

    const result = await fixture.service.getUserResponsibilities(fixture.user.id);

    assert.equal(result.tiene_responsabilidad, true);
    assert.deepEqual(result.responsabilidades[0].causas, [
        'mesa_ocupada',
        'cuenta_operativa_abierta'
    ]);
    assert.deepEqual(result.responsabilidades[0].cuentas_operativas, [{
        id: account.id,
        numero_cuenta: `CTA-TEST-${seat.id}`,
        estado_operativo: 'abierta',
        estado_financiero: 'conciliada',
        total_pagado: 1000,
        saldo_pendiente: 0
    }]);
});

test('agrega varias responsabilidades activas del mismo usuario en orden determinista', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());
    const occupiedSeat = await createSeat(fixture, { number: 93, state: 'ocupada' });
    const reservedSeat = await createSeat(fixture, { number: 92, state: 'reservada' });
    await assignSeat(fixture, occupiedSeat.id);
    await assignSeat(fixture, reservedSeat.id);

    const result = await fixture.service.getUserResponsibilities(fixture.user.id);

    assert.equal(result.tiene_responsabilidad, true);
    assert.equal(result.total, 2);
    assert.deepEqual(
        result.responsabilidades.map(item => item.mesa.numero),
        [92, 93]
    );
    assert.deepEqual(
        result.responsabilidades.map(item => item.causas),
        [['mesa_reservada'], ['mesa_ocupada']]
    );
});

test('la responsabilidad persistida no depende de una sesión técnica activa', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());
    const seat = await createSeat(fixture);
    await assignSeat(fixture, seat.id);
    const sessions = await fixture.db.get(
        'SELECT COUNT(*) AS total FROM sesiones_usuario WHERE usuario_id = ?',
        [fixture.user.id]
    );

    const result = await fixture.service.getUserResponsibilities(fixture.user.id);

    assert.equal(Number(sessions.total), 0);
    assert.equal(result.tiene_responsabilidad, true);
    assert.equal(result.total, 1);
});

test('la evaluación de responsabilidades no altera el estado operacional', async t => {
    const fixture = await createFixture();
    t.after(() => fixture.cleanup());
    const seat = await createSeat(fixture);
    await assignSeat(fixture, seat.id);
    await createAccount(fixture, seat.id, { operationalState: 'finalizando' });
    const before = {
        mesa: await fixture.db.get(
            'SELECT estado, activo FROM mesas WHERE id = ?',
            [seat.id]
        ),
        asignaciones: await fixture.db.all(
            'SELECT * FROM mesa_responsables WHERE mesa_id = ? ORDER BY usuario_id',
            [seat.id]
        ),
        cuentas: await fixture.db.all(`
            SELECT estado, estado_operativo, estado_financiero, total_pagado, saldo_pendiente
            FROM pedidos
            WHERE mesa_id = ?
            ORDER BY id
        `, [seat.id])
    };

    await fixture.service.getUserResponsibilities(fixture.user.id);

    const after = {
        mesa: await fixture.db.get(
            'SELECT estado, activo FROM mesas WHERE id = ?',
            [seat.id]
        ),
        asignaciones: await fixture.db.all(
            'SELECT * FROM mesa_responsables WHERE mesa_id = ? ORDER BY usuario_id',
            [seat.id]
        ),
        cuentas: await fixture.db.all(`
            SELECT estado, estado_operativo, estado_financiero, total_pagado, saldo_pendiente
            FROM pedidos
            WHERE mesa_id = ?
            ORDER BY id
        `, [seat.id])
    };

    assert.deepEqual(after, before);
});
