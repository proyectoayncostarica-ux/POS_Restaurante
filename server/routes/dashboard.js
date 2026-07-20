const express = require('express');
const database = require('../db/database');
const requireCapability = require('../middleware/requireCapability');
const { CAPABILITIES } = require('../security/capabilities');
const { resolveAccessContext } = require('../services/operationalAccessService');
const financialReadService = require('../services/financialReadService');
const dashboardReportService = require('../services/dashboardReportService');

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

function parseReportDate(value, fieldName) {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
    if (!match) {
        const error = new Error(`${fieldName} debe usar formato YYYY-MM-DD`);
        error.statusCode = 400;
        error.code = 'INVALID_REPORT_DATE';
        throw error;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day, COSTA_RICA_UTC_OFFSET_HOURS, 0, 0, 0));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        const error = new Error(`${fieldName} es inválida`);
        error.statusCode = 400;
        error.code = 'INVALID_REPORT_DATE';
        throw error;
    }
    return date;
}

function parseOptionalPositiveId(value, fieldName) {
    if (value === undefined || value === null || value === '' || value === 'todos') return null;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        const error = new Error(`${fieldName} inválido`);
        error.statusCode = 400;
        error.code = 'INVALID_REPORT_FILTER';
        throw error;
    }
    return id;
}

function buildFinancialReportFilters(req, scope) {
    const today = getCostaRicaDayRange();
    const startDate = parseReportDate(req.query.desde, 'Fecha inicial');
    const endDate = parseReportDate(req.query.hasta, 'Fecha final');
    const startIso = startDate ? startDate.toISOString() : today.startIso;
    const endIso = endDate
        ? new Date(endDate.getTime() + 24 * 60 * 60 * 1000).toISOString()
        : today.endIso;

    if (new Date(startIso) >= new Date(endIso)) {
        const error = new Error('El rango financiero debe terminar después de la fecha inicial');
        error.statusCode = 400;
        error.code = 'INVALID_REPORT_RANGE';
        throw error;
    }

    const requestedZoneId = parseOptionalPositiveId(req.query.zona_id, 'Zona');
    let zoneIds;
    if (requestedZoneId) {
        if (scope.restringido && !scope.zoneIds.includes(requestedZoneId)) {
            const error = new Error('La zona solicitada está fuera del alcance operativo del usuario');
            error.statusCode = 403;
            error.code = 'ZONE_SCOPE_REQUIRED';
            throw error;
        }
        zoneIds = [requestedZoneId];
    } else {
        zoneIds = scope.restringido ? scope.zoneIds : undefined;
    }

    return {
        startIso,
        endIso,
        zoneIds,
        cashierUserId: parseOptionalPositiveId(req.query.cajero_id, 'Cajero'),
        responsibleUserId: parseOptionalPositiveId(req.query.responsable_id, 'Responsable'),
        paymentMethod: req.query.metodo_pago || null,
        optionZoneIds: scope.restringido ? scope.zoneIds : undefined
    };
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

function normalizeRoleIds(value) {
    if (value === null || value === undefined || value === '') return [];

    let normalizedValue = value;
    if (typeof normalizedValue === 'string') {
        const trimmed = normalizedValue.trim();
        if (!trimmed) return [];
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || trimmed.includes(',')) {
            try {
                normalizedValue = trimmed.startsWith('[') ? JSON.parse(trimmed) : trimmed.split(',');
            } catch (error) {
                normalizedValue = trimmed.split(',');
            }
        }
    }

    const raw = Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue];
    return [...new Set(raw.flatMap(item => Array.isArray(item) ? item : [item])
        .map(item => Number(item))
        .filter(id => Number.isFinite(id) && id > 0))];
}

function isAdminType(value = '') {
    const type = String(value || '').trim().toLowerCase();
    return type === 'administrador' || type === 'admin';
}

function getSessionActiveWorkRoleIds(req) {
    const multiIds = normalizeRoleIds(req.session?.activeWorkRoleIds);
    if (multiIds.length) return multiIds;
    const legacyId = Number(req.session?.activeWorkRoleId || 0);
    return legacyId > 0 ? [legacyId] : [];
}

