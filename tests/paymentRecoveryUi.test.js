const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Caja reintenta un cobro ambiguo únicamente con la misma clave idempotente', () => {
    const main = read('public/js/main.js');
    const cash = read('public/js/components/cash.js');

    assert.match(main, /async requestIdempotent\(/);
    assert.match(main, /Idempotency-Key/);
    assert.match(main, /error\?\.isNetworkError === true \|\| Number\(error\?\.status \|\| 0\) >= 500/);
    assert.match(cash, /Utils\.requestIdempotent\(`\/cash\/preinvoices\/\$\{preinvoiceId\}\/payments`/);
    assert.match(cash, /headers: \{ 'Idempotency-Key': idempotencyKey \}/);
});
