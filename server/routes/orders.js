const express = require("express");
const database = require("../db/database");
const requireCapability = require("../middleware/requireCapability");
const { CAPABILITIES } = require("../security/capabilities");
const {
    resolveAccessContext,
    evaluateMesaAccess
} = require('../services/operationalAccessService');

const accountService = require('../services/accountService');
const preinvoiceService = require('../services/preinvoiceService');
const serviceFinalizationService = require('../services/serviceFinalizationService');
const { DomainError } = require('../errors/domainError');

const router = express.Router();

function calculateService(subtotal, aplicaServicio, porcentajeServicio) {
    return accountService.calculateService(
        subtotal,
        Number(aplicaServicio) === 1 || aplicaServicio === true,
        porcentajeServicio
    );
}

function sendRouteError(res, error, fallbackMessage) {
    if (error instanceof DomainError || (error && Number.isInteger(error.status) && error.code)) {
        const payload = {
            error: error.expose === false ? fallbackMessage : error.message,
            code: error.code || 'DOMAIN_ERROR'
        };
        if (error.details) Object.assign(payload, error.details);
        return res.status(error.status || 400).json(payload);
    }

    console.error(fallbackMessage, error);
    return res.status(500).json({ error: fallbackMessage });
}

// Obtener todas las cuentas visibles para la sesión operativa.
// La ruta legacy /api/orders se conserva como adaptador del dominio Cuenta global.
router.get('/', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const access = await resolveAccessContext(req);
        const accounts = await accountService.listAccounts({
            legacyState: req.query.estado || null,
            operationalState: req.query.estado_operativo || null,
            financialState: req.query.estado_financiero || null,
            mesaId: req.query.mesa_id || null,
            zoneIds: access.isAdmin ? null : access.zoneIds
        });
        res.json({ success: true, data: accounts });
    } catch (error) {
        return sendRouteError(res, error, 'Error obteniendo cuentas');
    }
});

// Obtener una cuenta global específica sin mutaciones ocultas durante la lectura.
router.get('/:id', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const account = await accountService.getAccount(req.params.id);
        const access = await resolveAccessContext(req);
        const mesaAccess = await evaluateMesaAccess(access, {
            id: account.mesa_id,
            zona_id: account.zona_id,
            estado: account.estado_operativo === 'abierta' ? 'ocupada' : 'libre'
        });

        if (!mesaAccess.visible) {
            return res.status(403).json({
                error: 'No tienes acceso operativo a la zona de esta cuenta.',
                code: 'OPERATIONAL_ACCESS_DENIED'
            });
        }

        res.json({ success: true, data: account });
    } catch (error) {
        return sendRouteError(res, error, 'Error obteniendo la cuenta');
    }
});

// Consultar las condiciones de cierre antes de liberar la mesa o banco.
router.get(
    '/:id/finalization',
    requireCapability(CAPABILITIES.ORDERS_OPERATE),
    requireCapability(CAPABILITIES.ORDERS_FINALIZE_SERVICE),
    async (req, res) => {
        try {
            const account = await accountService.getAccount(req.params.id);
            const access = await resolveAccessContext(req);
            const mesaAccess = await evaluateMesaAccess(access, {
                id: account.mesa_id,
                zona_id: account.zona_id,
                estado: account.estado_operativo === 'abierta' ? 'ocupada' : 'libre'
            });

            if (!mesaAccess.operable && account.estado_operativo === 'abierta') {
                return res.status(403).json({
                    error: mesaAccess.visible
                        ? 'Solo un responsable asignado puede finalizar esta cuenta.'
                        : 'No tienes acceso operativo a esta zona.',
                    code: mesaAccess.visible ? 'MESA_RESPONSIBILITY_REQUIRED' : 'ZONE_NOT_ALLOWED'
                });
            }

            const read = await serviceFinalizationService.getFinalizationRead(account.id);
            return res.json({ success: true, data: read });
        } catch (error) {
            return sendRouteError(res, error, 'Error verificando la finalización del servicio');
        }
    }
);

