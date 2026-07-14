const express = require('express');
const database = require('../db/database');

const router = express.Router();
const COSTA_RICA_UTC_OFFSET_HOURS = 6;

function createZoneSummary(label) {
    return {
        label,
        total: 0,
        libres: 0,
        ocupadas: 0,
        reservadas: 0,
        consumo: 0
    };
}

function normalizeZoneKey(row) {
    const zona = String(row.zona || 'salon').trim().toLowerCase();
    const tipoAsiento = String(row.tipo_asiento || 'mesa').trim().toLowerCase();

    if (zona === 'bar' && tipoAsiento === 'banco') return 'bar-banco';
    if (zona === 'bar') return 'bar-mesa';
    return 'salon';
}

function normalizeEstado(estado) {
    const value = String(estado || 'libre').trim().toLowerCase();
    const aliases = {
        disponible: 'libre',
        libre: 'libre',
        ocupada: 'ocupada',
        ocupado: 'ocupada',
        activa: 'ocupada',
        activo: 'ocupada',
        reservada: 'reservada',
        reservado: 'reservada'
    };

    return aliases[value] || 'libre';
}

function addMesaToSummary(summary, mesa) {
    const estado = normalizeEstado(mesa.estado);
    const monto = Number(mesa.monto_consumido) || 0;

    summary.total += 1;
    if (estado === 'libre') summary.libres += 1;
    if (estado === 'ocupada') summary.ocupadas += 1;
    if (estado === 'reservada') summary.reservadas += 1;
    if (monto > 0) summary.consumo += monto;
}

function buildOperationalSummary(mesasDetalle = []) {
    const zonas = {
        todos: createZoneSummary('Todos'),
        salon: createZoneSummary('Salón'),
        'bar-mesa': createZoneSummary('Bar'),
        'bar-banco': createZoneSummary('Barra')
    };

    mesasDetalle.forEach(mesa => {
        const zoneKey = normalizeZoneKey(mesa);
        addMesaToSummary(zonas.todos, mesa);
        addMesaToSummary(zonas[zoneKey], mesa);
    });

    return {
        zonas,
        totales: {
            mesasLibres: zonas.salon.libres + zonas['bar-mesa'].libres,
            mesasOcupadas: zonas.salon.ocupadas + zonas['bar-mesa'].ocupadas,
            mesasReservadas: zonas.salon.reservadas + zonas['bar-mesa'].reservadas,
            bancosLibres: zonas['bar-banco'].libres,
            bancosOcupados: zonas['bar-banco'].ocupadas,
            bancosReservados: zonas['bar-banco'].reservadas
        }
    };
}

function getCostaRicaDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Costa_Rica',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);

    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        dateKey: `${values.year}-${values.month}-${values.day}`
    };
}

function getCostaRicaDayRange(date = new Date()) {
    const { year, month, day, dateKey } = getCostaRicaDateParts(date);
    const start = new Date(Date.UTC(year, month - 1, day, COSTA_RICA_UTC_OFFSET_HOURS, 0, 0, 0));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    return {
        dateKey,
        startIso: start.toISOString(),
        endIso: end.toISOString()
    };
}

function createDateRangeCondition(fieldName) {
    return `${fieldName} >= ? AND ${fieldName} < ?`;
}

