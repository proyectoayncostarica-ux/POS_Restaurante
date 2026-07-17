const database = require('../db/database');
const preinvoiceService = require('./preinvoiceService');
const paymentService = require('./paymentService');
const financialReadService = require('./financialReadService');
const creditService = require('./creditService');
const { ValidationError, NotFoundError } = require('../errors/domainError');
const { addMoney, roundMoney, toMinorUnits } = require('../utils/money');

const QUEUE_STATES = Object.freeze({
    PENDING: 'pendiente',
    ISSUED: 'emitida',
    PARTIAL: 'parcial',
    PAID: 'pagada',
    VOIDED: 'anulada',
    ALL: 'todos'
});

function normalizePositiveInteger(value, fallback, maximum = 200) {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new ValidationError('Parámetro numérico inválido', { value });
    }
    return Math.min(number, maximum);
}

function normalizeQueueState(value) {
    const state = String(value || QUEUE_STATES.PENDING).trim().toLowerCase();
    if (!Object.values(QUEUE_STATES).includes(state)) {
        throw new ValidationError('Estado de cola inválido', {
            value,
            allowed: Object.values(QUEUE_STATES)
        });
    }
    return state;
}

function normalizeSearch(value) {
    const search = String(value || '').trim().replace(/\s+/g, ' ');
    if (search.length > 120) {
        throw new ValidationError('La búsqueda supera la longitud permitida', { maxLength: 120 });
    }
    return search;
}

