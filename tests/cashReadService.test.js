const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const { DocumentSequenceService } = require('../server/services/documentSequenceService');
const { PreinvoiceService } = require('../server/services/preinvoiceService');
const { PaymentService } = require('../server/services/paymentService');
const { FinancialReadService } = require('../server/services/financialReadService');
const { CashReadService } = require('../server/services/cashReadService');

async function seedCashQueue(db) {
    await db.createTables();
    await db.migrateSchema();
    const now = '2026-07-17T14:00:00.000Z';
    const server = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Andrey', 'hash', 'basico', 1, ?)
    `, [now]);
    const cashier = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Caja Central', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero Caja', 'salonero-caja-read', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Salón principal', 'salon-principal-caja', 1, 0, 0, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (1, 4, 'ocupada', 'salon-principal-caja', 'mesa', ?, 1, 'Juan', ?, 3)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, server.id, role.id, server.id, now]);
    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Bebidas Caja', NULL, 0, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id,
            subcategoria_id, es_cocina, activo
        ) VALUES ('Imperial 350 ml', 'Cerveza', 1000, ?, NULL, 0, 1)
    `, [category.id]);

    const accountService = new AccountService({ db });
    const account = await accountService.createAccount({
        mesaId: seat.id,
        userId: server.id,
        productos: [{ producto_id: product.id, cantidad: 3 }],
        now
    });
    const sequenceService = new DocumentSequenceService({ db });
    const preinvoiceService = new PreinvoiceService({ db, accountService, sequenceService });
    let line = (await accountService.getAccount(account.id)).productos_disponibles[0];
    const pedro = await preinvoiceService.createPreinvoice({
        accountId: account.id,
        payerName: 'Pedro',
        issuedByUserId: server.id,
        type: 'dividida',
        assignments: [{
            pedido_producto_id: line.id,
            cantidad: 2,
            version: line.version
        }],
        idempotencyKey: 'prefactura:caja:pedro',
        now: '2026-07-17T14:05:00.000Z'
    });
    line = (await accountService.getAccount(account.id)).productos_disponibles[0];
    const juan = await preinvoiceService.createPreinvoice({
        accountId: account.id,
        payerName: 'Juan',
        issuedByUserId: server.id,
        type: 'dividida',
        assignments: [{
            pedido_producto_id: line.id,
            cantidad: 1,
            version: line.version
        }],
        idempotencyKey: 'prefactura:caja:juan',
        now: '2026-07-17T14:06:00.000Z'
    });
    const paymentService = new PaymentService({ db, accountService, sequenceService });
    const financialReadService = new FinancialReadService({ db, accountService });
    const cashReadService = new CashReadService({
        db,
        preinvoiceService,
        paymentService,
        financialReadService
    });

    return {
        server,
        cashier,
        seat,
        zone,
        account,
        pedro,
        juan,
        accountService,
        preinvoiceService,
        paymentService,
        financialReadService,
        cashReadService
    };
}

test('la cola de Caja agrupa prefacturas divididas bajo una sola cuenta global', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCashQueue(context.db);

    const queue = await fixture.cashReadService.listCollectionQueue();
    assert.equal(queue.resumen.total_documentos, 2);
    assert.equal(queue.resumen.cuentas_en_resultado, 1);
    assert.equal(queue.resumen.cuentas_divididas, 1);
    assert.equal(queue.cuentas[0].numero_cuenta, fixture.account.numero_cuenta);
    assert.equal(queue.cuentas[0].cliente_principal, 'Juan');
    assert.equal(queue.cuentas[0].responsable_principal, 'Andrey');
    assert.equal(queue.cuentas[0].documentos.length, 2);
    assert.deepEqual(
        queue.cuentas[0].documentos.map(document => document.pagador_nombre).sort(),
        ['Juan', 'Pedro']
    );
});

test('Caja busca por pagador, documento, cuenta, mesa y zona', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCashQueue(context.db);

    const byPayer = await fixture.cashReadService.listCollectionQueue({ search: 'Pedro' });
    assert.equal(byPayer.documentos.length, 1);
    assert.equal(byPayer.documentos[0].id, fixture.pedro.id);

    const byDocument = await fixture.cashReadService.listCollectionQueue({ search: fixture.juan.numero_documento });
    assert.equal(byDocument.documentos.length, 1);
    assert.equal(byDocument.documentos[0].id, fixture.juan.id);

    const byAccount = await fixture.cashReadService.listCollectionQueue({ search: fixture.account.numero_cuenta });
    assert.equal(byAccount.documentos.length, 2);

    const byTable = await fixture.cashReadService.listCollectionQueue({ search: '1' });
    assert.equal(byTable.documentos.length, 2);

    const byZone = await fixture.cashReadService.listCollectionQueue({ search: 'Salón principal' });
    assert.equal(byZone.documentos.length, 2);
});

