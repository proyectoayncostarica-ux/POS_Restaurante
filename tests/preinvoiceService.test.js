const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const { AccountService } = require('../server/services/accountService');
const { DocumentSequenceService } = require('../server/services/documentSequenceService');
const {
    PreinvoiceService,
    PREINVOICE_STATES,
    PREINVOICE_PRINT_STATES
} = require('../server/services/preinvoiceService');

async function seedPreinvoiceDomain(db, quantity = 3) {
    await db.createTables();
    await db.migrateSchema();

    const now = '2026-07-16T13:00:00.000Z';
    const user = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Andrey', 'hash', 'basico', 1, ?)
    `, [now]);
    const role = await db.run(`
        INSERT INTO roles_trabajo (
            nombre, slug, descripcion, activo, requiere_zona,
            es_sistema, destino_inicial, creado_en
        ) VALUES ('Salonero prefacturas', 'salonero-prefacturas', 'Atención', 1, 1, 0, 'dashboard', ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (
            nombre, slug, orden, aplica_servicio,
            porcentaje_servicio, activa, creado_en
        ) VALUES ('Zona prefacturas', 'zona-prefacturas', 1, 1, 10, 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (
            numero, capacidad, estado, zona, tipo_asiento, zona_id,
            activo, cliente_nombre, fecha_apertura, cantidad_personas
        ) VALUES (91, 4, 'ocupada', 'zona-prefacturas', 'mesa', ?, 1, 'Juan', ?, 3)
    `, [zone.id, now]);
    await db.run(`
        INSERT INTO mesa_responsables (
            mesa_id, usuario_id, rol_trabajo_id,
            asignado_por_usuario_id, fecha_asignacion
        ) VALUES (?, ?, ?, ?, ?)
    `, [seat.id, user.id, role.id, user.id, now]);

    const category = await db.run(`
        INSERT INTO categorias (nombre, parent_id, permite_cocina, activa)
        VALUES ('Categoría prefacturas', NULL, 0, 1)
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
        userId: user.id,
        productos: [{ producto_id: product.id, cantidad: quantity }],
        now
    });
    const sequenceService = new DocumentSequenceService({ db });
    const preinvoiceService = new PreinvoiceService({
        db,
        accountService,
        sequenceService
    });

    return {
        now,
        user,
        role,
        zone,
        seat,
        category,
        product,
        account,
        accountService,
        sequenceService,
        preinvoiceService
    };
}

async function firstAvailableLine(fixture) {
    const detail = await fixture.accountService.getAccount(fixture.account.id);
    return detail.productos_disponibles[0];
}

test('emite una prefactura persistente y reserva solo la cantidad seleccionada', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPreinvoiceDomain(context.db, 3);
    const line = await firstAvailableLine(fixture);

    const document = await fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName: 'Pedro',
        issuedByUserId: fixture.user.id,
        type: 'dividida',
        assignments: [{
            pedido_producto_id: line.id,
            cantidad: 2,
            version: line.version
        }],
        idempotencyKey: 'prefactura:pedro:001',
        now: '2026-07-16T13:10:00.000Z'
    });

    assert.equal(document.numero_documento, 'PF-00000001');
    assert.equal(document.ordinal_cuenta, 1);
    assert.equal(document.pagador_nombre, 'Pedro');
    assert.equal(document.cliente_principal_snapshot, 'Juan');
    assert.equal(document.estado, PREINVOICE_STATES.ISSUED);
    assert.equal(document.estado_impresion, PREINVOICE_PRINT_STATES.PENDING);
    assert.equal(document.subtotal, 2000);
    assert.equal(document.servicio, 200);
    assert.equal(document.total, 2200);
    assert.equal(document.saldo_pendiente, 2200);
    assert.equal(document.items.length, 1);
    assert.equal(document.items[0].cantidad, 2);
    assert.equal(document.items[0].producto_nombre_snapshot, 'Imperial 350 ml');
    assert.equal(document.responsables[0].usuario_nombre, 'Andrey');
    assert.equal(document.historial[0].evento, 'emitida');

    const account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.total_con_servicio, 3300, 'la cuenta global conserva el total completo');
    assert.equal(account.estado_financiero, 'pendiente');
    assert.equal(account.productos[0].cantidad_asignada, 2);
    assert.equal(account.productos[0].cantidad_disponible, 1);
});

