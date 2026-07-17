const express = require('express');
const requireCapability = require('../middleware/requireCapability');
const { CAPABILITIES } = require('../security/capabilities');
const accountService = require('../services/accountService');
const financialReadService = require('../services/financialReadService');
const cashReadService = require('../services/cashReadService');
const paymentService = require('../services/paymentService');
const { getCostaRicaDayRange } = require('../services/financialReadService');
const { addMoney } = require('../utils/money');

const router = express.Router();

function sendError(res, error, fallbackMessage) {
    const status = Number(error?.status || error?.statusCode || 500);
    const expose = error?.expose !== false && status < 500;
    return res.status(status).json({
        error: expose ? error.message : fallbackMessage,
        code: error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'CASH_OPERATION_ERROR'),
        details: expose ? error?.details || null : null
    });
}

function readIdempotencyKey(req) {
    return req.get('Idempotency-Key')
        || req.get('X-Idempotency-Key')
        || req.body?.clave_idempotencia
        || req.body?.idempotencyKey;
}

function setPaymentRealtime(res, result) {
    const accountId = Number(result?.cuenta_global?.id || result?.pago?.pedido_id || 0);
    res.locals.realtime = {
        scope: 'pagos',
        orderIds: accountId ? [accountId] : [],
        requiredAnyCapabilities: [CAPABILITIES.CASH_ACCESS]
    };
}

router.get('/summary', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const accounts = await accountService.listAccounts({ operationalState: 'abierta' });
        const pendingBalance = accounts.reduce(
            (total, account) => addMoney(total, account.saldo_pendiente || 0),
            0
        );
        const today = getCostaRicaDayRange();
        const [financialToday, queue] = await Promise.all([
            financialReadService.getPeriodSummary({
                startIso: today.startIso,
                endIso: today.endIso
            }),
            cashReadService.listCollectionQueue({ state: 'pendiente', limit: 200 })
        ]);

        res.json({
            success: true,
            data: {
                cuentas_pendientes: queue.resumen.cuentas_en_resultado,
                prefacturas_pendientes: queue.resumen.total_documentos,
                cuentas_divididas_pendientes: queue.resumen.cuentas_divididas,
                cuentas_abiertas: accounts.length,
                consumo_pendiente: pendingBalance,
                saldo_documental_visible: queue.resumen.saldo_visible,
                cuentas_conciliadas_hoy: financialToday.cuentas_conciliadas,
                ventas_globales_hoy: financialToday.total_ventas_globales,
                cantidad_movimientos_caja_hoy: financialToday.cantidad_movimientos_caja,
                movimientos_caja_hoy: financialToday.total_movimientos_caja,
                diferencia_contextual_hoy: financialToday.diferencia_periodo,
                criterio_ventas: financialToday.criterio_fecha_ventas,
                criterio_movimientos: financialToday.criterio_fecha_movimientos,
                estado: 'api_caja_operativa',
                message: 'Caja consulta prefacturas y registra cobros vinculados al documento sin duplicar la venta global.'
            }
        });
    } catch (error) {
        console.error('Error obteniendo resumen de Caja:', error);
        sendError(res, error, 'Error interno obteniendo Caja');
    }
});

router.get('/queue', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const data = await cashReadService.listCollectionQueue({
            state: req.query.estado || req.query.state,
            search: req.query.buscar || req.query.search || req.query.q,
            limit: req.query.limite || req.query.limit,
            offset: req.query.desde || req.query.offset
        });
        res.json({
            success: true,
            data,
            meta: {
                fuente_financiera: 'cuenta_global',
                unidad_operativa_cobro: 'prefactura',
                permite_buscar_por: [
                    'numero_documento',
                    'numero_cuenta',
                    'mesa_banco',
                    'zona',
                    'cliente_principal',
                    'pagador',
                    'responsable'
                ]
            }
        });
    } catch (error) {
        console.error('Error obteniendo cola operativa de Caja:', error);
        sendError(res, error, 'Error interno obteniendo la cola de Caja');
    }
});

router.get('/preinvoices/:preinvoiceId', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const data = await cashReadService.getPreinvoiceCollectionRead(req.params.preinvoiceId);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error obteniendo prefactura para Caja:', error);
        sendError(res, error, 'Error interno obteniendo la prefactura');
    }
});