// Finalizar explícitamente el servicio y liberar la mesa/banco en una sola transacción.
router.post(
    '/:id/finalize-service',
    requireCapability(CAPABILITIES.ORDERS_OPERATE),
    requireCapability(CAPABILITIES.ORDERS_FINALIZE_SERVICE),
    async (req, res) => {
        try {
            const account = await accountService.getAccount(req.params.id);
            const access = await resolveAccessContext(req);
            const mesaAccess = await evaluateMesaAccess(access, {
                id: account.mesa_id,
                zona_id: account.zona_id,
                estado: account.estado_operativo === 'abierta' ? 'ocupada' : 'libre'
            });

            if (!mesaAccess.operable && account.estado_operativo === 'abierta') {
                return res.status(403).json({
                    error: mesaAccess.visible
                        ? 'Solo un responsable asignado puede finalizar esta cuenta.'
                        : 'No tienes acceso operativo a esta zona.',
                    code: mesaAccess.visible ? 'MESA_RESPONSIBILITY_REQUIRED' : 'ZONE_NOT_ALLOWED'
                });
            }

            const result = await serviceFinalizationService.finalizeService({
                accountId: account.id,
                userId: req.session?.userId,
                observation: req.body?.observacion ?? req.body?.observation,
                expectedVersion: req.body?.version ?? req.body?.expectedVersion,
                idempotencyKey: req.get('Idempotency-Key')
                    || req.body?.clave_idempotencia
                    || req.body?.idempotencyKey
            });

            res.locals.realtime = {
                scope: 'cuentas',
                orderIds: [Number(account.id)],
                mesaIds: [Number(account.mesa_id)],
                zoneIds: [Number(account.zona_id)].filter(Boolean)
            };

            return res.json({ success: true, data: result });
        } catch (error) {
            return sendRouteError(res, error, 'Error finalizando el servicio');
        }
    }
);

// Listar documentos operativos emitidos para una cuenta global.
router.get('/:id/preinvoices', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const account = await accountService.getAccount(req.params.id);
        const access = await resolveAccessContext(req);
        const mesaAccess = await evaluateMesaAccess(access, {
            id: account.mesa_id,
            zona_id: account.zona_id,
            estado: account.estado_operativo === 'abierta' ? 'ocupada' : 'libre'
        });

        if (!mesaAccess.visible) {
            return res.status(403).json({
                error: 'No tienes acceso operativo a las prefacturas de esta cuenta.',
                code: 'OPERATIONAL_ACCESS_DENIED'
            });
        }

        const documents = await preinvoiceService.listByAccount(account.id);
        res.json({ success: true, data: documents });
    } catch (error) {
        return sendRouteError(res, error, 'Error obteniendo prefacturas');
    }
});

// Consultar una prefactura individual, siempre dentro de su cuenta global.
router.get('/:id/preinvoices/:preinvoiceId', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const account = await accountService.getAccount(req.params.id);
        const access = await resolveAccessContext(req);
        const mesaAccess = await evaluateMesaAccess(access, {
            id: account.mesa_id,
            zona_id: account.zona_id,
            estado: account.estado_operativo === 'abierta' ? 'ocupada' : 'libre'
        });

        if (!mesaAccess.visible) {
            return res.status(403).json({
                error: 'No tienes acceso operativo a esta prefactura.',
                code: 'OPERATIONAL_ACCESS_DENIED'
            });
        }

        const document = await preinvoiceService.getPreinvoice(req.params.preinvoiceId);
        if (Number(document.pedido_id) !== Number(account.id)) {
            return res.status(404).json({
                error: 'Prefactura no encontrada en esta cuenta.',
                code: 'PREINVOICE_ACCOUNT_MISMATCH'
            });
        }

        res.json({ success: true, data: document });
    } catch (error) {
        return sendRouteError(res, error, 'Error obteniendo la prefactura');
    }
});

