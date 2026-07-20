const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const {
    PrintingService,
    PRINT_JOB_STATES
} = require('../server/services/printingService');

async function createPrintingContext(t, options = {}) {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await context.db.createTables();
    await context.db.migrateSchema();
    return {
        ...context,
        service: new PrintingService({ db: context.db, ...(options || {}) })
    };
}

test('encolar persiste el documento antes de ejecutar cualquier adaptador y es idempotente por documento/tipo/copia', async t => {
    const context = await createPrintingContext(t);
    const input = {
        documentType: 'prefactura',
        documentId: '91',
        documentNumber: 'PF-00000091',
        copy: 1,
        payload: { numero_documento: 'PF-00000091', total: 12500 },
        now: '2026-07-18T12:00:00.000Z'
    };

    const first = await context.service.enqueue(input);
    assert.equal(first.estado, PRINT_JOB_STATES.PENDING);
    assert.equal(first.intentos, 0);
    assert.equal(first.idempotency_replay, false);

    const stored = await context.db.get('SELECT estado, intentos FROM trabajos_impresion WHERE id = ?', [first.id]);
    assert.equal(stored.estado, 'pendiente');
    assert.equal(Number(stored.intentos), 0);

    const replay = await context.service.enqueue(input);
    assert.equal(replay.id, first.id);
    assert.equal(replay.idempotency_replay, true);

    const count = await context.db.get('SELECT COUNT(*) AS count FROM trabajos_impresion');
    assert.equal(Number(count.count), 1);
});

test('el mismo documento/tipo/copia rechaza un payload distinto en vez de duplicar el trabajo', async t => {
    const context = await createPrintingContext(t);
    await context.service.enqueue({
        documentType: 'comanda',
        documentId: '5',
        copy: 1,
        payload: { items: [{ nombre: 'Café', cantidad: 1 }] }
    });

    await assert.rejects(
        context.service.enqueue({
            documentType: 'comanda',
            documentId: '5',
            copy: 1,
            payload: { items: [{ nombre: 'Café', cantidad: 2 }] }
        }),
        error => error?.code === 'IDEMPOTENCY_CONFLICT'
    );
});

test('el adaptador navegador/PDF produce una salida auditable y completa el intento sin tocar el documento origen', async t => {
    const context = await createPrintingContext(t);
    const job = await context.service.enqueue({
        documentType: 'recibo',
        documentId: 'PAGO-22',
        documentNumber: 'RC-00000022',
        payload: { numero_documento: 'RC-00000022', pagador: 'Cliente Uno' },
        now: '2026-07-18T12:00:00.000Z'
    });

    const processed = await context.service.processJob(job.id, {
        now: '2026-07-18T12:00:02.000Z'
    });
    assert.equal(processed.estado, PRINT_JOB_STATES.COMPLETED);
    assert.equal(processed.intentos, 1);
    assert.match(processed.resultado.contenido, /RC-00000022/);
    assert.equal(processed.resultado.modo_salida, 'vista_previa_navegador_pdf');
    assert.equal(processed.intentos_detalle.length, 1);
    assert.equal(processed.intentos_detalle[0].estado, 'completado');
});

test('una falla del adaptador queda registrada y el reintento no crea otro trabajo de negocio', async t => {
    let calls = 0;
    const flakyAdapter = {
        code: 'flaky',
        async render() {
            calls += 1;
            if (calls === 1) {
                const error = new Error('Impresora desconectada');
                error.code = 'DEVICE_OFFLINE';
                throw error;
            }
            return { adaptador: 'flaky', resultado: 'ok' };
        }
    };
    const context = await createPrintingContext(t, { adapters: [flakyAdapter] });
    const job = await context.service.enqueue({
        documentType: 'cierre',
        documentId: '2026-07-18',
        copy: 1,
        adapter: 'flaky',
        payload: { fecha: '2026-07-18' },
        maxAttempts: 2
    });

    await assert.rejects(context.service.processJob(job.id), /Impresora desconectada/);
    let failed = await context.service.getJob(job.id, { includeAttempts: true });
    assert.equal(failed.estado, PRINT_JOB_STATES.FAILED);
    assert.equal(failed.intentos, 1);
    assert.equal(failed.intentos_detalle[0].error_codigo, 'DEVICE_OFFLINE');
    assert.match(failed.ultimo_error, /desconectada/);

    await context.service.retry(job.id);
    const completed = await context.service.processJob(job.id);
    assert.equal(completed.estado, PRINT_JOB_STATES.COMPLETED);
    assert.equal(completed.intentos, 2);
    assert.equal(completed.intentos_detalle.length, 2);

    const jobs = await context.db.get('SELECT COUNT(*) AS count FROM trabajos_impresion');
    assert.equal(Number(jobs.count), 1);
});

