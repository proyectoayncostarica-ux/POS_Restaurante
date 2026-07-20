const database = require('../db/database');
const financialReadServiceSingleton = require('./financialReadService');
const { ValidationError } = require('../errors/domainError');
const { addMoney, roundMoney } = require('../utils/money');

const PAYMENT_METHODS = Object.freeze(['efectivo', 'tarjeta', 'credito']);

function normalizeOptionalId(value, fieldName) {
    if (value === null || value === undefined || value === '') return null;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new ValidationError(`${fieldName} inválido`, { value });
    }
    return id;
}

function normalizePaymentMethod(value) {
    if (value === null || value === undefined || value === '' || value === 'todos') return null;
    const method = String(value).trim().toLowerCase();
    if (!PAYMENT_METHODS.includes(method)) {
        throw new ValidationError('Método de pago inválido', {
            value,
            allowed: PAYMENT_METHODS
        });
    }
    return method;
}

function normalizeZoneIds(value) {
    if (value === undefined) return undefined;
    if (value === null) return [];
    const raw = Array.isArray(value) ? value : [value];
    return [...new Set(raw
        .map(item => Number(item))
        .filter(item => Number.isSafeInteger(item) && item > 0))];
}

function parseTenderDetails(raw) {
    if (!raw) return [];
    return String(raw)
        .split('|')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
            const [type, amount] = item.split(':');
            return {
                tipo: String(type || '').trim().toLowerCase(),
                monto: roundMoney(Number(amount || 0))
            };
        })
        .filter(item => item.tipo);
}

function movementAmountForMethod(movement, paymentMethod) {
    if (!paymentMethod) return roundMoney(Number(movement.monto || 0));
    const tenders = Array.isArray(movement.medios_pago) ? movement.medios_pago : [];
    const matching = tenders
        .filter(tender => tender.tipo === paymentMethod)
        .reduce((total, tender) => addMoney(total, tender.monto), 0);
    if (matching > 0) return matching;
    return movement.metodo_pago === paymentMethod
        ? roundMoney(Number(movement.monto || 0))
        : 0;
}

