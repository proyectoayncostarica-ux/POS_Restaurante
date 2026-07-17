const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const { DocumentSequenceService } = require('../server/services/documentSequenceService');
const { PreinvoiceService } = require('../server/services/preinvoiceService');
const {
    PaymentService,
    PAYMENT_STATES
} = require('../server/services/paymentService');
const { FinancialReadService } = require('../server/services/financialReadService');

async function seedPaymentDomain(db, quantity = 3) {
    await db.createTables();
    await db.migrateSchema();

    const now = '2026-07-16T15:00:00.000Z';
    const server = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Andrey', 'hash', 'basico', 1, ?)
    `, [now]);
    const cashier = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Caja Uno', 'hash', 'basico', 1, ?)
    `, [now]);
    const supervisor = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Supervisor', 'hash', 'administrador', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero pagos', 'salonero-pagos', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Zona pagos', 'zona-pagos', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (92, 4, 'ocupada', 'zona-pagos', 'mesa', ?, 1, 'Juan', ?, 3)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, server.id, role.id, server.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Categoría pagos', NULL, 0, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id,
            subcategoria_id, es_cocina, activo
        ) VALUES ('Imperial pagos', 'Cerveza', 1000, ?, NULL, 0, 1)
    `, [category.id]);

    const accountService = new AccountService({ db });
    const account = await accountService.createAccount({
        mesaId: seat.id,
        userId: server.id,
        productos: [{ producto_id: product.id, cantidad: quantity }],
        now
    });
    const sequenceService = new DocumentSequenceService({ db });
    const preinvoiceService = new PreinvoiceService({
        db,
        accountService,
        sequenceService
    });
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
        idempotencyKey: 'prefactura:pago:001',
        now: '2026-07-16T15:05:00.000Z'
    });
    const paymentService = new PaymentService({
        db,
        accountService,
        sequenceService
    });
    const financialReadService = new FinancialReadService({ db, accountService });

    return {
        now,
        server,
        cashier,
        supervisor,
        role,
        zone,
        seat,
        account,
        preinvoice,
        accountService,
        preinvoiceService,
        paymentService,
        financialReadService
    };
}

test('registra un pago confirmado vinculado a prefactura, cajero y cuenta global', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentDomain(context.db, 3);

    const result = await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: fixture.preinvoice.id,
        cashierUserId: fixture.cashier.id,
        amount: 3300,
        paymentMethod: 'efectivo',
        idempotencyKey: 'payment:create:001',
        now: '2026-07-16T15:10:00.000Z'
    });

    assert.equal(result.pago.numero_pago, 'PG-00000001');
    assert.equal(result.pago.prefactura_id, fixture.preinvoice.id);
    assert.equal(result.pago.estado, PAYMENT_STATES.CONFIRMED);
    assert.equal(result.pago.cajero_nombre_snapshot, 'Caja Uno');
    assert.equal(result.pago.pagador_nombre_snapshot, 'Pedro');
    assert.equal(result.pago.componentes.length, 2);
    assert.equal(result.prefactura.estado, 'pagada');
    assert.equal(result.prefactura.saldo_pendiente, 0);
    assert.equal(result.cuenta_global.estado_financiero, 'conciliada');
    assert.equal(result.cuenta_global.estado_operativo, 'abierta');
    assert.equal(result.servicio_activo, true);
    assert.equal(result.mesa_liberada, false);

    const seat = await context.db.get('SELECT estado, cliente_nombre FROM mesas WHERE id = ?', [fixture.seat.id]);
    assert.equal(seat.estado, 'ocupada');
    assert.equal(seat.cliente_nombre, 'Juan');
});

test('un pago parcial actualiza solo el saldo de la prefactura y mantiene la cuenta abierta', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentDomain(context.db, 3);

    const result = await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: fixture.preinvoice.id,
        cashierUserId: fixture.cashier.id,
        amount: 1100,
        paymentMethod: 'tarjeta',
        reference: 'AUTH-123',
        idempotencyKey: 'payment:partial:001'
    });

    assert.equal(result.prefactura.estado, 'parcial');
    assert.equal(result.prefactura.total_pagado, 1100);
    assert.equal(result.prefactura.saldo_pendiente, 2200);
    assert.equal(result.cuenta_global.estado_financiero, 'parcial');
    assert.equal(result.cuenta_global.saldo_pendiente, 2200);
    assert.equal(result.pago.referencia, 'AUTH-123');
});

test('la idempotencia devuelve el mismo pago y rechaza datos diferentes', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentDomain(context.db, 3);
    const request = {
        preinvoiceId: fixture.preinvoice.id,
        cashierUserId: fixture.cashier.id,
        amount: 1100,
        paymentMethod: 'efectivo',
        idempotencyKey: 'payment:retry:001'
    };

    const first = await fixture.paymentService.recordPreinvoicePayment(request);
    const replay = await fixture.paymentService.recordPreinvoicePayment(request);
    assert.equal(replay.pago.id, first.pago.id);
    assert.equal(replay.idempotency_replay, true);

    const count = await context.db.get('SELECT COUNT(*) AS total FROM pagos WHERE prefactura_id = ?', [fixture.preinvoice.id]);
    assert.equal(count.total, 1);

    await assert.rejects(
        fixture.paymentService.recordPreinvoicePayment({ ...request, amount: 1000 }),
        error => error?.code === 'IDEMPOTENCY_CONFLICT'
    );
});

test('impide sobrepago sin crear movimientos parciales', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentDomain(context.db, 3);

    await assert.rejects(
        fixture.paymentService.recordPreinvoicePayment({
            preinvoiceId: fixture.preinvoice.id,
            cashierUserId: fixture.cashier.id,
            amount: 3300.01,
            paymentMethod: 'efectivo',
            idempotencyKey: 'payment:over:001'
        }),
        error => error?.details?.code === 'PAYMENT_EXCEEDS_PREINVOICE_BALANCE'
    );

    const count = await context.db.get('SELECT COUNT(*) AS total FROM pagos WHERE prefactura_id = ?', [fixture.preinvoice.id]);
    assert.equal(count.total, 0);
    const document = await context.db.get('SELECT estado, total_pagado, saldo_pendiente FROM prefacturas WHERE id = ?', [fixture.preinvoice.id]);
    assert.equal(document.estado, 'emitida');
    assert.equal(document.total_pagado, 0);
    assert.equal(document.saldo_pendiente, 3300);
});

test('dos cobros concurrentes no pueden liquidar dos veces el mismo saldo', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentDomain(context.db, 3);

    const attempts = await Promise.allSettled([
        fixture.paymentService.recordPreinvoicePayment({
            preinvoiceId: fixture.preinvoice.id,
            cashierUserId: fixture.cashier.id,
            amount: 3300,
            paymentMethod: 'efectivo',
            idempotencyKey: 'payment:concurrent:001'
        }),
        fixture.paymentService.recordPreinvoicePayment({
            preinvoiceId: fixture.preinvoice.id,
            cashierUserId: fixture.cashier.id,
            amount: 3300,
            paymentMethod: 'tarjeta',
            idempotencyKey: 'payment:concurrent:002'
        })
    ]);

    assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(item => item.status === 'rejected').length, 1);
    const payments = await context.db.get(`
        SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto), 0) AS total
        FROM pagos
        WHERE prefactura_id = ? AND estado = 'confirmado'
    `, [fixture.preinvoice.id]);
    assert.equal(payments.cantidad, 1);
    assert.equal(payments.total, 3300);
});

test('anular un pago restaura saldos sin cerrar ni liberar la mesa', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentDomain(context.db, 3);
    const paid = await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: fixture.preinvoice.id,
        cashierUserId: fixture.cashier.id,
        amount: 3300,
        paymentMethod: 'efectivo',
        idempotencyKey: 'payment:void-source:001'
    });

    const reversed = await fixture.paymentService.voidPayment({
        paymentId: paid.pago.id,
        userId: fixture.supervisor.id,
        reason: 'Cobro registrado en la cuenta equivocada',
        idempotencyKey: 'payment:void:001',
        now: '2026-07-16T15:20:00.000Z'
    });

    assert.equal(reversed.pago.estado, 'anulado');
    assert.ok(reversed.pago.reverso);
    assert.equal(reversed.prefactura.estado, 'emitida');
    assert.equal(reversed.prefactura.total_pagado, 0);
    assert.equal(reversed.prefactura.saldo_pendiente, 3300);
    assert.equal(reversed.cuenta_global.estado_financiero, 'pendiente');
    assert.equal(reversed.cuenta_global.estado_operativo, 'abierta');

    const replay = await fixture.paymentService.voidPayment({
        paymentId: paid.pago.id,
        userId: fixture.supervisor.id,
        reason: 'Cobro registrado en la cuenta equivocada',
        idempotencyKey: 'payment:void:001'
    });
    assert.equal(replay.pago.id, paid.pago.id);
    assert.equal(replay.idempotency_replay, true);
});

test('la lectura financiera contabiliza solo pagos confirmados y enlaza documento y cajero', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPaymentDomain(context.db, 3);
    const first = await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: fixture.preinvoice.id,
        cashierUserId: fixture.cashier.id,
        amount: 1100,
        paymentMethod: 'tarjeta',
        idempotencyKey: 'payment:read:001'
    });
    await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: fixture.preinvoice.id,
        cashierUserId: fixture.cashier.id,
        amount: 2200,
        paymentMethod: 'efectivo',
        idempotencyKey: 'payment:read:002'
    });
    await fixture.paymentService.voidPayment({
        paymentId: first.pago.id,
        userId: fixture.supervisor.id,
        reason: 'Reverso de prueba financiera',
        idempotencyKey: 'payment:read:void:001'
    });

    const movements = await fixture.financialReadService.listCashMovements({
        accountId: fixture.account.id,
        limit: null
    });
    assert.equal(movements.length, 1);
    assert.equal(movements[0].monto, 2200);
    assert.equal(movements[0].prefactura_id, fixture.preinvoice.id);
    assert.equal(movements[0].numero_documento, fixture.preinvoice.numero_documento);
    assert.equal(movements[0].pagador_nombre, 'Pedro');
    assert.equal(movements[0].cajero_nombre, 'Caja Uno');
    assert.equal(movements[0].vinculo_documental, 'paymentservice');
});
