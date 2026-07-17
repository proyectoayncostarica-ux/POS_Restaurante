const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');

test('la migración crea el modelo documental completo e idempotente', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());

    await context.db.createTables();
    await context.db.migrateSchema();

    for (const table of [
        'secuencias_documentales',
        'prefacturas',
        'prefactura_items',
        'historial_prefacturas'
    ]) {
        const row = await context.db.get(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            [table]
        );
        assert.equal(row?.name, table);
    }

    const prefacturaColumns = await context.db.getColumns('prefacturas');
    for (const column of [
        'numero_documento',
        'ordinal_cuenta',
        'pagador_nombre',
        'numero_cuenta_snapshot',
        'responsables_snapshot',
        'estado_impresion',
        'clave_idempotencia'
    ]) {
        assert.ok(prefacturaColumns.includes(column), `falta columna ${column}`);
    }

    await context.db.run(`
        UPDATE secuencias_documentales
        SET ultimo_numero = 17
        WHERE tipo_documento = 'prefactura'
    `);
    await context.db.migrateSchema();

    const sequence = await context.db.get(`
        SELECT ultimo_numero
        FROM secuencias_documentales
        WHERE tipo_documento = 'prefactura'
    `);
    const marker = await context.db.get(`
        SELECT valor
        FROM configuracion
        WHERE clave = 'v3_preinvoice_schema_ready'
    `);
    const foreignKeyIssues = await context.db.all('PRAGMA foreign_key_check');

    assert.equal(sequence.ultimo_numero, 17, 'la migración no reinicia la numeración');
    assert.ok(marker?.valor);
    assert.equal(foreignKeyIssues.length, 0);
});
