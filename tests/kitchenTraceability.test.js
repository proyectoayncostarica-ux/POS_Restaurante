const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const {
    KitchenService,
    KITCHEN_OPERATIONAL_STATES
} = require('../server/services/kitchenService');

async function seedTraceabilityDomain(db) {
    await db.createTables();
    await db.migrateSchema();

    const now = '2026-07-17T12:00:00.000Z';
    const user = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Ana Salonera', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero Trace', 'salonero-trace', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Salón Trace', 'salon-trace', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (88, 4, 'ocupada', 'salon-trace', 'mesa', ?, 1, 'Cliente Trace', ?, 2)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, user.id, role.id, user.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Cocina Trace', NULL, 1, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id, subcategoria_id,
            es_cocina, destino_preparacion, activo
        ) VALUES ('Arroz con carne Trace', 'Plato', 3500, ?, NULL, 1, 'cocina', 1)
    `, [category.id]);

    return { now, user, role, zone, seat, product };
}

test('cada transición operativa conserva actor, versión y timestamp sin depender de impresión', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedTraceabilityDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        now: fixture.now,
        productos: [{ producto_id: fixture.product.id, cantidad: 1 }]
    });

    let command = await kitchenService.getComanda(created.comanda_id);
    assert.equal(command.estado_operativo, KITCHEN_OPERATIONAL_STATES.PENDING);
    assert.equal(command.version, 1);

    command = await kitchenService.transitionState({
        comandaId: command.id,
        userId: fixture.user.id,
        state: KITCHEN_OPERATIONAL_STATES.SENT,
        expectedVersion: command.version,
        now: '2026-07-17T12:01:00.000Z'
    });
    assert.equal(command.estado_operativo, KITCHEN_OPERATIONAL_STATES.SENT);
    assert.equal(command.enviada_en, '2026-07-17T12:01:00.000Z');
    assert.equal(command.version, 2);
    assert.equal(command.usuario_estado_nombre_snapshot, 'Ana Salonera');
    assert.equal(command.estado_impresion, 'pendiente');

    command = await kitchenService.transitionState({
        comandaId: command.id,
        userId: fixture.user.id,
        state: KITCHEN_OPERATIONAL_STATES.IN_PREPARATION,
        expectedVersion: command.version,
        now: '2026-07-17T12:03:00.000Z'
    });
    assert.equal(command.preparacion_iniciada_en, '2026-07-17T12:03:00.000Z');

    command = await kitchenService.transitionState({
        comandaId: command.id,
        userId: fixture.user.id,
        state: KITCHEN_OPERATIONAL_STATES.READY,
        expectedVersion: command.version,
        now: '2026-07-17T12:10:00.000Z'
    });
    assert.equal(command.lista_en, '2026-07-17T12:10:00.000Z');

    command = await kitchenService.transitionState({
        comandaId: command.id,
        userId: fixture.user.id,
        state: KITCHEN_OPERATIONAL_STATES.DELIVERED,
        expectedVersion: command.version,
        now: '2026-07-17T12:12:00.000Z'
    });
    assert.equal(command.entregada_en, '2026-07-17T12:12:00.000Z');
    assert.equal(command.estado_operativo, KITCHEN_OPERATIONAL_STATES.DELIVERED);
    assert.equal(command.estado, 'entregada');

    const history = await kitchenService.getHistory(command.id);
    assert.deepEqual(
        history.eventos_comanda.map(event => event.estado_nuevo),
        ['pendiente', 'enviada', 'en_preparacion', 'lista', 'entregada']
    );

    await assert.rejects(
        kitchenService.transitionState({
            comandaId: command.id,
            userId: fixture.user.id,
            state: KITCHEN_OPERATIONAL_STATES.CANCELLED,
            expectedVersion: 1,
            reason: 'Versión obsoleta'
        }),
        error => error?.code === 'CONFLICT' && error?.details?.code === 'KITCHEN_VERSION_CONFLICT'
    );
});

test('el read model reconstruye pendientes después de reiniciar y ordena por antigüedad operativa', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedTraceabilityDomain(context.db);
    const firstService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService: firstService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        now: '2026-07-17T12:00:00.000Z',
        productos: [{
            producto_id: fixture.product.id,
            cantidad: 2,
            observacion: 'Sin salsa',
            adicionales: ['Arroz adicional']
        }]
    });

    const restartedService = new KitchenService({ db: context.db });
    const board = await restartedService.getBoard({
        destination: 'cocina',
        zoneIds: [fixture.zone.id],
        now: '2026-07-17T12:25:00.000Z'
    });

    assert.equal(board.total, 1);
    const command = board.comandas[0];
    assert.equal(command.id, created.comanda_id);
    assert.equal(command.minutos_transcurridos, 25);
    assert.equal(command.prioridad_operativa, 2);
    assert.equal(command.mesa.numero, 88);
    assert.equal(command.zona.nombre, 'Salón Trace');
    assert.equal(command.usuario_solicitante.nombre, 'Ana Salonera');
    assert.equal(command.items[0].producto, 'Arroz con carne Trace');
    assert.equal(command.items[0].observacion, 'Sin salsa');
    assert.deepEqual(command.items[0].adicionales, ['Arroz adicional']);
    assert.equal(command.historial.eventos_items.length, 1);
});

test('el historial por ítem conserva antes y después de una modificación de cantidad', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedTraceabilityDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 1 }]
    });
    const added = await accountService.addProducts(created.id, {
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 2 }]
    });

    const trace = await kitchenService.getHistory(added.comanda_id);
    assert.equal(trace.eventos_items.length, 1);
    const event = trace.eventos_items[0];
    assert.equal(event.evento, 'envio');
    assert.equal(event.antes.cantidad, 1);
    assert.equal(event.despues.cantidad, 3);
    assert.equal(event.usuario_nombre_snapshot, 'Ana Salonera');
});