test('crea subcuentas separadas con documentos y ordinales independientes', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPreinvoiceDomain(context.db, 3);
    let line = await firstAvailableLine(fixture);

    const pedro = await fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName: 'Pedro',
        issuedByUserId: fixture.user.id,
        assignments: [{ pedido_producto_id: line.id, cantidad: 2, version: line.version }]
    });

    line = await firstAvailableLine(fixture);
    const juan = await fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName: 'Juan',
        issuedByUserId: fixture.user.id,
        assignments: [{ pedido_producto_id: line.id, cantidad: 1, version: line.version }]
    });

    assert.equal(pedro.numero_documento, 'PF-00000001');
    assert.equal(juan.numero_documento, 'PF-00000002');
    assert.equal(pedro.ordinal_cuenta, 1);
    assert.equal(juan.ordinal_cuenta, 2);

    const documents = await fixture.preinvoiceService.listByAccount(fixture.account.id);
    assert.equal(documents.length, 2);
    assert.equal(documents.reduce((sum, item) => sum + item.total, 0), 3300);

    const account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.total_con_servicio, 3300);
    assert.equal(account.productos_disponibles.length, 0);
    assert.equal(account.productos[0].cantidad_asignada, 3);
});

test('la clave de idempotencia evita duplicar documento y cantidades', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPreinvoiceDomain(context.db, 3);
    const line = await firstAvailableLine(fixture);
    const request = {
        accountId: fixture.account.id,
        payerName: 'Pedro',
        issuedByUserId: fixture.user.id,
        assignments: [{ pedido_producto_id: line.id, cantidad: 2, version: line.version }],
        idempotencyKey: 'prefactura:reintento:001'
    };

    const first = await fixture.preinvoiceService.createPreinvoice(request);
    const replay = await fixture.preinvoiceService.createPreinvoice(request);

    assert.equal(replay.id, first.id);
    assert.equal(replay.idempotency_replay, true);
    const count = await context.db.get('SELECT COUNT(*) AS total FROM prefacturas');
    const source = await context.db.get('SELECT cantidad_asignada FROM pedido_productos WHERE pedido_id = ?', [fixture.account.id]);
    assert.equal(count.total, 1);
    assert.equal(source.cantidad_asignada, 2);

    await assert.rejects(
        fixture.preinvoiceService.createPreinvoice({
            ...request,
            payerName: 'Otra persona'
        }),
        error => error?.code === 'IDEMPOTENCY_CONFLICT'
    );
});

test('una falla después de numerar revierte documento, secuencia y cantidades', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPreinvoiceDomain(context.db, 3);
    const line = await firstAvailableLine(fixture);

    await context.db.run(`
        CREATE TRIGGER bloquear_prefactura_item
        BEFORE INSERT ON prefactura_items
        BEGIN
            SELECT RAISE(ABORT, 'fallo de persistencia de item');
        END
    `);

    await assert.rejects(
        fixture.preinvoiceService.createPreinvoice({
            accountId: fixture.account.id,
            payerName: 'Pedro',
            issuedByUserId: fixture.user.id,
            assignments: [{ pedido_producto_id: line.id, cantidad: 2, version: line.version }]
        }),
        /fallo de persistencia de item/
    );

    const documents = await context.db.get('SELECT COUNT(*) AS total FROM prefacturas');
    const source = await context.db.get('SELECT cantidad_asignada FROM pedido_productos WHERE id = ?', [line.id]);
    const sequence = await fixture.sequenceService.current('prefactura');
    assert.equal(documents.total, 0);
    assert.equal(source.cantidad_asignada, 0);
    assert.equal(sequence.sequence, 0);
});

