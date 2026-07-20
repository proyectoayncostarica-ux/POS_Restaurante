const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('v3.5.1 identifica instancia/version del servidor y exige recuperación tras huecos o reinicios', () => {
    const realtime = read('server/utils/realtime.js');
    const app = read('server/app.js');

    assert.match(realtime, /serverInstanceId/);
    assert.match(realtime, /serverTrack: STABILITY_TRACK/);
    assert.match(realtime, /recoveryRequired: serverRestarted \|\| eventGap/);
    assert.match(realtime, /version-obsolete/);
    assert.match(realtime, /function stateHandler/);
    assert.match(app, /app\.get\('\/api\/realtime\/state', requireAuth, realtime\.stateHandler\)/);
    assert.match(app, /X-MundiPOS-Version/);
});

test('el cliente usa realtime como señal y recupera la vista desde APIs persistentes al reconectar', () => {
    const main = read('public/js/main.js');

    assert.match(main, /scheduleRecovery\(/);
    assert.match(main, /recoverOperationalState\(/);
    assert.match(main, /await Utils\.request\('\/realtime\/state'\)/);
    assert.match(main, /scope: 'recuperacion'/);
    assert.match(main, /Cash\.load\(\{ source: payload\.recovery \? 'recovery' : 'realtime'/);
    assert.match(main, /Kitchen\.load\(\{ source: payload\.recovery \? 'recovery' : 'realtime'/);
    assert.doesNotMatch(main, /setInterval\([^)]*recoverOperationalState/);
});

test('Printing emite su estado realtime sin convertir el evento en fuente de verdad', () => {
    const documents = read('server/services/documentPrintingService.js');
    const realtime = read('server/utils/realtime.js');

    assert.match(documents, /type: 'printing-change'/);
    assert.match(documents, /scope: 'impresion'/);
    assert.match(documents, /printingState: job\?\.estado/);
    assert.match(realtime, /if \(resource === 'printing'\) return 'impresion'/);
});