async function getDashboardScope(req) {
    const access = await resolveAccessContext(req);
    const userId = Number(access.userId || 0);
    const activeWorkRoleIds = access.activeRoleIds || [];
    const isAdmin = access.isAdmin;

    if (isAdmin) {
        const zonas = await database.all(`
            SELECT *
            FROM zonas
            WHERE activa = 1
              AND visible_dashboard = 1
            ORDER BY orden ASC, nombre ASC
        `);

        return {
            modo: activeWorkRoleIds.length ? 'administrador_roles_activos' : 'administrador_sin_rol',
            rol_trabajo: null,
            roles_trabajo: [],
            zonas,
            zoneIds: zonas.map(zone => Number(zone.id)).filter(Boolean),
            restringido: false,
            mensaje: null
        };
    }

    if (activeWorkRoleIds.length > 0) {
        const placeholders = activeWorkRoleIds.map(() => '?').join(',');
        const roles = await database.all(`
            SELECT DISTINCT rt.id, rt.nombre, rt.slug, rt.descripcion, rt.activo
            FROM roles_trabajo rt
            INNER JOIN usuario_roles_trabajo urt ON urt.rol_trabajo_id = rt.id
            WHERE rt.id IN (${placeholders})
              AND urt.usuario_id = ?
              AND rt.activo = 1
            ORDER BY rt.nombre ASC
        `, [...activeWorkRoleIds, userId]);

        if (!roles.length) {
            return {
                modo: 'rol_no_disponible',
                rol_trabajo: null,
                roles_trabajo: [],
                zonas: [],
                zoneIds: [],
                restringido: true,
                mensaje: 'Los roles operativos activos ya no están disponibles para este usuario.'
            };
        }

        const roleIds = roles.map(role => Number(role.id));
        const zoneIds = Array.isArray(access.zoneIds) ? access.zoneIds : [];
        const zonas = zoneIds.length
            ? await database.all(`
                SELECT DISTINCT z.*
                FROM zonas z
                WHERE z.id IN (${zoneIds.map(() => '?').join(',')})
                  AND z.activa = 1
                  AND z.visible_dashboard = 1
                ORDER BY z.orden ASC, z.nombre ASC
            `, zoneIds)
            : [];

        const mappedRoles = roles.map(role => ({
            id: Number(role.id),
            nombre: role.nombre,
            slug: role.slug,
            descripcion: role.descripcion,
            activo: normalizeBooleanNumber(role.activo)
        }));

        return {
            modo: 'roles_trabajo',
            rol_trabajo: mappedRoles[0] || null,
            roles_trabajo: mappedRoles,
            zonas,
            zoneIds: zonas.map(zone => Number(zone.id)).filter(Boolean),
            restringido: true,
            mensaje: zonas.length ? null : 'Los roles operativos activos no tienen zonas visibles en Dashboard.'
        };
    }

    return {
        modo: 'sin_rol_operativo',
        rol_trabajo: null,
        roles_trabajo: [],
        zonas: [],
        zoneIds: [],
        restringido: true,
        mensaje: 'Seleccione al menos un rol operativo activo para consultar el Dashboard.'
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
            COALESCE(p.total_con_servicio, p.total + COALESCE(p.monto_servicio, 0), p.total, 0) AS monto_consumido,
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
router.get('/', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const today = getCostaRicaDayRange();
        const dayParams = [today.startIso, today.endIso];
        const scope = await getDashboardScope(req);
        const zoneWhere = buildZoneWhere(scope, 'm');

        const cuentasPendientes = await database.get(
            `SELECT COUNT(DISTINCT p.id) as count
             FROM pedidos p
             JOIN mesas m ON m.id = p.mesa_id
             WHERE p.estado_operativo = 'abierta'
               AND COALESCE(p.saldo_pendiente, 0) > 0
               AND COALESCE(m.activo, 1) = 1
               ${zoneWhere.clause}`,
            zoneWhere.params
        );

        const [financialToday, creditosDisponibles, montoTotalCreditos, creditosPagados] = await Promise.all([
            financialReadService.getPeriodSummary({
                startIso: today.startIso,
                endIso: today.endIso,
                zoneIds: scope.restringido ? scope.zoneIds : undefined
            }),
            database.get('SELECT COUNT(*) as count FROM cuentas_credito'),
            database.get('SELECT COALESCE(SUM(monto_total), 0) as total FROM cuentas_credito'),
            database.get(
                `SELECT COUNT(*) as count
                 FROM pagos_creditos
                 WHERE ${createDateRangeCondition('fecha_pago')}`,
                dayParams
            )
        ]);

        const usuarioActual = {
            id: req.session.userId,
            nombre: req.session.userName,
            tipo: req.session.userType,
            rol_trabajo_activo: scope.rol_trabajo,
            roles_trabajo_activos: scope.roles_trabajo || []
        };

        const mesasDetalle = await database.all(
            buildDashboardSeatSelect(zoneWhere, {
                currentUserId: req.session.userId,
                isAdmin: isAdminType(req.session.userType)
            }),
            zoneWhere.params
        );

        const resumenOperativo = buildOperationalSummary(mesasDetalle, scope);
        const ultimasCuentasPagadas = financialToday.ventas.slice(0, 5).map(sale => ({
            ...sale,
            fecha: sale.fecha_financiera,
            total: sale.total_global
        }));

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
                    roles_trabajo: scope.roles_trabajo || [],
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
                cuentasPendientes: Number(cuentasPendientes?.count || 0),
                cuentasPagadas: financialToday.cuentas_conciliadas,
                creditosPagados: Number(creditosPagados?.count || 0),
                creditosDisponibles: Number(creditosDisponibles?.count || 0),
                montoTotalCreditos: Number(montoTotalCreditos?.total || 0),
                ventasContado: financialToday.ventas_por_liquidacion.contado,
                ventasCredito: financialToday.ventas_por_liquidacion.credito,
                ventasMixtas: financialToday.ventas_por_liquidacion.mixto,
                ventasHoy: financialToday.total_ventas_globales,
                movimientosCajaHoy: financialToday.total_movimientos_caja,
                cantidadMovimientosCajaHoy: financialToday.cantidad_movimientos_caja,
                diferenciaVentasMovimientosHoy: financialToday.diferencia_periodo,
                criterioVentas: financialToday.criterio_fecha_ventas,
                criterioMovimientosCaja: financialToday.criterio_fecha_movimientos,
                usuarioActual,
                mesasDetalle,
                ultimasCuentasPagadas,
                actualizadoEn: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error obteniendo datos del dashboard:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Error interno del servidor',
            code: error.code
        });
    }
});

