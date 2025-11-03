const express = require('express');
const database = require('../db/database');

const router = express.Router();

// Obtener datos del dashboard
router.get('/', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const mesasLibres = await database.get('SELECT COUNT(*) as count FROM mesas WHERE estado = ?', ['libre']);
        const mesasOcupadas = await database.get('SELECT COUNT(*) as count FROM mesas WHERE estado = ?', ['ocupada']);
        const mesasReservadas = await database.get('SELECT COUNT(*) as count FROM mesas WHERE estado = ?', ['reservada']);

        const cuentasPendientes = await database.get('SELECT COUNT(*) as count FROM pedidos WHERE estado = ?', ['pendiente']);

        const cuentasPagadas = await database.get(
            'SELECT COUNT(p.id) as count FROM pedidos p JOIN pagos pa ON p.id = pa.pedido_id WHERE p.estado = ? AND DATE(p.fecha) = ? AND pa.metodo_pago IN (?, ?)',
            ['pagado', today, 'efectivo', 'tarjeta']
        );

        // Continúa igual pero agrega más logs después de cada bloque
        const creditosPagados = await database.get(
            'SELECT COUNT(*) as count FROM pagos_creditos WHERE DATE(fecha_pago) = ?',
            [today]
        );

        const creditosDisponibles = await database.get(
            'SELECT COUNT(*) as count FROM cuentas_credito'
        );

        const montoTotalCreditos = await database.get(
            'SELECT COALESCE(SUM(monto_total), 0) as total FROM cuentas_credito'
        );

        const ventasContado = await database.get(
            'SELECT COALESCE(SUM(p.total), 0) as total FROM pedidos p JOIN pagos pa ON p.id = pa.pedido_id WHERE p.estado = ? AND DATE(p.fecha) = ? AND pa.metodo_pago IN (?, ?)',
            ['pagado', today, 'efectivo', 'tarjeta']
        );

        const ventasCredito = await database.get(
            'SELECT COALESCE(SUM(monto_pagado), 0) as total FROM pagos_creditos WHERE DATE(fecha_pago) = ?',
            [today]
        );

        const ventasHoy = {
            total: (ventasContado.total || 0) + (ventasCredito.total || 0)
        };

        const usuarioActual = {
            id: req.session.userId,
            nombre: req.session.userName,
            tipo: req.session.userType
        };

        const mesasDetalle = await database.all(`
            SELECT 
                m.id,
                m.numero,
                m.estado,
                m.capacidad,
                m.cliente_nombre,
                m.fecha_apertura,
                m.hora_estimada,
                m.cantidad_personas,
                m.tipo_asiento,
                m.zona,
                p.id AS pedido_id,
                COALESCE(p.total, 0) AS monto_consumido
            FROM mesas m
            LEFT JOIN pedidos p ON m.id = p.mesa_id AND p.estado = 'pendiente'
`); // mismo query que tienes

        const ultimasCuentasPagadas = await database.all(`
            SELECT 
                p.id,
                p.total,
                p.fecha,
                m.numero AS mesa_numero,
                m.tipo_asiento,
                p.cliente_nombre
            FROM pedidos p
            JOIN mesas m ON p.mesa_id = m.id
            WHERE p.estado = 'pagado' AND DATE(p.fecha) = ?
            ORDER BY p.fecha DESC
            LIMIT 5
        `, [today]);
 // mismo query

        res.json({
            success: true,
            data: {
                mesasLibres: mesasLibres.count,
                mesasOcupadas: mesasOcupadas.count,
                mesasReservadas: mesasReservadas.count,
                cuentasPendientes: cuentasPendientes.count,
                cuentasPagadas: cuentasPagadas.count,
                creditosPagados: creditosPagados.count,
                creditosDisponibles: creditosDisponibles.count,
                montoTotalCreditos: montoTotalCreditos.total,
                ventasContado: ventasContado.total,
                ventasCredito: ventasCredito.total,
                ventasHoy: ventasHoy.total,
                usuarioActual,
                mesasDetalle,
                ultimasCuentasPagadas
            }
        });

    } catch (error) {
        console.error('❌ Error obteniendo datos del dashboard:', error); // <-- AQUI APARECERÁ LA CAUSA
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// Obtener detalle de ventas del día
router.get('/ventas-detalle', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        // Ventas de pedidos pagados
        const ventasDetalle = await database.all(`
    SELECT p.id, p.total, p.fecha as fecha_venta, 
           m.numero as mesa_numero, m.tipo as tipo_asiento,
           COALESCE(p.cliente_nombre, 'Cliente anónimo') as cliente_nombre,
           u.nombre as usuario_nombre
    FROM pedidos p
    JOIN mesas m ON p.mesa_id = m.id
    JOIN usuarios u ON p.usuario_id = u.id
    WHERE p.estado = 'pagado' AND DATE(p.fecha) = ?
    ORDER BY p.fecha DESC
`, [today]);


        res.json({
            success: true,
            data: ventasDetalle
        });
    } catch (error) {
        console.error('Error obteniendo detalle de ventas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener estadísticas de ventas por período
router.get('/stats/:period', async (req, res) => {
    try {
        const { period } = req.params;
        let dateFilter = '';
        let groupBy = '';

        switch (period) {
            case 'day':
                dateFilter = "DATE(fecha) = DATE('now')";
                groupBy = "strftime('%H', fecha)";
                break;
            case 'week':
                dateFilter = "DATE(fecha) >= DATE('now', '-7 days')";
                groupBy = "DATE(fecha)";
                break;
            case 'month':
                dateFilter = "DATE(fecha) >= DATE('now', '-30 days')";
                groupBy = "DATE(fecha)";
                break;
            default:
                return res.status(400).json({ error: 'Período inválido' });
        }

        const stats = await database.all(`
            SELECT ${groupBy} as periodo, 
                   COUNT(*) as pedidos, 
                   SUM(total) as ventas
            FROM pedidos 
            WHERE estado = 'pagado' AND ${dateFilter}
            GROUP BY ${groupBy}
            ORDER BY periodo
        `);

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;

