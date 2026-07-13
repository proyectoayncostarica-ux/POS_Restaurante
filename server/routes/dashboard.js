const express = require('express');
const database = require('../db/database');

const router = express.Router();
const COSTA_RICA_UTC_OFFSET_HOURS = 6;

function normalizeBooleanNumber(value) {
    return Number(value) === 1 ? 1 : 0;
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

function normalizeLegacyZoneKey(row = {}) {
    const zona = String(row.zona || 'salon').trim().toLowerCase();
    const tipoAsiento = String(row.tipo_asiento || 'mesa').trim().toLowerCase();

    if (zona === 'bar' && tipoAsiento === 'banco') return 'bar-banco';
    if (zona === 'bar') return 'bar-mesa';
    return 'salon';
}

function getDynamicZoneKey(row = {}) {
    const zoneId = Number(row.zona_dinamica_id || row.zona_id || 0);
    return zoneId > 0 ? `zona-${zoneId}` : normalizeLegacyZoneKey(row);
}

function createZoneSummary(id, label, zone = {}) {
    return {
        id,
        label,
        zona_id: zone.id ? Number(zone.id) : null,
        slug: zone.slug || null,
        icono: zone.icono || 'fa-layer-group',
        color: zone.color || null,
        total: 0,
        libres: 0,
        ocupadas: 0,
        reservadas: 0,
        consumo: 0
    };
}

function addMesaToSummary(summary, mesa) {
    if (!summary) return;
    const estado = normalizeEstado(mesa.estado);
    const monto = Number(mesa.monto_consumido) || 0;

    summary.total += 1;
    if (estado === 'libre') summary.libres += 1;
    if (estado === 'ocupada') summary.ocupadas += 1;
    if (estado === 'reservada') summary.reservadas += 1;
    if (monto > 0) summary.consumo += monto;
}

function getZoneIcon(zone = {}) {
    const icon = String(zone.icono || '').trim();
    if (!icon) return 'fa-layer-group';
    return icon.startsWith('fa-') ? icon : `fa-${icon}`;
}

function buildDashboardZoneItems(scope) {
    const zones = Array.isArray(scope?.zonas) ? scope.zonas : [];
    return [
        { id: 'todos', label: 'Todos', icon: 'fa-border-all', zona_id: null, color: null },
        ...zones.map(zone => ({
            id: `zona-${Number(zone.id)}`,
            label: zone.nombre,
            icon: getZoneIcon(zone),
            zona_id: Number(zone.id),
            slug: zone.slug,
            color: zone.color || null,
            orden: Number(zone.orden || 0)
        }))
    ];
}

function buildOperationalSummary(mesasDetalle = [], scope = {}) {
    const zonas = {
        todos: createZoneSummary('todos', 'Todos')
    };

    (scope.zonas || []).forEach(zone => {
        zonas[`zona-${Number(zone.id)}`] = createZoneSummary(`zona-${Number(zone.id)}`, zone.nombre, {
            ...zone,
            icono: getZoneIcon(zone)
        });
    });

    mesasDetalle.forEach(mesa => {
        const zoneKey = getDynamicZoneKey(mesa);
        addMesaToSummary(zonas.todos, mesa);
        addMesaToSummary(zonas[zoneKey], mesa);
    });

    const legacyTotals = mesasDetalle.reduce((acc, mesa) => {
        const estado = normalizeEstado(mesa.estado);
        const tipoSlug = String(mesa.tipo_puesto_slug || mesa.tipo_asiento || 'mesa').toLowerCase();
        const isBanco = tipoSlug === 'banco';
        const target = isBanco ? 'bancos' : 'mesas';
        if (estado === 'libre') acc[`${target}Libres`] += 1;
        if (estado === 'ocupada') acc[`${target}Ocupadas`] += 1;
        if (estado === 'reservada') acc[`${target}Reservadas`] += 1;
        return acc;
    }, {
        mesasLibres: 0,
        mesasOcupadas: 0,
        mesasReservadas: 0,
        bancosLibres: 0,
        bancosOcupados: 0,
        bancosReservados: 0
    });

    return {
        zonas,
        totales: {
            ...legacyTotals,
            puestosLibres: zonas.todos.libres,
            puestosOcupados: zonas.todos.ocupadas,
            puestosReservados: zonas.todos.reservadas,
            puestosTotal: zonas.todos.total,
            consumoActivo: zonas.todos.consumo
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

function buildZoneWhere(scope = {}, alias = 'm') {
    const zoneIds = Array.isArray(scope.zoneIds) ? scope.zoneIds : [];
    if (!zoneIds.length) {
        return {
            clause: 'AND 1 = 0',
            params: []
        };
    }

    return {
        clause: `AND ${alias}.zona_id IN (${zoneIds.map(() => '?').join(',')})`,
        params: zoneIds
    };
}

async function getDashboardScope(req) {
    const userId = Number(req.session?.userId || 0);
    const userType = req.session?.userType || 'basico';
    const activeWorkRoleId = Number(req.session?.activeWorkRoleId || 0);
    const isAdmin = userType === 'administrador';

    if (activeWorkRoleId > 0) {
        const role = await database.get(`
            SELECT rt.id, rt.nombre, rt.slug, rt.descripcion, rt.activo
            FROM roles_trabajo rt
            INNER JOIN usuario_roles_trabajo urt ON urt.rol_trabajo_id = rt.id
            WHERE rt.id = ?
              AND urt.usuario_id = ?
              AND rt.activo = 1
        `, [activeWorkRoleId, userId]);

        if (!role) {
            return {
                modo: 'rol_no_disponible',
                rol_trabajo: null,
                zonas: [],
                zoneIds: [],
                restringido: true,
                mensaje: 'El rol operativo activo ya no está disponible para este usuario.'
            };
        }

        const zonas = await database.all(`
            SELECT z.*
            FROM rol_trabajo_zonas rtz
            INNER JOIN zonas z ON z.id = rtz.zona_id
            WHERE rtz.rol_trabajo_id = ?
              AND z.activa = 1
              AND z.visible_dashboard = 1
            ORDER BY z.orden ASC, z.nombre ASC
        `, [activeWorkRoleId]);

        return {
            modo: 'rol_trabajo',
            rol_trabajo: {
                id: Number(role.id),
                nombre: role.nombre,
                slug: role.slug,
                descripcion: role.descripcion,
                activo: normalizeBooleanNumber(role.activo)
            },
            zonas,
            zoneIds: zonas.map(zone => Number(zone.id)).filter(Boolean),
            restringido: true,
            mensaje: zonas.length ? null : 'El rol operativo activo no tiene zonas visibles en Dashboard.'
        };
    }

    if (isAdmin) {
        const zonas = await database.all(`
            SELECT *
            FROM zonas
            WHERE activa = 1
              AND visible_dashboard = 1
            ORDER BY orden ASC, nombre ASC
        `);

        return {
            modo: 'administrador_sin_rol',
            rol_trabajo: null,
            zonas,
            zoneIds: zonas.map(zone => Number(zone.id)).filter(Boolean),
            restringido: false,
            mensaje: null
        };
    }

    return {
        modo: 'sin_rol_operativo',
        rol_trabajo: null,
        zonas: [],
        zoneIds: [],
        restringido: true,
        mensaje: 'Seleccione un rol operativo activo para consultar el Dashboard.'
    };
}

function buildDashboardSeatSelect(zoneWhere, options = {}) {
    const currentUserId = Number(options.currentUserId || 0);
    const isAdmin = Boolean(options.isAdmin);

    return `
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
            m.zona_id,
            m.tipo_puesto_id,
            m.nombre_visible,
            z.id AS zona_dinamica_id,
            z.nombre AS zona_nombre,
            z.slug AS zona_slug,
            z.icono AS zona_icono,
            z.color AS zona_color,
            z.orden AS zona_orden,
            z.visible_dashboard AS zona_visible_dashboard,
            tp.id AS tipo_puesto_dinamico_id,
            tp.nombre AS tipo_puesto_nombre,
            tp.slug AS tipo_puesto_slug,
            tp.icono AS tipo_puesto_icono,
            p.id AS pedido_id,
            COALESCE(p.total, 0) AS monto_consumido,
            (
                SELECT COUNT(DISTINCT mr.usuario_id)
                FROM mesa_responsables mr
                INNER JOIN usuarios uresp ON uresp.id = mr.usuario_id AND uresp.activo = 1
                WHERE mr.mesa_id = m.id
            ) AS responsables_total,
            CASE WHEN ${currentUserId} > 0 AND EXISTS (
                SELECT 1 FROM mesa_responsables mr_user
                WHERE mr_user.mesa_id = m.id AND mr_user.usuario_id = ${currentUserId}
            ) THEN 1 ELSE 0 END AS soy_responsable,
            CASE
                WHEN m.estado = 'libre' THEN 1
                WHEN ${isAdmin ? 1 : 0} = 1 THEN 1
                WHEN ${currentUserId} > 0 AND EXISTS (
                    SELECT 1 FROM mesa_responsables mr_user
                    WHERE mr_user.mesa_id = m.id AND mr_user.usuario_id = ${currentUserId}
                ) THEN 1
                ELSE 0
            END AS puede_operar,
            CASE WHEN EXISTS (
                SELECT 1 FROM mesa_responsables mr_any WHERE mr_any.mesa_id = m.id
            ) THEN 1 ELSE 0 END AS responsable_asignado
        FROM mesas m
        LEFT JOIN zonas z ON z.id = m.zona_id
        LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
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
        WHERE COALESCE(m.activo, 1) = 1
          ${zoneWhere.clause}
        ORDER BY
            COALESCE(z.orden, 99),
            CASE LOWER(COALESCE(tp.slug, m.tipo_asiento, 'mesa')) WHEN 'mesa' THEN 1 WHEN 'banco' THEN 2 ELSE 50 END,
            m.numero ASC
    `;
}

// Obtener datos del dashboard
router.get('/', async (req, res) => {
    try {
        const today = getCostaRicaDayRange();
        const dayParams = [today.startIso, today.endIso];
        const scope = await getDashboardScope(req);
        const zoneWhere = buildZoneWhere(scope, 'm');

        const cuentasPendientes = await database.get(
            `SELECT COUNT(DISTINCT p.id) as count
             FROM pedidos p
             JOIN mesas m ON m.id = p.mesa_id
             WHERE p.estado = ?
               AND COALESCE(m.activo, 1) = 1
               ${zoneWhere.clause}`,
            ['pendiente', ...zoneWhere.params]
        );

        const cuentasPagadas = await database.get(
            `SELECT COUNT(DISTINCT p.id) as count
             FROM pedidos p
             JOIN mesas m ON m.id = p.mesa_id
             JOIN pagos pa ON pa.pedido_id = p.id
             WHERE p.estado = ?
               AND ${createDateRangeCondition('pa.fecha')}
               AND pa.metodo_pago IN (?, ?)
               AND COALESCE(m.activo, 1) = 1
               ${zoneWhere.clause}`,
            ['pagado', ...dayParams, 'efectivo', 'tarjeta', ...zoneWhere.params]
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
             JOIN mesas m ON m.id = p.mesa_id
             WHERE ${createDateRangeCondition('pa.fecha')}
               AND pa.metodo_pago IN (?, ?)
               AND COALESCE(m.activo, 1) = 1
               ${zoneWhere.clause}`,
            [...dayParams, 'efectivo', 'tarjeta', ...zoneWhere.params]
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
            tipo: req.session.userType,
            rol_trabajo_activo: scope.rol_trabajo
        };

        const mesasDetalle = await database.all(buildDashboardSeatSelect(zoneWhere, { currentUserId: req.session.userId, isAdmin: req.session.userType === 'administrador' }), zoneWhere.params);

        const ultimasCuentasPagadas = await database.all(`
            SELECT
                p.id,
                COALESCE(SUM(pa.monto), p.total, 0) AS total,
                MAX(pa.fecha) AS fecha,
                m.numero AS mesa_numero,
                m.nombre_visible,
                m.tipo_asiento,
                m.zona,
                m.zona_id,
                m.tipo_puesto_id,
                z.nombre AS zona_nombre,
                z.slug AS zona_slug,
                z.color AS zona_color,
                tp.nombre AS tipo_puesto_nombre,
                tp.slug AS tipo_puesto_slug,
                COALESCE(p.cliente_nombre, 'Cliente anónimo') AS cliente_nombre
            FROM pagos pa
            JOIN pedidos p ON p.id = pa.pedido_id
            JOIN mesas m ON p.mesa_id = m.id
            LEFT JOIN zonas z ON z.id = m.zona_id
            LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
            WHERE p.estado = 'pagado'
              AND ${createDateRangeCondition('pa.fecha')}
              AND pa.metodo_pago IN (?, ?)
              AND COALESCE(m.activo, 1) = 1
              ${zoneWhere.clause}
            GROUP BY p.id, p.total, m.numero, m.nombre_visible, m.tipo_asiento, m.zona, m.zona_id, m.tipo_puesto_id, z.nombre, z.slug, z.color, tp.nombre, tp.slug, p.cliente_nombre
            ORDER BY MAX(pa.fecha) DESC
            LIMIT 5
        `, [...dayParams, 'efectivo', 'tarjeta', ...zoneWhere.params]);

        const resumenOperativo = buildOperationalSummary(mesasDetalle, scope);
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
                puestosLibres: resumenOperativo.totales.puestosLibres,
                puestosOcupados: resumenOperativo.totales.puestosOcupados,
                puestosReservados: resumenOperativo.totales.puestosReservados,
                puestosTotal: resumenOperativo.totales.puestosTotal,
                zonasResumen: resumenOperativo.zonas,
                dashboardZonas: buildDashboardZoneItems(scope),
                dashboardScope: {
                    modo: scope.modo,
                    restringido: scope.restringido,
                    rol_trabajo: scope.rol_trabajo,
                    zonas_permitidas: scope.zonas.map(zone => ({
                        id: Number(zone.id),
                        nombre: zone.nombre,
                        slug: zone.slug,
                        icono: getZoneIcon(zone),
                        color: zone.color || null,
                        visible_dashboard: normalizeBooleanNumber(zone.visible_dashboard),
                        activa: normalizeBooleanNumber(zone.activa)
                    })),
                    mensaje: scope.mensaje
                },
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
        const scope = await getDashboardScope(req);
        const zoneWhere = buildZoneWhere(scope, 'm');

        const ventasDetalle = await database.all(`
            SELECT
                p.id,
                COALESCE(pa.monto, p.total, 0) AS total,
                pa.fecha AS fecha_venta,
                m.numero AS mesa_numero,
                m.nombre_visible,
                m.tipo_asiento AS tipo_asiento,
                m.zona AS zona,
                m.zona_id,
                m.tipo_puesto_id,
                z.nombre AS zona_nombre,
                z.slug AS zona_slug,
                tp.nombre AS tipo_puesto_nombre,
                tp.slug AS tipo_puesto_slug,
                COALESCE(p.cliente_nombre, 'Cliente anónimo') AS cliente_nombre,
                u.nombre AS usuario_nombre,
                pa.metodo_pago
            FROM pagos pa
            JOIN pedidos p ON p.id = pa.pedido_id
            JOIN mesas m ON p.mesa_id = m.id
            LEFT JOIN zonas z ON z.id = m.zona_id
            LEFT JOIN tipos_puesto tp ON tp.id = m.tipo_puesto_id
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE ${createDateRangeCondition('pa.fecha')}
              AND pa.metodo_pago IN (?, ?)
              AND COALESCE(m.activo, 1) = 1
              ${zoneWhere.clause}
            ORDER BY pa.fecha DESC
        `, [...dayParams, 'efectivo', 'tarjeta', ...zoneWhere.params]);

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
        const scope = await getDashboardScope(req);
        const zoneWhere = buildZoneWhere(scope, 'm');
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
            JOIN mesas m ON m.id = p.mesa_id
            WHERE pa.metodo_pago IN ('efectivo', 'tarjeta')
              AND ${dateFilter}
              AND COALESCE(m.activo, 1) = 1
              ${zoneWhere.clause}
            GROUP BY ${groupBy}
            ORDER BY periodo
        `, zoneWhere.params);

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

module.exports = router;
