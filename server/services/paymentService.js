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
    toMinorUnits,
    fromMinorUnits,
    roundMoney
} = require('../utils/money');
const {
    normalizeIdempotencyKey,
    createRequestFingerprint
} = require('../utils/idempotency');
const { DOCUMENT_SEQUENCE_TYPES } = require('./documentSequenceService');

const PAYMENT_STATES = Object.freeze({
    PENDING: 'pendiente',
    CONFIRMED: 'confirmado',
    VOIDED: 'anulado'
});

const PAYMENT_METHODS = Object.freeze({
    CASH: 'efectivo',
    CARD: 'tarjeta',
    CREDIT: 'credito'
});

const IDEMPOTENCY_SCOPES = Object.freeze({
    CREATE: 'payment.create',
    VOID: 'payment.void'
});

function normalizePaymentMethod(value) {
    const method = String(value || '').trim().toLowerCase();
    if (![PAYMENT_METHODS.CASH, PAYMENT_METHODS.CARD].includes(method)) {
        if (method === PAYMENT_METHODS.CREDIT) {
            throw new ConflictError('El crédito se integrará a Payments en v3.2.4', {
                code: 'CREDIT_PAYMENT_NOT_AVAILABLE'
            });
        }
        throw new ValidationError('Método de pago inválido', {
            allowed: [PAYMENT_METHODS.CASH, PAYMENT_METHODS.CARD]
        });
    }
    return method;
}

function normalizeOptionalText(value, field, maxLength = 200) {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    if (!normalized) return null;
    if (normalized.length > maxLength) {
        throw new ValidationError(`${field} supera la longitud permitida`, { maxLength });
    }
    return normalized;
}

function normalizePositiveAmount(value) {
    const minor = toMinorUnits(value);
    if (minor <= 0) {
        throw new ValidationError('El monto del pago debe ser mayor que cero', { value });
    }
    return fromMinorUnits(minor);
}

