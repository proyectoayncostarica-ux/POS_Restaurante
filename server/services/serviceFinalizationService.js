const database = require('../db/database');
const { TransactionService } = require('./transactionService');
const accountServiceSingleton = require('./accountService');
const {
    ACCOUNT_OPERATIONAL_STATES,
    ACCOUNT_FINANCIAL_STATES
} = require('./accountService');
const {
    ValidationError,
    NotFoundError,
    ForbiddenError,
    ConflictError,
    InvariantError,
    IdempotencyConflictError
} = require('../errors/domainError');
const {
    normalizeIdempotencyKey,
    createRequestFingerprint
} = require('../utils/idempotency');
const { roundMoney, toMinorUnits } = require('../utils/money');

const FINALIZATION_SCOPE = 'account.finalize';
const MAX_OBSERVATION_LENGTH = 500;

function normalizeObservation(value) {
    const observation = String(value || '').trim().replace(/\s+/g, ' ');
    if (observation.length > MAX_OBSERVATION_LENGTH) {
        throw new ValidationError('La observación de cierre supera el máximo permitido', {
            maxLength: MAX_OBSERVATION_LENGTH
        });
    }
    return observation || null;
}

function buildBlocker(code, message, details = {}) {
    return { code, message, ...details };
}

class ServiceFinalizationService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.transactions = options.transactions || new TransactionService(this.db);
        this.accountService = options.accountService || accountServiceSingleton;
    }

    async getActor(userId, client = this.db) {
        const id = Number(userId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('Usuario requerido para finalizar el servicio');
        }

        const actor = await client.get(`
            SELECT id, nombre, tipo, activo
            FROM usuarios
            WHERE id = ?
        `, [id]);
        if (!actor || Number(actor.activo || 0) !== 1) {
            throw new ForbiddenError('El usuario que intenta finalizar el servicio no está activo', {
                code: 'FINALIZATION_ACTOR_INACTIVE',
                userId: id
            });
        }
        return actor;
    }

    async getAccountContext(accountId, client = this.db) {
        const id = Number(accountId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('ID de cuenta inválido', { accountId });
        }

        const account = await client.get(`
            SELECT
                p.*,
                m.id AS mesa_id_actual,
                m.numero AS mesa_numero_actual,
                m.tipo_asiento AS mesa_tipo_actual,
                m.estado AS mesa_estado_actual,
                m.zona_id AS zona_id_actual,
                m.cliente_nombre AS mesa_cliente_actual,
                COALESCE(p.numero_cuenta, 'CTA-' || printf('%08d', p.id)) AS numero_cuenta_efectivo,
                COALESCE(p.mesa_numero_snapshot, m.numero) AS mesa_numero_efectiva,
                COALESCE(p.mesa_tipo_snapshot, m.tipo_asiento) AS mesa_tipo_efectivo,
                COALESCE(p.cliente_principal_snapshot, p.cliente_nombre, m.cliente_nombre) AS cliente_principal_efectivo
            FROM pedidos p
            JOIN mesas m ON m.id = p.mesa_id
            WHERE p.id = ?
        `, [id]);
        if (!account) throw new NotFoundError('Cuenta global no encontrada', { accountId: id });
        return account;
    }

    async ensureActorCanFinalize(account, actor, client = this.db) {
        if (String(actor.tipo || '').toLowerCase() === 'administrador') return;

        const responsibility = await client.get(`
            SELECT 1 AS autorizado
            FROM mesa_responsables
            WHERE mesa_id = ? AND usuario_id = ?
            LIMIT 1
        `, [account.mesa_id, actor.id]);

        if (!responsibility) {
            throw new ForbiddenError('Solo un responsable activo de la mesa o un administrador puede finalizar el servicio', {
                code: 'MESA_RESPONSIBILITY_REQUIRED',
                mesa_id: Number(account.mesa_id),
                accountId: Number(account.id)
            });
        }
    }

    async getIntegritySnapshot(accountId, client = this.db) {
        const id = Number(accountId);
        const account = await this.getAccountContext(id, client);

        const lines = await client.get(`
            SELECT
                COALESCE(SUM(cantidad), 0) AS unidades_consumidas,
                COALESCE(SUM(cantidad_asignada), 0) AS unidades_asignadas,
                COALESCE(SUM(cantidad - cantidad_asignada), 0) AS unidades_disponibles
            FROM pedido_productos
            WHERE pedido_id = ?
        `, [id]);

        const documented = await client.get(`
            SELECT COALESCE(SUM(pfi.cantidad), 0) AS unidades_documentadas_activas
            FROM prefactura_items pfi
            JOIN prefacturas pf ON pf.id = pfi.prefactura_id
            WHERE pf.pedido_id = ?
              AND pf.estado <> 'anulada'
        `, [id]);

        const documents = await client.get(`
            SELECT
                COUNT(CASE WHEN estado <> 'anulada' THEN 1 END) AS documentos_activos,
                COUNT(CASE WHEN estado IN ('emitida', 'parcial') THEN 1 END) AS documentos_pendientes,
                COUNT(CASE WHEN estado = 'pagada' THEN 1 END) AS documentos_pagados,
                COUNT(CASE WHEN estado = 'anulada' THEN 1 END) AS documentos_anulados,
                COALESCE(SUM(CASE WHEN estado IN ('emitida', 'parcial') THEN saldo_pendiente ELSE 0 END), 0) AS saldo_documental_pendiente
            FROM prefacturas
            WHERE pedido_id = ?
        `, [id]);

        const payments = await client.get(`
            SELECT
                COUNT(CASE WHEN estado = 'pendiente' THEN 1 END) AS pagos_en_proceso,
                COUNT(CASE WHEN estado = 'confirmado' AND COALESCE(naturaleza, 'liquidacion_venta') = 'liquidacion_venta' THEN 1 END) AS pagos_venta_confirmados,
                COALESCE(SUM(CASE WHEN estado = 'confirmado' AND COALESCE(naturaleza, 'liquidacion_venta') = 'liquidacion_venta' THEN monto ELSE 0 END), 0) AS total_venta_pagado
            FROM pagos
            WHERE pedido_id = ?
        `, [id]);

        const credits = await client.get(`
            SELECT
                COUNT(CASE WHEN estado <> 'anulado' THEN 1 END) AS creditos_registrados,
                COUNT(CASE WHEN estado IN ('pendiente', 'parcial') THEN 1 END) AS creditos_vigentes,
                COALESCE(SUM(CASE WHEN estado IN ('pendiente', 'parcial') THEN saldo_pendiente ELSE 0 END), 0) AS saldo_credito,
                COUNT(CASE
                    WHEN estado IN ('pendiente', 'parcial')
                     AND (prefactura_id IS NULL OR pago_apertura_id IS NULL OR origen <> 'paymentservice')
                    THEN 1 END
                ) AS creditos_no_formalizados
            FROM cuentas_credito
            WHERE pedido_id = ?
        `, [id]);

        const totals = await this.accountService.calculateAccountTotals(id, client, account);
        const assigned = Number(lines?.unidades_asignadas || 0);
        const documentedUnits = Number(documented?.unidades_documentadas_activas || 0);
        const reservedWithoutDocument = Math.max(0, assigned - documentedUnits);
        const availableUnits = Number(lines?.unidades_disponibles || 0);
        const activeDocuments = Number(documents?.documentos_activos || 0);
        const legacySettledWithoutDocuments = activeDocuments === 0
            && Number(payments?.pagos_venta_confirmados || 0) > 0
            && toMinorUnits(totals.saldo_pendiente || 0) === 0;

        const blockers = [];
        const warnings = [];

        if (account.estado_operativo === ACCOUNT_OPERATIONAL_STATES.CANCELLED) {
            blockers.push(buildBlocker(
                'ACCOUNT_CANCELLED',
                'La cuenta está cancelada y no puede finalizarse como servicio completado.'
            ));
        }

        if (availableUnits > 0 && !legacySettledWithoutDocuments) {
            blockers.push(buildBlocker(
                'ACTIVE_CONSUMPTION_UNDOCUMENTED',
                'Existen unidades de consumo que todavía no pertenecen a una prefactura.',
                { unidades: availableUnits }
            ));
        }

        if (legacySettledWithoutDocuments && availableUnits > 0) {
            warnings.push({
                code: 'LEGACY_SETTLED_WITHOUT_PREINVOICE',
                message: 'La cuenta fue liquidada por el adaptador legacy sin prefactura. Se permitirá el cierre conservando el historial global.',
                unidades: availableUnits
            });
        }

        if (reservedWithoutDocument > 0) {
            blockers.push(buildBlocker(
                'RESERVED_CONSUMPTION_WITHOUT_DOCUMENT',
                'Existen cantidades reservadas sin una prefactura activa asociada.',
                { unidades: reservedWithoutDocument }
            ));
        }

        if (Number(documents?.documentos_pendientes || 0) > 0
            || toMinorUnits(documents?.saldo_documental_pendiente || 0) > 0) {
            blockers.push(buildBlocker(
                'PREINVOICES_PENDING',
                'Existen prefacturas pendientes de cobro.',
                {
                    documentos: Number(documents?.documentos_pendientes || 0),
                    saldo: roundMoney(Number(documents?.saldo_documental_pendiente || 0))
                }
            ));
        }

        if (Number(payments?.pagos_en_proceso || 0) > 0) {
            blockers.push(buildBlocker(
                'PAYMENTS_IN_PROGRESS',
                'Hay pagos en proceso para esta cuenta.',
                { pagos: Number(payments?.pagos_en_proceso || 0) }
            ));
        }

        if (Number(credits?.creditos_no_formalizados || 0) > 0) {
            blockers.push(buildBlocker(
                'CREDIT_NOT_FORMALIZED',
                'Existe un crédito pendiente que no fue formalizado mediante Payments.',
                { creditos: Number(credits?.creditos_no_formalizados || 0) }
            ));
        }

        if (toMinorUnits(totals.saldo_pendiente || 0) > 0) {
            blockers.push(buildBlocker(
                'ACCOUNT_BALANCE_PENDING',
                'La cuenta global todavía mantiene saldo pendiente.',
                { saldo: roundMoney(Number(totals.saldo_pendiente || 0)) }
            ));
        }

        if (![ACCOUNT_FINANCIAL_STATES.RECONCILED, ACCOUNT_FINANCIAL_STATES.CREDIT].includes(totals.estado_financiero)) {
            blockers.push(buildBlocker(
                'ACCOUNT_NOT_FINANCIALLY_SETTLED',
                'La cuenta global todavía no está conciliada ni formalizada a crédito.',
                { estado_financiero: totals.estado_financiero }
            ));
        }

        if (Number(credits?.creditos_vigentes || 0) > 0) {
            warnings.push({
                code: 'FORMALIZED_CREDIT_REMAINS_OPEN',
                message: 'La mesa puede liberarse porque el crédito ya fue formalizado. La deuda continuará en la cartera de Créditos.',
                creditos: Number(credits?.creditos_vigentes || 0),
                saldo: roundMoney(Number(credits?.saldo_credito || 0))
            });
        }

        const alreadyClosed = account.estado_operativo === ACCOUNT_OPERATIONAL_STATES.CLOSED;
        return {
            account,
            totals,
            lineas: {
                unidades_consumidas: Number(lines?.unidades_consumidas || 0),
                unidades_asignadas: assigned,
                unidades_documentadas_activas: documentedUnits,
                unidades_disponibles: availableUnits,
                unidades_reservadas_sin_documento: reservedWithoutDocument
            },
            documentos: {
                activos: activeDocuments,
                pendientes: Number(documents?.documentos_pendientes || 0),
                pagados: Number(documents?.documentos_pagados || 0),
                anulados: Number(documents?.documentos_anulados || 0),
                saldo_pendiente: roundMoney(Number(documents?.saldo_documental_pendiente || 0))
            },
            pagos: {
                en_proceso: Number(payments?.pagos_en_proceso || 0),
                venta_confirmados: Number(payments?.pagos_venta_confirmados || 0),
                total_venta_pagado: roundMoney(Number(payments?.total_venta_pagado || 0))
            },
            creditos: {
                registrados: Number(credits?.creditos_registrados || 0),
                vigentes: Number(credits?.creditos_vigentes || 0),
                no_formalizados: Number(credits?.creditos_no_formalizados || 0),
                saldo_pendiente: roundMoney(Number(credits?.saldo_credito || 0))
            },
            blockers,
            warnings,
            ya_finalizada: alreadyClosed,
            puede_finalizar: alreadyClosed || blockers.length === 0,
            compatibilidad_legacy: legacySettledWithoutDocuments
        };
    }

    async getFinalizationRead(accountId) {
        const snapshot = await this.getIntegritySnapshot(accountId, this.db);
        return this.buildResult(snapshot);
    }

    buildResult(snapshot, options = {}) {
        const account = snapshot.account;
        const seatLabel = String(account.mesa_tipo_efectivo || '').toLowerCase() === 'banco' ? 'banco' : 'mesa';
        return {
            cuenta: {
                id: Number(account.id),
                numero_cuenta: account.numero_cuenta_efectivo,
                estado_operativo: account.estado_operativo,
                estado_financiero: snapshot.totals.estado_financiero,
                version: Number(account.version || 1),
                total: roundMoney(Number(snapshot.totals.total_con_servicio || 0)),
                total_pagado: roundMoney(Number(snapshot.totals.total_pagado || 0)),
                saldo_pendiente: roundMoney(Number(snapshot.totals.saldo_pendiente || 0)),
                cliente_principal: account.cliente_principal_efectivo || null,
                fecha_cierre: account.fecha_cierre || null,
                finalizada_por_usuario_id: account.finalizada_por_usuario_id || null,
                finalizada_por_nombre: account.finalizada_por_nombre_snapshot || null,
                observacion_cierre: account.observacion_cierre || null
            },
            puesto: {
                id: Number(account.mesa_id),
                tipo: seatLabel,
                numero: account.mesa_numero_efectiva,
                estado: account.mesa_estado_actual,
                liberado: account.mesa_estado_actual === 'libre'
            },
            lineas: snapshot.lineas,
            documentos: snapshot.documentos,
            pagos: snapshot.pagos,
            creditos: snapshot.creditos,
            bloqueos: snapshot.blockers,
            advertencias: snapshot.warnings,
            puede_finalizar: snapshot.puede_finalizar,
            ya_finalizada: snapshot.ya_finalizada,
            compatibilidad_legacy: snapshot.compatibilidad_legacy,
            idempotency_replay: options.idempotencyReplay === true,
            mesa_liberada: account.mesa_estado_actual === 'libre'
        };
    }

    async findIdempotency(key, fingerprint, client) {
        const row = await client.get(`
            SELECT *
            FROM claves_idempotencia
            WHERE ambito = ? AND clave = ?
        `, [FINALIZATION_SCOPE, key]);
        if (!row) return null;
        if (row.fingerprint !== fingerprint) {
            throw new IdempotencyConflictError('La clave de idempotencia ya fue usada con otra finalización', {
                scope: FINALIZATION_SCOPE,
                key,
                recurso_tipo: row.recurso_tipo,
                recurso_id: row.recurso_id
            });
        }
        return row;
    }

    async saveIdempotency(key, fingerprint, accountId, client, now) {
        await client.run(`
            INSERT INTO claves_idempotencia (
                ambito, clave, fingerprint, recurso_tipo, recurso_id, creado_en
            ) VALUES (?, ?, ?, 'cuenta_global', ?, ?)
        `, [FINALIZATION_SCOPE, key, fingerprint, Number(accountId), now]);
    }

    async finalizeService(input = {}) {
        const accountId = Number(input.accountId ?? input.cuenta_id ?? input.pedido_id);
        const userId = Number(input.userId ?? input.usuario_id);
        const observation = normalizeObservation(input.observation ?? input.observacion);
        const expectedVersion = input.expectedVersion === null || input.expectedVersion === undefined
            ? null
            : Number(input.expectedVersion);
        const idempotencyKey = normalizeIdempotencyKey(
            input.idempotencyKey ?? input.clave_idempotencia
        );
        const now = input.now || new Date().toISOString();

        if (!Number.isSafeInteger(accountId) || accountId <= 0) {
            throw new ValidationError('Cuenta requerida para finalizar el servicio');
        }
        if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0)) {
            throw new ValidationError('Versión esperada inválida', { expectedVersion });
        }

        const fingerprint = createRequestFingerprint({
            account_id: accountId,
            user_id: userId,
            observation,
            expected_version: expectedVersion
        });

        const transactionResult = await this.transactions.immediate(async tx => {
            const existing = await this.findIdempotency(idempotencyKey, fingerprint, tx);
            if (existing) {
                const snapshot = await this.getIntegritySnapshot(existing.recurso_id, tx);
                return { snapshot, idempotencyReplay: true };
            }

            const actor = await this.getActor(userId, tx);
            let account = await this.getAccountContext(accountId, tx);
            await this.ensureActorCanFinalize(account, actor, tx);

            if (account.estado_operativo === ACCOUNT_OPERATIONAL_STATES.CLOSED) {
                await this.saveIdempotency(idempotencyKey, fingerprint, accountId, tx, now);
                const snapshot = await this.getIntegritySnapshot(accountId, tx);
                return { snapshot, idempotencyReplay: true };
            }
            if (account.estado_operativo !== ACCOUNT_OPERATIONAL_STATES.OPEN) {
                throw new ConflictError('La cuenta no está abierta para finalizar el servicio', {
                    code: 'ACCOUNT_NOT_OPEN_FOR_FINALIZATION',
                    estado_operativo: account.estado_operativo
                });
            }
            if (expectedVersion !== null && Number(account.version || 1) !== expectedVersion) {
                throw new ConflictError('La cuenta cambió en otro dispositivo', {
                    code: 'ACCOUNT_VERSION_CONFLICT',
                    expected_version: expectedVersion,
                    current_version: Number(account.version || 1)
                });
            }

            const locked = await tx.run(`
                UPDATE pedidos
                SET estado_operativo = 'finalizando',
                    actualizado_en = ?,
                    version = COALESCE(version, 1) + 1
                WHERE id = ?
                  AND estado_operativo = 'abierta'
                  ${expectedVersion !== null ? 'AND COALESCE(version, 1) = ?' : ''}
            `, expectedVersion !== null
                ? [now, accountId, expectedVersion]
                : [now, accountId]);
            if (locked.changes !== 1) {
                throw new ConflictError('La cuenta cambió mientras se intentaba finalizar', {
                    code: 'ACCOUNT_FINALIZATION_CONCURRENT_CHANGE',
                    accountId
                });
            }

            account = await this.getAccountContext(accountId, tx);
            const snapshot = await this.getIntegritySnapshot(accountId, tx);
            if (snapshot.blockers.length > 0) {
                throw new InvariantError('La cuenta no cumple las condiciones para finalizar el servicio', {
                    code: 'SERVICE_FINALIZATION_BLOCKED',
                    blockers: snapshot.blockers,
                    accountId
                });
            }

            const hasOpenCredit = snapshot.creditos.vigentes > 0;
            const legacyState = hasOpenCredit ? 'credito' : 'pagado';
            const financialState = hasOpenCredit
                ? ACCOUNT_FINANCIAL_STATES.CREDIT
                : ACCOUNT_FINANCIAL_STATES.RECONCILED;

            const updated = await tx.run(`
                UPDATE pedidos
                SET estado = ?,
                    estado_operativo = 'cerrada',
                    estado_financiero = ?,
                    total = ?,
                    monto_servicio = ?,
                    total_con_servicio = ?,
                    total_pagado = ?,
                    saldo_pendiente = 0,
                    fecha_conciliacion = COALESCE(fecha_conciliacion, ?),
                    fecha_cierre = ?,
                    finalizada_por_usuario_id = ?,
                    finalizada_por_nombre_snapshot = ?,
                    observacion_cierre = ?,
                    actualizado_en = ?,
                    version = COALESCE(version, 1) + 1
                WHERE id = ?
                  AND estado_operativo = 'finalizando'
            `, [
                legacyState,
                financialState,
                snapshot.totals.subtotal,
                snapshot.totals.monto_servicio,
                snapshot.totals.total_con_servicio,
                snapshot.totals.total_pagado,
                now,
                now,
                actor.id,
                actor.nombre,
                observation,
                now,
                accountId
            ]);
            if (updated.changes !== 1) {
                throw new ConflictError('No se pudo confirmar el cierre de la cuenta', {
                    code: 'ACCOUNT_FINALIZATION_UPDATE_FAILED',
                    accountId
                });
            }

            const seatUpdate = await tx.run(`
                UPDATE mesas
                SET estado = 'libre',
                    cliente_nombre = NULL,
                    fecha_apertura = NULL,
                    cantidad_personas = NULL,
                    hora_estimada = NULL
                WHERE id = ?
                  AND estado IN ('ocupada', 'reservada', 'libre')
            `, [account.mesa_id]);
            if (seatUpdate.changes !== 1) {
                throw new ConflictError('No se pudo liberar la mesa o banco asociado', {
                    code: 'SEAT_RELEASE_FAILED',
                    mesa_id: Number(account.mesa_id)
                });
            }

            await tx.run('DELETE FROM mesa_responsables WHERE mesa_id = ?', [account.mesa_id]);

            const seatLabel = String(account.mesa_tipo_efectivo || '').toLowerCase() === 'banco' ? 'banco' : 'mesa';
            const creditNote = hasOpenCredit
                ? ` Crédito formalizado pendiente en cartera: ${snapshot.creditos.saldo_pendiente}.`
                : '';
            await tx.run(`
                INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha)
                VALUES (?, ?, ?, ?)
            `, [
                `finalizar_servicio_${seatLabel}`,
                actor.id,
                `Servicio finalizado para ${account.numero_cuenta_efectivo}; ${seatLabel} ${account.mesa_numero_efectiva} liberado por ${actor.nombre}.${creditNote}`,
                now
            ]);

            await this.saveIdempotency(idempotencyKey, fingerprint, accountId, tx, now);
            const closedSnapshot = await this.getIntegritySnapshot(accountId, tx);
            return { snapshot: closedSnapshot, idempotencyReplay: false };
        });

        return this.buildResult(transactionResult.snapshot, {
            idempotencyReplay: transactionResult.idempotencyReplay
        });
    }
}

const serviceFinalizationService = new ServiceFinalizationService();

module.exports = serviceFinalizationService;
module.exports.ServiceFinalizationService = ServiceFinalizationService;
module.exports.FINALIZATION_SCOPE = FINALIZATION_SCOPE;
