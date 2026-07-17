const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');

async function seedAccountDomain(db) {
    await db.createTables();
    await db.migrateSchema();

    const now = new Date().toISOString();
    const user = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Andrey', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (nombre, slug, descripcion, activo, requiere_zona, es_sistema, destino_inicial, creado_en)
        VALUES ('Salonero', 'salonero-test', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (nombre, slug, orden, aplica_servicio, porcentaje_servicio, activa, creado_en)
        VALUES ('Terraza Test', 'terraza-test', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (91, 4, 'ocupada', 'terraza-test', 'mesa', ?, 1, 'Juan', ?, 2)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id, asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, user.id, role.id, user.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Bebidas Test', NULL, 0, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id, subcategoria_id,
            es_cocina, activo
        ) VALUES ('Refresco Test', 'Producto de prueba', 1000, ?, NULL, 0, 1)
    `, [category.id]);

    return { user, role, zone, seat, category, product, now };
}

test('crea una cuenta global con número, snapshots y saldo canónico', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedAccountDomain(context.db);
    const service = new AccountService({ db: context.db });

    const created = await service.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 2 }],
        now: fixture.now
    });

    assert.match(created.numero_cuenta, /^CTA-\d{8}$/);
    assert.equal(created.subtotal, 2000);
    assert.equal(created.monto_servicio, 200);
    assert.equal(created.total_con_servicio, 2200);
    assert.equal(created.total_pagado, 0);
    assert.equal(created.saldo_pendiente, 2200);
    assert.equal(created.estado_operativo, 'abierta');
    assert.equal(created.estado_financiero, 'sin_documentos');

    const account = await service.getAccount(created.id);
    assert.equal(account.cliente_principal, 'Juan');
    assert.equal(account.mesa_numero, 91);
    assert.equal(account.zona_nombre, 'Terraza Test');
    assert.equal(account.responsables.length, 1);
    assert.equal(account.responsables[0].usuario_nombre, 'Andrey');
    assert.equal(account.productos.length, 1);
});

test('consultar una cuenta no actualiza versión ni timestamps', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedAccountDomain(context.db);
    const service = new AccountService({ db: context.db });
    const created = await service.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 1 }],
        now: fixture.now
    });

    const before = await context.db.get('SELECT version, actualizado_en FROM pedidos WHERE id = ?', [created.id]);
    await service.getAccount(created.id);
    await service.getAccount(created.id);
    const after = await context.db.get('SELECT version, actualizado_en FROM pedidos WHERE id = ?', [created.id]);

    assert.deepEqual(after, before);
});

test('agregar consumo actualiza total global sin alterar cliente ni responsables', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedAccountDomain(context.db);
    const service = new AccountService({ db: context.db });
    const created = await service.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 1 }],
        now: fixture.now
    });

    const result = await service.addProducts(created.id, {
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 2 }]
    });

    assert.equal(result.subtotal, 3000);
    assert.equal(result.total_con_servicio, 3300);
    assert.equal(result.saldo_pendiente, 3300);

    const account = await service.getAccount(created.id);
    assert.equal(account.cliente_principal, 'Juan');
    assert.equal(account.responsables[0].usuario_nombre, 'Andrey');
    assert.equal(account.productos[0].cantidad, 3);
});

test('un pago parcial modifica solo el estado financiero y mantiene la cuenta abierta', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedAccountDomain(context.db);
    const service = new AccountService({ db: context.db });
    const created = await service.createAccount({
        mesaId: fixture.seat.id,
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 2 }],
        now: fixture.now
    });

    await context.db.run(`
        INSERT INTO pagos (pedido_id, metodo_pago, monto, subtotal, servicio, fecha)
        VALUES (?, 'efectivo', 1100, 1000, 100, ?)
    `, [created.id, new Date().toISOString()]);
    const totals = await service.synchronizeAccount(created.id);

    assert.equal(totals.total_pagado, 1100);
    assert.equal(totals.saldo_pendiente, 1100);
    assert.equal(totals.estado_financiero, 'parcial');
    assert.equal(totals.estado_operativo, 'abierta');

    const seat = await context.db.get('SELECT estado FROM mesas WHERE id = ?', [fixture.seat.id]);
    assert.equal(seat.estado, 'ocupada');
});

test('la creación completa se revierte si una escritura posterior falla', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedAccountDomain(context.db);
    const service = new AccountService({ db: context.db });

    await context.db.run(`CREATE TRIGGER fail_account_product
        BEFORE INSERT ON pedido_productos
        BEGIN
            SELECT RAISE(ABORT, 'fallo controlado');
        END`);

    await assert.rejects(
        service.createAccount({
            mesaId: fixture.seat.id,
            userId: fixture.user.id,
            productos: [{ producto_id: fixture.product.id, cantidad: 1 }]
        }),
        /fallo controlado/
    );

    const accountCount = await context.db.get('SELECT COUNT(*) AS total FROM pedidos');
    const snapshotCount = await context.db.get('SELECT COUNT(*) AS total FROM cuenta_responsables');
    assert.equal(accountCount.total, 0);
    assert.equal(snapshotCount.total, 0);
});