class PaymentService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.transactions = options.transactions || new TransactionService(this.db);
        this.accountService = options.accountService || accountServiceSingleton;
        this.sequenceService = options.sequenceService || documentSequenceServiceSingleton;
    }

    buildCreateFingerprint(input) {
        return createRequestFingerprint({
            prefactura_id: Number(input.preinvoiceId),
            cajero_usuario_id: Number(input.cashierUserId),
            metodo_pago: input.paymentMethod,
            monto: roundMoney(input.amount),
            referencia: input.reference || null
        });
    }

    buildVoidFingerprint(input) {
        return createRequestFingerprint({
            pago_id: Number(input.paymentId),
            usuario_id: Number(input.userId),
            motivo: input.reason
        });
    }

    async findIdempotency(scope, key, fingerprint, client) {
        const row = await client.get(`
            SELECT *
            FROM claves_idempotencia
            WHERE ambito = ? AND clave = ?
        `, [scope, key]);
        if (!row) return null;
        if (row.fingerprint !== fingerprint) {
            throw new IdempotencyConflictError('La clave de idempotencia ya fue usada con otro pago', {
                scope,
                key,
                recurso_tipo: row.recurso_tipo,
                recurso_id: row.recurso_id
            });
        }
        return row;
    }

    async saveIdempotency(scope, key, fingerprint, resourceType, resourceId, client, now) {
        await client.run(`
            INSERT INTO claves_idempotencia (
                ambito, clave, fingerprint, recurso_tipo, recurso_id, creado_en
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [scope, key, fingerprint, resourceType, resourceId, now]);
    }

    allocateComponents(document, aggregate, amount) {
        const totalMinor = toMinorUnits(document.total || 0);
        const subtotalMinor = toMinorUnits(document.subtotal || 0);
        const serviceMinor = toMinorUnits(document.servicio || 0);
        const paidSubtotalMinor = toMinorUnits(aggregate.subtotal_pagado || 0);
        const paidServiceMinor = toMinorUnits(aggregate.servicio_pagado || 0);
        const remainingSubtotal = Math.max(0, subtotalMinor - paidSubtotalMinor);
        const remainingService = Math.max(0, serviceMinor - paidServiceMinor);
        const remainingTotal = remainingSubtotal + remainingService;
        const amountMinor = toMinorUnits(amount);

        if (remainingTotal !== Math.max(0, totalMinor - toMinorUnits(aggregate.total_pagado || 0))) {
            throw new InvariantError('Los componentes pagados no coinciden con el saldo de la prefactura', {
                code: 'PAYMENT_COMPONENTS_OUT_OF_BALANCE',
                prefactura_id: document.id
            });
        }

        if (amountMinor === remainingTotal) {
            return {
                subtotal: fromMinorUnits(remainingSubtotal),
                servicio: fromMinorUnits(remainingService)
            };
        }

        const subtotalPart = remainingTotal > 0
            ? Math.min(remainingSubtotal, Math.round((amountMinor * remainingSubtotal) / remainingTotal))
            : 0;
        const servicePart = amountMinor - subtotalPart;
        if (servicePart > remainingService) {
            const adjustedService = remainingService;
            return {
                subtotal: fromMinorUnits(amountMinor - adjustedService),
                servicio: fromMinorUnits(adjustedService)
            };
        }
        return {
            subtotal: fromMinorUnits(subtotalPart),
            servicio: fromMinorUnits(servicePart)
        };
    }

    async getConfirmedAggregate(preinvoiceId, client = this.db) {
        return client.get(`
            SELECT
                COALESCE(SUM(CASE WHEN pg.estado = 'confirmado' THEN pg.monto ELSE 0 END), 0) AS total_pagado,
                COALESCE(SUM(CASE WHEN pg.estado = 'confirmado' THEN pg.subtotal ELSE 0 END), 0) AS subtotal_pagado,
                COALESCE(SUM(CASE WHEN pg.estado = 'confirmado' THEN pg.servicio ELSE 0 END), 0) AS servicio_pagado,
                COUNT(CASE WHEN pg.estado = 'confirmado' THEN 1 END) AS cantidad_pagos
            FROM pagos pg
            WHERE pg.prefactura_id = ?
        `, [preinvoiceId]);
    }

    async synchronizePreinvoice(preinvoiceId, client, now) {
        const document = await client.get('SELECT * FROM prefacturas WHERE id = ?', [preinvoiceId]);
        if (!document) throw new NotFoundError('Prefactura no encontrada', { preinvoiceId });

        const aggregate = await this.getConfirmedAggregate(preinvoiceId, client);
        const totalMinor = toMinorUnits(document.total || 0);
        const paidMinor = toMinorUnits(aggregate.total_pagado || 0);
        if (paidMinor > totalMinor) {
            throw new InvariantError('Los pagos confirmados superan el total de la prefactura', {
                code: 'PREINVOICE_OVERPAID',
                prefactura_id: preinvoiceId,
                total: document.total,
                total_pagado: aggregate.total_pagado
            });
        }

        const balanceMinor = totalMinor - paidMinor;
        const state = paidMinor <= 0
            ? 'emitida'
            : (balanceMinor <= 0 ? 'pagada' : 'parcial');
        const paymentDate = state === 'pagada' ? (document.fecha_pago || now) : null;

        await client.run(`
            UPDATE prefacturas
            SET estado = ?,
                total_pagado = ?,
                saldo_pendiente = ?,
                fecha_pago = ?,
                actualizado_en = ?,
                version = COALESCE(version, 1) + 1
            WHERE id = ?
        `, [
            state,
            fromMinorUnits(paidMinor),
            fromMinorUnits(balanceMinor),
            paymentDate,
            now,
            preinvoiceId
        ]);

        return {
            estado: state,
            total_pagado: fromMinorUnits(paidMinor),
            saldo_pendiente: fromMinorUnits(balanceMinor),
            fecha_pago: paymentDate,
            cantidad_pagos: Number(aggregate.cantidad_pagos || 0)
        };
    }

    async buildResult(paymentId, client = this.db, options = {}) {
        const payment = await this.getPayment(paymentId, client);
        const account = await client.get(`
            SELECT
                id, numero_cuenta, estado_operativo, estado_financiero,
                total_pagado, saldo_pendiente, fecha_conciliacion
            FROM pedidos
            WHERE id = ?
        `, [payment.pedido_id]);
        const preinvoice = await client.get(`
            SELECT
                id, numero_documento, pagador_nombre, estado,
                total, total_pagado, saldo_pendiente, fecha_pago
            FROM prefacturas
            WHERE id = ?
        `, [payment.prefactura_id]);

        return {
            pago: payment,
            prefactura: preinvoice,
            cuenta_global: account,
            servicio_activo: account?.estado_operativo === 'abierta',
            mesa_liberada: false,
            idempotency_replay: options.idempotencyReplay === true
        };
    }

    async recordPreinvoicePayment(input = {}) {
        const preinvoiceId = Number(input.preinvoiceId ?? input.prefactura_id);
        const cashierUserId = Number(input.cashierUserId ?? input.cajero_usuario_id ?? input.userId);
        const amount = normalizePositiveAmount(input.amount ?? input.monto);
        const paymentMethod = normalizePaymentMethod(input.paymentMethod ?? input.metodo_pago);
        const reference = normalizeOptionalText(input.reference ?? input.referencia, 'La referencia', 180);
        const idempotencyKey = normalizeIdempotencyKey(
            input.idempotencyKey ?? input.clave_idempotencia
        );
        const now = input.now || new Date().toISOString();

        if (!Number.isSafeInteger(preinvoiceId) || preinvoiceId <= 0) {
            throw new ValidationError('La prefactura es requerida');
        }
        if (!Number.isSafeInteger(cashierUserId) || cashierUserId <= 0) {
            throw new ValidationError('El cajero es requerido');
        }

        const fingerprint = this.buildCreateFingerprint({
            preinvoiceId,
            cashierUserId,
            amount,
            paymentMethod,
            reference
        });

        return this.transactions.immediate(async tx => {
            const existingKey = await this.findIdempotency(
                IDEMPOTENCY_SCOPES.CREATE,
                idempotencyKey,
                fingerprint,
                tx
            );
            if (existingKey) {
                return this.buildResult(existingKey.recurso_id, tx, { idempotencyReplay: true });
            }

            const document = await tx.get(`
                SELECT
                    pf.*,
                    p.estado_operativo,
                    p.numero_cuenta,
                    p.mesa_id
                FROM prefacturas pf
                JOIN pedidos p ON p.id = pf.pedido_id
                WHERE pf.id = ?
            `, [preinvoiceId]);
            if (!document) throw new NotFoundError('Prefactura no encontrada', { preinvoiceId });
            if (document.estado === 'anulada') {
                throw new ConflictError('Una prefactura anulada no puede recibir pagos', {
                    code: 'PREINVOICE_VOIDED',
                    preinvoiceId
                });
            }
            if (!['abierta', 'finalizando'].includes(document.estado_operativo)) {
                throw new ConflictError('La cuenta global ya no admite cobros', {
                    code: 'ACCOUNT_NOT_PAYABLE',
                    estado_operativo: document.estado_operativo
                });
            }

            const cashier = await tx.get(`
                SELECT id, nombre, activo
                FROM usuarios
                WHERE id = ?
            `, [cashierUserId]);
            if (!cashier || Number(cashier.activo ?? 1) !== 1) {
                throw new NotFoundError('Cajero activo no encontrado', { cashierUserId });
            }

            const aggregate = await this.getConfirmedAggregate(preinvoiceId, tx);
            const totalMinor = toMinorUnits(document.total || 0);
            const paidMinor = toMinorUnits(aggregate.total_pagado || 0);
            const balanceMinor = Math.max(0, totalMinor - paidMinor);
            const amountMinor = toMinorUnits(amount);
            if (balanceMinor <= 0) {
                throw new ConflictError('La prefactura ya está pagada', {
                    code: 'PREINVOICE_ALREADY_PAID',
                    preinvoiceId
                });
            }
            if (amountMinor > balanceMinor) {
                throw new ConflictError('El monto supera el saldo pendiente de la prefactura', {
                    code: 'PAYMENT_EXCEEDS_PREINVOICE_BALANCE',
                    saldo_pendiente: fromMinorUnits(balanceMinor),
                    monto: amount
                });
            }

            const components = this.allocateComponents(document, aggregate, amount);
            const sequence = await this.sequenceService.nextInTransaction(
                DOCUMENT_SEQUENCE_TYPES.PAYMENT,
                tx,
                { now }
            );
            const inserted = await tx.run(`
                INSERT INTO pagos (
                    pedido_id, prefactura_id, numero_pago, numero_secuencia,
                    estado, metodo_pago, monto, subtotal, servicio,
                    porcentaje_servicio, aplica_servicio, referencia,
                    cajero_usuario_id, cajero_nombre_snapshot,
                    pagador_nombre_snapshot, fecha, version,
                    creado_en, actualizado_en
                ) VALUES (?, ?, ?, ?, 'confirmado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `, [
                document.pedido_id,
                preinvoiceId,
                sequence.documentNumber,
                sequence.sequence,
                paymentMethod,
                amount,
                components.subtotal,
                components.servicio,
                document.servicio > 0 && document.subtotal > 0
                    ? roundMoney((Number(document.servicio) / Number(document.subtotal)) * 100)
                    : 0,
                Number(document.servicio || 0) > 0 ? 1 : 0,
                reference,
                cashier.id,
                cashier.nombre,
                document.pagador_nombre,
                now,
                now,
                now
            ]);

            await tx.run(`
                INSERT INTO pago_componentes (pago_id, tipo, monto, creado_en)
                VALUES (?, 'subtotal', ?, ?), (?, 'servicio', ?, ?)
            `, [inserted.id, components.subtotal, now, inserted.id, components.servicio, now]);

            const previousState = document.estado;
            const synchronizedDocument = await this.synchronizePreinvoice(preinvoiceId, tx, now);
            await tx.run(`
                INSERT INTO historial_prefacturas (
                    prefactura_id, evento, estado_anterior, estado_nuevo,
                    usuario_id, usuario_nombre_snapshot, detalle, fecha
                ) VALUES (?, 'pago_registrado', ?, ?, ?, ?, ?, ?)
            `, [
                preinvoiceId,
                previousState,
                synchronizedDocument.estado,
                cashier.id,
                cashier.nombre,
                JSON.stringify({
                    pago_id: inserted.id,
                    numero_pago: sequence.documentNumber,
                    monto: amount,
                    metodo_pago: paymentMethod,
                    referencia: reference,
                    saldo_pendiente: synchronizedDocument.saldo_pendiente
                }),
                now
            ]);

            const synchronizedAccount = await this.accountService.synchronizeAccount(
                document.pedido_id,
                tx,
                { now }
            );
            await tx.run(`
                INSERT INTO historial_transacciones (
                    tipo_accion, usuario_id, descripcion, fecha
                ) VALUES ('pago_prefactura', ?, ?, ?)
            `, [
                cashier.id,
                `Pago ${sequence.documentNumber} aplicado a ${document.numero_documento}; cuenta ${document.numero_cuenta}; monto ${amount}; saldo documento ${synchronizedDocument.saldo_pendiente}; servicio permanece ${synchronizedAccount.estado_operativo}`,
                now
            ]);

            await this.saveIdempotency(
                IDEMPOTENCY_SCOPES.CREATE,
                idempotencyKey,
                fingerprint,
                'pago',
                inserted.id,
                tx,
                now
            );

            return this.buildResult(inserted.id, tx);
        });
    }

    async voidPayment(input = {}) {
        const paymentId = Number(input.paymentId ?? input.pago_id ?? input.id);
        const userId = Number(input.userId ?? input.usuario_id ?? input.anulado_por_usuario_id);
        const reason = normalizeOptionalText(input.reason ?? input.motivo, 'El motivo', 300);
        const idempotencyKey = normalizeIdempotencyKey(
            input.idempotencyKey ?? input.clave_idempotencia
        );
        const now = input.now || new Date().toISOString();

        if (!Number.isSafeInteger(paymentId) || paymentId <= 0) {
            throw new ValidationError('El pago es requerido');
        }
        if (!Number.isSafeInteger(userId) || userId <= 0) {
            throw new ValidationError('El usuario que anula es requerido');
        }
        if (!reason) throw new ValidationError('El motivo de anulación es requerido');

        const fingerprint = this.buildVoidFingerprint({ paymentId, userId, reason });

        return this.transactions.immediate(async tx => {
            const existingKey = await this.findIdempotency(
                IDEMPOTENCY_SCOPES.VOID,
                idempotencyKey,
                fingerprint,
                tx
            );
            if (existingKey) {
                return this.buildResult(existingKey.recurso_id, tx, { idempotencyReplay: true });
            }

            const payment = await tx.get(`
                SELECT pg.*, pf.estado AS prefactura_estado, pf.numero_documento
                FROM pagos pg
                LEFT JOIN prefacturas pf ON pf.id = pg.prefactura_id
                WHERE pg.id = ?
            `, [paymentId]);
            if (!payment) throw new NotFoundError('Pago no encontrado', { paymentId });
            if (!payment.prefactura_id) {
                throw new ConflictError('Los pagos legacy sin prefactura se revertirán durante su migración específica', {
                    code: 'LEGACY_PAYMENT_VOID_NOT_SUPPORTED'
                });
            }
            if (payment.estado === PAYMENT_STATES.VOIDED) {
                throw new ConflictError('El pago ya fue anulado con otra solicitud', {
                    code: 'PAYMENT_ALREADY_VOIDED',
                    paymentId
                });
            }
            if (payment.estado !== PAYMENT_STATES.CONFIRMED) {
                throw new ConflictError('Solo un pago confirmado puede anularse', {
                    code: 'PAYMENT_VOID_NOT_ALLOWED',
                    estado: payment.estado
                });
            }

            const user = await tx.get('SELECT id, nombre, activo FROM usuarios WHERE id = ?', [userId]);
            if (!user || Number(user.activo ?? 1) !== 1) {
                throw new NotFoundError('Usuario activo no encontrado', { userId });
            }

            const previousDocument = await tx.get('SELECT * FROM prefacturas WHERE id = ?', [payment.prefactura_id]);
            await tx.run(`
                UPDATE pagos
                SET estado = 'anulado',
                    fecha_anulacion = ?,
                    anulado_por_usuario_id = ?,
                    anulado_por_nombre_snapshot = ?,
                    motivo_anulacion = ?,
                    actualizado_en = ?,
                    version = COALESCE(version, 1) + 1
                WHERE id = ? AND estado = 'confirmado'
            `, [now, user.id, user.nombre, reason, now, paymentId]);

            const reversal = await tx.run(`
                INSERT INTO reversos_pago (
                    pago_id, monto_revertido, usuario_id,
                    usuario_nombre_snapshot, motivo, fecha,
                    clave_idempotencia, solicitud_fingerprint
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                paymentId,
                payment.monto,
                user.id,
                user.nombre,
                reason,
                now,
                idempotencyKey,
                fingerprint
            ]);

            const synchronizedDocument = await this.synchronizePreinvoice(payment.prefactura_id, tx, now);
            await tx.run(`
                INSERT INTO historial_prefacturas (
                    prefactura_id, evento, estado_anterior, estado_nuevo,
                    usuario_id, usuario_nombre_snapshot, detalle, fecha
                ) VALUES (?, 'pago_anulado', ?, ?, ?, ?, ?, ?)
            `, [
                payment.prefactura_id,
                previousDocument.estado,
                synchronizedDocument.estado,
                user.id,
                user.nombre,
                JSON.stringify({
                    pago_id: paymentId,
                    numero_pago: payment.numero_pago,
                    reverso_id: reversal.id,
                    monto: payment.monto,
                    motivo: reason,
                    saldo_pendiente: synchronizedDocument.saldo_pendiente
                }),
                now
            ]);

            const synchronizedAccount = await this.accountService.synchronizeAccount(
                payment.pedido_id,
                tx,
                { now }
            );
            await tx.run(`
                INSERT INTO historial_transacciones (
                    tipo_accion, usuario_id, descripcion, fecha
                ) VALUES ('anular_pago_prefactura', ?, ?, ?)
            `, [
                user.id,
                `Pago ${payment.numero_pago || payment.id} anulado en ${payment.numero_documento}; monto ${payment.monto}; saldo restaurado ${synchronizedDocument.saldo_pendiente}; cuenta ${synchronizedAccount.numero_cuenta}`,
                now
            ]);

            await this.saveIdempotency(
                IDEMPOTENCY_SCOPES.VOID,
                idempotencyKey,
                fingerprint,
                'pago',
                paymentId,
                tx,
                now
            );

            return this.buildResult(paymentId, tx);
        });
    }

    async getPayment(paymentId, client = this.db) {
        const id = Number(paymentId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de pago inválido', { paymentId });
        }
        const row = await client.get(`
            SELECT
                pg.*,
                pf.numero_documento,
                pf.pagador_nombre,
                p.numero_cuenta
            FROM pagos pg
            JOIN pedidos p ON p.id = pg.pedido_id
            LEFT JOIN prefacturas pf ON pf.id = pg.prefactura_id
            WHERE pg.id = ?
        `, [id]);
        if (!row) throw new NotFoundError('Pago no encontrado', { paymentId: id });

        const components = await client.all(`
            SELECT tipo, monto
            FROM pago_componentes
            WHERE pago_id = ?
            ORDER BY tipo
        `, [id]);
        const reversal = await client.get(`
            SELECT *
            FROM reversos_pago
            WHERE pago_id = ?
        `, [id]);
        return {
            ...row,
            componentes: components,
            reverso: reversal || null
        };
    }

    async listByPreinvoice(preinvoiceId, client = this.db) {
        const id = Number(preinvoiceId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de prefactura inválido', { preinvoiceId });
        }
        const rows = await client.all(`
            SELECT id
            FROM pagos
            WHERE prefactura_id = ?
            ORDER BY fecha, id
        `, [id]);
        return Promise.all(rows.map(row => this.getPayment(row.id, client)));
    }

    async listByAccount(accountId, client = this.db) {
        const id = Number(accountId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de cuenta inválido', { accountId });
        }
        const rows = await client.all(`
            SELECT id
            FROM pagos
            WHERE pedido_id = ?
            ORDER BY fecha, id
        `, [id]);
        return Promise.all(rows.map(row => this.getPayment(row.id, client)));
    }
}

const paymentService = new PaymentService();

module.exports = paymentService;
module.exports.PaymentService = PaymentService;
module.exports.PAYMENT_STATES = PAYMENT_STATES;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
module.exports.IDEMPOTENCY_SCOPES = IDEMPOTENCY_SCOPES;
module.exports.normalizePaymentMethod = normalizePaymentMethod;
