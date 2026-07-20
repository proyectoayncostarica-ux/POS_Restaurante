const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('Configuración expone Impresoras como pestaña interna y no como módulo principal', () => {
    const main = read('public/js/main.js');
    const settings = read('public/js/components/settings.js');
    const index = read('public/index.html');

    assert.match(main, /settings:\s*\[[\s\S]*id:\s*'printers'/);
    assert.match(settings, /renderPrintersView\(\)/);
    assert.match(settings, /Caja[\s\S]*Cocina[\s\S]*Bar/);
    assert.doesNotMatch(index, /data-section="printing"/);
});

test('Settings guarda configuración y Printing ejecuta estado y prueba de dispositivo', () => {
    const settingsRoutes = read('server/routes/settings.js');
    const printingRoutes = read('server/routes/printing.js');
    const printingService = read('server/services/printingService.js');

    assert.match(settingsRoutes, /router\.put\('\/printers\/:destination'/);
    assert.match(printingRoutes, /router\.post\('\/printers\/:destination\/test'/);
    assert.match(printingRoutes, /router\.get\('\/printers\/status'/);
    assert.match(printingService, /testPrinter\(destination/);
    assert.match(printingService, /resolveJobConfiguration/);
});

test('los trabajos conservan snapshot de destino, dispositivo, papel, copias y autoimpresión', () => {
    const database = read('server/db/database.js');
    const printingService = read('server/services/printingService.js');

    for (const column of [
        'destino_impresion',
        'impresora_nombre',
        'tamano_papel',
        'copias_fisicas',
        'autoimpresion',
        'configuracion_impresion_json'
    ]) {
        assert.match(database, new RegExp(column));
        assert.match(printingService, new RegExp(column));
    }
});
