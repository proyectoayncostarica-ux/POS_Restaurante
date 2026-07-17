const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const { DocumentSequenceService } = require('../server/services/documentSequenceService');
const { PreinvoiceService } = require('../server/services/preinvoiceService');
const { PaymentService } = require('../server/services/paymentService');
const { FinancialReadService } = require('../server/services/financialReadService');

function loadCreditServiceClass() {
    const originalLoad = Module._load;
    const fallback = require('./helpers/bcryptFallback');
    Module._load = function patched(request, parent, isMain) {
        if (request === 'bcryptjs') return fallback;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[require.resolve('../server/services/creditService')];
        return require('../server/services/creditService').CreditService;
    } finally {
        Module._load = originalLoad;
    }
}

const CreditService = loadCreditServiceClass();
const bcryptFallback = require('./helpers/bcryptFallback');

async function seedCreditDomain(db) {
    await db.createTables();
    await db.migrateSchema();
    const now = '2026-07-17T16:00:00.000Z';
    const salonero = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Andrey', 'hash', 'basico', 1, ?)
    `, [now]);
    const cashier = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Caja Crédito', 'hash', 'basico', 1, ?)
    `, [now]);
    const admin = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Administrador', 'clave-admin', 'administrador', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (nombre, slug, descripcion, activo, requiere_zona, es_sistema, destino_inicial, creado_en)
        VALUES ('Salonero crédito', 'salonero-credito', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (nombre, slug, orden, aplica_servicio, porcentaje_servicio, activa, creado_en)
        VALUES ('Salón crédito', 'salon-credito', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (numero, capacidad, estado, zona, tipo_asiento, zona_id, activo, cliente_nombre, fecha_apertura, cantidad_personas)
        VALUES (94, 4, 'ocupada', 'salon-credito', 'mesa', ?, 1, 'Juan', ?, 3)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (mesa_id, usuario_id, rol_trabajo_id, asignado_por_usuario_id, fecha_asignacion)
        VALUES (?, ?, ?, ?, ?)
    `, [seat.id, salonero.id, role.id, salonero.id, now]);
    const category = await db.run(`INSERT INTO categorias (nombre, parent_id, permite_cocina, activa) VALUES ('Crédito', NULL, 0, 1)`);
    const product = await db.run(`
        INSERT INTO productos (nombre, descripcion, precio, categoria_id, subcategoria_id, es_cocina, activo)
        VALUES ('Consumo crédito', 'Prueba', 1000, ?, NULL, 0, 1)
    `, [category.id]);

    const accountService = new AccountService({ db });
    const account = await accountService.createAccount({
        mesaId: seat.id,
        userId: salonero.id,
        productos: [{ producto_id: product.id, cantidad: 3 }],
        now
    });
    const sequenceService = new DocumentSequenceService({ db });
    const preinvoiceService = new PreinvoiceService({ db, accountService, sequenceService });
    const line = (await accountService.getAccount(account.id)).productos_disponibles[0];
    const preinvoice = await preinvoiceService.createPreinvoice({
        accountId: account.id,
        payerName: 'Pedro',
        issuedByUserId: salonero.id,
        type: 'completa',
        assignments: [{ pedido_producto_id: line.id, cantidad: line.cantidad_disponible, version: line.version }],
        idempotencyKey: 'prefactura:credito:001',
        now: '2026-07-17T16:05:00.000Z'
    });
    const paymentService = new PaymentService({ db, accountService, sequenceService });
    const creditService = new CreditService({ db, accountService, paymentService, sequenceService, bcrypt: bcryptFallback });
    const financialReadService = new FinancialReadService({ db, accountService });
    return { salonero, cashier, admin, seat, account, preinvoice, accountService, paymentService, creditService, financialReadService };
}

async function openCredit(fixture, overrides = {}) {
    return fixture.creditService.formalizePreinvoiceCredit({
        preinvoiceId: fixture.preinvoice.id,
        operatorUserId: fixture.cashier.id,
        adminPassword: 'clave-admin',
        observation: 'Cliente autorizado por administración',
        idempotencyKey: 'credit:create:001',
        now: '2026-07-17T16:10:00.000Z',
        ...overrides
    });
}

test('formaliza crédito por prefactura sin duplicar venta ni liberar mesa', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCreditDomain(context.db);
    const credit = await openCredit(fixture);

    assert.equal(credit.numero_credito, 'CR-00000001');
    assert.equal(credit.monto_original, 3300);
    assert.equal(credit.saldo_pendiente, 3300);
    assert.equal(credit.pago_apertura.metodo_pago, 'credito');
    assert.equal(credit.pago_apertura.naturaleza, 'liquidacion_venta');

    const document = await context.db.get('SELECT estado, saldo_pendiente FROM prefacturas WHERE id = ?', [fixture.preinvoice.id]);
    assert.equal(document.estado, 'pagada');
    assert.equal(document.saldo_pendiente, 0);
    const account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.estado_financiero, 'credito');
    assert.equal(account.estado_operativo, 'abierta');
    const seat = await context.db.get('SELECT estado, cliente_nombre FROM mesas WHERE id = ?', [fixture.seat.id]);
    assert.equal(seat.estado, 'ocupada');
    assert.equal(seat.cliente_nombre, 'Juan');

    const sales = await fixture.financialReadService.listConsolidatedSales({ limit: null });
    assert.equal(sales.length, 1);
    assert.equal(sales[0].total_global, 3300);
    assert.equal(sales[0].venta_a_credito, true);
    const movements = await fixture.financialReadService.listCashMovements({ limit: null });
    assert.equal(movements.length, 0);
});

test('abonos de crédito pasan por Payments y no incrementan de nuevo la cuenta global', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCreditDomain(context.db);
    const credit = await openCredit(fixture);

    const payment = await fixture.creditService.recordPayment({
        creditId: credit.id,
        cashierUserId: fixture.cashier.id,
        paymentTenders: [
            { tipo: 'efectivo', monto_aplicado: 1000, monto_recibido: 2000 },
            { tipo: 'tarjeta', monto_aplicado: 1000, referencia: 'AUTH-CRED-1' }
        ],
        idempotencyKey: 'credit:payment:001',
        now: '2026-07-17T16:20:00.000Z'
    });

    assert.equal(payment.pago.naturaleza, 'cobro_credito');
    assert.equal(payment.pago.metodo_pago, 'mixto');
    assert.equal(payment.pago.monto, 2000);
    assert.equal(payment.pago.vuelto, 1000);
    assert.equal(payment.credito.estado, 'parcial');
    assert.equal(payment.credito.saldo_pendiente, 1300);

    const account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.total_pagado, 3300);
    assert.equal(account.estado_financiero, 'credito');
    const movements = await fixture.financialReadService.listCashMovements({ limit: null });
    assert.equal(movements.length, 1);
    assert.equal(movements[0].monto, 2000);
    assert.equal(movements[0].naturaleza, 'cobro_credito');
});

test('el abono final salda crédito pero mantiene servicio y mesa activos', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCreditDomain(context.db);
    const credit = await openCredit(fixture);
    const result = await fixture.creditService.recordPayment({
        creditId: credit.id,
        cashierUserId: fixture.cashier.id,
        amount: 3300,
        paymentMethod: 'tarjeta',
        reference: 'AUTH-FINAL',
        idempotencyKey: 'credit:payment:final'
    });
    assert.equal(result.credito.estado, 'saldado');
    assert.equal(result.credito.saldo_pendiente, 0);
    assert.equal(result.cuenta_global.estado_financiero, 'conciliada');
    assert.equal(result.cuenta_global.estado_operativo, 'abierta');
    const seat = await context.db.get('SELECT estado FROM mesas WHERE id = ?', [fixture.seat.id]);
    assert.equal(seat.estado, 'ocupada');
});

test('autorización inválida e idempotencia protegen la formalización', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCreditDomain(context.db);
    await assert.rejects(
        openCredit(fixture, { adminPassword: 'incorrecta', idempotencyKey: 'credit:create:bad' }),
        error => error?.status === 403
    );
    assert.equal((await context.db.get('SELECT COUNT(*) AS total FROM cuentas_credito')).total, 0);
    assert.equal((await context.db.get("SELECT COUNT(*) AS total FROM pagos WHERE metodo_pago_v3 = 'credito'")).total, 0);

    const first = await openCredit(fixture);
    const replay = await openCredit(fixture);
    assert.equal(replay.id, first.id);
    assert.equal(replay.idempotency_replay, true);
    assert.equal((await context.db.get('SELECT COUNT(*) AS total FROM cuentas_credito')).total, 1);
});

test('reversar un abono restaura deuda sin alterar la venta global', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCreditDomain(context.db);
    const credit = await openCredit(fixture);
    const payment = await fixture.creditService.recordPayment({
        creditId: credit.id,
        cashierUserId: fixture.cashier.id,
        amount: 1000,
        paymentMethod: 'efectivo',
        cashReceived: 1000,
        idempotencyKey: 'credit:payment:void'
    });
    const reversed = await fixture.paymentService.voidPayment({
        paymentId: payment.pago.id,
        userId: fixture.admin.id,
        reason: 'Abono registrado por error',
        idempotencyKey: 'credit:void:001'
    });
    assert.equal(reversed.pago.estado, 'anulado');
    assert.equal(reversed.credito.saldo_pendiente, 3300);
    assert.equal(reversed.cuenta_global.total_pagado, 3300);
    assert.equal(reversed.cuenta_global.estado_financiero, 'credito');
});
