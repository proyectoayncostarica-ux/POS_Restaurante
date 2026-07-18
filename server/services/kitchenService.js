const database = require('../db/database');
const { TransactionService } = require('./transactionService');
const documentSequenceServiceSingleton = require('./documentSequenceService');
const {
    DOCUMENT_SEQUENCE_TYPES
} = require('./documentSequenceService');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    IdempotencyConflictError
} = require('../errors/domainError');
const {
    createIdempotencyKey,
    normalizeIdempotencyKey,
    createRequestFingerprint
} = require('../utils/idempotency');

const KITCHEN_DESTINATIONS = Object.freeze({
    NONE: 'ninguno',
    KITCHEN: 'cocina',
    BAR: 'bar'
});

const KITCHEN_CHANGE_TYPES = Object.freeze({
    DISPATCH: 'envio',
    ADJUSTMENT: 'ajuste',
    CANCELLATION: 'anulacion',
    RESEND: 'reenvio',
    LEGACY: 'legacy'
});

const KITCHEN_OPERATIONAL_STATES = Object.freeze({
    PENDING: 'pendiente',
    SENT: 'enviada',
    IN_PREPARATION: 'en_preparacion',
    READY: 'lista',
    DELIVERED: 'entregada',
    CANCELLED: 'anulada'
});

const KITCHEN_PRINT_STATES = Object.freeze({
    PENDING: 'pendiente',
    PRINTED: 'impresa',
    FAILED: 'fallida'
});

const KITCHEN_STATE_TRANSITIONS = Object.freeze({
    [KITCHEN_OPERATIONAL_STATES.PENDING]: Object.freeze([
        KITCHEN_OPERATIONAL_STATES.SENT,
        KITCHEN_OPERATIONAL_STATES.CANCELLED
    ]),
    [KITCHEN_OPERATIONAL_STATES.SENT]: Object.freeze([
        KITCHEN_OPERATIONAL_STATES.IN_PREPARATION,
        KITCHEN_OPERATIONAL_STATES.CANCELLED
    ]),
    [KITCHEN_OPERATIONAL_STATES.IN_PREPARATION]: Object.freeze([
        KITCHEN_OPERATIONAL_STATES.READY,
        KITCHEN_OPERATIONAL_STATES.CANCELLED
    ]),
    [KITCHEN_OPERATIONAL_STATES.READY]: Object.freeze([
        KITCHEN_OPERATIONAL_STATES.DELIVERED,
        KITCHEN_OPERATIONAL_STATES.CANCELLED
    ]),
    [KITCHEN_OPERATIONAL_STATES.DELIVERED]: Object.freeze([]),
    [KITCHEN_OPERATIONAL_STATES.CANCELLED]: Object.freeze([])
});

const KITCHEN_STATE_TIMESTAMP_COLUMNS = Object.freeze({
    [KITCHEN_OPERATIONAL_STATES.SENT]: 'enviada_en',
    [KITCHEN_OPERATIONAL_STATES.IN_PREPARATION]: 'preparacion_iniciada_en',
    [KITCHEN_OPERATIONAL_STATES.READY]: 'lista_en',
    [KITCHEN_OPERATIONAL_STATES.DELIVERED]: 'entregada_en',
    [KITCHEN_OPERATIONAL_STATES.CANCELLED]: 'anulada_en'
});

function normalizeDestination(value, fallbackKitchen = false) {
    const normalized = String(value || '').trim().toLowerCase();
    if (Object.values(KITCHEN_DESTINATIONS).includes(normalized)) return normalized;
    return fallbackKitchen ? KITCHEN_DESTINATIONS.KITCHEN : KITCHEN_DESTINATIONS.NONE;
}

function normalizeOptionalText(value, maxLength = 500) {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    if (!normalized) return null;
    if (normalized.length > maxLength) {
        throw new ValidationError('El texto supera la longitud permitida', { maxLength });
    }
    return normalized;
}

function normalizeAdditionalItems(value) {
    if (value === null || typeof value === 'undefined' || value === '') return [];

    let items = value;
    if (typeof items === 'string') {
        const trimmed = items.trim();
        if (!trimmed) return [];
        try {
            items = JSON.parse(trimmed);
        } catch (error) {
            items = trimmed.split(',');
        }
    }

    if (!Array.isArray(items)) items = [items];
    const normalized = [...new Set(items
        .map(item => String(item || '').trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .map(item => {
            if (item.length > 120) {
                throw new ValidationError('Un adicional supera la longitud permitida', {
                    maxLength: 120
                });
            }
            return item;
        }))];
    if (normalized.length > 20) {
        throw new ValidationError('La solicitud supera la cantidad permitida de adicionales', {
            maxItems: 20
        });
    }
    return normalized;
}

function safeJsonParse(value, fallback) {
    if (value === null || typeof value === 'undefined' || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (error) {
        return fallback;
    }
}

function normalizeOperationalState(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!Object.values(KITCHEN_OPERATIONAL_STATES).includes(normalized)) {
        throw new ValidationError('Estado operativo de Kitchen inválido', { state: normalized });
    }
    return normalized;
}

function normalizeExpectedVersion(value) {
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version <= 0) {
        throw new ValidationError('La versión esperada de la comanda es requerida');
    }
    return version;
}

function minutesSince(value, now = new Date()) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return 0;
    return Math.max(0, Math.floor((now.getTime() - timestamp) / 60000));
}

