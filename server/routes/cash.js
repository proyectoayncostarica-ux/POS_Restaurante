const express = require('express');
const requireCapability = require('../middleware/requireCapability');
const { CAPABILITIES } = require('../security/capabilities');
const accountService = require('../services/accountService');
const { addMoney } = require('../utils/money');

const router = express.Router();

router.get('/summary', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const accounts = await accountService.listAccounts({ operationalState: 'abierta' });
        const pendingBalance = accounts.reduce(
            (total, account) => addMoney(total, account.saldo_pendiente || 0),
            0
        );

        res.json({
            success: true,
            data: {
                cuentas_pendientes: accounts.filter(account => Number(account.saldo_pendiente || 0) > 0).length,
                cuentas_abiertas: accounts.length,
                consumo_pendiente: pendingBalance,
                estado: 'base_autorizada',
                message: 'Caja autorizada. El flujo transaccional de cobro se implementará en v3.2.x.'
            }
        });
    } catch (error) {
        console.error('Error obteniendo resumen de Caja:', error);
        res.status(500).json({ error: 'Error interno obteniendo Caja' });
    }
});

module.exports = router;