// Emitir una sola prefactura por operación. Las cantidades quedan reservadas
// transaccionalmente y desaparecen del consumo activo disponible.
router.post(
    '/:id/preinvoices',
    requireCapability(CAPABILITIES.ORDERS_OPERATE),
    requireCapability(CAPABILITIES.ORDERS_ISSUE_PREINVOICE),
    async (req, res) => {
        try {
            const account = await accountService.getAccount(req.params.id);
            const access = await resolveAccessContext(req);
            const mesaAccess = await evaluateMesaAccess(access, {
                id: account.mesa_id,
                zona_id: account.zona_id,
                estado: account.estado_operativo === 'abierta' ? 'ocupada' : 'libre'
            });

            if (!mesaAccess.operable) {
                return res.status(403).json({
                    error: mesaAccess.visible
                        ? 'Solo un responsable asignado puede emitir prefacturas de esta cuenta.'
                        : 'No tienes acceso operativo a esta zona.',
                    code: mesaAccess.visible ? 'MESA_RESPONSIBILITY_REQUIRED' : 'ZONE_NOT_ALLOWED'
                });
            }

            const type = String(req.body?.tipo || req.body?.type || 'dividida').trim().toLowerCase();
            const canSplit = access.isAdmin || (access.capabilities || []).includes(CAPABILITIES.ORDERS_SPLIT);
            if (type === 'dividida' && !canSplit) {
                return res.status(403).json({
                    error: 'No tienes capacidad para dividir cuentas.',
                    code: 'CAPABILITY_REQUIRED',
                    capability: CAPABILITIES.ORDERS_SPLIT
                });
            }

            const document = await preinvoiceService.createPreinvoice({
                accountId: account.id,
                payerName: req.body?.pagador_nombre ?? req.body?.payerName,
                type,
                assignments: req.body?.items ?? req.body?.assignments,
                observation: req.body?.observacion ?? req.body?.observation,
                idempotencyKey: req.body?.clave_idempotencia ?? req.body?.idempotencyKey,
                issuedByUserId: req.session?.userId
            });

            res.locals.realtime = {
                scope: 'cuentas',
                orderIds: [Number(account.id)],
                mesaIds: [Number(account.mesa_id)],
                zoneIds: [Number(account.zona_id)].filter(Boolean)
            };

            return res.status(document.idempotency_replay ? 200 : 201).json({
                success: true,
                data: document
            });
        } catch (error) {
            return sendRouteError(res, error, 'Error emitiendo la prefactura');
        }
    }
);

// Crear una nueva cuenta global. La UI y el endpoint continúan usando el término pedido
// durante la transición, pero la escritura se ejecuta mediante accountService.
router.post('/', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const { mesa_id, productos } = req.body || {};
        const seat = await accountService.getSeatContext(mesa_id);
        const access = await resolveAccessContext(req);
        const mesaAccess = await evaluateMesaAccess(access, seat);

        if (!mesaAccess.operable) {
            return res.status(403).json({
                error: mesaAccess.visible
                    ? 'Esta mesa/cuenta está asignada a otros responsables operativos.'
                    : 'No tienes acceso operativo a esta zona.',
                code: mesaAccess.visible ? 'MESA_RESPONSIBILITY_REQUIRED' : 'ZONE_NOT_ALLOWED'
            });
        }

        const account = await accountService.createAccount({
            mesaId: mesa_id,
            productos,
            userId: req.session?.userId
        });

        res.json({
            success: true,
            data: {
                id: account.id,
                numero_cuenta: account.numero_cuenta,
                total: account.total_con_servicio,
                subtotal: account.subtotal,
                servicio: account.monto_servicio,
                aplica_servicio: account.aplica_servicio,
                porcentaje_servicio: account.porcentaje_servicio,
                total_pagado: account.total_pagado,
                saldo_pendiente: account.saldo_pendiente,
                estado_operativo: account.estado_operativo,
                estado_financiero: account.estado_financiero,
                comanda_id: account.comanda_id,
                requiere_comanda: account.requiere_comanda
            }
        });
    } catch (error) {
        return sendRouteError(res, error, 'Error creando la cuenta');
    }
});

