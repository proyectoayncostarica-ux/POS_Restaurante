const express = require('express');
const requireCapability = require('../middleware/requireCapability');
const { CAPABILITIES } = require('../security/capabilities');
const accountService = require('../services/accountService');
const financialReadService = require('../services/financialReadService');
const { getCostaRicaDayRange } = require('../services/financialReadService');
const { addMoney } = require('../utils/money');

const router = express.Router();

router.get('/summary', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const accounts = await accountService.listAccounts({ operationalState: 'abierta' });
        const pendingBalance = accounts.reduce(
            (total, account) => addMoney(total, account.saldo_pendiente || 0),
            0
        );
        const today = getCostaRicaDayRange();
        const financialToday = await financialReadService.getPeriodSummary({
            startIso: today.startIso,
            endIso: today.endIso
        });

        res.json({
            success: true,
            data: {
                cuentas_pendientes: accounts.filter(account => Number(account.saldo_pendiente || 0) > 0).length,
                cuentas_abiertas: accounts.length,
                consumo_pendiente: pendingBalance,
                cuentas_conciliadas_hoy: financialToday.cuentas_conciliadas,
                ventas_globales_hoy: financialToday.total_ventas_globales,
                cantidad_movimientos_caja_hoy: financialToday.cantidad_movimientos_caja,
                movimientos_caja_hoy: financialToday.total_movimientos_caja,
                diferencia_contextual_hoy: financialToday.diferencia_periodo,
                criterio_ventas: financialToday.criterio_fecha_ventas,
                criterio_movimientos: financialToday.criterio_fecha_movimientos,
                estado: 'lectura_financiera_consolidada',
                message: 'Caja distingue ventas globales conciliadas de movimientos individuales. El cobro transaccional por prefactura se implementará en v3.2.x.'
            }
        });
    } catch (error) {
        console.error('Error obteniendo resumen de Caja:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Error interno obteniendo Caja',
            code: error.code
        });
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
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Error interno obteniendo movimientos de Caja',
            code: error.code
        });
    }
});

router.get('/accounts/:id/financial-read', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const data = await financialReadService.getAccountFinancialRead(req.params.id);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error obteniendo lectura financiera de Caja:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Error interno obteniendo la cuenta global',
            code: error.code
        });
    }
});

module.exports = router;
