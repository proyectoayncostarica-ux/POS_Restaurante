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

const PAYMENT_NATURES = Object.freeze({
    SALE_SETTLEMENT: 'liquidacion_venta',
    CREDIT_COLLECTION: 'cobro_credito'
});

const IDEMPOTENCY_SCOPES = Object.freeze({
    CREATE: 'payment.create',
    CREDIT_CREATE: 'credit.payment.create',
    VOID: 'payment.void'
});

function normalizePaymentMethod(value) {
    const method = String(value || '').trim().toLowerCase();
    if (![PAYMENT_METHODS.CASH, PAYMENT_METHODS.CARD].includes(method)) {
        if (method === PAYMENT_METHODS.CREDIT) {
            throw new ConflictError('El crédito se formaliza mediante el flujo autorizado de crédito', {
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

function normalizeTenderType(value) {
    return normalizePaymentMethod(value);
}

function normalizePaymentTenders(input = {}) {
    const rawTenders = input.paymentTenders ?? input.medios_pago;
    let tenderInputs;

    if (Array.isArray(rawTenders) && rawTenders.length > 0) {
        tenderInputs = rawTenders;
    } else {
        tenderInputs = [{
            tipo: input.paymentMethod ?? input.metodo_pago,
            monto_aplicado: input.amount ?? input.monto,
            monto_recibido: input.cashReceived ?? input.monto_recibido,
            referencia: input.reference ?? input.referencia
        }];
    }

    if (tenderInputs.length > 2) {
        throw new ValidationError('Un pago admite como máximo un componente de efectivo y uno de tarjeta', {
            code: 'PAYMENT_TENDERS_LIMIT_EXCEEDED'
        });
    }

    const seen = new Set();
    const tenders = tenderInputs.map((tender, index) => {
        const type = normalizeTenderType(tender.tipo ?? tender.type ?? tender.metodo_pago);
        if (seen.has(type)) {
            throw new ValidationError('No se puede repetir el mismo medio de pago', {
                code: 'PAYMENT_TENDER_DUPLICATED',
                tipo: type
            });
        }
        seen.add(type);

        const applied = normalizePositiveAmount(
            tender.monto_aplicado ?? tender.appliedAmount ?? tender.monto ?? tender.amount
        );

        if (type === PAYMENT_METHODS.CARD) {
            const reference = normalizeOptionalText(
                tender.referencia ?? tender.reference,
                'La referencia de tarjeta',
                180
            );
            if (!reference) {
                throw new ValidationError('La referencia o autorización de tarjeta es obligatoria', {
                    code: 'CARD_REFERENCE_REQUIRED'
                });
            }
            return {
                ordinal: index + 1,
                tipo: type,
                monto_aplicado: applied,
                monto_recibido: applied,
                vuelto: 0,
                referencia: reference
            };
        }

        const received = normalizePositiveAmount(
            tender.monto_recibido
                ?? tender.receivedAmount
                ?? tender.efectivo_recibido
                ?? applied
        );
        const appliedMinor = toMinorUnits(applied);
        const receivedMinor = toMinorUnits(received);
        if (receivedMinor < appliedMinor) {
            throw new ValidationError('El efectivo recibido no puede ser menor que el monto aplicado', {
                code: 'CASH_RECEIVED_INSUFFICIENT',
                monto_aplicado: applied,
                monto_recibido: received
            });
        }

        return {
            ordinal: index + 1,
            tipo: type,
            monto_aplicado: applied,
            monto_recibido: received,
            vuelto: fromMinorUnits(receivedMinor - appliedMinor),
            referencia: null
        };
    });

    const hasCash = tenders.some(tender => tender.tipo === PAYMENT_METHODS.CASH);
    const hasCard = tenders.some(tender => tender.tipo === PAYMENT_METHODS.CARD);
    const methodSummary = hasCash && hasCard
        ? 'mixto'
        : tenders[0].tipo;
    const totalAppliedMinor = tenders.reduce(
        (total, tender) => total + toMinorUnits(tender.monto_aplicado),
        0
    );
    const totalReceivedMinor = tenders.reduce(
        (total, tender) => total + toMinorUnits(tender.monto_recibido),
        0
    );
    const totalChangeMinor = tenders.reduce(
        (total, tender) => total + toMinorUnits(tender.vuelto),
        0
    );

    if (input.amount !== undefined || input.monto !== undefined) {
        const declared = normalizePositiveAmount(input.amount ?? input.monto);
        if (toMinorUnits(declared) !== totalAppliedMinor) {
            throw new ValidationError('El monto declarado no coincide con los medios de pago', {
                code: 'PAYMENT_TENDERS_TOTAL_MISMATCH',
                monto_declarado: declared,
                total_medios: fromMinorUnits(totalAppliedMinor)
            });
        }
    }

    return {
        metodo_pago: methodSummary,
        metodo_pago_legacy: methodSummary === PAYMENT_METHODS.CARD
            ? PAYMENT_METHODS.CARD
            : PAYMENT_METHODS.CASH,
        monto: fromMinorUnits(totalAppliedMinor),
        monto_recibido: fromMinorUnits(totalReceivedMinor),
        vuelto: fromMinorUnits(totalChangeMinor),
        referencia: tenders
            .filter(tender => tender.tipo === PAYMENT_METHODS.CARD)
            .map(tender => tender.referencia)
            .join(' | ') || null,
        medios_pago: tenders
    };
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
            metodo_pago: input.payment.metodo_pago,
            monto: roundMoney(input.payment.monto),
            monto_recibido: roundMoney(input.payment.monto_recibido),
            vuelto: roundMoney(input.payment.vuelto),
            medios_pago: input.payment.medios_pago.map(tender => ({
                ordinal: tender.ordinal,
                tipo: tender.tipo,
                monto_aplicado: roundMoney(tender.monto_aplicado),
                monto_recibido: roundMoney(tender.monto_recibido),
                vuelto: roundMoney(tender.vuelto),
                referencia: tender.referencia || null
            }))
        });
    }

    buildCreditCreateFingerprint(input) {
        return createRequestFingerprint({
            credito_id: Number(input.creditId),
            cajero_usuario_id: Number(input.cashierUserId),
            metodo_pago: input.payment.metodo_pago,
            monto: roundMoney(input.payment.monto),
            monto_recibido: roundMoney(input.payment.monto_recibido),
            vuelto: roundMoney(input.payment.vuelto),
            medios_pago: input.payment.medios_pago.map(tender => ({
                ordinal: tender.ordinal,
                tipo: tender.tipo,
                monto_aplicado: roundMoney(tender.monto_aplicado),
                monto_recibido: roundMoney(tender.monto_recibido),
                vuelto: roundMoney(tender.vuelto),
                referencia: tender.referencia || null
            }))
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
              AND COALESCE(pg.naturaleza, 'liquidacion_venta') = 'liquidacion_venta'
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
        const preinvoice = payment.prefactura_id
            ? await client.get(`
                SELECT
                    id, numero_documento, pagador_nombre, estado,
                    total, total_pagado, saldo_pendiente, fecha_pago
                FROM prefacturas
                WHERE id = ?
            `, [payment.prefactura_id])
            : null;
        const credit = payment.credito_id
            ? await client.get(`
                SELECT
                    id, numero_credito, estado, monto_original,
                    total_abonado, saldo_pendiente, cliente_nombre,
                    numero_cuenta_snapshot, numero_documento_snapshot,
                    fecha, fecha_ultimo_abono, fecha_saldo
                FROM cuentas_credito
                WHERE id = ?
            `, [payment.credito_id])
            : null;

        return {
            pago: payment,
            prefactura: preinvoice,
            credito: credit,
            cuenta_global: account,
            servicio_activo: account?.estado_operativo === 'abierta',
            mesa_liberada: false,
            idempotency_replay: options.idempotencyReplay === true
        };
    }


    async recordPreinvoicePayment(input = {}) {
        const preinvoiceId = Number(input.preinvoiceId ?? input.prefactura_id);
        const cashierUserId = Number(input.cashierUserId ?? input.cajero_usuario_id ?? input.userId);
        const payment = normalizePaymentTenders(input);
        const amount = payment.monto;
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
            payment
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
                    pedido_id, prefactura_id, credito_id, numero_pago, numero_secuencia,
                    naturaleza, estado, metodo_pago, metodo_pago_v3, monto, monto_recibido, vuelto,
                    subtotal, servicio, porcentaje_servicio, aplica_servicio, referencia,
                    cajero_usuario_id, cajero_nombre_snapshot,
                    pagador_nombre_snapshot, fecha, version,
                    creado_en, actualizado_en
                ) VALUES (?, ?, NULL, ?, ?, 'liquidacion_venta', 'confirmado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `, [
                document.pedido_id,
                preinvoiceId,
                sequence.documentNumber,
                sequence.sequence,
                payment.metodo_pago_legacy,
                payment.metodo_pago,
                amount,
                payment.monto_recibido,
                payment.vuelto,
                components.subtotal,
                components.servicio,
                document.servicio > 0 && document.subtotal > 0
                    ? roundMoney((Number(document.servicio) / Number(document.subtotal)) * 100)
                    : 0,
                Number(document.servicio || 0) > 0 ? 1 : 0,
                payment.referencia,
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

            for (const tender of payment.medios_pago) {
                await tx.run(`
                    INSERT INTO pago_medios (
                        pago_id, ordinal, tipo, monto_aplicado,
                        monto_recibido, vuelto, referencia, creado_en
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    inserted.id,
                    tender.ordinal,
                    tender.tipo,
                    tender.monto_aplicado,
                    tender.monto_recibido,
                    tender.vuelto,
                    tender.referencia,
                    now
                ]);
            }

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
                    metodo_pago: payment.metodo_pago,
                    monto_recibido: payment.monto_recibido,
                    vuelto: payment.vuelto,
                    medios_pago: payment.medios_pago,
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
                `Pago ${sequence.documentNumber} aplicado a ${document.numero_documento}; cuenta ${document.numero_cuenta}; modalidad ${payment.metodo_pago}; monto ${amount}; recibido ${payment.monto_recibido}; vuelto ${payment.vuelto}; saldo documento ${synchronizedDocument.saldo_pendiente}; servicio permanece ${synchronizedAccount.estado_operativo}`,
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

    async recordCreditSettlementInTransaction(input = {}, tx) {
        if (!tx?.get || !tx?.run) {
            throw new ValidationError('Se requiere una transacción para formalizar el crédito');
        }
        const preinvoiceId = Number(input.preinvoiceId ?? input.prefactura_id);
        const creditId = Number(input.creditId ?? input.credito_id);
        const cashierUserId = Number(input.cashierUserId ?? input.cajero_usuario_id ?? input.userId);
        const now = input.now || new Date().toISOString();
        if (!preinvoiceId || !creditId || !cashierUserId) {
            throw new ValidationError('Prefactura, crédito y usuario son requeridos');
        }

        const document = await tx.get(`
            SELECT pf.*, p.estado_operativo, p.numero_cuenta
            FROM prefacturas pf
            JOIN pedidos p ON p.id = pf.pedido_id
            WHERE pf.id = ?
        `, [preinvoiceId]);
        if (!document) throw new NotFoundError('Prefactura no encontrada', { preinvoiceId });
        if (document.estado === 'anulada') {
            throw new ConflictError('Una prefactura anulada no puede trasladarse a crédito', {
                code: 'PREINVOICE_VOIDED'
            });
        }
        if (!['abierta', 'finalizando'].includes(document.estado_operativo)) {
            throw new ConflictError('La cuenta global ya no admite crédito', {
                code: 'ACCOUNT_NOT_PAYABLE'
            });
        }

        const cashier = await tx.get('SELECT id, nombre, activo FROM usuarios WHERE id = ?', [cashierUserId]);
        if (!cashier || Number(cashier.activo ?? 1) !== 1) {
            throw new NotFoundError('Usuario activo no encontrado', { cashierUserId });
        }
        const aggregate = await this.getConfirmedAggregate(preinvoiceId, tx);
        const balanceMinor = Math.max(
            0,
            toMinorUnits(document.total || 0) - toMinorUnits(aggregate.total_pagado || 0)
        );
        if (balanceMinor <= 0) {
            throw new ConflictError('La prefactura ya está liquidada', {
                code: 'PREINVOICE_ALREADY_PAID'
            });
        }
        const amount = fromMinorUnits(balanceMinor);
        const components = this.allocateComponents(document, aggregate, amount);
        const sequence = await this.sequenceService.nextInTransaction(
            DOCUMENT_SEQUENCE_TYPES.PAYMENT,
            tx,
            { now }
        );
        const inserted = await tx.run(`
            INSERT INTO pagos (
                pedido_id, prefactura_id, credito_id, numero_pago, numero_secuencia,
                naturaleza, estado, metodo_pago, metodo_pago_v3,
                monto, monto_recibido, vuelto, subtotal, servicio,
                porcentaje_servicio, aplica_servicio, referencia,
                cajero_usuario_id, cajero_nombre_snapshot,
                pagador_nombre_snapshot, fecha, version, creado_en, actualizado_en
            ) VALUES (?, ?, ?, ?, ?, 'liquidacion_venta', 'confirmado',
                      'credito', 'credito', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `, [
            document.pedido_id,
            preinvoiceId,
            creditId,
            sequence.documentNumber,
            sequence.sequence,
            amount,
            amount,
            components.subtotal,
            components.servicio,
            document.servicio > 0 && document.subtotal > 0
                ? roundMoney((Number(document.servicio) / Number(document.subtotal)) * 100)
                : 0,
            Number(document.servicio || 0) > 0 ? 1 : 0,
            input.reference || input.referencia || null,
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
        await tx.run(`
            INSERT INTO pago_medios (
                pago_id, ordinal, tipo, monto_aplicado,
                monto_recibido, vuelto, referencia, creado_en
            ) VALUES (?, 1, 'credito', ?, ?, 0, ?, ?)
        `, [inserted.id, amount, amount, input.reference || input.referencia || null, now]);

        const previousState = document.estado;
        const synchronizedDocument = await this.synchronizePreinvoice(preinvoiceId, tx, now);
        await tx.run(`
            INSERT INTO historial_prefacturas (
                prefactura_id, evento, estado_anterior, estado_nuevo,
                usuario_id, usuario_nombre_snapshot, detalle, fecha
            ) VALUES (?, 'credito_formalizado', ?, ?, ?, ?, ?, ?)
        `, [
            preinvoiceId,
            previousState,
            synchronizedDocument.estado,
            cashier.id,
            cashier.nombre,
            JSON.stringify({
                credito_id: creditId,
                pago_apertura_id: inserted.id,
                numero_pago: sequence.documentNumber,
                monto: amount,
                saldo_documento: synchronizedDocument.saldo_pendiente
            }),
            now
        ]);
        return {
            paymentId: inserted.id,
            numeroPago: sequence.documentNumber,
            monto: amount,
            prefactura: synchronizedDocument
        };
    }

    async synchronizeCredit(creditId, client, now = new Date().toISOString()) {
        const credit = await client.get('SELECT * FROM cuentas_credito WHERE id = ?', [creditId]);
        if (!credit) throw new NotFoundError('Crédito no encontrado', { creditId });
        const aggregate = await client.get(`
            SELECT
                COALESCE(SUM(CASE WHEN estado = 'confirmado' AND COALESCE(naturaleza, '') = 'cobro_credito' THEN monto ELSE 0 END), 0) AS total_abonado,
                MAX(CASE WHEN estado = 'confirmado' AND COALESCE(naturaleza, '') = 'cobro_credito' THEN fecha END) AS fecha_ultimo_abono
            FROM pagos
            WHERE credito_id = ?
        `, [creditId]);
        const originalMinor = toMinorUnits(credit.monto_original || credit.monto_total || 0);
        const paidMinor = toMinorUnits(aggregate?.total_abonado || 0);
        if (paidMinor > originalMinor) {
            throw new InvariantError('Los abonos superan el monto original del crédito', {
                code: 'CREDIT_OVERPAID',
                credito_id: creditId
            });
        }
        const balanceMinor = Math.max(0, originalMinor - paidMinor);
        const state = credit.estado === 'anulado'
            ? 'anulado'
            : (balanceMinor <= 0 ? 'saldado' : (paidMinor > 0 ? 'parcial' : 'pendiente'));
        const paidDate = state === 'saldado' ? (credit.fecha_saldo || now) : null;
        await client.run(`
            UPDATE cuentas_credito
            SET total_abonado = ?,
                saldo_pendiente = ?,
                monto_total = ?,
                estado = ?,
                fecha_ultimo_abono = ?,
                fecha_saldo = ?,
                actualizado_en = ?,
                version = COALESCE(version, 1) + 1
            WHERE id = ?
        `, [
            fromMinorUnits(paidMinor),
            fromMinorUnits(balanceMinor),
            fromMinorUnits(balanceMinor),
            state,
            aggregate?.fecha_ultimo_abono || null,
            paidDate,
            now,
            creditId
        ]);
        return {
            id: creditId,
            estado: state,
            monto_original: fromMinorUnits(originalMinor),
            total_abonado: fromMinorUnits(paidMinor),
            saldo_pendiente: fromMinorUnits(balanceMinor),
            fecha_ultimo_abono: aggregate?.fecha_ultimo_abono || null,
            fecha_saldo: paidDate
        };
    }

    async recordCreditPayment(input = {}) {
        const creditId = Number(input.creditId ?? input.credito_id);
        const cashierUserId = Number(input.cashierUserId ?? input.cajero_usuario_id ?? input.userId);
        const payment = normalizePaymentTenders(input);
        const amount = payment.monto;
        const idempotencyKey = normalizeIdempotencyKey(
            input.idempotencyKey ?? input.clave_idempotencia
        );
        const now = input.now || new Date().toISOString();
        if (!Number.isSafeInteger(creditId) || creditId <= 0) {
            throw new ValidationError('El crédito es requerido');
        }
        if (!Number.isSafeInteger(cashierUserId) || cashierUserId <= 0) {
            throw new ValidationError('El cajero es requerido');
        }
        const fingerprint = this.buildCreditCreateFingerprint({ creditId, cashierUserId, payment });

        return this.transactions.immediate(async tx => {
            const existingKey = await this.findIdempotency(
                IDEMPOTENCY_SCOPES.CREDIT_CREATE,
                idempotencyKey,
                fingerprint,
                tx
            );
            if (existingKey) {
                return this.buildResult(existingKey.recurso_id, tx, { idempotencyReplay: true });
            }
            const credit = await tx.get(`
                SELECT cc.*, p.estado_operativo, p.numero_cuenta
                FROM cuentas_credito cc
                JOIN pedidos p ON p.id = cc.pedido_id
                WHERE cc.id = ?
            `, [creditId]);
            if (!credit) throw new NotFoundError('Crédito vinculado a cuenta global no encontrado', { creditId });
            if (!['pendiente', 'parcial'].includes(credit.estado)) {
                throw new ConflictError('El crédito ya no admite abonos', {
                    code: 'CREDIT_NOT_PAYABLE',
                    estado: credit.estado
                });
            }
            const balanceMinor = toMinorUnits(credit.saldo_pendiente ?? credit.monto_total ?? 0);
            const amountMinor = toMinorUnits(amount);
            if (balanceMinor <= 0) {
                throw new ConflictError('El crédito ya está saldado', { code: 'CREDIT_ALREADY_PAID' });
            }
            if (amountMinor > balanceMinor) {
                throw new ConflictError('El abono supera el saldo pendiente del crédito', {
                    code: 'PAYMENT_EXCEEDS_CREDIT_BALANCE',
                    saldo_pendiente: fromMinorUnits(balanceMinor),
                    monto: amount
                });
            }
            const cashier = await tx.get('SELECT id, nombre, activo FROM usuarios WHERE id = ?', [cashierUserId]);
            if (!cashier || Number(cashier.activo ?? 1) !== 1) {
                throw new NotFoundError('Cajero activo no encontrado', { cashierUserId });
            }
            const sequence = await this.sequenceService.nextInTransaction(
                DOCUMENT_SEQUENCE_TYPES.PAYMENT,
                tx,
                { now }
            );
            const inserted = await tx.run(`
                INSERT INTO pagos (
                    pedido_id, prefactura_id, credito_id, numero_pago, numero_secuencia,
                    naturaleza, estado, metodo_pago, metodo_pago_v3,
                    monto, monto_recibido, vuelto, subtotal, servicio,
                    porcentaje_servicio, aplica_servicio, referencia,
                    cajero_usuario_id, cajero_nombre_snapshot,
                    pagador_nombre_snapshot, fecha, version, creado_en, actualizado_en
                ) VALUES (?, NULL, ?, ?, ?, 'cobro_credito', 'confirmado',
                          ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, 1, ?, ?)
            `, [
                credit.pedido_id,
                creditId,
                sequence.documentNumber,
                sequence.sequence,
                payment.metodo_pago_legacy,
                payment.metodo_pago,
                amount,
                payment.monto_recibido,
                payment.vuelto,
                amount,
                payment.referencia,
                cashier.id,
                cashier.nombre,
                credit.pagador_nombre_snapshot || credit.cliente_nombre,
                now,
                now,
                now
            ]);
            await tx.run(`
                INSERT INTO pago_componentes (pago_id, tipo, monto, creado_en)
                VALUES (?, 'subtotal', ?, ?), (?, 'servicio', 0, ?)
            `, [inserted.id, amount, now, inserted.id, now]);
            for (const tender of payment.medios_pago) {
                await tx.run(`
                    INSERT INTO pago_medios (
                        pago_id, ordinal, tipo, monto_aplicado,
                        monto_recibido, vuelto, referencia, creado_en
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    inserted.id,
                    tender.ordinal,
                    tender.tipo,
                    tender.monto_aplicado,
                    tender.monto_recibido,
                    tender.vuelto,
                    tender.referencia,
                    now
                ]);
            }
            const previousState = credit.estado;
            const synchronizedCredit = await this.synchronizeCredit(creditId, tx, now);
            await tx.run(`
                INSERT INTO historial_creditos (
                    credito_id, evento, estado_anterior, estado_nuevo,
                    usuario_id, usuario_nombre_snapshot, detalle, fecha
                ) VALUES (?, 'abono_registrado', ?, ?, ?, ?, ?, ?)
            `, [
                creditId,
                previousState,
                synchronizedCredit.estado,
                cashier.id,
                cashier.nombre,
                JSON.stringify({
                    pago_id: inserted.id,
                    numero_pago: sequence.documentNumber,
                    monto: amount,
                    metodo_pago: payment.metodo_pago,
                    monto_recibido: payment.monto_recibido,
                    vuelto: payment.vuelto,
                    saldo_pendiente: synchronizedCredit.saldo_pendiente
                }),
                now
            ]);
            const synchronizedAccount = await this.accountService.synchronizeAccount(
                credit.pedido_id,
                tx,
                { now }
            );
            await tx.run(`
                INSERT INTO historial_transacciones (
                    tipo_accion, usuario_id, descripcion, fecha
                ) VALUES ('abono_credito_paymentservice', ?, ?, ?)
            `, [
                cashier.id,
                `Abono ${sequence.documentNumber} aplicado a ${credit.numero_credito}; monto ${amount}; saldo ${synchronizedCredit.saldo_pendiente}; cuenta ${synchronizedAccount.numero_cuenta}`,
                now
            ]);
            await this.saveIdempotency(
                IDEMPOTENCY_SCOPES.CREDIT_CREATE,
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
                SELECT
                    pg.*,
                    pf.estado AS prefactura_estado,
                    pf.numero_documento,
                    cc.numero_credito,
                    cc.estado AS credito_estado
                FROM pagos pg
                LEFT JOIN prefacturas pf ON pf.id = pg.prefactura_id
                LEFT JOIN cuentas_credito cc ON cc.id = pg.credito_id
                WHERE pg.id = ?
            `, [paymentId]);
            if (!payment) throw new NotFoundError('Pago no encontrado', { paymentId });
            if (payment.estado === PAYMENT_STATES.VOIDED) {
                throw new ConflictError('El pago ya fue anulado con otra solicitud', {
                    code: 'PAYMENT_ALREADY_VOIDED', paymentId
                });
            }
            if (payment.estado !== PAYMENT_STATES.CONFIRMED) {
                throw new ConflictError('Solo un pago confirmado puede anularse', {
                    code: 'PAYMENT_VOID_NOT_ALLOWED', estado: payment.estado
                });
            }
            if (payment.metodo_pago_v3 === PAYMENT_METHODS.CREDIT
                && payment.naturaleza === PAYMENT_NATURES.SALE_SETTLEMENT) {
                throw new ConflictError('La apertura de crédito solo puede revertirse anulando el crédito completo', {
                    code: 'CREDIT_SETTLEMENT_VOID_REQUIRES_CREDIT_CANCELLATION',
                    credito_id: payment.credito_id
                });
            }
            if (!payment.prefactura_id
                && payment.naturaleza !== PAYMENT_NATURES.CREDIT_COLLECTION) {
                throw new ConflictError('Los pagos legacy sin prefactura no admiten reverso automático', {
                    code: 'LEGACY_PAYMENT_VOID_NOT_SUPPORTED'
                });
            }

            const user = await tx.get('SELECT id, nombre, activo FROM usuarios WHERE id = ?', [userId]);
            if (!user || Number(user.activo ?? 1) !== 1) {
                throw new NotFoundError('Usuario activo no encontrado', { userId });
            }
            const previousDocument = payment.prefactura_id
                ? await tx.get('SELECT * FROM prefacturas WHERE id = ?', [payment.prefactura_id])
                : null;
            const previousCredit = payment.credito_id
                ? await tx.get('SELECT * FROM cuentas_credito WHERE id = ?', [payment.credito_id])
                : null;

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
                paymentId, payment.monto, user.id, user.nombre,
                reason, now, idempotencyKey, fingerprint
            ]);

            if (payment.naturaleza === PAYMENT_NATURES.CREDIT_COLLECTION) {
                if (!previousCredit) {
                    throw new InvariantError('El abono no tiene un crédito asociado', {
                        code: 'CREDIT_PAYMENT_WITHOUT_CREDIT', paymentId
                    });
                }
                const synchronizedCredit = await this.synchronizeCredit(payment.credito_id, tx, now);
                await tx.run(`
                    INSERT INTO historial_creditos (
                        credito_id, evento, estado_anterior, estado_nuevo,
                        usuario_id, usuario_nombre_snapshot, detalle, fecha
                    ) VALUES (?, 'abono_anulado', ?, ?, ?, ?, ?, ?)
                `, [
                    payment.credito_id,
                    previousCredit.estado,
                    synchronizedCredit.estado,
                    user.id,
                    user.nombre,
                    JSON.stringify({
                        pago_id: paymentId,
                        numero_pago: payment.numero_pago,
                        reverso_id: reversal.id,
                        monto: payment.monto,
                        motivo: reason,
                        saldo_pendiente: synchronizedCredit.saldo_pendiente
                    }),
                    now
                ]);
                const synchronizedAccount = await this.accountService.synchronizeAccount(
                    payment.pedido_id, tx, { now }
                );
                await tx.run(`
                    INSERT INTO historial_transacciones (
                        tipo_accion, usuario_id, descripcion, fecha
                    ) VALUES ('anular_abono_credito', ?, ?, ?)
                `, [
                    user.id,
                    `Abono ${payment.numero_pago || payment.id} anulado en ${payment.numero_credito || payment.credito_id}; monto ${payment.monto}; saldo restaurado ${synchronizedCredit.saldo_pendiente}; cuenta ${synchronizedAccount.numero_cuenta}`,
                    now
                ]);
            } else {
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
                    payment.pedido_id, tx, { now }
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
            }

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
                p.numero_cuenta,
                cc.numero_credito,
                cc.estado AS credito_estado,
                cc.saldo_pendiente AS credito_saldo_pendiente
            FROM pagos pg
            JOIN pedidos p ON p.id = pg.pedido_id
            LEFT JOIN prefacturas pf ON pf.id = pg.prefactura_id
            LEFT JOIN cuentas_credito cc ON cc.id = pg.credito_id
            WHERE pg.id = ?
        `, [id]);
        if (!row) throw new NotFoundError('Pago no encontrado', { paymentId: id });

        const components = await client.all(`
            SELECT tipo, monto
            FROM pago_componentes
            WHERE pago_id = ?
            ORDER BY tipo
        `, [id]);
        const tenders = await client.all(`
            SELECT
                ordinal, tipo, monto_aplicado,
                monto_recibido, vuelto, referencia
            FROM pago_medios
            WHERE pago_id = ?
            ORDER BY ordinal, id
        `, [id]);
        const reversal = await client.get(`
            SELECT *
            FROM reversos_pago
            WHERE pago_id = ?
        `, [id]);
        const canonicalMethod = row.metodo_pago_v3 || row.metodo_pago;
        return {
            ...row,
            metodo_pago_legacy: row.metodo_pago,
            metodo_pago: canonicalMethod,
            monto_recibido: roundMoney(Number(row.monto_recibido ?? row.monto ?? 0)),
            vuelto: roundMoney(Number(row.vuelto || 0)),
            componentes: components,
            medios_pago: tenders.map(tender => ({
                ...tender,
                monto_aplicado: roundMoney(Number(tender.monto_aplicado || 0)),
                monto_recibido: roundMoney(Number(tender.monto_recibido || 0)),
                vuelto: roundMoney(Number(tender.vuelto || 0))
            })),
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
              AND COALESCE(naturaleza, 'liquidacion_venta') = 'liquidacion_venta'
            ORDER BY fecha, id
        `, [id]);
        return Promise.all(rows.map(row => this.getPayment(row.id, client)));
    }

    async listByCredit(creditId, client = this.db) {
        const id = Number(creditId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de crédito inválido', { creditId });
        }
        const rows = await client.all(`
            SELECT id
            FROM pagos
            WHERE credito_id = ?
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
module.exports.PAYMENT_NATURES = PAYMENT_NATURES;
module.exports.normalizePaymentMethod = normalizePaymentMethod;
module.exports.normalizePaymentTenders = normalizePaymentTenders;
