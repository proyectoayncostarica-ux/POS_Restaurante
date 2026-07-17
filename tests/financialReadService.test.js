const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const { DocumentSequenceService } = require('../server/services/documentSequenceService');
const { PreinvoiceService } = require('../server/services/preinvoiceService');
const { FinancialReadService } = require('../server/services/financialReadService');

async function seedFinancialDomain(db) {
    await db.createTables();
    await db.migrateSchema();

    const now = '2026-07-16T18:00:00.000Z';
    const user = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Andrey', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero financiero', 'salonero-financiero', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Zona financiera', 'zona-financiera', 1, 0, 0, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (1, 6, 'ocupada', 'zona-financiera', 'mesa', ?, 1, 'Juan', ?, 4)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, user.id, role.id, user.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Financiero', NULL, 0, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id,
            subcategoria_id, es_cocina, activo
        ) VALUES ('Consumo financiero', 'Prueba', 1000, ?, NULL, 0, 1)
    `, [category.id]);

    const accountService = new AccountService({ db });
    const account = await accountService.createAccount({
        mesaId: seat.id,
        userId: user.id,
        productos: [{ producto_id: product.id, cantidad: 5 }],
        now
    });
    const preinvoiceService = new PreinvoiceService({
        db,
        accountService,
        sequenceService: new DocumentSequenceService({ db })
    });
    const financialReadService = new FinancialReadService({ db, accountService });

    return {
        now,
        user,
        role,
        zone,
        seat,
        product,
        account,
        accountService,
        preinvoiceService,
        financialReadService
    };
}

async function issueDocument(fixture, quantity, payerName) {
    const account = await fixture.accountService.getAccount(fixture.account.id);
    const line = account.productos_disponibles[0];
    return fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName,
        issuedByUserId: fixture.user.id,
        type: 'dividida',
        assignments: [{
            pedido_producto_id: line.pedido_producto_id,
            cantidad: quantity,
            version: line.version
        }]
    });
}

async function payDocument(db, fixture, document, amount, date, method) {
    await db.run(`
        UPDATE prefacturas
        SET estado = 'pagada', total_pagado = total, saldo_pendiente = 0,
            fecha_pago = ?, actualizado_en = ?, version = version + 1
        WHERE id = ?
    `, [date, date, document.id]);
    await db.run(`
        INSERT INTO pagos (
            pedido_id, metodo_pago, monto, subtotal, servicio,
            porcentaje_servicio, aplica_servicio, fecha
        ) VALUES (?, ?, ?, ?, 0, 0, 0, ?)
    `, [fixture.account.id, method, amount, amount, date]);
    await fixture.accountService.synchronizeAccount(fixture.account.id, db, { now: date });
}

test('dos prefacturas y dos pagos producen una sola venta financiera global', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedFinancialDomain(context.db);

    const pedro = await issueDocument(fixture, 3, 'Pedro');
    const juan = await issueDocument(fixture, 2, 'Juan');
    await payDocument(context.db, fixture, pedro, 3000, '2026-07-16T18:10:00.000Z', 'efectivo');
    await payDocument(context.db, fixture, juan, 2000, '2026-07-16T18:20:00.000Z', 'tarjeta');

    const read = await fixture.financialReadService.getAccountFinancialRead(fixture.account.id);
    assert.equal(read.fuente_financiera, 'cuenta_global');
    assert.equal(read.numero_cuenta, fixture.account.numero_cuenta);
    assert.equal(read.cliente_principal, 'Juan');
    assert.equal(read.responsable_principal, 'Andrey');
    assert.equal(read.total_global, 5000);
    assert.equal(read.total_pagado, 5000);
    assert.equal(read.saldo_pendiente, 0);
    assert.equal(read.cantidad_documentos, 2);
    assert.equal(read.cantidad_pagos, 2);
    assert.equal(read.es_cuenta_dividida, true);
    assert.equal(read.documentos_operativos[0].pagador_nombre, 'Pedro');
    assert.equal(read.documentos_operativos[1].pagador_nombre, 'Juan');
    assert.deepEqual(read.movimientos_caja.map(item => item.monto).sort((a, b) => a - b), [2000, 3000]);
    assert.equal(read.conciliacion.venta_global, 5000);
    assert.equal(read.conciliacion.movimientos_caja, 5000);
    assert.equal(read.conciliacion.conciliada, true);
    assert.match(read.observacion_financiera, /Cuenta dividida: 2 documentos operativos y 2 pagos/);

    const sales = await fixture.financialReadService.listConsolidatedSales({ limit: null });
    assert.equal(sales.length, 1);
    assert.equal(sales[0].total_global, 5000);
    assert.equal(sales[0].cliente_principal, 'Juan');
});

test('los movimientos de Caja permanecen separados sin multiplicar las ventas', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedFinancialDomain(context.db);
    const pedro = await issueDocument(fixture, 3, 'Pedro');
    const juan = await issueDocument(fixture, 2, 'Juan');
    await payDocument(context.db, fixture, pedro, 3000, '2026-07-16T18:10:00.000Z', 'efectivo');
    await payDocument(context.db, fixture, juan, 2000, '2026-07-16T18:20:00.000Z', 'tarjeta');

    const summary = await fixture.financialReadService.getPeriodSummary({
        startIso: '2026-07-16T18:00:00.000Z',
        endIso: '2026-07-16T19:00:00.000Z'
    });
    assert.equal(summary.cuentas_conciliadas, 1);
    assert.equal(summary.total_ventas_globales, 5000);
    assert.equal(summary.cantidad_movimientos_caja, 2);
    assert.equal(summary.total_movimientos_caja, 5000);
    assert.equal(summary.diferencia_periodo, 0);
    assert.equal(summary.ventas_por_liquidacion.mixto, 5000);
});

test('un pago parcial es movimiento de Caja pero todavía no es venta global conciliada', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedFinancialDomain(context.db);
    const pedro = await issueDocument(fixture, 3, 'Pedro');
    await payDocument(context.db, fixture, pedro, 3000, '2026-07-16T18:10:00.000Z', 'efectivo');

    const summary = await fixture.financialReadService.getPeriodSummary({
        startIso: '2026-07-16T18:00:00.000Z',
        endIso: '2026-07-16T19:00:00.000Z'
    });
    assert.equal(summary.cuentas_conciliadas, 0);
    assert.equal(summary.total_ventas_globales, 0);
    assert.equal(summary.cantidad_movimientos_caja, 1);
    assert.equal(summary.total_movimientos_caja, 3000);
    assert.equal(summary.diferencia_periodo, -3000);
});

test('nuevo consumo elimina la conciliación temporal hasta liquidar nuevamente la cuenta global', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedFinancialDomain(context.db);
    const document = await issueDocument(fixture, 5, 'Juan');
    await payDocument(context.db, fixture, document, 5000, '2026-07-16T18:10:00.000Z', 'efectivo');

    let sales = await fixture.financialReadService.listConsolidatedSales({ limit: null });
    assert.equal(sales.length, 1);

    await fixture.accountService.addProducts(fixture.account.id, {
        userId: fixture.user.id,
        productos: [{ producto_id: fixture.product.id, cantidad: 1 }],
        now: '2026-07-16T18:30:00.000Z'
    });

    sales = await fixture.financialReadService.listConsolidatedSales({ limit: null });
    assert.equal(sales.length, 0);
    const read = await fixture.financialReadService.getAccountFinancialRead(fixture.account.id);
    assert.equal(read.total_global, 6000);
    assert.equal(read.total_pagado, 5000);
    assert.equal(read.saldo_pendiente, 1000);
    assert.equal(read.estado_financiero, 'parcial');
});

test('Dashboard presenta una fila por cuenta global y muestra documentos y pagos como trazabilidad', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../public/js/components/dashboard.js'),
        'utf8'
    );
    assert.match(source, /Ventas globales del día/);
    assert.match(source, /documentos operativos/);
    assert.match(source, /movimientos de Caja/);
    assert.match(source, /cliente principal/i);
});
