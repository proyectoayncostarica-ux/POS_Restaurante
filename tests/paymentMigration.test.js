const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');

async function seedMinimalLegacyPayment(db) {
    await db.createTables();
    await db.migrateSchema();
    const now = '2026-07-16T14:00:00.000Z';
    const user = await db.run(`
        INSERT INTO usuarios (nombre, password, tipo, activo, fecha_creacion)
        VALUES ('Usuario migración pago', 'hash', 'basico', 1, ?)
    `, [now]);
    const zone = await db.run(`
        INSERT INTO zonas (nombre, slug, activa, creado_en)
        VALUES ('Zona migración pago', 'zona-migracion-pago', 1, ?)
    `, [now]);
    const seat = await db.run(`
        INSERT INTO mesas (numero, capacidad, estado, zona, tipo_asiento, zona_id, activo)
        VALUES (93, 4, 'ocupada', 'zona-migracion-pago', 'mesa', ?, 1)
    `, [zone.id]);
    const account = await db.run(`
        INSERT INTO pedidos (
            mesa_id, usuario_id, fecha, estado, total,
            estado_operativo, estado_financiero, total_pagado, saldo_pendiente
        ) VALUES (?, ?, ?, 'pendiente', 1000, 'abierta', 'parcial', 500, 500)
    `, [seat.id, user.id, now]);
    const payment = await db.run(`
        INSERT INTO pagos (
            pedido_id, metodo_pago, monto, subtotal, servicio,
            porcentaje_servicio, aplica_servicio, fecha,
            numero_pago, numero_secuencia
        ) VALUES (?, 'efectivo', 500, 500, 0, 0, 0, ?, NULL, NULL)
    `, [account.id, now]);
    return { payment };
}

test('la migración numera pagos legacy y crea sus componentes sin duplicarlos', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    const fixture = await seedMinimalLegacyPayment(context.db);

    await context.db.ensurePaymentSchema();
    await context.db.ensurePaymentSchema();

    const payment = await context.db.get('SELECT * FROM pagos WHERE id = ?', [fixture.payment.id]);
    assert.equal(payment.numero_pago, 'PG-00000001');
    assert.equal(payment.numero_secuencia, 1);
    assert.equal(payment.estado, 'confirmado');
    assert.equal(payment.version, 1);

    const components = await context.db.all(`
        SELECT tipo, monto FROM pago_componentes WHERE pago_id = ? ORDER BY tipo
    `, [fixture.payment.id]);
    assert.deepEqual(components.map(row => ({ ...row })), [
        { tipo: 'servicio', monto: 0 },
        { tipo: 'subtotal', monto: 500 }
    ]);
    const sequence = await context.db.get(`
        SELECT ultimo_numero FROM secuencias_documentales WHERE tipo_documento = 'pago'
    `);
    assert.equal(sequence.ultimo_numero, 1);
});
