const database = require('../db/database');
const accountServiceSingleton = require('./accountService');
const paymentServiceSingleton = require('./paymentService');
const documentSequenceServiceSingleton = require('./documentSequenceService');
const { TransactionService } = require('./transactionService');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    ForbiddenError,
    IdempotencyConflictError
} = require('../errors/domainError');
const { roundMoney, toMinorUnits } = require('../utils/money');
const {
    normalizeIdempotencyKey,
    createRequestFingerprint
} = require('../utils/idempotency');
const { DOCUMENT_SEQUENCE_TYPES } = require('./documentSequenceService');

const CREDIT_STATES = Object.freeze({
    PENDING: 'pendiente',
    PARTIAL: 'parcial',
    PAID: 'saldado',
    VOIDED: 'anulado'
});

const CREDIT_IDEMPOTENCY_SCOPES = Object.freeze({
    CREATE: 'credit.create'
});

function normalizeText(value, field, maxLength = 200, required = false) {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    if (required && !normalized) throw new ValidationError(`${field} es requerido`);
    if (normalized.length > maxLength) {
        throw new ValidationError(`${field} supera la longitud permitida`, { maxLength });
    }
    return normalized || null;
}

function parseJsonArray(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

class CreditService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.transactions = options.transactions || new TransactionService(this.db);
        this.accountService = options.accountService || accountServiceSingleton;
        this.paymentService = options.paymentService || paymentServiceSingleton;
        this.sequenceService = options.sequenceService || documentSequenceServiceSingleton;
        this.bcrypt = options.bcrypt || null;
    }

    buildCreateFingerprint(input) {
        return createRequestFingerprint({
            prefactura_id: Number(input.preinvoiceId),
            operador_usuario_id: Number(input.operatorUserId),
            autorizado_por_usuario_id: Number(input.authorizedByUserId),
            observacion: input.observation || null
        });
    }

    async authorizeAdmin(input = {}, client = this.db) {
        const operatorUserId = Number(input.operatorUserId ?? input.usuario_id);
        if (!Number.isSafeInteger(operatorUserId) || operatorUserId <= 0) {
            throw new ValidationError('El usuario operador es requerido');
        }
        const operator = await client.get(
            'SELECT id, nombre, tipo, activo FROM usuarios WHERE id = ?',
            [operatorUserId]
        );
        if (!operator || Number(operator.activo ?? 1) !== 1) {
            throw new NotFoundError('Usuario operador activo no encontrado', { operatorUserId });
        }
        if (operator.tipo === 'administrador' && !input.adminPassword) {
            return { operator, authorizer: operator };
        }

        const password = String(input.adminPassword || '');
        if (!password) {
            throw new ForbiddenError('Se requiere autorización de administrador', {
                code: 'ADMIN_AUTH_REQUIRED'
            });
        }
        const admins = await client.all(`
            SELECT id, nombre, password, tipo, activo
            FROM usuarios
            WHERE tipo = 'administrador' AND activo = 1
            ORDER BY id
        `);
        for (const admin of admins) {
            const bcrypt = this.bcrypt || require('bcryptjs');
            if (await bcrypt.compare(password, admin.password)) {
                return { operator, authorizer: admin };
            }
        }
        throw new ForbiddenError('Contraseña de administrador incorrecta', {
            code: 'ADMIN_AUTH_INVALID'
        });
    }

    async findIdempotency(scope, key, fingerprint, client) {
        const row = await client.get(`
            SELECT * FROM claves_idempotencia
            WHERE ambito = ? AND clave = ?
        `, [scope, key]);
        if (!row) return null;
        if (row.fingerprint !== fingerprint) {
            throw new IdempotencyConflictError('La clave de idempotencia ya fue usada para otro crédito', {
                scope,
                key,
                recurso_tipo: row.recurso_tipo,
                recurso_id: row.recurso_id
            });
        }
        return row;
    }

    async saveIdempotency(scope, key, fingerprint, resourceId, client, now) {
        await client.run(`
            INSERT INTO claves_idempotencia (
                ambito, clave, fingerprint, recurso_tipo, recurso_id, creado_en
            ) VALUES (?, ?, ?, 'credito', ?, ?)
        `, [scope, key, fingerprint, resourceId, now]);
    }

    async formalizePreinvoiceCredit(input = {}) {
        const preinvoiceId = Number(input.preinvoiceId ?? input.prefactura_id);
        const operatorUserId = Number(input.operatorUserId ?? input.usuario_id ?? input.cashierUserId);
        const observation = normalizeText(input.observation ?? input.observacion, 'La observación', 500, false);
        const idempotencyKey = normalizeIdempotencyKey(
            input.idempotencyKey ?? input.clave_idempotencia
        );
        const now = input.now || new Date().toISOString();
        if (!Number.isSafeInteger(preinvoiceId) || preinvoiceId <= 0) {
            throw new ValidationError('La prefactura es requerida');
        }

        return this.transactions.immediate(async tx => {
            const authorization = await this.authorizeAdmin({
                operatorUserId,
                adminPassword: input.adminPassword ?? input.admin_password
            }, tx);
            const fingerprint = this.buildCreateFingerprint({
                preinvoiceId,
                operatorUserId,
                authorizedByUserId: authorization.authorizer.id,
                observation
            });
            const existingKey = await this.findIdempotency(
                CREDIT_IDEMPOTENCY_SCOPES.CREATE,
                idempotencyKey,
                fingerprint,
                tx
            );
            if (existingKey) {
                const credit = await this.getCredit(existingKey.recurso_id, tx);
                return { ...credit, idempotency_replay: true };
            }

            const document = await tx.get(`
                SELECT
                    pf.*,
                    p.estado_operativo,
                    p.numero_cuenta,
                    p.cliente_principal_snapshot AS cliente_principal_cuenta,
                    p.mesa_numero_snapshot,
                    p.mesa_tipo_snapshot,
                    p.zona_nombre_snapshot AS zona_cuenta
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
                throw new ConflictError('La cuenta global no admite nuevos créditos', {
                    code: 'ACCOUNT_NOT_PAYABLE'
                });
            }
            const existingCredit = await tx.get(`
                SELECT id, numero_credito, estado
                FROM cuentas_credito
                WHERE prefactura_id = ? AND estado <> 'anulado'
            `, [preinvoiceId]);
            if (existingCredit) {
                throw new ConflictError('La prefactura ya está vinculada a un crédito', {
                    code: 'PREINVOICE_ALREADY_CREDITED',
                    credito_id: existingCredit.id,
                    numero_credito: existingCredit.numero_credito
                });
            }

            const paymentAggregate = await this.paymentService.getConfirmedAggregate(preinvoiceId, tx);
            const balance = roundMoney(
                Number(document.total || 0) - Number(paymentAggregate.total_pagado || 0)
            );
            if (toMinorUnits(balance) <= 0) {
                throw new ConflictError('La prefactura ya está liquidada', {
                    code: 'PREINVOICE_ALREADY_PAID'
                });
            }

            const sequence = await this.sequenceService.nextInTransaction(
                DOCUMENT_SEQUENCE_TYPES.CREDIT,
                tx,
                { now }
            );
            const payer = document.pagador_nombre || document.cliente_principal_snapshot || 'Cliente';
            const mainClient = document.cliente_principal_cuenta
                || document.cliente_principal_snapshot
                || payer;
            const seatType = document.mesa_tipo_snapshot || 'mesa';
            const seatNumber = document.mesa_numero_snapshot ?? '-';
            const inserted = await tx.run(`
                INSERT INTO cuentas_credito (
                    pedido_id, prefactura_id, numero_credito, numero_secuencia,
                    cliente_nombre, pagador_nombre_snapshot, cliente_principal_snapshot,
                    numero_cuenta_snapshot, numero_documento_snapshot, mesa,
                    zona_nombre_snapshot, responsables_snapshot,
                    monto_original, total_abonado, saldo_pendiente, monto_total,
                    estado, origen, usuario_origen,
                    creado_por_usuario_id, creado_por_nombre_snapshot,
                    autorizado_por_usuario_id, autorizado_por,
                    clave_idempotencia, solicitud_fingerprint, observacion,
                    fecha, version, creado_en, actualizado_en
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?,
                          'pendiente', 'paymentservice', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            `, [
                document.pedido_id,
                preinvoiceId,
                sequence.documentNumber,
                sequence.sequence,
                payer,
                payer,
                mainClient,
                document.numero_cuenta || document.numero_cuenta_snapshot,
                document.numero_documento,
                `${seatType} ${seatNumber}`,
                document.zona_cuenta || document.zona_nombre_snapshot,
                document.responsables_snapshot || '[]',
                balance,
                balance,
                balance,
                authorization.operator.nombre,
                authorization.operator.id,
                authorization.operator.nombre,
                authorization.authorizer.id,
                authorization.authorizer.nombre,
                idempotencyKey,
                fingerprint,
                observation,
                now,
                now,
                now
            ]);

            const settlement = await this.paymentService.recordCreditSettlementInTransaction({
                preinvoiceId,
                creditId: inserted.id,
                cashierUserId: authorization.operator.id,
                reference: sequence.documentNumber,
                now
            }, tx);
            await tx.run(`
                UPDATE cuentas_credito
                SET pago_apertura_id = ?, actualizado_en = ?
                WHERE id = ?
            `, [settlement.paymentId, now, inserted.id]);
            await tx.run(`
                INSERT INTO historial_creditos (
                    credito_id, evento, estado_anterior, estado_nuevo,
                    usuario_id, usuario_nombre_snapshot, detalle, fecha
                ) VALUES (?, 'credito_formalizado', NULL, 'pendiente', ?, ?, ?, ?)
            `, [
                inserted.id,
                authorization.operator.id,
                authorization.operator.nombre,
                JSON.stringify({
                    prefactura_id: preinvoiceId,
                    numero_documento: document.numero_documento,
                    pago_apertura_id: settlement.paymentId,
                    numero_pago_apertura: settlement.numeroPago,
                    monto_original: balance,
                    autorizado_por_usuario_id: authorization.authorizer.id,
                    autorizado_por: authorization.authorizer.nombre,
                    observacion: observation
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
                ) VALUES ('formalizar_credito_prefactura', ?, ?, ?)
            `, [
                authorization.operator.id,
                `Crédito ${sequence.documentNumber} formalizado para ${document.numero_documento}; monto ${balance}; cuenta ${synchronizedAccount.numero_cuenta}; autorizado por ${authorization.authorizer.nombre}`,
                now
            ]);
            await this.saveIdempotency(
                CREDIT_IDEMPOTENCY_SCOPES.CREATE,
                idempotencyKey,
                fingerprint,
                inserted.id,
                tx,
                now
            );
            const credit = await this.getCredit(inserted.id, tx);
            return { ...credit, idempotency_replay: false };
        });
    }

    async recordPayment(input = {}) {
        return this.paymentService.recordCreditPayment(input);
    }

    async getCredit(creditId, client = this.db) {
        const id = Number(creditId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de crédito inválido', { creditId });
        }
        const row = await client.get(`
            SELECT
                cc.*,
                p.estado_operativo,
                p.estado_financiero,
                p.numero_cuenta AS numero_cuenta_actual,
                pf.estado AS prefactura_estado,
                pf.total AS prefactura_total,
                pf.pagador_nombre AS prefactura_pagador
            FROM cuentas_credito cc
            LEFT JOIN pedidos p ON p.id = cc.pedido_id
            LEFT JOIN prefacturas pf ON pf.id = cc.prefactura_id
            WHERE cc.id = ?
        `, [id]);
        if (!row) throw new NotFoundError('Crédito no encontrado', { creditId: id });
        const [payments, history] = await Promise.all([
            this.paymentService.listByCredit(id, client),
            client.all(`
                SELECT * FROM historial_creditos
                WHERE credito_id = ?
                ORDER BY fecha, id
            `, [id])
        ]);
        const installments = payments.filter(payment => payment.naturaleza === 'cobro_credito');
        const opening = payments.find(payment => payment.id === row.pago_apertura_id)
            || payments.find(payment => payment.metodo_pago === 'credito' && payment.prefactura_id);
        return {
            ...row,
            id: Number(row.id),
            pedido_id: row.pedido_id ? Number(row.pedido_id) : null,
            prefactura_id: row.prefactura_id ? Number(row.prefactura_id) : null,
            pago_apertura_id: row.pago_apertura_id ? Number(row.pago_apertura_id) : null,
            monto_original: roundMoney(Number(row.monto_original || 0)),
            total_abonado: roundMoney(Number(row.total_abonado || 0)),
            saldo_pendiente: roundMoney(Number(row.saldo_pendiente ?? row.monto_total ?? 0)),
            monto_total: roundMoney(Number(row.saldo_pendiente ?? row.monto_total ?? 0)),
            responsables: parseJsonArray(row.responsables_snapshot),
            pago_apertura: opening || null,
            abonos: installments,
            pagos: payments,
            historial: history,
            fuente_financiera: 'cuenta_global',
            acciones: {
                puede_abonar: ['pendiente', 'parcial'].includes(row.estado)
                    && Number(row.saldo_pendiente ?? row.monto_total ?? 0) > 0,
                puede_anular: false,
                permite_eliminacion_fisica: false
            }
        };
    }

    async listCredits(filters = {}, client = this.db) {
        const state = String(filters.state ?? filters.estado ?? 'activos').trim().toLowerCase();
        const search = normalizeText(filters.search ?? filters.buscar, 'La búsqueda', 120, false);
        const clauses = [];
        const params = [];
        if (state === 'activos') clauses.push("cc.estado IN ('pendiente', 'parcial')");
        else if (state !== 'todos') {
            if (!Object.values(CREDIT_STATES).includes(state)) {
                throw new ValidationError('Estado de crédito inválido', { state });
            }
            clauses.push('cc.estado = ?');
            params.push(state);
        }
        if (search) {
            const term = `%${search.toLowerCase()}%`;
            clauses.push(`(
                LOWER(COALESCE(cc.numero_credito, '')) LIKE ?
                OR LOWER(COALESCE(cc.numero_cuenta_snapshot, '')) LIKE ?
                OR LOWER(COALESCE(cc.numero_documento_snapshot, '')) LIKE ?
                OR LOWER(COALESCE(cc.cliente_nombre, '')) LIKE ?
                OR LOWER(COALESCE(cc.cliente_principal_snapshot, '')) LIKE ?
                OR LOWER(COALESCE(cc.mesa, '')) LIKE ?
            )`);
            params.push(term, term, term, term, term, term);
        }
        const rows = await client.all(`
            SELECT cc.*
            FROM cuentas_credito cc
            ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
            ORDER BY CASE cc.estado WHEN 'parcial' THEN 0 WHEN 'pendiente' THEN 1 ELSE 2 END,
                     cc.fecha, cc.id
        `, params);
        return rows.map(row => ({
            ...row,
            id: Number(row.id),
            pedido_id: row.pedido_id ? Number(row.pedido_id) : null,
            prefactura_id: row.prefactura_id ? Number(row.prefactura_id) : null,
            monto_original: roundMoney(Number(row.monto_original || 0)),
            total_abonado: roundMoney(Number(row.total_abonado || 0)),
            saldo_pendiente: roundMoney(Number(row.saldo_pendiente ?? row.monto_total ?? 0)),
            monto_total: roundMoney(Number(row.saldo_pendiente ?? row.monto_total ?? 0)),
            fuente_financiera: 'cuenta_global'
        }));
    }

    async getSummary(client = this.db) {
        const rows = await this.listCredits({ state: 'activos' }, client);
        const byClient = new Map();
        let total = 0;
        for (const credit of rows) {
            total = roundMoney(total + credit.saldo_pendiente);
            const name = credit.cliente_nombre || 'Cliente';
            const current = byClient.get(name) || { cliente_nombre: name, num_cuentas: 0, monto_total: 0 };
            current.num_cuentas += 1;
            current.monto_total = roundMoney(current.monto_total + credit.saldo_pendiente);
            byClient.set(name, current);
        }
        return {
            total_cuentas: rows.length,
            monto_total_pendiente: total,
            cuentas_por_cliente: [...byClient.values()].sort((a, b) => b.monto_total - a.monto_total),
            fuente_financiera: 'cuenta_global',
            unidad_deuda: 'credito_formalizado'
        };
    }
}

const creditService = new CreditService();

module.exports = creditService;
module.exports.CreditService = CreditService;
module.exports.CREDIT_STATES = CREDIT_STATES;
module.exports.CREDIT_IDEMPOTENCY_SCOPES = CREDIT_IDEMPOTENCY_SCOPES;