test('el read model de prefactura une ítems, pagos y cuenta global sin cerrar la mesa', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCashQueue(context.db);

    const payment = await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: fixture.pedro.id,
        cashierUserId: fixture.cashier.id,
        amount: 2000,
        paymentMethod: 'efectivo',
        idempotencyKey: 'payment:caja:pedro',
        now: '2026-07-17T14:10:00.000Z'
    });
    assert.equal(payment.mesa_liberada, false);

    const read = await fixture.cashReadService.getPreinvoiceCollectionRead(fixture.pedro.id);
    assert.equal(read.prefactura.estado, 'pagada');
    assert.equal(read.prefactura.total_pagado_calculado, 2000);
    assert.equal(read.prefactura.saldo_pendiente_calculado, 0);
    assert.equal(read.cuenta_global.numero_cuenta, fixture.account.numero_cuenta);
    assert.equal(read.cuenta_global.cliente_principal, 'Juan');
    assert.equal(read.cuenta_global.estado_operativo, 'abierta');
    assert.equal(read.cuenta_global.cuenta_dividida, true);
    assert.equal(read.pagos.length, 1);
    assert.equal(read.acciones.puede_cobrar, false);
    assert.equal(read.acciones.requiere_finalizacion_explicita, true);
    assert.equal(read.integridad.coincide_con_saldo_persistido, true);

    const pending = await fixture.cashReadService.listCollectionQueue();
    assert.equal(pending.resumen.total_documentos, 1);
    assert.equal(pending.documentos[0].id, fixture.juan.id);
});

test('la solicitud de reimpresión queda auditada sin afirmar una impresión física', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCashQueue(context.db);

    const result = await fixture.cashReadService.registerReprintRequest({
        preinvoiceId: fixture.pedro.id,
        userId: fixture.cashier.id,
        now: '2026-07-17T14:20:00.000Z'
    });
    assert.equal(result.solicitud_reimpresion.registrada, true);
    assert.equal(result.solicitud_reimpresion.trabajo_impresion_creado, false);
    assert.equal(result.solicitud_reimpresion.pendiente_modulo_printing, true);

    const history = await context.db.get(`
        SELECT evento, usuario_nombre_snapshot, detalle
        FROM historial_prefacturas
        WHERE prefactura_id = ? AND evento = 'reimpresion_solicitada_caja'
    `, [fixture.pedro.id]);
    assert.equal(history.usuario_nombre_snapshot, 'Caja Central');
    const detail = JSON.parse(history.detalle);
    assert.equal(detail.pendiente_servicio_printing, true);
    assert.equal(detail.trabajo_impresion_creado, false);
});

test('la lectura de cobro de la cuenta conserva venta global y movimientos separados', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedCashQueue(context.db);

    await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: fixture.pedro.id,
        cashierUserId: fixture.cashier.id,
        amount: 2000,
        paymentMethod: 'tarjeta',
        reference: 'AUTH-2000',
        idempotencyKey: 'payment:caja:account-read'
    });

    const read = await fixture.cashReadService.getAccountCollectionRead(fixture.account.id);
    assert.equal(read.cuenta_global.numero_cuenta, fixture.account.numero_cuenta);
    assert.equal(read.prefacturas.length, 2);
    assert.equal(read.pagos.length, 1);
    assert.equal(read.resumen_cobro.cuenta_dividida, true);
    assert.equal(read.resumen_cobro.prefacturas_pagadas, 1);
    assert.equal(read.resumen_cobro.prefacturas_pendientes, 1);
    assert.equal(read.resumen_cobro.saldo_documental, 1000);
});

test('el contrato HTTP de Caja expone lecturas y mutaciones con capacidades separadas', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server/routes/cash.js'), 'utf8');
    assert.match(source, /router\.get\('\/queue', requireCapability\(CAPABILITIES\.CASH_ACCESS\)/);
    assert.match(source, /router\.get\('\/preinvoices\/:preinvoiceId', requireCapability\(CAPABILITIES\.CASH_ACCESS\)/);
    assert.match(source, /router\.post\('\/preinvoices\/:preinvoiceId\/payments', requireCapability\(CAPABILITIES\.CASH_COLLECT\)/);
    assert.match(source, /router\.post\('\/preinvoices\/:preinvoiceId\/reprint-request', requireCapability\(CAPABILITIES\.CASH_REPRINT\)/);
    assert.match(source, /router\.post\('\/payments\/:paymentId\/void', requireCapability\(CAPABILITIES\.CASH_REVERSE\)/);
    assert.match(source, /Idempotency-Key/);
    assert.match(source, /mesa_liberada: false/);
});
