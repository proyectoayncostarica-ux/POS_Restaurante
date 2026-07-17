const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const { DocumentSequenceService } = require('../server/services/documentSequenceService');
const { PreinvoiceService } = require('../server/services/preinvoiceService');
const { PaymentService } = require('../server/services/paymentService');

async function seedPaymentMethods(db, quantity = 3) {
    await db.createTables();
    await db.migrateSchema();

    const now = '2026-07-17T14:00:00.000Z';
    const server = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Salonero medios', 'hash', 'basico', 1, ?)
    `, [now]);
    const cashier = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Caja medios', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero medios', 'salonero-medios', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Zona medios', 'zona-medios', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (93, 4, 'ocupada', 'zona-medios', 'mesa', ?, 1, 'Juan', ?, 3)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, server.id, role.id, server.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Categoría medios', NULL, 0, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id,
            subcategoria_id, es_cocina, activo
        ) VALUES ('Producto medios', 'Prueba', 1000, ?, NULL, 0, 1)
    `, [category.id]);

    const accountService = new AccountService({ db });
    const account = await accountService.createAccount({
        mesaId: seat.id,
        userId: server.id,
        productos: [{ producto_id: product.id, cantidad: quantity }],
        now
    });
    const sequenceService = new DocumentSequenceService({ db });
    const preinvoiceService = new PreinvoiceService({ db, accountService, sequenceService });
    const line = (await accountService.getAccount(account.id)).productos_disponibles[0];
    const preinvoice = await preinvoiceService.createPreinvoice({
        accountId: account.id,
        payerName: 'Pedro',
        issuedByUserId: server.id,
        type: 'completa',
        assignments: [{
            pedido_producto_id: line.id,
            cantidad: line.cantidad_disponible,
            version: line.version
        }],
        idempotencyKey: 'prefactura:medios:001',
        now: '2026-07-17T14:05:00.000Z'
    });
    const paymentService = new PaymentService({ db, accountService, sequenceService });

    return { server, cashier, account, preinvoice, paymentService };
}

test('efectivo registra monto recibido y vuelto sin aumentar el monto aplicado', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentMethods(context.db, 3);

    const result = await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: fixture.preinvoice.id,
        cashierUserId: fixture.cashier.id,
        amount: 3300,
        cashReceived: 5000,
        paymentMethod: 'efectivo',
        idempotencyKey: 'payment:cash-change:001'
    });

    assert.equal(result.pago.metodo_pago, 'efectivo');
    assert.equal(result.pago.monto, 3300);
    assert.equal(result.pago.monto_recibido, 5000);
    assert.equal(result.pago.vuelto, 1700);
    assert.equal(result.pago.medios_pago.length, 1);
    assert.deepEqual(result.pago.medios_pago[0], {
        ordinal: 1,
        tipo: 'efectivo',
        monto_aplicado: 3300,
        monto_recibido: 5000,
        vuelto: 1700,
        referencia: null
    });
    assert.equal(result.prefactura.saldo_pendiente, 0);
});

test('tarjeta exige referencia y no crea un pago parcial ante error', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentMethods(context.db, 2);

    await assert.rejects(
        fixture.paymentService.recordPreinvoicePayment({
            preinvoiceId: fixture.preinvoice.id,
            cashierUserId: fixture.cashier.id,
            amount: 1100,
            paymentMethod: 'tarjeta',
            idempotencyKey: 'payment:card:no-reference'
        }),
        error => error?.details?.code === 'CARD_REFERENCE_REQUIRED'
    );

    const count = await context.db.get('SELECT COUNT(*) AS total FROM pagos WHERE prefactura_id = ?', [fixture.preinvoice.id]);
    assert.equal(count.total, 0);
});

test('pago mixto persiste efectivo y tarjeta como una sola transacción financiera', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentMethods(context.db, 3);

    const result = await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: fixture.preinvoice.id,
        cashierUserId: fixture.cashier.id,
        paymentTenders: [
            {
                tipo: 'efectivo',
                monto_aplicado: 1000,
                monto_recibido: 2000
            },
            {
                tipo: 'tarjeta',
                monto_aplicado: 2300,
                referencia: 'AUTH-MIX-001'
            }
        ],
        idempotencyKey: 'payment:mixed:001'
    });

    assert.equal(result.pago.metodo_pago, 'mixto');
    assert.equal(result.pago.metodo_pago_legacy, 'efectivo');
    assert.equal(result.pago.monto, 3300);
    assert.equal(result.pago.monto_recibido, 4300);
    assert.equal(result.pago.vuelto, 1000);
    assert.equal(result.pago.medios_pago.length, 2);
    assert.equal(result.pago.medios_pago[0].tipo, 'efectivo');
    assert.equal(result.pago.medios_pago[1].tipo, 'tarjeta');
    assert.equal(result.pago.medios_pago[1].referencia, 'AUTH-MIX-001');

    const paymentRows = await context.db.get(`
        SELECT COUNT(*) AS pagos, COALESCE(SUM(monto), 0) AS total
        FROM pagos
        WHERE prefactura_id = ? AND estado = 'confirmado'
    `, [fixture.preinvoice.id]);
    assert.equal(paymentRows.pagos, 1);
    assert.equal(paymentRows.total, 3300);
});