// Agregar productos a una cuenta abierta mediante una única transacción de dominio.
router.post('/:id/products', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const account = await accountService.getAccount(req.params.id);
        const access = await resolveAccessContext(req);
        const mesaAccess = await evaluateMesaAccess(access, {
            id: account.mesa_id,
            zona_id: account.zona_id,
            estado: account.estado_operativo === 'abierta' ? 'ocupada' : 'libre'
        });

        if (!mesaAccess.operable) {
            return res.status(403).json({
                error: mesaAccess.visible
                    ? 'Solo un responsable asignado puede agregar productos a esta cuenta.'
                    : 'No tienes acceso operativo a esta zona.',
                code: mesaAccess.visible ? 'MESA_RESPONSIBILITY_REQUIRED' : 'ZONE_NOT_ALLOWED'
            });
        }

        const result = await accountService.addProducts(req.params.id, {
            productos: req.body?.productos,
            userId: req.session?.userId
        });

        res.json({
            success: true,
            data: {
                total_adicional: result.total_adicional,
                subtotal: result.subtotal,
                servicio: result.monto_servicio,
                total: result.total_con_servicio,
                total_pagado: result.total_pagado,
                saldo_pendiente: result.saldo_pendiente,
                estado_operativo: result.estado_operativo,
                estado_financiero: result.estado_financiero,
                aplica_servicio: result.aplica_servicio,
                porcentaje_servicio: result.porcentaje_servicio,
                comanda_id: result.comanda_id,
                requiere_comanda: result.requiere_comanda
            }
        });
    } catch (error) {
        return sendRouteError(res, error, 'Error agregando productos a la cuenta');
    }
});

// Adaptador temporal de edición legacy. La mutación y los totales pertenecen al servicio.
router.put('/:pedido_id/products/:producto_id', requireCapability(CAPABILITIES.ORDERS_OPERATE), async (req, res) => {
    try {
        const account = await accountService.getAccount(req.params.pedido_id);
        const access = await resolveAccessContext(req);
        const mesaAccess = await evaluateMesaAccess(access, {
            id: account.mesa_id,
            zona_id: account.zona_id,
            estado: account.estado_operativo === 'abierta' ? 'ocupada' : 'libre'
        });

        if (!mesaAccess.operable) {
            return res.status(403).json({
                error: mesaAccess.visible
                    ? 'Solo un responsable asignado puede modificar esta cuenta.'
                    : 'No tienes acceso operativo a esta zona.',
                code: mesaAccess.visible ? 'MESA_RESPONSIBILITY_REQUIRED' : 'ZONE_NOT_ALLOWED'
            });
        }

        const preview = await accountService.getLegacyReplacementContext(
            req.params.pedido_id,
            req.params.producto_id,
            req.body?.nuevo_producto_id
        );
        let lowerPriceAuthorized = false;

        if (preview.requiresAdmin) {
            const adminPassword = req.body?.admin_password;
            if (!adminPassword) {
                return res.status(403).json({
                    error: 'Se requiere contraseña de administrador para cambiar a un producto de menor valor',
                    code: 'ADMIN_AUTH_REQUIRED',
                    requires_admin: true
                });
            }

            const bcrypt = require('bcryptjs');
            const admin = await database.get("SELECT * FROM usuarios WHERE tipo = 'administrador' AND activo = 1 LIMIT 1");
            if (!admin || !await bcrypt.compare(adminPassword, admin.password)) {
                return res.status(401).json({ error: 'Contraseña de administrador incorrecta' });
            }
            lowerPriceAuthorized = true;
        }

        const totals = await accountService.replaceLegacyProduct(
            req.params.pedido_id,
            req.params.producto_id,
            req.body?.nuevo_producto_id,
            {
                userId: req.session?.userId,
                lowerPriceAuthorized
            }
        );

        res.json({
            success: true,
            message: 'Producto actualizado exitosamente',
            data: totals
        });
    } catch (error) {
        return sendRouteError(res, error, 'Error editando producto en la cuenta');
    }
});