// Reporte financiero consolidado: ventas por cuenta global y movimientos por pago.
router.get('/report', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const scope = await getDashboardScope(req);
        const filters = buildFinancialReportFilters(req, scope);
        const report = await dashboardReportService.getReport(filters);

        res.json({
            success: true,
            data: {
                ...report,
                alcance: {
                    restringido: scope.restringido,
                    zonas_permitidas: scope.zoneIds
                }
            }
        });
    } catch (error) {
        console.error('Error obteniendo reporte financiero consolidado:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Error interno del servidor',
            code: error.code
        });
    }
});

// Obtener una fila por cuenta global conciliada, nunca una fila por prefactura o pago.
router.get('/ventas-detalle', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const today = getCostaRicaDayRange();
        const scope = await getDashboardScope(req);
        const sales = await financialReadService.listConsolidatedSales({
            startIso: today.startIso,
            endIso: today.endIso,
            zoneIds: scope.restringido ? scope.zoneIds : undefined,
            limit: 500
        });

        res.json({ success: true, data: sales });
    } catch (error) {
        console.error('Error obteniendo detalle consolidado de ventas:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Error interno del servidor',
            code: error.code
        });
    }
});

// Obtener estadísticas de ventas globales por período.
router.get('/stats/:period', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const { period } = req.params;
        const scope = await getDashboardScope(req);
        const now = new Date();
        let start;
        let end = now;
        let bucket = 'day';

        if (period === 'day') {
            const today = getCostaRicaDayRange(now);
            start = new Date(today.startIso);
            end = new Date(today.endIso);
            bucket = 'hour';
        } else if (period === 'week') {
            start = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        } else if (period === 'month') {
            start = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        } else {
            return res.status(400).json({ error: 'Período inválido' });
        }

        const stats = await financialReadService.getSalesStats({
            startIso: start.toISOString(),
            endIso: end.toISOString(),
            zoneIds: scope.restringido ? scope.zoneIds : undefined,
            bucket
        });

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error obteniendo estadísticas consolidadas:', error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : 'Error interno del servidor',
            code: error.code
        });
    }
});

module.exports = router;
