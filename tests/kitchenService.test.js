const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const {
    KitchenService,
    KITCHEN_CHANGE_TYPES
} = require('../server/services/kitchenService');

async function seedKitchenDomain(db) {
    await db.createTables();
    await db.migrateSchema();

    const now = '2026-07-17T12:00:00.000Z';
    const user = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Daniel Salonero', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero Kitchen Test', 'salonero-kitchen-test', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Salón Kitchen Test', 'salon-kitchen-test', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (45, 4, 'ocupada', 'salon-kitchen-test', 'mesa', ?, 1, 'María', ?, 2)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, user.id, role.id, user.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Preparación Kitchen Test', NULL, 1, 1)
    `);
    const kitchen = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id, subcategoria_id,
            es_cocina, destino_preparacion, activo
        ) VALUES ('Arroz con carne', 'Plato', 3500, ?, NULL, 1, 'cocina', 1)
    `, [category.id]);
    const bar = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id, subcategoria_id,
            es_cocina, destino_preparacion, activo
        ) VALUES ('Limonada', 'Bebida', 1500, ?, NULL, 1, 'bar', 1)
    `, [category.id]);
    const direct = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id, subcategoria_id,
            es_cocina, destino_preparacion, activo
        ) VALUES ('Agua embotellada', 'Directo', 1000, ?, NULL, 0, 'ninguno', 1)
    `, [category.id]);

    return { now, user, role, zone, seat, category, kitchen, bar, direct };
}

test('Orders registra consumo y Kitchen crea comandas separadas para cocina y bar', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        now: fixture.now,
        productos: [
            {
                producto_id: fixture.kitchen.id,
                cantidad: 1,
                observacion: 'Sin salsas',
                adicionales: ['Arroz adicional']
            },
            { producto_id: fixture.bar.id, cantidad: 2, observacion: 'Sin azúcar' },
            { producto_id: fixture.direct.id, cantidad: 1 }
        ]
    });

    assert.equal(created.requiere_comanda, true);
    assert.equal(created.comanda_ids.length, 2);

    const commands = await context.db.all(`
        SELECT id, destino, usuario_solicitante_nombre_snapshot, mesa_numero_snapshot
        FROM comandas
        WHERE pedido_id = ?
        ORDER BY destino
    `, [created.id]);
    assert.deepEqual(commands.map(command => command.destino), ['bar', 'cocina']);
    assert.ok(commands.every(command => command.usuario_solicitante_nombre_snapshot === 'Daniel Salonero'));
    assert.ok(commands.every(command => Number(command.mesa_numero_snapshot) === 45));

    const kitchenCommand = commands.find(command => command.destino === 'cocina');
    const kitchenItem = await context.db.get(`
        SELECT * FROM comanda_items WHERE comanda_id = ?
    `, [kitchenCommand.id]);
    assert.equal(kitchenItem.cantidad_delta, 1);
    assert.equal(kitchenItem.tipo_cambio, KITCHEN_CHANGE_TYPES.DISPATCH);
    assert.equal(kitchenItem.producto_nombre_snapshot, 'Arroz con carne');
    assert.equal(kitchenItem.observacion_snapshot, 'Sin salsas');
    assert.deepEqual(JSON.parse(kitchenItem.adicionales_snapshot), ['Arroz adicional']);
    assert.equal(kitchenItem.usuario_solicitante_nombre_snapshot, 'Daniel Salonero');

    const directItems = await context.db.get(`
        SELECT COUNT(*) AS total
        FROM comanda_items
        WHERE producto_id = ?
    `, [fixture.direct.id]);
    assert.equal(directItems.total, 0);
});

test('Kitchen envía únicamente la cantidad nueva agregada al consumo', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.kitchen.id, cantidad: 1 }]
    });
    const added = await accountService.addProducts(created.id, {
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.kitchen.id, cantidad: 2 }]
    });

    assert.equal(added.requiere_comanda, true);
    assert.equal(added.comanda_ids.length, 1);
    const latestItem = await context.db.get(`
        SELECT ci.*
        FROM comanda_items ci
        JOIN comandas c ON c.id = ci.comanda_id
        WHERE c.id = ?
    `, [added.comanda_ids[0]]);
    assert.equal(latestItem.cantidad_delta, 2);
    assert.equal(latestItem.cantidad_resultante_snapshot, 3);

    const totals = await context.db.get(`
        SELECT
            SUM(CASE WHEN ci.tipo_cambio = 'envio' THEN ci.cantidad_delta ELSE 0 END) AS enviadas,
            SUM(CASE WHEN ci.tipo_cambio = 'anulacion' THEN ci.cantidad_delta ELSE 0 END) AS anuladas
        FROM comanda_items ci
        JOIN comandas c ON c.id = ci.comanda_id
        WHERE c.pedido_id = ? AND ci.producto_id = ?
    `, [created.id, fixture.kitchen.id]);
    assert.equal(totals.enviadas, 3);
    assert.equal(totals.anuladas, 0);
});

