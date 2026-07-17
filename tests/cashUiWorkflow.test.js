const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cashSource = fs.readFileSync(path.join(root, 'public/js/components/cash.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'public/js/components/dashboard.js'), 'utf8');
const ordersSource = fs.readFileSync(path.join(root, 'public/js/components/orders.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const serviceWorkerSource = fs.readFileSync(path.join(root, 'public/service-worker.js'), 'utf8');


test('Caja visual consulta cola, detalle y movimientos mediante la API autorizada', () => {
    assert.match(cashSource, /\/cash\/queue\?/);
    assert.match(cashSource, /\/cash\/preinvoices\/\$\{id\}/);
    assert.match(cashSource, /\/cash\/movements/);
    assert.match(cashSource, /Bandeja de cobro/);
    assert.match(cashSource, /Prefacturas/);
    assert.match(cashSource, /Movimientos de Caja del día/);
});


test('modal de cobro registra una prefactura con idempotencia y bloqueo local', () => {
    assert.match(cashSource, /Cobrar \$\{this\.escapeHTML\(preinvoice\.numero_documento\)\}/);
    assert.match(cashSource, /cash-payment-idempotency/);
    assert.match(cashSource, /Idempotency-Key/);
    assert.match(cashSource, /paymentSubmitting/);
    assert.match(cashSource, /El total aplicado no puede superar el saldo/);
    assert.match(cashSource, /La mesa continúa abierta hasta finalizar el servicio/);
});


test('Caja separa consulta, cobro y reimpresión por capacidades', () => {
    assert.match(cashSource, /cash\.access/);
    assert.match(cashSource, /cash\.collect/);
    assert.match(cashSource, /cash\.reprint/);
    assert.match(cashSource, /requestReprint/);
});


test('Dashboard deja de abrir el modal de pago y Orders delega a Caja', () => {
    assert.doesNotMatch(dashboardSource, /Orders\.showPaymentModal/);
    assert.doesNotMatch(dashboardSource, /abrirProcesarPago/);
    assert.match(ordersSource, /async openInCash\(orderId\)/);
    assert.match(ordersSource, /Navigation\.showSection\('cash'\)/);
    assert.match(ordersSource, /Cash\.focusAccount\(orderId\)/);
    assert.match(ordersSource, /return this\.openInCash\(orderId\)/);
});


test('interfaz de Caja tiene distribución adaptable para PC y móvil', () => {
    assert.match(styleSource, /\.cash-workspace/);
    assert.match(styleSource, /\.modal-content\.modal-cash-payment/);
    assert.match(styleSource, /@media \(max-width: 900px\)/);
    assert.match(styleSource, /@media \(max-width: 640px\)/);
});


test('PWA utiliza caché específico de v3.2.4 para cargar créditos integrados', () => {
    assert.match(serviceWorkerSource, /v3\.2\.4-credit-payments/);
    assert.match(serviceWorkerSource, /components\/cash\.js\?v=3\.2\.4-credit-payments/);
});

test('modal de Caja permite efectivo, tarjeta y pago mixto con cálculo de vuelto', () => {
    assert.match(cashSource, /Mixto: efectivo \+ tarjeta/);
    assert.match(cashSource, /cash-payment-cash-received/);
    assert.match(cashSource, /cash-payment-mixed-cash/);
    assert.match(cashSource, /cash-payment-mixed-card/);
    assert.match(cashSource, /cash-payment-change/);
    assert.match(cashSource, /medios_pago/);
    assert.match(styleSource, /\.cash-payment-calculation/);
    assert.match(styleSource, /\.cash-mixed-grid/);
});
