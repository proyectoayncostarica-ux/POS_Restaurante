const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
function read(relative) {
    return fs.readFileSync(path.join(root, relative), 'utf8');
}

test('v3.4.0 registra Printing como servicio interno autenticado y no como módulo financiero', () => {
    const app = read('server/app.js');
    const service = read('server/services/printingService.js');
    const capabilities = read('server/security/capabilities.js');

    assert.match(app, /app\.use\('\/api\/printing', requireAuth, printingRoutes\)/);
    assert.match(app, /printingService\.recoverStale/);
    assert.match(service, /documento_tipo, documento_id, documento_numero, copia/);
    assert.match(service, /payload_fingerprint/);
    assert.match(service, /estado = 'fallido'/);
    assert.match(capabilities, /PRINTING_RETRY: 'printing\.retry'/);
    assert.match(capabilities, /PRINTING_CONFIGURE: 'printing\.configure'/);
    assert.doesNotMatch(service, /UPDATE\s+pagos/i);
    assert.doesNotMatch(service, /UPDATE\s+prefacturas/i);
    assert.doesNotMatch(service, /UPDATE\s+comandas/i);
});

test('el núcleo conserva explícitamente separación entre documento persistido e impresión física', () => {
    const service = read('server/services/printingService.js');
    const adapter = read('server/services/printingAdapters/browserPdfAdapter.js');
    const roadmap = read('docs/roadmap-v3.0-arquitectura-modular.md');

    assert.match(service, /async enqueue\(/);
    assert.match(service, /async processJob\(/);
    assert.match(service, /async retry\(/);
    assert.match(adapter, /vista_previa_navegador_pdf/);
    assert.match(roadmap, /Persistir el documento antes de imprimir/);
});