// Procesar pago de pedido
router.post("/:id/pay", requireCapability(CAPABILITIES.CASH_COLLECT), async (req, res) => {
    try {
        const { id } = req.params;
        const { metodo_pago, productos_divididos, admin_pass } = req.body;

        if (!metodo_pago) {
            return res.status(400).json({ error: "Método de pago es requerido" });
        }

        // Verificar que el pedido existe y está pendiente
        const pedido = await database.get(`
            SELECT p.*, m.numero as mesa_numero, m.zona, m.tipo_asiento
            FROM pedidos p
            JOIN mesas m ON p.mesa_id = m.id
            WHERE p.id = ? AND p.estado = ?
        `, [id, "pendiente"]);

        if (!pedido) {
            return res.status(400).json({ error: "Pedido no encontrado o ya está procesado" });
        }

        if (Array.isArray(productos_divididos) && productos_divididos.length > 0) {
            return res.status(409).json({
                error: 'La división legacy de pagos fue reemplazada por prefacturas parciales.',
                code: 'USE_PREINVOICE_SPLIT_FLOW'
            });
        }

        const documentState = await database.get(`
            SELECT
                COALESCE((SELECT COUNT(*) FROM prefacturas pf
                          WHERE pf.pedido_id = ? AND pf.estado <> 'anulada'), 0) AS prefacturas_activas,
                COALESCE((SELECT SUM(pp.cantidad_asignada) FROM pedido_productos pp
                          WHERE pp.pedido_id = ?), 0) AS unidades_asignadas
        `, [id, id]);
        if (Number(documentState?.prefacturas_activas || 0) > 0
            || Number(documentState?.unidades_asignadas || 0) > 0) {
            return res.status(409).json({
                error: 'Esta cuenta ya tiene prefacturas emitidas y debe cobrarse por documento desde Caja.',
                code: 'ACCOUNT_REQUIRES_PREINVOICE_PAYMENT'
            });
        }

        const syncedTotals = await accountService.synchronizeAccount(id);
        if (syncedTotals) {
            Object.assign(pedido, syncedTotals);
            pedido.total = syncedTotals.subtotal;
        }

        const nombreZona = pedido.zona?.toLowerCase() === 'bar'
        ? (pedido.tipo_asiento?.toLowerCase() === 'banco' ? 'banco' : 'mesa')
        : 'mesa';


        let montoAPagar = pedido.total;

        if (productos_divididos && productos_divididos.length > 0) {
            const productosSeleccionados = await database.all(`
                SELECT SUM(precio_unitario * cantidad) as subtotal
                FROM pedido_productos
                WHERE pedido_id = ? AND id IN (${productos_divididos.map(() => "?").join(",")})
            `, [id, ...productos_divididos]);

            montoAPagar = productosSeleccionados[0].subtotal || 0;
        }

        const servicePayment = calculateService(
            montoAPagar,
            Number(pedido.aplica_servicio) === 1,
            pedido.porcentaje_servicio
        );
        const subtotal = servicePayment.subtotal;
        const servicio = servicePayment.monto_servicio;
        const total = servicePayment.total_con_servicio;

        // El crédito se formaliza únicamente sobre una prefactura persistente desde Caja.
        if (metodo_pago === 'credito') {
            return res.status(409).json({
                error: 'Emite una prefactura y formaliza el crédito desde Caja.',
                code: 'USE_PREINVOICE_CREDIT_FLOW',
                details: {
                    pedido_id: Number(id),
                    numero_cuenta: pedido.numero_cuenta || null,
                    mesa_liberada: false
                }
            });
        }

        // Adaptador transitorio: liquida el saldo actual sin cerrar el servicio ni liberar la mesa.
        // Payments reemplazará este endpoint en v3.2.x.
        const paymentResult = await accountService.recordLegacyBalancePayment(id, {
            userId: req.session.userId,
            paymentMethod: metodo_pago
        });

        res.json({
            success: true,
            data: paymentResult
        });

    } catch (error) {
        return sendRouteError(res, error, 'Error procesando el pago transitorio');
    }
});

// Obtener comandas pendientes
router.get("/comandas/pending", requireCapability(CAPABILITIES.KITCHEN_OPERATE), async (req, res) => {
    try {
        const comandas = await database.all(`
            SELECT c.*, m.numero as mesa_numero
            FROM comandas c
            JOIN mesas m ON c.mesa_id = m.id
            WHERE c.estado = "pendiente"
            ORDER BY c.fecha_impresion
        `);

        res.json({ success: true, data: comandas });
    } catch (error) {
        console.error("Error obteniendo comandas:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Marcar comanda como impresa
router.put("/comandas/:id/print", requireCapability(CAPABILITIES.KITCHEN_OPERATE), async (req, res) => {
    try {
        const { id } = req.params;

        await database.run("UPDATE comandas SET estado = ? WHERE id = ?", ["impresa", id]);

        res.json({ success: true, message: "Comanda marcada como impresa" });
    } catch (error) {
        console.error("Error marcando comanda como impresa:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

module.exports = router;
