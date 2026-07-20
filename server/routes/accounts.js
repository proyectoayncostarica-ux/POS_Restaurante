const express = require('express');
const requireCapability = require('../middleware/requireCapability');
const { CAPABILITIES } = require('../security/capabilities');
const creditService = require('../services/creditService');
const financialReadService = require('../services/financialReadService');
const documentPrintingService = require('../services/documentPrintingService');
const { ConflictError } = require('../errors/domainError');

const router = express.Router();

async function enqueuePrintingSafely(factory, context) {
    try { return await factory(); }
    catch (error) {
        console.error(`Printing no pudo encolar ${context}; la operación financiera ya permanece persistida:`, error);
        return { estado: 'encolado_fallido', error: error?.message || 'No fue posible crear el trabajo de impresión' };
    }
}

function sendError(res, error, fallbackMessage) {
    const status = Number(error?.status || error?.statusCode || 500);
    const expose = error?.expose !== false && status < 500;
    return res.status(status).json({
        error: expose ? error.message : fallbackMessage,
        code: error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'CREDIT_OPERATION_ERROR'),
        details: expose ? error?.details || null : null
    });
}

function readIdempotencyKey(req) {
    return req.get('Idempotency-Key')
        || req.get('X-Idempotency-Key')
        || req.body?.clave_idempotencia
        || req.body?.idempotencyKey;
}

function paymentInput(req, amountOverride = undefined) {
    return {
        creditId: req.params.id,
        cashierUserId: req.session.userId,
        amount: amountOverride ?? req.body?.monto ?? req.body?.monto_abono ?? req.body?.amount,
        paymentMethod: req.body?.metodo_pago ?? req.body?.paymentMethod,
        cashReceived: req.body?.monto_recibido ?? req.body?.cashReceived,
        reference: req.body?.referencia ?? req.body?.reference,
        paymentTenders: req.body?.medios_pago ?? req.body?.paymentTenders,
        idempotencyKey: readIdempotencyKey(req)
    };
}

router.get('/', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const data = await creditService.listCredits({
            state: req.query.estado || req.query.state,
            search: req.query.buscar || req.query.search
        });
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error obteniendo créditos:', error);
        sendError(res, error, 'Error interno obteniendo créditos');
    }
});

router.get('/summary/stats', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        res.json({ success: true, data: await creditService.getSummary() });
    } catch (error) {
        console.error('Error obteniendo resumen de créditos:', error);
        sendError(res, error, 'Error interno obteniendo resumen');
    }
});

router.get('/credit/:id', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        res.json({ success: true, data: await creditService.getCredit(req.params.id) });
    } catch (error) {
        console.error('Error obteniendo crédito:', error);
        sendError(res, error, 'Error interno obteniendo crédito');
    }
});

router.post('/credit/:id/reprint', requireCapability(CAPABILITIES.CASH_REPRINT), async (req, res) => {
    try {
        const printJob = await documentPrintingService.reprintCredit(req.params.id, { userId: req.session.userId });
        res.status(202).json({ success: true, printing: printJob });
    } catch (error) {
        console.error('Error preparando reimpresión de crédito:', error);
        sendError(res, error, 'Error interno preparando reimpresión');
    }
});

// Compatibilidad de Dashboard: :id continúa representando la cuenta global.
router.get('/:id', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        res.json({ success: true, data: await financialReadService.getAccountFinancialRead(req.params.id) });
    } catch (error) {
        console.error('Error obteniendo cuenta global:', error);
        sendError(res, error, 'Error interno obteniendo cuenta global');
    }
});

router.post('/', requireCapability(CAPABILITIES.CASH_COLLECT), async (_req, res) => {
    return sendError(res, new ConflictError(
        'Los créditos se formalizan únicamente desde una prefactura emitida en Caja.',
        { code: 'USE_PREINVOICE_CREDIT_FLOW' }
    ), 'No se pudo crear el crédito');
});

router.post('/:id/payment', requireCapability(CAPABILITIES.CASH_COLLECT), async (req, res) => {
    try {
        const result = await creditService.recordPayment(paymentInput(req));
        const printJob = await enqueuePrintingSafely(
            () => documentPrintingService.enqueuePayment(result.pago, { userId: req.session.userId }),
            `abono ${result.pago?.numero_pago || result.pago?.id}`
        );
        res.locals.realtime = {
            scope: 'creditos',
            orderIds: result?.cuenta_global?.id ? [Number(result.cuenta_global.id)] : [],
            requiredAnyCapabilities: [CAPABILITIES.CASH_ACCESS]
        };
        res.status(result.idempotency_replay ? 200 : 201).json({
            success: true,
            data: result,
            meta: { naturaleza: 'cobro_credito', venta_global_incrementada: false, mesa_liberada: false },
            printing: printJob
        });
    } catch (error) {
        console.error('Error procesando abono de crédito:', error);
        sendError(res, error, 'Error interno procesando abono');
    }
});

router.post('/:id/pay-full', requireCapability(CAPABILITIES.CASH_COLLECT), async (req, res) => {
    try {
        const credit = await creditService.getCredit(req.params.id);
        const result = await creditService.recordPayment(paymentInput(req, credit.saldo_pendiente));
        const printJob = await enqueuePrintingSafely(
            () => documentPrintingService.enqueuePayment(result.pago, { userId: req.session.userId }),
            `abono ${result.pago?.numero_pago || result.pago?.id}`
        );
        res.locals.realtime = {
            scope: 'creditos',
            orderIds: result?.cuenta_global?.id ? [Number(result.cuenta_global.id)] : [],
            requiredAnyCapabilities: [CAPABILITIES.CASH_ACCESS]
        };
        res.status(result.idempotency_replay ? 200 : 201).json({ success: true, data: result, printing: printJob });
    } catch (error) {
        console.error('Error saldando crédito:', error);
        sendError(res, error, 'Error interno saldando crédito');
    }
});

router.post('/:id/reprint', requireCapability(CAPABILITIES.CASH_REPRINT), async (req, res) => {
    try {
        const printJob = await documentPrintingService.reprintLatestAccountDocument(req.params.id, {
            userId: req.session.userId
        });
        res.status(202).json({
            success: true,
            message: 'Documento financiero enviado a la cola de reimpresión',
            printing: printJob
        });
    } catch (error) {
        console.error('Error preparando reimpresión:', error);
        sendError(res, error, 'Error interno preparando reimpresión');
    }
});

router.delete('/:id', requireCapability(CAPABILITIES.CASH_REVERSE), async (_req, res) => {
    return sendError(res, new ConflictError(
        'Los créditos auditables no se eliminan físicamente.',
        { code: 'CREDIT_PHYSICAL_DELETE_FORBIDDEN' }
    ), 'No se pudo eliminar el crédito');
});

module.exports = router;
