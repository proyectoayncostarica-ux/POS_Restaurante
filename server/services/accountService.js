const database = require('../db/database');
const { TransactionService } = require('./transactionService');
const {
    ValidationError,
    NotFoundError,
    ConflictError,
    ForbiddenError,
    InvariantError
} = require('../errors/domainError');
const {
    toMinorUnits,
    fromMinorUnits,
    addMoney,
    multiplyMoney,
    percentageOf,
    roundMoney
} = require('../utils/money');

const ACCOUNT_OPERATIONAL_STATES = Object.freeze({
    OPEN: 'abierta',
    FINALIZING: 'finalizando',
    CLOSED: 'cerrada',
    CANCELLED: 'cancelada'
});

const ACCOUNT_FINANCIAL_STATES = Object.freeze({
    NO_DOCUMENTS: 'sin_documentos',
    PENDING: 'pendiente',
    PARTIAL: 'parcial',
    RECONCILED: 'conciliada',
    CREDIT: 'credito'
});

const CONSUMPTION_LINE_STATES = Object.freeze({
    AVAILABLE: 'disponible',
    PARTIALLY_ASSIGNED: 'parcialmente_asignada',
    ASSIGNED: 'asignada'
});

function clampServicePercentage(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.min(numeric, 100);
}

function isActive(value) {
    return Number(value ?? 1) === 1;
}

function formatAccountNumber(id) {
    const accountId = Number(id);
    if (!Number.isSafeInteger(accountId) || accountId <= 0) {
        throw new ValidationError('No se puede generar el número de cuenta sin un ID válido', { id });
    }
    return `CTA-${String(accountId).padStart(8, '0')}`;
}

function legacyOperationalState(legacyState, persistedState) {
    if (legacyState === 'cancelado') return ACCOUNT_OPERATIONAL_STATES.CANCELLED;
    if (legacyState === 'pagado' || legacyState === 'credito') return ACCOUNT_OPERATIONAL_STATES.CLOSED;
    if (Object.values(ACCOUNT_OPERATIONAL_STATES).includes(persistedState)) return persistedState;
    return ACCOUNT_OPERATIONAL_STATES.OPEN;
}

function deriveFinancialState({ legacyState, totalMinor, paidMinor, persistedState }) {
    if (legacyState === 'credito') return ACCOUNT_FINANCIAL_STATES.CREDIT;
    if (totalMinor > 0 && paidMinor >= totalMinor) return ACCOUNT_FINANCIAL_STATES.RECONCILED;
    if (paidMinor > 0) return ACCOUNT_FINANCIAL_STATES.PARTIAL;
    if (persistedState === ACCOUNT_FINANCIAL_STATES.PENDING) return ACCOUNT_FINANCIAL_STATES.PENDING;
    return ACCOUNT_FINANCIAL_STATES.NO_DOCUMENTS;
}

class AccountService {
    constructor(options = {}) {
        this.db = options.db || database;
        this.transactions = options.transactions || new TransactionService(this.db);
    }

    calculateService(subtotal, appliesService, percentage) {
        const cleanSubtotal = roundMoney(Number(subtotal) || 0);
        const cleanPercentage = appliesService ? clampServicePercentage(percentage) : 0;
        const service = appliesService ? percentageOf(cleanSubtotal, cleanPercentage) : 0;
        return {
            subtotal: cleanSubtotal,
            aplica_servicio: appliesService ? 1 : 0,
            porcentaje_servicio: cleanPercentage,
            monto_servicio: service,
            total_con_servicio: addMoney(cleanSubtotal, service)
        };
    }

    async getSeatContext(mesaId, client = this.db) {
        const id = Number(mesaId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new ValidationError('La mesa o banco es requerido', { mesaId });
        }

        const seat = await client.get(`
            SELECT
                m.*,
                z.nombre AS zona_nombre,
                z.aplica_servicio AS zona_aplica_servicio,
                z.porcentaje_servicio AS zona_porcentaje_servicio
            FROM mesas m
            LEFT JOIN zonas z ON z.id = m.zona_id
            WHERE m.id = ?
        `, [id]);

        if (!seat) throw new NotFoundError('Mesa o banco no encontrado', { mesaId: id });
        return seat;
    }

    getSeatLabel(seat = {}) {
        const legacyZone = String(seat.zona || '').trim().toLowerCase();
        const seatType = String(seat.tipo_asiento || '').trim().toLowerCase();
        if (legacyZone === 'bar' && seatType === 'banco') return 'banco';
        return seatType === 'banco' ? 'banco' : 'mesa';
    }

    getServicePolicyFromSeat(seat = {}) {
        const hasOverride = seat.aplica_servicio_override !== null
            && typeof seat.aplica_servicio_override !== 'undefined';
        const applies = hasOverride
            ? Number(seat.aplica_servicio_override) === 1
            : Number(seat.zona_aplica_servicio || 0) === 1;
        const rawPercentage = seat.porcentaje_servicio_override !== null
            && typeof seat.porcentaje_servicio_override !== 'undefined'
            ? seat.porcentaje_servicio_override
            : seat.zona_porcentaje_servicio;

        return {
            aplica_servicio: applies ? 1 : 0,
            porcentaje_servicio: applies ? clampServicePercentage(rawPercentage ?? 10) : 0
        };
    }

    async validateProductItem(item, client = this.db) {
        const productoId = Number.parseInt(item?.producto_id, 10);
        const cantidad = Number.parseInt(item?.cantidad, 10);

        if (!productoId || !cantidad || cantidad <= 0) {
            return { skip: true };
        }

        const product = await client.get(`
            SELECT
                p.*,
                COALESCE(p.activo, 1) AS producto_activo,
                c.nombre AS categoria_nombre,
                COALESCE(c.activa, 1) AS categoria_activa,
                s.nombre AS subcategoria_nombre,
                COALESCE(s.activa, 1) AS subcategoria_activa
            FROM productos p
            JOIN categorias c ON p.categoria_id = c.id
            LEFT JOIN categorias s ON p.subcategoria_id = s.id
            WHERE p.id = ?
        `, [productoId]);

        if (!product) throw new NotFoundError(`Producto con ID ${productoId} no encontrado`);
        if (!isActive(product.producto_activo)) throw new ConflictError(`El producto ${product.nombre} está inactivo`);
        if (!isActive(product.categoria_activa)) throw new ConflictError(`La categoría de ${product.nombre} está inactiva`);
        if (product.subcategoria_id && !isActive(product.subcategoria_activa)) {
            throw new ConflictError(`La subcategoría de ${product.nombre} está inactiva`);
        }

        let unitPrice = Number(product.precio || 0);
        let presentationId = null;
        let presentationName = null;
        let presentationQuantity = null;
        const requestedPresentation = item.presentacion_id !== null
            && typeof item.presentacion_id !== 'undefined'
            ? Number.parseInt(item.presentacion_id, 10)
            : null;

        if (requestedPresentation) {
            const presentation = await client.get(`
                SELECT
                    pp.id AS producto_presentacion_id,
                    pp.presentacion_id,
                    pp.precio,
                    pr.nombre AS presentacion_nombre,
                    pr.cantidad AS presentacion_cantidad,
                    pr.tipo_presentacion_id,
                    p.tipo_presentacion_id AS producto_tipo_presentacion_id
                FROM presentaciones_producto pp
                JOIN presentaciones pr ON pr.id = pp.presentacion_id
                JOIN productos p ON p.id = pp.producto_id
                WHERE pp.producto_id = ?
                  AND (pp.id = ? OR pp.presentacion_id = ?)
                  AND COALESCE(pp.activo, 1) = 1
                  AND COALESCE(pr.activo, 1) = 1
                  AND COALESCE(pp.precio, 0) > 0
                  AND (p.tipo_presentacion_id IS NULL OR pr.tipo_presentacion_id = p.tipo_presentacion_id)
                LIMIT 1
            `, [productoId, requestedPresentation, requestedPresentation]);

            if (!presentation) {
                throw new ConflictError(`Presentación no válida para el producto ${product.nombre}`);
            }
            unitPrice = Number(presentation.precio || 0);
            presentationId = Number(presentation.presentacion_id);
            presentationName = presentation.presentacion_nombre || null;
            presentationQuantity = presentation.presentacion_cantidad || null;
        } else {
            const hasPresentations = await client.get(`
                SELECT 1 AS existe
                FROM presentaciones_producto pp
                JOIN presentaciones pr ON pr.id = pp.presentacion_id
                WHERE pp.producto_id = ?
                  AND COALESCE(pp.activo, 1) = 1
                  AND COALESCE(pr.activo, 1) = 1
                  AND COALESCE(pp.precio, 0) > 0
                LIMIT 1
            `, [productoId]);

            if (hasPresentations) {
                throw new ValidationError(`Debe seleccionar una presentación para ${product.nombre}`);
            }
            if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
                throw new ConflictError(`El producto ${product.nombre} no tiene precio operativo válido`);
            }
        }

