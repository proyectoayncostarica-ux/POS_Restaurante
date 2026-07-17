const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ordersSource = fs.readFileSync(path.join(root, 'public/js/components/orders.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'server/routes/orders.js'), 'utf8');
const realtimeSource = fs.readFileSync(path.join(root, 'server/utils/realtime.js'), 'utf8');

test('Ver pedido expone división de una sola subcuenta con cantidad y minimodal', () => {
    assert.match(ordersSource, /Cuenta dividida/);
    assert.match(ordersSource, /preinvoice-line-check/);
    assert.match(ordersSource, /preinvoice-quantity-input/);
    assert.match(ordersSource, /Confirmar prefactura/);
    assert.match(ordersSource, /Imprimir y emitir/);
    assert.match(ordersSource, /Volver/);
});

test('frontend emite un único documento por solicitud y vuelve al consumo restante', () => {
    assert.match(ordersSource, /\/orders\/\$\{draft\.orderId\}\/preinvoices/);
    assert.match(ordersSource, /clave_idempotencia/);
    assert.match(ordersSource, /await this\.viewOrder\(draft\.orderId\)/);
});

test('backend protege emisión y retira la división legacy insegura', () => {
    assert.match(routeSource, /ORDERS_ISSUE_PREINVOICE/);
    assert.match(routeSource, /ORDERS_SPLIT/);
    assert.match(routeSource, /USE_PREINVOICE_SPLIT_FLOW/);
    assert.match(routeSource, /ACCOUNT_REQUIRES_PREINVOICE_PAYMENT/);
});

test('emisión de prefacturas se publica como cambio de cuentas para atención y Caja', () => {
    assert.match(realtimeSource, /segments\.includes\('preinvoices'\).*'cuentas'/);
});
