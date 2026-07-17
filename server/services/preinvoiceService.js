const database = require('../db/database');
const accountServiceSingleton = require('./accountService');
const documentSequenceServiceSingleton = require('./documentSequenceService');
const { TransactionService } = require('./transactionService');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    IdempotencyConflictError,
    InvariantError
} = require('../errors/domainError');
const {
    addMoney,
    multiplyMoney,
    percentageOf,
    roundMoney
} = require('../utils/money');
const {
    normalizeIdempotencyKey,
    createRequestFingerprint
} = require('../utils/idempotency');
const {
    ACCOUNT_OPERATIONAL_STATES,
    ACCOUNT_FINANCIAL_STATES
} = require('./accountService');
const { DOCUMENT_SEQUENCE_TYPES } = require('./documentSequenceService');

const PREINVOICE_TYPES = Object.freeze({
    FULL: 'completa',
    SPLIT: 'dividida'
});

const PREINVOICE_STATES = Object.freeze({
    ISSUED: 'emitida',
    PARTIAL: 'parcial',
    PAID: 'pagada',
    VOIDED: 'anulada'
});

const PREINVOICE_PRINT_STATES = Object.freeze({
    PENDING: 'pendiente',
    PRINTED: 'impresa',
    FAILED: 'fallida'
});

function normalizeName(value, field = 'nombre', maxLength = 120) {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    if (!normalized) {
        throw new ValidationError(`El ${field} es requerido`);
    }
    if (normalized.length > maxLength) {
        throw new ValidationError(`El ${field} supera la longitud permitida`, {
            maxLength
        });
    }
    return normalized;
}

function normalizeOptionalText(value, maxLength = 500) {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    if (normalized.length > maxLength) {
        throw new ValidationError('El texto supera la longitud permitida', { maxLength });
    }
    return normalized;
}

function normalizePreinvoiceType(value) {
    const normalized = String(value || PREINVOICE_TYPES.SPLIT).trim().toLowerCase();
    if (!Object.values(PREINVOICE_TYPES).includes(normalized)) {
        throw new ValidationError('Tipo de prefactura inválido', { value });
    }
    return normalized;
}

