const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('v3.7.0 mantiene versionado técnico consistente entre package, backend y PWA', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    const appInfo = read('server/config/appInfo.js');
    const sw = read('public/service-worker.js');
    const index = read('public/index.html');

    assert.equal(pkg.version, '3.7.0');
    assert.equal(lock.version, '3.7.0');
    assert.equal(lock.packages[''].version, '3.7.0');
    assert.match(appInfo, /STABILITY_TRACK = '3\.7\.0'/);
    assert.match(sw, /v3\.7\.0-cross-domain-closure/);
    assert.match(index, /v=3\.7\.0-cross-domain-closure/);
    assert.doesNotMatch(index, /v=3\.6\.0-legacy-cleanup/);
});

test('el cierre cuenta con matriz canónica y conserva los contratos financieros centrales', () => {
    const checklist = read('docs/checklist-cierre-mundipos-3.0.md');
    const advance = read('docs/avance-v3.7.0-cierre-mundipos-3.0.md');
    const accountContract = read('docs/contrato-v3.0-cuenta-global-fuente-financiera.md');
    const cashContract = read('docs/contrato-v3.0-operacion-caja-prefacturas.md');

    assert.match(checklist, /La cuenta global es la única venta financiera/);
    assert.match(checklist, /Pagar una prefactura no finaliza el servicio ni libera la mesa/);
    assert.match(checklist, /Kitchen conserva estado operativo independiente del estado de impresión/);
    assert.match(checklist, /Dashboard y reportes son de consulta/);
    assert.match(checklist, /Estado de V4/);
    assert.match(advance, /implementada y preparada para validación final/i);
    assert.match(accountContract, /cuenta global/i);
    assert.match(cashContract, /prefactura/i);
});

test('el roadmap marca v3.7.0 como cierre condicionado y no define todavía una fase v4 canónica', () => {
    const roadmap = read('docs/roadmap-v3.0-arquitectura-modular.md');
    assert.match(roadmap, /## v3\.7\.0 · Pruebas cruzadas y cierre MundiPOS 3\.0/);
    assert.match(roadmap, /Estado de implementación v3\.7\.0/);
    assert.match(roadmap, /pendiente de validación operativa y publicación/i);
    assert.doesNotMatch(roadmap, /^## v4(?:\.|\s)/mi);
});

test('package expone comandos dedicados para pruebas cruzadas y contrato de cierre', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['test:cross-domain'], 'node --test --test-concurrency=1 tests/mundiPos3CrossDomain.test.js');
    assert.equal(pkg.scripts['test:closure'], 'node --test --test-concurrency=1 tests/mundiPos3CrossDomain.test.js tests/mundiPos3ClosureContract.test.js');
});

test('la continuidad conserva el estado previo al cierre y el README refleja el cierre publicado', () => {
    const continuity = read('docs/PROMPT-CONTINUIDAD-MUNDIPOS-3.0.md');
    const readme = read('README.md');
    assert.match(continuity, /v3\.7\.0 · Pruebas cruzadas y cierre MundiPOS 3\.0/);
    assert.match(continuity, /pendiente de validación final/i);
    assert.match(readme, /v3\.7\.0 · Pruebas cruzadas y cierre MundiPOS 3\.0/);
    assert.match(readme, /MundiPOS 3\.0 cerrado, validado y publicado/i);
    assert.match(readme, /v3\.7\.0-fix1/i);
});