        return {
            skip: false,
            producto_id: productoId,
            cantidad,
            precio_unitario: roundMoney(unitPrice),
            precio_original: roundMoney(unitPrice),
            presentacion_id: presentationId,
            es_cocina: Number(product.es_cocina) === 1 ? 1 : 0,
            producto_nombre: product.nombre,
            presentacion_nombre: presentationName,
            presentacion_cantidad: presentationQuantity
        };
    }

    async validateProductItems(items, client = this.db) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new ValidationError('Debe seleccionar al menos un producto');
        }

        const validated = [];
        for (const item of items) {
            const result = await this.validateProductItem(item, client);
            if (!result.skip) validated.push(result);
        }

        if (validated.length === 0) {
            throw new ValidationError('No hay productos operativos válidos');
        }
        return validated;
    }

    async getResponsibilitySnapshots(mesaId, creatorUserId, client = this.db) {
        const responsibilities = await client.all(`
            SELECT
                mr.usuario_id,
                mr.rol_trabajo_id,
                mr.fecha_asignacion,
                u.nombre AS usuario_nombre,
                rt.nombre AS rol_nombre
            FROM mesa_responsables mr
            JOIN usuarios u ON u.id = mr.usuario_id
            LEFT JOIN roles_trabajo rt ON rt.id = mr.rol_trabajo_id
            WHERE mr.mesa_id = ?
            ORDER BY CASE WHEN mr.usuario_id = ? THEN 0 ELSE 1 END, mr.fecha_asignacion, mr.usuario_id
        `, [mesaId, creatorUserId]);

        if (responsibilities.length > 0) return responsibilities;

        const creator = await client.get(`
            SELECT id AS usuario_id, nombre AS usuario_nombre
            FROM usuarios
            WHERE id = ?
        `, [creatorUserId]);
        if (!creator) throw new NotFoundError('Usuario creador no encontrado', { creatorUserId });

        return [{
            ...creator,
            rol_trabajo_id: null,
            rol_nombre: null,
            fecha_asignacion: new Date().toISOString()
        }];
    }

    async persistResponsibilitySnapshots(accountId, snapshots, creatorUserId, client) {
        for (const snapshot of snapshots) {
            await client.run(`
                INSERT OR IGNORE INTO cuenta_responsables (
                    pedido_id, usuario_id, rol_trabajo_id, usuario_nombre_snapshot,
                    rol_nombre_snapshot, es_principal, fecha_asignacion_snapshot
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                accountId,
                snapshot.usuario_id || null,
                snapshot.rol_trabajo_id || null,
                snapshot.usuario_nombre,
                snapshot.rol_nombre || null,
                Number(snapshot.usuario_id) === Number(creatorUserId) ? 1 : 0,
                snapshot.fecha_asignacion || new Date().toISOString()
            ]);
        }
    }

    buildConsumptionLineSnapshot(item, servicePolicy = {}, now = new Date().toISOString()) {
        const appliesService = Number(servicePolicy.aplica_servicio || 0) === 1;
        const percentage = appliesService
            ? clampServicePercentage(servicePolicy.porcentaje_servicio)
            : 0;

        return {
            producto_nombre_snapshot: item.producto_nombre || 'Producto',
            presentacion_nombre_snapshot: item.presentacion_nombre || null,
            presentacion_cantidad_snapshot: item.presentacion_cantidad || null,
            aplica_servicio_snapshot: appliesService ? 1 : 0,
            porcentaje_servicio_snapshot: percentage,
            servicio_unitario_snapshot: appliesService
                ? percentageOf(item.precio_unitario, percentage)
                : 0,
            creado_en: now,
            actualizado_en: now,
            version: 1
        };
    }

    toConsumptionLineRead(row = {}) {
        const consumed = Math.max(0, Number.parseInt(row.cantidad, 10) || 0);
        const assigned = Math.min(
            consumed,
            Math.max(0, Number.parseInt(row.cantidad_asignada, 10) || 0)
        );
        const available = Math.max(0, consumed - assigned);
        const documentedRaw = Math.max(0, Number.parseInt(row.cantidad_documentada, 10) || 0);
        const documented = Math.min(consumed, documentedRaw);
        const paid = Math.min(
            documented,
            Math.max(0, Number.parseInt(row.cantidad_pagada, 10) || 0)
        );
        const pendingDocumented = Math.min(
            Math.max(0, documented - paid),
            Math.max(0, Number.parseInt(row.cantidad_documentada_pendiente, 10) || 0)
        );
        const reservedWithoutDocument = Math.max(0, assigned - documented);
        const price = roundMoney(Number(row.precio_unitario || 0));
        const servicePercentage = Number(row.aplica_servicio_snapshot || 0) === 1
            ? clampServicePercentage(row.porcentaje_servicio_snapshot)
            : 0;
        const amountFor = quantity => {
            const subtotal = multiplyMoney(price, quantity);
            const service = servicePercentage > 0
                ? percentageOf(subtotal, servicePercentage)
                : 0;
            return {
                subtotal,
                service,
                total: addMoney(subtotal, service)
            };
        };
        const consumedAmounts = amountFor(consumed);
        const assignedAmounts = amountFor(assigned);
        const availableAmounts = amountFor(available);
        const pendingAmounts = amountFor(pendingDocumented);
        const paidAmounts = amountFor(paid);

        let assignmentState = CONSUMPTION_LINE_STATES.AVAILABLE;
        if (assigned > 0 && available > 0) {
            assignmentState = CONSUMPTION_LINE_STATES.PARTIALLY_ASSIGNED;
        } else if (assigned > 0 && available === 0) {
            assignmentState = CONSUMPTION_LINE_STATES.ASSIGNED;
        }

        let continuityState = 'activa';
        if (paid > 0 && available === 0 && pendingDocumented === 0 && paid >= consumed) {
            continuityState = 'liquidada';
        } else if (paid > 0) {
            continuityState = 'parcialmente_liquidada';
        } else if (pendingDocumented > 0 && available > 0) {
            continuityState = 'activa_y_documentada';
        } else if (pendingDocumented > 0) {
            continuityState = 'documentada_pendiente';
        } else if (reservedWithoutDocument > 0) {
            continuityState = 'reservada_sin_documento';
        }

        return {
            ...row,
            pedido_producto_id: Number(row.id),
            producto_nombre: row.producto_nombre_snapshot || row.producto_nombre || 'Producto',
            presentacion_nombre: row.presentacion_nombre_snapshot || row.presentacion_nombre || '',
            presentacion_cantidad: row.presentacion_cantidad_snapshot || row.presentacion_cantidad || '',
            cantidad: consumed,
            cantidad_consumida: consumed,
            cantidad_asignada: assigned,
            cantidad_disponible: available,
            cantidad_documentada: documented,
            cantidad_documentada_pendiente: pendingDocumented,
            cantidad_pagada: paid,
            cantidad_reservada_sin_documento: reservedWithoutDocument,
            integridad_asignacion_documental: assigned === documented,
            estado_asignacion: assignmentState,
            estado_continuidad: continuityState,
            precio_unitario: price,
            subtotal_consumido: consumedAmounts.subtotal,
            subtotal_asignado: assignedAmounts.subtotal,
            subtotal_disponible: availableAmounts.subtotal,
            subtotal_documentado_pendiente: pendingAmounts.subtotal,
            subtotal_pagado: paidAmounts.subtotal,
            servicio_asignado: assignedAmounts.service,
            servicio_disponible: availableAmounts.service,
            servicio_documentado_pendiente: pendingAmounts.service,
            servicio_pagado: paidAmounts.service,
            total_asignado: assignedAmounts.total,
            total_disponible: availableAmounts.total,
            total_documentado_pendiente: pendingAmounts.total,
            total_pagado_linea: paidAmounts.total,
            version: Math.max(1, Number.parseInt(row.version, 10) || 1)
        };
    }

    summarizeConsumptionLines(lines = []) {
        return lines.reduce((summary, rawLine) => {
            const line = rawLine.cantidad_disponible === undefined
                ? this.toConsumptionLineRead(rawLine)
                : rawLine;

            summary.lineas_totales += 1;
            summary.unidades_consumidas += line.cantidad_consumida;
            summary.unidades_asignadas += line.cantidad_asignada;
            summary.unidades_disponibles += line.cantidad_disponible;
            summary.unidades_documentadas += line.cantidad_documentada;
            summary.unidades_documentadas_pendientes += line.cantidad_documentada_pendiente;
            summary.unidades_pagadas += line.cantidad_pagada;
            summary.unidades_reservadas_sin_documento += line.cantidad_reservada_sin_documento;
            summary.subtotal_consumido = addMoney(summary.subtotal_consumido, line.subtotal_consumido);
            summary.subtotal_asignado = addMoney(summary.subtotal_asignado, line.subtotal_asignado);
            summary.subtotal_disponible = addMoney(summary.subtotal_disponible, line.subtotal_disponible);
            summary.subtotal_documentado_pendiente = addMoney(summary.subtotal_documentado_pendiente, line.subtotal_documentado_pendiente);
            summary.subtotal_pagado = addMoney(summary.subtotal_pagado, line.subtotal_pagado);
            summary.servicio_asignado = addMoney(summary.servicio_asignado, line.servicio_asignado);
            summary.servicio_disponible = addMoney(summary.servicio_disponible, line.servicio_disponible);
            summary.servicio_documentado_pendiente = addMoney(summary.servicio_documentado_pendiente, line.servicio_documentado_pendiente);
            summary.servicio_pagado = addMoney(summary.servicio_pagado, line.servicio_pagado);
            summary.total_asignado = addMoney(summary.total_asignado, line.total_asignado);
            summary.total_disponible = addMoney(summary.total_disponible, line.total_disponible);
            summary.total_documentado_pendiente = addMoney(summary.total_documentado_pendiente, line.total_documentado_pendiente);
            summary.total_pagado_lineas = addMoney(summary.total_pagado_lineas, line.total_pagado_linea);
            if (!line.integridad_asignacion_documental) summary.lineas_con_inconsistencia += 1;
            return summary;
        }, {
            lineas_totales: 0,
            unidades_consumidas: 0,
            unidades_asignadas: 0,
            unidades_disponibles: 0,
            unidades_documentadas: 0,
            unidades_documentadas_pendientes: 0,
            unidades_pagadas: 0,
            unidades_reservadas_sin_documento: 0,
            subtotal_consumido: 0,
            subtotal_asignado: 0,
            subtotal_disponible: 0,
            subtotal_documentado_pendiente: 0,
            subtotal_pagado: 0,
            servicio_asignado: 0,
            servicio_disponible: 0,
            servicio_documentado_pendiente: 0,
            servicio_pagado: 0,
            total_asignado: 0,
            total_disponible: 0,
            total_documentado_pendiente: 0,
            total_pagado_lineas: 0,
            lineas_con_inconsistencia: 0
        });
    }

    normalizeQuantityAssignments(assignments) {
        if (!Array.isArray(assignments) || assignments.length === 0) {
            throw new ValidationError('Debe seleccionar al menos una línea y cantidad');
        }

        const grouped = new Map();
        for (const assignment of assignments) {
            const lineId = Number.parseInt(
                assignment?.pedido_producto_id ?? assignment?.linea_id ?? assignment?.id,
                10
            );
            const quantity = Number.parseInt(assignment?.cantidad, 10);
            const expectedVersion = assignment?.version === undefined || assignment?.version === null
                ? null
                : Number.parseInt(assignment.version, 10);

            if (!lineId || !quantity || quantity <= 0) {
                throw new ValidationError('Cada asignación requiere línea y cantidad positiva', { assignment });
            }

            const current = grouped.get(lineId) || {
                pedido_producto_id: lineId,
                cantidad: 0,
                version: expectedVersion
            };
            current.cantidad += quantity;
            if (current.version === null && expectedVersion !== null) current.version = expectedVersion;
            if (current.version !== null && expectedVersion !== null && current.version !== expectedVersion) {
                throw new ValidationError('La misma línea no puede enviarse con versiones diferentes', {
                    pedido_producto_id: lineId
                });
            }
            grouped.set(lineId, current);
        }

        return [...grouped.values()];
    }

    async getConsumptionLines(accountId, client = this.db) {
        const id = Number(accountId);
        if (!id) throw new ValidationError('ID de cuenta inválido', { accountId });

        const rows = await client.all(`
            SELECT
                pp.*,
                COALESCE(pp.producto_nombre_snapshot, pr.nombre) AS producto_nombre,
                COALESCE(pp.presentacion_nombre_snapshot, pres.nombre, '') AS presentacion_nombre,
                COALESCE(pp.presentacion_cantidad_snapshot, pres.cantidad, '') AS presentacion_cantidad,
                COALESCE(documentos.cantidad_documentada, 0) AS cantidad_documentada,
                COALESCE(documentos.cantidad_documentada_pendiente, 0) AS cantidad_documentada_pendiente,
                COALESCE(documentos.cantidad_pagada, 0) AS cantidad_pagada
            FROM pedido_productos pp
            LEFT JOIN productos pr ON pr.id = pp.producto_id
            LEFT JOIN presentaciones pres ON pres.id = pp.presentacion_id
            LEFT JOIN (
                SELECT
                    pfi.pedido_producto_id,
                    SUM(CASE WHEN pf.estado <> 'anulada' THEN pfi.cantidad ELSE 0 END) AS cantidad_documentada,
                    SUM(CASE WHEN pf.estado IN ('emitida', 'parcial') THEN pfi.cantidad ELSE 0 END) AS cantidad_documentada_pendiente,
                    SUM(CASE WHEN pf.estado = 'pagada' THEN pfi.cantidad ELSE 0 END) AS cantidad_pagada
                FROM prefactura_items pfi
                JOIN prefacturas pf ON pf.id = pfi.prefactura_id
                GROUP BY pfi.pedido_producto_id
            ) documentos ON documentos.pedido_producto_id = pp.id
            WHERE pp.pedido_id = ?
            ORDER BY pp.id
        `, [id]);

        return rows.map(row => this.toConsumptionLineRead(row));
    }

    async getDocumentContinuitySummary(accountId, client = this.db) {
        const id = Number(accountId);
        if (!id) throw new ValidationError('ID de cuenta inválido', { accountId });

        const summary = await client.get(`
            SELECT
                COALESCE(SUM(CASE WHEN estado <> 'anulada' THEN 1 ELSE 0 END), 0) AS documentos_activos,
                COALESCE(SUM(CASE WHEN estado IN ('emitida', 'parcial') THEN 1 ELSE 0 END), 0) AS documentos_pendientes,
                COALESCE(SUM(CASE WHEN estado = 'pagada' THEN 1 ELSE 0 END), 0) AS documentos_pagados,
                COALESCE(SUM(CASE WHEN estado = 'anulada' THEN 1 ELSE 0 END), 0) AS documentos_anulados,
                COALESCE(SUM(CASE WHEN estado <> 'anulada' THEN total ELSE 0 END), 0) AS total_documentado,
                COALESCE(SUM(CASE WHEN estado IN ('emitida', 'parcial') THEN saldo_pendiente ELSE 0 END), 0) AS saldo_documentos_pendiente,
                COALESCE(SUM(CASE WHEN estado = 'pagada' THEN total ELSE 0 END), 0) AS total_documentos_pagados,
                COALESCE(SUM(CASE WHEN estado <> 'anulada' THEN total_pagado ELSE 0 END), 0) AS total_pagado_documentos
            FROM prefacturas
            WHERE pedido_id = ?
        `, [id]);

        return {
            documentos_activos: Number(summary?.documentos_activos || 0),
            documentos_pendientes: Number(summary?.documentos_pendientes || 0),
            documentos_pagados: Number(summary?.documentos_pagados || 0),
            documentos_anulados: Number(summary?.documentos_anulados || 0),
            total_documentado: roundMoney(Number(summary?.total_documentado || 0)),
            saldo_documentos_pendiente: roundMoney(Number(summary?.saldo_documentos_pendiente || 0)),
            total_documentos_pagados: roundMoney(Number(summary?.total_documentos_pagados || 0)),
            total_pagado_documentos: roundMoney(Number(summary?.total_pagado_documentos || 0))
        };
    }

    buildContinuityRead(account = {}, lineSummary = {}, documentSummary = {}) {
        const operationalState = account.estado_operativo || legacyOperationalState(account.estado, account.estado_operativo);
        const serviceOpen = operationalState === ACCOUNT_OPERATIONAL_STATES.OPEN;
        const balance = roundMoney(Number(account.saldo_pendiente || 0));

        return {
            servicio_activo: serviceOpen,
            puede_agregar_consumo: serviceOpen,
            requiere_finalizacion_explicita: serviceOpen,
            mesa_debe_permanecer_ocupada: serviceOpen,
            saldo_temporal_cero: serviceOpen && balance <= 0,
            consumo_disponible: Number(lineSummary.unidades_disponibles || 0),
            consumo_documentado_pendiente: Number(lineSummary.unidades_documentadas_pendientes || 0),
            consumo_pagado: Number(lineSummary.unidades_pagadas || 0),
            ...documentSummary
        };
    }

    async assignAvailableQuantitiesInTransaction(accountId, assignments, client, options = {}) {
        const id = Number(accountId);
        const normalized = options.normalized
            ? assignments
            : this.normalizeQuantityAssignments(assignments);
        const now = options.now || new Date().toISOString();

        if (!client?.get || !client?.run) {
            throw new ValidationError('Se requiere una conexión transaccional para asignar cantidades');
        }

        const account = await client.get(`
            SELECT id, estado_operativo
            FROM pedidos
            WHERE id = ?
        `, [id]);
        if (!account) throw new NotFoundError('Cuenta no encontrada', { accountId: id });
        if (account.estado_operativo !== ACCOUNT_OPERATIONAL_STATES.OPEN) {
            throw new ConflictError('Solo una cuenta abierta puede asignar consumo', {
                code: 'ACCOUNT_NOT_OPEN',
                accountId: id
            });
        }

        const reserved = [];
        for (const assignment of normalized) {
            const line = await client.get(`
                SELECT * FROM pedido_productos
                WHERE id = ? AND pedido_id = ?
            `, [assignment.pedido_producto_id, id]);
            if (!line) {
                throw new NotFoundError('Línea de consumo no encontrada', {
                    pedido_producto_id: assignment.pedido_producto_id,
                    accountId: id
                });
            }

            const current = this.toConsumptionLineRead(line);
            if (assignment.version !== null && assignment.version !== undefined && assignment.version !== current.version) {
                throw new ConflictError('La línea cambió en otro dispositivo', {
                    code: 'CONSUMPTION_LINE_VERSION_CONFLICT',
                    pedido_producto_id: current.pedido_producto_id,
                    expected_version: assignment.version,
                    current_version: current.version
                });
            }
            if (assignment.cantidad > current.cantidad_disponible) {
                throw new InvariantError('La cantidad seleccionada supera la cantidad disponible', {
                    code: 'CONSUMPTION_QUANTITY_EXCEEDED',
                    pedido_producto_id: current.pedido_producto_id,
                    cantidad_consumida: current.cantidad_consumida,
                    cantidad_asignada: current.cantidad_asignada,
                    cantidad_disponible: current.cantidad_disponible,
                    cantidad_solicitada: assignment.cantidad
                });
            }

            const updated = await client.run(`
                UPDATE pedido_productos
                SET cantidad_asignada = cantidad_asignada + ?,
                    actualizado_en = ?,
                    version = COALESCE(version, 1) + 1
                WHERE id = ?
                  AND pedido_id = ?
                  AND cantidad - cantidad_asignada >= ?
            `, [assignment.cantidad, now, current.pedido_producto_id, id, assignment.cantidad]);

            if (updated.changes !== 1) {
                throw new ConflictError('La disponibilidad de la línea cambió durante la operación', {
                    code: 'CONSUMPTION_LINE_CONCURRENT_CHANGE',
                    pedido_producto_id: current.pedido_producto_id
                });
            }

            reserved.push({
                ...current,
                cantidad_reservada: assignment.cantidad,
                version_resultante: current.version + 1
            });
        }

        return reserved;
    }

    async assignAvailableQuantities(accountId, assignments, options = {}) {
        const id = Number(accountId);
        const normalized = this.normalizeQuantityAssignments(assignments);

        return this.transactions.immediate(async tx => {
            await this.assignAvailableQuantitiesInTransaction(id, normalized, tx, {
                ...options,
                normalized: true
            });
            return this.getConsumptionLines(id, tx);
        });
    }

    async releaseAssignedQuantitiesInTransaction(accountId, assignments, client, options = {}) {
        const id = Number(accountId);
        const normalized = options.normalized
            ? assignments
            : this.normalizeQuantityAssignments(assignments);
        const now = options.now || new Date().toISOString();

        if (!client?.get || !client?.run) {
            throw new ValidationError('Se requiere una conexión transaccional para liberar cantidades');
        }

        const released = [];
        for (const assignment of normalized) {
            const line = await client.get(`
                SELECT * FROM pedido_productos
                WHERE id = ? AND pedido_id = ?
            `, [assignment.pedido_producto_id, id]);
            if (!line) throw new NotFoundError('Línea de consumo no encontrada');
            const current = this.toConsumptionLineRead(line);

            if (assignment.version !== null && assignment.version !== undefined && assignment.version !== current.version) {
                throw new ConflictError('La línea cambió en otro dispositivo', {
                    code: 'CONSUMPTION_LINE_VERSION_CONFLICT',
                    pedido_producto_id: current.pedido_producto_id
                });
            }
            if (assignment.cantidad > current.cantidad_asignada) {
                throw new InvariantError('No se puede liberar más cantidad de la asignada', {
                    code: 'CONSUMPTION_RELEASE_EXCEEDED',
                    pedido_producto_id: current.pedido_producto_id,
                    cantidad_asignada: current.cantidad_asignada,
                    cantidad_solicitada: assignment.cantidad
                });
            }

            const updated = await client.run(`
                UPDATE pedido_productos
                SET cantidad_asignada = cantidad_asignada - ?,
                    actualizado_en = ?,
                    version = COALESCE(version, 1) + 1
                WHERE id = ?
                  AND pedido_id = ?
                  AND cantidad_asignada >= ?
            `, [assignment.cantidad, now, current.pedido_producto_id, id, assignment.cantidad]);
            if (updated.changes !== 1) {
                throw new ConflictError('La asignación cambió durante la operación', {
                    code: 'CONSUMPTION_LINE_CONCURRENT_CHANGE',
                    pedido_producto_id: current.pedido_producto_id
                });
            }

            released.push({
                ...current,
                cantidad_liberada: assignment.cantidad,
                version_resultante: current.version + 1
            });
        }

        return released;
    }

    async releaseAssignedQuantities(accountId, assignments, options = {}) {
        const id = Number(accountId);
        const normalized = this.normalizeQuantityAssignments(assignments);

        return this.transactions.immediate(async tx => {
            await this.releaseAssignedQuantitiesInTransaction(id, normalized, tx, {
                ...options,
                normalized: true
            });
            return this.getConsumptionLines(id, tx);
        });
    }

    async calculateAccountTotals(accountId, client = this.db, accountRow = null) {
        const account = accountRow || await client.get('SELECT * FROM pedidos WHERE id = ?', [accountId]);
        if (!account) throw new NotFoundError('Cuenta no encontrada', { accountId });

        const consumption = await client.get(`
            SELECT COALESCE(SUM(precio_unitario * cantidad), 0) AS subtotal
            FROM pedido_productos
            WHERE pedido_id = ?
        `, [accountId]);
        const payments = await client.get(`
            SELECT COALESCE(SUM(monto), 0) AS total_pagado
            FROM pagos
            WHERE pedido_id = ?
              AND COALESCE(estado, 'confirmado') = 'confirmado'
        `, [accountId]);
        const documents = await client.get(`
            SELECT COUNT(*) AS activos
            FROM prefacturas
            WHERE pedido_id = ? AND estado <> 'anulada'
        `, [accountId]);

        const service = this.calculateService(
            Number(consumption?.subtotal || 0),
            Number(account.aplica_servicio || 0) === 1,
            account.porcentaje_servicio
        );
        const totalMinor = toMinorUnits(service.total_con_servicio);
        const paidMinor = toMinorUnits(Number(payments?.total_pagado || 0));
        const balanceMinor = Math.max(0, totalMinor - paidMinor);
        const financialState = deriveFinancialState({
            legacyState: account.estado,
            totalMinor,
            paidMinor,
            persistedState: Number(documents?.activos || 0) > 0 && paidMinor <= 0
                ? ACCOUNT_FINANCIAL_STATES.PENDING
                : account.estado_financiero
        });
        const operationalState = legacyOperationalState(account.estado, account.estado_operativo);

        return {
            ...service,
            total_pagado: fromMinorUnits(paidMinor),
            saldo_pendiente: fromMinorUnits(balanceMinor),
            monto_excedente: fromMinorUnits(Math.max(0, paidMinor - totalMinor)),
            estado_operativo: operationalState,
            estado_financiero: financialState
        };
    }

    async synchronizeAccount(accountId, client = this.db, options = {}) {
        const now = options.now || new Date().toISOString();
        const account = await client.get('SELECT * FROM pedidos WHERE id = ?', [accountId]);
        if (!account) throw new NotFoundError('Cuenta no encontrada', { accountId });
        const totals = await this.calculateAccountTotals(accountId, client, account);
        const reconciliationDate = totals.estado_financiero === ACCOUNT_FINANCIAL_STATES.RECONCILED
            ? (account.fecha_conciliacion || now)
            : null;
        const closeDate = [ACCOUNT_OPERATIONAL_STATES.CLOSED, ACCOUNT_OPERATIONAL_STATES.CANCELLED].includes(totals.estado_operativo)
            ? (account.fecha_cierre || now)
            : null;
        const versionExpression = options.incrementVersion === false ? 'version' : 'COALESCE(version, 0) + 1';

        await client.run(`
            UPDATE pedidos
            SET total = ?,
                monto_servicio = ?,
                total_con_servicio = ?,
                total_pagado = ?,
                saldo_pendiente = ?,
                estado_operativo = ?,
                estado_financiero = ?,
                fecha_conciliacion = ?,
                fecha_cierre = ?,
                actualizado_en = ?,
                version = ${versionExpression}
            WHERE id = ?
        `, [
            totals.subtotal,
            totals.monto_servicio,
            totals.total_con_servicio,
            totals.total_pagado,
            totals.saldo_pendiente,
            totals.estado_operativo,
            totals.estado_financiero,
            reconciliationDate,
            closeDate,
            now,
            accountId
        ]);

        return {
            ...totals,
            numero_cuenta: account.numero_cuenta || formatAccountNumber(accountId),
            fecha_conciliacion: reconciliationDate,
            fecha_cierre: closeDate
        };
    }

    async createAccount(input = {}) {
        const mesaId = Number(input.mesaId || input.mesa_id);
        const creatorUserId = Number(input.userId || input.usuario_id);
        const items = input.products || input.productos;
        const now = input.now || new Date().toISOString();

        if (!creatorUserId) throw new ValidationError('Usuario creador requerido');

        return this.transactions.immediate(async tx => {
            const seat = await this.getSeatContext(mesaId, tx);
            if (seat.estado !== 'ocupada') {
                throw new ConflictError(`La ${this.getSeatLabel(seat)} no está ocupada`, { mesaId });
            }

            const existing = await tx.get(`
                SELECT id, numero_cuenta
                FROM pedidos
                WHERE mesa_id = ?
                  AND (estado = 'pendiente' OR estado_operativo IN ('abierta', 'finalizando'))
                LIMIT 1
            `, [mesaId]);
            if (existing) {
                throw new ConflictError('La mesa o banco ya tiene una cuenta global abierta', {
                    pedido_id: existing.id,
                    numero_cuenta: existing.numero_cuenta
                });
            }

            const validatedItems = await this.validateProductItems(items, tx);
            const servicePolicy = this.getServicePolicyFromSeat(seat);
            const subtotal = validatedItems.reduce(
                (total, item) => addMoney(total, multiplyMoney(item.precio_unitario, item.cantidad)),
                0
            );
            const totals = this.calculateService(
                subtotal,
                servicePolicy.aplica_servicio === 1,
                servicePolicy.porcentaje_servicio
            );
            const responsibilities = await this.getResponsibilitySnapshots(mesaId, creatorUserId, tx);
            const creatorResponsibility = responsibilities.find(item => Number(item.usuario_id) === creatorUserId) || responsibilities[0];
            const clientName = seat.cliente_nombre || input.clienteNombre || input.cliente_nombre || 'Cliente';

            const result = await tx.run(`
                INSERT INTO pedidos (
                    mesa_id, usuario_id, rol_trabajo_id, fecha, estado, total, cliente_nombre,
                    aplica_servicio, porcentaje_servicio, monto_servicio, total_con_servicio,
                    estado_operativo, estado_financiero, total_pagado, saldo_pendiente,
                    fecha_apertura, actualizado_en, version, mesa_numero_snapshot,
                    mesa_tipo_snapshot, zona_id_snapshot, zona_nombre_snapshot,
                    cliente_principal_snapshot
                ) VALUES (?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, 'abierta',
                          'sin_documentos', 0, ?, ?, ?, 1, ?, ?, ?, ?, ?)
            `, [
                mesaId,
                creatorUserId,
                creatorResponsibility?.rol_trabajo_id || null,
                now,
                totals.subtotal,
                clientName,
                totals.aplica_servicio,
                totals.porcentaje_servicio,
                totals.monto_servicio,
                totals.total_con_servicio,
                totals.total_con_servicio,
                now,
                now,
                seat.numero,
                seat.tipo_asiento,
                seat.zona_id,
                seat.zona_nombre || seat.zona,
                clientName
            ]);

            const accountId = result.id;
            const accountNumber = formatAccountNumber(accountId);
            await tx.run('UPDATE pedidos SET numero_cuenta = ? WHERE id = ?', [accountNumber, accountId]);
            await this.persistResponsibilitySnapshots(accountId, responsibilities, creatorUserId, tx);

            for (const item of validatedItems) {
                const lineSnapshot = this.buildConsumptionLineSnapshot(item, totals, now);
                await tx.run(`
                    INSERT INTO pedido_productos (
                        pedido_id, producto_id, cantidad, cantidad_asignada,
                        precio_unitario, precio_original, presentacion_id,
                        producto_nombre_snapshot, presentacion_nombre_snapshot,
                        presentacion_cantidad_snapshot, aplica_servicio_snapshot,
                        porcentaje_servicio_snapshot, servicio_unitario_snapshot,
                        creado_en, actualizado_en, version
                    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    accountId,
                    item.producto_id,
                    item.cantidad,
                    item.precio_unitario,
                    item.precio_original,
                    item.presentacion_id,
                    lineSnapshot.producto_nombre_snapshot,
                    lineSnapshot.presentacion_nombre_snapshot,
                    lineSnapshot.presentacion_cantidad_snapshot,
                    lineSnapshot.aplica_servicio_snapshot,
                    lineSnapshot.porcentaje_servicio_snapshot,
                    lineSnapshot.servicio_unitario_snapshot,
                    lineSnapshot.creado_en,
                    lineSnapshot.actualizado_en,
                    lineSnapshot.version
                ]);
            }

            const kitchenItems = validatedItems.filter(item => item.es_cocina === 1);
            let kitchenTicketId = null;
            if (kitchenItems.length > 0) {
                const kitchen = await tx.run(`
                    INSERT INTO comandas (mesa_id, productos_cocina, fecha_impresion, estado)
                    VALUES (?, ?, ?, 'pendiente')
                `, [mesaId, JSON.stringify(kitchenItems), now]);
                kitchenTicketId = kitchen.id;
            }

            const seatLabel = this.getSeatLabel(seat);
            await tx.run(`
                INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha)
                VALUES (?, ?, ?, ?)
            `, [
                `crear_pedido_${seatLabel}`,
                creatorUserId,
                `Cuenta ${accountNumber} creada para ${seatLabel} ${seat.numero}`,
                now
            ]);

            return {
                id: accountId,
                numero_cuenta: accountNumber,
                ...totals,
                total_pagado: 0,
                saldo_pendiente: totals.total_con_servicio,
                estado_operativo: ACCOUNT_OPERATIONAL_STATES.OPEN,
                estado_financiero: ACCOUNT_FINANCIAL_STATES.NO_DOCUMENTS,
                comanda_id: kitchenTicketId,
                requiere_comanda: kitchenItems.length > 0
            };
        });
    }

    async addProducts(accountId, input = {}) {
        const id = Number(accountId);
        const items = input.products || input.productos;
        const userId = Number(input.userId || input.usuario_id);
        const now = input.now || new Date().toISOString();
        if (!id || !userId) throw new ValidationError('Cuenta y usuario son requeridos');

        return this.transactions.immediate(async tx => {
            const account = await tx.get(`
                SELECT p.*, m.numero, m.zona, m.tipo_asiento, m.zona_id
                FROM pedidos p
                JOIN mesas m ON m.id = p.mesa_id
                WHERE p.id = ?
                  AND p.estado = 'pendiente'
                  AND p.estado_operativo = 'abierta'
            `, [id]);
            if (!account) throw new ConflictError('Cuenta no encontrada o no está abierta', { accountId: id });

            const validatedItems = await this.validateProductItems(items, tx);
            const linePolicy = {
                aplica_servicio: Number(account.aplica_servicio || 0) === 1 ? 1 : 0,
                porcentaje_servicio: account.porcentaje_servicio
            };
            let totalAdditional = 0;
            for (const item of validatedItems) {
                totalAdditional = addMoney(totalAdditional, multiplyMoney(item.precio_unitario, item.cantidad));
                const lineSnapshot = this.buildConsumptionLineSnapshot(item, linePolicy, now);
                const existing = await tx.get(`
                    SELECT id
                    FROM pedido_productos
                    WHERE pedido_id = ?
                      AND producto_id = ?
                      AND COALESCE(presentacion_id, 0) = COALESCE(?, 0)
                      AND COALESCE(cantidad_asignada, 0) = 0
                      AND precio_unitario = ?
                      AND COALESCE(aplica_servicio_snapshot, 0) = ?
                      AND COALESCE(porcentaje_servicio_snapshot, 0) = ?
                    ORDER BY id DESC
                    LIMIT 1
                `, [
                    id,
                    item.producto_id,
                    item.presentacion_id,
                    item.precio_unitario,
                    lineSnapshot.aplica_servicio_snapshot,
                    lineSnapshot.porcentaje_servicio_snapshot
                ]);

                if (existing) {
                    await tx.run(`
                        UPDATE pedido_productos
                        SET cantidad = cantidad + ?,
                            actualizado_en = ?,
                            version = COALESCE(version, 1) + 1
                        WHERE id = ?
                          AND COALESCE(cantidad_asignada, 0) = 0
                    `, [item.cantidad, now, existing.id]);
                } else {
                    await tx.run(`
                        INSERT INTO pedido_productos (
                            pedido_id, producto_id, cantidad, cantidad_asignada,
                            precio_unitario, precio_original, presentacion_id,
                            producto_nombre_snapshot, presentacion_nombre_snapshot,
                            presentacion_cantidad_snapshot, aplica_servicio_snapshot,
                            porcentaje_servicio_snapshot, servicio_unitario_snapshot,
                            creado_en, actualizado_en, version
                        ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        id,
                        item.producto_id,
                        item.cantidad,
                        item.precio_unitario,
                        item.precio_original,
                        item.presentacion_id,
                        lineSnapshot.producto_nombre_snapshot,
                        lineSnapshot.presentacion_nombre_snapshot,
                        lineSnapshot.presentacion_cantidad_snapshot,
                        lineSnapshot.aplica_servicio_snapshot,
                        lineSnapshot.porcentaje_servicio_snapshot,
                        lineSnapshot.servicio_unitario_snapshot,
                        lineSnapshot.creado_en,
                        lineSnapshot.actualizado_en,
                        lineSnapshot.version
                    ]);
                }
            }

            const kitchenItems = validatedItems.filter(item => item.es_cocina === 1);
            let kitchenTicketId = null;
            if (kitchenItems.length > 0) {
                const kitchen = await tx.run(`
                    INSERT INTO comandas (mesa_id, productos_cocina, fecha_impresion, estado)
                    VALUES (?, ?, ?, 'pendiente')
                `, [account.mesa_id, JSON.stringify(kitchenItems), now]);
                kitchenTicketId = kitchen.id;
            }

            const totals = await this.synchronizeAccount(id, tx, { now });
            const seatLabel = this.getSeatLabel(account);
            await tx.run(`
                INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha)
                VALUES (?, ?, ?, ?)
            `, [
                `agregar_productos_${seatLabel}`,
                userId,
                `Productos agregados a ${account.numero_cuenta || formatAccountNumber(id)} (${seatLabel} ${account.numero})`,
                now
            ]);

            return {
                total_adicional: totalAdditional,
                ...totals,
                comanda_id: kitchenTicketId,
                requiere_comanda: kitchenItems.length > 0
            };
        });
    }

    async recordLegacyBalancePayment(accountId, input = {}) {
        const id = Number(accountId);
        const userId = Number(input.userId || input.usuario_id);
        const paymentMethod = String(input.paymentMethod || input.metodo_pago || '').trim().toLowerCase();
        const now = input.now || new Date().toISOString();

        if (!id || !userId) throw new ValidationError('Cuenta y usuario son requeridos');
        if (!paymentMethod) throw new ValidationError('Método de pago requerido');
        if (paymentMethod === 'credito') {
            throw new ConflictError('El crédito continuará temporalmente por el flujo legacy hasta su migración a Payments', {
                code: 'CREDIT_PAYMENT_ADAPTER_NOT_SUPPORTED'
            });
        }

        return this.transactions.immediate(async tx => {
            const account = await tx.get(`
                SELECT p.*, m.numero AS mesa_numero, m.estado AS mesa_estado,
                       m.zona, m.tipo_asiento, m.zona_id
                FROM pedidos p
                JOIN mesas m ON m.id = p.mesa_id
                WHERE p.id = ?
                  AND p.estado = 'pendiente'
                  AND p.estado_operativo = 'abierta'
            `, [id]);
            if (!account) {
                throw new ConflictError('Cuenta no encontrada o el servicio ya no está abierto', {
                    code: 'ACCOUNT_NOT_OPEN',
                    accountId: id
                });
            }

            const documents = await tx.get(`
                SELECT
                    COALESCE((SELECT COUNT(*) FROM prefacturas pf
                              WHERE pf.pedido_id = ? AND pf.estado <> 'anulada'), 0) AS prefacturas_activas,
                    COALESCE((SELECT SUM(pp.cantidad_asignada) FROM pedido_productos pp
                              WHERE pp.pedido_id = ?), 0) AS unidades_asignadas
            `, [id, id]);
            if (Number(documents?.prefacturas_activas || 0) > 0
                || Number(documents?.unidades_asignadas || 0) > 0) {
                throw new ConflictError('La cuenta tiene prefacturas y debe cobrarse por documento desde Caja', {
                    code: 'ACCOUNT_REQUIRES_PREINVOICE_PAYMENT'
                });
            }

            const totals = await this.calculateAccountTotals(id, tx, account);
            const balanceMinor = toMinorUnits(totals.saldo_pendiente);
            if (balanceMinor <= 0) {
                throw new ConflictError('El consumo actual ya está liquidado; la cuenta sigue abierta para nuevos productos', {
                    code: 'ACCOUNT_CURRENT_CONSUMPTION_ALREADY_SETTLED',
                    accountId: id
                });
            }

            const paidComponents = await tx.get(`
                SELECT
                    COALESCE(SUM(subtotal), 0) AS subtotal_pagado,
                    COALESCE(SUM(servicio), 0) AS servicio_pagado
                FROM pagos
                WHERE pedido_id = ?
                  AND COALESCE(estado, 'confirmado') = 'confirmado'
            `, [id]);
            const pendingSubtotalMinor = Math.max(
                0,
                toMinorUnits(totals.subtotal) - toMinorUnits(paidComponents?.subtotal_pagado || 0)
            );
            const subtotalMinor = Math.min(balanceMinor, pendingSubtotalMinor);
            const serviceMinor = Math.max(0, balanceMinor - subtotalMinor);
            const payment = await tx.run(`
                INSERT INTO pagos (
                    pedido_id, metodo_pago, monto, subtotal, servicio,
                    porcentaje_servicio, aplica_servicio, fecha
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                id,
                paymentMethod,
                fromMinorUnits(balanceMinor),
                fromMinorUnits(subtotalMinor),
                fromMinorUnits(serviceMinor),
                totals.porcentaje_servicio,
                totals.aplica_servicio,
                now
            ]);

            const synchronized = await this.synchronizeAccount(id, tx, { now });
            const seatLabel = this.getSeatLabel(account);
            await tx.run(`
                INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha)
                VALUES (?, ?, ?, ?)
            `, [
                `pago_transitorio_${seatLabel}`,
                userId,
                `Saldo actual de ${account.numero_cuenta || formatAccountNumber(id)} liquidado sin cerrar ${seatLabel} ${account.mesa_numero}; el servicio permanece activo`,
                now
            ]);

            return {
                pago_id: payment.id,
                subtotal: fromMinorUnits(subtotalMinor),
                servicio: fromMinorUnits(serviceMinor),
                total: fromMinorUnits(balanceMinor),
                metodo_pago: paymentMethod,
                numero_cuenta: account.numero_cuenta || formatAccountNumber(id),
                mesa_numero: account.mesa_numero,
                mesa_id: account.mesa_id,
                mesa_estado: account.mesa_estado,
                ...synchronized,
                servicio_activo: true,
                mesa_liberada: false,
                requiere_finalizacion_explicita: true
            };
        });
    }

    async getLegacyReplacementContext(accountId, currentProductId, newProductId, client = this.db) {
        const account = await client.get(`
            SELECT p.*, m.numero, m.zona, m.tipo_asiento, m.zona_id
            FROM pedidos p
            JOIN mesas m ON m.id = p.mesa_id
            WHERE p.id = ?
              AND p.estado = 'pendiente'
              AND p.estado_operativo = 'abierta'
        `, [Number(accountId)]);
        if (!account) throw new ConflictError('Cuenta no encontrada o no está abierta', { accountId });

        const currentLines = await client.all(`
            SELECT pp.*, COALESCE(pp.producto_nombre_snapshot, p.nombre) AS nombre_actual
            FROM pedido_productos pp
            JOIN productos p ON p.id = pp.producto_id
            WHERE pp.pedido_id = ? AND pp.producto_id = ?
            ORDER BY pp.id
        `, [Number(accountId), Number(currentProductId)]);
        if (currentLines.length === 0) throw new NotFoundError('Producto no encontrado en la cuenta');
        if (currentLines.length > 1) {
            throw new ConflictError(
                'La edición legacy por producto es ambigua. Debe editarse una línea de consumo específica.',
                {
                    code: 'LEGACY_LINE_EDIT_AMBIGUOUS',
                    producto_id: Number(currentProductId),
                    lineas: currentLines.map(line => line.id)
                }
            );
        }

        const currentLine = currentLines[0];
        if (currentLine.presentacion_id) {
            throw new ConflictError(
                'La edición legacy no admite líneas con presentación.',
                { code: 'LEGACY_LINE_EDIT_PRESENTATION_UNSUPPORTED', pedido_producto_id: currentLine.id }
            );
        }
        if (Number(currentLine.cantidad_asignada || 0) > 0) {
            throw new ConflictError(
                'Una línea con cantidades asignadas no puede modificarse.',
                {
                    code: 'CONSUMPTION_LINE_ALREADY_ASSIGNED',
                    pedido_producto_id: currentLine.id,
                    cantidad_asignada: Number(currentLine.cantidad_asignada || 0)
                }
            );
        }

        const newProduct = await client.get(`
            SELECT p.*, COALESCE(p.activo, 1) AS producto_activo
            FROM productos p
            WHERE p.id = ?
        `, [Number(newProductId)]);
        if (!newProduct) throw new NotFoundError('Nuevo producto no encontrado');
        if (!isActive(newProduct.producto_activo)) throw new ConflictError('El nuevo producto está inactivo');

        const hasPresentations = await client.get(`
            SELECT 1 AS existe
            FROM presentaciones_producto pp
            JOIN presentaciones pr ON pr.id = pp.presentacion_id
            WHERE pp.producto_id = ?
              AND COALESCE(pp.activo, 1) = 1
              AND COALESCE(pr.activo, 1) = 1
              AND COALESCE(pp.precio, 0) > 0
            LIMIT 1
        `, [Number(newProductId)]);
        if (hasPresentations) {
            throw new ConflictError('La edición legacy no admite productos con presentación. Elimina y agrega la línea desde el selector normalizado.');
        }

        const newPrice = roundMoney(Number(newProduct.precio || 0));
        if (newPrice <= 0) throw new ConflictError('El nuevo producto no tiene precio operativo válido');

        const servicePercentage = Number(currentLine.aplica_servicio_snapshot || 0) === 1
            ? clampServicePercentage(currentLine.porcentaje_servicio_snapshot)
            : 0;

        return {
            account,
            currentLine,
            newProduct,
            newPrice,
            newServiceUnit: servicePercentage > 0 ? percentageOf(newPrice, servicePercentage) : 0,
            requiresAdmin: toMinorUnits(newPrice) < toMinorUnits(currentLine.precio_original)
        };
    }

    async replaceLegacyProduct(accountId, currentProductId, newProductId, options = {}) {
        const userId = Number(options.userId);
        if (!userId) throw new ValidationError('Usuario requerido para modificar la cuenta');
        const now = options.now || new Date().toISOString();

        return this.transactions.immediate(async tx => {
            const context = await this.getLegacyReplacementContext(accountId, currentProductId, newProductId, tx);
            if (context.requiresAdmin && options.lowerPriceAuthorized !== true) {
                throw new ForbiddenError(
                    'Se requiere autorización de administrador para cambiar a un producto de menor valor',
                    { requires_admin: true }
                );
            }

            const updated = await tx.run(`
                UPDATE pedido_productos
                SET producto_id = ?,
                    precio_unitario = ?,
                    producto_nombre_snapshot = ?,
                    presentacion_id = NULL,
                    presentacion_nombre_snapshot = NULL,
                    presentacion_cantidad_snapshot = NULL,
                    servicio_unitario_snapshot = ?,
                    actualizado_en = ?,
                    version = COALESCE(version, 1) + 1
                WHERE id = ?
                  AND COALESCE(cantidad_asignada, 0) = 0
            `, [
                Number(newProductId),
                context.newPrice,
                context.newProduct.nombre,
                context.newServiceUnit,
                now,
                context.currentLine.id
            ]);
            if (updated.changes !== 1) {
                throw new ConflictError('La línea cambió y ya no puede editarse', {
                    code: 'CONSUMPTION_LINE_CONCURRENT_CHANGE',
                    pedido_producto_id: context.currentLine.id
                });
            }

            const totals = await this.synchronizeAccount(Number(accountId), tx, { now });
            const seatLabel = this.getSeatLabel(context.account);
            await tx.run(`
                INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha)
                VALUES (?, ?, ?, ?)
            `, [
                `editar_producto_${seatLabel}`,
                userId,
                `Producto cambiado de ${context.currentLine.nombre_actual} a ${context.newProduct.nombre} en ${context.account.numero_cuenta || formatAccountNumber(Number(accountId))} (${seatLabel} ${context.account.numero})`,
                now
            ]);

            return totals;
        });
    }

    buildListWhere(filters = {}) {
        const clauses = [];
        const params = [];
        if (filters.legacyState) {
            clauses.push('p.estado = ?');
            params.push(filters.legacyState);
        }
        if (filters.operationalState) {
            clauses.push('p.estado_operativo = ?');
            params.push(filters.operationalState);
        }
        if (filters.financialState) {
            clauses.push('p.estado_financiero = ?');
            params.push(filters.financialState);
        }
        if (filters.mesaId) {
            clauses.push('p.mesa_id = ?');
            params.push(Number(filters.mesaId));
        }
        if (Array.isArray(filters.zoneIds)) {
            if (filters.zoneIds.length === 0) {
                clauses.push('1 = 0');
            } else {
                clauses.push(`m.zona_id IN (${filters.zoneIds.map(() => '?').join(',')})`);
                params.push(...filters.zoneIds.map(Number));
            }
        }
        return {
            where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
            params
        };
    }

    async listAccounts(filters = {}) {
        const query = this.buildListWhere(filters);
        const rows = await this.db.all(`
            SELECT
                p.*,
                COALESCE(p.mesa_numero_snapshot, m.numero) AS mesa_numero,
                COALESCE(p.mesa_tipo_snapshot, m.tipo_asiento) AS mesa_tipo,
                COALESCE(p.zona_id_snapshot, m.zona_id) AS zona_id,
                COALESCE(p.zona_nombre_snapshot, z.nombre, m.zona) AS zona_nombre,
                COALESCE(p.cliente_principal_snapshot, p.cliente_nombre, m.cliente_nombre) AS cliente_principal,
                u.nombre AS usuario_nombre,
                COALESCE((SELECT SUM(pp.precio_unitario * pp.cantidad) FROM pedido_productos pp WHERE pp.pedido_id = p.id), 0) AS subtotal_calculado,
                COALESCE((SELECT SUM(pp.cantidad) FROM pedido_productos pp WHERE pp.pedido_id = p.id), 0) AS unidades_consumidas,
                COALESCE((SELECT SUM(pp.cantidad_asignada) FROM pedido_productos pp WHERE pp.pedido_id = p.id), 0) AS unidades_asignadas,
                COALESCE((SELECT SUM(pp.cantidad - pp.cantidad_asignada) FROM pedido_productos pp WHERE pp.pedido_id = p.id), 0) AS unidades_disponibles,
                COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.pedido_id = p.id AND COALESCE(pg.estado, 'confirmado') = 'confirmado'), 0) AS pagado_calculado
            FROM pedidos p
            JOIN mesas m ON m.id = p.mesa_id
            JOIN usuarios u ON u.id = p.usuario_id
            LEFT JOIN zonas z ON z.id = m.zona_id
            ${query.where}
            ORDER BY p.fecha DESC, p.id DESC
        `, query.params);

        return rows.map(row => this.enrichAccountRead(row));
    }

    enrichAccountRead(row = {}) {
        const service = this.calculateService(
            Number(row.subtotal_calculado ?? row.total ?? 0),
            Number(row.aplica_servicio || 0) === 1,
            row.porcentaje_servicio
        );
        const totalMinor = toMinorUnits(service.total_con_servicio);
        const paidMinor = toMinorUnits(Number(row.pagado_calculado ?? row.total_pagado ?? 0));
        const balanceMinor = Math.max(0, totalMinor - paidMinor);
        const financialState = deriveFinancialState({
            legacyState: row.estado,
            totalMinor,
            paidMinor,
            persistedState: row.estado_financiero
        });

        return {
            ...row,
            numero_cuenta: row.numero_cuenta || formatAccountNumber(row.id),
            cliente_nombre: row.cliente_principal || row.cliente_nombre,
            cliente_principal: row.cliente_principal || row.cliente_nombre,
            subtotal: service.subtotal,
            total: service.subtotal,
            monto_servicio: service.monto_servicio,
            total_con_servicio: service.total_con_servicio,
            total_pagado: fromMinorUnits(paidMinor),
            saldo_pendiente: fromMinorUnits(balanceMinor),
            monto_excedente: fromMinorUnits(Math.max(0, paidMinor - totalMinor)),
            estado_operativo: legacyOperationalState(row.estado, row.estado_operativo),
            estado_financiero: financialState
        };
    }

    async getAccount(accountId) {
        const id = Number(accountId);
        if (!id) throw new ValidationError('ID de cuenta inválido', { accountId });
        const row = await this.db.get(`
            SELECT
                p.*,
                COALESCE(p.mesa_numero_snapshot, m.numero) AS mesa_numero,
                COALESCE(p.mesa_tipo_snapshot, m.tipo_asiento) AS mesa_tipo,
                COALESCE(p.zona_id_snapshot, m.zona_id) AS zona_id,
                COALESCE(p.zona_nombre_snapshot, z.nombre, m.zona) AS zona_nombre,
                COALESCE(p.cliente_principal_snapshot, p.cliente_nombre, m.cliente_nombre) AS cliente_principal,
                u.nombre AS usuario_nombre,
                COALESCE((SELECT SUM(pp.precio_unitario * pp.cantidad) FROM pedido_productos pp WHERE pp.pedido_id = p.id), 0) AS subtotal_calculado,
                COALESCE((SELECT SUM(pp.cantidad) FROM pedido_productos pp WHERE pp.pedido_id = p.id), 0) AS unidades_consumidas,
                COALESCE((SELECT SUM(pp.cantidad_asignada) FROM pedido_productos pp WHERE pp.pedido_id = p.id), 0) AS unidades_asignadas,
                COALESCE((SELECT SUM(pp.cantidad - pp.cantidad_asignada) FROM pedido_productos pp WHERE pp.pedido_id = p.id), 0) AS unidades_disponibles,
                COALESCE((SELECT SUM(pg.monto) FROM pagos pg WHERE pg.pedido_id = p.id AND COALESCE(pg.estado, 'confirmado') = 'confirmado'), 0) AS pagado_calculado
            FROM pedidos p
            JOIN mesas m ON m.id = p.mesa_id
            JOIN usuarios u ON u.id = p.usuario_id
            LEFT JOIN zonas z ON z.id = m.zona_id
            WHERE p.id = ?
        `, [id]);
        if (!row) throw new NotFoundError('Cuenta no encontrada', { accountId: id });

        const products = await this.getConsumptionLines(id);
        const availableProducts = products
            .filter(product => product.cantidad_disponible > 0)
            .map(product => ({ ...product, cantidad: product.cantidad_disponible }));
        const assignedProducts = products.filter(product => product.cantidad_asignada > 0);
        const pendingDocumentProducts = products
            .filter(product => product.cantidad_documentada_pendiente > 0)
            .map(product => ({ ...product, cantidad: product.cantidad_documentada_pendiente }));
        const paidProducts = products
            .filter(product => product.cantidad_pagada > 0)
            .map(product => ({ ...product, cantidad: product.cantidad_pagada }));
        const reservedWithoutDocumentProducts = products
            .filter(product => product.cantidad_reservada_sin_documento > 0)
            .map(product => ({ ...product, cantidad: product.cantidad_reservada_sin_documento }));
        const lineSummary = this.summarizeConsumptionLines(products);
        const documentSummary = await this.getDocumentContinuitySummary(id);
        const enriched = this.enrichAccountRead(row);
        const continuity = this.buildContinuityRead(enriched, lineSummary, documentSummary);
        const responsibilities = await this.db.all(`
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
        `, [id]);

        return {
            ...enriched,
            productos: products,
            productos_disponibles: availableProducts,
            productos_asignados: assignedProducts,
            productos_documentados_pendientes: pendingDocumentProducts,
            productos_pagados: paidProducts,
            productos_reservados_sin_documento: reservedWithoutDocumentProducts,
            resumen_lineas: lineSummary,
            resumen_documentos: documentSummary,
            continuidad_operativa: continuity,
            responsables: responsibilities
        };
    }
}

const accountService = new AccountService();

module.exports = accountService;
module.exports.AccountService = AccountService;
module.exports.ACCOUNT_OPERATIONAL_STATES = ACCOUNT_OPERATIONAL_STATES;
module.exports.ACCOUNT_FINANCIAL_STATES = ACCOUNT_FINANCIAL_STATES;
module.exports.CONSUMPTION_LINE_STATES = CONSUMPTION_LINE_STATES;
module.exports.formatAccountNumber = formatAccountNumber;
