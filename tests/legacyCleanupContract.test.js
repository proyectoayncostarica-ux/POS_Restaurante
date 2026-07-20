const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const appSource = read('server/app.js');
const ordersRouteSource = read('server/routes/orders.js');
const accountsRouteSource = read('server/routes/accounts.js');
const creditsRouteSource = read('server/routes/credits.js');
const accountServiceSource = read('server/services/accountService.js');
const realtimeSource = read('server/utils/realtime.js');
const ordersUiSource = read('public/js/components/orders.js');
const orderWorkflowSource = read('public/js/services/order-workflow.js');
const dashboardSource = read('public/js/components/dashboard.js');
const serviceWorkerSource = read('public/service-worker.js');
const indexSource = read('public/index.html');


test('Accounts es la única API pública activa para créditos', () => {
    assert.match(appSource, /app\.use\('\/api\/accounts'/);
    assert.doesNotMatch(appSource, /app\.use\('\/api\/credits'/);
    assert.doesNotMatch(appSource, /creditsRoutes/);
    assert.match(creditsRouteSource, /module\.exports = require\('\.\/accounts'\)/);
    assert.doesNotMatch(creditsRouteSource, /router\.(get|post|put|patch|delete)\(/);
    assert.match(accountsRouteSource, /router\.post\('\/:id\/payment'/);
    assert.match(accountsRouteSource, /router\.post\('\/:id\/pay-full'/);
});


test('Orders ya no expone ni implementa pago monetario directo', () => {
    assert.doesNotMatch(ordersRouteSource, /router\.post\(["']\/:id\/pay["']/);
    assert.doesNotMatch(ordersRouteSource, /recordLegacyBalancePayment/);
    assert.doesNotMatch(accountServiceSource, /async recordLegacyBalancePayment\(/);
    assert.doesNotMatch(ordersUiSource, /async processPayment\(orderId\)/);
    assert.doesNotMatch(ordersUiSource, /async finalizePayment\(/);
    assert.doesNotMatch(ordersUiSource, /showAdminPasswordModal\(/);
    assert.doesNotMatch(ordersUiSource, /confirmAdminPassword\(/);
});


test('Orders no conserva placeholders de impresión ni fachada de pago obsoleta', () => {
    assert.doesNotMatch(ordersUiSource, /showPaymentModal\(orderId\)/);
    assert.doesNotMatch(ordersUiSource, /printComanda\(comandaId\)/);
    assert.doesNotMatch(ordersUiSource, /printReceipt\(paymentData\)/);
    assert.doesNotMatch(ordersUiSource, /Aquí se implementaría la lógica de impresión/);
    assert.doesNotMatch(ordersUiSource, /Printing se implementará en v3\.4/);
});


test('la navegación transversal Orders a Caja vive en un servicio frontend dedicado', () => {
    assert.match(ordersUiSource, /return OrderWorkflow\.openInCash\(orderId\)/);
    assert.match(orderWorkflowSource, /Navigation\.showSection\('cash'\)/);
    assert.match(orderWorkflowSource, /Cash\.focusAccount\(id\)/);
    assert.match(indexSource, /js\/services\/order-workflow\.js\?v=3\.7\.0-cross-domain-closure/);
});


test('Realtime deja de clasificar una API de créditos retirada', () => {
    assert.doesNotMatch(realtimeSource, /'\/api\/credits'/);
    assert.doesNotMatch(realtimeSource, /resource === 'credits'/);
    assert.match(realtimeSource, /resource === 'accounts'/);
});


test('Dashboard continúa siendo solo lectura financiera', () => {
    assert.doesNotMatch(dashboardSource, /Orders\.showPaymentModal/);
    assert.doesNotMatch(dashboardSource, /abrirProcesarPago/);
    assert.doesNotMatch(dashboardSource, /method:\s*['"]POST['"][\s\S]{0,120}cash\/payments/);
});


test('PWA conserva la limpieza estructural dentro del cierre v3.7.0', () => {
    assert.match(serviceWorkerSource, /v3\.7\.0-cross-domain-closure/);
    assert.match(serviceWorkerSource, /services\/order-workflow\.js\?v=3\.7\.0-cross-domain-closure/);
});
