const express = require("express");
const database = require("../db/database");
const requireCapability = require("../middleware/requireCapability");
const { CAPABILITIES } = require("../security/capabilities");
const {
    resolveAccessContext,
    evaluateMesaAccess
} = require('../services/operationalAccessService');

const accountService = require('../services/accountService');
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

        // 🔐 PROCESO DE CRÉDITO
        if (metodo_pago === 'credito') {
            const bcrypt = require("bcryptjs");

            const admin = await database.get("SELECT * FROM usuarios WHERE tipo = ? AND activo = 1 LIMIT 1", ["administrador"]);
            if (!admin || !await bcrypt.compare(admin_pass || "", admin.password)) {
                return res.status(401).json({ error: "Contraseña de administrador incorrecta" });
            }

            // 1. Actualizar estado del pedido a 'credito'
            await database.run("UPDATE pedidos SET estado = ? WHERE id = ?", ["credito", id]);

            // 2. Liberar la mesa
            await database.run("UPDATE mesas SET estado = ?, cliente_nombre = NULL, fecha_apertura = NULL, cantidad_personas = NULL, hora_estimada = NULL WHERE id = ?", ["libre", pedido.mesa_id]);

            // 3. Registrar en historial
            await database.run(
                "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
                [`credito_${nombreZona}`, req.session.userId, `Pedido #${pedido.id} registrado como crédito en ${nombreZona} ${pedido.mesa_numero}`, new Date().toISOString()]
            );

            // 4. Registrar en cuentas_credito
            await database.run(`
                INSERT INTO cuentas_credito (pedido_id, cliente_nombre, monto_total, fecha, usuario_origen, autorizado_por, mesa)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                pedido.id,
                pedido.cliente_nombre || '',
                total,
                new Date().toISOString(),
                req.session.userName || req.session.userNombre || 'usuario_desconocido',
                admin.nombre,
                `${nombreZona} ${pedido.mesa_numero}`
            ]);

            // 5. Sincronizar el agregado financiero global antes de responder.
            const accountTotals = await accountService.synchronizeAccount(id);

            // 6. Devolver respuesta
            return res.json({
                success: true,
                data: {
                    subtotal,
                    servicio,
                    total,
                    metodo_pago,
                    aplica_servicio: servicePayment.aplica_servicio,
                    porcentaje_servicio: servicePayment.porcentaje_servicio,
                    mesa_numero: pedido.mesa_numero,
                    numero_cuenta: pedido.numero_cuenta,
                    total_pagado: accountTotals.total_pagado,
                    saldo_pendiente: accountTotals.saldo_pendiente,
                    estado_operativo: accountTotals.estado_operativo,
                    estado_financiero: accountTotals.estado_financiero,
                    mensaje: `Saldo pendiente de pago - ₡${Number(total).toLocaleString('es-CR', { minimumFractionDigits: 2 })}`

                }
            });
        }

        // 🟢 SI NO ES CRÉDITO, PROCESAR COMO PAGO NORMAL
        await database.run(
            `INSERT INTO pagos (
                pedido_id, metodo_pago, monto, subtotal, servicio,
                porcentaje_servicio, aplica_servicio, fecha
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                metodo_pago,
                total,
                subtotal,
                servicio,
                servicePayment.porcentaje_servicio,
                servicePayment.aplica_servicio,
                new Date().toISOString()
            ]
        );

        if (!productos_divididos || productos_divididos.length === 0) {
            await database.run("UPDATE pedidos SET estado = ? WHERE id = ?", ["pagado", id]);
            await database.run(
                "UPDATE mesas SET estado = ?, cliente_nombre = NULL, fecha_apertura = NULL, cantidad_personas = NULL, hora_estimada = NULL WHERE id = ?",
                ["libre", pedido.mesa_id]
            );
        }

        await database.run(
            "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
            [`procesar_pago_${nombreZona}`, req.session.userId, `Pago procesado para ${nombreZona} ${pedido.mesa_numero} - $${total}`, new Date().toISOString()]
        );

        const accountTotals = await accountService.synchronizeAccount(id);

        res.json({
            success: true,
            data: {
                subtotal,
                servicio,
                total,
                metodo_pago,
                aplica_servicio: servicePayment.aplica_servicio,
                porcentaje_servicio: servicePayment.porcentaje_servicio,
                mesa_numero: pedido.mesa_numero,
                numero_cuenta: pedido.numero_cuenta,
                total_pagado: accountTotals.total_pagado,
                saldo_pendiente: accountTotals.saldo_pendiente,
                estado_operativo: accountTotals.estado_operativo,
                estado_financiero: accountTotals.estado_financiero
            }
        });

    } catch (error) {
        console.error("Error procesando pago:", error);
        res.status(500).json({ error: "Error interno del servidor" });
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