function parseResponsibilities(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function buildStateClause(state) {
    if (state === QUEUE_STATES.PENDING) {
        return {
            clause: "pf.estado IN ('emitida', 'parcial')",
            params: []
        };
    }
    if (state === QUEUE_STATES.ALL) return { clause: '1 = 1', params: [] };
    return { clause: 'pf.estado = ?', params: [state] };
}

class CashReadService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.preinvoiceService = options.preinvoiceService || preinvoiceService;
        this.paymentService = options.paymentService || paymentService;
        this.financialReadService = options.financialReadService || financialReadService;
        this.creditService = options.creditService || creditService;
    }

    buildQueueFilter(filters = {}) {
        const state = normalizeQueueState(filters.state ?? filters.estado);
        const search = normalizeSearch(filters.search ?? filters.buscar ?? filters.q);
        const limit = normalizePositiveInteger(filters.limit ?? filters.limite, 100, 200);
        const offset = normalizePositiveInteger(filters.offset ?? filters.desde, 0, 1000000);
        const clauses = [];
        const params = [];
        const stateFilter = buildStateClause(state);
        clauses.push(stateFilter.clause);
        params.push(...stateFilter.params);

        if (state === QUEUE_STATES.PENDING) {
            clauses.push("p.estado_operativo IN ('abierta', 'finalizando')");
        }

        if (search) {
            const term = `%${search.toLowerCase()}%`;
            clauses.push(`(
                LOWER(COALESCE(pf.numero_documento, '')) LIKE ?
                OR LOWER(COALESCE(p.numero_cuenta, pf.numero_cuenta_snapshot, '')) LIKE ?
                OR LOWER(COALESCE(pf.pagador_nombre, '')) LIKE ?
                OR LOWER(COALESCE(p.cliente_principal_snapshot, p.cliente_nombre, pf.cliente_principal_snapshot, '')) LIKE ?
                OR LOWER(COALESCE(pf.zona_nombre_snapshot, p.zona_nombre_snapshot, z.nombre, m.zona, '')) LIKE ?
                OR CAST(COALESCE(pf.mesa_numero_snapshot, p.mesa_numero_snapshot, m.numero) AS TEXT) LIKE ?
                OR LOWER(COALESCE(pf.emitida_por_nombre_snapshot, '')) LIKE ?
            )`);
            params.push(term, term, term, term, term, term, term);
        }

        return {
            state,
            search,
            limit,
            offset,
            where: `WHERE ${clauses.join(' AND ')}`,
            params
        };
    }

    queueBaseSql() {
        return `
            WITH pagos_documento AS (
                SELECT
                    pg.prefactura_id,
                    COUNT(CASE WHEN pg.estado = 'confirmado' THEN 1 END) AS cantidad_pagos_confirmados,
                    COUNT(CASE WHEN pg.estado = 'anulado' THEN 1 END) AS cantidad_pagos_anulados,
                    COALESCE(SUM(CASE WHEN pg.estado = 'confirmado' THEN pg.monto ELSE 0 END), 0) AS total_pagado_confirmado,
                    MAX(CASE WHEN pg.estado = 'confirmado' THEN pg.fecha END) AS fecha_ultimo_pago
                FROM pagos pg
                WHERE pg.prefactura_id IS NOT NULL
                GROUP BY pg.prefactura_id
            ),
            documentos_cuenta AS (
                SELECT
                    pf.pedido_id,
                    COUNT(CASE WHEN pf.estado <> 'anulada' THEN 1 END) AS cantidad_documentos_activos,
                    COUNT(CASE WHEN pf.estado IN ('emitida', 'parcial') THEN 1 END) AS cantidad_documentos_pendientes,
                    COUNT(CASE WHEN pf.estado <> 'anulada' AND pf.tipo = 'dividida' THEN 1 END) AS cantidad_documentos_divididos,
                    COALESCE(SUM(CASE WHEN pf.estado IN ('emitida', 'parcial') THEN pf.saldo_pendiente ELSE 0 END), 0) AS saldo_documental_pendiente
                FROM prefacturas pf
                GROUP BY pf.pedido_id
            ),
            responsable_principal AS (
                SELECT
                    cr.pedido_id,
                    (
                        SELECT cr2.usuario_nombre_snapshot
                        FROM cuenta_responsables cr2
                        WHERE cr2.pedido_id = cr.pedido_id
                        ORDER BY cr2.es_principal DESC, cr2.fecha_asignacion_snapshot, cr2.usuario_nombre_snapshot
                        LIMIT 1
                    ) AS nombre
                FROM cuenta_responsables cr
                GROUP BY cr.pedido_id
            )
            SELECT
                pf.id,
                pf.pedido_id,
                pf.numero_documento,
                pf.ordinal_cuenta,
                pf.tipo,
                pf.pagador_nombre,
                pf.estado,
                pf.estado_impresion,
                pf.subtotal,
                pf.servicio,
                pf.total,
                COALESCE(pd.total_pagado_confirmado, pf.total_pagado, 0) AS total_pagado,
                MAX(0, ROUND(pf.total - COALESCE(pd.total_pagado_confirmado, pf.total_pagado, 0), 2)) AS saldo_pendiente,
                pf.fecha_emision,
                pf.fecha_pago,
                pf.actualizado_en,
                pf.version,
                pf.numero_cuenta_snapshot,
                pf.mesa_id_snapshot,
                pf.mesa_numero_snapshot,
                pf.mesa_tipo_snapshot,
                pf.zona_id_snapshot,
                pf.zona_nombre_snapshot,
                pf.cliente_principal_snapshot,
                pf.responsables_snapshot,
                pf.emitida_por_nombre_snapshot,
                COALESCE(pd.cantidad_pagos_confirmados, 0) AS cantidad_pagos_confirmados,
                COALESCE(pd.cantidad_pagos_anulados, 0) AS cantidad_pagos_anulados,
                pd.fecha_ultimo_pago,
                p.numero_cuenta,
                p.estado_operativo,
                p.estado_financiero,
                p.total_con_servicio AS total_cuenta_global,
                p.total_pagado AS total_pagado_cuenta_global,
                p.saldo_pendiente AS saldo_cuenta_global,
                p.cliente_principal_snapshot AS cliente_principal_cuenta,
                p.fecha_apertura AS fecha_apertura_cuenta,
                COALESCE(p.mesa_numero_snapshot, m.numero, pf.mesa_numero_snapshot) AS mesa_numero,
                COALESCE(p.mesa_tipo_snapshot, m.tipo_asiento, pf.mesa_tipo_snapshot) AS mesa_tipo,
                COALESCE(p.zona_id_snapshot, m.zona_id, pf.zona_id_snapshot) AS zona_id,
                COALESCE(p.zona_nombre_snapshot, z.nombre, m.zona, pf.zona_nombre_snapshot) AS zona_nombre,
                COALESCE(rp.nombre, pf.emitida_por_nombre_snapshot) AS responsable_principal,
                COALESCE(dc.cantidad_documentos_activos, 0) AS cantidad_documentos_activos,
                COALESCE(dc.cantidad_documentos_pendientes, 0) AS cantidad_documentos_pendientes,
                COALESCE(dc.cantidad_documentos_divididos, 0) AS cantidad_documentos_divididos,
                COALESCE(dc.saldo_documental_pendiente, 0) AS saldo_documental_pendiente
            FROM prefacturas pf
            JOIN pedidos p ON p.id = pf.pedido_id
            LEFT JOIN mesas m ON m.id = p.mesa_id
            LEFT JOIN zonas z ON z.id = COALESCE(p.zona_id_snapshot, m.zona_id)
            LEFT JOIN pagos_documento pd ON pd.prefactura_id = pf.id
            LEFT JOIN documentos_cuenta dc ON dc.pedido_id = pf.pedido_id
            LEFT JOIN responsable_principal rp ON rp.pedido_id = pf.pedido_id
        `;
    }

    mapQueueDocument(row) {
        const balance = roundMoney(Number(row.saldo_pendiente || 0));
        const accountDocumentCount = Number(row.cantidad_documentos_activos || 0);
        const divided = Number(row.cantidad_documentos_divididos || 0) > 0 || accountDocumentCount > 1;
        return {
            id: Number(row.id),
            pedido_id: Number(row.pedido_id),
            numero_documento: row.numero_documento,
            ordinal_cuenta: Number(row.ordinal_cuenta || 0),
            tipo: row.tipo,
            pagador_nombre: row.pagador_nombre,
            estado: row.estado,
            estado_impresion: row.estado_impresion,
            subtotal: roundMoney(Number(row.subtotal || 0)),
            servicio: roundMoney(Number(row.servicio || 0)),
            total: roundMoney(Number(row.total || 0)),
            total_pagado: roundMoney(Number(row.total_pagado || 0)),
            saldo_pendiente: balance,
            cantidad_pagos_confirmados: Number(row.cantidad_pagos_confirmados || 0),
            cantidad_pagos_anulados: Number(row.cantidad_pagos_anulados || 0),
            fecha_emision: row.fecha_emision,
            fecha_ultimo_pago: row.fecha_ultimo_pago || null,
            version: Number(row.version || 1),
            cuenta_dividida: divided,
            puede_cobrar: ['emitida', 'parcial'].includes(row.estado)
                && balance > 0
                && ['abierta', 'finalizando'].includes(row.estado_operativo),
            cuenta_global: {
                id: Number(row.pedido_id),
                numero_cuenta: row.numero_cuenta || row.numero_cuenta_snapshot,
                estado_operativo: row.estado_operativo,
                estado_financiero: row.estado_financiero,
                total: roundMoney(Number(row.total_cuenta_global || 0)),
                total_pagado: roundMoney(Number(row.total_pagado_cuenta_global || 0)),
                saldo_pendiente: roundMoney(Number(row.saldo_cuenta_global || 0)),
                cliente_principal: row.cliente_principal_cuenta || row.cliente_principal_snapshot || 'Cliente anónimo',
                responsable_principal: row.responsable_principal || null,
                mesa: {
                    id: row.mesa_id_snapshot ? Number(row.mesa_id_snapshot) : null,
                    numero: row.mesa_numero,
                    tipo: row.mesa_tipo || 'mesa'
                },
                zona: {
                    id: row.zona_id ? Number(row.zona_id) : null,
                    nombre: row.zona_nombre || 'Sin zona'
                },
                fecha_apertura: row.fecha_apertura_cuenta,
                cantidad_documentos_activos: accountDocumentCount,
                cantidad_documentos_pendientes: Number(row.cantidad_documentos_pendientes || 0),
                saldo_documental_pendiente: roundMoney(Number(row.saldo_documental_pendiente || 0)),
                cuenta_dividida: divided
            }
        };
    }

    groupQueueByAccount(documents) {
        const grouped = new Map();
        for (const document of documents) {
            const accountId = document.cuenta_global.id;
            if (!grouped.has(accountId)) {
                grouped.set(accountId, {
                    ...document.cuenta_global,
                    documentos: [],
                    documentos_en_resultado: 0,
                    total_documentos_resultado: 0,
                    saldo_documentos_resultado: 0
                });
            }
            const account = grouped.get(accountId);
            account.documentos.push({ ...document, cuenta_global: undefined });
            account.documentos_en_resultado += 1;
            account.total_documentos_resultado = addMoney(account.total_documentos_resultado, document.total);
            account.saldo_documentos_resultado = addMoney(account.saldo_documentos_resultado, document.saldo_pendiente);
        }
        return [...grouped.values()];
    }

    async listCollectionQueue(filters = {}) {
        const filter = this.buildQueueFilter(filters);
        const baseSql = this.queueBaseSql();
        const [rows, countRow] = await Promise.all([
            this.db.all(`
                ${baseSql}
                ${filter.where}
                ORDER BY
                    CASE pf.estado WHEN 'parcial' THEN 0 WHEN 'emitida' THEN 1 WHEN 'pagada' THEN 2 ELSE 3 END,
                    pf.fecha_emision,
                    pf.numero_secuencia
                LIMIT ? OFFSET ?
            `, [...filter.params, filter.limit, filter.offset]),
            this.db.get(`
                SELECT COUNT(*) AS total
                FROM (
                    ${baseSql}
                    ${filter.where}
                ) queue_count
            `, filter.params)
        ]);

        const documents = rows.map(row => this.mapQueueDocument(row));
        const accounts = this.groupQueueByAccount(documents);
        return {
            cuentas: accounts,
            documentos: documents,
            resumen: {
                cuentas_en_resultado: accounts.length,
                documentos_en_resultado: documents.length,
                total_documentos: Number(countRow?.total || 0),
                saldo_visible: documents.reduce((sum, document) => addMoney(sum, document.saldo_pendiente), 0),
                cuentas_divididas: accounts.filter(account => account.cuenta_dividida).length
            },
            filtros: {
                estado: filter.state,
                buscar: filter.search,
                limite: filter.limit,
                desplazamiento: filter.offset
            }
        };
    }

    async getPreinvoiceCollectionRead(preinvoiceId) {
        const id = Number(preinvoiceId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de prefactura inválido', { preinvoiceId });
        }
        const document = await this.preinvoiceService.getPreinvoice(id);
        const [payments, account, creditRow] = await Promise.all([
            this.paymentService.listByPreinvoice(id),
            this.financialReadService.getAccountFinancialRead(document.pedido_id),
            this.db.get(`
                SELECT id
                FROM cuentas_credito
                WHERE prefactura_id = ? AND estado <> 'anulado'
                ORDER BY id DESC
                LIMIT 1
            `, [id])
        ]);
        const credit = creditRow ? await this.creditService.getCredit(creditRow.id) : null;
        const confirmed = payments.filter(payment => payment.estado === 'confirmado');
        const voided = payments.filter(payment => payment.estado === 'anulado');
        const confirmedTotal = confirmed.reduce((sum, payment) => addMoney(sum, payment.monto), 0);
        const balance = Math.max(0, roundMoney(Number(document.total || 0) - confirmedTotal));
        const divided = Number(account.cantidad_documentos || 0) > 1
            || account.documentos_operativos.some(item => item.tipo === 'dividida' && item.estado !== 'anulada');

        return {
            prefactura: {
                ...document,
                responsables: document.responsables || parseResponsibilities(document.responsables_snapshot),
                total_pagado_calculado: confirmedTotal,
                saldo_pendiente_calculado: balance,
                cantidad_pagos_confirmados: confirmed.length,
                cantidad_pagos_anulados: voided.length
            },
            cuenta_global: {
                id: account.id,
                numero_cuenta: account.numero_cuenta,
                cliente_principal: account.cliente_principal,
                responsable_principal: account.responsable_principal,
                responsables: account.responsables_detalle || [],
                mesa_numero: account.mesa_numero,
                mesa_tipo: account.mesa_tipo,
                zona_id: account.zona_id,
                zona_nombre: account.zona_nombre,
                estado_operativo: account.estado_operativo,
                estado_financiero: account.estado_financiero,
                total: account.total_global,
                total_pagado: account.total_pagado_calculado,
                saldo_pendiente: account.saldo_pendiente,
                cantidad_documentos: account.cantidad_documentos,
                cuenta_dividida: divided
            },
            pagos: payments,
            credito: credit,
            acciones: {
                puede_cobrar: ['emitida', 'parcial'].includes(document.estado)
                    && balance > 0
                    && !credit
                    && ['abierta', 'finalizando'].includes(account.estado_operativo),
                puede_trasladar_credito: ['emitida', 'parcial'].includes(document.estado)
                    && balance > 0
                    && !credit
                    && ['abierta', 'finalizando'].includes(account.estado_operativo),
                puede_abonar_credito: Boolean(credit?.acciones?.puede_abonar),
                puede_reimprimir: document.estado !== 'anulada',
                puede_reversar: confirmed.length > 0,
                requiere_finalizacion_explicita: account.estado_operativo === 'abierta'
            },
            integridad: {
                total_documento: roundMoney(Number(document.total || 0)),
                total_pagado_confirmado: confirmedTotal,
                saldo_calculado: balance,
                coincide_con_saldo_persistido: toMinorUnits(balance) === toMinorUnits(document.saldo_pendiente || 0),
                fuente_financiera: 'cuenta_global'
            }
        };
    }

    async registerReprintRequest(input = {}) {
        const preinvoiceId = Number(input.preinvoiceId ?? input.prefactura_id);
        const userId = Number(input.userId ?? input.usuario_id);
        const now = input.now || new Date().toISOString();
        if (!Number.isSafeInteger(preinvoiceId) || preinvoiceId <= 0) {
            throw new ValidationError('ID de prefactura inválido', { preinvoiceId });
        }
        if (!Number.isSafeInteger(userId) || userId <= 0) {
            throw new ValidationError('El usuario solicitante es requerido', { userId });
        }

        await this.db.withTransaction(async tx => {
            const [document, user] = await Promise.all([
                tx.get('SELECT id, estado, estado_impresion FROM prefacturas WHERE id = ?', [preinvoiceId]),
                tx.get('SELECT id, nombre, activo FROM usuarios WHERE id = ?', [userId])
            ]);
            if (!document) throw new NotFoundError('Prefactura no encontrada', { preinvoiceId });
            if (!user || Number(user.activo ?? 1) !== 1) {
                throw new NotFoundError('Usuario activo no encontrado', { userId });
            }
            await tx.run(`
                INSERT INTO historial_prefacturas (
                    prefactura_id, evento, estado_anterior, estado_nuevo,
                    usuario_id, usuario_nombre_snapshot, detalle, fecha
                ) VALUES (?, 'reimpresion_solicitada_caja', ?, ?, ?, ?, ?, ?)
            `, [
                preinvoiceId,
                document.estado,
                document.estado,
                user.id,
                user.nombre,
                JSON.stringify({
                    canal: 'caja',
                    estado_impresion_actual: document.estado_impresion,
                    trabajo_impresion_creado: false,
                    pendiente_servicio_printing: true
                }),
                now
            ]);
        }, { mode: 'IMMEDIATE' });

        const read = await this.getPreinvoiceCollectionRead(preinvoiceId);
        return {
            ...read,
            solicitud_reimpresion: {
                registrada: true,
                fecha: now,
                trabajo_impresion_creado: false,
                modo_actual: 'lectura_imprimible_navegador',
                pendiente_modulo_printing: true
            }
        };
    }

    async getAccountCollectionRead(accountId) {
        const id = Number(accountId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de cuenta inválido', { accountId });
        }
        const account = await this.financialReadService.getAccountFinancialRead(id);
        if (!account) throw new NotFoundError('Cuenta global no encontrada', { accountId: id });
        const documents = await Promise.all(
            account.documentos_operativos.map(document => this.getPreinvoiceCollectionRead(document.id))
        );
        return {
            cuenta_global: account,
            prefacturas: documents.map(item => item.prefactura),
            pagos: documents.flatMap(item => item.pagos),
            resumen_cobro: {
                cuenta_dividida: documents.filter(item => item.prefactura.estado !== 'anulada').length > 1
                    || documents.some(item => item.prefactura.tipo === 'dividida' && item.prefactura.estado !== 'anulada'),
                prefacturas_activas: documents.filter(item => item.prefactura.estado !== 'anulada').length,
                prefacturas_pendientes: documents.filter(item => ['emitida', 'parcial'].includes(item.prefactura.estado)).length,
                prefacturas_pagadas: documents.filter(item => item.prefactura.estado === 'pagada').length,
                saldo_documental: documents
                    .filter(item => item.prefactura.estado !== 'anulada')
                    .reduce((sum, item) => addMoney(sum, item.prefactura.saldo_pendiente_calculado), 0)
            }
        };
    }
}

const cashReadService = new CashReadService();

module.exports = cashReadService;
module.exports.CashReadService = CashReadService;
module.exports.QUEUE_STATES = QUEUE_STATES;
module.exports.normalizeQueueState = normalizeQueueState;
