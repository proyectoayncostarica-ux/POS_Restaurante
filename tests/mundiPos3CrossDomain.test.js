const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const { DocumentSequenceService } = require('../server/services/documentSequenceService');
const { PreinvoiceService } = require('../server/services/preinvoiceService');
const { PaymentService } = require('../server/services/paymentService');
const { FinancialReadService } = require('../server/services/financialReadService');
const { DashboardReportService } = require('../server/services/dashboardReportService');
const { ServiceFinalizationService } = require('../server/services/serviceFinalizationService');
const {
    PrintingService,
    PRINT_JOB_STATES
} = require('../server/services/printingService');
const {
    KitchenService,
    KITCHEN_OPERATIONAL_STATES,
    KITCHEN_PRINT_STATES
} = require('../server/services/kitchenService');

function loadCreditServiceClass() {
    const originalLoad = Module._load;
    const bcryptFallback = require('./helpers/bcryptFallback');
    Module._load = function loadWithBcryptFallback(request, parent, isMain) {
        if (request === 'bcryptjs') return bcryptFallback;
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

async function seedCoreDomain(db, options = {}) {
    await db.createTables();
    await db.migrateSchema();

    const now = options.now || '2026-07-18T10:00:00.000Z';
    const waiter = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Salonero Cierre 3.0', 'hash', 'basico', 1, ?)
    `, [now]);
    const cashier = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Caja Cierre 3.0', 'hash', 'basico', 1, ?)
    `, [now]);
    const admin = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Admin Cierre 3.0', 'clave-admin', 'administrador', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero cierre 3.0', 'salonero-cierre-3-0', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Zona cierre 3.0', 'zona-cierre-3-0', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (370, 6, 'ocupada', 'zona-cierre-3-0', 'mesa', ?, 1, 'Cliente Cierre', ?, 4)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, waiter.id, role.id, waiter.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Cierre 3.0', NULL, 0, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id,
            subcategoria_id, es_cocina, destino_preparacion, activo
        ) VALUES ('Producto cierre 3.0', 'Prueba cruzada', 1000, ?, NULL, 0, 'ninguno', 1)
    `, [category.id]);

    const accountService = new AccountService({ db });
    const sequenceService = new DocumentSequenceService({ db });
    const preinvoiceService = new PreinvoiceService({ db, accountService, sequenceService });
    const paymentService = new PaymentService({ db, accountService, sequenceService });
    const financialReadService = new FinancialReadService({ db, accountService });
    const reportService = new DashboardReportService({ db, financialReadService });
    const finalizationService = new ServiceFinalizationService({ db, accountService });

    const account = await accountService.createAccount({
        mesaId: seat.id,
        userId: waiter.id,
        productos: [{ producto_id: product.id, cantidad: options.quantity || 3 }],
        now
    });

    return {
        now,
        waiter,
        cashier,
        admin,
        role,
        zone,
        seat,
        category,
        product,
        account,
        accountService,
        sequenceService,
        preinvoiceService,
        paymentService,
        financialReadService,
        reportService,
        finalizationService
    };
}

async function createPreinvoiceForAvailable(fixture, quantity, options = {}) {
    const account = await fixture.accountService.getAccount(fixture.account.id);
    const available = account.productos_disponibles;
    let remaining = quantity;
    const assignments = [];

    for (const line of available) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(line.cantidad_disponible ?? line.cantidad));
        if (take <= 0) continue;
        assignments.push({
            pedido_producto_id: line.id,
            cantidad: take,
            version: line.version
        });
        remaining -= take;
    }

    assert.equal(remaining, 0, 'debe existir consumo disponible suficiente para documentar');
    return fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName: options.payerName || 'Pagador cierre',
        issuedByUserId: fixture.waiter.id,
        type: options.type || 'dividida',
        assignments,
        idempotencyKey: options.idempotencyKey,
        now: options.now
    });
}

test('flujo cruzado: una cuenta dividida conserva una sola venta, permite consumo posterior y solo se libera al finalizar', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCoreDomain(context.db, { quantity: 3 });

    const first = await createPreinvoiceForAvailable(fixture, 2, {
        payerName: 'Cliente que se retira',
        type: 'dividida',
        idempotencyKey: 'v3.7:prefactura:1',
        now: '2026-07-18T10:05:00.000Z'
    });
    await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: first.id,
        cashierUserId: fixture.cashier.id,
        amount: first.total,
        paymentMethod: 'efectivo',
        cashReceived: first.total,
        idempotencyKey: 'v3.7:pago:1',
        now: '2026-07-18T10:10:00.000Z'
    });

    let account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.estado_operativo, 'abierta');
    assert.equal(account.saldo_pendiente, 1100);
    assert.equal(account.productos_pagados.reduce((sum, item) => sum + Number(item.cantidad), 0), 2);

    await fixture.accountService.addProducts(fixture.account.id, {
        userId: fixture.waiter.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 1 }],
        now: '2026-07-18T10:12:00.000Z'
    });

    account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.total_con_servicio, 4400);
    assert.equal(account.total_pagado, 2200);
    assert.equal(account.saldo_pendiente, 2200);
    assert.equal(account.estado_operativo, 'abierta');

    const second = await createPreinvoiceForAvailable(fixture, 2, {
        payerName: 'Cliente principal',
        type: 'completa',
        idempotencyKey: 'v3.7:prefactura:2',
        now: '2026-07-18T10:15:00.000Z'
    });
    await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: second.id,
        cashierUserId: fixture.cashier.id,
        paymentTenders: [
            { tipo: 'efectivo', monto_aplicado: 1000, monto_recibido: 1000 },
            { tipo: 'tarjeta', monto_aplicado: 1200, referencia: 'AUTH-V370' }
        ],
        idempotencyKey: 'v3.7:pago:2',
        now: '2026-07-18T10:20:00.000Z'
    });

    account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.saldo_pendiente, 0);
    assert.equal(account.estado_financiero, 'conciliada');
    assert.equal(account.estado_operativo, 'abierta');

    const seatBeforeClose = await context.db.get('SELECT estado FROM mesas WHERE id = ?', [fixture.seat.id]);
    assert.equal(seatBeforeClose.estado, 'ocupada', 'pagar no debe liberar la mesa');

    const report = await fixture.reportService.getReport({
        startIso: '2026-07-18T10:00:00.000Z',
        endIso: '2026-07-18T11:00:00.000Z'
    });
    assert.equal(report.resumen.cuentas_vendidas, 1);
    assert.equal(report.resumen.ventas_globales, 4400);
    assert.equal(report.resumen.cantidad_movimientos_caja, 2);
    assert.equal(report.resumen.movimientos_liquidacion_ventas, 4400);
    assert.equal(report.resumen.diferencia_ventas_vs_liquidaciones, 0);

    const preview = await fixture.finalizationService.getFinalizationRead(fixture.account.id);
    assert.equal(preview.puede_finalizar, true);
    const closed = await fixture.finalizationService.finalizeService({
        accountId: fixture.account.id,
        userId: fixture.waiter.id,
        expectedVersion: preview.cuenta.version,
        idempotencyKey: 'v3.7:finalizar:1',
        now: '2026-07-18T10:25:00.000Z'
    });
    assert.equal(closed.cuenta.estado_operativo, 'cerrada');
    assert.equal(closed.puesto.estado, 'libre');
});

test('flujo cruzado: crédito y abonos pasan por Payments sin registrar una segunda venta', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCoreDomain(context.db, { quantity: 3, now: '2026-07-18T12:00:00.000Z' });

    const document = await createPreinvoiceForAvailable(fixture, 3, {
        payerName: 'Cliente crédito',
        type: 'completa',
        idempotencyKey: 'v3.7:credito:prefactura',
        now: '2026-07-18T12:05:00.000Z'
    });
    const creditService = new CreditService({
        db: context.db,
        accountService: fixture.accountService,
        paymentService: fixture.paymentService,
        sequenceService: fixture.sequenceService,
        bcrypt: bcryptFallback
    });
    const credit = await creditService.formalizePreinvoiceCredit({
        preinvoiceId: document.id,
        operatorUserId: fixture.cashier.id,
        adminPassword: 'clave-admin',
        observation: 'Cierre cruzado 3.0',
        idempotencyKey: 'v3.7:credito:crear',
        now: '2026-07-18T12:10:00.000Z'
    });
    await creditService.recordPayment({
        creditId: credit.id,
        cashierUserId: fixture.cashier.id,
        amount: 1000,
        paymentMethod: 'efectivo',
        cashReceived: 1000,
        idempotencyKey: 'v3.7:credito:abono',
        now: '2026-07-18T12:20:00.000Z'
    });

    const report = await fixture.reportService.getReport({
        startIso: '2026-07-18T12:00:00.000Z',
        endIso: '2026-07-18T13:00:00.000Z'
    });
    assert.equal(report.resumen.cuentas_vendidas, 1);
    assert.equal(report.resumen.ventas_globales, 3300);
    assert.equal(report.resumen.cobros_credito, 1000);
    assert.equal(report.movimientos.filter(item => item.naturaleza === 'cobro_credito').length, 1);

    const account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.total_pagado, 3300, 'el abono no vuelve a incrementar la venta global');
    assert.equal(account.estado_operativo, 'abierta');
    const seat = await context.db.get('SELECT estado FROM mesas WHERE id = ?', [fixture.seat.id]);
    assert.equal(seat.estado, 'ocupada');
});

test('flujo cruzado: un fallo y reintento de Printing no muta el documento financiero origen', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCoreDomain(context.db, { quantity: 1, now: '2026-07-18T13:00:00.000Z' });
    const document = await createPreinvoiceForAvailable(fixture, 1, {
        payerName: 'Cliente impresión',
        type: 'completa',
        idempotencyKey: 'v3.7:print:prefactura',
        now: '2026-07-18T13:05:00.000Z'
    });

    let calls = 0;
    const flakyAdapter = {
        code: 'v370_flaky',
        async render() {
            calls += 1;
            if (calls === 1) {
                const error = new Error('Dispositivo no disponible');
                error.code = 'DEVICE_OFFLINE';
                throw error;
            }
            return { adaptador: 'v370_flaky', resultado: 'ok' };
        }
    };
    const printingService = new PrintingService({ db: context.db, adapters: [flakyAdapter] });
    const job = await printingService.enqueue({
        documentType: 'prefactura',
        documentId: String(document.id),
        documentNumber: document.numero_documento,
        adapter: 'v370_flaky',
        payload: {
            documento: 'prefactura',
            numero_documento: document.numero_documento,
            total: document.total
        },
        maxAttempts: 2,
        now: '2026-07-18T13:06:00.000Z'
    });

    await assert.rejects(printingService.processJob(job.id), /Dispositivo no disponible/);
    const afterFailure = await context.db.get(
        'SELECT estado, total_pagado, saldo_pendiente FROM prefacturas WHERE id = ?',
        [document.id]
    );
    assert.equal(afterFailure.estado, 'emitida');
    assert.equal(afterFailure.total_pagado, 0);
    assert.equal(afterFailure.saldo_pendiente, document.total);

    await printingService.retry(job.id);
    const completed = await printingService.processJob(job.id);
    assert.equal(completed.estado, PRINT_JOB_STATES.COMPLETED);
    assert.equal(completed.intentos, 2);

    const jobs = await context.db.get(
        'SELECT COUNT(*) AS total FROM trabajos_impresion WHERE documento_tipo = ? AND documento_id = ?',
        ['prefactura', String(document.id)]
    );
    assert.equal(jobs.total, 1, 'el reintento técnico debe reutilizar el mismo trabajo');
    const afterRetry = await context.db.get(
        'SELECT estado, total_pagado, saldo_pendiente FROM prefacturas WHERE id = ?',
        [document.id]
    );
    assert.deepEqual(afterRetry, afterFailure);
});

test('flujo cruzado: el estado de impresión de Kitchen es independiente del estado operativo', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await context.db.createTables();
    await context.db.migrateSchema();

    const now = '2026-07-18T14:00:00.000Z';
    const user = await context.db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Salonero Kitchen Cierre', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await context.db.run(`
        INSERT INTO roles_trabajo (nombre, slug, descripcion, activo, requiere_zona, es_sistema, destino_inicial, creado_en)
        VALUES ('Salonero Kitchen Cierre', 'salonero-kitchen-cierre', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await context.db.run(`
        INSERT INTO zonas (nombre, slug, orden, aplica_servicio, porcentaje_servicio, activa, creado_en)
        VALUES ('Zona Kitchen Cierre', 'zona-kitchen-cierre', 1, 0, 0, 1, ?)
    `, [now]);
    const seat = await context.db.run(`
        INSERT INTO mesas (numero, capacidad, estado, zona, tipo_asiento, zona_id, activo, cliente_nombre, fecha_apertura, cantidad_personas)
        VALUES (371, 4, 'ocupada', 'zona-kitchen-cierre', 'mesa', ?, 1, 'Cliente Kitchen', ?, 2)
    `, [zone.id, now]);
    await context.db.run(`
        INSERT INTO mesa_responsables (mesa_id, usuario_id, rol_trabajo_id, asignado_por_usuario_id, fecha_asignacion)
        VALUES (?, ?, ?, ?, ?)
    `, [seat.id, user.id, role.id, user.id, now]);
    const category = await context.db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Kitchen cierre', NULL, 1, 1)
    `);
    const product = await context.db.run(`
        INSERT INTO productos (nombre, descripcion, precio, categoria_id, subcategoria_id, es_cocina, destino_preparacion, activo)
        VALUES ('Plato cierre', 'Preparación', 2500, ?, NULL, 1, 'cocina', 1)
    `, [category.id]);

    const kitchenService = new KitchenService({ db: context.db });
    const accountService = new AccountService({ db: context.db, kitchenService });
    const account = await accountService.createAccount({
        mesaId: seat.id,
        userId: user.id,
        productos: [{ producto_id: product.id, cantidad: 1 }],
        now
    });
    const commandId = account.comanda_ids[0];
    let command = await kitchenService.getComanda(commandId);
    assert.equal(command.estado_operativo, KITCHEN_OPERATIONAL_STATES.PENDING);
    assert.equal(command.estado_impresion, KITCHEN_PRINT_STATES.PENDING);

    command = await kitchenService.markPrintState({
        comandaId: commandId,
        userId: user.id,
        state: KITCHEN_PRINT_STATES.FAILED,
        now: '2026-07-18T14:01:00.000Z'
    });
    assert.equal(command.estado_impresion, KITCHEN_PRINT_STATES.FAILED);
    assert.equal(command.estado_operativo, KITCHEN_OPERATIONAL_STATES.PENDING);

    command = await kitchenService.transitionState({
        comandaId: commandId,
        userId: user.id,
        state: KITCHEN_OPERATIONAL_STATES.SENT,
        expectedVersion: command.version,
        now: '2026-07-18T14:02:00.000Z'
    });
    assert.equal(command.estado_operativo, KITCHEN_OPERATIONAL_STATES.SENT);
    assert.equal(command.estado_impresion, KITCHEN_PRINT_STATES.FAILED);
});

test('contrato de cierre 3.0: no reaparecen rutas monetarias legacy ni cobro desde Dashboard', () => {
    const root = path.join(__dirname, '..');
    const app = fs.readFileSync(path.join(root, 'server/app.js'), 'utf8');
    const ordersRoute = fs.readFileSync(path.join(root, 'server/routes/orders.js'), 'utf8');
    const dashboardRoute = fs.readFileSync(path.join(root, 'server/routes/dashboard.js'), 'utf8');
    const dashboardUi = fs.readFileSync(path.join(root, 'public/js/components/dashboard.js'), 'utf8');
    const creditsRoute = fs.readFileSync(path.join(root, 'server/routes/credits.js'), 'utf8');

    assert.doesNotMatch(app, /app\.use\(['"]\/api\/credits['"]/);
    assert.doesNotMatch(ordersRoute, /router\.post\(['"]\/:id\/pay['"]/);
    assert.doesNotMatch(dashboardRoute, /router\.(post|put|patch|delete)\(/);
    assert.doesNotMatch(dashboardUi, /processPayment|finalizePayment|showPaymentModal/);
    assert.doesNotMatch(creditsRoute, /router\.(get|post|put|patch|delete)\(/);
});
