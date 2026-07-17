// Adaptador legacy. Mantiene /api/credits, pero delega en el dominio canónico.
const express = require('express');
const requireCapability = require('../middleware/requireCapability');
const { CAPABILITIES } = require('../security/capabilities');
const creditService = require('../services/creditService');
const { ConflictError } = require('../errors/domainError');

const router = express.Router();

function sendError(res, error, fallbackMessage) {
    const status = Number(error?.status || 500);
    const expose = error?.expose !== false && status < 500;
    return res.status(status).json({
        error: expose ? error.message : fallbackMessage,
        code: error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'CREDIT_OPERATION_ERROR'),
        details: expose ? error?.details || null : null
    });
}

function idempotency(req) {
    return req.get('Idempotency-Key') || req.get('X-Idempotency-Key')
        || req.body?.clave_idempotencia || req.body?.idempotencyKey;
}

function input(req, amount) {
    return {
        creditId: req.params.id,
        cashierUserId: req.session.userId,
        amount: amount ?? req.body?.monto ?? req.body?.monto_abono,
        paymentMethod: req.body?.metodo_pago,
        cashReceived: req.body?.monto_recibido,
        reference: req.body?.referencia,
        paymentTenders: req.body?.medios_pago,
        idempotencyKey: idempotency(req)
    };
}

router.get('/summary/stats', requireCapability(CAPABILITIES.CASH_ACCESS), async (_req, res) => {
    try { res.json({ success: true, data: await creditService.getSummary() }); }
    catch (error) { sendError(res, error, 'Error interno obteniendo resumen'); }
});

router.get('/', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try { res.json({ success: true, data: await creditService.listCredits(req.query) }); }
    catch (error) { sendError(res, error, 'Error interno obteniendo créditos'); }
});

router.get('/:id', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try { res.json({ success: true, data: await creditService.getCredit(req.params.id) }); }
    catch (error) { sendError(res, error, 'Error interno obteniendo crédito'); }
});

router.post('/', requireCapability(CAPABILITIES.CASH_COLLECT), async (_req, res) => {
    sendError(res, new ConflictError('Use una prefactura desde Caja para formalizar el crédito.', {
        code: 'USE_PREINVOICE_CREDIT_FLOW'
    }), 'No se pudo crear el crédito');
});

router.post('/:id/payment', requireCapability(CAPABILITIES.CASH_COLLECT), async (req, res) => {
    try { res.status(201).json({ success: true, data: await creditService.recordPayment(input(req)) }); }
    catch (error) { sendError(res, error, 'Error interno procesando abono'); }
});

router.post('/:id/pay', requireCapability(CAPABILITIES.CASH_COLLECT), async (req, res) => {
    try {
        const credit = await creditService.getCredit(req.params.id);
        res.status(201).json({
            success: true,
            data: await creditService.recordPayment(input(req, credit.saldo_pendiente))
        });
    } catch (error) { sendError(res, error, 'Error interno saldando crédito'); }
});

router.delete('/:id', requireCapability(CAPABILITIES.CASH_REVERSE), async (_req, res) => {
    sendError(res, new ConflictError('Los créditos auditables no se eliminan físicamente.', {
        code: 'CREDIT_PHYSICAL_DELETE_FORBIDDEN'
    }), 'No se pudo eliminar el crédito');
});

module.exports = router;