function serializeItemSnapshot(item = {}, overrides = {}) {
    return {
        pedido_producto_id: item.pedido_producto_id ? Number(item.pedido_producto_id) : null,
        producto_id: item.producto_id ? Number(item.producto_id) : null,
        presentacion_id: item.presentacion_id ? Number(item.presentacion_id) : null,
        producto_nombre: item.producto_nombre_snapshot || item.producto_nombre_actual || null,
        presentacion_nombre: item.presentacion_nombre_snapshot || null,
        presentacion_cantidad: item.presentacion_cantidad_snapshot || null,
        cantidad: Number(overrides.cantidad ?? item.cantidad_resultante_snapshot ?? item.cantidad ?? 0),
        observacion: item.observacion_snapshot || null,
        adicionales: normalizeAdditionalItems(item.adicionales_snapshot),
        destino: overrides.destino || item.destino || null
    };
}

function lineIdentityFingerprint(line = {}, destination = null) {
    return createRequestFingerprint({
        producto_id: Number(line.producto_id || 0),
        presentacion_id: line.presentacion_id ? Number(line.presentacion_id) : null,
        destino: normalizeDestination(
            destination || line.destino_preparacion,
            Number(line.es_cocina || 0) === 1
        )
    });
}

function lineDescriptionFingerprint(line = {}, destination = null) {
    return createRequestFingerprint({
        identidad: lineIdentityFingerprint(line, destination),
        producto_nombre: line.producto_nombre_snapshot || line.producto_nombre || '',
        presentacion_nombre: line.presentacion_nombre_snapshot || null,
        presentacion_cantidad: line.presentacion_cantidad_snapshot || null,
        observacion: line.observacion_snapshot || null,
        adicionales: normalizeAdditionalItems(line.adicionales_snapshot)
    });
}

function lineSnapshotFingerprint(line = {}) {
    return createRequestFingerprint({
        cantidad: Number(line.cantidad || 0),
        descripcion: lineDescriptionFingerprint(line)
    });
}

function buildHistoricalSnapshotLine(line = {}, historicalItem = {}) {
    if (!historicalItem) return line;
    return {
        ...line,
        producto_id: historicalItem.producto_id || line.producto_id,
        presentacion_id: historicalItem.presentacion_id || null,
        producto_nombre_snapshot: historicalItem.producto_nombre_snapshot
            || line.producto_nombre_snapshot
            || line.producto_nombre_actual,
        presentacion_nombre_snapshot: historicalItem.presentacion_nombre_snapshot || null,
        presentacion_cantidad_snapshot: historicalItem.presentacion_cantidad_snapshot || null,
        observacion_snapshot: historicalItem.observacion_snapshot || null,
        adicionales_snapshot: historicalItem.adicionales_snapshot || '[]'
    };
}

