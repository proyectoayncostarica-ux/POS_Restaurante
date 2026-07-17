const database = require('../db/database');
const accountService = require('./accountService');
const { ValidationError, NotFoundError } = require('../errors/domainError');
const { addMoney, roundMoney, toMinorUnits, fromMinorUnits } = require('../utils/money');

const COSTA_RICA_TIME_ZONE = 'America/Costa_Rica';
const COSTA_RICA_UTC_OFFSET_HOURS = 6;

function normalizePositiveIds(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values
        .map(value => Number(value))
        .filter(value => Number.isSafeInteger(value) && value > 0))];
}

function normalizeLimit(value, fallback = 200, maximum = 1000) {
    if (value === null) return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.min(Math.trunc(numeric), maximum);
}

function getCostaRicaDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: COSTA_RICA_TIME_ZONE,
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

function parseMethods(rawMethods) {
    return [...new Set(String(rawMethods || '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean))].sort();
}

function classifySettlement(methods = [], accountState = '') {
    const normalized = parseMethods(methods.join(','));
    if (String(accountState || '').toLowerCase() === 'credito'
        || (normalized.length === 1 && normalized[0] === 'credito')) {
        return 'credito';
    }
    if (normalized.length > 1) return 'mixto';
    if (normalized.length === 1) return normalized[0];
    return 'sin_movimientos';
}

function buildFinancialObservation(row = {}) {
    const creditBalance = Number(row.saldo_credito || 0);
    const creditCount = Number(row.creditos_activos || 0);
    if (creditBalance > 0 || row.estado_financiero === 'credito') {
        return `Cuenta liquidada operativamente con ${creditCount || 1} crédito${(creditCount || 1) === 1 ? '' : 's'}; saldo por cobrar ${roundMoney(creditBalance)}`;
    }
    const documents = Number(row.cantidad_documentos || 0);
    const payments = Number(row.cantidad_pagos || 0);
    const split = Number(row.documentos_divididos || 0) > 0 || documents > 1;
    if (split) {
        return `Cuenta dividida: ${documents} documento${documents === 1 ? '' : 's'} operativo${documents === 1 ? '' : 's'} y ${payments} pago${payments === 1 ? '' : 's'}`;
    }
    if (payments > 1) {
        return `Cuenta global liquidada en ${payments} pagos`;
    }
    if (documents === 1) {
        return 'Cuenta global respaldada por una prefactura operativa';
    }
    return 'Cuenta global sin división operativa';
}

function buildZoneClause(zoneIds, accountAlias = 'p', seatAlias = 'm') {
    const normalized = normalizePositiveIds(zoneIds);
    if (!Array.isArray(zoneIds)) return { clause: '', params: [] };
    if (!normalized.length) return { clause: 'AND 1 = 0', params: [] };
    return {
        clause: `AND COALESCE(${accountAlias}.zona_id_snapshot, ${seatAlias}.zona_id) IN (${normalized.map(() => '?').join(',')})`,
        params: normalized
    };
}

function validateIsoRange(startIso, endIso) {
    if (startIso && Number.isNaN(new Date(startIso).getTime())) {
        throw new ValidationError('Fecha inicial inválida', { startIso });
    }
    if (endIso && Number.isNaN(new Date(endIso).getTime())) {
        throw new ValidationError('Fecha final inválida', { endIso });
    }
    if (startIso && endIso && new Date(startIso) >= new Date(endIso)) {
        throw new ValidationError('El rango financiero debe tener una fecha final posterior a la inicial', {
            startIso,
            endIso
        });
    }
}

class FinancialReadService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.accountService = options.accountService || accountService;
    }

    buildAccountReadQuery(filters = {}) {
        const clauses = [];
        const params = [];
        const zone = buildZoneClause(filters.zoneIds, 'p', 'm');
        if (zone.clause) {
            clauses.push(zone.clause.replace(/^AND\s+/i, ''));
            params.push(...zone.params);
        }
        if (filters.accountId) {
            clauses.push('p.id = ?');
            params.push(Number(filters.accountId));
        }
        if (filters.operationalState) {
            clauses.push('p.estado_operativo = ?');
            params.push(String(filters.operationalState));
        }
        if (filters.financialState) {
            clauses.push('p.estado_financiero = ?');
            params.push(String(filters.financialState));
        }
        if (filters.reconciledOnly) {
            clauses.push(`(
                p.estado_financiero = 'conciliada'
                OR (
                    COALESCE(consumo.total_global, 0) > 0
                    AND COALESCE(pagos_agg.total_pagado, 0) >= COALESCE(consumo.total_global, 0)
                )
            )`);
        }

        const financialDateExpression = `COALESCE(p.fecha_conciliacion, pagos_agg.fecha_ultimo_pago)`;
        validateIsoRange(filters.startIso, filters.endIso);
        if (filters.startIso) {
            clauses.push(`${financialDateExpression} >= ?`);
            params.push(filters.startIso);
        }
        if (filters.endIso) {
            clauses.push(`${financialDateExpression} < ?`);
            params.push(filters.endIso);
        }

        const limit = normalizeLimit(filters.limit, 200, 1000);
        return {
            where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
            params,
            limitSql: limit === null ? '' : `LIMIT ${limit}`
        };
    }

    async listAccountReads(filters = {}) {
        const query = this.buildAccountReadQuery(filters);
        const financialDateExpression = 'COALESCE(p.fecha_conciliacion, pagos_agg.fecha_ultimo_pago)';
        const rows = await this.db.all(`
            WITH consumo_base AS (
                SELECT
                    pp.pedido_id,
                    COALESCE(SUM(pp.precio_unitario * pp.cantidad), 0) AS subtotal,
                    COALESCE(SUM(pp.cantidad), 0) AS unidades_consumidas
                FROM pedido_productos pp
                GROUP BY pp.pedido_id
            ),
            consumo AS (
                SELECT
                    cb.pedido_id,
                    cb.subtotal,
                    cb.unidades_consumidas,
                    ROUND(
                        cb.subtotal
                        + CASE
                            WHEN COALESCE(p.aplica_servicio, 0) = 1
                            THEN cb.subtotal * COALESCE(p.porcentaje_servicio, 0) / 100.0
                            ELSE 0
                        END,
                        2
                    ) AS total_global
                FROM consumo_base cb
                JOIN pedidos p ON p.id = cb.pedido_id
            ),
            pagos_agg AS (
                SELECT
                    pg.pedido_id,
                    COUNT(*) AS cantidad_pagos,
                    COALESCE(SUM(pg.monto), 0) AS total_pagado,
                    MIN(pg.fecha) AS fecha_primer_pago,
                    MAX(pg.fecha) AS fecha_ultimo_pago,
                    GROUP_CONCAT(DISTINCT LOWER(COALESCE(pg.metodo_pago_v3, pg.metodo_pago))) AS metodos_pago
                FROM pagos pg
                WHERE COALESCE(pg.estado, 'confirmado') = 'confirmado'
                  AND COALESCE(pg.naturaleza, 'liquidacion_venta') = 'liquidacion_venta'
                GROUP BY pg.pedido_id
            ),
            documentos AS (
                SELECT
                    pf.pedido_id,
                    SUM(CASE WHEN pf.estado <> 'anulada' THEN 1 ELSE 0 END) AS cantidad_documentos,
                    SUM(CASE WHEN pf.estado = 'anulada' THEN 1 ELSE 0 END) AS documentos_anulados,
                    SUM(CASE WHEN pf.estado <> 'anulada' AND pf.tipo = 'dividida' THEN 1 ELSE 0 END) AS documentos_divididos,
                    COALESCE(SUM(CASE WHEN pf.estado <> 'anulada' THEN pf.total ELSE 0 END), 0) AS total_documentado,
                    COALESCE(SUM(CASE WHEN pf.estado <> 'anulada' THEN pf.total_pagado ELSE 0 END), 0) AS total_pagado_documentos,
                    COALESCE(SUM(CASE WHEN pf.estado IN ('emitida', 'parcial') THEN pf.saldo_pendiente ELSE 0 END), 0) AS saldo_documentos
                FROM prefacturas pf
                GROUP BY pf.pedido_id
            ),
            creditos_agg AS (
                SELECT
                    cc.pedido_id,
                    COUNT(CASE WHEN cc.estado IN ('pendiente', 'parcial') THEN 1 END) AS creditos_activos,
                    COUNT(CASE WHEN cc.estado = 'saldado' THEN 1 END) AS creditos_saldados,
                    COALESCE(SUM(CASE WHEN cc.estado IN ('pendiente', 'parcial') THEN cc.saldo_pendiente ELSE 0 END), 0) AS saldo_credito,
                    COALESCE(SUM(CASE WHEN cc.estado <> 'anulado' THEN cc.monto_original ELSE 0 END), 0) AS total_creditado,
                    GROUP_CONCAT(CASE WHEN cc.estado <> 'anulado' THEN cc.numero_credito END, ', ') AS numeros_credito
                FROM cuentas_credito cc
                WHERE cc.pedido_id IS NOT NULL
                GROUP BY cc.pedido_id
            ),
            responsables AS (
                SELECT
                    cr.pedido_id,
                    (
                        SELECT crp.usuario_nombre_snapshot
                        FROM cuenta_responsables crp
                        WHERE crp.pedido_id = cr.pedido_id
                        ORDER BY crp.es_principal DESC, crp.fecha_asignacion_snapshot, crp.usuario_nombre_snapshot
                        LIMIT 1
                    ) AS responsable_principal,
                    GROUP_CONCAT(cr.usuario_nombre_snapshot, ', ') AS responsables
                FROM cuenta_responsables cr
                GROUP BY cr.pedido_id
            )
            SELECT
                p.id,
                p.numero_cuenta,
                p.estado AS estado_legacy,
                p.estado_operativo,
                p.estado_financiero,
                p.fecha,
                p.fecha_apertura,
                p.fecha_conciliacion,
                p.fecha_cierre,
                COALESCE(p.mesa_numero_snapshot, m.numero) AS mesa_numero,
                COALESCE(p.mesa_tipo_snapshot, m.tipo_asiento) AS mesa_tipo,
                COALESCE(p.zona_id_snapshot, m.zona_id) AS zona_id,
                COALESCE(p.zona_nombre_snapshot, z.nombre, m.zona) AS zona_nombre,
                COALESCE(p.cliente_principal_snapshot, p.cliente_nombre, m.cliente_nombre, 'Cliente anónimo') AS cliente_principal,
                u.nombre AS usuario_creador,
                COALESCE(responsables.responsable_principal, u.nombre) AS responsable_principal,
                COALESCE(responsables.responsables, u.nombre) AS responsables,
                COALESCE(consumo.subtotal, p.total, 0) AS subtotal_global,
                COALESCE(p.monto_servicio, 0) AS servicio_global,
                COALESCE(consumo.total_global, p.total_con_servicio, p.total + COALESCE(p.monto_servicio, 0), 0) AS total_global,
                COALESCE(consumo.unidades_consumidas, 0) AS unidades_consumidas,
                COALESCE(documentos.cantidad_documentos, 0) AS cantidad_documentos,
                COALESCE(documentos.documentos_anulados, 0) AS documentos_anulados,
                COALESCE(documentos.documentos_divididos, 0) AS documentos_divididos,
                COALESCE(documentos.total_documentado, 0) AS total_documentado,
                COALESCE(documentos.total_pagado_documentos, 0) AS total_pagado_documentos,
                COALESCE(documentos.saldo_documentos, 0) AS saldo_documentos,
                COALESCE(pagos_agg.cantidad_pagos, 0) AS cantidad_pagos,
                COALESCE(pagos_agg.total_pagado, 0) AS total_pagado_calculado,
                pagos_agg.fecha_primer_pago,
                pagos_agg.fecha_ultimo_pago,
                pagos_agg.metodos_pago,
                COALESCE(creditos_agg.creditos_activos, 0) AS creditos_activos,
                COALESCE(creditos_agg.creditos_saldados, 0) AS creditos_saldados,
                COALESCE(creditos_agg.saldo_credito, 0) AS saldo_credito,
                COALESCE(creditos_agg.total_creditado, 0) AS total_creditado,
                creditos_agg.numeros_credito,
                ${financialDateExpression} AS fecha_financiera
            FROM pedidos p
            JOIN mesas m ON m.id = p.mesa_id
            JOIN usuarios u ON u.id = p.usuario_id
            LEFT JOIN zonas z ON z.id = COALESCE(p.zona_id_snapshot, m.zona_id)
            LEFT JOIN consumo ON consumo.pedido_id = p.id
            LEFT JOIN pagos_agg ON pagos_agg.pedido_id = p.id
            LEFT JOIN documentos ON documentos.pedido_id = p.id
            LEFT JOIN creditos_agg ON creditos_agg.pedido_id = p.id
            LEFT JOIN responsables ON responsables.pedido_id = p.id
            ${query.where}
            ORDER BY ${financialDateExpression} DESC, p.id DESC
            ${query.limitSql}
        `, query.params);

        return rows.map(row => this.normalizeAccountRead(row));
    }

    normalizeAccountRead(row = {}) {
        const totalGlobal = roundMoney(Number(row.total_global || 0));
        const totalPaid = roundMoney(Number(row.total_pagado_calculado || 0));
        const balanceMinor = Math.max(0, toMinorUnits(totalGlobal) - toMinorUnits(totalPaid));
        const methods = parseMethods(row.metodos_pago);
        const creditBalance = roundMoney(Number(row.saldo_credito || 0));
        const financialState = creditBalance > 0
            ? 'credito'
            : (totalGlobal > 0 && toMinorUnits(totalPaid) >= toMinorUnits(totalGlobal)
                ? 'conciliada'
                : (totalPaid > 0 ? 'parcial' : (row.estado_financiero || 'sin_documentos')));
        const quantityDocuments = Number(row.cantidad_documentos || 0);
        const quantityPayments = Number(row.cantidad_pagos || 0);
        const normalized = {
            id: Number(row.id),
            pedido_id: Number(row.id),
            numero_cuenta: row.numero_cuenta || `CTA-${String(row.id).padStart(8, '0')}`,
            fuente_financiera: 'cuenta_global',
            mesa_numero: row.mesa_numero,
            mesa_tipo: row.mesa_tipo || 'mesa',
            tipo_asiento: row.mesa_tipo || 'mesa',
            zona_id: row.zona_id ? Number(row.zona_id) : null,
            zona_nombre: row.zona_nombre || null,
            cliente_principal: row.cliente_principal || 'Cliente anónimo',
            cliente_nombre: row.cliente_principal || 'Cliente anónimo',
            usuario_creador: row.usuario_creador || null,
            usuario_nombre: row.responsable_principal || row.usuario_creador || null,
            responsable_principal: row.responsable_principal || row.usuario_creador || null,
            responsables: row.responsables || row.responsable_principal || row.usuario_creador || '',
            subtotal: roundMoney(Number(row.subtotal_global || 0)),
            servicio: roundMoney(Number(row.servicio_global || 0)),
            total: totalGlobal,
            total_global: totalGlobal,
            total_consumido: totalGlobal,
            total_documentado: roundMoney(Number(row.total_documentado || 0)),
            total_pagado_documentos: roundMoney(Number(row.total_pagado_documentos || 0)),
            saldo_documentos: roundMoney(Number(row.saldo_documentos || 0)),
            total_pagado: totalPaid,
            saldo_pendiente: fromMinorUnits(balanceMinor),
            unidades_consumidas: Number(row.unidades_consumidas || 0),
            cantidad_documentos: quantityDocuments,
            documentos_anulados: Number(row.documentos_anulados || 0),
            documentos_divididos: Number(row.documentos_divididos || 0),
            cantidad_pagos: quantityPayments,
            creditos_activos: Number(row.creditos_activos || 0),
            creditos_saldados: Number(row.creditos_saldados || 0),
            saldo_credito: creditBalance,
            total_creditado: roundMoney(Number(row.total_creditado || 0)),
            numeros_credito: row.numeros_credito || '',
            metodos_pago: methods,
            tipo_liquidacion: classifySettlement(methods, row.estado_financiero),
            es_cuenta_dividida: Number(row.documentos_divididos || 0) > 0 || quantityDocuments > 1,
            estado: ['conciliada', 'credito'].includes(financialState) ? 'pagado' : row.estado_legacy,
            estado_operativo: row.estado_operativo || 'abierta',
            estado_financiero: financialState,
            fecha: row.fecha_financiera || row.fecha_conciliacion || row.fecha_ultimo_pago || row.fecha,
            fecha_venta: row.fecha_financiera || row.fecha_conciliacion || row.fecha_ultimo_pago || null,
            fecha_apertura: row.fecha_apertura || row.fecha || null,
            fecha_conciliacion: row.fecha_conciliacion || null,
            fecha_financiera: row.fecha_financiera || row.fecha_conciliacion || row.fecha_ultimo_pago || null,
            fecha_primer_pago: row.fecha_primer_pago || null,
            fecha_ultimo_pago: row.fecha_ultimo_pago || null,
            fecha_cierre: row.fecha_cierre || null,
            venta_conciliada: ['conciliada', 'credito'].includes(financialState),
            venta_a_credito: financialState === 'credito' || methods.includes('credito'),
            venta_definitiva: ['conciliada', 'credito'].includes(financialState) && row.estado_operativo === 'cerrada'
        };
        normalized.observacion_financiera = buildFinancialObservation(normalized);
        normalized.diferencia_documentada = roundMoney(normalized.total_global - normalized.total_documentado);
        return normalized;
    }

    async listConsolidatedSales(filters = {}) {
        return this.listAccountReads({
            ...filters,
            reconciledOnly: true
        });
    }

    async listCashMovements(filters = {}) {
        validateIsoRange(filters.startIso, filters.endIso);
        const clauses = [];
        const params = [];
        const zone = buildZoneClause(filters.zoneIds, 'p', 'm');
        if (zone.clause) {
            clauses.push(zone.clause.replace(/^AND\s+/i, ''));
            params.push(...zone.params);
        }
        clauses.push("COALESCE(pg.estado, 'confirmado') = 'confirmado'");
        clauses.push("(COALESCE(pg.naturaleza, 'liquidacion_venta') = 'cobro_credito' OR LOWER(COALESCE(pg.metodo_pago_v3, pg.metodo_pago)) <> 'credito')");
        if (filters.accountId) {
            clauses.push('pg.pedido_id = ?');
            params.push(Number(filters.accountId));
        }
        if (filters.startIso) {
            clauses.push('pg.fecha >= ?');
            params.push(filters.startIso);
        }
        if (filters.endIso) {
            clauses.push('pg.fecha < ?');
            params.push(filters.endIso);
        }
        const limit = normalizeLimit(filters.limit, 300, 1000);
        const rows = await this.db.all(`
            SELECT
                pg.id,
                pg.pedido_id,
                pg.prefactura_id,
                pg.credito_id,
                COALESCE(pg.naturaleza, 'liquidacion_venta') AS naturaleza,
                pg.numero_pago,
                pg.estado AS estado_pago,
                COALESCE(pg.metodo_pago_v3, pg.metodo_pago) AS metodo_pago,
                pg.monto,
                COALESCE(pg.monto_recibido, pg.monto) AS monto_recibido,
                COALESCE(pg.vuelto, 0) AS vuelto,
                pg.subtotal,
                pg.servicio,
                pg.referencia,
                pg.cajero_usuario_id,
                pg.cajero_nombre_snapshot,
                pg.pagador_nombre_snapshot,
                pg.fecha,
                pf.numero_documento,
                pf.pagador_nombre AS prefactura_pagador,
                cc.numero_credito,
                cc.cliente_nombre AS credito_cliente,
                p.numero_cuenta,
                p.estado_operativo,
                p.estado_financiero,
                COALESCE(p.cliente_principal_snapshot, p.cliente_nombre, m.cliente_nombre, 'Cliente anónimo') AS cliente_principal,
                COALESCE(p.mesa_numero_snapshot, m.numero) AS mesa_numero,
                COALESCE(p.mesa_tipo_snapshot, m.tipo_asiento) AS mesa_tipo,
                COALESCE(p.zona_id_snapshot, m.zona_id) AS zona_id,
                COALESCE(p.zona_nombre_snapshot, z.nombre, m.zona) AS zona_nombre,
                (
                    SELECT cr.usuario_nombre_snapshot
                    FROM cuenta_responsables cr
                    WHERE cr.pedido_id = p.id
                    ORDER BY cr.es_principal DESC, cr.fecha_asignacion_snapshot, cr.usuario_nombre_snapshot
                    LIMIT 1
                ) AS responsable_principal
            FROM pagos pg
            JOIN pedidos p ON p.id = pg.pedido_id
            LEFT JOIN prefacturas pf ON pf.id = pg.prefactura_id
            LEFT JOIN cuentas_credito cc ON cc.id = pg.credito_id
            JOIN mesas m ON m.id = p.mesa_id
            LEFT JOIN zonas z ON z.id = COALESCE(p.zona_id_snapshot, m.zona_id)
            ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
            ORDER BY pg.fecha DESC, pg.id DESC
            ${limit === null ? '' : `LIMIT ${limit}`}
        `, params);

        return rows.map(row => ({
            id: Number(row.id),
            pago_id: Number(row.id),
            pedido_id: Number(row.pedido_id),
            numero_cuenta: row.numero_cuenta || `CTA-${String(row.pedido_id).padStart(8, '0')}`,
            fuente: 'movimiento_caja',
            monto: roundMoney(Number(row.monto || 0)),
            subtotal: roundMoney(Number(row.subtotal || 0)),
            servicio: roundMoney(Number(row.servicio || 0)),
            metodo_pago: row.metodo_pago,
            monto_recibido: roundMoney(Number(row.monto_recibido ?? row.monto ?? 0)),
            vuelto: roundMoney(Number(row.vuelto || 0)),
            fecha: row.fecha,
            cliente_principal: row.cliente_principal,
            mesa_numero: row.mesa_numero,
            mesa_tipo: row.mesa_tipo || 'mesa',
            zona_id: row.zona_id ? Number(row.zona_id) : null,
            zona_nombre: row.zona_nombre || null,
            responsable_principal: row.responsable_principal || null,
            estado_operativo: row.estado_operativo,
            estado_financiero: row.estado_financiero,
            prefactura_id: row.prefactura_id ? Number(row.prefactura_id) : null,
            credito_id: row.credito_id ? Number(row.credito_id) : null,
            numero_credito: row.numero_credito || null,
            naturaleza: row.naturaleza || 'liquidacion_venta',
            numero_pago: row.numero_pago || `PG-${String(row.id).padStart(8, '0')}`,
            estado_pago: row.estado_pago || 'confirmado',
            numero_documento: row.numero_documento || null,
            pagador_nombre: row.pagador_nombre_snapshot || row.prefactura_pagador || row.credito_cliente || null,
            cajero_usuario_id: row.cajero_usuario_id ? Number(row.cajero_usuario_id) : null,
            cajero_nombre: row.cajero_nombre_snapshot || null,
            referencia: row.referencia || null,
            vinculo_documental: row.credito_id
                ? (row.naturaleza === 'cobro_credito' ? 'paymentservice_credito' : 'paymentservice_credito_apertura')
                : (row.prefactura_id ? 'paymentservice' : 'legacy_cuenta_global')
        }));
    }

    async listOperationalDocuments(accountId) {
        const id = Number(accountId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de cuenta inválido', { accountId });
        }
        return this.db.all(`
            SELECT
                id,
                pedido_id,
                numero_documento,
                ordinal_cuenta,
                tipo,
                pagador_nombre,
                estado,
                estado_impresion,
                subtotal,
                servicio,
                total,
                total_pagado,
                saldo_pendiente,
                fecha_emision,
                fecha_pago,
                fecha_anulacion
            FROM prefacturas
            WHERE pedido_id = ?
            ORDER BY ordinal_cuenta, id
        `, [id]);
    }

    async getAccountFinancialRead(accountId) {
        const id = Number(accountId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de cuenta inválido', { accountId });
        }
        const [base] = await this.listAccountReads({ accountId: id, limit: 1 });
        if (!base) throw new NotFoundError('Cuenta global no encontrada', { accountId: id });

        const [account, documents, movements, credits] = await Promise.all([
            this.accountService.getAccount(id),
            this.listOperationalDocuments(id),
            this.listCashMovements({ accountId: id, limit: null }),
            this.db.all(`
                SELECT
                    id, numero_credito, prefactura_id, estado,
                    cliente_nombre, monto_original, total_abonado,
                    saldo_pendiente, fecha, fecha_ultimo_abono, fecha_saldo
                FROM cuentas_credito
                WHERE pedido_id = ? AND estado <> 'anulado'
                ORDER BY fecha, id
            `, [id])
        ]);
        const movementTotal = movements.reduce((total, movement) => addMoney(total, movement.monto), 0);
        const documentTotal = documents
            .filter(document => document.estado !== 'anulada')
            .reduce((total, document) => addMoney(total, Number(document.total || 0)), 0);
        const items = (account.productos || []).map(item => ({
            pedido_producto_id: item.pedido_producto_id || item.id,
            producto_nombre: item.producto_nombre,
            presentacion_nombre: item.presentacion_nombre || '',
            cantidad: item.cantidad_consumida ?? item.cantidad,
            precio: item.precio_unitario,
            precio_unitario: item.precio_unitario,
            subtotal: item.subtotal_consumido,
            cantidad_disponible: item.cantidad_disponible,
            cantidad_documentada: item.cantidad_documentada,
            cantidad_pagada: item.cantidad_pagada
        }));

        return {
            ...base,
            items,
            productos: items,
            documentos_operativos: documents,
            movimientos_caja: movements,
            creditos: credits.map(credit => ({
                ...credit,
                monto_original: roundMoney(Number(credit.monto_original || 0)),
                total_abonado: roundMoney(Number(credit.total_abonado || 0)),
                saldo_pendiente: roundMoney(Number(credit.saldo_pendiente || 0))
            })),
            responsables_detalle: account.responsables || [],
            conciliacion: {
                fuente_financiera: 'cuenta_global',
                venta_global: base.total_global,
                documentos_operativos: roundMoney(documentTotal),
                movimientos_caja: roundMoney(movementTotal),
                diferencia_venta_vs_pagos: roundMoney(base.total_global - movementTotal),
                diferencia_venta_vs_documentos: roundMoney(base.total_global - documentTotal),
                conciliada: toMinorUnits(base.total_global) === toMinorUnits(movementTotal)
            }
        };
    }

    async getPeriodSummary(filters = {}) {
        const [sales, movements] = await Promise.all([
            this.listConsolidatedSales({ ...filters, limit: null }),
            this.listCashMovements({ ...filters, limit: null })
        ]);
        const totalSales = sales.reduce((total, sale) => addMoney(total, sale.total_global), 0);
        const movementTotal = movements.reduce((total, movement) => addMoney(total, movement.monto), 0);
        const bySettlement = sales.reduce((summary, sale) => {
            const key = sale.tipo_liquidacion === 'credito' ? 'credito'
                : sale.tipo_liquidacion === 'mixto' ? 'mixto'
                    : 'contado';
            summary[key] = addMoney(summary[key], sale.total_global);
            return summary;
        }, { contado: 0, credito: 0, mixto: 0 });

        return {
            ventas: sales,
            movimientos: movements,
            cuentas_conciliadas: sales.length,
            cantidad_movimientos_caja: movements.length,
            total_ventas_globales: totalSales,
            total_movimientos_caja: movementTotal,
            diferencia_periodo: roundMoney(totalSales - movementTotal),
            ventas_por_liquidacion: bySettlement,
            criterio_fecha_ventas: 'fecha_conciliacion',
            criterio_fecha_movimientos: 'fecha_pago'
        };
    }

    async getSalesStats(filters = {}) {
        const bucket = filters.bucket === 'hour' ? 'hour' : 'day';
        const sales = await this.listConsolidatedSales({ ...filters, limit: null });
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: COSTA_RICA_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            ...(bucket === 'hour' ? { hour: '2-digit', hourCycle: 'h23' } : {})
        });
        const grouped = new Map();
        for (const sale of sales) {
            const date = new Date(sale.fecha_financiera || sale.fecha);
            if (Number.isNaN(date.getTime())) continue;
            const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
            const key = bucket === 'hour'
                ? String(parts.hour || '00').padStart(2, '0')
                : `${parts.year}-${parts.month}-${parts.day}`;
            const current = grouped.get(key) || { periodo: key, pedidos: 0, ventas: 0 };
            current.pedidos += 1;
            current.ventas = addMoney(current.ventas, sale.total_global);
            grouped.set(key, current);
        }
        return [...grouped.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
    }
}

const financialReadService = new FinancialReadService();

module.exports = financialReadService;
module.exports.FinancialReadService = FinancialReadService;
module.exports.getCostaRicaDayRange = getCostaRicaDayRange;
module.exports.getCostaRicaDateParts = getCostaRicaDateParts;
module.exports.parseMethods = parseMethods;
module.exports.buildFinancialObservation = buildFinancialObservation;
