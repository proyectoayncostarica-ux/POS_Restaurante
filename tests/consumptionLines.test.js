const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');

async function seedConsumptionDomain(db) {
    await db.createTables();
    await db.migrateSchema();

    const now = '2026-07-16T10:00:00.000Z';
    const user = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Andrey', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero líneas', 'salonero-lineas', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Zona líneas', 'zona-lineas', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (77, 4, 'ocupada', 'zona-lineas', 'mesa', ?, 1, 'Juan', ?, 3)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, user.id, role.id, user.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Categoría líneas', NULL, 0, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id,
            subcategoria_id, es_cocina, activo
        ) VALUES ('Imperial 350 ml', 'Cerveza', 1000, ?, NULL, 0, 1)
    `, [category.id]);
    const replacement = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id,
            subcategoria_id, es_cocina, activo
        ) VALUES ('Coca Cola', 'Refresco', 1200, ?, NULL, 0, 1)
    `, [category.id]);

    return { now, user, role, zone, seat, category, product, replacement };
}

async function createAccountWithQuantity(context, quantity = 3) {
    const fixture = await seedConsumptionDomain(context.db);
    const service = new AccountService({ db: context.db });
    const account = await service.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: quantity }],
        now: fixture.now
    });
    return { fixture, service, account };
}

test('crea líneas con snapshots y cantidad disponible igual al consumo', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const { service, account } = await createAccountWithQuantity(context, 3);

    const detail = await service.getAccount(account.id);
    assert.equal(detail.productos.length, 1);
    assert.equal(detail.productos_disponibles.length, 1);

    const line = detail.productos[0];
    assert.equal(line.producto_nombre_snapshot, 'Imperial 350 ml');
    assert.equal(line.cantidad_consumida, 3);
    assert.equal(line.cantidad_asignada, 0);
    assert.equal(line.cantidad_disponible, 3);
    assert.equal(line.estado_asignacion, 'disponible');
    assert.equal(line.aplica_servicio_snapshot, 1);
    assert.equal(line.porcentaje_servicio_snapshot, 10);
    assert.equal(line.servicio_unitario_snapshot, 100);
    assert.equal(detail.resumen_lineas.total_disponible, 3300);
});

test('una línea de cantidad 3 puede asignarse como 2 más 1', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const { service, account } = await createAccountWithQuantity(context, 3);

    let lines = await service.getConsumptionLines(account.id);
    lines = await service.assignAvailableQuantities(account.id, [{
        pedido_producto_id: lines[0].id,
        cantidad: 2,
        version: lines[0].version
    }]);
    assert.equal(lines[0].cantidad_asignada, 2);
    assert.equal(lines[0].cantidad_disponible, 1);
    assert.equal(lines[0].estado_asignacion, 'parcialmente_asignada');

    lines = await service.assignAvailableQuantities(account.id, [{
        pedido_producto_id: lines[0].id,
        cantidad: 1,
        version: lines[0].version
    }]);
    assert.equal(lines[0].cantidad_asignada, 3);
    assert.equal(lines[0].cantidad_disponible, 0);
    assert.equal(lines[0].estado_asignacion, 'asignada');

    const detail = await service.getAccount(account.id);
    assert.equal(detail.productos.length, 1, 'la línea permanece en historial');
    assert.equal(detail.productos_disponibles.length, 0, 'no aparece como consumo activo');
    assert.equal(detail.productos_asignados[0].cantidad_asignada, 3);
});

test('rechaza 2 más 2 sobre una línea de cantidad 3 sin aplicar cambios parciales', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const { service, account } = await createAccountWithQuantity(context, 3);
    const [line] = await service.getConsumptionLines(account.id);

    await assert.rejects(
        service.assignAvailableQuantities(account.id, [
            { pedido_producto_id: line.id, cantidad: 2 },
            { pedido_producto_id: line.id, cantidad: 2 }
        ]),
        error => error?.details?.code === 'CONSUMPTION_QUANTITY_EXCEEDED'
    );

    const [after] = await service.getConsumptionLines(account.id);
    assert.equal(after.cantidad_asignada, 0);
    assert.equal(after.cantidad_disponible, 3);
});

test('nuevo consumo no se consolida sobre una línea parcialmente asignada', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const { fixture, service, account } = await createAccountWithQuantity(context, 2);
    let [line] = await service.getConsumptionLines(account.id);

    await service.assignAvailableQuantities(account.id, [{
        pedido_producto_id: line.id,
        cantidad: 1,
        version: line.version
    }]);
    await service.addProducts(account.id, {
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 2 }]
    });

    const lines = await service.getConsumptionLines(account.id);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].cantidad_consumida, 2);
    assert.equal(lines[0].cantidad_asignada, 1);
    assert.equal(lines[1].cantidad_consumida, 2);
    assert.equal(lines[1].cantidad_asignada, 0);
    assert.equal(lines[1].cantidad_disponible, 2);
});

test('nuevo consumo sí se consolida cuando la línea sigue totalmente disponible', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const { fixture, service, account } = await createAccountWithQuantity(context, 1);

    await service.addProducts(account.id, {
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 2 }]
    });

    const lines = await service.getConsumptionLines(account.id);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].cantidad_consumida, 3);
    assert.equal(lines[0].cantidad_disponible, 3);
    assert.equal(lines[0].version, 2);
});

test('liberar una asignación restaura la cantidad disponible', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const { service, account } = await createAccountWithQuantity(context, 3);
    let [line] = await service.getConsumptionLines(account.id);

    [line] = await service.assignAvailableQuantities(account.id, [{
        pedido_producto_id: line.id,
        cantidad: 2,
        version: line.version
    }]);
    [line] = await service.releaseAssignedQuantities(account.id, [{
        pedido_producto_id: line.id,
        cantidad: 1,
        version: line.version
    }]);

    assert.equal(line.cantidad_asignada, 1);
    assert.equal(line.cantidad_disponible, 2);
});

test('la edición legacy queda bloqueada cuando una línea ya tiene cantidades asignadas', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const { fixture, service, account } = await createAccountWithQuantity(context, 2);
    const [line] = await service.getConsumptionLines(account.id);

    await service.assignAvailableQuantities(account.id, [{
        pedido_producto_id: line.id,
        cantidad: 1,
        version: line.version
    }]);

    await assert.rejects(
        service.getLegacyReplacementContext(account.id, fixture.product.id, fixture.replacement.id),
        error => error?.details?.code === 'CONSUMPTION_LINE_ALREADY_ASSIGNED'
    );
});

test('detecta versión obsoleta antes de reservar cantidades', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const { service, account } = await createAccountWithQuantity(context, 2);
    const [line] = await service.getConsumptionLines(account.id);

    await service.assignAvailableQuantities(account.id, [{
        pedido_producto_id: line.id,
        cantidad: 1,
        version: line.version
    }]);

    await assert.rejects(
        service.assignAvailableQuantities(account.id, [{
            pedido_producto_id: line.id,
            cantidad: 1,
            version: line.version
        }]),
        error => error?.details?.code === 'CONSUMPTION_LINE_VERSION_CONFLICT'
    );
});
