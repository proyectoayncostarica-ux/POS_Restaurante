const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const {
    DocumentSequenceService,
    DOCUMENT_SEQUENCE_TYPES,
    formatDocumentNumber
} = require('../server/services/documentSequenceService');

test('genera números de prefactura únicos y consecutivos', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await context.db.createTables();
    await context.db.migrateSchema();

    const service = new DocumentSequenceService({ db: context.db });
    const first = await service.next(DOCUMENT_SEQUENCE_TYPES.PREINVOICE, {
        now: '2026-07-16T12:00:00.000Z'
    });
    const second = await service.next(DOCUMENT_SEQUENCE_TYPES.PREINVOICE, {
        now: '2026-07-16T12:00:01.000Z'
    });

    assert.equal(first.sequence, 1);
    assert.equal(first.documentNumber, 'PF-00000001');
    assert.equal(second.sequence, 2);
    assert.equal(second.documentNumber, 'PF-00000002');
    assert.equal(formatDocumentNumber('prefactura', 25), 'PF-00000025');
});

test('un rollback no consume definitivamente la secuencia documental', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await context.db.createTables();
    await context.db.migrateSchema();

    const service = new DocumentSequenceService({ db: context.db });

    await assert.rejects(
        context.db.withTransaction(async tx => {
            const reserved = await service.nextInTransaction('prefactura', tx);
            assert.equal(reserved.documentNumber, 'PF-00000001');
            throw new Error('fallo posterior a reservar número');
        }, { mode: 'IMMEDIATE' }),
        /fallo posterior/
    );

    const current = await service.current('prefactura');
    assert.equal(current.sequence, 0);
    assert.equal(current.documentNumber, null);

    const firstCommitted = await service.next('prefactura');
    assert.equal(firstCommitted.documentNumber, 'PF-00000001');
});

test('solicitudes concurrentes reciben secuencias diferentes', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await context.db.createTables();
    await context.db.migrateSchema();

    const service = new DocumentSequenceService({ db: context.db });
    const documents = await Promise.all([
        service.next('prefactura'),
        service.next('prefactura'),
        service.next('prefactura')
    ]);

    assert.deepEqual(
        documents.map(document => document.documentNumber).sort(),
        ['PF-00000001', 'PF-00000002', 'PF-00000003']
    );
});
