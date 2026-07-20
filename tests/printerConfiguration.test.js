const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDatabase } = require('./helpers/testDatabase');
const {
    PrinterConfigurationService
} = require('../server/services/printerConfigurationService');
const { PrintingService } = require('../server/services/printingService');

async function createContext(t) {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await context.db.createTables();
    await context.db.migrateSchema();
    const printerConfigurationService = new PrinterConfigurationService({ db: context.db });
    const printingService = new PrintingService({
        db: context.db,
        printerConfigurationService
    });
    return { ...context, printerConfigurationService, printingService };
}

test('v3.4.2 crea configuración independiente para Caja, Cocina y Bar', async t => {
    const context = await createContext(t);
    const configs = await context.printerConfigurationService.list();

    assert.deepEqual(Object.keys(configs).sort(), ['bar', 'caja', 'cocina']);
    assert.equal(configs.caja.adaptador, 'navegador_pdf');
    assert.equal(configs.cocina.tamano_papel, '80mm');
    assert.equal(configs.bar.copias, 1);
    assert.equal(configs.caja.autoimpresion, true);
});

test('la impresora legacy se adopta como nombre inicial de Caja sin sobrescribir configuraciones posteriores', async t => {
    const context = await createTestDatabase();
    t.after(() => context.cleanup());
    await context.db.createTables();
    await context.db.run(
        "INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('impresora', 'Ticketera Legacy')"
    );
    const service = new PrinterConfigurationService({ db: context.db });
    const first = await service.get('caja');
    assert.equal(first.nombre, 'Ticketera Legacy');

    await service.update('caja', { nombre: 'Caja Principal', copias: 2 });
    await context.db.run(
        "UPDATE configuracion SET valor = 'Otra Legacy' WHERE clave = 'impresora'"
    );
    const second = await service.get('caja');
    assert.equal(second.nombre, 'Caja Principal');
    assert.equal(second.copias, 2);
});

test('Printing toma snapshot de Settings al encolar y no reescribe trabajos previos cuando cambia la configuración', async t => {
    const context = await createContext(t);
    await context.printerConfigurationService.update('caja', {
        nombre: 'Caja 80mm',
        tamano_papel: '80mm',
        copias: 2,
        autoimpresion: true
    });

    const first = await context.printingService.enqueue({
        documentType: 'prefactura',
        documentId: 'PF-1',
        documentNumber: 'PF-00000001',
        payload: { documento: 'prefactura', numero_documento: 'PF-00000001', items: [] }
    });
    assert.equal(first.destino_impresion, 'caja');
    assert.equal(first.impresora_nombre, 'Caja 80mm');
    assert.equal(first.tamano_papel, '80mm');
    assert.equal(first.copias_fisicas, 2);

    await context.printerConfigurationService.update('caja', {
        nombre: 'Caja Nueva',
        tamano_papel: '58mm',
        copias: 1
    });

    const replay = await context.printingService.enqueue({
        documentType: 'prefactura',
        documentId: 'PF-1',
        documentNumber: 'PF-00000001',
        payload: { documento: 'prefactura', numero_documento: 'PF-00000001', items: [] }
    });
    assert.equal(replay.id, first.id);
    assert.equal(replay.idempotency_replay, true);
    assert.equal(replay.impresora_nombre, 'Caja 80mm');
    assert.equal(replay.tamano_papel, '80mm');
    assert.equal(replay.copias_fisicas, 2);
});

test('las comandas se enrutan a Cocina o Bar según el destino canónico', async t => {
    const context = await createContext(t);
    await context.printerConfigurationService.update('cocina', { nombre: 'KDS Cocina', copias: 1 });
    await context.printerConfigurationService.update('bar', { nombre: 'Ticketera Bar', copias: 3 });

    const kitchen = await context.printingService.enqueue({
        documentType: 'comanda',
        documentId: 'CMD-1',
        payload: { documento: 'comanda', destino: 'cocina', items: [] }
    });
    const bar = await context.printingService.enqueue({
        documentType: 'comanda',
        documentId: 'CMD-2',
        payload: { documento: 'comanda', destino: 'bar', items: [] }
    });

    assert.equal(kitchen.destino_impresion, 'cocina');
    assert.equal(kitchen.impresora_nombre, 'KDS Cocina');
    assert.equal(bar.destino_impresion, 'bar');
    assert.equal(bar.impresora_nombre, 'Ticketera Bar');
    assert.equal(bar.copias_fisicas, 3);
});

test('la prueba de impresión ejecuta Printing y actualiza el estado del dispositivo', async t => {
    const context = await createContext(t);
    await context.printerConfigurationService.update('caja', {
        nombre: 'Caja Test',
        tamano_papel: '58mm',
        copias: 2
    });

    const result = await context.printingService.testPrinter('caja', {
        now: '2026-07-18T18:00:00.000Z'
    });

    assert.equal(result.configuracion.estado_dispositivo, 'disponible');
    assert.equal(result.configuracion.ultimo_test_en, '2026-07-18T18:00:00.000Z');
    assert.equal(result.salida.tamano_papel, '58mm');
    assert.equal(result.salida.copias_fisicas, 2);
    assert.match(result.salida.contenido, /Prueba de impresión/);
    assert.match(result.salida.contenido, /data-copy="2"/);
});