class PreinvoiceService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.transactions = options.transactions || new TransactionService(this.db);
        this.accountService = options.accountService || accountServiceSingleton;
        this.sequenceService = options.sequenceService || documentSequenceServiceSingleton;
    }

    calculateLineSnapshot(line, quantity) {
        const unitPrice = roundMoney(Number(line.precio_unitario || 0));
        const subtotal = multiplyMoney(unitPrice, quantity);
        const appliesService = Number(line.aplica_servicio_snapshot || 0) === 1;
        const percentage = appliesService
            ? Math.max(0, Math.min(100, Number(line.porcentaje_servicio_snapshot || 0)))
            : 0;
        const service = appliesService ? percentageOf(subtotal, percentage) : 0;

        return {
            pedido_producto_id: Number(line.pedido_producto_id || line.id),
            producto_id: Number(line.producto_id),
            presentacion_id: line.presentacion_id ? Number(line.presentacion_id) : null,
            cantidad: Number(quantity),
            producto_nombre_snapshot: line.producto_nombre_snapshot || line.producto_nombre || 'Producto',
            presentacion_nombre_snapshot: line.presentacion_nombre_snapshot || line.presentacion_nombre || null,
            presentacion_cantidad_snapshot: line.presentacion_cantidad_snapshot || line.presentacion_cantidad || null,
            precio_unitario: unitPrice,
            subtotal,
            aplica_servicio: appliesService ? 1 : 0,
            porcentaje_servicio: percentage,
            servicio_unitario: roundMoney(Number(line.servicio_unitario_snapshot || 0)),
            servicio_total: service,
            total_linea: addMoney(subtotal, service)
        };
    }

    async getAccountDocumentContext(accountId, client) {
        const account = await client.get(`
            SELECT
                p.*,
                COALESCE(p.mesa_numero_snapshot, m.numero) AS mesa_numero_documento,
                COALESCE(p.mesa_tipo_snapshot, m.tipo_asiento) AS mesa_tipo_documento,
                COALESCE(p.zona_id_snapshot, m.zona_id) AS zona_id_documento,
                COALESCE(p.zona_nombre_snapshot, z.nombre, m.zona) AS zona_nombre_documento,
                COALESCE(p.cliente_principal_snapshot, p.cliente_nombre, m.cliente_nombre) AS cliente_principal_documento
            FROM pedidos p
            JOIN mesas m ON m.id = p.mesa_id
            LEFT JOIN zonas z ON z.id = m.zona_id
            WHERE p.id = ?
        `, [accountId]);

        if (!account) throw new NotFoundError('Cuenta global no encontrada', { accountId });
        if (account.estado_operativo !== ACCOUNT_OPERATIONAL_STATES.OPEN) {
            throw new ConflictError('Solo una cuenta abierta puede emitir prefacturas', {
                code: 'ACCOUNT_NOT_OPEN',
                accountId,
                estado_operativo: account.estado_operativo
            });
        }

        const responsibilities = await client.all(`
            SELECT
                usuario_id,
                rol_trabajo_id,
                usuario_nombre_snapshot AS usuario_nombre,
                rol_nombre_snapshot AS rol_nombre,
                es_principal,
                fecha_asignacion_snapshot
            FROM cuenta_responsables
            WHERE pedido_id = ?
            ORDER BY es_principal DESC, fecha_asignacion_snapshot, usuario_nombre_snapshot
        `, [accountId]);

        return { account, responsibilities };
    }

    buildRequestFingerprint({ accountId, payerName, type, assignments, issuedByUserId }) {
        return createRequestFingerprint({
            accountId: Number(accountId),
            payerName,
            type,
            issuedByUserId: Number(issuedByUserId),
            assignments: assignments
                .map(item => ({
                    pedido_producto_id: Number(item.pedido_producto_id),
                    cantidad: Number(item.cantidad),
                    version: item.version === null ? null : Number(item.version)
                }))
                .sort((a, b) => a.pedido_producto_id - b.pedido_producto_id)
        });
    }

    async assertCompleteAssignments(accountId, assignments, client) {
        const availableLines = await client.all(`
            SELECT
                id AS pedido_producto_id,
                cantidad - COALESCE(cantidad_asignada, 0) AS cantidad_disponible
            FROM pedido_productos
            WHERE pedido_id = ?
              AND cantidad - COALESCE(cantidad_asignada, 0) > 0
            ORDER BY id
        `, [accountId]);

        const requested = new Map(assignments.map(item => [
            Number(item.pedido_producto_id),
            Number(item.cantidad)
        ]));
        const available = new Map(availableLines.map(item => [
            Number(item.pedido_producto_id),
            Number(item.cantidad_disponible)
        ]));

        const exact = requested.size === available.size
            && [...available.entries()].every(([lineId, quantity]) => requested.get(lineId) === quantity);

        if (!exact) {
            throw new ConflictError(
                'La prefactura completa debe incluir todo el consumo disponible de la cuenta',
                {
                    code: 'PREINVOICE_COMPLETE_REQUIRES_ALL_AVAILABLE',
                    accountId,
                    available: [...available.entries()].map(([pedido_producto_id, cantidad]) => ({
                        pedido_producto_id,
                        cantidad
                    }))
                }
            );
        }
    }

    async createPreinvoice(input = {}) {
        const accountId = Number(input.accountId ?? input.pedido_id);
        const issuedByUserId = Number(input.issuedByUserId ?? input.usuario_id);
        if (!Number.isSafeInteger(accountId) || accountId <= 0) {
            throw new ValidationError('La cuenta global es requerida');
        }
        if (!Number.isSafeInteger(issuedByUserId) || issuedByUserId <= 0) {
            throw new ValidationError('El usuario emisor es requerido');
        }

        const payerName = normalizeName(input.payerName ?? input.pagador_nombre, 'nombre del pagador');
        const type = normalizePreinvoiceType(input.type ?? input.tipo);
        const observation = normalizeOptionalText(input.observation ?? input.observacion);
        const normalizedAssignments = this.accountService.normalizeQuantityAssignments(input.assignments ?? input.items);
        const idempotencyKey = input.idempotencyKey
            ? normalizeIdempotencyKey(input.idempotencyKey)
            : null;
        const requestFingerprint = this.buildRequestFingerprint({
            accountId,
            payerName,
            type,
            assignments: normalizedAssignments,
            issuedByUserId
        });
        const now = input.now || new Date().toISOString();

        return this.transactions.immediate(async tx => {
            if (idempotencyKey) {
                const existing = await tx.get(`
                    SELECT id, solicitud_fingerprint
                    FROM prefacturas
                    WHERE clave_idempotencia = ?
                `, [idempotencyKey]);
                if (existing) {
                    if (existing.solicitud_fingerprint !== requestFingerprint) {
                        throw new IdempotencyConflictError(
                            'La clave de idempotencia ya pertenece a otra prefactura',
                            { idempotencyKey }
                        );
                    }
                    const replay = await this.getPreinvoice(existing.id, tx);
                    return { ...replay, idempotency_replay: true };
                }
            }

            const { account, responsibilities } = await this.getAccountDocumentContext(accountId, tx);
            if (type === PREINVOICE_TYPES.FULL) {
                await this.assertCompleteAssignments(accountId, normalizedAssignments, tx);
            }

            const issuer = await tx.get(`
                SELECT id, nombre, activo
                FROM usuarios
                WHERE id = ?
            `, [issuedByUserId]);
            if (!issuer || Number(issuer.activo ?? 1) !== 1) {
                throw new NotFoundError('Usuario emisor activo no encontrado', { issuedByUserId });
            }

            const reservedLines = await this.accountService.assignAvailableQuantitiesInTransaction(
                accountId,
                normalizedAssignments,
                tx,
                { normalized: true, now }
            );
            const itemSnapshots = reservedLines.map(line =>
                this.calculateLineSnapshot(line, line.cantidad_reservada)
            );

            const totals = itemSnapshots.reduce((acc, item) => ({
                subtotal: addMoney(acc.subtotal, item.subtotal),
                service: addMoney(acc.service, item.servicio_total),
                total: addMoney(acc.total, item.total_linea)
            }), { subtotal: 0, service: 0, total: 0 });

            if (totals.total <= 0) {
                throw new InvariantError('La prefactura debe tener un total positivo', {
                    code: 'PREINVOICE_TOTAL_INVALID'
                });
            }

            const sequence = await this.sequenceService.nextInTransaction(
                DOCUMENT_SEQUENCE_TYPES.PREINVOICE,
                tx,
                { now }
            );
            const ordinalRow = await tx.get(`
                SELECT COALESCE(MAX(ordinal_cuenta), 0) + 1 AS siguiente
                FROM prefacturas
                WHERE pedido_id = ?
            `, [accountId]);
            const ordinal = Number(ordinalRow?.siguiente || 1);

            const inserted = await tx.run(`
                INSERT INTO prefacturas (
                    pedido_id, numero_documento, numero_secuencia, ordinal_cuenta,
                    tipo, pagador_nombre, estado, estado_impresion,
                    subtotal, servicio, total, total_pagado, saldo_pendiente,
                    numero_cuenta_snapshot, mesa_id_snapshot, mesa_numero_snapshot,
                    mesa_tipo_snapshot, zona_id_snapshot, zona_nombre_snapshot,
                    cliente_principal_snapshot, responsables_snapshot,
                    emitida_por_usuario_id, emitida_por_nombre_snapshot,
                    clave_idempotencia, solicitud_fingerprint, observacion,
                    fecha_emision, version, creado_en, actualizado_en
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?,
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
                )
            `, [
                accountId,
                sequence.documentNumber,
                sequence.sequence,
                ordinal,
                type,
                payerName,
                PREINVOICE_STATES.ISSUED,
                PREINVOICE_PRINT_STATES.PENDING,
                totals.subtotal,
                totals.service,
                totals.total,
                totals.total,
                account.numero_cuenta,
                account.mesa_id,
                account.mesa_numero_documento,
                account.mesa_tipo_documento,
                account.zona_id_documento,
                account.zona_nombre_documento,
                account.cliente_principal_documento,
                JSON.stringify(responsibilities),
                issuer.id,
                issuer.nombre,
                idempotencyKey,
                requestFingerprint,
                observation,
                now,
                now,
                now
            ]);

            for (const item of itemSnapshots) {
                await tx.run(`
                    INSERT INTO prefactura_items (
                        prefactura_id, pedido_producto_id, producto_id, presentacion_id,
                        cantidad, producto_nombre_snapshot, presentacion_nombre_snapshot,
                        presentacion_cantidad_snapshot, precio_unitario, subtotal,
                        aplica_servicio, porcentaje_servicio, servicio_unitario,
                        servicio_total, total_linea, creado_en
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    inserted.id,
                    item.pedido_producto_id,
                    item.producto_id,
                    item.presentacion_id,
                    item.cantidad,
                    item.producto_nombre_snapshot,
                    item.presentacion_nombre_snapshot,
                    item.presentacion_cantidad_snapshot,
                    item.precio_unitario,
                    item.subtotal,
                    item.aplica_servicio,
                    item.porcentaje_servicio,
                    item.servicio_unitario,
                    item.servicio_total,
                    item.total_linea,
                    now
                ]);
            }

            await tx.run(`
                INSERT INTO historial_prefacturas (
                    prefactura_id, evento, estado_anterior, estado_nuevo,
                    usuario_id, usuario_nombre_snapshot, detalle, fecha
                ) VALUES (?, 'emitida', NULL, ?, ?, ?, ?, ?)
            `, [
                inserted.id,
                PREINVOICE_STATES.ISSUED,
                issuer.id,
                issuer.nombre,
                JSON.stringify({
                    numero_documento: sequence.documentNumber,
                    ordinal_cuenta: ordinal,
                    total: totals.total,
                    items: itemSnapshots.length
                }),
                now
            ]);

            const financialState = Number(account.total_pagado || 0) > 0
                ? ACCOUNT_FINANCIAL_STATES.PARTIAL
                : ACCOUNT_FINANCIAL_STATES.PENDING;
            await tx.run(`
                UPDATE pedidos
                SET estado_financiero = ?,
                    actualizado_en = ?,
                    version = COALESCE(version, 1) + 1
                WHERE id = ?
            `, [financialState, now, accountId]);

            const seatType = String(account.mesa_tipo_documento || '').toLowerCase() === 'banco'
                ? 'banco'
                : 'mesa';
            await tx.run(`
                INSERT INTO historial_transacciones (
                    tipo_accion, usuario_id, descripcion, fecha
                ) VALUES (?, ?, ?, ?)
            `, [
                'emitir_prefactura',
                issuer.id,
                `Prefactura ${sequence.documentNumber} emitida para ${payerName} en ${seatType} ${account.mesa_numero_documento}; cuenta ${account.numero_cuenta}; total ${totals.total}`,
                now
            ]);

            return this.getPreinvoice(inserted.id, tx);
        });
    }

    async getPreinvoice(preinvoiceId, client = this.db) {
        const id = Number(preinvoiceId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de prefactura inválido', { preinvoiceId });
        }

        const row = await client.get(`
            SELECT *
            FROM prefacturas
            WHERE id = ?
        `, [id]);
        if (!row) throw new NotFoundError('Prefactura no encontrada', { preinvoiceId: id });

        const items = await client.all(`
            SELECT *
            FROM prefactura_items
            WHERE prefactura_id = ?
            ORDER BY id
        `, [id]);
        const history = await client.all(`
            SELECT *
            FROM historial_prefacturas
            WHERE prefactura_id = ?
            ORDER BY id
        `, [id]);

        let responsibilities = [];
        try {
            responsibilities = JSON.parse(row.responsables_snapshot || '[]');
        } catch (_) {
            responsibilities = [];
        }

        return {
            ...row,
            responsables: responsibilities,
            items,
            historial: history
        };
    }

    async listByAccount(accountId, client = this.db) {
        const id = Number(accountId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de cuenta inválido', { accountId });
        }
        return client.all(`
            SELECT
                pf.*,
                COUNT(pfi.id) AS cantidad_lineas,
                COALESCE(SUM(pfi.cantidad), 0) AS cantidad_unidades
            FROM prefacturas pf
            LEFT JOIN prefactura_items pfi ON pfi.prefactura_id = pf.id
            WHERE pf.pedido_id = ?
            GROUP BY pf.id
            ORDER BY pf.ordinal_cuenta, pf.id
        `, [id]);
    }

    async synchronizeAccountDocumentState(accountId, client, now) {
        const account = await client.get(`
            SELECT
                p.*,
                COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.pedido_id = p.id), 0) AS pagado_calculado,
                COALESCE((SELECT COUNT(*) FROM prefacturas pf
                          WHERE pf.pedido_id = p.id AND pf.estado <> 'anulada'), 0) AS documentos_activos
            FROM pedidos p
            WHERE p.id = ?
        `, [accountId]);
        if (!account) throw new NotFoundError('Cuenta no encontrada', { accountId });

        const paid = roundMoney(Number(account.pagado_calculado || 0));
        const total = roundMoney(Number(account.total_con_servicio ?? account.total ?? 0));
        let state = ACCOUNT_FINANCIAL_STATES.NO_DOCUMENTS;
        if (account.estado === 'credito') {
            state = ACCOUNT_FINANCIAL_STATES.CREDIT;
        } else if (total > 0 && paid >= total) {
            state = ACCOUNT_FINANCIAL_STATES.RECONCILED;
        } else if (paid > 0) {
            state = ACCOUNT_FINANCIAL_STATES.PARTIAL;
        } else if (Number(account.documentos_activos || 0) > 0) {
            state = ACCOUNT_FINANCIAL_STATES.PENDING;
        }

        await client.run(`
            UPDATE pedidos
            SET estado_financiero = ?,
                actualizado_en = ?,
                version = COALESCE(version, 1) + 1
            WHERE id = ?
        `, [state, now, accountId]);
        return state;
    }

    async annulPreinvoice(input = {}) {
        const preinvoiceId = Number(input.preinvoiceId ?? input.id);
        const userId = Number(input.userId ?? input.usuario_id);
        const reason = normalizeName(input.reason ?? input.motivo, 'motivo de anulación', 300);
        const now = input.now || new Date().toISOString();

        if (!Number.isSafeInteger(preinvoiceId) || preinvoiceId <= 0) {
            throw new ValidationError('La prefactura es requerida');
        }
        if (!Number.isSafeInteger(userId) || userId <= 0) {
            throw new ValidationError('El usuario que anula es requerido');
        }

        return this.transactions.immediate(async tx => {
            const document = await tx.get('SELECT * FROM prefacturas WHERE id = ?', [preinvoiceId]);
            if (!document) throw new NotFoundError('Prefactura no encontrada', { preinvoiceId });
            if (document.estado === PREINVOICE_STATES.VOIDED) {
                return this.getPreinvoice(preinvoiceId, tx);
            }
            if (Number(document.total_pagado || 0) > 0 || document.estado !== PREINVOICE_STATES.ISSUED) {
                throw new ConflictError('No se puede anular una prefactura con pagos o estado avanzado', {
                    code: 'PREINVOICE_VOID_NOT_ALLOWED',
                    estado: document.estado,
                    total_pagado: document.total_pagado
                });
            }

            const user = await tx.get('SELECT id, nombre, activo FROM usuarios WHERE id = ?', [userId]);
            if (!user || Number(user.activo ?? 1) !== 1) {
                throw new NotFoundError('Usuario activo no encontrado', { userId });
            }

            const items = await tx.all(`
                SELECT pedido_producto_id, cantidad
                FROM prefactura_items
                WHERE prefactura_id = ?
                ORDER BY id
            `, [preinvoiceId]);
            if (items.length === 0) {
                throw new InvariantError('La prefactura no contiene líneas para liberar', {
                    code: 'PREINVOICE_WITHOUT_ITEMS',
                    preinvoiceId
                });
            }

            await this.accountService.releaseAssignedQuantitiesInTransaction(
                document.pedido_id,
                items,
                tx,
                { normalized: true, now }
            );

            await tx.run(`
                UPDATE prefacturas
                SET estado = ?,
                    saldo_pendiente = 0,
                    fecha_anulacion = ?,
                    anulada_por_usuario_id = ?,
                    anulada_por_nombre_snapshot = ?,
                    motivo_anulacion = ?,
                    actualizado_en = ?,
                    version = COALESCE(version, 1) + 1
                WHERE id = ?
            `, [
                PREINVOICE_STATES.VOIDED,
                now,
                user.id,
                user.nombre,
                reason,
                now,
                preinvoiceId
            ]);

            await tx.run(`
                INSERT INTO historial_prefacturas (
                    prefactura_id, evento, estado_anterior, estado_nuevo,
                    usuario_id, usuario_nombre_snapshot, detalle, fecha
                ) VALUES (?, 'anulada', ?, ?, ?, ?, ?, ?)
            `, [
                preinvoiceId,
                document.estado,
                PREINVOICE_STATES.VOIDED,
                user.id,
                user.nombre,
                JSON.stringify({ motivo: reason }),
                now
            ]);

            await this.synchronizeAccountDocumentState(document.pedido_id, tx, now);
            return this.getPreinvoice(preinvoiceId, tx);
        });
    }
}

const preinvoiceService = new PreinvoiceService();

module.exports = preinvoiceService;
module.exports.PreinvoiceService = PreinvoiceService;
module.exports.PREINVOICE_TYPES = PREINVOICE_TYPES;
module.exports.PREINVOICE_STATES = PREINVOICE_STATES;
module.exports.PREINVOICE_PRINT_STATES = PREINVOICE_PRINT_STATES;
