const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const { DocumentSequenceService } = require('../server/services/documentSequenceService');
const { PreinvoiceService } = require('../server/services/preinvoiceService');
const { PaymentService } = require('../server/services/paymentService');
const { ServiceFinalizationService } = require('../server/services/serviceFinalizationService');

async function seedFinalizationDomain(db, quantity = 2) {
    await db.createTables();
    await db.migrateSchema();

    const now = '2026-07-17T18:00:00.000Z';
    const server = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Andrey cierre', 'hash', 'basico', 1, ?)
    `, [now]);
    const cashier = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Caja cierre', 'hash', 'basico', 1, ?)
    `, [now]);
    const outsider = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Otro salonero', 'hash', 'basico', 1, ?)
    `, [now]);
    const admin = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Admin cierre', 'hash', 'administrador', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero cierre', 'salonero-cierre', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Zona cierre', 'zona-cierre', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (95, 6, 'ocupada', 'zona-cierre', 'mesa', ?, 1, 'Juan', ?, 4)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, server.id, role.id, server.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Cierre', NULL, 0, 1)
    `);
    const product = await db.run(`
        INSERT INTO productos (
            nombre, descripcion, precio, categoria_id,
            subcategoria_id, es_cocina, activo
        ) VALUES ('Consumo cierre', 'Prueba', 1000, ?, NULL, 0, 1)
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
    const paymentService = new PaymentService({ db, accountService, sequenceService });
    const finalizationService = new ServiceFinalizationService({ db, accountService });

    return {
        now,
        server,
        cashier,
        outsider,
        admin,
        role,
        zone,
        seat,
        product,
        account,
        accountService,
        preinvoiceService,
        paymentService,
        finalizationService
    };
}

async function issueCompletePreinvoice(fixture) {
    const account = await fixture.accountService.getAccount(fixture.account.id);
    const line = account.productos_disponibles[0];
    return fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName: 'Juan',
        issuedByUserId: fixture.server.id,
        type: 'completa',
        assignments: [{
            pedido_producto_id: line.id,
            cantidad: line.cantidad_disponible,
            version: line.version
        }],
        idempotencyKey: `prefactura:cierre:${fixture.account.id}`,
        now: '2026-07-17T18:05:00.000Z'
    });
}

async function settleAccount(fixture) {
    const preinvoice = await issueCompletePreinvoice(fixture);
    await fixture.paymentService.recordPreinvoicePayment({
        preinvoiceId: preinvoice.id,
        cashierUserId: fixture.cashier.id,
        paymentTenders: [{
            tipo: 'efectivo',
            monto_aplicado: preinvoice.total,
            monto_recibido: preinvoice.total
        }],
        idempotencyKey: `payment:cierre:${fixture.account.id}`,
        now: '2026-07-17T18:10:00.000Z'
    });
    return preinvoice;
}

test('bloquea el cierre cuando existe consumo activo sin prefacturar y revierte el estado finalizando', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedFinalizationDomain(context.db, 2);

    const preview = await fixture.finalizationService.getFinalizationRead(fixture.account.id);
    assert.equal(preview.puede_finalizar, false);
    assert.ok(preview.bloqueos.some(item => item.code === 'ACTIVE_CONSUMPTION_UNDOCUMENTED'));

    await assert.rejects(
        fixture.finalizationService.finalizeService({
            accountId: fixture.account.id,
            userId: fixture.server.id,
            expectedVersion: preview.cuenta.version,
            idempotencyKey: 'finalizar:blocked:001'
        }),
        error => error?.details?.code === 'SERVICE_FINALIZATION_BLOCKED'
    );

    const account = await context.db.get('SELECT estado, estado_operativo FROM pedidos WHERE id = ?', [fixture.account.id]);
    const seat = await context.db.get('SELECT estado, cliente_nombre FROM mesas WHERE id = ?', [fixture.seat.id]);
    assert.equal(account.estado, 'pendiente');
    assert.equal(account.estado_operativo, 'abierta');
    assert.equal(seat.estado, 'ocupada');
    assert.equal(seat.cliente_nombre, 'Juan');
});

test('finaliza una cuenta conciliada y libera mesa, cliente y responsables atómicamente', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedFinalizationDomain(context.db, 2);
    await settleAccount(fixture);

    const preview = await fixture.finalizationService.getFinalizationRead(fixture.account.id);
    assert.equal(preview.puede_finalizar, true);
    assert.equal(preview.cuenta.saldo_pendiente, 0);
    assert.equal(preview.documentos.pendientes, 0);

    const result = await fixture.finalizationService.finalizeService({
        accountId: fixture.account.id,
        userId: fixture.server.id,
        expectedVersion: preview.cuenta.version,
        observation: 'Clientes se retiraron y se revisó la mesa.',
        idempotencyKey: 'finalizar:success:001',
        now: '2026-07-17T18:20:00.000Z'
    });

    assert.equal(result.cuenta.estado_operativo, 'cerrada');
    assert.equal(result.cuenta.estado_financiero, 'conciliada');
    assert.equal(result.cuenta.finalizada_por_nombre, 'Andrey cierre');
    assert.equal(result.cuenta.observacion_cierre, 'Clientes se retiraron y se revisó la mesa.');
    assert.equal(result.puesto.estado, 'libre');
    assert.equal(result.mesa_liberada, true);

    const seat = await context.db.get(`
        SELECT estado, cliente_nombre, fecha_apertura, cantidad_personas, hora_estimada
        FROM mesas WHERE id = ?
    `, [fixture.seat.id]);
    assert.equal(seat.estado, 'libre');
    assert.equal(seat.cliente_nombre, null);
    assert.equal(seat.fecha_apertura, null);
    assert.equal(seat.cantidad_personas, null);
    assert.equal(seat.hora_estimada, null);

    const activeResponsibilities = await context.db.get(
        'SELECT COUNT(*) AS total FROM mesa_responsables WHERE mesa_id = ?',
        [fixture.seat.id]
    );
    const historicalResponsibilities = await context.db.get(
        'SELECT COUNT(*) AS total FROM cuenta_responsables WHERE pedido_id = ?',
        [fixture.account.id]
    );
    assert.equal(activeResponsibilities.total, 0);
    assert.equal(historicalResponsibilities.total, 1);

    await assert.rejects(
        fixture.accountService.addProducts(fixture.account.id, {
            userId: fixture.server.id,
            productos: [{ producto_id: fixture.product.id, cantidad: 1 }]
        }),
        error => error?.details?.code === 'ACCOUNT_NOT_OPEN' || error?.code === 'CONFLICT'
    );
});

test('la misma clave de idempotencia devuelve el cierre existente sin duplicar historial', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedFinalizationDomain(context.db, 1);
    await settleAccount(fixture);
    const preview = await fixture.finalizationService.getFinalizationRead(fixture.account.id);
    const request = {
        accountId: fixture.account.id,
        userId: fixture.server.id,
        expectedVersion: preview.cuenta.version,
        idempotencyKey: 'finalizar:retry:001',
        observation: 'Cierre idempotente.'
    };

    const first = await fixture.finalizationService.finalizeService(request);
    const replay = await fixture.finalizationService.finalizeService(request);
    assert.equal(first.cuenta.fecha_cierre, replay.cuenta.fecha_cierre);
    assert.equal(replay.idempotency_replay, true);

    const history = await context.db.get(`
        SELECT COUNT(*) AS total
        FROM historial_transacciones
        WHERE tipo_accion = 'finalizar_servicio_mesa'
          AND descripcion LIKE ?
    `, [`%${fixture.account.numero_cuenta}%`]);
    assert.equal(history.total, 1);
});

test('un usuario no responsable no puede finalizar la mesa', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedFinalizationDomain(context.db, 1);
    await settleAccount(fixture);
    const preview = await fixture.finalizationService.getFinalizationRead(fixture.account.id);

    await assert.rejects(
        fixture.finalizationService.finalizeService({
            accountId: fixture.account.id,
            userId: fixture.outsider.id,
            expectedVersion: preview.cuenta.version,
            idempotencyKey: 'finalizar:forbidden:001'
        }),
        error => error?.details?.code === 'MESA_RESPONSIBILITY_REQUIRED'
    );
});

test('un crédito formalizado puede cerrar el servicio aunque continúe pendiente en cartera', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedFinalizationDomain(context.db, 1);
    const preinvoice = await issueCompletePreinvoice(fixture);
    const now = '2026-07-17T18:12:00.000Z';

    const credit = await context.db.run(`
        INSERT INTO cuentas_credito (
            pedido_id, prefactura_id, numero_credito, numero_secuencia,
            cliente_nombre, pagador_nombre_snapshot, cliente_principal_snapshot,
            numero_cuenta_snapshot, numero_documento_snapshot, mesa,
            zona_nombre_snapshot, responsables_snapshot, monto_original,
            total_abonado, saldo_pendiente, monto_total, estado, origen,
            usuario_origen, creado_por_usuario_id, creado_por_nombre_snapshot,
            autorizado_por_usuario_id, autorizado_por, fecha, version, creado_en, actualizado_en
        ) VALUES (?, ?, 'CR-00000001', 1, 'Juan', 'Juan', 'Juan', ?, ?, 'Mesa 95',
                  'Zona cierre', '[]', ?, 0, ?, ?, 'pendiente', 'paymentservice',
                  'Caja cierre', ?, 'Caja cierre', ?, 'Admin cierre', ?, 1, ?, ?)
    `, [
        fixture.account.id,
        preinvoice.id,
        fixture.account.numero_cuenta,
        preinvoice.numero_documento,
        preinvoice.total,
        preinvoice.total,
        preinvoice.total,
        fixture.cashier.id,
        fixture.admin.id,
        now,
        now,
        now
    ]);
    await fixture.paymentService.transactions.immediate(async tx => {
        const result = await fixture.paymentService.recordCreditSettlementInTransaction({
            preinvoiceId: preinvoice.id,
            creditId: credit.id,
            cashierUserId: fixture.cashier.id,
            now
        }, tx);
        await tx.run('UPDATE cuentas_credito SET pago_apertura_id = ? WHERE id = ?', [result.paymentId, credit.id]);
        await fixture.accountService.synchronizeAccount(fixture.account.id, tx, { now });
    });

    const preview = await fixture.finalizationService.getFinalizationRead(fixture.account.id);
    assert.equal(preview.puede_finalizar, true);
    assert.equal(preview.creditos.vigentes, 1);
    assert.ok(preview.advertencias.some(item => item.code === 'FORMALIZED_CREDIT_REMAINS_OPEN'));

    const result = await fixture.finalizationService.finalizeService({
        accountId: fixture.account.id,
        userId: fixture.server.id,
        expectedVersion: preview.cuenta.version,
        idempotencyKey: 'finalizar:credit:001'
    });
    assert.equal(result.cuenta.estado_operativo, 'cerrada');
    assert.equal(result.cuenta.estado_financiero, 'credito');
    assert.equal(result.puesto.estado, 'libre');
    assert.equal(result.creditos.saldo_pendiente, preinvoice.total);
});

test('la UI y la API ofrecen verificación, confirmación y liberación explícita', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../public/js/components/orders.js'),
        'utf8'
    );
    const routes = fs.readFileSync(
        path.join(__dirname, '../server/routes/orders.js'),
        'utf8'
    );
    assert.match(source, /Finalizar servicio/);
    assert.match(source, /Finalizar y liberar/);
    assert.match(source, /service-finalization-confirm/);
    assert.match(source, /\/finalize-service/);
    assert.match(source, /orders\.finalize_service/);
    assert.match(routes, /'\/:id\/finalization'/);
    assert.match(routes, /'\/:id\/finalize-service'/);
    assert.match(routes, /ORDERS_FINALIZE_SERVICE/);
    assert.match(routes, /serviceFinalizationService\.finalizeService/);
});