test('la cola impide reintentos más allá del máximo configurado', async t => {
    const failingAdapter = {
        code: 'always_fail',
        async render() { throw new Error('fallo permanente'); }
    };
    const context = await createPrintingContext(t, { adapters: [failingAdapter] });
    const job = await context.service.enqueue({
        documentType: 'prueba',
        documentId: 'MAX-1',
        adapter: 'always_fail',
        payload: { ok: true },
        maxAttempts: 1
    });
    await assert.rejects(context.service.processJob(job.id), /fallo permanente/);
    await assert.rejects(
        context.service.retry(job.id),
        error => error?.code === 'CONFLICT' && error?.details?.code === 'PRINT_JOB_MAX_ATTEMPTS_REACHED'
    );
});

test('las plantillas permiten vista previa genérica sin recalcular lógica de negocio', async t => {
    const context = await createPrintingContext(t);
    const first = await context.service.upsertTemplate({
        code: 'ticket-base',
        name: 'Ticket base',
        documentType: 'generico',
        content: '<h1>{{numero}}</h1><p>{{cliente.nombre}}</p>'
    });
    assert.equal(Number(first.version), 1);

    const second = await context.service.upsertTemplate({
        code: 'ticket-base',
        name: 'Ticket base',
        documentType: 'generico',
        content: '<h1>{{numero}}</h1><strong>{{cliente.nombre}}</strong>'
    });
    assert.equal(Number(second.version), 2);

    const preview = await context.service.preview({
        templateCode: 'ticket-base',
        payload: { numero: 'DOC-1', cliente: { nombre: '<Ana>' } }
    });
    assert.match(preview.contenido, /DOC-1/);
    assert.match(preview.contenido, /&lt;Ana&gt;/);
    assert.doesNotMatch(preview.contenido, /<Ana>/);
});

test('processNext respeta el orden persistente de la cola', async t => {
    const context = await createPrintingContext(t);
    const first = await context.service.enqueue({
        documentType: 'doc', documentId: '1', payload: { numero: 1 }, now: '2026-07-18T12:00:00.000Z'
    });
    const second = await context.service.enqueue({
        documentType: 'doc', documentId: '2', payload: { numero: 2 }, now: '2026-07-18T12:00:01.000Z'
    });

    const processed = await context.service.processNext({ now: '2026-07-18T12:01:00.000Z' });
    assert.equal(processed.id, first.id);
    const untouched = await context.service.getJob(second.id);
    assert.equal(untouched.estado, PRINT_JOB_STATES.PENDING);
});

test('recupera trabajos abandonados en procesando para que la cola sobreviva a reinicios', async t => {
    const context = await createPrintingContext(t);
    const job = await context.service.enqueue({
        documentType: 'doc', documentId: 'recovery', payload: { numero: 3 }, now: '2026-07-18T11:00:00.000Z'
    });
    await context.service.startAttempt(job.id, { now: '2026-07-18T11:01:00.000Z' });

    const result = await context.service.recoverStale({
        olderThanMinutes: 10,
        now: '2026-07-18T12:00:00.000Z'
    });
    assert.equal(result.recuperados, 1);
    const recovered = await context.service.getJob(job.id, { includeAttempts: true });
    assert.equal(recovered.estado, PRINT_JOB_STATES.PENDING);
    assert.equal(recovered.intentos_detalle[0].estado, 'fallido');
    assert.equal(recovered.intentos_detalle[0].error_codigo, 'PROCESS_INTERRUPTED');
});
