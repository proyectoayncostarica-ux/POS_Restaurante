const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const { DocumentSequenceService } = require('../server/services/documentSequenceService');
const { PreinvoiceService } = require('../server/services/preinvoiceService');
const { FinancialReadService } = require('../server/services/financialReadService');
const { DashboardReportService } = require('../server/services/dashboardReportService');

async function seedReportDomain(db) {
    await db.createTables();
    await db.migrateSchema();

    const now = '2026-07-18T14:00:00.000Z';
    const responsible = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Responsable Reporte', 'hash', 'basico', 1, ?)
    `, [now]);
    const cashierA = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Cajero A', 'hash', 'basico', 1, ?)
    `, [now]);
    const cashierB = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Cajero B', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero reporte', 'salonero-reporte', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Zona reporte', 'zona-reporte', 1, 0, 0, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (31, 4, 'ocupada', 'zona-reporte', 'mesa', ?, 1, 'Cliente Principal', ?, 2)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, responsible.id, role.id, responsible.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Reporte', NULL, 0, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id,
            subcategoria_id, es_cocina, activo
        ) VALUES ('Producto reporte', 'Prueba', 1000, ?, NULL, 0, 1)
    `, [category.id]);

    const accountService = new AccountService({ db });
    const account = await accountService.createAccount({
        mesaId: seat.id,
        userId: responsible.id,
        productos: [{ producto_id: product.id, cantidad: 5 }],
        now
    });
    const preinvoiceService = new PreinvoiceService({
        db,
        accountService,
        sequenceService: new DocumentSequenceService({ db })
    });
    const financialReadService = new FinancialReadService({ db, accountService });
    const reportService = new DashboardReportService({ db, financialReadService });

    return {
        now,
        responsible,
        cashierA,
        cashierB,
        role,
        zone,
        seat,
        product,
        account,
        accountService,
        preinvoiceService,
        reportService
    };
}

async function issueDocument(fixture, quantity, payerName) {
    const account = await fixture.accountService.getAccount(fixture.account.id);
    const line = account.productos_disponibles[0];
    return fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName,
        issuedByUserId: fixture.responsible.id,
        type: 'dividida',
        assignments: [{
            pedido_producto_id: line.pedido_producto_id,
            cantidad: quantity,
            version: line.version
        }]
    });
}

async function registerPayment(db, fixture, document, input) {
    const { amount, date, method, cashier } = input;
    await db.run(`
        UPDATE prefacturas
        SET estado = 'pagada', total_pagado = total, saldo_pendiente = 0,
            fecha_pago = ?, actualizado_en = ?, version = version + 1
        WHERE id = ?
    `, [date, date, document.id]);
    const payment = await db.run(`
        INSERT INTO pagos (
            pedido_id, prefactura_id, numero_pago, numero_secuencia,
            naturaleza, estado, metodo_pago, metodo_pago_v3,
            monto, monto_recibido, vuelto, subtotal, servicio,
            porcentaje_servicio, aplica_servicio,
            cajero_usuario_id, cajero_nombre_snapshot,
            pagador_nombre_snapshot, fecha, version, creado_en, actualizado_en
        ) VALUES (?, ?, ?, ?, 'liquidacion_venta', 'confirmado', ?, ?, ?, ?, 0, ?, 0, 0, 0, ?, ?, ?, ?, 1, ?, ?)
    `, [
        fixture.account.id,
        document.id,
        `PG-REPORT-${document.id}`,
        document.id,
        method,
        method,
        amount,
        amount,
        amount,
        cashier.id,
        cashier.nombre || (cashier.id === fixture.cashierA.id ? 'Cajero A' : 'Cajero B'),
        document.pagador_nombre,
        date,
        date,
        date
    ]);
    await db.run(`
        INSERT INTO pago_medios (
            pago_id, ordinal, tipo, monto_aplicado,
            monto_recibido, vuelto, referencia, creado_en
        ) VALUES (?, 1, ?, ?, ?, 0, NULL, ?)
    `, [payment.id, method, amount, amount, date]);
    await fixture.accountService.synchronizeAccount(fixture.account.id, db, { now: date });
}

test('el consolidado cuenta una venta global aunque existan dos prefacturas y dos pagos', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedReportDomain(context.db);
    fixture.cashierA.nombre = 'Cajero A';
    fixture.cashierB.nombre = 'Cajero B';

    const first = await issueDocument(fixture, 3, 'Pagador parcial A');
    const second = await issueDocument(fixture, 2, 'Pagador parcial B');
    await registerPayment(context.db, fixture, first, {
        amount: 3000,
        date: '2026-07-18T14:10:00.000Z',
        method: 'efectivo',
        cashier: fixture.cashierA
    });
    await registerPayment(context.db, fixture, second, {
        amount: 2000,
        date: '2026-07-18T14:20:00.000Z',
        method: 'tarjeta',
        cashier: fixture.cashierB
    });

    const report = await fixture.reportService.getReport({
        startIso: '2026-07-18T14:00:00.000Z',
        endIso: '2026-07-18T15:00:00.000Z'
    });

    assert.equal(report.resumen.cuentas_vendidas, 1);
    assert.equal(report.resumen.cuentas_divididas, 1);
    assert.equal(report.resumen.ventas_globales, 5000);
    assert.equal(report.resumen.cantidad_movimientos_caja, 2);
    assert.equal(report.resumen.movimientos_caja, 5000);
    assert.equal(report.resumen.movimientos_liquidacion_ventas, 5000);
    assert.equal(report.resumen.diferencia_ventas_vs_liquidaciones, 0);
    assert.equal(report.ventas[0].cliente_principal, 'Cliente Principal');
    assert.equal(report.ventas[0].responsable_principal, 'Responsable Reporte');
});

test('filtrar por cajero o método selecciona la cuenta sin multiplicar la venta', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedReportDomain(context.db);
    fixture.cashierA.nombre = 'Cajero A';
    fixture.cashierB.nombre = 'Cajero B';

    const first = await issueDocument(fixture, 3, 'A');
    const second = await issueDocument(fixture, 2, 'B');
    await registerPayment(context.db, fixture, first, {
        amount: 3000,
        date: '2026-07-18T14:10:00.000Z',
        method: 'efectivo',
        cashier: fixture.cashierA
    });
    await registerPayment(context.db, fixture, second, {
        amount: 2000,
        date: '2026-07-18T14:20:00.000Z',
        method: 'tarjeta',
        cashier: fixture.cashierB
    });

    const byCashier = await fixture.reportService.getReport({
        startIso: '2026-07-18T14:00:00.000Z',
        endIso: '2026-07-18T15:00:00.000Z',
        cashierUserId: fixture.cashierA.id
    });
    assert.equal(byCashier.ventas.length, 1);
    assert.equal(byCashier.resumen.ventas_globales, 5000);
    assert.equal(byCashier.movimientos.length, 1);
    assert.equal(byCashier.resumen.movimientos_caja, 3000);

    const byMethod = await fixture.reportService.getReport({
        startIso: '2026-07-18T14:00:00.000Z',
        endIso: '2026-07-18T15:00:00.000Z',
        paymentMethod: 'tarjeta'
    });
    assert.equal(byMethod.ventas.length, 1);
    assert.equal(byMethod.resumen.ventas_globales, 5000);
    assert.equal(byMethod.movimientos.length, 1);
    assert.equal(byMethod.resumen.movimientos_caja, 2000);
});

test('consumo activo y documentos pendientes son lecturas separadas y no ventas', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedReportDomain(context.db);
    await issueDocument(fixture, 2, 'Pagador pendiente');

    const report = await fixture.reportService.getReport({
        startIso: '2026-07-18T14:00:00.000Z',
        endIso: '2026-07-18T15:00:00.000Z'
    });

    assert.equal(report.resumen.ventas_globales, 0);
    assert.equal(report.resumen.cuentas_activas, 1);
    assert.equal(report.resumen.consumo_activo, 5000);
    assert.equal(report.resumen.documentos_pendientes, 1);
    assert.equal(report.documentos_pendientes[0].pagador_nombre, 'Pagador pendiente');
});

test('Dashboard financiero es de consulta y no implementa cobro directo', () => {
    const dashboard = fs.readFileSync(path.join(__dirname, '../public/js/components/dashboard.js'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const route = fs.readFileSync(path.join(__dirname, '../server/routes/dashboard.js'), 'utf8');

    assert.match(route, /router\.get\('\/report'/);
    assert.match(index, /Consolidado financiero/);
    assert.match(dashboard, /Una venta por cuenta global|ventas globales consolidadas/i);
    assert.match(dashboard, /documentos operativos pendientes/i);
    assert.doesNotMatch(dashboard, /\/cash\/preinvoices\/.*\/payments/);
    assert.doesNotMatch(dashboard, /Cobrar \$\{/);
});
