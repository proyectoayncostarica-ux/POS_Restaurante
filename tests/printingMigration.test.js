const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');

test('v3.4.0 crea cola persistente, intentos y plantillas sin depender de documentos de negocio', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());

    await context.db.createTables();
    await context.db.migrateSchema();
    await context.db.createIndexes();

    for (const table of ['trabajos_impresion', 'intentos_impresion', 'plantillas_documento']) {
        const row = await context.db.get(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            [table]
        );
        assert.equal(row?.name, table);
    }

    const indexes = await context.db.all(`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_%impresion%'
        ORDER BY name
    `);
    assert.ok(indexes.some(index => index.name === 'idx_trabajos_impresion_estado'));
    assert.ok(indexes.some(index => index.name === 'idx_trabajos_impresion_documento'));
    assert.ok(indexes.some(index => index.name === 'idx_intentos_impresion_trabajo'));

    const marker = await context.db.get(
        "SELECT valor FROM configuracion WHERE clave = 'v3_4_printing_core_ready'"
    );
    assert.ok(marker?.valor);
});

test('los intentos pertenecen a un trabajo persistente y se eliminan en cascada con él', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await context.db.createTables();
    await context.db.migrateSchema();

    const job = await context.db.run(`
        INSERT INTO trabajos_impresion (
            documento_tipo, documento_id, copia, adaptador,
            payload_json, payload_fingerprint, estado,
            intentos, max_intentos, disponible_desde, creado_en, actualizado_en
        ) VALUES ('prueba', '1', 1, 'navegador_pdf', '{}', 'hash', 'procesando', 1, 3, ?, ?, ?)
    `, ['2026-07-18T12:00:00.000Z', '2026-07-18T12:00:00.000Z', '2026-07-18T12:00:00.000Z']);
    await context.db.run(`
        INSERT INTO intentos_impresion (
            trabajo_impresion_id, numero_intento, estado, adaptador, iniciado_en
        ) VALUES (?, 1, 'procesando', 'navegador_pdf', ?)
    `, [job.id, '2026-07-18T12:00:00.000Z']);

    await context.db.run('DELETE FROM trabajos_impresion WHERE id = ?', [job.id]);
    const remaining = await context.db.get(
        'SELECT COUNT(*) AS count FROM intentos_impresion WHERE trabajo_impresion_id = ?',
        [job.id]
    );
    assert.equal(Number(remaining.count), 0);
});