router.post('/preinvoices/:preinvoiceId/reprint-request', requireCapability(CAPABILITIES.CASH_REPRINT), async (req, res) => {
    try {
        const data = await cashReadService.registerReprintRequest({
            preinvoiceId: req.params.preinvoiceId,
            userId: req.session.userId
        });
        res.locals.realtime = {
            scope: 'caja',
            orderIds: data?.cuenta_global?.id ? [Number(data.cuenta_global.id)] : [],
            requiredAnyCapabilities: [CAPABILITIES.CASH_ACCESS]
        };
        res.status(202).json({ success: true, data });
    } catch (error) {
        console.error('Error solicitando reimpresión desde Caja:', error);
        sendError(res, error, 'Error interno solicitando la reimpresión');
    }
});

router.get('/preinvoices/:preinvoiceId/payments', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const payments = await paymentService.listByPreinvoice(req.params.preinvoiceId);
        res.json({
            success: true,
            data: payments,
            meta: {
                prefactura_id: Number(req.params.preinvoiceId),
                confirmados: payments.filter(payment => payment.estado === 'confirmado').length,
                anulados: payments.filter(payment => payment.estado === 'anulado').length,
                total_confirmado: payments
                    .filter(payment => payment.estado === 'confirmado')
                    .reduce((sum, payment) => addMoney(sum, payment.monto), 0)
            }
        });
    } catch (error) {
        console.error('Error obteniendo pagos de prefactura:', error);
        sendError(res, error, 'Error interno obteniendo pagos');
    }
});

router.post('/preinvoices/:preinvoiceId/payments', requireCapability(CAPABILITIES.CASH_COLLECT), async (req, res) => {
    try {
        const result = await paymentService.recordPreinvoicePayment({
            preinvoiceId: req.params.preinvoiceId,
            cashierUserId: req.session.userId,
            amount: req.body?.monto ?? req.body?.amount,
            paymentMethod: req.body?.metodo_pago ?? req.body?.paymentMethod,
            reference: req.body?.referencia ?? req.body?.reference,
            idempotencyKey: readIdempotencyKey(req)
        });
        setPaymentRealtime(res, result);
        res.status(result.idempotency_replay ? 200 : 201).json({
            success: true,
            data: result,
            meta: {
                idempotency_replay: result.idempotency_replay === true,
                mesa_liberada: false,
                cuenta_global_permanece_operativa: result.cuenta_global?.estado_operativo === 'abierta'
            }
        });
    } catch (error) {
        console.error('Error registrando pago de prefactura:', error);
        sendError(res, error, 'Error interno registrando el pago');
    }
});

router.get('/payments/:paymentId', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const data = await paymentService.getPayment(req.params.paymentId);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error obteniendo pago de Caja:', error);
        sendError(res, error, 'Error interno obteniendo el pago');
    }
});

router.post('/payments/:paymentId/void', requireCapability(CAPABILITIES.CASH_REVERSE), async (req, res) => {
    try {
        const result = await paymentService.voidPayment({
            paymentId: req.params.paymentId,
            userId: req.session.userId,
            reason: req.body?.motivo ?? req.body?.reason,
            idempotencyKey: readIdempotencyKey(req)
        });
        setPaymentRealtime(res, result);
        res.json({
            success: true,
            data: result,
            meta: {
                reverso_auditable: true,
                pago_eliminado: false,
                mesa_liberada: false
            }
        });
    } catch (error) {
        console.error('Error reversando pago de Caja:', error);
        sendError(res, error, 'Error interno reversando el pago');
    }
});

router.get('/accounts/:id/collection-read', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const data = await cashReadService.getAccountCollectionRead(req.params.id);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error obteniendo lectura operativa de cobro:', error);
        sendError(res, error, 'Error interno obteniendo la cuenta de Caja');
    }
});

router.get('/movements', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const today = getCostaRicaDayRange();
        const startIso = req.query.desde || req.query.start || today.startIso;
        const endIso = req.query.hasta || req.query.end || today.endIso;
        const movements = await financialReadService.listCashMovements({
            startIso,
            endIso,
            limit: req.query.limite || 500
        });

        res.json({
            success: true,
            data: movements,
            meta: {
                fuente: 'movimientos_caja',
                desde: startIso,
                hasta: endIso,
                cantidad: movements.length,
                total: movements.reduce((sum, movement) => addMoney(sum, movement.monto), 0)
            }
        });
    } catch (error) {
        console.error('Error obteniendo movimientos de Caja:', error);
        sendError(res, error, 'Error interno obteniendo movimientos de Caja');
    }
});

router.get('/accounts/:id/financial-read', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const data = await financialReadService.getAccountFinancialRead(req.params.id);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error obteniendo lectura financiera de Caja:', error);
        sendError(res, error, 'Error interno obteniendo la cuenta global');
    }
});

module.exports = router;