class KitchenService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.transactions = options.transactions || new TransactionService(this.db);
        this.sequenceService = options.sequenceService || documentSequenceServiceSingleton;
    }

    normalizeDestination(value, fallbackKitchen = false) {
        return normalizeDestination(value, fallbackKitchen);
    }

    normalizeAdditionalItems(value) {
        return normalizeAdditionalItems(value);
    }

    async getRequester(userId, client = this.db) {
        const id = Number(userId || 0);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('El usuario solicitante es requerido');
        }
        const user = await client.get(`
            SELECT id, nombre
            FROM usuarios
            WHERE id = ? AND COALESCE(activo, 1) = 1
        `, [id]);
        if (!user) throw new NotFoundError('Usuario solicitante no encontrado', { userId: id });
        return user;
    }

    async getAccountContext(accountId, client = this.db) {
        const id = Number(accountId || 0);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('La cuenta global es requerida');
        }

        const account = await client.get(`
            SELECT
                p.id,
                p.numero_cuenta,
                p.estado_operativo,
                p.mesa_id,
                COALESCE(p.mesa_numero_snapshot, m.numero) AS mesa_numero,
                COALESCE(p.mesa_tipo_snapshot, m.tipo_asiento) AS mesa_tipo,
                COALESCE(p.zona_id_snapshot, m.zona_id) AS zona_id,
                COALESCE(p.zona_nombre_snapshot, z.nombre, m.zona) AS zona_nombre
            FROM pedidos p
            JOIN mesas m ON m.id = p.mesa_id
            LEFT JOIN zonas z ON z.id = m.zona_id
            WHERE p.id = ?
        `, [id]);

        if (!account) throw new NotFoundError('Cuenta global no encontrada', { accountId: id });
        if (account.estado_operativo !== 'abierta') {
            throw new ConflictError('Solo una cuenta abierta puede solicitar preparación', {
                code: 'ACCOUNT_NOT_OPEN',
                accountId: id,
                estado_operativo: account.estado_operativo
            });
        }
        return account;
    }

    async getConsumptionLines(accountId, client = this.db) {
        return client.all(`
            SELECT
                pp.*,
                p.es_cocina,
                p.destino_preparacion,
                p.nombre AS producto_nombre_actual
            FROM pedido_productos pp
            JOIN productos p ON p.id = pp.producto_id
            WHERE pp.pedido_id = ?
            ORDER BY pp.id
        `, [Number(accountId)]);
    }

    async getDispatchHistory(accountId, client = this.db) {
        return client.all(`
            SELECT
                ci.*,
                c.destino,
                c.solicitada_en,
                c.comanda_origen_id,
                c.id AS comanda_id_resuelta
            FROM comanda_items ci
            JOIN comandas c ON c.id = ci.comanda_id
            WHERE c.pedido_id = ?
              AND ci.pedido_producto_id IS NOT NULL
            ORDER BY ci.id
        `, [Number(accountId)]);
    }

    calculatePendingChanges(lines = [], history = []) {
        const historyByLine = new Map();
        for (const item of history) {
            // Un reenvío repite una instrucción operativa ya contabilizada.
            // Su comanda de origen preserva la trazabilidad sin alterar el neto enviado.
            if (Number(item.comanda_origen_id || 0) > 0) continue;
            const lineId = Number(item.pedido_producto_id || 0);
            if (!lineId) continue;
            if (!historyByLine.has(lineId)) historyByLine.set(lineId, []);
            historyByLine.get(lineId).push(item);
        }

        const changes = [];
        for (const line of lines) {
            const lineId = Number(line.id);
            const quantity = Number(line.cantidad || 0);
            const currentDestination = normalizeDestination(
                line.destino_preparacion,
                Number(line.es_cocina || 0) === 1
            );
            const previousItems = historyByLine.get(lineId) || [];
            const byDestination = new Map();

            for (const item of previousItems) {
                const destination = normalizeDestination(item.destino, true);
                if (!byDestination.has(destination)) {
                    byDestination.set(destination, { net: 0, latest: null });
                }
                const summary = byDestination.get(destination);
                const delta = Math.abs(Number(item.cantidad_delta || 0));
                if (item.tipo_cambio === KITCHEN_CHANGE_TYPES.DISPATCH) summary.net += delta;
                if (item.tipo_cambio === KITCHEN_CHANGE_TYPES.CANCELLATION) summary.net -= delta;
                summary.net = Math.max(0, summary.net);
                summary.latest = item;
            }

            for (const [destination, summary] of byDestination.entries()) {
                if (destination === currentDestination || summary.net <= 0) continue;
                changes.push({
                    line: buildHistoricalSnapshotLine(line, summary.latest),
                    destino: destination,
                    tipo_cambio: KITCHEN_CHANGE_TYPES.CANCELLATION,
                    cantidad_delta: summary.net,
                    cantidad_resultante_snapshot: 0,
                    motivo: currentDestination === KITCHEN_DESTINATIONS.NONE
                        ? 'El producto ya no requiere preparación'
                        : `El destino cambió a ${currentDestination}`
                });
            }

            if (currentDestination === KITCHEN_DESTINATIONS.NONE) continue;

            const currentSummary = byDestination.get(currentDestination) || { net: 0, latest: null };

            if (quantity <= 0) {
                if (currentSummary.net > 0) {
                    changes.push({
                        line: buildHistoricalSnapshotLine(line, currentSummary.latest),
                        destino: currentDestination,
                        tipo_cambio: KITCHEN_CHANGE_TYPES.CANCELLATION,
                        cantidad_delta: currentSummary.net,
                        cantidad_resultante_snapshot: 0,
                        motivo: 'La línea fue retirada del consumo'
                    });
                }
                continue;
            }

            const identityChanged = currentSummary.latest
                ? lineIdentityFingerprint(line, currentDestination)
                    !== lineIdentityFingerprint(currentSummary.latest, currentDestination)
                : false;

            if (identityChanged && currentSummary.net > 0) {
                changes.push({
                    line: buildHistoricalSnapshotLine(line, currentSummary.latest),
                    destino: currentDestination,
                    tipo_cambio: KITCHEN_CHANGE_TYPES.CANCELLATION,
                    cantidad_delta: currentSummary.net,
                    cantidad_resultante_snapshot: 0,
                    motivo: 'El producto o la presentación fue sustituido'
                });
                changes.push({
                    line,
                    destino: currentDestination,
                    tipo_cambio: KITCHEN_CHANGE_TYPES.DISPATCH,
                    cantidad_delta: quantity,
                    cantidad_resultante_snapshot: quantity,
                    motivo: 'Sustituye el producto o la presentación anterior'
                });
                continue;
            }

            const descriptionChanged = currentSummary.latest
                ? lineDescriptionFingerprint(line, currentDestination)
                    !== lineDescriptionFingerprint(currentSummary.latest, currentDestination)
                : false;

            if (currentSummary.net < quantity) {
                changes.push({
                    line,
                    destino: currentDestination,
                    tipo_cambio: KITCHEN_CHANGE_TYPES.DISPATCH,
                    cantidad_delta: quantity - currentSummary.net,
                    cantidad_resultante_snapshot: quantity,
                    motivo: null
                });
                if (descriptionChanged && currentSummary.net > 0) {
                    changes.push({
                        line,
                        destino: currentDestination,
                        tipo_cambio: KITCHEN_CHANGE_TYPES.ADJUSTMENT,
                        cantidad_delta: 0,
                        cantidad_resultante_snapshot: quantity,
                        motivo: 'Cambió la descripción operativa del producto'
                    });
                }
                continue;
            }

            if (currentSummary.net > quantity) {
                changes.push({
                    line: buildHistoricalSnapshotLine(line, currentSummary.latest),
                    destino: currentDestination,
                    tipo_cambio: KITCHEN_CHANGE_TYPES.CANCELLATION,
                    cantidad_delta: currentSummary.net - quantity,
                    cantidad_resultante_snapshot: quantity,
                    motivo: 'La cantidad del consumo fue reducida'
                });
                if (descriptionChanged && quantity > 0) {
                    changes.push({
                        line,
                        destino: currentDestination,
                        tipo_cambio: KITCHEN_CHANGE_TYPES.ADJUSTMENT,
                        cantidad_delta: 0,
                        cantidad_resultante_snapshot: quantity,
                        motivo: 'Cambió la descripción operativa del producto'
                    });
                }
                continue;
            }

            if (descriptionChanged) {
                changes.push({
                    line,
                    destino: currentDestination,
                    tipo_cambio: KITCHEN_CHANGE_TYPES.ADJUSTMENT,
                    cantidad_delta: 0,
                    cantidad_resultante_snapshot: quantity,
                    motivo: 'Cambió la descripción operativa del producto'
                });
            }
        }

        return changes;
    }

    buildRequestFingerprint({ accountId, userId, lines }) {
        return createRequestFingerprint({
            accountId: Number(accountId),
            userId: Number(userId),
            lines: lines.map(line => ({
                id: Number(line.id),
                version: Number(line.version || 1),
                cantidad: Number(line.cantidad || 0),
                snapshot: lineSnapshotFingerprint(line)
            }))
        });
    }

    async getStoredRequest(idempotencyKey, client) {
        if (!idempotencyKey) return null;
        const stored = await client.get(`
            SELECT * FROM solicitudes_kitchen WHERE clave_idempotencia = ?
        `, [idempotencyKey]);
        if (!stored) return null;
        return {
            ...stored,
            result: safeJsonParse(stored.resultado_json, null)
        };
    }

    async saveStoredRequest({ idempotencyKey, accountId, fingerprint, result, now }, client) {
        if (!idempotencyKey) return;
        await client.run(`
            INSERT INTO solicitudes_kitchen (
                clave_idempotencia, pedido_id, solicitud_fingerprint,
                resultado_json, creado_en
            ) VALUES (?, ?, ?, ?, ?)
        `, [idempotencyKey, accountId, fingerprint, JSON.stringify(result), now]);
    }

    buildLegacyProjection(changes = [], requester = {}) {
        return changes.map(change => ({
            pedido_producto_id: Number(change.line.id),
            producto_id: Number(change.line.producto_id),
            presentacion_id: change.line.presentacion_id ? Number(change.line.presentacion_id) : null,
            producto_nombre: change.line.producto_nombre_snapshot || change.line.producto_nombre_actual || 'Producto',
            presentacion_nombre: change.line.presentacion_nombre_snapshot || null,
            presentacion_cantidad: change.line.presentacion_cantidad_snapshot || null,
            cantidad: change.tipo_cambio === KITCHEN_CHANGE_TYPES.CANCELLATION
                ? -Math.abs(Number(change.cantidad_delta || 0))
                : Number(change.cantidad_delta || change.cantidad_resultante_snapshot || 0),
            cantidad_resultante: Number(change.cantidad_resultante_snapshot || 0),
            tipo_cambio: change.tipo_cambio,
            observacion: change.line.observacion_snapshot || null,
            adicionales: normalizeAdditionalItems(change.line.adicionales_snapshot),
            usuario_solicitante: requester.nombre
                || change.line.usuario_solicitante_nombre_snapshot
                || null
        }));
    }

    async getLatestItemTrace({ accountId, lineId, destination }, client = this.db) {
        if (!accountId || !lineId) return null;
        return client.get(`
            SELECT ci.*, c.destino, c.id AS comanda_id
            FROM comanda_items ci
            JOIN comandas c ON c.id = ci.comanda_id
            WHERE c.pedido_id = ?
              AND ci.pedido_producto_id = ?
              AND COALESCE(c.destino, 'cocina') = ?
              AND COALESCE(c.comanda_origen_id, 0) = 0
            ORDER BY ci.id DESC
            LIMIT 1
        `, [Number(accountId), Number(lineId), normalizeDestination(destination, true)]);
    }

    async recordItemHistory({
        commandId, commandItemId, lineId, event, changeType, before, after,
        reason, actor, now
    }, client = this.db) {
        await client.run(`
            INSERT INTO historial_comanda_items (
                comanda_item_id, comanda_id, pedido_producto_id, evento, tipo_cambio,
                antes_json, despues_json, motivo, usuario_id,
                usuario_nombre_snapshot, fecha
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            commandItemId || null,
            commandId,
            lineId || null,
            event,
            changeType || null,
            before ? JSON.stringify(before) : null,
            after ? JSON.stringify(after) : null,
            reason || null,
            actor?.id || null,
            actor?.nombre || null,
            now
        ]);
    }

    async createComandaForDestination({ account, requester, destination, changes, now, idempotencyKey, fingerprint }, client) {
        const sequence = await this.sequenceService.nextInTransaction(
            DOCUMENT_SEQUENCE_TYPES.KITCHEN,
            client,
            { now }
        );
        const legacyProjection = this.buildLegacyProjection(changes, requester);
        const command = await client.run(`
            INSERT INTO comandas (
                mesa_id, productos_cocina, fecha_impresion, estado,
                pedido_id, numero_comanda, numero_secuencia, destino,
                estado_operativo, estado_impresion,
                usuario_solicitante_id, usuario_solicitante_nombre_snapshot,
                numero_cuenta_snapshot, mesa_numero_snapshot, mesa_tipo_snapshot,
                zona_id_snapshot, zona_nombre_snapshot, solicitada_en, actualizada_en,
                prioridad, clave_idempotencia, solicitud_fingerprint, origen, version
            ) VALUES (?, ?, NULL, 'pendiente', ?, ?, ?, ?, 'pendiente', 'pendiente',
                      ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'normalizada', 1)
        `, [
            account.mesa_id,
            JSON.stringify(legacyProjection),
            account.id,
            sequence.documentNumber,
            sequence.sequence,
            destination,
            requester.id,
            requester.nombre,
            account.numero_cuenta,
            account.mesa_numero,
            account.mesa_tipo,
            account.zona_id,
            account.zona_nombre,
            now,
            now,
            idempotencyKey,
            fingerprint
        ]);

        for (const change of changes) {
            const previousItem = await this.getLatestItemTrace({
                accountId: account.id,
                lineId: change.line.id,
                destination
            }, client);
            const beforeSnapshot = previousItem
                ? serializeItemSnapshot(previousItem, {
                    cantidad: change.tipo_cambio === KITCHEN_CHANGE_TYPES.CANCELLATION
                        ? Number(previousItem.cantidad_resultante_snapshot || 0)
                        : Number(previousItem.cantidad_resultante_snapshot || 0),
                    destino: destination
                })
                : null;
            const itemResult = await client.run(`
                INSERT INTO comanda_items (
                    comanda_id, pedido_producto_id, producto_id, presentacion_id,
                    cantidad_delta, cantidad_resultante_snapshot, tipo_cambio,
                    producto_nombre_snapshot, presentacion_nombre_snapshot,
                    presentacion_cantidad_snapshot, observacion_snapshot,
                    adicionales_snapshot, usuario_solicitante_id,
                    usuario_solicitante_nombre_snapshot, motivo, creado_en, version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `, [
                command.id,
                change.line.id,
                change.line.producto_id,
                change.line.presentacion_id || null,
                Math.abs(Number(change.cantidad_delta || 0)),
                Number(change.cantidad_resultante_snapshot || 0),
                change.tipo_cambio,
                change.line.producto_nombre_snapshot || change.line.producto_nombre_actual || 'Producto',
                change.line.presentacion_nombre_snapshot || null,
                change.line.presentacion_cantidad_snapshot || null,
                change.line.observacion_snapshot || null,
                JSON.stringify(normalizeAdditionalItems(change.line.adicionales_snapshot)),
                requester.id,
                requester.nombre,
                change.motivo || null,
                now
            ]);
            const afterSnapshot = serializeItemSnapshot({
                ...change.line,
                pedido_producto_id: change.line.id,
                destino: destination
            }, {
                cantidad: Number(change.cantidad_resultante_snapshot || 0),
                destino: destination
            });
            await this.recordItemHistory({
                commandId: command.id,
                commandItemId: itemResult.id,
                lineId: change.line.id,
                event: change.tipo_cambio,
                changeType: change.tipo_cambio,
                before: beforeSnapshot,
                after: afterSnapshot,
                reason: change.motivo || null,
                actor: requester,
                now
            }, client);
        }

        await client.run(`
            INSERT INTO historial_comandas (
                comanda_id, evento, estado_nuevo, usuario_id,
                usuario_nombre_snapshot, detalle, fecha
            ) VALUES (?, 'solicitud', 'pendiente', ?, ?, ?, ?)
        `, [
            command.id,
            requester.id,
            requester.nombre,
            JSON.stringify({ destino: destination, items: changes.length }),
            now
        ]);

        return this.getComanda(command.id, client);
    }

    async requestDispatchInTransaction(input = {}, client) {
        if (!client?.run || !client?.get || !client?.all) {
            throw new ValidationError('Se requiere una conexión transaccional para solicitar preparación');
        }
        const accountId = Number(input.accountId ?? input.pedido_id);
        const userId = Number(input.userId ?? input.usuario_id);
        const now = input.now || new Date().toISOString();
        const idempotencyKey = input.idempotencyKey
            ? normalizeIdempotencyKey(input.idempotencyKey)
            : createIdempotencyKey(`kitchen-${accountId}`);

        const account = await this.getAccountContext(accountId, client);
        const requester = await this.getRequester(userId, client);
        const lines = await this.getConsumptionLines(accountId, client);
        const fingerprint = this.buildRequestFingerprint({ accountId, userId, lines });
        const stored = await this.getStoredRequest(idempotencyKey, client);

        if (stored) {
            if (stored.solicitud_fingerprint !== fingerprint) {
                throw new IdempotencyConflictError(
                    'La solicitud de Kitchen ya fue usada con un estado de consumo diferente',
                    { code: 'KITCHEN_IDEMPOTENCY_CONFLICT', accountId }
                );
            }
            return { ...stored.result, replayed: true };
        }

        const history = await this.getDispatchHistory(accountId, client);
        const changes = this.calculatePendingChanges(lines, history);
        const groups = new Map();
        for (const change of changes) {
            if (!groups.has(change.destino)) groups.set(change.destino, []);
            groups.get(change.destino).push(change);
        }

        const commandas = [];
        for (const [destination, destinationChanges] of groups.entries()) {
            commandas.push(await this.createComandaForDestination({
                account,
                requester,
                destination,
                changes: destinationChanges,
                now,
                idempotencyKey,
                fingerprint
            }, client));
        }

        const result = {
            pedido_id: accountId,
            numero_cuenta: account.numero_cuenta,
            requiere_comanda: commandas.length > 0,
            comanda_id: commandas[0]?.id || null,
            comanda_ids: commandas.map(item => Number(item.id)),
            comandas: commandas,
            cambios: changes.length,
            replayed: false
        };
        await this.saveStoredRequest({
            idempotencyKey,
            accountId,
            fingerprint,
            result,
            now
        }, client);
        return result;
    }

    requestDispatch(input = {}) {
        return this.transactions.immediate(tx => this.requestDispatchInTransaction(input, tx));
    }

    async getComanda(comandaId, client = this.db) {
        const id = Number(comandaId || 0);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('La comanda es requerida');
        }
        const command = await client.get(`
            SELECT
                c.*,
                COALESCE(c.mesa_numero_snapshot, m.numero) AS mesa_numero,
                COALESCE(c.mesa_tipo_snapshot, m.tipo_asiento) AS mesa_tipo,
                COALESCE(c.zona_id_snapshot, m.zona_id) AS zona_id,
                COALESCE(c.zona_nombre_snapshot, z.nombre, m.zona) AS zona_nombre
            FROM comandas c
            LEFT JOIN mesas m ON m.id = c.mesa_id
            LEFT JOIN zonas z ON z.id = COALESCE(c.zona_id_snapshot, m.zona_id)
            WHERE c.id = ?
        `, [id]);
        if (!command) throw new NotFoundError('Comanda no encontrada', { comandaId: id });
        const items = await client.all(`
            SELECT * FROM comanda_items WHERE comanda_id = ? ORDER BY id
        `, [id]);
        return {
            ...command,
            productos_cocina: safeJsonParse(command.productos_cocina, []),
            items: items.map(item => ({
                ...item,
                adicionales_snapshot: normalizeAdditionalItems(item.adicionales_snapshot)
            }))
        };
    }

    async getPending(filters = {}, client = this.db) {
        const clauses = ["COALESCE(c.estado_operativo, 'pendiente') NOT IN ('entregada', 'anulada')"];
        const params = [];
        const destination = filters.destination || filters.destino;
        if (destination) {
            clauses.push('COALESCE(c.destino, \'cocina\') = ?');
            params.push(normalizeDestination(destination, true));
        }
        const zoneIds = Array.isArray(filters.zoneIds)
            ? filters.zoneIds.map(Number).filter(id => Number.isInteger(id) && id > 0)
            : null;
        if (zoneIds && zoneIds.length) {
            clauses.push(`COALESCE(c.zona_id_snapshot, m.zona_id) IN (${zoneIds.map(() => '?').join(',')})`);
            params.push(...zoneIds);
        } else if (zoneIds && zoneIds.length === 0) {
            return [];
        }

        const rows = await client.all(`
            SELECT
                c.*,
                COALESCE(c.mesa_numero_snapshot, m.numero) AS mesa_numero,
                COALESCE(c.mesa_tipo_snapshot, m.tipo_asiento) AS mesa_tipo,
                COALESCE(c.zona_id_snapshot, m.zona_id) AS zona_id,
                COALESCE(c.zona_nombre_snapshot, z.nombre, m.zona) AS zona_nombre
            FROM comandas c
            LEFT JOIN mesas m ON m.id = c.mesa_id
            LEFT JOIN zonas z ON z.id = COALESCE(c.zona_id_snapshot, m.zona_id)
            WHERE ${clauses.join(' AND ')}
            ORDER BY COALESCE(c.prioridad, 0) DESC, COALESCE(c.solicitada_en, c.fecha_impresion), c.id
        `, params);

        const result = [];
        for (const row of rows) {
            result.push(await this.getComanda(row.id, client));
        }
        return result;
    }

    async getHistory(comandaId, client = this.db) {
        const command = await this.getComanda(comandaId, client);
        const commandEvents = await client.all(`
            SELECT *
            FROM historial_comandas
            WHERE comanda_id = ?
            ORDER BY fecha, id
        `, [command.id]);
        const itemEvents = await client.all(`
            SELECT *
            FROM historial_comanda_items
            WHERE comanda_id = ?
            ORDER BY fecha, id
        `, [command.id]);

        return {
            comanda_id: command.id,
            numero_comanda: command.numero_comanda,
            destino: command.destino,
            estado_operativo: command.estado_operativo,
            version: Number(command.version || 1),
            eventos_comanda: commandEvents.map(event => ({
                ...event,
                detalle: safeJsonParse(event.detalle, event.detalle)
            })),
            eventos_items: itemEvents.map(event => ({
                ...event,
                antes: safeJsonParse(event.antes_json, null),
                despues: safeJsonParse(event.despues_json, null)
            }))
        };
    }

    async getBoard(filters = {}, client = this.db) {
        const now = filters.now ? new Date(filters.now) : new Date();
        if (Number.isNaN(now.getTime())) {
            throw new ValidationError('La fecha de referencia del tablero es inválida');
        }
        const commands = await this.getPending(filters, client);
        const data = [];

        for (const command of commands) {
            const elapsed = minutesSince(command.solicitada_en || command.fecha_impresion, now);
            const configuredPriority = Math.max(0, Number(command.prioridad || 0));
            const agePriority = elapsed >= 30 ? 3 : (elapsed >= 20 ? 2 : (elapsed >= 10 ? 1 : 0));
            const history = await this.getHistory(command.id, client);
            data.push({
                id: Number(command.id),
                numero_comanda: command.numero_comanda,
                pedido_id: command.pedido_id ? Number(command.pedido_id) : null,
                numero_cuenta: command.numero_cuenta_snapshot || null,
                destino: normalizeDestination(command.destino, true),
                estado_operativo: command.estado_operativo || KITCHEN_OPERATIONAL_STATES.PENDING,
                estado_impresion: command.estado_impresion || KITCHEN_PRINT_STATES.PENDING,
                version: Number(command.version || 1),
                prioridad: configuredPriority,
                prioridad_operativa: Math.max(configuredPriority, agePriority),
                solicitada_en: command.solicitada_en || command.fecha_impresion || null,
                enviada_en: command.enviada_en || null,
                preparacion_iniciada_en: command.preparacion_iniciada_en || null,
                lista_en: command.lista_en || null,
                entregada_en: command.entregada_en || null,
                anulada_en: command.anulada_en || null,
                actualizada_en: command.actualizada_en || command.solicitada_en || null,
                minutos_transcurridos: elapsed,
                mesa: {
                    id: command.mesa_id ? Number(command.mesa_id) : null,
                    numero: command.mesa_numero ?? command.mesa_numero_snapshot ?? null,
                    tipo: command.mesa_tipo ?? command.mesa_tipo_snapshot ?? null
                },
                zona: {
                    id: command.zona_id ? Number(command.zona_id) : null,
                    nombre: command.zona_nombre || command.zona_nombre_snapshot || null
                },
                usuario_solicitante: {
                    id: command.usuario_solicitante_id ? Number(command.usuario_solicitante_id) : null,
                    nombre: command.usuario_solicitante_nombre_snapshot || null
                },
                ultimo_actor: {
                    id: command.usuario_estado_id ? Number(command.usuario_estado_id) : null,
                    nombre: command.usuario_estado_nombre_snapshot || null
                },
                items: command.items.map(item => ({
                    id: Number(item.id),
                    pedido_producto_id: item.pedido_producto_id ? Number(item.pedido_producto_id) : null,
                    producto: item.producto_nombre_snapshot,
                    cantidad: Number(item.cantidad_delta || 0),
                    cantidad_resultante: Number(item.cantidad_resultante_snapshot || 0),
                    tipo_cambio: item.tipo_cambio,
                    presentacion: item.presentacion_nombre_snapshot || null,
                    presentacion_cantidad: item.presentacion_cantidad_snapshot || null,
                    observacion: item.observacion_snapshot || null,
                    adicionales: normalizeAdditionalItems(item.adicionales_snapshot),
                    motivo: item.motivo || null,
                    usuario_solicitante: item.usuario_solicitante_nombre_snapshot || null,
                    creado_en: item.creado_en
                })),
                historial: history
            });
        }

        data.sort((a, b) => {
            if (b.prioridad_operativa !== a.prioridad_operativa) {
                return b.prioridad_operativa - a.prioridad_operativa;
            }
            return String(a.solicitada_en || '').localeCompare(String(b.solicitada_en || ''));
        });

        return {
            generado_en: now.toISOString(),
            destino: filters.destination || filters.destino || null,
            total: data.length,
            comandas: data
        };
    }

    async transitionState(input = {}) {
        const comandaId = Number(input.comandaId ?? input.id);
        const userId = Number(input.userId ?? input.usuario_id);
        const targetState = normalizeOperationalState(input.state ?? input.estado_operativo);
        const expectedVersion = normalizeExpectedVersion(input.expectedVersion ?? input.version);
        const reason = normalizeOptionalText(input.reason ?? input.motivo, 300);
        const now = input.now || new Date().toISOString();

        if (targetState === KITCHEN_OPERATIONAL_STATES.CANCELLED && !reason) {
            throw new ValidationError('El motivo de anulación es requerido');
        }

        return this.transactions.immediate(async tx => {
            const command = await this.getComanda(comandaId, tx);
            const currentState = normalizeOperationalState(
                command.estado_operativo || KITCHEN_OPERATIONAL_STATES.PENDING
            );
            if (Number(command.version || 1) !== expectedVersion) {
                throw new ConflictError('La comanda cambió mientras estaba abierta', {
                    code: 'KITCHEN_VERSION_CONFLICT',
                    comandaId,
                    expectedVersion,
                    currentVersion: Number(command.version || 1)
                });
            }
            if (currentState === targetState) {
                return { ...command, replayed: true };
            }
            const allowed = KITCHEN_STATE_TRANSITIONS[currentState] || [];
            if (!allowed.includes(targetState)) {
                throw new ConflictError('La transición de estado de Kitchen no está permitida', {
                    code: 'KITCHEN_INVALID_STATE_TRANSITION',
                    comandaId,
                    currentState,
                    targetState
                });
            }

            const actor = await this.getRequester(userId, tx);
            const timestampColumn = KITCHEN_STATE_TIMESTAMP_COLUMNS[targetState];
            const assignments = [
                'estado_operativo = ?',
                'usuario_estado_id = ?',
                'usuario_estado_nombre_snapshot = ?',
                'actualizada_en = ?',
                'version = version + 1'
            ];
            const params = [targetState, actor.id, actor.nombre, now];
            if (timestampColumn) {
                assignments.push(`${timestampColumn} = COALESCE(${timestampColumn}, ?)`);
                params.push(now);
            }
            if (targetState === KITCHEN_OPERATIONAL_STATES.DELIVERED) {
                assignments.push("estado = 'entregada'");
            }
            if (targetState === KITCHEN_OPERATIONAL_STATES.CANCELLED) {
                assignments.push('motivo = COALESCE(?, motivo)');
                params.push(reason);
            }
            params.push(comandaId, expectedVersion);

            const updated = await tx.run(`
                UPDATE comandas
                SET ${assignments.join(', ')}
                WHERE id = ? AND version = ?
            `, params);
            if (Number(updated.changes || 0) !== 1) {
                throw new ConflictError('La comanda cambió durante la actualización', {
                    code: 'KITCHEN_VERSION_CONFLICT',
                    comandaId,
                    expectedVersion
                });
            }

            await tx.run(`
                INSERT INTO historial_comandas (
                    comanda_id, evento, estado_anterior, estado_nuevo,
                    usuario_id, usuario_nombre_snapshot, detalle, fecha
                ) VALUES (?, 'estado_operativo', ?, ?, ?, ?, ?, ?)
            `, [
                comandaId,
                currentState,
                targetState,
                actor.id,
                actor.nombre,
                reason ? JSON.stringify({ motivo: reason }) : null,
                now
            ]);

            return this.getComanda(comandaId, tx);
        });
    }

    async resend(input = {}) {
        const comandaId = Number(input.comandaId ?? input.id);
        const userId = Number(input.userId ?? input.usuario_id);
        const reason = normalizeOptionalText(input.reason ?? input.motivo, 300);
        const now = input.now || new Date().toISOString();
        if (!reason) throw new ValidationError('El motivo del reenvío es requerido');

        return this.transactions.immediate(async tx => {
            const source = await this.getComanda(comandaId, tx);
            if (!source.pedido_id) {
                throw new ConflictError('La comanda legacy no puede reenviarse automáticamente', {
                    code: 'LEGACY_KITCHEN_RESEND_NOT_SUPPORTED',
                    comandaId
                });
            }
            const requester = await this.getRequester(userId, tx);
            const sequence = await this.sequenceService.nextInTransaction(
                DOCUMENT_SEQUENCE_TYPES.KITCHEN,
                tx,
                { now }
            );
            const command = await tx.run(`
                INSERT INTO comandas (
                    mesa_id, productos_cocina, fecha_impresion, estado,
                    pedido_id, comanda_origen_id, numero_comanda, numero_secuencia,
                    destino, estado_operativo, estado_impresion,
                    usuario_solicitante_id, usuario_solicitante_nombre_snapshot,
                    numero_cuenta_snapshot, mesa_numero_snapshot, mesa_tipo_snapshot,
                    zona_id_snapshot, zona_nombre_snapshot, solicitada_en, actualizada_en,
                    prioridad, motivo, origen, version
                ) VALUES (?, ?, NULL, 'pendiente', ?, ?, ?, ?, ?, 'pendiente', 'pendiente',
                          ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'normalizada', 1)
            `, [
                source.mesa_id,
                JSON.stringify(source.productos_cocina),
                source.pedido_id,
                source.id,
                sequence.documentNumber,
                sequence.sequence,
                source.destino || KITCHEN_DESTINATIONS.KITCHEN,
                requester.id,
                requester.nombre,
                source.numero_cuenta_snapshot,
                source.mesa_numero_snapshot,
                source.mesa_tipo_snapshot,
                source.zona_id_snapshot,
                source.zona_nombre_snapshot,
                now,
                now,
                reason
            ]);

            for (const item of source.items) {
                const itemResult = await tx.run(`
                    INSERT INTO comanda_items (
                        comanda_id, pedido_producto_id, producto_id, presentacion_id,
                        cantidad_delta, cantidad_resultante_snapshot, tipo_cambio,
                        producto_nombre_snapshot, presentacion_nombre_snapshot,
                        presentacion_cantidad_snapshot, observacion_snapshot,
                        adicionales_snapshot, usuario_solicitante_id,
                        usuario_solicitante_nombre_snapshot, motivo, creado_en, version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                `, [
                    command.id,
                    item.pedido_producto_id || null,
                    item.producto_id || null,
                    item.presentacion_id || null,
                    Math.abs(Number(item.cantidad_delta || item.cantidad_resultante_snapshot || 0)),
                    Number(item.cantidad_resultante_snapshot || 0),
                    Object.values(KITCHEN_CHANGE_TYPES).includes(item.tipo_cambio)
                        ? item.tipo_cambio
                        : KITCHEN_CHANGE_TYPES.RESEND,
                    item.producto_nombre_snapshot,
                    item.presentacion_nombre_snapshot || null,
                    item.presentacion_cantidad_snapshot || null,
                    item.observacion_snapshot || null,
                    JSON.stringify(normalizeAdditionalItems(item.adicionales_snapshot)),
                    requester.id,
                    requester.nombre,
                    reason,
                    now
                ]);
                const snapshot = serializeItemSnapshot(item, {
                    cantidad: Number(item.cantidad_resultante_snapshot || 0),
                    destino: source.destino || KITCHEN_DESTINATIONS.KITCHEN
                });
                await this.recordItemHistory({
                    commandId: command.id,
                    commandItemId: itemResult.id,
                    lineId: item.pedido_producto_id || null,
                    event: KITCHEN_CHANGE_TYPES.RESEND,
                    changeType: item.tipo_cambio || KITCHEN_CHANGE_TYPES.RESEND,
                    before: snapshot,
                    after: snapshot,
                    reason,
                    actor: requester,
                    now
                }, tx);
            }

            await tx.run(`
                INSERT INTO historial_comandas (
                    comanda_id, evento, estado_nuevo, usuario_id,
                    usuario_nombre_snapshot, detalle, fecha
                ) VALUES (?, 'reenvio', 'pendiente', ?, ?, ?, ?)
            `, [command.id, requester.id, requester.nombre, JSON.stringify({ origen: source.id, motivo: reason }), now]);
            return this.getComanda(command.id, tx);
        });
    }

    async markPrintState(input = {}) {
        const comandaId = Number(input.comandaId ?? input.id);
        const userId = Number(input.userId ?? input.usuario_id);
        const state = String(input.state ?? input.estado_impresion ?? '').trim().toLowerCase();
        const now = input.now || new Date().toISOString();
        if (!Object.values(KITCHEN_PRINT_STATES).includes(state)) {
            throw new ValidationError('Estado de impresión inválido', { state });
        }

        return this.transactions.immediate(async tx => {
            const command = await this.getComanda(comandaId, tx);
            const requester = await this.getRequester(userId, tx);
            const legacyState = state === KITCHEN_PRINT_STATES.PRINTED ? 'impresa' : 'pendiente';
            await tx.run(`
                UPDATE comandas
                SET estado_impresion = ?,
                    estado = ?,
                    fecha_impresion = CASE
                        WHEN ? = 'impresa' THEN COALESCE(fecha_impresion, ?)
                        ELSE fecha_impresion
                    END,
                    version = COALESCE(version, 1) + 1
                WHERE id = ?
            `, [state, legacyState, state, now, comandaId]);
            await tx.run(`
                INSERT INTO historial_comandas (
                    comanda_id, evento, estado_anterior, estado_nuevo,
                    usuario_id, usuario_nombre_snapshot, detalle, fecha
                ) VALUES (?, 'estado_impresion', ?, ?, ?, ?, NULL, ?)
            `, [comandaId, command.estado_impresion || 'pendiente', state, requester.id, requester.nombre, now]);
            return this.getComanda(comandaId, tx);
        });
    }
}

const kitchenService = new KitchenService();

module.exports = kitchenService;
module.exports.KitchenService = KitchenService;
module.exports.KITCHEN_DESTINATIONS = KITCHEN_DESTINATIONS;
module.exports.KITCHEN_CHANGE_TYPES = KITCHEN_CHANGE_TYPES;
module.exports.KITCHEN_OPERATIONAL_STATES = KITCHEN_OPERATIONAL_STATES;
module.exports.KITCHEN_PRINT_STATES = KITCHEN_PRINT_STATES;
module.exports.KITCHEN_STATE_TRANSITIONS = KITCHEN_STATE_TRANSITIONS;
module.exports.normalizeDestination = normalizeDestination;
module.exports.normalizeAdditionalItems = normalizeAdditionalItems;