class DashboardReportService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.financialReadService = options.financialReadService || financialReadServiceSingleton;
    }

    normalizeFilters(filters = {}) {
        return {
            startIso: filters.startIso || null,
            endIso: filters.endIso || null,
            zoneIds: normalizeZoneIds(filters.zoneIds),
            optionZoneIds: normalizeZoneIds(filters.optionZoneIds),
            cashierUserId: normalizeOptionalId(filters.cashierUserId, 'Cajero'),
            responsibleUserId: normalizeOptionalId(filters.responsibleUserId, 'Responsable'),
            paymentMethod: normalizePaymentMethod(filters.paymentMethod)
        };
    }

    async listSaleAccountIdsMatchingPaymentFilters(filters = {}) {
        const clauses = [
            "COALESCE(pg.estado, 'confirmado') = 'confirmado'",
            "COALESCE(pg.naturaleza, 'liquidacion_venta') = 'liquidacion_venta'"
        ];
        const params = [];

        if (filters.cashierUserId) {
            clauses.push('pg.cajero_usuario_id = ?');
            params.push(filters.cashierUserId);
        }
        if (filters.paymentMethod) {
            clauses.push(`(
                LOWER(COALESCE(pg.metodo_pago_v3, pg.metodo_pago, '')) = ?
                OR EXISTS (
                    SELECT 1
                    FROM pago_medios pm_filter
                    WHERE pm_filter.pago_id = pg.id
                      AND LOWER(pm_filter.tipo) = ?
                )
            )`);
            params.push(filters.paymentMethod, filters.paymentMethod);
        }

        if (!filters.cashierUserId && !filters.paymentMethod) return null;

        const rows = await this.db.all(`
            SELECT DISTINCT pg.pedido_id
            FROM pagos pg
            WHERE ${clauses.join(' AND ')}
        `, params);
        return new Set(rows.map(row => Number(row.pedido_id)).filter(Boolean));
    }

    async listConsolidatedSales(filters = {}) {
        const paymentFilteredIds = await this.listSaleAccountIdsMatchingPaymentFilters(filters);
        const sales = await this.financialReadService.listConsolidatedSales({
            startIso: filters.startIso,
            endIso: filters.endIso,
            zoneIds: filters.zoneIds,
            responsibleUserId: filters.responsibleUserId,
            limit: null
        });

        if (!paymentFilteredIds) return sales;
        return sales.filter(sale => paymentFilteredIds.has(Number(sale.pedido_id || sale.id)));
    }

    async listCashMovements(filters = {}) {
        const movements = await this.financialReadService.listCashMovements({
            startIso: filters.startIso,
            endIso: filters.endIso,
            zoneIds: filters.zoneIds,
            cashierUserId: filters.cashierUserId,
            responsibleUserId: filters.responsibleUserId,
            paymentMethod: filters.paymentMethod,
            limit: null
        });

        return movements.map(movement => ({
            ...movement,
            monto_reportado: movementAmountForMethod(movement, filters.paymentMethod)
        }));
    }

    buildScopeClause(filters = {}, accountAlias = 'p', seatAlias = 'm') {
        const clauses = [];
        const params = [];
        if (Array.isArray(filters.zoneIds)) {
            if (!filters.zoneIds.length) {
                clauses.push('1 = 0');
            } else {
                clauses.push(`COALESCE(${accountAlias}.zona_id_snapshot, ${seatAlias}.zona_id) IN (${filters.zoneIds.map(() => '?').join(',')})`);
                params.push(...filters.zoneIds);
            }
        }
        if (filters.responsibleUserId) {
            clauses.push(`EXISTS (
                SELECT 1
                FROM cuenta_responsables cr_filter
                WHERE cr_filter.pedido_id = ${accountAlias}.id
                  AND cr_filter.usuario_id = ?
            )`);
            params.push(filters.responsibleUserId);
        }
        return { clauses, params };
    }

    async listActiveAccounts(filters = {}) {
        const scope = this.buildScopeClause(filters, 'p', 'm');
        const clauses = ["p.estado_operativo = 'abierta'", ...scope.clauses];
        const rows = await this.db.all(`
            WITH consumo AS (
                SELECT
                    pp.pedido_id,
                    COALESCE(SUM(pp.precio_unitario * pp.cantidad), 0) AS subtotal
                FROM pedido_productos pp
                GROUP BY pp.pedido_id
            )
            SELECT
                p.id,
                p.numero_cuenta,
                p.estado_operativo,
                p.estado_financiero,
                p.fecha_apertura,
                COALESCE(p.cliente_principal_snapshot, p.cliente_nombre, m.cliente_nombre, 'Cliente anónimo') AS cliente_principal,
                COALESCE(p.mesa_numero_snapshot, m.numero) AS mesa_numero,
                COALESCE(p.mesa_tipo_snapshot, m.tipo_asiento, 'mesa') AS mesa_tipo,
                COALESCE(p.zona_id_snapshot, m.zona_id) AS zona_id,
                COALESCE(p.zona_nombre_snapshot, z.nombre, m.zona, 'Sin zona') AS zona_nombre,
                COALESCE(consumo.subtotal, p.total, 0) AS subtotal,
                ROUND(
                    COALESCE(consumo.subtotal, p.total, 0)
                    + CASE
                        WHEN COALESCE(p.aplica_servicio, 0) = 1
                        THEN COALESCE(consumo.subtotal, p.total, 0) * COALESCE(p.porcentaje_servicio, 0) / 100.0
                        ELSE 0
                    END,
                    2
                ) AS total_global,
                COALESCE(p.total_pagado, 0) AS total_pagado,
                COALESCE(p.saldo_pendiente, 0) AS saldo_pendiente,
                (
                    SELECT cr.usuario_nombre_snapshot
                    FROM cuenta_responsables cr
                    WHERE cr.pedido_id = p.id
                    ORDER BY cr.es_principal DESC, cr.fecha_asignacion_snapshot, cr.usuario_nombre_snapshot
                    LIMIT 1
                ) AS responsable_principal,
                (
                    SELECT COUNT(*)
                    FROM prefacturas pf
                    WHERE pf.pedido_id = p.id
                      AND pf.estado <> 'anulada'
                ) AS cantidad_documentos
            FROM pedidos p
            JOIN mesas m ON m.id = p.mesa_id
            LEFT JOIN zonas z ON z.id = COALESCE(p.zona_id_snapshot, m.zona_id)
            LEFT JOIN consumo ON consumo.pedido_id = p.id
            WHERE ${clauses.join(' AND ')}
            ORDER BY p.fecha_apertura, p.id
        `, scope.params);

        return rows.map(row => ({
            ...row,
            id: Number(row.id),
            pedido_id: Number(row.id),
            zona_id: row.zona_id ? Number(row.zona_id) : null,
            subtotal: roundMoney(Number(row.subtotal || 0)),
            total_global: roundMoney(Number(row.total_global || 0)),
            total_pagado: roundMoney(Number(row.total_pagado || 0)),
            saldo_pendiente: roundMoney(Number(row.saldo_pendiente || 0)),
            cantidad_documentos: Number(row.cantidad_documentos || 0)
        }));
    }

    async listPendingDocuments(filters = {}) {
        const scope = this.buildScopeClause(filters, 'p', 'm');
        const clauses = ["pf.estado IN ('emitida', 'parcial')", ...scope.clauses];
        const rows = await this.db.all(`
            SELECT
                pf.id,
                pf.pedido_id,
                pf.numero_documento,
                pf.tipo,
                pf.pagador_nombre,
                pf.estado,
                pf.total,
                pf.total_pagado,
                pf.saldo_pendiente,
                pf.fecha_emision,
                p.numero_cuenta,
                COALESCE(p.cliente_principal_snapshot, p.cliente_nombre, m.cliente_nombre, 'Cliente anónimo') AS cliente_principal,
                COALESCE(p.mesa_numero_snapshot, m.numero) AS mesa_numero,
                COALESCE(p.mesa_tipo_snapshot, m.tipo_asiento, 'mesa') AS mesa_tipo,
                COALESCE(p.zona_id_snapshot, m.zona_id) AS zona_id,
                COALESCE(p.zona_nombre_snapshot, z.nombre, m.zona, 'Sin zona') AS zona_nombre,
                (
                    SELECT cr.usuario_nombre_snapshot
                    FROM cuenta_responsables cr
                    WHERE cr.pedido_id = p.id
                    ORDER BY cr.es_principal DESC, cr.fecha_asignacion_snapshot, cr.usuario_nombre_snapshot
                    LIMIT 1
                ) AS responsable_principal,
                (
                    SELECT COUNT(*)
                    FROM prefacturas pf_count
                    WHERE pf_count.pedido_id = p.id
                      AND pf_count.estado <> 'anulada'
                ) AS documentos_cuenta
            FROM prefacturas pf
            JOIN pedidos p ON p.id = pf.pedido_id
            JOIN mesas m ON m.id = p.mesa_id
            LEFT JOIN zonas z ON z.id = COALESCE(p.zona_id_snapshot, m.zona_id)
            WHERE ${clauses.join(' AND ')}
            ORDER BY pf.fecha_emision, pf.id
        `, scope.params);

        return rows.map(row => ({
            ...row,
            id: Number(row.id),
            pedido_id: Number(row.pedido_id),
            zona_id: row.zona_id ? Number(row.zona_id) : null,
            total: roundMoney(Number(row.total || 0)),
            total_pagado: roundMoney(Number(row.total_pagado || 0)),
            saldo_pendiente: roundMoney(Number(row.saldo_pendiente || 0)),
            documentos_cuenta: Number(row.documentos_cuenta || 0),
            cuenta_dividida: Number(row.documentos_cuenta || 0) > 1 || row.tipo === 'dividida'
        }));
    }

    summarizeSales(sales = []) {
        return sales.reduce((summary, sale) => {
            summary.total = addMoney(summary.total, sale.total_global);
            summary.cuentas += 1;
            if (sale.es_cuenta_dividida) summary.cuentas_divididas += 1;
            if (sale.tipo_liquidacion === 'credito') {
                summary.credito = addMoney(summary.credito, sale.total_global);
            } else if (sale.tipo_liquidacion === 'mixto') {
                summary.mixto = addMoney(summary.mixto, sale.total_global);
            } else {
                summary.contado = addMoney(summary.contado, sale.total_global);
            }
            return summary;
        }, {
            total: 0,
            cuentas: 0,
            cuentas_divididas: 0,
            contado: 0,
            credito: 0,
            mixto: 0
        });
    }

    summarizeMovements(movements = []) {
        return movements.reduce((summary, movement) => {
            const amount = roundMoney(Number(movement.monto_reportado ?? movement.monto ?? 0));
            summary.total = addMoney(summary.total, amount);
            summary.cantidad += 1;
            if (movement.naturaleza === 'cobro_credito') {
                summary.cobros_credito = addMoney(summary.cobros_credito, amount);
            } else {
                summary.liquidacion_ventas = addMoney(summary.liquidacion_ventas, amount);
            }
            const methods = Array.isArray(movement.medios_pago) && movement.medios_pago.length
                ? movement.medios_pago
                : [{ tipo: movement.metodo_pago, monto: amount }];
            for (const tender of methods) {
                if (!PAYMENT_METHODS.includes(tender.tipo)) continue;
                if (summary.por_metodo[tender.tipo] === undefined) summary.por_metodo[tender.tipo] = 0;
                summary.por_metodo[tender.tipo] = addMoney(
                    summary.por_metodo[tender.tipo],
                    Number(tender.monto || 0)
                );
            }
            return summary;
        }, {
            total: 0,
            cantidad: 0,
            liquidacion_ventas: 0,
            cobros_credito: 0,
            por_metodo: { efectivo: 0, tarjeta: 0, credito: 0 }
        });
    }

    async getFilterOptions(filters = {}) {
        const zoneScope = Array.isArray(filters.zoneIds)
            ? (filters.zoneIds.length
                ? `WHERE z.id IN (${filters.zoneIds.map(() => '?').join(',')})`
                : 'WHERE 1 = 0')
            : 'WHERE z.activa = 1';
        const zoneParams = Array.isArray(filters.zoneIds) ? filters.zoneIds : [];
        const [zones, cashiers, responsibles] = await Promise.all([
            this.db.all(`
                SELECT z.id, z.nombre, z.slug
                FROM zonas z
                ${zoneScope}
                ORDER BY z.orden, z.nombre
            `, zoneParams),
            this.db.all(`
                SELECT DISTINCT
                    pg.cajero_usuario_id AS id,
                    COALESCE(pg.cajero_nombre_snapshot, u.nombre, 'Usuario') AS nombre
                FROM pagos pg
                LEFT JOIN usuarios u ON u.id = pg.cajero_usuario_id
                WHERE pg.cajero_usuario_id IS NOT NULL
                ORDER BY nombre
            `),
            this.db.all(`
                SELECT DISTINCT cr.usuario_id AS id, cr.usuario_nombre_snapshot AS nombre
                FROM cuenta_responsables cr
                WHERE cr.usuario_id IS NOT NULL
                ORDER BY cr.usuario_nombre_snapshot
            `)
        ]);

        return {
            zonas: zones.map(zone => ({ ...zone, id: Number(zone.id) })),
            cajeros: cashiers.map(user => ({ ...user, id: Number(user.id) })),
            responsables: responsibles.map(user => ({ ...user, id: Number(user.id) })),
            metodos_pago: PAYMENT_METHODS.map(value => ({
                id: value,
                nombre: value === 'efectivo' ? 'Efectivo' : value === 'tarjeta' ? 'Tarjeta' : 'Crédito'
            }))
        };
    }

    async getReport(inputFilters = {}) {
        const filters = this.normalizeFilters(inputFilters);
        const [sales, movements, activeAccounts, pendingDocuments, options] = await Promise.all([
            this.listConsolidatedSales(filters),
            this.listCashMovements(filters),
            this.listActiveAccounts(filters),
            this.listPendingDocuments(filters),
            this.getFilterOptions({ zoneIds: filters.optionZoneIds })
        ]);

        const salesSummary = this.summarizeSales(sales);
        const movementSummary = this.summarizeMovements(movements);
        const activeConsumption = activeAccounts.reduce(
            (total, account) => addMoney(total, account.total_global),
            0
        );
        const activeBalance = activeAccounts.reduce(
            (total, account) => addMoney(total, account.saldo_pendiente),
            0
        );
        const pendingBalance = pendingDocuments.reduce(
            (total, document) => addMoney(total, document.saldo_pendiente),
            0
        );

        return {
            filtros: filters,
            criterios: {
                ventas: 'Una fila por cuenta global conciliada o liquidada a crédito; las prefacturas nunca se suman como ventas.',
                movimientos: 'Una fila por pago confirmado de Caja. Los cobros de créditos se muestran separados de la liquidación de ventas.',
                fecha_ventas: 'fecha de conciliación financiera de la cuenta global',
                fecha_movimientos: 'fecha del pago confirmado',
                filtros_operativos: 'Zona y responsable aplican también a consumo activo y documentos pendientes. Cajero y método aplican a ventas/pagos.'
            },
            resumen: {
                ventas_globales: salesSummary.total,
                cuentas_vendidas: salesSummary.cuentas,
                cuentas_divididas: salesSummary.cuentas_divididas,
                ventas_contado: salesSummary.contado,
                ventas_credito: salesSummary.credito,
                ventas_mixtas: salesSummary.mixto,
                movimientos_caja: movementSummary.total,
                cantidad_movimientos_caja: movementSummary.cantidad,
                movimientos_liquidacion_ventas: movementSummary.liquidacion_ventas,
                cobros_credito: movementSummary.cobros_credito,
                movimientos_por_metodo: movementSummary.por_metodo,
                diferencia_ventas_vs_liquidaciones: roundMoney(
                    salesSummary.total - movementSummary.liquidacion_ventas
                ),
                consumo_activo: activeConsumption,
                saldo_activo: activeBalance,
                cuentas_activas: activeAccounts.length,
                documentos_pendientes: pendingDocuments.length,
                saldo_documentos_pendientes: pendingBalance
            },
            ventas: sales,
            movimientos: movements,
            cuentas_activas: activeAccounts,
            documentos_pendientes: pendingDocuments,
            opciones_filtro: options
        };
    }
}

const dashboardReportService = new DashboardReportService();

module.exports = dashboardReportService;
module.exports.DashboardReportService = DashboardReportService;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.parseTenderDetails = parseTenderDetails;
module.exports.movementAmountForMethod = movementAmountForMethod;
