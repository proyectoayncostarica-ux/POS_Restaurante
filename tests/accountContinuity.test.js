const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const { DocumentSequenceService } = require('../server/services/documentSequenceService');
const { PreinvoiceService } = require('../server/services/preinvoiceService');

async function seedContinuityDomain(db, quantity = 3) {
    await db.createTables();
    await db.migrateSchema();

    const now = '2026-07-16T17:00:00.000Z';
    const user = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Andrey', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero continuidad', 'salonero-continuidad', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Zona continuidad', 'zona-continuidad', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (92, 6, 'ocupada', 'zona-continuidad', 'mesa', ?, 1, 'Juan', ?, 4)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, user.id, role.id, user.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Continuidad', NULL, 0, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id,
            subcategoria_id, es_cocina, activo
        ) VALUES ('Imperial continuidad', 'Prueba', 1000, ?, NULL, 0, 1)
    `, [category.id]);

    const accountService = new AccountService({ db });
    const account = await accountService.createAccount({
        mesaId: seat.id,
        userId: user.id,
        productos: [{ producto_id: product.id, cantidad: quantity }],
        now
    });
    const sequenceService = new DocumentSequenceService({ db });
    const preinvoiceService = new PreinvoiceService({ db, accountService, sequenceService });

    return {
        now,
        user,
        role,
        zone,
        seat,
        product,
        account,
        accountService,
        preinvoiceService
    };
}

async function issuePreinvoice(fixture, quantity, payerName = 'Pedro', type = 'dividida') {
    const account = await fixture.accountService.getAccount(fixture.account.id);
    const line = account.productos_disponibles[0];
    return fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName,
        issuedByUserId: fixture.user.id,
        type,
        assignments: [{
            pedido_producto_id: line.id,
            cantidad: quantity,
            version: line.version
        }]
    });
}

async function markPreinvoicePaid(db, accountService, document, method = 'efectivo') {
    const now = '2026-07-16T17:15:00.000Z';
    await db.run(`
        UPDATE prefacturas
        SET estado = 'pagada', total_pagado = total, saldo_pendiente = 0,
            fecha_pago = ?, actualizado_en = ?, version = version + 1
        WHERE id = ?
    `, [now, now, document.id]);
    await db.run(`
        INSERT INTO pagos (
            pedido_id, metodo_pago, monto, subtotal, servicio,
            porcentaje_servicio, aplica_servicio, fecha
        ) VALUES (?, ?, ?, ?, ?, 10, 1, ?)
    `, [document.pedido_id, method, document.total, document.subtotal, document.servicio, now]);
    return accountService.synchronizeAccount(document.pedido_id, db, { now });
}

test('una prefactura pagada sale del consumo activo y la mesa continúa recibiendo productos', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedContinuityDomain(context.db, 3);
    const document = await issuePreinvoice(fixture, 2);
    await markPreinvoicePaid(context.db, fixture.accountService, document);

    let account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.estado_operativo, 'abierta');
    assert.equal(account.estado_financiero, 'parcial');
    assert.equal(account.productos_disponibles[0].cantidad, 1);
    assert.equal(account.productos_pagados[0].cantidad, 2);
    assert.equal(account.productos_documentados_pendientes.length, 0);
    assert.equal(account.continuidad_operativa.servicio_activo, true);

    await fixture.accountService.addProducts(fixture.account.id, {
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 2 }],
        now: '2026-07-16T17:20:00.000Z'
    });

    account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.total_con_servicio, 5500);
    assert.equal(account.total_pagado, 2200);
    assert.equal(account.saldo_pendiente, 3300);
    assert.equal(account.estado_financiero, 'parcial');
    assert.equal(account.productos.length, 2, 'el nuevo consumo no se mezcla con la línea documentada');
    assert.equal(account.productos_disponibles.reduce((sum, item) => sum + item.cantidad, 0), 3);
    assert.equal(account.productos_pagados.reduce((sum, item) => sum + item.cantidad, 0), 2);
    assert.equal(account.responsables[0].usuario_nombre, 'Andrey');

    const seat = await context.db.get('SELECT estado, cliente_nombre FROM mesas WHERE id = ?', [fixture.seat.id]);
    assert.equal(seat.estado, 'ocupada');
    assert.equal(seat.cliente_nombre, 'Juan');
});

test('saldo temporal cero no cierra el servicio y un consumo nuevo reactiva el saldo', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedContinuityDomain(context.db, 2);
    const document = await issuePreinvoice(fixture, 2, 'Juan', 'completa');
    await markPreinvoicePaid(context.db, fixture.accountService, document, 'tarjeta');

    let account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.saldo_pendiente, 0);
    assert.equal(account.estado_financiero, 'conciliada');
    assert.equal(account.estado_operativo, 'abierta');
    assert.equal(account.continuidad_operativa.saldo_temporal_cero, true);
    assert.equal(account.continuidad_operativa.requiere_finalizacion_explicita, true);
    assert.equal(account.productos_disponibles.length, 0);
    assert.equal(account.productos_pagados[0].cantidad, 2);

    await fixture.accountService.addProducts(fixture.account.id, {
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 1 }]
    });

    account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.total_con_servicio, 3300);
    assert.equal(account.total_pagado, 2200);
    assert.equal(account.saldo_pendiente, 1100);
    assert.equal(account.estado_financiero, 'parcial');
    assert.equal(account.continuidad_operativa.saldo_temporal_cero, false);
    assert.equal(account.productos_disponibles[0].cantidad, 1);

    const seat = await context.db.get('SELECT estado FROM mesas WHERE id = ?', [fixture.seat.id]);
    assert.equal(seat.estado, 'ocupada');
});

test('dos liquidaciones documentales consecutivas mantienen el servicio abierto', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedContinuityDomain(context.db, 2);

    const firstDocument = await issuePreinvoice(fixture, 2, 'Juan', 'completa');
    await markPreinvoicePaid(context.db, fixture.accountService, firstDocument, 'efectivo');

    let account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.saldo_pendiente, 0);
    assert.equal(account.estado_operativo, 'abierta');

    await fixture.accountService.addProducts(fixture.account.id, {
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 1 }]
    });

    account = await fixture.accountService.getAccount(fixture.account.id);
    const availableLine = account.productos_disponibles[0];
    const secondDocument = await fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName: 'Juan',
        issuedByUserId: fixture.user.id,
        type: 'completa',
        assignments: [{
            pedido_producto_id: availableLine.id,
            cantidad: 1,
            version: availableLine.version
        }]
    });
    await markPreinvoicePaid(context.db, fixture.accountService, secondDocument, 'tarjeta');

    account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.total_pagado, 3300);
    assert.equal(account.saldo_pendiente, 0);
    assert.equal(account.estado_operativo, 'abierta');

    const payments = await context.db.all('SELECT monto FROM pagos WHERE pedido_id = ? ORDER BY id', [fixture.account.id]);
    assert.deepEqual(payments.map(item => item.monto), [2200, 1100]);
    const seat = await context.db.get('SELECT estado FROM mesas WHERE id = ?', [fixture.seat.id]);
    assert.equal(seat.estado, 'ocupada');
});

test('la UI documenta consumo activo, pendiente, liquidado y cierre explícito', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../public/js/components/orders.js'),
        'utf8'
    );
    assert.match(source, /Consumo documentado pendiente de cobro/);
    assert.match(source, /Historial de consumo liquidado/);
    assert.match(source, /servicio continúa abierto/);
    assert.match(source, /mesa permanece ocupada hasta finalizar el servicio/);
    assert.match(source, /pendingGlobalBalance > 0/);
});