test('un cambio de destino genera anulación en Cocina y envío completo a Bar', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.kitchen.id, cantidad: 2 }]
    });

    await context.db.run(`
        UPDATE productos SET destino_preparacion = 'bar', es_cocina = 1 WHERE id = ?
    `, [fixture.kitchen.id]);

    const result = await kitchenService.requestDispatch({
        accountId: created.id,
        userId: fixture.user.id,
        idempotencyKey: 'kitchen-destination-change-0001'
    });
    assert.equal(result.comanda_ids.length, 2);

    const changes = await context.db.all(`
        SELECT c.destino, ci.tipo_cambio, ci.cantidad_delta, ci.cantidad_resultante_snapshot
        FROM comanda_items ci
        JOIN comandas c ON c.id = ci.comanda_id
        WHERE c.id IN (?, ?)
        ORDER BY c.destino
    `, result.comanda_ids);
    assert.deepEqual(changes.map(change => ({ ...change })), [
        { destino: 'bar', tipo_cambio: 'envio', cantidad_delta: 2, cantidad_resultante_snapshot: 2 },
        { destino: 'cocina', tipo_cambio: 'anulacion', cantidad_delta: 2, cantidad_resultante_snapshot: 0 }
    ]);
});

test('la idempotencia reproduce el resultado y rechaza reutilizar la clave tras cambiar el consumo', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.direct.id, cantidad: 1 }]
    });
    const key = 'kitchen-idempotency-test-0001';
    const first = await kitchenService.requestDispatch({
        accountId: created.id,
        userId: fixture.user.id,
        idempotencyKey: key
    });
    const replay = await kitchenService.requestDispatch({
        accountId: created.id,
        userId: fixture.user.id,
        idempotencyKey: key
    });

    assert.equal(first.requiere_comanda, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.comanda_ids, first.comanda_ids);

    await context.db.run(`
        UPDATE pedido_productos
        SET cantidad = cantidad + 1, version = version + 1
        WHERE pedido_id = ?
    `, [created.id]);

    await assert.rejects(
        kitchenService.requestDispatch({
            accountId: created.id,
            userId: fixture.user.id,
            idempotencyKey: key
        }),
        error => error?.code === 'IDEMPOTENCY_CONFLICT'
    );
});

test('marcar impresión no cambia el estado operativo de preparación', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.kitchen.id, cantidad: 1 }]
    });
    const before = await kitchenService.getComanda(created.comanda_id);
    const after = await kitchenService.markPrintState({
        comandaId: created.comanda_id,
        userId: fixture.user.id,
        state: 'impresa'
    });

    assert.equal(before.estado_operativo, 'pendiente');
    assert.equal(before.fecha_impresion, null);
    assert.equal(before.enviada_en, null);
    assert.equal(after.estado_operativo, 'pendiente');
    assert.equal(after.estado_impresion, 'impresa');
    assert.equal(after.estado, 'impresa');
    assert.ok(after.fecha_impresion);
    assert.equal(after.enviada_en, null);

    await context.db.migrateKitchenLegacy();
    const afterRestartMigration = await kitchenService.getComanda(created.comanda_id);
    assert.equal(afterRestartMigration.estado_operativo, 'pendiente');
    assert.equal(afterRestartMigration.estado_impresion, 'impresa');
    assert.equal(afterRestartMigration.enviada_en, null);
});