// Obtener datos del dashboard
router.get('/', async (req, res) => {
    try {
        const today = getCostaRicaDayRange();
        const dayParams = [today.startIso, today.endIso];

        const cuentasPendientes = await database.get(
            'SELECT COUNT(*) as count FROM pedidos WHERE estado = ?',
            ['pendiente']
        );

        const cuentasPagadas = await database.get(
            `SELECT COUNT(DISTINCT p.id) as count
             FROM pedidos p
             JOIN pagos pa ON pa.pedido_id = p.id
             WHERE p.estado = ?
               AND ${createDateRangeCondition('pa.fecha')}
               AND pa.metodo_pago IN (?, ?)`,
            ['pagado', ...dayParams, 'efectivo', 'tarjeta']
        );

        const creditosPagados = await database.get(
            `SELECT COUNT(*) as count
             FROM pagos_creditos
             WHERE ${createDateRangeCondition('fecha_pago')}`,
            dayParams
        );

        const creditosDisponibles = await database.get(
            'SELECT COUNT(*) as count FROM cuentas_credito'
        );

        const montoTotalCreditos = await database.get(
            'SELECT COALESCE(SUM(monto_total), 0) as total FROM cuentas_credito'
        );

        const ventasContado = await database.get(
            `SELECT COALESCE(SUM(pa.monto), 0) as total
             FROM pagos pa
             JOIN pedidos p ON p.id = pa.pedido_id
             WHERE ${createDateRangeCondition('pa.fecha')}
               AND pa.metodo_pago IN (?, ?)`,
            [...dayParams, 'efectivo', 'tarjeta']
        );

        const ventasCredito = await database.get(
            `SELECT COALESCE(SUM(monto_pagado), 0) as total
             FROM pagos_creditos
             WHERE ${createDateRangeCondition('fecha_pago')}`,
            dayParams
        );

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
                COALESCE(p.total_con_servicio, p.total + COALESCE(p.monto_servicio, 0), p.total, 0) AS monto_consumido
            FROM mesas m
            LEFT JOIN (
                SELECT p1.*
                FROM pedidos p1
                JOIN (
                    SELECT mesa_id, MAX(id) AS id
                    FROM pedidos
                    WHERE estado = 'pendiente'
                    GROUP BY mesa_id
                ) ultimo ON ultimo.id = p1.id
            ) p ON m.id = p.mesa_id
            ORDER BY
                CASE LOWER(COALESCE(m.zona, 'salon')) WHEN 'salon' THEN 1 WHEN 'bar' THEN 2 ELSE 3 END,
                CASE LOWER(COALESCE(m.tipo_asiento, 'mesa')) WHEN 'mesa' THEN 1 WHEN 'banco' THEN 2 ELSE 3 END,
                m.numero ASC
        `);

        const ultimasCuentasPagadas = await database.all(`
            SELECT
                p.id,
                COALESCE(SUM(pa.monto), p.total_con_servicio, p.total + COALESCE(p.monto_servicio, 0), p.total, 0) AS total,
                MAX(pa.fecha) AS fecha,
                m.numero AS mesa_numero,
                m.tipo_asiento,
                m.zona,
                COALESCE(p.cliente_nombre, 'Cliente anónimo') AS cliente_nombre
            FROM pagos pa
            JOIN pedidos p ON p.id = pa.pedido_id
            JOIN mesas m ON p.mesa_id = m.id
            WHERE p.estado = 'pagado'
              AND ${createDateRangeCondition('pa.fecha')}
              AND pa.metodo_pago IN (?, ?)
            GROUP BY p.id, p.total, p.total_con_servicio, p.monto_servicio, m.numero, m.tipo_asiento, m.zona, p.cliente_nombre
            ORDER BY MAX(pa.fecha) DESC
            LIMIT 5
        `, [...dayParams, 'efectivo', 'tarjeta']);

        const resumenOperativo = buildOperationalSummary(mesasDetalle);
        const ventasContadoTotal = Number(ventasContado.total) || 0;
        const ventasCreditoTotal = Number(ventasCredito.total) || 0;

        res.json({
            success: true,
            data: {
                fechaOperativa: today.dateKey,
                mesasLibres: resumenOperativo.totales.mesasLibres,
                mesasOcupadas: resumenOperativo.totales.mesasOcupadas,
                mesasReservadas: resumenOperativo.totales.mesasReservadas,
                bancosLibres: resumenOperativo.totales.bancosLibres,
                bancosOcupados: resumenOperativo.totales.bancosOcupados,
                bancosReservados: resumenOperativo.totales.bancosReservados,
                zonasResumen: resumenOperativo.zonas,
                cuentasPendientes: cuentasPendientes.count,
                cuentasPagadas: cuentasPagadas.count,
                creditosPagados: creditosPagados.count,
                creditosDisponibles: creditosDisponibles.count,
                montoTotalCreditos: montoTotalCreditos.total,
                ventasContado: ventasContadoTotal,
                ventasCredito: ventasCreditoTotal,
                ventasHoy: ventasContadoTotal + ventasCreditoTotal,
                usuarioActual,
                mesasDetalle,
                ultimasCuentasPagadas,
                actualizadoEn: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error obteniendo datos del dashboard:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Obtener detalle de ventas del día
router.get('/ventas-detalle', async (req, res) => {
    try {
        const today = getCostaRicaDayRange();
        const dayParams = [today.startIso, today.endIso];

        const ventasDetalle = await database.all(`
            SELECT
                p.id,
                COALESCE(pa.monto, p.total, 0) AS total,
                pa.fecha AS fecha_venta,
                m.numero AS mesa_numero,
                m.tipo_asiento AS tipo_asiento,
                m.zona AS zona,
                COALESCE(p.cliente_nombre, 'Cliente anónimo') AS cliente_nombre,
                u.nombre AS usuario_nombre,
                pa.metodo_pago
            FROM pagos pa
            JOIN pedidos p ON p.id = pa.pedido_id
            JOIN mesas m ON p.mesa_id = m.id
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE ${createDateRangeCondition('pa.fecha')}
              AND pa.metodo_pago IN (?, ?)
            ORDER BY pa.fecha DESC
        `, [...dayParams, 'efectivo', 'tarjeta']);

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
                dateFilter = "pa.fecha >= datetime('now', 'start of day')";
                groupBy = "strftime('%H', pa.fecha)";
                break;
            case 'week':
                dateFilter = "DATE(pa.fecha) >= DATE('now', '-7 days')";
                groupBy = "DATE(pa.fecha)";
                break;
            case 'month':
                dateFilter = "DATE(pa.fecha) >= DATE('now', '-30 days')";
                groupBy = "DATE(pa.fecha)";
                break;
            default:
                return res.status(400).json({ error: 'Período inválido' });
        }

        const stats = await database.all(`
            SELECT ${groupBy} as periodo,
                   COUNT(DISTINCT pa.pedido_id) as pedidos,
                   COALESCE(SUM(pa.monto), 0) as ventas
            FROM pagos pa
            JOIN pedidos p ON p.id = pa.pedido_id
            WHERE pa.metodo_pago IN ('efectivo', 'tarjeta') AND ${dateFilter}
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
