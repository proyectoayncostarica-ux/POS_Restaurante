const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Caja formaliza crédito por prefactura con autorización administrativa', () => {
    const cash = read('public/js/components/cash.js');
    const route = read('server/routes/cash.js');
    assert.match(cash, /openCreditModal/);
    assert.match(cash, /admin_password/);
    assert.match(cash, /\/cash\/preinvoices\/\$\{preinvoiceId\}\/credit/);
    assert.match(route, /preinvoices\/:preinvoiceId\/credit/);
    assert.match(route, /creditService\.formalizePreinvoiceCredit/);
});

test('Créditos visibles no permiten creación manual ni eliminación física', () => {
    const accounts = read('public/js/components/accounts.js');
    const accountRoutes = read('server/routes/accounts.js');
    const legacyRoutes = read('server/routes/credits.js');
    assert.doesNotMatch(accounts, /Nuevo Crédito/);
    assert.match(accounts, /Los créditos se crean únicamente desde prefacturas/);
    assert.match(accountRoutes, /USE_PREINVOICE_CREDIT_FLOW/);
    assert.match(accountRoutes, /CREDIT_PHYSICAL_DELETE_FORBIDDEN/);
    assert.match(legacyRoutes, /delega en el dominio canónico/);
});

test('abonos de créditos conservan idempotencia y medios de pago', () => {
    const accounts = read('public/js/components/accounts.js');
    const routes = read('server/routes/accounts.js');
    assert.match(accounts, /Idempotency-Key/);
    assert.match(accounts, /medios_pago/);
    assert.match(accounts, /monto_recibido/);
    assert.match(routes, /creditService\.recordPayment/);
    assert.match(routes, /naturaleza: 'cobro_credito'/);
});

test('Orders bloquea el crédito legacy que liberaba la mesa', () => {
    const orders = read('server/routes/orders.js');
    assert.match(orders, /USE_PREINVOICE_CREDIT_FLOW/);
    assert.doesNotMatch(orders, /UPDATE mesas SET estado = \?, cliente_nombre = NULL[\s\S]{0,120}metodo_pago === 'credito'/);
});

test('PWA conserva Créditos y Caja dentro del caché vigente de v3.3.0', () => {
    const sw = read('public/service-worker.js');
    const index = read('public/index.html');
    assert.match(sw, /v3\.3\.0-kitchen-domain/);
    assert.match(index, /accounts\.js\?v=3\.3\.0-kitchen-domain/);
    assert.match(index, /cash\.js\?v=3\.3\.0-kitchen-domain/);
});