test('un ajuste operativo atribuye la nueva solicitud al usuario que realiza el cambio', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const secondUser = await context.db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Laura Bartender', 'hash', 'basico', 1, ?)
    `, [fixture.now]);
    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.kitchen.id, cantidad: 1 }]
    });

    await context.db.run(`
        UPDATE pedido_productos
        SET observacion_snapshot = 'Sin salsa',
            actualizado_en = ?,
            version = version + 1
        WHERE pedido_id = ? AND producto_id = ?
    `, ['2026-07-17T12:05:00.000Z', created.id, fixture.kitchen.id]);

    const adjusted = await kitchenService.requestDispatch({
        accountId: created.id,
        userId: secondUser.id,
        idempotencyKey: 'kitchen-adjustment-user-0001',
        now: '2026-07-17T12:06:00.000Z'
    });
    assert.equal(adjusted.comanda_ids.length, 1);

    const item = await context.db.get(`
        SELECT tipo_cambio, usuario_solicitante_id, usuario_solicitante_nombre_snapshot
        FROM comanda_items
        WHERE comanda_id = ?
    `, [adjusted.comanda_ids[0]]);
    assert.equal(item.tipo_cambio, 'ajuste');
    assert.equal(item.usuario_solicitante_id, secondUser.id);
    assert.equal(item.usuario_solicitante_nombre_snapshot, 'Laura Bartender');
});

test('dos solicitudes concurrentes no reutilizan la misma cantidad pendiente', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.direct.id, cantidad: 1 }]
    });
    await context.db.run(`
        UPDATE pedido_productos
        SET producto_id = ?,
            producto_nombre_snapshot = 'Arroz con carne',
            version = version + 1
        WHERE pedido_id = ?
    `, [fixture.kitchen.id, created.id]);

    const [first, second] = await Promise.all([
        kitchenService.requestDispatch({
            accountId: created.id,
            userId: fixture.user.id,
            idempotencyKey: 'kitchen-concurrency-0001'
        }),
        kitchenService.requestDispatch({
            accountId: created.id,
            userId: fixture.user.id,
            idempotencyKey: 'kitchen-concurrency-0002'
        })
    ]);

    assert.equal(first.comanda_ids.length + second.comanda_ids.length, 1);
    const totals = await context.db.get(`
        SELECT COUNT(*) AS comandas, COALESCE(SUM(ci.cantidad_delta), 0) AS cantidad
        FROM comandas c
        JOIN comanda_items ci ON ci.comanda_id = c.id
        WHERE c.pedido_id = ? AND ci.tipo_cambio = 'envio'
    `, [created.id]);
    assert.equal(totals.comandas, 1);
    assert.equal(totals.cantidad, 1);
});

test('al sustituir producto y destino, la anulación conserva el snapshot anterior', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.kitchen.id, cantidad: 2 }]
    });

    const replaced = await accountService.replaceLegacyProduct(
        created.id,
        fixture.kitchen.id,
        fixture.bar.id,
        {
            userId: fixture.user.id,
            lowerPriceAuthorized: true,
            idempotencyKey: 'kitchen-product-destination-replace-0001'
        }
    );
    assert.equal(replaced.comanda_ids.length, 2);

    const items = await context.db.all(`
        SELECT
            c.destino,
            ci.tipo_cambio,
            ci.producto_id,
            ci.producto_nombre_snapshot,
            ci.cantidad_delta
        FROM comanda_items ci
        JOIN comandas c ON c.id = ci.comanda_id
        WHERE c.id IN (?, ?)
        ORDER BY c.destino
    `, replaced.comanda_ids);

    assert.deepEqual(items.map(item => ({ ...item })), [
        {
            destino: 'bar',
            tipo_cambio: 'envio',
            producto_id: fixture.bar.id,
            producto_nombre_snapshot: 'Limonada',
            cantidad_delta: 2
        },
        {
            destino: 'cocina',
            tipo_cambio: 'anulacion',
            producto_id: fixture.kitchen.id,
            producto_nombre_snapshot: 'Arroz con carne',
            cantidad_delta: 2
        }
    ]);
});

test('una reducción con cambio descriptivo anula el excedente anterior y ajusta el remanente', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.kitchen.id, cantidad: 2 }]
    });

    await context.db.run(`
        UPDATE pedido_productos
        SET cantidad = 1,
            observacion_snapshot = 'Sin salsa',
            actualizado_en = '2026-07-17T12:10:00.000Z',
            version = version + 1
        WHERE pedido_id = ? AND producto_id = ?
    `, [created.id, fixture.kitchen.id]);

    const result = await kitchenService.requestDispatch({
        accountId: created.id,
        userId: fixture.user.id,
        idempotencyKey: 'kitchen-reduction-adjustment-0001'
    });
    assert.equal(result.comanda_ids.length, 1);

    const items = await context.db.all(`
        SELECT
            tipo_cambio,
            cantidad_delta,
            cantidad_resultante_snapshot,
            observacion_snapshot
        FROM comanda_items
        WHERE comanda_id = ?
        ORDER BY id
    `, [result.comanda_ids[0]]);

    assert.deepEqual(items.map(item => ({ ...item })), [
        {
            tipo_cambio: 'anulacion',
            cantidad_delta: 1,
            cantidad_resultante_snapshot: 1,
            observacion_snapshot: null
        },
        {
            tipo_cambio: 'ajuste',
            cantidad_delta: 0,
            cantidad_resultante_snapshot: 1,
            observacion_snapshot: 'Sin salsa'
        }
    ]);
});


test('sustituir un producto dentro del mismo destino anula el snapshot anterior y envía el nuevo', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    await context.db.run(`
        UPDATE productos
        SET destino_preparacion = 'cocina', es_cocina = 1
        WHERE id = ?
    `, [fixture.bar.id]);

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.kitchen.id, cantidad: 2 }]
    });

    const replaced = await accountService.replaceLegacyProduct(
        created.id,
        fixture.kitchen.id,
        fixture.bar.id,
        {
            userId: fixture.user.id,
            lowerPriceAuthorized: true,
            idempotencyKey: 'kitchen-same-destination-replace-0001'
        }
    );

    assert.equal(replaced.comanda_ids.length, 1);
    const items = await context.db.all(`
        SELECT tipo_cambio, producto_id, producto_nombre_snapshot,
               cantidad_delta, cantidad_resultante_snapshot
        FROM comanda_items
        WHERE comanda_id = ?
        ORDER BY id
    `, [replaced.comanda_ids[0]]);

    assert.deepEqual(items.map(item => ({ ...item })), [
        {
            tipo_cambio: 'anulacion',
            producto_id: fixture.kitchen.id,
            producto_nombre_snapshot: 'Arroz con carne',
            cantidad_delta: 2,
            cantidad_resultante_snapshot: 0
        },
        {
            tipo_cambio: 'envio',
            producto_id: fixture.bar.id,
            producto_nombre_snapshot: 'Limonada',
            cantidad_delta: 2,
            cantidad_resultante_snapshot: 2
        }
    ]);
});

test('retirar por completo una línea genera la anulación de toda la cantidad enviada', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.kitchen.id, cantidad: 3 }]
    });

    await context.db.run(`
        UPDATE pedido_productos
        SET cantidad = 0,
            actualizado_en = '2026-07-17T12:20:00.000Z',
            version = version + 1
        WHERE pedido_id = ? AND producto_id = ?
    `, [created.id, fixture.kitchen.id]);

    const result = await kitchenService.requestDispatch({
        accountId: created.id,
        userId: fixture.user.id,
        idempotencyKey: 'kitchen-remove-line-0001'
    });

    assert.equal(result.comanda_ids.length, 1);
    const item = await context.db.get(`
        SELECT tipo_cambio, producto_nombre_snapshot,
               cantidad_delta, cantidad_resultante_snapshot, motivo
        FROM comanda_items
        WHERE comanda_id = ?
    `, [result.comanda_ids[0]]);

    assert.equal(item.tipo_cambio, 'anulacion');
    assert.equal(item.producto_nombre_snapshot, 'Arroz con carne');
    assert.equal(item.cantidad_delta, 3);
    assert.equal(item.cantidad_resultante_snapshot, 0);
    assert.match(item.motivo, /retirada del consumo/i);
});

test('reenviar una comanda conserva las instrucciones originales sin duplicar cantidades pendientes', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedKitchenDomain(context.db);
    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });

    await context.db.run(`
        UPDATE productos
        SET destino_preparacion = 'cocina', es_cocina = 1
        WHERE id = ?
    `, [fixture.bar.id]);

    const created = await accountService.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.kitchen.id, cantidad: 2 }]
    });

    const replaced = await accountService.replaceLegacyProduct(
        created.id,
        fixture.kitchen.id,
        fixture.bar.id,
        {
            userId: fixture.user.id,
            lowerPriceAuthorized: true,
            idempotencyKey: 'kitchen-resend-source-0001'
        }
    );
    const sourceId = replaced.comanda_ids[0];

    const resent = await kitchenService.resend({
        comandaId: sourceId,
        userId: fixture.user.id,
        reason: 'La estación solicitó una copia operativa'
    });

    assert.equal(resent.comanda_origen_id, sourceId);
    assert.equal(resent.motivo, 'La estación solicitó una copia operativa');
    assert.deepEqual(
        resent.items.map(item => item.tipo_cambio),
        ['anulacion', 'envio']
    );

    const noPending = await kitchenService.requestDispatch({
        accountId: created.id,
        userId: fixture.user.id,
        idempotencyKey: 'kitchen-resend-does-not-change-net-0001'
    });
    assert.equal(noPending.requiere_comanda, false);
    assert.equal(noPending.cambios, 0);
});
