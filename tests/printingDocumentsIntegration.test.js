const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('v3.4.1 centraliza los payloads canónicos de documentos en DocumentPrintingService', () => {
    const service = read('server/services/documentPrintingService.js');

    for (const token of [
        "PREINVOICE: 'prefactura'",
        "PARTIAL_PREINVOICE: 'prefactura_parcial'",
        "PAYMENT_RECEIPT: 'recibo_cobro'",
        "CREDIT_VOUCHER: 'comprobante_credito'",
        "CREDIT_PAYMENT: 'abono_credito'",
        "KITCHEN_COMMAND: 'comanda'",
        "DAILY_CLOSE: 'cierre_diario'"
    ]) {
        assert.match(service, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }

    assert.match(service, /buildPreinvoiceDescriptor/);
    assert.match(service, /buildPaymentDescriptor/);
    assert.match(service, /buildCreditDescriptor/);
    assert.match(service, /buildKitchenDescriptor/);
    assert.match(service, /enqueueDailyClose/);
    assert.doesNotMatch(service, /UPDATE\s+prefacturas/i);
    assert.doesNotMatch(service, /UPDATE\s+pagos/i);
    assert.doesNotMatch(service, /UPDATE\s+cuentas_credito/i);
    assert.doesNotMatch(service, /UPDATE\s+comandas/i);
});

test('Orders, Caja, Créditos y Kitchen encolan después de persistir y no contienen plantillas duplicadas', () => {
    const orders = read('server/routes/orders.js');
    const cash = read('server/routes/cash.js');
    const accounts = read('server/routes/accounts.js');
    const credits = read('server/routes/credits.js');
    const kitchen = read('server/routes/kitchen.js');

    assert.match(orders, /createPreinvoice[\s\S]*enqueuePreinvoice/);
    assert.match(orders, /createAccount[\s\S]*enqueueKitchenCommands/);
    assert.match(cash, /recordPreinvoicePayment[\s\S]*enqueuePayment/);
    assert.match(cash, /formalizePreinvoiceCredit[\s\S]*enqueueCredit/);
    assert.match(accounts, /recordPayment[\s\S]*enqueuePayment/);
    assert.match(credits, /recordPayment[\s\S]*enqueuePayment/);
    assert.match(kitchen, /requestDispatch[\s\S]*enqueueKitchenCommands/);
    assert.match(kitchen, /resend[\s\S]*enqueueKitchenCommand/);

    for (const source of [orders, cash, accounts, credits, kitchen]) {
        assert.doesNotMatch(source, /<html|<body|<h1|@media\s+print/i);
    }

    const ordersUi = read('public/js/components/orders.js');
    const cashUi = read('public/js/components/cash.js');
    const printingClient = read('public/js/services/printing-client.js');

    assert.match(ordersUi, /PrintingClient\.openJob/);
    assert.match(cashUi, /PrintingClient\.openJob/);
    assert.doesNotMatch(ordersUi, /@media\s+print|class=\"totals\"|La cuenta global es la única fuente financiera de la venta/i);
    assert.doesNotMatch(cashUi, /@media\s+print|class=\"totals\"|La cuenta global es la única fuente financiera de la venta/i);
    assert.match(printingClient, /resultado/);
    assert.match(printingClient, /contenido/);
});

test('la reimpresión conserva el documento y reserva una nueva copia auditable', () => {
    const printing = read('server/services/printingService.js');
    const documents = read('server/services/documentPrintingService.js');
    const cash = read('server/routes/cash.js');

    assert.match(printing, /async enqueueNextCopy/);
    assert.match(printing, /MAX\(copia\)/);
    assert.match(documents, /enqueueReprintDescriptor/);
    assert.match(documents, /\.\.\.descriptor/);
    assert.match(documents, /reprintPreinvoice/);
    assert.match(documents, /reprintPayment/);
    assert.match(documents, /reprintCredit/);
    assert.match(cash, /reprintPreinvoice/);
    assert.match(cash, /printJobId/);
    assert.match(read('server/services/cashReadService.js'), /trabajo_impresion_id/);
});

test('el cierre diario y el reintento de trabajos permanecen dentro del servicio Printing', () => {
    const route = read('server/routes/printing.js');
    const core = read('server/services/printingService.js');

    assert.match(route, /documents\/daily-close/);
    assert.match(route, /enqueueDailyClose/);
    assert.match(core, /async retry\(/);
    assert.match(core, /Solo un trabajo fallido puede reintentarse/);
});
