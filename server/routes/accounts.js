const express = require("express");
const database = require("../db/database");
const financialReadService = require("../services/financialReadService");

const router = express.Router();

// Obtener todas las cuentas de crédito
router.get("/", async (req, res) => {
    try {
        const cuentas = await database.all(`
            SELECT * FROM cuentas_credito 
            ORDER BY fecha DESC
        `);
        
        res.json({ success: true, data: cuentas });
    } catch (error) {
        console.error("Error obteniendo cuentas:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Obtener detalle financiero consolidado de una cuenta global.
router.get("/:id", async (req, res) => {
    try {
        const data = await financialReadService.getAccountFinancialRead(req.params.id);
        res.json({ success: true, data });
    } catch (error) {
        console.error("Error obteniendo detalle financiero de la cuenta global:", error);
        res.status(error.statusCode || 500).json({
            error: error.statusCode ? error.message : "Error interno del servidor",
            code: error.code
        });
    }
});

// Crear nueva cuenta de crédito
router.post("/", async (req, res) => {
    try {
        const { cliente_nombre, monto_total } = req.body;

        if (!cliente_nombre || !monto_total) {
            return res.status(400).json({ error: "Nombre del cliente y monto son requeridos" });
        }

        if (monto_total <= 0) {
            return res.status(400).json({ error: "El monto debe ser mayor a cero" });
        }

        const result = await database.run(
            "INSERT INTO cuentas_credito (cliente_nombre, monto_total, fecha) VALUES (?, ?, ?)",
            [cliente_nombre, monto_total, new Date().toISOString()]
        );

        // Registrar en historial
        await database.run(
            "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
            ["crear_cuenta_credito", req.session.userId, `Cuenta de crédito creada para ${cliente_nombre} - $${monto_total}`, new Date().toISOString()]
        );

        res.json({ 
            success: true, 
            data: { 
                id: result.id, 
                cliente_nombre, 
                monto_total, 
                fecha: new Date().toISOString() 
            } 
        });
    } catch (error) {
        console.error("Error creando cuenta de crédito:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Abonar a una cuenta de crédito
router.post("/:id/payment", async (req, res) => {
    try {
        const { id } = req.params;
        const { monto_abono, metodo_pago } = req.body;

        if (!monto_abono || !metodo_pago) {
            return res.status(400).json({ error: "Monto de abono y método de pago son requeridos" });
        }

        if (monto_abono <= 0) {
            return res.status(400).json({ error: "El abono debe ser mayor a cero" });
        }

        // Verificar que la cuenta existe
        const cuenta = await database.get("SELECT * FROM cuentas_credito WHERE id = ?", [id]);
        if (!cuenta) {
            return res.status(404).json({ error: "Cuenta no encontrada" });
        }

        if (monto_abono > cuenta.monto_total) {
            return res.status(400).json({ error: "El abono no puede ser mayor al monto pendiente" });
        }

        const nuevoMonto = cuenta.monto_total - monto_abono;

        // Si el abono cubre toda la deuda, eliminar la cuenta
        if (nuevoMonto === 0) {
            await database.run("DELETE FROM cuentas_credito WHERE id = ?", [id]);
        } else {
            // Actualizar el monto pendiente
            await database.run(
                "UPDATE cuentas_credito SET monto_total = ? WHERE id = ?",
                [nuevoMonto, id]
            );
        }

        // Registrar el pago en historial
        await database.run(
            "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
            ["abono_cuenta_credito", req.session.userId, `Abono de $${monto_abono} a cuenta de ${cuenta.cliente_nombre} (${metodo_pago})`, new Date().toISOString()]
        );

        // Registrar el abono en pagos_creditos
        await database.run(
            "INSERT INTO pagos_creditos (credito_id, cliente_nombre, monto_pagado, monto_original, es_pago_completo, metodo_pago, fecha_pago, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [id, cuenta.cliente_nombre, monto_abono, cuenta.monto_total, (nuevoMonto === 0 ? 1 : 0), metodo_pago, new Date().toISOString(), req.session.userId]
        );

        res.json({ 
            success: true, 
            data: { 
                monto_abonado: monto_abono,
                monto_restante: nuevoMonto,
                cuenta_saldada: nuevoMonto === 0,
                metodo_pago
            } 
        });
    } catch (error) {
        console.error("Error procesando abono:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Pagar cuenta completa
router.post("/:id/pay-full", async (req, res) => {
    try {
        const { id } = req.params;
        const { metodo_pago } = req.body;

        if (!metodo_pago) {
            return res.status(400).json({ error: "Método de pago es requerido" });
        }

        // Obtener la cuenta
        const cuenta = await database.get("SELECT * FROM cuentas_credito WHERE id = ?", [id]);
        if (!cuenta) {
            return res.status(404).json({ error: "Cuenta no encontrada" });
        }

        // Marcar el pedido como pagado (cambio importante)
        if (cuenta.pedido_id) {
            await database.run("UPDATE pedidos SET estado = ? WHERE id = ?", ['pagado', cuenta.pedido_id]);

            // Registrar pago formal del pedido (opcional, si manejás tabla pagos)
            await database.run(
                "INSERT INTO pagos (pedido_id, metodo_pago, monto, fecha) VALUES (?, ?, ?, ?)",
                [cuenta.pedido_id, metodo_pago, cuenta.monto_total, new Date().toISOString()]
            );

            // Registrar en historial
            await database.run(
                "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
                ["pago_completo_credito", req.session.userId, `Crédito saldado - Pedido #${cuenta.pedido_id} - ${cuenta.cliente_nombre}`, new Date().toISOString()]
            );
        }

        // Eliminar la cuenta de crédito
        await database.run("DELETE FROM cuentas_credito WHERE id = ?", [id]);

        // Registrar el pago completo
        await database.run(
            "INSERT INTO pagos_creditos (credito_id, cliente_nombre, monto_pagado, monto_original, es_pago_completo, metodo_pago, fecha_pago, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [id, cuenta.cliente_nombre, cuenta.monto_total, cuenta.monto_total, 1, metodo_pago, new Date().toISOString(), req.session.userId]
        );

        res.json({
            success: true,
            data: {
                monto_pagado: cuenta.monto_total,
                cliente_nombre: cuenta.cliente_nombre,
                metodo_pago
            }
        });
    } catch (error) {
        console.error("Error procesando pago completo:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});



// Reimprimir factura / preparar datos para reimpresión
router.post("/:id/reprint", async (req, res) => {
    try {
        const { id } = req.params;

        const pedido = await database.get(`
            SELECT p.id, p.total, p.fecha, p.estado,
                   m.numero as mesa_numero, m.tipo_asiento,
                   COALESCE(p.cliente_nombre, m.cliente_nombre, 'Cliente anónimo') as cliente_nombre,
                   u.nombre as usuario_nombre
            FROM pedidos p
            JOIN mesas m ON p.mesa_id = m.id
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.id = ?
        `, [id]);

        if (!pedido) {
            return res.status(404).json({ error: "Pedido no encontrado" });
        }

        const items = await database.all(`
            SELECT pp.cantidad, pp.precio_unitario as precio,
                   (pp.cantidad * pp.precio_unitario) as subtotal,
                   pr.nombre as producto_nombre,
                   COALESCE(pres.nombre, '') as presentacion_nombre,
                   COALESCE(pres.cantidad, '') as presentacion_cantidad
            FROM pedido_productos pp
            JOIN productos pr ON pp.producto_id = pr.id
            LEFT JOIN presentaciones pres ON pp.presentacion_id = pres.id
            WHERE pp.pedido_id = ?
        `, [id]);

        await database.run(
            "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
            ["reimprimir_factura", req.session.userId, `Factura reimpresa/preparada para pedido #${id}`, new Date().toISOString()]
        );

        res.json({
            success: true,
            message: "Factura preparada para reimpresión",
            data: { ...pedido, items }
        });
    } catch (error) {
        console.error("Error reimprimiendo factura:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Eliminar cuenta de crédito (solo administradores)
router.delete("/:id", async (req, res) => {
    try {
        // Verificar permisos de administrador
        if (req.session.userType !== "administrador") {
            return res.status(403).json({ error: "Solo los administradores pueden eliminar cuentas de crédito" });
        }

        const { id } = req.params;

        // Verificar que la cuenta existe
        const cuenta = await database.get("SELECT * FROM cuentas_credito WHERE id = ?", [id]);
        if (!cuenta) {
            return res.status(404).json({ error: "Cuenta no encontrada" });
        }

        await database.run("DELETE FROM cuentas_credito WHERE id = ?", [id]);

        // Registrar en historial
        await database.run(
            "INSERT INTO historial_transacciones (tipo_accion, usuario_id, descripcion, fecha) VALUES (?, ?, ?, ?)",
            ["eliminar_cuenta_credito", req.session.userId, `Cuenta de crédito eliminada para ${cuenta.cliente_nombre}`, new Date().toISOString()]
        );

        res.json({ success: true, message: "Cuenta de crédito eliminada exitosamente" });
    } catch (error) {
        console.error("Error eliminando cuenta de crédito:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Obtener resumen de cuentas de crédito
router.get("/summary/stats", async (req, res) => {
    try {
        const totalCuentas = await database.get("SELECT COUNT(*) as count FROM cuentas_credito");
        const montoTotal = await database.get("SELECT COALESCE(SUM(monto_total), 0) as total FROM cuentas_credito");
        
        const cuentasPorCliente = await database.all(`
            SELECT cliente_nombre, COUNT(*) as num_cuentas, SUM(monto_total) as monto_total
            FROM cuentas_credito
            GROUP BY cliente_nombre
            ORDER BY monto_total DESC
        `);

        res.json({ 
            success: true, 
            data: {
                total_cuentas: totalCuentas.count,
                monto_total_pendiente: montoTotal.total,
                cuentas_por_cliente: cuentasPorCliente
            }
        });
    } catch (error) {
        console.error("Error obteniendo resumen de cuentas:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

module.exports = router;