test('el efectivo insuficiente y el total mixto mayor al saldo hacen rollback completo', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentMethods(context.db, 3);

    await assert.rejects(
        fixture.paymentService.recordPreinvoicePayment({
            preinvoiceId: fixture.preinvoice.id,
            cashierUserId: fixture.cashier.id,
            amount: 1100,
            cashReceived: 1000,
            paymentMethod: 'efectivo',
            idempotencyKey: 'payment:cash:insufficient'
        }),
        error => error?.details?.code === 'CASH_RECEIVED_INSUFFICIENT'
    );

    await assert.rejects(
        fixture.paymentService.recordPreinvoicePayment({
            preinvoiceId: fixture.preinvoice.id,
            cashierUserId: fixture.cashier.id,
            paymentTenders: [
                { tipo: 'efectivo', monto_aplicado: 2000, monto_recibido: 2000 },
                { tipo: 'tarjeta', monto_aplicado: 2000, referencia: 'AUTH-OVER' }
            ],
            idempotencyKey: 'payment:mixed:over'
        }),
        error => error?.details?.code === 'PAYMENT_EXCEEDS_PREINVOICE_BALANCE'
    );

    const counts = await context.db.get(`
        SELECT
            (SELECT COUNT(*) FROM pagos WHERE prefactura_id = ?) AS pagos,
            (SELECT COUNT(*) FROM pago_medios) AS medios
    `, [fixture.preinvoice.id]);
    assert.equal(counts.pagos, 0);
    assert.equal(counts.medios, 0);
});

test('idempotencia de pago mixto incluye montos recibidos, vuelto y referencias', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentMethods(context.db, 3);
    const request = {
        preinvoiceId: fixture.preinvoice.id,
        cashierUserId: fixture.cashier.id,
        paymentTenders: [
            { tipo: 'efectivo', monto_aplicado: 1000, monto_recibido: 2000 },
            { tipo: 'tarjeta', monto_aplicado: 1000, referencia: 'AUTH-IDEM' }
        ],
        idempotencyKey: 'payment:mixed:idem'
    };

    const first = await fixture.paymentService.recordPreinvoicePayment(request);
    const replay = await fixture.paymentService.recordPreinvoicePayment(request);
    assert.equal(replay.pago.id, first.pago.id);
    assert.equal(replay.idempotency_replay, true);

    await assert.rejects(
        fixture.paymentService.recordPreinvoicePayment({
            ...request,
            paymentTenders: [
                { tipo: 'efectivo', monto_aplicado: 1000, monto_recibido: 3000 },
                { tipo: 'tarjeta', monto_aplicado: 1000, referencia: 'AUTH-IDEM' }
            ]
        }),
        error => error?.code === 'IDEMPOTENCY_CONFLICT'
    );
});

test('migración crea un medio de pago para movimientos legacy existentes', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await context.db.createTables();
    await context.db.migrateSchema();

    const user = await context.db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Legacy Caja', 'hash', 'basico', 1, CURRENT_TIMESTAMP)
    `);
    const zone = await context.db.run(`
        INSERT INTO zonas (nombre, slug, activa, creado_en)
        VALUES ('Legacy zona medios', 'legacy-zona-medios', 1, CURRENT_TIMESTAMP)
    `);
    const seat = await context.db.run(`
        INSERT INTO mesas (numero, capacidad, estado, zona, tipo_asiento, zona_id, activo)
        VALUES (94, 4, 'ocupada', 'legacy-zona-medios', 'mesa', ?, 1)
    `, [zone.id]);
    const account = await context.db.run(`
        INSERT INTO pedidos (
            mesa_id, usuario_id, fecha, estado, total,
            aplica_servicio, porcentaje_servicio, total_con_servicio,
            numero_cuenta, estado_operativo, estado_financiero,
            total_pagado, saldo_pendiente, fecha_apertura, actualizado_en, version
        ) VALUES (?, ?, CURRENT_TIMESTAMP, 'pendiente', 1000, 0, 0, 1000,
                  'CTA-90000001', 'abierta', 'parcial', 1000, 0,
                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
    `, [seat.id, user.id]);
    const payment = await context.db.run(`
        INSERT INTO pagos (
            pedido_id, estado, metodo_pago, monto, subtotal, servicio,
            fecha, version, creado_en, actualizado_en
        ) VALUES (?, 'confirmado', 'tarjeta', 1000, 1000, 0,
                  CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [account.id]);

    await context.db.migrateSchema();

    const tender = await context.db.get('SELECT * FROM pago_medios WHERE pago_id = ?', [payment.id]);
    assert.equal(tender.tipo, 'tarjeta');
    assert.equal(tender.monto_aplicado, 1000);
    assert.equal(tender.monto_recibido, 1000);
    assert.equal(tender.vuelto, 0);

    const migrated = await context.db.get('SELECT metodo_pago_v3, monto_recibido, vuelto FROM pagos WHERE id = ?', [payment.id]);
    assert.equal(migrated.metodo_pago_v3, 'tarjeta');
    assert.equal(migrated.monto_recibido, 1000);
    assert.equal(migrated.vuelto, 0);
});
