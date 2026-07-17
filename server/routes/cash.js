const express = require('express');
const database = require('../db/database');
const requireCapability = require('../middleware/requireCapability');
const { CAPABILITIES } = require('../security/capabilities');

const router = express.Router();

router.get('/summary', requireCapability(CAPABILITIES.CASH_ACCESS), async (req, res) => {
    try {
        const summary = await database.get(`
            SELECT
                COUNT(*) AS cuentas_pendientes,
                COALESCE(SUM(COALESCE(total_con_servicio, total, 0)), 0) AS consumo_pendiente
            FROM pedidos
            WHERE estado = 'pendiente'
        `);

        res.json({
            success: true,
            data: {
                cuentas_pendientes: Number(summary?.cuentas_pendientes || 0),
                consumo_pendiente: Number(summary?.consumo_pendiente || 0),
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