test('anular conserva el documento histórico y devuelve sus cantidades', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPreinvoiceDomain(context.db, 3);
    const line = await firstAvailableLine(fixture);

    const document = await fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName: 'Pedro',
        issuedByUserId: fixture.user.id,
        assignments: [{ pedido_producto_id: line.id, cantidad: 2, version: line.version }]
    });
    const annulled = await fixture.preinvoiceService.annulPreinvoice({
        preinvoiceId: document.id,
        userId: fixture.user.id,
        reason: 'Cliente corrigió la distribución'
    });

    assert.equal(annulled.estado, PREINVOICE_STATES.VOIDED);
    assert.equal(annulled.saldo_pendiente, 0);
    assert.equal(annulled.motivo_anulacion, 'Cliente corrigió la distribución');
    assert.equal(annulled.items.length, 1, 'los items permanecen como historial');
    assert.equal(annulled.historial.at(-1).evento, 'anulada');

    const account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.productos[0].cantidad_asignada, 0);
    assert.equal(account.productos[0].cantidad_disponible, 3);
    assert.equal(account.estado_financiero, 'sin_documentos');
});

test('los snapshots del documento no cambian aunque cambie el Menú', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPreinvoiceDomain(context.db, 1);
    const line = await firstAvailableLine(fixture);
    const document = await fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName: 'Juan',
        issuedByUserId: fixture.user.id,
        type: 'completa',
        assignments: [{ pedido_producto_id: line.id, cantidad: 1, version: line.version }]
    });

    await context.db.run(`
        UPDATE productos SET nombre = 'Producto renombrado', precio = 9999 WHERE id = ?
    `, [fixture.product.id]);
    const persisted = await fixture.preinvoiceService.getPreinvoice(document.id);

    assert.equal(persisted.items[0].producto_nombre_snapshot, 'Imperial 350 ml');
    assert.equal(persisted.items[0].precio_unitario, 1000);
    assert.equal(persisted.total, 1100);
});

test('la creación simultánea no puede reservar la misma última unidad dos veces', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPreinvoiceDomain(context.db, 1);
    const line = await firstAvailableLine(fixture);

    const results = await Promise.allSettled([
        fixture.preinvoiceService.createPreinvoice({
            accountId: fixture.account.id,
            payerName: 'Juan',
            issuedByUserId: fixture.user.id,
            assignments: [{ pedido_producto_id: line.id, cantidad: 1, version: line.version }]
        }),
        fixture.preinvoiceService.createPreinvoice({
            accountId: fixture.account.id,
            payerName: 'Pedro',
            issuedByUserId: fixture.user.id,
            assignments: [{ pedido_producto_id: line.id, cantidad: 1, version: line.version }]
        })
    ]);

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const count = await context.db.get('SELECT COUNT(*) AS total FROM prefacturas');
    const source = await context.db.get('SELECT cantidad_asignada FROM pedido_productos WHERE id = ?', [line.id]);
    assert.equal(count.total, 1);
    assert.equal(source.cantidad_asignada, 1);
});

test('una prefactura completa debe incluir todo el consumo disponible', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPreinvoiceDomain(context.db, 3);
    const line = await firstAvailableLine(fixture);

    await assert.rejects(
        fixture.preinvoiceService.createPreinvoice({
            accountId: fixture.account.id,
            payerName: 'Juan',
            issuedByUserId: fixture.user.id,
            type: 'completa',
            assignments: [{
                pedido_producto_id: line.id,
                cantidad: 2,
                version: line.version
            }]
        }),
        error => error?.details?.code === 'PREINVOICE_COMPLETE_REQUIRES_ALL_AVAILABLE'
    );

    const documents = await context.db.get('SELECT COUNT(*) AS total FROM prefacturas');
    const source = await context.db.get(
        'SELECT cantidad_asignada FROM pedido_productos WHERE id = ?',
        [line.id]
    );
    assert.equal(documents.total, 0);
    assert.equal(source.cantidad_asignada, 0);
});

test('una prefactura completa reserva exactamente todo el consumo disponible', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedPreinvoiceDomain(context.db, 3);
    const line = await firstAvailableLine(fixture);

    const document = await fixture.preinvoiceService.createPreinvoice({
        accountId: fixture.account.id,
        payerName: 'Juan',
        issuedByUserId: fixture.user.id,
        type: 'completa',
        assignments: [{
            pedido_producto_id: line.id,
            cantidad: 3,
            version: line.version
        }]
    });

    assert.equal(document.tipo, 'completa');
    assert.equal(document.items[0].cantidad, 3);
    const account = await fixture.accountService.getAccount(fixture.account.id);
    assert.equal(account.productos_disponibles.length, 0);
    assert.equal(account.productos[0].cantidad_asignada, 3);
});
